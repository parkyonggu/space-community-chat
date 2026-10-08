// Google Play 앱(TWA, 웹사이트를 감싼 안드로이드 앱)이 이 사이트의 주인임을 확인하는 Digital Asset Links.
// 앱 서명 인증서 SHA-256 지문은 Play Console(설정 → 앱 서명)에서 확인해 wrangler.jsonc 의 ANDROID_CERT_SHA256 변수에 넣는다(공개 값).
// Play 앱 서명 키와 업로드 키처럼 여러 개면 쉼표로 이어 쓴다.
const DEFAULT_PACKAGE = 'com.withpluces.community';

function normalizeFingerprint(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 64) return null;
  return hex.match(/.{2}/g).join(':');
}

function assetLinks(env = {}) {
  const packageName = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(env.ANDROID_PACKAGE || '') ? env.ANDROID_PACKAGE : DEFAULT_PACKAGE;
  const fingerprints = [...new Set(String(env.ANDROID_CERT_SHA256 || '').split(/[,\s]+/).map(normalizeFingerprint).filter(Boolean))];
  if (!fingerprints.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }];
}

module.exports = { assetLinks, normalizeFingerprint, DEFAULT_PACKAGE };
