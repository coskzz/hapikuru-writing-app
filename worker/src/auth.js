// Firebase Authentication の IDトークン（RS256 JWT）を Worker 内で検証する。
// 公開鍵は Google が配っている JWK を取得してキャッシュする。
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedKeys = null;
let cachedUntil = 0;

async function getKeys() {
  const now = Date.now();
  if (cachedKeys && now < cachedUntil) return cachedKeys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = await res.json();
  const maxAge = Number((res.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  cachedKeys = body.keys || [];
  cachedUntil = now + Math.min(maxAge, 6 * 3600) * 1000;
  return cachedKeys;
}

function base64UrlToBytes(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

export async function verifyFirebaseIdToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("bad header");

  const keys = await getKeys();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new Error("bad signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("bad aud");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("bad iss");
  if (typeof payload.exp !== "number" || payload.exp < now - 60) throw new Error("expired");
  if (typeof payload.iat !== "number" || payload.iat > now + 300) throw new Error("bad iat");
  if (!payload.sub) throw new Error("no sub");
  return { uid: payload.sub, email: payload.email || "" };
}
