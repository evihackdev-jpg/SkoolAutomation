import { generate } from 'selfsigned';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { X509Certificate } from 'node:crypto';
const host = process.argv[2];
if (isIP(host || '') !== 4) throw new Error('Usage: node scripts/setup-lan.mjs YOUR_LAN_IPV4');
await mkdir('.local', { recursive: true });
try { await readFile('.local/lan-key.pem'); console.log('Existing TLS key preserved. Update LAN_HOST only if the certificate covers the new address.'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const pems = await generate([{ name: 'commonName', value: host }], { keySize: 2048, algorithm: 'sha256',
    extensions: [ { name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: host }] } ] });
  await writeFile('.local/lan-key.pem', pems.private, { flag: 'wx', mode: 0o600 });
  await writeFile('.local/lan-cert.pem', pems.cert, { flag: 'wx' });
  console.log('Generated LAN certificate. The private key stays in .local/lan-key.pem.');
}
const certificate = new X509Certificate(await readFile('.local/lan-cert.pem'));
await writeFile('.local/lan-cert.cer', certificate.raw);
console.log('Share only .local/lan-cert.cer with clients. SHA-256: ' + certificate.fingerprint256);
