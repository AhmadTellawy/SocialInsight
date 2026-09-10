#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/falloc.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* No privileged helper, setuid, shell, caller-supplied executable or inherited
 * application environment. Install the irreversible boundary before Node starts. */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef __NR_fchmodat2
#define __NR_fchmodat2 452
#endif
static const char *phase = "ENTRY";
static void fail(void) { fprintf(stderr,"CONFINEMENT_UNAVAILABLE:%s\n",phase); _exit(78); }
static volatile sig_atomic_t broker_pid;
static volatile sig_atomic_t shutdown_requested;
static void forward_signal(int sig) { shutdown_requested=1; if (broker_pid > 0) kill(broker_pid, sig); }
static long long monotonic_ms(void) {
  struct timespec now; if (clock_gettime(CLOCK_MONOTONIC,&now)) fail();
  return (long long)now.tv_sec*1000 + now.tv_nsec/1000000;
}
static void kill_adopted(void) {
  char path[128], children[4096];
  snprintf(path,sizeof(path),"/proc/self/task/%d/children",getpid());
  int fd=open(path,O_RDONLY|O_CLOEXEC); if(fd<0)fail();
  ssize_t size=read(fd,children,sizeof(children)-1); close(fd);
  if(size<0 || size==sizeof(children)-1)fail();
  children[size]=0;
  char *next=children;
  while(*next) {
    char *end;long pid=strtol(next,&end,10);if(end==next)break;next=end;
    while(*next==' ')next++;
    if(pid>1 && pid!=broker_pid) {
      // These are our direct adopted children, not arbitrary same-UID processes.
      // Escaping a worker group is denied before untrusted image code starts.
      pid_t group=getpgid((pid_t)pid);
      if(group>1 && group!=getpgrp())kill(-group,SIGKILL);
      kill((pid_t)pid,SIGKILL);
    }
  }
}
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
  broker_pid = pid; int result=1, status; pid_t reaped;long long deadline=0,hard_deadline=0;
  /* Orphaned worker descendants are adopted and reaped here, never left for an
   * unproven provider PID1. Node still owns/reaps its direct worker children. */
  for (;;) {
    reaped = waitpid(-1, &status, WNOHANG);
    if (reaped < 0) { if (errno == EINTR) continue; if (errno == ECHILD) break; fail(); }
    if (reaped == pid) { broker_pid=0; result=WIFEXITED(status)?WEXITSTATUS(status):1;shutdown_requested=1; }
    if(reaped>0)continue;
    kill_adopted();
    if(shutdown_requested) {
      long long now=monotonic_ms();
      if(!deadline){deadline=now+5000;hard_deadline=now+10000;}
      if(now>=deadline && broker_pid>0)kill(broker_pid,SIGKILL);
      if(now>=hard_deadline)fail();
    }
    struct timespec interval={.tv_sec=0,.tv_nsec=20000000};nanosleep(&interval,NULL);
  }
  return result;
}
static void limit(int resource, rlim_t value) {
  struct rlimit r = { value, value }; if (setrlimit(resource, &r)) fail();
}
static void no_capabilities(void) {
  struct __user_cap_header_struct header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};
  struct __user_cap_data_struct data[2];
  if(syscall(SYS_capget,&header,data))fail();
  for(unsigned i=0;i<2;i++)if(data[i].effective||data[i].permitted||data[i].inheritable)fail();
  for(int cap=0;cap<=CAP_LAST_CAP;cap++)if(prctl(PR_CAP_AMBIENT,PR_CAP_AMBIENT_IS_SET,cap,0,0)!=0)fail();
}
static void supervisor_boundary(void) {
  phase="SUPERVISOR_BOUNDARY";no_capabilities();
  limit(RLIMIT_NPROC,128);
  struct rlimit r;if(getrlimit(RLIMIT_NPROC,&r)||r.rlim_cur!=128||r.rlim_max!=128)fail();
  if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0)!=1)fail();
}
static void *sleep_thread(void *unused) {(void)unused;for(;;)pause();return NULL;}
static int exhaustion_probe(int threads) {
  phase="NPROC_EXHAUSTION";
  struct rlimit r;if(getrlimit(RLIMIT_NPROC,&r)||r.rlim_cur!=32||r.rlim_max!=32)fail();
  unsigned count=0;pid_t children[64];pthread_t workers[64];int error=0;
  for(;count<64;count++) {
    if(threads){error=pthread_create(&workers[count],NULL,sleep_thread,NULL);if(error)break;}
    else {pid_t child=fork();if(child<0){error=errno;break;}if(!child){close(0);close(1);close(2);alarm(60);for(;;)pause();}children[count]=child;}
  }
  if(error!=EAGAIN||count<1||count>32)fail();
  printf("{\"kind\":\"%s\",\"created\":%u,\"limit\":32,\"error\":\"EAGAIN\",\"children\":[",threads?"threads":"forks",count);
  if(!threads)for(unsigned i=0;i<count;i++)printf("%s%d",i?",":"",children[i]);
  puts("]}");fflush(stdout);alarm(60);for(;;)pause();
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
static int syscall_probe(void) {
  phase="SYSCALL_PROBE";
  if(prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0)!=1 || prctl(PR_GET_SECCOMP)!=2)fail();
  struct rlimit r;
  const int resources[]={RLIMIT_CORE,RLIMIT_NOFILE,RLIMIT_NPROC,RLIMIT_FSIZE,RLIMIT_CPU};
  const rlim_t limits[]={0,64,32,128*1024*1024,30};
  for(unsigned i=0;i<sizeof(resources)/sizeof(resources[0]);i++) {
    if(getrlimit(resources[i],&r)||r.rlim_cur!=limits[i]||r.rlim_max!=limits[i])fail();
  }
  int pair[2];if(pipe2(pair,O_CLOEXEC))fail();
  int value=1;struct f_owner_ex owner={.type=F_OWNER_PID,.pid=getppid()};
  unsigned checks=0;
#define EXPECT_DENIED(call) do { errno=0; if((call)!=-1 || errno!=EPERM)fail();checks++; } while(0)
  EXPECT_DENIED(syscall(__NR_fchmodat,AT_FDCWD,"/tmp/heif-converter",0,0));
  EXPECT_DENIED(syscall(__NR_fchmodat,AT_FDCWD,".",0,0));
  EXPECT_DENIED(syscall(__NR_fchmod,pair[0],0));
  EXPECT_DENIED(syscall(__NR_fchownat,AT_FDCWD,".",10001,10001,0));
  EXPECT_DENIED(syscall(__NR_setxattr,".","user.fixture","x",1,0));
  EXPECT_DENIED(syscall(__NR_utimensat,AT_FDCWD,".",NULL,0));
  EXPECT_DENIED(fcntl(pair[0],F_SETOWN,getppid()));
  EXPECT_DENIED(fcntl(pair[0],F_SETOWN_EX,&owner));
  EXPECT_DENIED(fcntl(pair[0],F_SETSIG,SIGUSR1));
  EXPECT_DENIED(fcntl(pair[0],F_SETFL,O_ASYNC));
  EXPECT_DENIED(ioctl(pair[0],0x8901,&value)); /* FIOSETOWN */
  EXPECT_DENIED(ioctl(pair[0],0x8902,&value)); /* SIOCSPGRP */
  EXPECT_DENIED(ioctl(pair[0],FIOASYNC,&value));
  EXPECT_DENIED(syscall(__NR_shmget,0,0,0600));
  EXPECT_DENIED(syscall(__NR_shmat,-1,NULL,0));
  EXPECT_DENIED(syscall(__NR_shmctl,-1,0,NULL));
  EXPECT_DENIED(syscall(__NR_msgget,0,0600));
  EXPECT_DENIED(syscall(__NR_semget,0,0,0600));
  EXPECT_DENIED(syscall(__NR_mq_open,"si_fixture",0,0600,NULL));
  int sockets[2];
  EXPECT_DENIED(socketpair(AF_UNIX,SOCK_DGRAM,0,sockets));
  if(socketpair(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0,sockets))fail();
  EXPECT_DENIED(syscall(__NR_sendto,sockets[0],"x",1,0,NULL,0));
  EXPECT_DENIED(syscall(__NR_sendmsg,sockets[0],NULL,0));
  EXPECT_DENIED(syscall(__NR_sendmmsg,sockets[0],NULL,0,0));
  EXPECT_DENIED(syscall(__NR_ptrace,0,0,NULL,NULL));
  EXPECT_DENIED(syscall(__NR_process_vm_readv,getppid(),NULL,0,NULL,0,0));
  EXPECT_DENIED(syscall(__NR_pidfd_open,getppid(),0));
  EXPECT_DENIED(syscall(__NR_io_uring_setup,1,NULL));
  EXPECT_DENIED(syscall(__NR_unshare,0));
  EXPECT_DENIED(syscall(__NR_setpgid,0,0));
  EXPECT_DENIED(syscall(__NR_setsid));
  int decoded=open("decoded.png",O_RDWR|O_CLOEXEC);struct stat before,after;
  if(decoded<0||fstat(decoded,&before))fail();
  EXPECT_DENIED(syscall(__NR_fallocate,decoded,FALLOC_FL_KEEP_SIZE,0,4096));
  if(fstat(decoded,&after)||before.st_size!=after.st_size||before.st_blocks!=after.st_blocks)fail();
  close(decoded);
  if(fcntl(pair[0],F_GETFD)<0 || fcntl(pair[0],F_SETFD,FD_CLOEXEC)<0
    || fcntl(pair[0],F_SETFL,O_NONBLOCK)<0)fail();
  close(pair[0]);close(pair[1]);close(sockets[0]);close(sockets[1]);
  printf("{\"status\":\"PASS\",\"negativeSyscalls\":%u,\"limitsVerified\":5,\"noNewPrivileges\":true,\"seccomp\":true}\n",checks);
  return 0;
}
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
    DENY(sendto), DENY(sendmsg), DENY(sendmmsg), DENY(recvmsg), DENY(recvmmsg),
    DENY(chmod), DENY(fchmod), DENY(fchmodat), DENY(fchmodat2), DENY(fallocate),
    DENY(fchown), DENY(fchownat), DENY(setxattr), DENY(lsetxattr), DENY(fsetxattr),
    DENY(removexattr), DENY(lremovexattr), DENY(fremovexattr), DENY(utimensat),
