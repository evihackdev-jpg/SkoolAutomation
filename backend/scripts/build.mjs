import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
if (relative(root, output) !== 'dist') throw new Error('Build output must be backend/dist.');

const modules = (await readdir(join(root, 'server'), { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
  .map(entry => entry.name);
const checkSyntax = promisify(execFile);
await Promise.all(modules.map(name => checkSyntax(process.execPath, ['--check', join(root, 'server', name)])));

// Rebuild only the generated directory. Never copy .env, certificates or node_modules.
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'server'), { recursive: true });
await mkdir(join(output, 'scripts'), { recursive: true });
for (const name of modules) await cp(join(root, 'server', name), join(output, 'server', name));
await cp(join(root, 'scripts', 'check-mongodb.mjs'), join(output, 'scripts', 'check-mongodb.mjs'));
for (const name of ['package-lock.json', '.env.example', 'deploy']) {
  await cp(join(root, name), join(output, name), { recursive: true });
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
manifest.scripts = { start: manifest.scripts.start, 'db:check': manifest.scripts['db:check'] };
await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(output, 'README.md'), `# Skool Automation backend deployment

Requires Node.js 22.12+.

Upload this directory's contents to the VPS backend directory, then run:

\`\`\`sh
npm ci --omit=dev
# On first deployment, create .env from .env.example and set your credentials.
# On later deployments, preserve the existing .env and COOKIE_ENCRYPTION_KEY.
npm run db:check
npm start
\`\`\`

Use the systemd service to keep the backend running after SSH closes.
Run one backend instance per database. The default internal API port is 3002.
The deploy/Caddyfile site block proxies the VPS HTTPS IP to this API.
Secrets, local certificates, tests and dependencies are not included in this build.
`);
console.log(`Built ${modules.length} backend modules in ${output}`);
console.log('Deploy dist contents with npm ci --omit=dev and your existing server-side .env.');
