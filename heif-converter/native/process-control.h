/* Fixed policies only. Included after the strict worker filter. */
static void broker_filter(void) {
#if defined(__x86_64__)
  const unsigned arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
  const unsigned arch = AUDIT_ARCH_AARCH64;
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
    DENY(unshare), DENY(setns), DENY(setuid), DENY(setgid),
    DENY(setreuid), DENY(setregid), DENY(setresuid), DENY(setresgid),
    DENY(setfsuid), DENY(setfsgid), DENY(setgroups), DENY(capset),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone3, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|ENOSYS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, CLONE_NEWCGROUP|CLONE_NEWIPC|CLONE_NEWNET|CLONE_NEWNS|CLONE_NEWPID|CLONE_NEWTIME|CLONE_NEWUSER|CLONE_NEWUTS|CLONE_PARENT|CLONE_UNTRACED, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_prlimit64, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARGLO(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 0, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { .len=sizeof(filter)/sizeof(filter[0]), .filter=filter };
  if(syscall(SYS_seccomp,SECCOMP_SET_MODE_FILTER,0,&program))fail();
}

static void validate_port(char result[6]) {
  phase="PORT";
  if(getenv("HOST"))fail();
  const char *value=getenv("PORT");
  if(!value)value="8080";
  size_t length=strlen(value);
  if(length<1||length>5||value[0]<'1'||value[0]>'9')fail();
  unsigned port=0;
  for(size_t i=0;i<length;i++) {
    if(value[i]<'0'||value[i]>'9')fail();
    port=port*10+(unsigned)(value[i]-'0');
  }
  if(port>65535)fail();
  memcpy(result,value,length+1);
}

static void healthcheck(void) {
  char port[6],setting[11];validate_port(port);
  supervisor_boundary();
  immutable("/app/src/fixedHealthcheck.js");immutable("/app/src/port.js");
  immutable("/usr/local/bin/node");
  if(snprintf(setting,sizeof(setting),"PORT=%s",port)>=(int)sizeof(setting)||clearenv())fail();
  if(syscall(SYS_close_range,3,~0U,0))fail();
  broker_filter();
  char *env[]={setting,"LANG=C.UTF-8","LC_ALL=C.UTF-8","TZ=UTC","NODE_ENV=production",
    "UV_THREADPOOL_SIZE=1","UV_USE_IO_URING=0","MALLOC_ARENA_MAX=2",NULL};
  char *args[]={"/usr/local/bin/node","--max-old-space-size=32","--v8-pool-size=1","/app/src/fixedHealthcheck.js",NULL};
  execve(args[0],args,env);fail();
}

static void exact_nproc(unsigned ceiling) {
  struct rlimit r;
  if(getrlimit(RLIMIT_NPROC,&r)||r.rlim_cur!=ceiling||r.rlim_max!=ceiling)fail();
}
static void expect_eperm(long result) {if(result!=-1||errno!=EPERM)fail();}
static void process_negatives(unsigned ceiling) {
  struct rlimit raise={ceiling+1,ceiling+1};
  errno=0;expect_eperm(setrlimit(RLIMIT_NPROC,&raise));
  errno=0;expect_eperm(prlimit(0,RLIMIT_NPROC,&raise,NULL));
  errno=0;expect_eperm(prlimit(getppid(),RLIMIT_NPROC,NULL,&raise));
  errno=0;expect_eperm(syscall(SYS_setuid,10001));
  errno=0;expect_eperm(syscall(SYS_setgid,10001));
  errno=0;expect_eperm(syscall(SYS_setgroups,0,NULL));
  errno=0;expect_eperm(syscall(SYS_setreuid,10001,10001));
  errno=0;expect_eperm(syscall(SYS_setregid,10001,10001));
  errno=0;expect_eperm(syscall(SYS_setresuid,10001,10001,10001));
  errno=0;expect_eperm(syscall(SYS_setresgid,10001,10001,10001));
  errno=0;expect_eperm(syscall(SYS_setfsuid,10001));
  errno=0;expect_eperm(syscall(SYS_setfsgid,10001));
  struct __user_cap_header_struct header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};
  struct __user_cap_data_struct caps[2]={{0},{0}};
  errno=0;expect_eperm(syscall(SYS_capset,&header,caps));
  errno=0;expect_eperm(syscall(SYS_unshare,0));
  errno=0;expect_eperm(syscall(SYS_setns,-1,0));
  const unsigned flags[]={CLONE_NEWUSER,CLONE_NEWPID,CLONE_NEWCGROUP,CLONE_NEWNS,
    CLONE_NEWNET,CLONE_NEWIPC,CLONE_NEWUTS,CLONE_NEWTIME};
  for(unsigned i=0;i<sizeof(flags)/sizeof(flags[0]);i++) {
    errno=0;expect_eperm(syscall(SYS_clone,flags[i]|SIGCHLD,NULL,NULL,NULL,0));
  }
  errno=0;
  if(syscall(SYS_clone3,NULL,0)!=-1||errno!=ENOSYS)fail();
  if(ceiling==32) {
    errno=0;expect_eperm(syscall(SYS_setsid));
    errno=0;expect_eperm(syscall(SYS_setpgid,0,0));
    raise.rlim_cur=128;raise.rlim_max=128;
    errno=0;expect_eperm(setrlimit(RLIMIT_NPROC,&raise));
  }
  exact_nproc(ceiling);
}