#if defined(__x86_64__)
    DENY(chown), DENY(lchown), DENY(utime), DENY(utimes), DENY(futimesat),
#endif
    DENY(shmget), DENY(shmat), DENY(shmdt), DENY(shmctl),
    DENY(msgget), DENY(msgsnd), DENY(msgrcv), DENY(msgctl),
    DENY(semget), DENY(semop), DENY(semtimedop), DENY(semctl),
    DENY(mq_open), DENY(mq_unlink), DENY(mq_timedsend), DENY(mq_timedreceive), DENY(mq_notify), DENY(mq_getsetattr),
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
    /* libuv needs only unnamed UNIX stream pairs; no address-bearing sends. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_socketpair, 0, 7),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, AF_UNIX, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(1)),
    BPF_STMT(BPF_ALU|BPF_AND|BPF_K, ~(SOCK_CLOEXEC|SOCK_NONBLOCK)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, SOCK_STREAM, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_ioctl, 0, 5),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, FIONBIO, 2, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, FIONREAD, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_fcntl, 0, 11),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_DUPFD, 8, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_DUPFD_CLOEXEC, 7, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_GETFD, 6, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_SETFD, 5, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_GETFL, 4, 0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, F_SETFL, 0, 2),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(2)),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, O_ASYNC, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
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
/* Test-only, credential-free real parent-death race. The grandchild is held
 * until its spawning parent has been reaped by this non-PID1 subreaper. */
