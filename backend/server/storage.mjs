// A failed connection must not take down the HTTP server. Share initialization
// across concurrent requests and retry it on the next request after failure.
export function withStorageReady(service, initialize) {
  let ready;
  const ensureReady = () => {
    ready ??= Promise.resolve().then(initialize).catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  return Object.fromEntries(['list', 'create', 'update', 'verify', 'remove'].map((method) => [method, async (...args) => {
    await ensureReady();
    return service[method](...args);
  }]));
}

export function storageErrorCodes(error) {
  const pending = [error], seen = new Set(), codes = new Set();
  while (pending.length && seen.size < 100) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const value of [item.code, item.codeName]) {
      if (typeof value === 'number' && Number.isSafeInteger(value)) codes.add(String(value));
      else if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value)) codes.add(value);
    }
    pending.push(item.cause, item.error, item.reason);
    if (item.servers instanceof Map) for (const server of item.servers.values()) pending.push(server.error);
  }
  return [...codes];
}

export function storageErrorMessage(error) {
  const codes = storageErrorCodes(error);
  if (codes.some(code => code === '18' || code === 'AuthenticationFailed')) {
    return 'MongoDB authentication failed. Check the database username and password in the server configuration, then restart the backend.';
  }
  if (codes.some(code => code === '13' || code === 'Unauthorized')) return 'MongoDB connected, but this database user lacks permission for the configured database. Check its database roles in Atlas.';
  if (codes.some(code => /TLS|SSL|CERT|ISSUER|SELF_SIGNED|VERIFY_LEAF/.test(code))) {
    return `MongoDB TLS connection failed (${codes.filter(code => /TLS|SSL|CERT|ISSUER|SELF_SIGNED|VERIFY_LEAF/.test(code)).join(', ')}). An IP access-list entry alone does not confirm connectivity. Check Atlas → Network Access for this server’s outbound public IP, cluster availability, certificate trust, system clock, and network TLS inspection. Run npm run db:check on the affected computer for diagnostics.`;
  }
  if (codes.some(code => ['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ESERVFAIL','ENODATA','ECANCELLED'].includes(code))) return 'MongoDB DNS lookup failed. Check whether this computer can resolve the cluster’s SRV and node records. Run npm run db:check for diagnostics.';
  return 'MongoDB is unavailable. Check the database connection and Atlas Network Access, then retry. The backend is running, but account storage is not ready.';
}
