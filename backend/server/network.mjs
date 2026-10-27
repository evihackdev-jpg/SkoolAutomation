import { isIP } from 'node:net';
export function ipv4(value) {
  const address = value?.replace(/^::ffff:/, '');
  if (isIP(address || '') !== 4) return null;
  return address.split('.').reduce((number, octet) => (number * 256 + Number(octet)) >>> 0, 0);
}
export function subnetAllows(address, cidr) {
  const [network, bits, extra] = cidr.split('/');
  const value = ipv4(address);
  const base = ipv4(network);
  if (extra || !/^\d+$/.test(bits || '') || +bits < 1 || +bits > 32 || base === null) throw new Error('Invalid IPv4 subnet.');
  if (value === null) return false;
  const mask = (0xffffffff << (32 - +bits)) >>> 0;
  return (value & mask) === (base & mask);
}