static int parent_race_probe(void) {
  phase="PARENT_RACE";
  if(getpid()==1 || prctl(PR_SET_CHILD_SUBREAPER,1))fail();
  int gate[2], identity[2], status;
  if(pipe2(gate,O_CLOEXEC)||pipe2(identity,O_CLOEXEC))fail();
  pid_t parent=fork();if(parent<0)fail();
  if(!parent) {
    close(gate[1]);close(identity[0]);
    pid_t expected=getpid(),child=fork();if(child<0)fail();
    if(!child) {
      close(identity[1]);char byte;
      if(read(gate[0],&byte,1)!=1 || getppid()==expected || getppid()==1)fail();
      char value[32];snprintf(value,sizeof(value),"%d",expected);
      execl("/usr/local/bin/si-heif-confine","si-heif-confine","--group-probe",value,NULL);fail();
    }
    if(write(identity[1],&child,sizeof(child))!=sizeof(child))fail();
    _exit(0);
  }
  close(gate[0]);close(identity[1]);pid_t adopted;
  if(read(identity[0],&adopted,sizeof(adopted))!=sizeof(adopted)
    ||waitpid(parent,&status,0)!=parent||!WIFEXITED(status)||WEXITSTATUS(status))fail();
  if(write(gate[1],"x",1)!=1 || waitpid(adopted,&status,0)!=adopted
    || !WIFEXITED(status)||WEXITSTATUS(status)!=78)fail();
  close(gate[1]);close(identity[0]);
  puts("{\"status\":\"PASS\",\"actualAdoption\":true,\"nonPid1Subreaper\":true,\"rejectedExit\":78}");
  return 0;
}
int main(int argc, char **argv) {
  if (getuid() != 10001 || geteuid() != getuid() || getgid() != 10001 || getegid()!=getgid()) fail();
  if (argc == 2 && !strcmp(argv[1], "--supervise")) {supervisor_boundary();return supervise(0);}
  if (argc == 2 && !strcmp(argv[1], "--supervise-probe")) {supervisor_boundary();return supervise(1);}
  if (argc == 2 && !strcmp(argv[1], "--parent-race-probe")) return parent_race_probe();
  if(argc<3)fail();
  char *end;long expected_parent=strtol(argv[argc-1],&end,10);
  if(*end || expected_parent<1 || expected_parent>INT_MAX
    || getppid()!=expected_parent || prctl(PR_SET_PDEATHSIG,SIGKILL)
    || getppid()!=expected_parent)fail();
  if(argc==3 && !strcmp(argv[1],"--syscall-probe"))return syscall_probe();
  if(argc==3 && !strcmp(argv[1],"--fork-exhaust-probe"))return exhaustion_probe(0);
  if(argc==3 && !strcmp(argv[1],"--thread-exhaust-probe"))return exhaustion_probe(1);
  if(argc==3 && !strcmp(argv[1],"--group-probe")) {
    if(prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0)!=1 || prctl(PR_GET_SECCOMP)!=2)fail();
    printf("{\"pid\":%d,\"group\":%d,\"session\":%d}\n",getpid(),getpgrp(),getsid(0));return 0;
  }
  if(argc==4 && !strcmp(argv[1],"--fork-sleeper")) {
    if(prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0)!=1 || prctl(PR_GET_SECCOMP)!=2)fail();
    pid_t child=fork();if(child<0)fail();
    if(!child) {close(0);close(1);close(2);alarm(60);for(;;)pause();}
    printf("{\"descendant\":%d}\n",child);fflush(stdout);
    if(!strcmp(argv[2],"orphan")){usleep(200000);return 0;}
    if(strcmp(argv[2],"hold"))fail();
    alarm(60);for(;;)pause();
  }
  char *env[] = { "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "NODE_ENV=production",
    "UV_THREADPOOL_SIZE=1", "UV_USE_IO_URING=0", "MALLOC_ARENA_MAX=2", NULL };
  limit(RLIMIT_CORE, 0); limit(RLIMIT_NOFILE, 64); limit(RLIMIT_NPROC, 32);
  limit(RLIMIT_FSIZE, 128 * 1024 * 1024);
  if (argc == 5 && !strcmp(argv[1], "--native")) {
    /* This mode is useful only under the inherited parent boundary. */
    if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1 || prctl(PR_GET_SECCOMP) != 2) fail();
    limit(RLIMIT_AS, 768 * 1024 * 1024); limit(RLIMIT_CPU, 12);
    char *args[] = { "/usr/local/bin/heif-convert", "--codec-threads", "1", "--tile-threads", "0", "--png-compression-level", "1", argv[2], argv[3], NULL };
    execve(args[0], args, env); fail();
  }
  int fault=argc==5 && !strcmp(argv[1],"--fault-probe");
  if (!fault && (argc != 4 || (strcmp(argv[1], "--worker") && strcmp(argv[1], "--probe")))) fail();
  if(fault && strcmp(argv[3],"orphan") && strcmp(argv[3],"hold")
    && strcmp(argv[3],"hang") && strcmp(argv[3],"stdout") && strcmp(argv[3],"stderr")
    && strcmp(argv[3],"fork-exhaust") && strcmp(argv[3],"thread-exhaust"))fail();
  phase="WORKER_CAPABILITIES";no_capabilities();
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
    fault ? "/app/src/confinedFaultProbe.js" : !strcmp(argv[1], "--probe") ? "/app/src/confinedProbe.js" : "/app/src/confinedWorker.js", input, decoded, fault ? argv[3] : NULL, NULL };
  phase="NODE_EXEC";execve(args[0], args, env); fail();
}
