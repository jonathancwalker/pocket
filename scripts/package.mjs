import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['scripts/tauri.mjs', 'build', '--bundles', 'app']);
if (process.platform === 'darwin') {
  // Seal the whole local bundle, including resources, after Tauri packages it.
  // Ad-hoc signing needs no account/certificate and is not distribution notarization.
  const app = resolve('src-tauri/target/release/bundle/macos/Pocket.app');
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
}
