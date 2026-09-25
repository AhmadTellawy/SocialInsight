import fs from 'node:fs/promises';
import path from 'node:path';
import { ServiceError } from './errors.js';

export const TEMP_ROOT = '/tmp/heif-converter';
const unavailable = (phase) => Object.assign(new ServiceError(503, 'CONFINEMENT_UNAVAILABLE', 'Image processing is unavailable'), phase ? { phase } : {});
const positive = value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
const counter = value => /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value));
export function parseCounters(text, required) {
  const result = {};
  for (const line of text.trim().split('\n')) {
    const fields = line.split(' ');
    if (fields.length !== 2 || !/^[a-z_]+$/.test(fields[0]) || !counter(fields[1])
      || Object.hasOwn(result, fields[0])) throw unavailable('RESOURCE_COUNTERS');
    result[fields[0]] = Number(fields[1]);
  }
  if (required.some(key => !Object.hasOwn(result, key))) throw unavailable('RESOURCE_COUNTERS');
  return result;
}
export async function readResourceCounters(resources, io = fs) {
  const snapshots = [];
  for (const paths of resources.counterPaths) {
    const current = (await io.readFile(paths.pidsCurrentPath, 'utf8')).trim();
    if (!counter(current)) throw unavailable('RESOURCE_COUNTERS');
    const pids = parseCounters(await io.readFile(paths.pidsEventsPath, 'utf8'), ['max']);
    const memory = parseCounters(await io.readFile(paths.memoryEventsPath, 'utf8'), ['oom', 'oom_kill']);
    snapshots.push({ pidsCurrent: Number(current), pidsMaxEvents: pids.max, oom: memory.oom, oomKill: memory.oom_kill });
  }
  return snapshots;
}
export async function verifyResourceCounters(resources, io = fs) {
  const now = await readResourceCounters(resources, io);
  if (now.length !== resources.counterBaselines.length || now.some((v, i) =>
    ['pidsCurrent', 'pidsMaxEvents', 'oom', 'oomKill'].some(k => v[k] !== resources.counterBaselines[i][k]))) throw unavailable('RESOURCE_COUNTERS');
  return now;
}

export async function verifyTempRoot(io = fs, { empty = true } = {}) {
  if (await io.realpath(TEMP_ROOT) !== TEMP_ROOT) throw unavailable();
  for (const name of ['/', '/tmp', TEMP_ROOT]) {
    const item = await io.lstat(name);
    if (!item.isDirectory() || item.isSymbolicLink()) throw unavailable();
    if (name === TEMP_ROOT && (item.uid !== 10001 || (item.mode & 0o777) !== 0o700)) throw unavailable();
  }
  if (empty && (await io.readdir(TEMP_ROOT)).length) throw unavailable();
  const disk = await io.statfs(TEMP_ROOT, { bigint: true });
  if (disk.bavail * disk.bsize < 160n * 1024n * 1024n || disk.ffree < 4n) throw unavailable();
  return { privateRoot: true, emptyRoot: empty, minimumFreeBytes: 160 * 1024 * 1024, storage: 'bounded-two-inode' };
}

