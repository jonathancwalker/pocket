import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const env = { ...process.env };
const tooling = resolve('.tooling');
const local = existsSync(resolve(tooling, 'cargo/bin/cargo'));
if (local) {
  env.CARGO_HOME = resolve(tooling, 'cargo');
  env.RUSTUP_HOME = resolve(tooling, 'rustup');
  env.PATH = `${env.CARGO_HOME}/bin:${env.PATH}`;
}
const child = spawn(
  local ? resolve(tooling, 'cargo/bin/cargo') : 'cargo',
  [...process.argv.slice(2)],
  { stdio: 'inherit', env },
);
child.on('exit', (code) => process.exit(code ?? 1));
