import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const local = resolve('.tooling');
const env = { ...process.env };
if (existsSync(resolve(local, 'cargo/bin/cargo'))) {
  env.CARGO_HOME = resolve(local, 'cargo');
  env.RUSTUP_HOME = resolve(local, 'rustup');
  env.PATH = `${env.CARGO_HOME}/bin:${env.PATH}`;
}
const child = spawn(resolve('node_modules/.bin/tauri'), process.argv.slice(2), {
  stdio: 'inherit',
  env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
