/**
 * api/notifications — recipient-facing reads + read-state. Creation and
 * delivery/retry are owned by the notification service (Edge Function,
 * service role) so clients only ever read their own and mark them read.
 */
import { getDb } from '@synapse/database';
import { NotificationStatus, type Notification } from '@synapse/types';

export async function listMyNotifications(limit = 50): Promise<Notification[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('recipient_id', auth.user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function unreadCount(): Promise<number> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return 0;
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', auth.user.id)
    .neq('status', NotificationStatus.READ);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(notificationId: string): Promise<void> {
  const { error } = await getDb()
    .from('notifications')
    .update({ status: NotificationStatus.READ, read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

/** Realtime: new notifications for the current user (badge + centre). */
export function subscribeToMyNotifications(
  userId: string,
  onInsert: (n: Notification) => void,
): () => void {
  const channel = getDb()
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => onInsert(payload.new as Notification),
    )
    .subscribe();
  return () => {
    void getDb().removeChannel(channel);
  };
}
