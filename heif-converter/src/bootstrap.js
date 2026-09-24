import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { ConfinedHeifConverter } from './confinedService.js';
import { loadHealthEvidence } from './health.js';
import { createConverterServer } from './server.js';
import { runStartupNativeProbe } from './startupNativeProbe.js';
import { validateProcessControl } from './processControl.js';

export function createFatalLifecycle({ getServer, stop, exit = code => process.exit(code), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let started = false, exited = false;
  const finish = () => { if (!exited) { exited = true; exit(1); } };
  return () => {
    if (started) return;
    started = true;
    // Close admission/listener synchronously; cleanup owns the bounded tail.
    const server = getServer();
    server?.close();
    server?.closeAllConnections?.();
    const deadline = setTimer(finish, 4500);
    Promise.resolve().then(stop).then(() => { clearTimer(deadline); finish(); }, () => { clearTimer(deadline); finish(); });
  };
}

export async function bootstrapConverterService(dependencies = {}) {
  const config = (dependencies.loadConfig ?? loadConfig)();
  const logger = dependencies.logger ?? console;
  await (dependencies.mkdir ?? mkdir)(config.tempRoot, { recursive: true, mode: 0o700 });
  const converter = dependencies.converter ?? new ConfinedHeifConverter({
    onDiagnostic: code => logger.info(JSON.stringify({ event: 'heif_worker_diagnostic', code })),
  });
  try {
    const initialized = await converter.initialize();
    const processControl = validateProcessControl(initialized.processControl);
    const baseHealthEvidence = await (dependencies.loadHealthEvidence ?? loadHealthEvidence)(config, {
      sharpVersions: initialized.probe.versions,
    });
    const nativeProbe = await (dependencies.runStartupNativeProbe ?? runStartupNativeProbe)(config, converter);
    const confinement = Object.freeze({
      schemaVersion: 2,
      policy: 'rlimit-nproc-v2',
      processControl,
      status: 'passed',
      checks: initialized.probe.checks,
      syscallReport: initialized.probe.syscallReport,
      envelope: Object.freeze({
        uid: 10001,
        noNewPrivileges: true,
        storage: initialized.envelope.storage.storage,
        memoryBytes: initialized.envelope.resources.memoryBytes,
        swapBytes: initialized.envelope.resources.swapBytes,
        pids: initialized.envelope.resources.pids,
        cpuQuota: initialized.envelope.resources.cpuQuota,
      }),
    });
    const healthEvidence = Object.freeze({ ...baseHealthEvidence, confinement, nativeProbe });
    logger.info(JSON.stringify({
      event: 'heif_native_startup_probe_passed',
      fixtureSet: nativeProbe.fixtureSet,
      cases: nativeProbe.cases,
      elapsedMs: nativeProbe.elapsedMs,
      confinement: { checks: confinement.checks.length, negativeSyscalls: confinement.syscallReport.negativeSyscalls },
      commit: process.env.RENDER_GIT_COMMIT ?? null,
      instance: process.env.RENDER_INSTANCE_ID ?? null,
    }));
    const server = (dependencies.createConverterServer ?? createConverterServer)({ config, converter, healthEvidence });
    converter.setFatalHandler?.(createFatalLifecycle({ getServer: () => server, stop: () => converter.stop(), exit: dependencies.exit }));
    server.listen(config.port, config.host, () => {
      logger.info(JSON.stringify({ event: 'heif_converter_started', port: config.port, protocolVersion: 2 }));
    });
    return Object.freeze({ config, converter, server, healthEvidence });
  } catch (error) {
    await converter.stop?.();
    throw error;
  }
}
