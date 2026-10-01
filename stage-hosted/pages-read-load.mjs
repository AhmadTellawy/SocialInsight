// Public, read-only Pages load probe. Run from a host separate from the Render target.
import { performance } from 'node:perf_hooks';

const base = 'https://si-pages-qa-api-20260926.onrender.com';
const routes = ['/api/pages/pages_stage_sample_26', '/api/pages?limit=20'];
const levels = [1, 10, 25, 50, 100];
const warmupMs = 15_000;
const sampleMs = 45_000;
const timeoutMs = 15_000;
const thinkMs = 150;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (sorted, p) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 10) / 10 : null;

async function waitForStageLoadMode() {
  const until = performance.now() + 9 * 60_000;
  let ready = 0;
  while (performance.now() < until) {
    try {
      const response = await fetch(base + routes[0], { signal: AbortSignal.timeout(timeoutMs) });
      await response.arrayBuffer();
      ready = response.status === 200 && !response.headers.has('ratelimit-limit') ? ready + 1 : 0;
      if (ready === 3) return;
    } catch { ready = 0; }
    await sleep(10_000);
  }
  throw new Error('Stage load mode was not ready; no measured traffic was sent');
}

async function runLevel(users) {
  const results = [];
  const start = performance.now();
  const sampleStart = start + warmupMs;
  const end = sampleStart + sampleMs;
  let routeIndex = 0;
  async function worker() {
    while (performance.now() < end) {
      const route = routes[routeIndex++ % routes.length];
      const started = performance.now();
      const measured = started >= sampleStart;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status = 0, code = '', timedOut = false;
      try {
        const response = await fetch(base + route, { signal: controller.signal, headers: { accept: 'application/json' } });
        status = response.status;
        const body = await response.text();
        if (!response.ok) {
          try { code = String(JSON.parse(body).code ?? ''); } catch { code = 'NON_JSON_ERROR'; }
        }
      } catch (error) {
        timedOut = controller.signal.aborted;
        code = timedOut ? 'TIMEOUT' : String(error?.name ?? 'NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
      }
      if (measured) results.push({ ms: performance.now() - started, status, code, timedOut, route });
      if (performance.now() < end) await sleep(thinkMs);
    }
  }
  await Promise.all(Array.from({ length: users }, worker));
  const latencies = results.map(r => r.ms).sort((a, b) => a - b);
  const errors = results.filter(r => r.status !== 200);
  const databaseErrors = errors.filter(r => /DATABASE|PRISMA|P20\d\d|CONNECTION|POOL/i.test(r.code));
  const seconds = (performance.now() - sampleStart) / 1000;
  return {
    users, warmup_seconds: warmupMs / 1000, sample_seconds: Math.round(seconds * 10) / 10,
    request_count: results.length, success_count: results.length - errors.length,
    error_count: errors.length, success_rate: results.length ? (results.length - errors.length) / results.length : 0,
    error_rate: results.length ? errors.length / results.length : 0,
    p50_ms: percentile(latencies, .5), p95_ms: percentile(latencies, .95), p99_ms: percentile(latencies, .99),
    throughput_rps: Math.round(results.length / seconds * 10) / 10,
    timeouts: results.filter(r => r.timedOut).length,
    api_errors: errors.filter(r => r.status >= 400).length,
    http_5xx: errors.filter(r => r.status >= 500).length,
    database_errors_visible_to_client: databaseErrors.length,
    status_counts: Object.fromEntries([...new Set(results.map(r => r.status || 'network'))].map(s => [s, results.filter(r => (r.status || 'network') === s).length])),
    error_codes: Object.fromEntries([...new Set(errors.map(r => r.code || 'HTTP_ERROR'))].map(c => [c, errors.filter(r => (r.code || 'HTTP_ERROR') === c).length])),
    target_cpu_percent: null, target_memory_bytes: null,
    target_metrics_note: 'Render service telemetry unavailable to this runner',
  };
}

const receipt = { kind: 'HOSTED_STAGE_PUBLIC_PAGES_READ_LOAD', target: base, generator: 'GitHub-hosted Ubuntu runner',
  started_at: new Date().toISOString(), workload: { routes, warmup_seconds: warmupMs / 1000, sample_seconds: sampleMs / 1000, think_ms: thinkMs, timeout_ms: timeoutMs }, levels: [] };
await waitForStageLoadMode();
receipt.stage_load_mode_ready_at = new Date().toISOString();
for (const users of levels) {
  const level = await runLevel(users);
  receipt.levels.push(level);
  process.stdout.write(`PAGE_LOAD_LEVEL ${JSON.stringify(level)}\n`);
}
receipt.finished_at = new Date().toISOString();
process.stdout.write(`PAGE_LOAD_RECEIPT ${JSON.stringify(receipt)}\n`);
// Keep this diagnostic read probe honest: a completed runner is not a passing
// target when its responses or latency violate the same read contract as P35.
const failed = receipt.levels.filter(level => level.request_count === 0 || level.error_count !== 0 ||
  level.timeouts !== 0 || level.database_errors_visible_to_client !== 0 ||
  level.p95_ms === null || level.p95_ms > 800);
if (failed.length) {
  process.stderr.write(`PAGE_LOAD_GATE_FAIL levels=${failed.map(level => level.users).join(',')}\n`);
  process.exitCode = 1;
}
