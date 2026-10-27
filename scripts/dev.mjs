import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
for (const [directory, args] of [
  ['frontend', [resolve(root, 'frontend/node_modules/vite/bin/vite.js')]],
  ['backend', ['--env-file-if-exists=.env', 'server/index.mjs']],
]) {
  const child = spawn(process.execPath, args, { cwd: resolve(root, directory), stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', () => { console.error(`Unable to start ${directory}. Run npm run setup first.`); void stop(1); });
  child.on('exit', code => { if (!stopping) void stop(code || 1); });
}
