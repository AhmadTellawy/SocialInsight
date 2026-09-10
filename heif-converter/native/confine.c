#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

/* No privileged helper, setuid, shell, caller-supplied executable or inherited
 * application environment. Install the irreversible boundary before Node starts. */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
static const char *phase = "ENTRY";
static void fail(void) { fprintf(stderr,"CONFINEMENT_UNAVAILABLE:%s\n",phase); _exit(78); }
static volatile sig_atomic_t broker_pid;
static void forward_signal(int sig) { if (broker_pid > 0) kill(broker_pid, sig); }
static int supervise(int probe) {
  phase="SUPERVISOR";
  if (prctl(PR_SET_CHILD_SUBREAPER, 1)) fail();
  struct sigaction handler = { .sa_handler = forward_signal };
  sigemptyset(&handler.sa_mask);
  if (sigaction(SIGTERM, &handler, NULL) || sigaction(SIGINT, &handler, NULL)) fail();
  pid_t expected_parent=getpid(), pid = fork(); if (pid < 0) fail();
  if (!pid) {
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != expected_parent) fail();
    execl("/usr/local/bin/node", "node", probe ? "/app/src/confinementSmoke.js" : "/app/src/index.js", NULL);
    fail();
  }
  broker_pid = pid; int result=1, status; pid_t reaped;
  /* Orphaned worker descendants are adopted and reaped here, never left for an
   * unproven provider PID1. Node still owns/reaps its direct worker children. */
  for (;;) {
    reaped = waitpid(-1, &status, 0);
    if (reaped < 0) { if (errno == EINTR) continue; if (errno == ECHILD) break; fail(); }
    if (reaped == pid) { broker_pid=0; result=WIFEXITED(status)?WEXITSTATUS(status):1; }
  }
  return result;
}
static void limit(int resource, rlim_t value) {
  struct rlimit r = { value, value }; if (setrlimit(resource, &r)) fail();
}
static void immutable(const char *path) {
  char resolved[PATH_MAX]; struct stat s;
  if (!realpath(path, resolved)) fail();
  for (;;) {
    if (lstat(resolved, &s) || s.st_uid != 0 || (s.st_mode & 022)) fail();
    char *slash = strrchr(resolved, '/');
    if (!slash || slash == resolved) break;
    *slash = 0;
  }
  if (stat("/", &s) || s.st_uid != 0 || (s.st_mode & 022)) fail();
}
static void job_file(const char *path, const char *base, int empty) {
  char resolved[PATH_MAX]; struct stat s;
  if (lstat(path, &s) || !S_ISREG(s.st_mode) || s.st_uid != getuid()
      || s.st_nlink != 1 || (s.st_mode & 077) || !realpath(path, resolved)
      || strcmp(path, resolved) || strncmp(path, base, strlen(base))
      || path[strlen(base)] != '/' || s.st_size < 0
      || (empty ? s.st_size != 0 : s.st_size > 15 * 1024 * 1024)) fail();
}
static void allow_path(int rules, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC); if (fd < 0) fail();
  struct landlock_path_beneath_attr rule = { .allowed_access = access, .parent_fd = fd };
  if (syscall(SYS_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) fail();
  close(fd);
}
static void filesystem(const char *job, const char *input, const char *decoded) {
  int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 3) fail(); /* TRUNCATE is mandatory, never silently best-effort. */
  struct landlock_ruleset_attr attr = { .handled_access_fs = (1ULL << 15) - 1 };
  int rules = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (rules < 0) fail();
  uint64_t read = LANDLOCK_ACCESS_FS_READ_FILE, dir = read | LANDLOCK_ACCESS_FS_READ_DIR;
  allow_path(rules, "/app/src", dir);
  allow_path(rules, "/app/node_modules", dir | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/app/package.json", read);
  allow_path(rules, "/usr/local/bin/node", read | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/usr/local/bin/heif-convert", read | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/usr/local/bin/si-heif-confine", read | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/usr/lib", dir | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/lib", dir | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/lib64", dir | LANDLOCK_ACCESS_FS_EXECUTE);
  allow_path(rules, "/etc/ld.so.cache", read);
  allow_path(rules, "/dev/null", read | LANDLOCK_ACCESS_FS_WRITE_FILE);
  allow_path(rules, "/dev/urandom", read);
  allow_path(rules, job, LANDLOCK_ACCESS_FS_READ_DIR);
  allow_path(rules, input, read);
  allow_path(rules, decoded, read | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
      || syscall(SYS_landlock_restrict_self, rules, 0)) fail();
  close(rules);
}

/* Architecture checked before syscall decoding; x32 explicitly unavailable.
 * Required runtime syscalls retain kernel checks; capabilities to escape the
 * process group, touch another process, network, create namespaces or bypass
 * Landlock via io_uring are removed. Filesystem writes are Landlock-controlled. */
#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_##n, 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)
#define ARGLO(n) (offsetof(struct seccomp_data, args) + (n) * sizeof(uint64_t))
static void system_calls(void) {
#if defined(__x86_64__)
  const unsigned arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
  const unsigned arch = AUDIT_ARCH_AARCH64;
#else
#error Unsupported syscall architecture
#endif
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, arch, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
    DENY(socket), DENY(connect), DENY(bind), DENY(listen), DENY(accept), DENY(accept4),
    DENY(ptrace), DENY(process_vm_readv), DENY(process_vm_writev),
    DENY(pidfd_open), DENY(pidfd_getfd), DENY(pidfd_send_signal),
    DENY(io_uring_setup), DENY(io_uring_enter), DENY(io_uring_register),
    DENY(unshare), DENY(setns), DENY(mount), DENY(umount2), DENY(pivot_root), DENY(chroot),
    DENY(fsopen), DENY(fsconfig), DENY(fsmount), DENY(move_mount), DENY(open_tree), DENY(mount_setattr),
    DENY(process_madvise), DENY(process_mrelease),
    DENY(open_by_handle_at), DENY(name_to_handle_at), DENY(bpf), DENY(perf_event_open),
    DENY(userfaultfd), DENY(keyctl), DENY(add_key), DENY(request_key),
    DENY(setsid), DENY(setpgid), DENY(setpriority), DENY(sched_setaffinity),
    DENY(sched_setscheduler), DENY(sched_setparam), DENY(sched_setattr),
    DENY(setuid), DENY(setgid), DENY(setreuid), DENY(setregid),
    DENY(setresuid), DENY(setresgid), DENY(setfsuid), DENY(setfsgid), DENY(setgroups),
    DENY(capset), DENY(reboot), DENY(init_module), DENY(finit_module), DENY(delete_module),
    DENY(kexec_load), DENY(swapon), DENY(swapoff), DENY(acct),
    DENY(tkill), DENY(rt_sigqueueinfo), DENY(rt_tgsigqueueinfo),
    /* clone3 opaque user-memory flags cannot safely be inspected by BPF. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone3, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|ENOSYS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, CLONE_NEWCGROUP|CLONE_NEWIPC|CLONE_NEWNET|CLONE_NEWNS|CLONE_NEWPID|CLONE_NEWTIME|CLONE_NEWUSER|CLONE_NEWUTS|CLONE_PARENT|CLONE_PIDFD|CLONE_UNTRACED, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    /* Native timeout may only kill this sealed process group. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_kill, 0, 6),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 0, 0, 3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, SIGKILL, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_tgkill, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, (unsigned)getpid(), 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_prlimit64, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 0, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_prctl, 0, 10),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_SET_NAME, 7, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_GET_NAME, 6, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_GET_NO_NEW_PRIVS, 5, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_GET_SECCOMP, 4, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_SET_PDEATHSIG, 0, 2),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, SIGKILL, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail();
}
int main(int argc, char **argv) {
  if (getuid() != 10001 || geteuid() != getuid() || getgid() != 10001) fail();
  if (argc == 2 && !strcmp(argv[1], "--supervise")) return supervise(0);
  if (argc == 2 && !strcmp(argv[1], "--supervise-probe")) return supervise(1);
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() == 1) fail();
  char *env[] = { "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "NODE_ENV=production",
    "UV_THREADPOOL_SIZE=1", "UV_USE_IO_URING=0", "MALLOC_ARENA_MAX=2", NULL };
  limit(RLIMIT_CORE, 0); limit(RLIMIT_NOFILE, 64); limit(RLIMIT_NPROC, 32);
  limit(RLIMIT_FSIZE, 128 * 1024 * 1024);
  if (argc == 4 && !strcmp(argv[1], "--native")) {
    /* This mode is useful only under the inherited parent boundary. */
    if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1 || prctl(PR_GET_SECCOMP) != 2) fail();
    limit(RLIMIT_AS, 768 * 1024 * 1024); limit(RLIMIT_CPU, 12);
    char *args[] = { "/usr/local/bin/heif-convert", "--codec-threads", "1", "--tile-threads", "0", "--png-compression-level", "1", argv[2], argv[3], NULL };
    execve(args[0], args, env); fail();
  }
  if (argc != 3 || (strcmp(argv[1], "--worker") && strcmp(argv[1], "--probe"))) fail();
  const char *job = argv[2]; char canonical[PATH_MAX], input[PATH_MAX], decoded[PATH_MAX]; struct stat s;
  phase="JOB_PATHS";
  if (!realpath(job, canonical) || strcmp(job, canonical)
      || strncmp(job, "/tmp/heif-converter/job-", 24)
      || strchr(job + 24, '/') || lstat(job, &s) || !S_ISDIR(s.st_mode)
      || s.st_uid != getuid() || (s.st_mode & 077)) fail();
  if (snprintf(input, sizeof(input), "%s/input.heic", job) >= sizeof(input)
      || snprintf(decoded, sizeof(decoded), "%s/decoded.png", job) >= sizeof(decoded)) fail();
  job_file(input, job, 0); job_file(decoded, job, 1);
  const char *paths[] = { "/app/src", "/app/node_modules", "/app/package.json", "/usr/local/bin/node",
    "/usr/local/bin/heif-convert", "/usr/local/bin/si-heif-confine", "/opt/heif-converter/native-versions.json", "/usr/lib", "/etc/ld.so.cache" };
  phase="IMMUTABLE_RUNTIME";
  for (unsigned i=0; i<sizeof(paths)/sizeof(paths[0]); i++) immutable(paths[i]);
  limit(RLIMIT_CPU, 30);
  if (chdir(job)) fail();
  /* A process-group leader created by the broker cannot join another group. */
  if (getpgrp() != getpid()) fail();
  if (syscall(SYS_close_range, 3, ~0U, 0)) fail();
  phase="LANDLOCK";filesystem(job, input, decoded);
  phase="SECCOMP";system_calls();
  char *args[] = { "/usr/local/bin/node", "--max-old-space-size=96", "--v8-pool-size=1",
    !strcmp(argv[1], "--probe") ? "/app/src/confinedProbe.js" : "/app/src/confinedWorker.js", input, decoded, NULL };
  phase="NODE_EXEC";execve(args[0], args, env); fail();
}
