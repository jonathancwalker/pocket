import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function render(source, ...args) {
  const result = spawnSync(process.execPath, ['scripts/tauri.mjs', 'icon', source, ...args], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon generation failed: ${result.status}`);
}

const icons = 'src-tauri/icons';
const temporary = mkdtempSync(join(tmpdir(), 'pocket-icons-'));
try {
  render(`${icons}/source.svg`, '--output', icons, '--ios-color', '#c99577');
  render(`${icons}/source.svg`, '--output', temporary, '--png', '1024');
  copyFileSync(join(temporary, '1024x1024.png'), `${icons}/source.png`);
  render(`${icons}/tray.svg`, '--output', temporary, '--png', '64');
  copyFileSync(join(temporary, '64x64.png'), `${icons}/tray.png`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
