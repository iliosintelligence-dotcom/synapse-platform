import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { fcmConfigured, fcmMessage } from './fcm.ts';

Deno.test('the message carries the title, the body, and only a same-site route', () => {
  const m = fcmMessage('tok', { title: 'A home right where you are', body: 'Bodija · 120m away', route: '/app/property.html?id=1', kind: 'proximity_match', propertyId: '1' }) as {
    message: { token: string; notification: { title: string; body: string }; data: Record<string, string>; android: { notification: { channel_id: string } } };
  };
  assertEquals(m.message.token, 'tok');
  assertEquals(m.message.notification, { title: 'A home right where you are', body: 'Bodija · 120m away' });
  assertEquals(m.message.data, { route: '/app/property.html?id=1', kind: 'proximity_match', propertyId: '1' });
  assertEquals(m.message.android.notification.channel_id, 'proximity');
});

Deno.test('a route that could leave the site is not sent', () => {
  for (const route of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', 'property.html']) {
    const m = fcmMessage('tok', { title: 't', body: 'b', route }) as { message: { data: Record<string, string> } };
    assertEquals('route' in m.message.data, false);
  }
});

Deno.test('with no service account configured nothing is sent', () => {
  Deno.env.delete('FCM_SERVICE_ACCOUNT');
  assertEquals(fcmConfigured(), false);
});