static atomic_int proof_release;
static void *proof_thread(void *unused) {
  (void)unused;
  while(!atomic_load(&proof_release)){struct timespec t={0,1000000};nanosleep(&t,NULL);}
  return NULL;
}
static void process_inheritance(unsigned ceiling,const char *job) {
  pid_t expected=getpid(),child=fork();if(child<0)fail();
  if(!child) {
    if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=expected)fail();
    exact_nproc(ceiling);
    char parent[32];snprintf(parent,sizeof(parent),"%d",expected);
    if(ceiling==128)execl("/usr/local/bin/si-heif-confine","si-heif-confine","--supervisor-process-proof","readback",parent,NULL);
    else execl("/usr/local/bin/si-heif-confine","si-heif-confine","--worker-process-probe",job,"readback",parent,NULL);
    fail();
  }
  int status;
  if(waitpid(child,&status,0)!=child||!WIFEXITED(status)||WEXITSTATUS(status)!=0)fail();
  if(ceiling==32) {
    child=fork();if(child<0)fail();
    if(!child) {
      if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=expected)fail();
      execl("/usr/local/bin/si-heif-confine","si-heif-confine","--supervise",NULL);fail();
    }
    if(waitpid(child,&status,0)!=child||!WIFEXITED(status)||WEXITSTATUS(status)!=78)fail();
  }
}
static int process_proof(unsigned ceiling,int threads,const char *job) {
  phase="PROCESS_PROOF";alarm(8);
  exact_nproc(ceiling);process_negatives(ceiling);process_inheritance(ceiling,job);
  int pipefd[2];if(pipe2(pipefd,O_CLOEXEC))fail();
  pid_t children[129];pthread_t workers[129];unsigned count=0;int error=0;
  pthread_attr_t attr;
  if(pthread_attr_init(&attr)||pthread_attr_setstacksize(&attr,128*1024))fail();
  atomic_store(&proof_release,0);
  for(;count<=ceiling;count++) {
    if(threads){error=pthread_create(&workers[count],&attr,proof_thread,NULL);if(error)break;}
    else {
      pid_t expected=getpid(),child=fork();if(child<0){error=errno;break;}
      if(!child) {
        if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=expected)fail();
        exact_nproc(ceiling);close(pipefd[1]);char byte;
        ssize_t n;do{n=read(pipefd[0],&byte,1);}while(n<0&&errno==EINTR);
        _exit(n==0?0:78);
      }
      children[count]=child;
    }
  }
  pthread_attr_destroy(&attr);close(pipefd[0]);close(pipefd[1]);atomic_store(&proof_release,1);
  for(unsigned i=0;i<count;i++) {
    if(threads){if(pthread_join(workers[i],NULL))fail();}
    else {int status;if(waitpid(children[i],&status,0)!=children[i]||!WIFEXITED(status)||WEXITSTATUS(status))fail();}
  }
  if(error!=EAGAIN||count<1||count>ceiling)fail();
  exact_nproc(ceiling);alarm(0);
  printf("{\"limit\":%u,\"soft\":%u,\"hard\":%u,\"created\":%u,\"kind\":\"%s\",\"error\":\"EAGAIN\",\"raiseDenied\":true,\"inheritancePassed\":true,\"escapeDenied\":true,\"cleanupPassed\":true,\"gatewayInstalled\":true}\n",ceiling,ceiling,ceiling,count,threads?"threads":"forks");
  return 0;
}
