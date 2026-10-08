const test = require('node:test');
const assert = require('node:assert/strict');
const { assetLinks, normalizeFingerprint } = require('./android-app');

const HEX = 'ab'.repeat(32);
test('normalizes fingerprints with or without colons', () => {
  assert.equal(normalizeFingerprint(HEX), 'AB:'.repeat(31) + 'AB');
  assert.equal(normalizeFingerprint('AB:'.repeat(31) + 'AB'), 'AB:'.repeat(31) + 'AB');
  assert.equal(normalizeFingerprint('1234'), null);
});

test('builds asset links from env', () => {
  assert.deepEqual(assetLinks({}), []);
  const links = assetLinks({ ANDROID_CERT_SHA256: `${HEX}, ${'cd'.repeat(32)}, ${HEX}` });
  assert.equal(links[0].target.package_name, 'com.withpluces.community');
  assert.equal(links[0].target.sha256_cert_fingerprints.length, 2);
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(assetLinks({ ANDROID_PACKAGE: 'bad name', ANDROID_CERT_SHA256: HEX })[0].target.package_name, 'com.withpluces.community');
});
