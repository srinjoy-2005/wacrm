'use server';

import { requireRole } from '@/lib/auth/account';
import { db } from '@/db';
import { conversations, contacts, whatsapp_config } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';

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

export async function getConversationsAction() {
  const ctx = await requireRole('viewer');
  
  try {
    const data = await db
      .select({
        conversation: conversations,
        contact: contacts,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contact_id, contacts.id))
      .where(eq(conversations.account_id, ctx.accountId))
      .orderBy(desc(conversations.last_message_at));
      
    return data.map(d => ({
      ...serializeDates(d.conversation),
      contact: serializeDates(d.contact),
    }));
  } catch (error: any) {
    console.error('[getConversationsAction]', error);
    throw new Error('Failed to fetch conversations');
  }
}

export async function getConversationByIdAction(id: string) {
  const ctx = await requireRole('viewer');
  
  try {
    const data = await db
      .select({
        conversation: conversations,
        contact: contacts,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contact_id, contacts.id))
      .where(and(eq(conversations.account_id, ctx.accountId), eq(conversations.id, id)))
      .limit(1);
      
    if (data.length === 0) return null;
    return {
      ...serializeDates(data[0].conversation),
      contact: serializeDates(data[0].contact),
    };
  } catch (error: any) {
    console.error('[getConversationByIdAction]', error);
    throw new Error('Failed to fetch conversation');
  }
}

export async function checkWhatsAppConnectionAction() {
  const ctx = await requireRole('viewer');
  try {
    const data = await db.query.whatsapp_config.findFirst({
      where: eq(whatsapp_config.account_id, ctx.accountId),
    });
    return data?.status === 'connected';
  } catch (error: any) {
    console.error('[checkWhatsAppConnectionAction]', error);
    return false;
  }
}

export async function updateConversationAction(id: string, payload: Partial<typeof conversations.$inferInsert>) {
  const ctx = await requireRole('agent'); // or viewer if agents can update
  
  try {
    await db
      .update(conversations)
      .set(payload)
      .where(and(eq(conversations.account_id, ctx.accountId), eq(conversations.id, id)));
  } catch (error: any) {
    console.error('[updateConversationAction]', error);
    throw new Error('Failed to update conversation');
  }
}
