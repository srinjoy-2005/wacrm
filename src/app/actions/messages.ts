'use server';

import { requireRole } from '@/lib/auth/account';
import { db } from '@/db';
import { messages, conversations } from '@/db/schema';
import { eq, asc, and } from 'drizzle-orm';

function serializeDates(obj: any) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) {
      out[key] = out[key].toISOString();
    }
  }
  return out;
}

export async function getMessagesAction(conversationId: string) {
  const ctx = await requireRole('viewer');
  
  try {
    // Basic authorization check: verify the conversation belongs to this account
    const conv = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.account_id, ctx.accountId), eq(conversations.id, conversationId)))
      .limit(1);

    if (conv.length === 0) {
      throw new Error('Conversation not found or access denied');
    }

    const data = await db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conversationId))
      .orderBy(asc(messages.created_at));
      
    return data.map(serializeDates);
  } catch (error: any) {
    console.error('[getMessagesAction]', error);
    throw new Error('Failed to fetch messages');
  }
}

export async function markMessagesReadAction(conversationId: string) {
  const ctx = await requireRole('agent');
  try {
    // Only update if conversation belongs to account
    const conv = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.account_id, ctx.accountId), eq(conversations.id, conversationId)))
      .limit(1);

    if (conv.length === 0) return;

    await db
      .update(messages)
      .set({ status: 'read' })
      .where(
        and(
          eq(messages.conversation_id, conversationId),
          eq(messages.status, 'delivered')
        )
      );
  } catch (error: any) {
    console.error('[markMessagesReadAction]', error);
    throw new Error('Failed to mark messages as read');
  }
}
