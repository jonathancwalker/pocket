import { mkdtempSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform !== 'darwin') {
  throw new Error('Pocket DMGs can only be created on macOS.');
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const app = resolve('src-tauri/target/release/bundle/macos/Pocket.app');
const outputDirectory = resolve('dist');
const output = join(outputDirectory, `Pocket-${version}.dmg`);
const staging = mkdtempSync(join(tmpdir(), 'pocket-dmg-'));

try {
  run(process.execPath, ['scripts/package.mjs']);
  mkdirSync(outputDirectory, { recursive: true });
  rmSync(output, { force: true });
  cpSync(app, join(staging, basename(app)), { recursive: true });
  run('hdiutil', [
    'create',
    '-volname',
    'Pocket',
    '-srcfolder',
    staging,
    '-ov',
    '-format',
    'UDZO',
    output,
  ]);
  console.log(`\nCreated ${output}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
