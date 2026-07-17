'use server';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from '@/db';
import { contacts, messages, conversations } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';


export async function getSimulatorDataAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const accountId = (session.user as any).accountId;
  if (!accountId) throw new Error('Account not found');

  // Load Contacts
  const contactsData = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(eq(contacts.account_id, accountId))
    .limit(50);

  // Load Recent Messages
  const messagesData = await db
    .select({
      id: messages.id,
      message_id: messages.message_id,
      content_text: messages.content_text,
      content_type: messages.content_type,
      created_at: messages.created_at,
      contact_phone: contacts.phone,
      contact_name: contacts.name,
    })
    .from(messages)
    .leftJoin(conversations, eq(messages.conversation_id, conversations.id))
    .leftJoin(contacts, eq(conversations.contact_id, contacts.id))
    .where(eq(messages.sender_type, 'agent'))
    .orderBy(desc(messages.created_at))
    .limit(10);

  const parsedMessages = messagesData.map(m => ({
    id: m.id,
    message_id: m.message_id,
    content_text: m.content_text || `[${m.content_type || 'Media'}]`,
    created_at: m.created_at?.toISOString() || new Date().toISOString(),
    recipient_phone: m.contact_phone || 'Unknown',
    contact_name: m.contact_name || 'Unknown'
  }));

  return {
    contacts: contactsData.map(c => ({
      id: c.id,
      name: c.name || 'Unknown',
      phone: c.phone
    })),
    recentMessages: parsedMessages
  };
}
