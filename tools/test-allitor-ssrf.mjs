// B1: private/loopback classification over every IPv4 and IPv6 encoding, in the text browser and proxy.
import assert from 'node:assert/strict';
const { privateAddress, parseV6, checkUrl } = await import('../app/src/main/assets/app-integration/allitor/browser.js');
const blocked = [
  // IPv4 table
  '0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.8', '198.18.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  // ::ffff:0:0/96 mapped, dotted and hex
  '::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:127.0.0.1]', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:10.0.0.1', '::FFFF:C0A8:0101',
  // ::/96 compatible
  '::127.0.0.1', '::7f00:1', '::a9fe:a9fe', '::', '::1', '0:0:0:0:0:0:0:1',
  // NAT64
  '64:ff9b::a9fe:a9fe', '64:ff9b::127.0.0.1', '64:ff9b:1::1', '64:ff9b:1:abcd::8.8.8.8',
  // 6to4 with private embedded v4
  '2002:7f00:1::', '2002:a9fe:a9fe::1', '2002:c0a8:101::',
  // link-local by prefix length (fe80::/10 covers fe80..febf), site-local, ULA, multicast, documentation
  'fe80::1', 'fe9f::1', 'feaf::1', 'febf:ffff::1', 'fec0::1', 'feff::1', 'fc00::1', 'fdff::1', 'ff02::1', '2001:db8::1', '2001:db8:ffff::1',
  // zone id and garbage
  'fe80::1%eth0', 'not-an-ip',
];
for (const a of blocked) assert.equal(privateAddress(a), true, 'must block ' + a);
const allowed = ['8.8.8.8', '1.1.1.1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2606:4700:4700::1111', '2001:4860:4860::8888', 'fe00::1'];
for (const a of allowed) assert.equal(privateAddress(a), false, 'must allow ' + a);
assert.equal(Buffer.from(parseV6('::ffff:127.0.0.1')).toString('hex'), Buffer.from(parseV6('::ffff:7f00:1')).toString('hex'));
// URL-level: WHATWG URL normalises these to hex forms; all must be refused
for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[::127.0.0.1]/', 'http://[fe80::1]/',
  'http://[2002:7f00:1::]/', 'http://0x7f.1/', 'http://2130706433/', 'http://127.1/', 'http://0177.0.0.1/'])
  assert.throws(() => checkUrl(u), /PRIVATE/, u);
console.log('ssrf classification tests passed (' + (blocked.length + allowed.length) + ' addresses)');
