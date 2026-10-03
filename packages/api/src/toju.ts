/**
 * api/toju — invokes the toju-chat Edge Function. UI never calls OpenAI or
 * the function URL directly; it speaks this typed contract.
 */
import { getDb } from '@synapse/database';
import type { ChatSession, TojuChatResponse } from '@synapse/types';

export async function sendTojuMessage(
  message: string,
  sessionId?: string,
): Promise<TojuChatResponse> {
  const { data, error } = await getDb().functions.invoke<TojuChatResponse>('toju-chat', {
    body: { message, session_id: sessionId ?? null },
  });
  if (error) throw error;
  if (!data) throw new Error('toju-chat returned no data');
  return data;
}

/** Load the consumer's current Toju session (RLS scopes to the owner). */
export async function getCurrentSession(): Promise<ChatSession | null> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await db
    .from('chat_sessions')
    .select('*')
    .eq('consumer_id', auth.user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ChatSession | null) ?? null;
}
