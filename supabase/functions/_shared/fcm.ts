/**
 * fcm, pushes to the Synapse app on a phone, through Firebase Cloud Messaging (HTTP v1).
 *
 * The site's web push (VAPID) cannot reach an app: an Android or iOS web view has no PushManager. The app registers a Firebase
 * device token instead (push-subscribe stores it in push_subscriptions as endpoint "fcm:<token>", platform android or ios), and
 * this sends to it.
 *
 * SWITCHED ON BY ONE SECRET. FCM_SERVICE_ACCOUNT is the JSON key of a Firebase service account (Firebase console → Project
 * settings → Service accounts → Generate new private key). Without it fcmConfigured() is false and nothing here runs, so shipping
 * this changes nothing until the key is set. The key is a secret: it goes in Supabase secrets (the set-secret workflow), never in
 * the repository.
 */

export interface FcmPayload {
  title: string;
  body: string;
  /** Page to open when the notification is tapped, e.g. /app/property.html?id=… Must start with a single "/". */
  route?: string;
  kind?: string;
  propertyId?: string;
}

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

function account(): ServiceAccount | null {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}

export const fcmConfigured = (): boolean => account() !== null;

const b64url = (data: Uint8Array | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signingKey(pem: string): Promise<CryptoKey> {
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

let cached: { token: string; expires: number } | null = null;

/** A Google access token for the messaging scope, kept until a minute before it expires. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - 60 > now) return cached.token;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(`${head}.${claim}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  const j = await res.json() as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expires: now + (j.expires_in ?? 3600) };
  return cached.token;
}

/** The FCM v1 message for one device. Pure, so it can be tested without a network. */
export function fcmMessage(deviceToken: string, p: FcmPayload): Record<string, unknown> {
  const data: Record<string, string> = {};
  if (p.route && /^\/(?!\/)/.test(p.route)) data.route = p.route;
  if (p.kind) data.kind = p.kind;
  if (p.propertyId) data.propertyId = p.propertyId;
  return {
    message: {
      token: deviceToken,
      notification: { title: p.title, body: p.body },
      data,
      // the channel the app creates (notify.js) so the notification is shown as a heads-up, not silently
      android: { priority: 'HIGH', notification: { channel_id: 'proximity' } },
      apns: { payload: { aps: { sound: 'default' } } },
    },
  };
}

export interface FcmResult { ok: boolean; status: number; /** the device token is dead: delete it */ gone: boolean }

export async function sendFcm(deviceToken: string, p: FcmPayload): Promise<FcmResult> {
  const sa = account();
  if (!sa) return { ok: false, status: 0, gone: false };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmMessage(deviceToken, p)),
  });
  if (res.ok) return { ok: true, status: res.status, gone: false };
  const err = await res.json().catch(() => ({})) as { error?: { details?: Array<{ errorCode?: string }> } };
  const code = err.error?.details?.find((d) => d.errorCode)?.errorCode;
  return { ok: false, status: res.status, gone: res.status === 404 || code === 'UNREGISTERED' };
}
