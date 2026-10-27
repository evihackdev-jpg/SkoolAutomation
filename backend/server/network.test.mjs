import test from 'node:test';
import assert from 'node:assert/strict';
import { subnetAllows } from './network.mjs';
test('subnet access admits the intended /24 and rejects adjacent and malformed addresses', () => {
  for (const ip of ['192.168.138.1', '192.168.138.206', '192.168.138.254', '::ffff:192.168.138.25']) assert.equal(subnetAllows(ip, '192.168.138.0/24'), true);
  for (const ip of ['192.168.137.25', '192.168.139.1', '127.0.0.1', '::1', 'evil.example', '192.168.138.999']) assert.equal(subnetAllows(ip, '192.168.138.0/24'), false);
  assert.throws(() => subnetAllows('192.168.138.1', '0.0.0.0/0'));
  assert.throws(() => subnetAllows('192.168.138.1', '192.168.138.0/33'));
});