export async function verifyResourceEnvelope(io = fs) {
  const memberships = (await io.readFile('/proc/self/cgroup', 'utf8')).trim().split('\n');
  const unified = memberships.filter(line => line.startsWith('0::'));
  const membership = unified.length === 1 ? unified[0].slice(3) : undefined;
  const mounts = (await io.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').filter(line => line.includes(' - cgroup2 '));
  if (!membership || mounts.length !== 1) throw unavailable('CGROUP_LAYOUT');
  const fields = mounts[0].split(' ');
  const root = fields[3];
  const mount = fields[4];
  if ([membership, root, mount].some(value => !value.startsWith('/') || value.includes('\\') || path.posix.normalize(value) !== value)) throw unavailable();
  const relative = path.posix.relative(root, membership);
  if (relative.startsWith('..') || path.posix.isAbsolute(relative)) throw unavailable();
  let current = path.posix.join(mount, relative);
  let memory = Infinity;
  let pids = Infinity;
  let swap = Infinity;
  let cpu = Infinity;
  const counterPaths = [];
  for (;;) {
    const read = async name => (await io.readFile(`${current}/${name}`, 'utf8')).trim();
    for (const [name, set] of [
      ['memory.max', number => { memory = Math.min(memory, number); }],
      ['pids.max', number => { pids = Math.min(pids, number); }],
    ]) {
      const value = await read(name);
      if (name === 'pids.max' && value === 'max') throw unavailable('PIDS_LIMIT');
      if (value !== 'max') {
        if (!positive(value)) throw unavailable();
        set(Number(value));
      }
    }
    const swapValue = await read('memory.swap.max');
    if (swapValue !== 'max') {
      if (!/^[0-9]+$/.test(swapValue) || !Number.isSafeInteger(Number(swapValue))) throw unavailable();
      swap = Math.min(swap, Number(swapValue));
    }
    const [quota, period, ...extra] = (await read('cpu.max')).split(/\s+/);
    if (extra.length || !positive(period) || (quota !== 'max' && !positive(quota))) throw unavailable();
    if (quota !== 'max') cpu = Math.min(cpu, Number(quota) / Number(period));
    for (const name of ['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max']) {
      let writable;
      try { writable = await io.open(`${current}/${name}`, 1); } // O_WRONLY; never truncate or write.
      catch (error) { if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw unavailable('CGROUP_WRITABLE'); }
      if (writable) { await writable.close(); throw unavailable('CGROUP_WRITABLE'); }
    }
    counterPaths.push(Object.freeze({
      pidsCurrentPath: `${current}/pids.current`, pidsEventsPath: `${current}/pids.events`, memoryEventsPath: `${current}/memory.events`,
    }));
    if (current === mount) break;
    const parent = path.posix.dirname(current);
    if (parent === current || !parent.startsWith(mount)) throw unavailable();
    current = parent;
  }
  if (!Number.isFinite(memory) || memory > 512 * 1024 * 1024 || memory < 256 * 1024 * 1024) throw unavailable('MEMORY_LIMIT');
  if (swap !== 0) throw unavailable('SWAP_LIMIT');
  if (!Number.isSafeInteger(pids) || pids < 1) throw unavailable('PIDS_LIMIT');
  if (!Number.isFinite(cpu) || cpu < 0.1) throw unavailable('CPU_LIMIT');
  const eventsPath = path.posix.join(mount, relative, 'memory.events');
  const events = parseCounters(await io.readFile(eventsPath, 'utf8'), ['oom', 'oom_kill']);
  const counterBaselines = await readResourceCounters({ counterPaths }, io);
  return Object.freeze({
    memoryBytes: memory,
    swapBytes: swap,
    pids,
    cpuQuota: cpu,
    counterPaths: Object.freeze(counterPaths),
    counterBaselines: Object.freeze(counterBaselines.map(Object.freeze)),
    memoryEventsPath: eventsPath,
    oom: Number(events.oom),
    oomKill: Number(events.oom_kill),
  });
}

export async function verifyBootstrap({ io = fs, supervisorMode = '--supervise' } = {}) {
  let phase = 'IDENTITY';
  try {
    if (process.platform !== 'linux' || process.getuid() !== 10001 || process.geteuid() !== 10001
      || process.getgid() !== 10001 || process.getegid() !== 10001) throw unavailable();
    phase = 'CAPABILITIES';
    const status = await io.readFile('/proc/self/status', 'utf8');
    for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb']) {
      if (!new RegExp(`^${name}:\\s+0+$`, 'm').test(status)) throw unavailable();
    }
    if (!/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status)) throw unavailable();
    phase = 'PROCESS_LIMIT';
    const limits = await io.readFile('/proc/self/limits', 'utf8');
    if (!/^Max processes\s+128\s+128\s+processes[ \t]*$/m.test(limits)) throw unavailable();
    phase = 'SUPERVISOR';
    const parent = process.ppid;
    if (await io.readlink(`/proc/${parent}/exe`) !== '/usr/local/bin/si-heif-confine') throw unavailable();
    const argv = (await io.readFile(`/proc/${parent}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    if (argv.length !== 2 || argv[1] !== supervisorMode) throw unavailable();
    phase = 'STORAGE';
    const storage = await verifyTempRoot(io);
    phase = 'RESOURCES';
    const resources = await verifyResourceEnvelope(io);
    if (process.ppid !== parent) throw unavailable();
    return Object.freeze({ storage, resources });
  } catch (cause) {
    const error = unavailable();
    const resourcePhases = ['CGROUP_LAYOUT', 'MEMORY_LIMIT', 'SWAP_LIMIT', 'PIDS_LIMIT', 'CPU_LIMIT'];
    error.phase = resourcePhases.includes(cause?.phase) ? cause.phase : phase;
    throw error;
  }
}
