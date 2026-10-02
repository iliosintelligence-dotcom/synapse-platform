import { isSupportedPushEndpoint } from './push-endpoint.ts';

Deno.test('accepts supported Web Push providers', () => {
  for (
    const endpoint of [
      'https://fcm.googleapis.com/fcm/send/subscription-token',
      'https://updates.push.services.mozilla.com/wpush/v2/subscription-token',
      'https://web.push.apple.com/subscription-token',
      'https://subdomain.push.apple.com/subscription-token',
    ]
  ) {
    if (!isSupportedPushEndpoint(endpoint)) {
      throw new Error(`Expected supported endpoint: ${endpoint}`);
    }
  }
});

Deno.test('rejects arbitrary hosts and unsafe URL variants', () => {
  for (
    const endpoint of [
      'https://attacker.example/subscription-token',
      'https://fcm.googleapis.com.attacker.example/subscription-token',
      'http://fcm.googleapis.com/subscription-token',
      'https://user@fcm.googleapis.com/subscription-token',
      'https://fcm.googleapis.com:8443/subscription-token',
      'not a URL',
    ]
  ) {
    if (isSupportedPushEndpoint(endpoint)) {
      throw new Error(`Expected rejected endpoint: ${endpoint}`);
    }
  }
});
