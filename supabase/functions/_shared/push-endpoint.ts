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
    // Microsoft Edge on Windows delivers Web Push through WNS, on regional
    // hosts such as wns2-par02p.notify.windows.com; without it Edge users
    // could not register at all.
    const supportedHost = EXACT_PUSH_HOSTS.has(host) ||
      host === 'push.apple.com' ||
      host.endsWith('.push.apple.com') ||
      host.endsWith('.notify.windows.com');

    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      supportedHost;
  } catch {
    return false;
  }
}
