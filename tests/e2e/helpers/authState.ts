import fs from 'node:fs';
import path from 'node:path';

export const publicCreatorAuthStatePath = path.resolve(
  process.cwd(),
  'tests/e2e/.auth/public_creator.json',
);

export function ensureAuthStateDirectory(): void {
  fs.mkdirSync(path.dirname(publicCreatorAuthStatePath), { recursive: true });
}
