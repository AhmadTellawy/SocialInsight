import { spawn } from 'node:child_process';
import { ServiceError } from './errors.js';

const MAX_DIAGNOSTIC_BYTES = 8 * 1024;

function boundedCollector(child, onOverflow) {
  const chunks = [];
  let bytes = 0;
  return (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_DIAGNOSTIC_BYTES) {
      onOverflow();
      return;
    }
    chunks.push(chunk);
  };
}

export function runHeifConvert({
  prlimitPath,
  converterPath,
  inputPath,
  outputPath,
  tempDir,
  timeoutMs,
  spawnImpl = spawn,
}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--as=805306368',
      '--cpu=12',
      '--fsize=134217728',
      '--nproc=1',
      '--nofile=64',
      '--',
      converterPath,
      inputPath,
      outputPath,
    ];
    const child = spawnImpl(prlimitPath, args, {
      cwd: tempDir,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        TMPDIR: tempDir,
      },
    });
    let settled = false;
    let overflowed = false;
    const killProcessGroup = () => {
      if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // Fall back to the direct child below.
        }
      }
      child.kill('SIGKILL');
    };
    const killForOverflow = () => {
      overflowed = true;
      killProcessGroup();
    };
    child.stdout.on('data', boundedCollector(child, killForOverflow));
    child.stderr.on('data', boundedCollector(child, killForOverflow));

    const timer = setTimeout(killProcessGroup, timeoutMs);
    timer.unref?.();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once('error', () => finish(new ServiceError(502, 'CONVERTER_UNAVAILABLE', 'Native converter could not be started')));
    child.once('close', (code, signal) => {
      if (overflowed) {
        finish(new ServiceError(422, 'CONVERTER_OUTPUT_LIMIT', 'Native converter diagnostic output exceeded its limit'));
      } else if (signal === 'SIGKILL') {
        finish(new ServiceError(504, 'CONVERSION_TIMEOUT', 'Native conversion exceeded its resource or time limit'));
      } else if (code !== 0) {
        finish(new ServiceError(422, 'HEIF_DECODE_FAILED', 'Native HEIF decoding failed'));
      } else {
        finish();
      }
    });
  });
}
