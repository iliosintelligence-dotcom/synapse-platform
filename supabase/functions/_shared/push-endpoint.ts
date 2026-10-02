const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
]);

/** Accept only HTTPS endpoints owned by the Web Push services we support. */
export function isSupportedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const supportedHost = EXACT_PUSH_HOSTS.has(host) ||
      host === 'push.apple.com' ||
      host.endsWith('.push.apple.com');

    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      supportedHost;
  } catch {
    return false;
  }
}
