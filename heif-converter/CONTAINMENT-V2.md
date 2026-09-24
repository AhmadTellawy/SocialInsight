# Containment v2 candidate

Local implementation candidate, policy `rlimit-nproc-v2`, schema 2. Independent
E03/E01/E04/A03/F02 acceptance and Linux image evidence are required before release.

| Entrypoint | Fixed boundary |
|---|---|
| Image CMD `si-heif-confine --supervise` | UID/GID 10001, no capabilities, no_new_privs, hard/soft 128; broker filter before Node exec |
| Docker HEALTHCHECK `si-heif-confine --healthcheck` | Separate 128/filter lineage, strict PORT, fixed loopback GET, 2s/16KiB limit, clean environment |
| Render private service | Default TCP health only; no Start Command override; listener opens after all startup proofs/corpus |
| `--supervise-probe` | Same supervisor/filter, fixed credential-free smoke module |
| `--supervisor-process-proof` | Fixed forks/threads/readback modes under 128/filter; readback verifies inherited 128 before applying the boundary |
| Workers/helpers | One mode table and worker_gateway before dispatch: fixed identity, 32, canonical two-inode job, immutable runtime, descriptor closure, Landlock, strict seccomp |
| Provider Shell/debug/exec | Outside application lineage; UNCLAIMED availability interference, must be absent during gate capture |
| Local drivers/operational one-offs | Different real UID from 10001, or service stopped; never run an unbounded same-UID driver beside gate capture |

Worker CLI shapes are `--worker <job> <parent>`, `--probe <job> <parent>`,
`--fault-probe <job> <fixed-mode> <parent>`, `--native <job> <input> <decoded> <parent>`,
`--syscall-probe <job> <parent>`, `--group-probe <job> <parent>`,
`--native-version <job> <parent>`,
`--fault-helper <job> <fixed-mode> <parent>` and
`--worker-process-probe <job> <forks|threads|readback> <parent>`.
All old helper forms reject with 78. After the gateway, a fixed diagnostic
`CONFINEMENT_GATEWAY:32_LANDLOCK_SECCOMP` records completion before dispatch; it
is diagnostic evidence, never an input token or an authorization predicate.

Production startup runs serial fork/thread probes at 128 and 32. Each proves
limits, positive bounded task creation and EAGAIN, denial of raises/identity/
namespaces/other-PID limits, fork and fixed-helper exec inheritance, and reaping.
The orchestrator checks PID/OOM counters and an empty temporary root after each.
Public output is the exact backend allowlist; attribution is always UNCLAIMED.
Native-version execution also enters the worker gateway. Startup metadata and
alpha checks run inside the confined conversion worker and return bounded
verification fields; the broker has no Sharp import or fallback.

Fatal failures stop admission and close the listener immediately, abort the active
job, and exit nonzero after cleanup or a 4.5s deadline. The native supervisor owns
adopted-descendant cleanup. Ordinary validated 4xx/429 errors do not trigger exit.

Linux verification includes strict compilation of `native/confine.c` and
`test/native-port-parser.c`; set `SI_NATIVE_PORT_TEST_BINARY` to the latter for
the shared table parity test. The smoke module includes direct-broker entrypoint
and legacy rejection matrices, the mandatory process proof, confinement negatives,
fault cleanup, and the native corpus. Unit tests alone cannot verify kernel behavior.

Before hosted acceptance record canonical PORT, actual listener and advertised
private port; they must agree. PORT defaults to 8080 only when absent. The currently
intended Render port is 10000, which is a target fact and not a successful bind.
HOST overrides are rejected. Keep HEIF admission disabled until all release gates.
