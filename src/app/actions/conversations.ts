'use server';

import { requireRole } from '@/lib/auth/account';
import { db } from '@/db';
import { conversations, contacts, whatsapp_config } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

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
      .from(contacts)
      .leftJoin(conversations, eq(contacts.id, conversations.contact_id))
      .where(eq(contacts.account_id, ctx.accountId))
      .orderBy(sql`${conversations.last_message_at} DESC NULLS LAST`);
      
    return data.map(d => {
      if (d.conversation) {
        return {
          ...serializeDates(d.conversation),
          contact: serializeDates(d.contact),
        };
      } else {
        return {
          id: `virtual-${d.contact.id}`,
          account_id: d.contact.account_id,
          user_id: d.contact.user_id,
          contact_id: d.contact.id,
          status: 'pending',
          assigned_agent_id: null,
          unread_count: 0,
          last_message_at: null,
          created_at: d.contact.created_at?.toISOString() || null,
          updated_at: d.contact.updated_at?.toISOString() || null,
          contact: serializeDates(d.contact),
        };
      }
    });
  } catch (error: any) {
    console.error('[getConversationsAction]', error);
    throw new Error('Failed to fetch conversations');
  }
}

export async function getConversationByIdAction(id: string) {
  const ctx = await requireRole('viewer');
  
  try {
    if (id.startsWith('virtual-')) {
      const contactId = id.replace('virtual-', '');
      const data = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.account_id, ctx.accountId), eq(contacts.id, contactId)))
        .limit(1);
        
      if (data.length === 0) return null;
      const contactObj = data[0];
      return {
        id: `virtual-${contactObj.id}`,
        account_id: contactObj.account_id,
        user_id: contactObj.user_id,
        contact_id: contactObj.id,
        status: 'pending',
        assigned_agent_id: null,
        unread_count: 0,
        last_message_at: null,
        created_at: contactObj.created_at?.toISOString() || null,
        updated_at: contactObj.updated_at?.toISOString() || null,
        contact: serializeDates(contactObj),
      };
    }

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
