import { createServer } from 'node:http';
import { MongoClient } from 'mongodb';
import { createAccountsService, encryptionKey } from './accounts.mjs';
import { createIdentity, ownerCollection, LOCAL_OWNER } from './identity.mjs';
import { createGateway } from './gateway.mjs';
import { createDiscovery } from './discovery.mjs';
import { createJoin, createRandomAccount, createMembershipCheck } from './join.mjs';
import { createMemberships } from './memberships.mjs';
import { createLanServer } from './lan.mjs';
import { createAI, createSurveyAnswers } from './ai.mjs';
import { createAutomation } from './automation.mjs';
import { createPublishing } from './publishing.mjs';
import { createProfileSettings, membershipFacts } from './profile-settings.mjs';
import { createBulkJoin } from './bulk-join.mjs';
import { createPublishedPosts } from './published-posts.mjs';
import { runtimeConfig } from './config.mjs';

let client;
const servers = [];
try {
  let runtime;
  try { runtime = runtimeConfig(); } catch (error) { console.error(error.message); throw new Error('Invalid server configuration'); }
  const key = encryptionKey(process.env.COOKIE_ENCRYPTION_KEY);
  if (!process.env.MONGODB_URI) throw new Error('Missing MongoDB configuration');
  const { port } = runtime;
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  const db = client.db(process.env.MONGODB_DB || 'skool_automation');
  const collection = db.collection('accounts');
  const identity = createIdentity(db);
  const runs = db.collection('automation_runs');
  const publications = db.collection('automation_publications');
  const settings = db.collection('automation_settings');
  const bulkJobs = db.collection('bulk_join_jobs');
  const ai = createAI();
  const answerSurvey = createSurveyAnswers(ai);
  const serviceCache = new Map();
  let recovered = false;
  let ready;
  const initialize = () => ready ??= (async () => {
    await client.connect();
    await collection.updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: LOCAL_OWNER } });
    await collection.createIndex({ ownerId: 1, identifierKey: 1 }, { unique: true });
    try { await collection.dropIndex('identifierKey_1'); } catch (error) { if (error.code !== 27 && error.code !== 26) throw error; }
    await identity.initialize();
    if (!recovered) {
      await publications.updateMany({ status: 'sending' }, { $set: { status: 'unconfirmed' } });
      await runs.createIndex({ ownerId: 1 }, { unique: true, partialFilterExpression: { active: true } });
      await runs.createIndex({ ownerId: 1, createdAt: -1 });
      await publications.createIndex({ ownerId: 1, status: 1, createdAt: -1, _id: -1 });
      await bulkJobs.createIndex({ownerId:1},{unique:true,partialFilterExpression:{active:true}});
      await bulkJobs.createIndex({ownerId:1,createdAt:-1});
      for (const run of await runs.find({ active: true }).toArray()) await services(run.ownerId).automation.resume(run);
      for (const job of await bulkJobs.find({active:true}).toArray()) await services(job.ownerId).bulkJoin.resume(job);
      recovered = true;
    }
  })().catch(error => { ready = undefined; throw error; });
  const services = (ownerId) => {
    if (serviceCache.has(ownerId)) return serviceCache.get(ownerId);
    const scoped = ownerCollection(collection, ownerId);
    const joinAction = createJoin(scoped, key, fetch, answerSurvey);
    const join = async body => joinAction({ ...body, facts: membershipFacts(await settings.findOne({ _id: ownerId }), body?.accountId) });
    const discovery = createDiscovery(scoped, key);
    const memberships = createMemberships(scoped, key);
    const bulkJoin = createBulkJoin({jobs:bulkJobs,ownerId,accounts:scoped,discovery,memberships,join,shouldYield:async()=>Boolean(await runs.findOne({ownerId,active:true}))});
    const automation = createAutomation({ runs, publications, settings, ownerId, accounts: scoped, discovery, memberships, join, publishing: createPublishing(scoped, key), ai, configured: Boolean(process.env.OPENROUTER_API_KEY) });
    const result = { accounts: createAccountsService(scoped, key), discovery, join, bulkJoin, membershipCheck: createMembershipCheck(scoped,key), randomAccount: createRandomAccount(scoped), memberships, automation, publishedPosts: createPublishedPosts({ publications, accounts: scoped, runs, ownerId }), profileSettings: createProfileSettings(settings, scoped, ownerId) };
    serviceCache.set(ownerId, result);
    return result;
  };
  // Resume durable active runs even when no browser has requested the API yet.
  const recoveryTimer = setInterval(() => { if (server.listening) void initialize().catch(() => {}); }, 30000);
  recoveryTimer.unref();
  const server = createServer(createGateway({ identity, initialize, services, config: runtime.config, localOwner: runtime.localOwner }));
  server.requestTimeout = 30_000;
  server.on('error', error => {
    const hint = error.code === 'EADDRINUSE'
      ? 'The address/port is already in use. Check for an existing backend service before starting another instance.'
      : error.code === 'EADDRNOTAVAIL'
        ? 'API_HOST is not assigned to this machine. Use API_HOST=127.0.0.1 behind the VPS reverse proxy.'
        : error.code === 'EACCES'
          ? 'Permission denied when binding the API address/port. Check OS permissions and API_PORT.'
          : 'Check API_HOST, API_PORT and operating system network settings.';
    console.error(`Account API could not listen on ${runtime.host}:${port} (${error.code || 'UNKNOWN'}). ${hint}`);
    process.exitCode = 1;
  });
  server.listen(port, runtime.host, () => { console.log(`Account API: http://${runtime.host}:${port}`); void initialize().catch(() => {}); });
  servers.push(server);
  if (process.env.LAN_HOST) {
    const host = process.env.LAN_HOST;
    const lanPort = Number(process.env.LAN_PORT || 5174);
    if (!Number.isInteger(lanPort) || lanPort < 1024 || lanPort > 65535) throw new Error('Invalid LAN_PORT');
    const config = { port: lanPort, hosts: [`${host}:${lanPort}`], origins: [`https://${host}:${lanPort}`] };
    const lan = await createLanServer({ host, port: lanPort, cidr: process.env.LAN_CIDR,
      certPath: process.env.LAN_TLS_CERT, keyPath: process.env.LAN_TLS_KEY, staticDir: process.env.LAN_STATIC_DIR, config,
      api: createGateway({ identity, initialize, services, config, localOwner: false }) });
    lan.requestTimeout = 30_000;
    lan.on('error', () => { console.error('LAN server could not listen. Check LAN_HOST and LAN_PORT.'); });
    lan.listen(lanPort, host, () => console.log(`Private workspaces: https://${host}:${lanPort} (${process.env.LAN_CIDR})`));
    servers.push(lan);
  }
  const stop = async () => {
    clearInterval(recoveryTimer);
    await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); })));
    await client.close(); process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch {
  console.error('Startup failed. Check MongoDB, encryption key, ports and LAN TLS configuration. Credentials are not logged.');
  for (const server of servers) server.close();
  await client?.close(); process.exitCode = 1;
}
