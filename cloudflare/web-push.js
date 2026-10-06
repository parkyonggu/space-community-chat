// Web Push (VAPID) without payload: the browser's service worker fetches the unread summary itself,
// so no message content ever leaves our server through the push service.
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = value => new TextEncoder().encode(value);

export async function loadVapid(getMeta, setMeta) {
  const stored = await getMeta('vapid');
  if (stored) {
    const { privateJwk, publicRaw } = JSON.parse(stored);
    const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { privateKey, publicKey: publicRaw };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  await setMeta('vapid', JSON.stringify({ privateJwk, publicRaw }));
  return { privateKey: pair.privateKey, publicKey: publicRaw };
}

async function vapidHeader(endpoint, vapid, subject) {
  const header = b64url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, text(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

// Returns 'ok', 'gone' (subscription expired: delete it) or 'error'.
export async function sendPush(endpoint, vapid, subject) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(endpoint, vapid, subject), TTL: '86400', Urgency: 'high' },
      body: new Uint8Array(0),
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    if (!response.ok) {
      console.error('Push failed:', response.status, (await response.text()).slice(0, 200));
      return 'error';
    }
    return 'ok';
  } catch (error) {
    console.error('Push request failed:', error);
    return 'error';
  }
}
