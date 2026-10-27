import { Resolver } from 'node:dns/promises';
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { MongoClient } from 'mongodb';
import { storageErrorCodes, storageErrorMessage } from '../server/storage.mjs';

// Read-only diagnostics: never print the URI, credentials, raw errors or records.
const code = error => storageErrorCodes(error).join(', ') || 'UNKNOWN';
const probe = (host, port, secure) => new Promise(resolve => {
  let socket;
  let finished = false;
  const finish = result => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket?.destroy();
    resolve(result);
  };
  const timer = setTimeout(() => finish({ ok: false, code: 'ETIMEDOUT' }), 5000);
  try {
    socket = secure ? tlsConnect({ host, port, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' }) : tcpConnect({ host, port });
    socket.once(secure ? 'secureConnect' : 'connect', () => finish({ ok: true, protocol: secure ? socket.getProtocol() : null }));
    socket.once('error', error => finish({ ok: false, code: code(error) }));
  } catch (error) { finish({ ok: false, code: code(error) }); }
});

console.log(`MongoDB diagnostics | Node ${process.version} | ${new Date().toISOString()}`);
console.log('Connection strings, credentials and saved records are not printed.');
const deadline = setTimeout(() => {
  console.log('FAIL: Overall connection check timed out. DNS or the network may be blocking the connection.');
  process.exit(1);
}, 30000);
let client;
let failed = false;
let connected = false;
try {
  if (!process.env.MONGODB_URI) throw Object.assign(new Error(), { code: 'MISSING_MONGODB_URI' });
  const uri = process.env.MONGODB_URI;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000, maxPoolSize: 1 });
  if (uri.startsWith('mongodb+srv://')) {
    const hostname = new URL(uri).hostname;
    const resolver = new Resolver({ timeout: 4000, tries: 1 });
    let records = [];
    try {
      records = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
      if (!records.length) throw Object.assign(new Error(), { code: 'ENODATA' });
      console.log(`PASS: DNS SRV lookup (${records.length} database nodes).`);
      try { await resolver.resolveTxt(hostname); console.log('PASS: DNS TXT lookup.'); }
      catch (error) { console.log(`INFO: DNS TXT lookup: ${code(error)} (a TXT record may be absent).`); }
    } catch (error) { failed = true; console.log(`FAIL: DNS SRV lookup: ${code(error)}. Check the computer's DNS resolver or get Atlas's standard non-SRV connection string.`); }
    await Promise.all(records.slice(0, 6).map(async ({ name, port }, index) => {
      // SRV targets must remain inside the configured cluster's DNS parent.
      const parent = hostname.split('.').slice(1).join('.');
      if (!parent || !name.toLowerCase().endsWith(`.${parent.toLowerCase()}`) || !Number.isInteger(port) || port < 1 || port > 65535) { failed = true; console.log(`FAIL: Node ${index + 1}: unexpected DNS target.`); return; }
      const tcp = await probe(name, port, false);
      console.log(`${tcp.ok ? 'PASS' : 'FAIL'}: Node ${index + 1} TCP port ${port}${tcp.ok ? '' : `: ${tcp.code}`}.`);
      if (!tcp.ok) { failed = true; return; }
      const tls = await probe(name, port, true);
      console.log(`${tls.ok ? 'PASS' : 'FAIL'}: Node ${index + 1} verified TLS${tls.ok ? ` (${tls.protocol})` : `: ${tls.code}`}.`);
      if (!tls.ok) failed = true;
    }));
  } else console.log('INFO: Standard MongoDB URI; checking through the database driver.');
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'skool_automation');
    await db.command({ ping: 1 });
    await db.collection('accounts').findOne({}, { projection: { _id: 1 }, maxTimeMS: 5000 });
    connected = true;
    console.log('PASS: MongoDB authenticated connection and account-collection read. No records were modified.');
  } catch (error) {
    failed = true;
    console.log(`FAIL: MongoDB driver: ${code(error)}.`);
    console.log(storageErrorMessage(error));
  }
  if (connected && failed) console.log('The database is reachable from this computer. A failed individual-node probe may indicate intermittent or partial connectivity.');
  else if (failed) console.log('Check the failing layer above. Atlas must allow the outbound public IP of this computer; a browser/VPN/proxy may use a different IP.');
} catch (error) {
  failed = true;
  console.log(`FAIL: Configuration or diagnostic check: ${code(error)}. Verify the local .env file; do not share its contents.`);
} finally {
  await client?.close();
  clearTimeout(deadline);
  process.exitCode = failed ? 1 : 0;
}
