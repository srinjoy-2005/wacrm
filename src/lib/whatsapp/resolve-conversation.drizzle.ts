// ============================================================
// Resolve (or create) the conversation for a phone number using Drizzle.
// ============================================================

import { db } from "@/db";
import { contacts, conversations, whatsapp_config } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { findExistingContactDrizzle, isUniqueViolation } from "@/lib/contacts/dedupe.drizzle";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";
import { SendMessageError } from "@/lib/whatsapp/send-message";
import { resolveAuditUserIdDrizzle, ContactError } from "@/lib/api/v1/contacts.drizzle";

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  contactCreated: boolean;
}

export async function resolveConversationByPhoneDrizzle(
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  const config = await db
    .select({ id: whatsapp_config.id })
    .from(whatsapp_config)
    .where(eq(whatsapp_config.account_id, accountId))
    .limit(1)
    .then((res) => res[0]);

  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserIdDrizzle(accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  let contactId: string = '';
  let contactCreated = false;

  const existing = await findExistingContactDrizzle(accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await db
        .update(contacts)
        .set({ name, updated_at: new Date() })
        .where(eq(contacts.id, existing.id));
    }
  } else {
    let createdId: string | null = null;
    try {
      const result = await db
        .insert(contacts)
        .values({
          account_id: accountId,
          user_id: ownerUserId,
          phone: sanitized,
          name: name || sanitized,
        })
        .returning({ id: contacts.id });
      createdId = result[0]?.id;
    } catch (createErr) {
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContactDrizzle(accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError('db_error', 'Failed to create contact', 500);
        }
      } else {
        console.error('[resolve-conversation] contact create error:', createErr);
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    }
    
    if (createdId) {
      contactId = createdId;
      contactCreated = true;
    }
  }

  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.account_id, accountId),
        eq(conversations.contact_id, contactId)
      )
    )
    .limit(1)
    .then((res) => res[0]);

  if (conv?.id) {
    return { conversationId: conv.id, contactId, contactCreated };
  }

  let newConvId: string | null = null;
  try {
    const result = await db
      .insert(conversations)
      .values({
        account_id: accountId,
        user_id: ownerUserId,
        contact_id: contactId,
      })
      .returning({ id: conversations.id });
    newConvId = result[0]?.id;
  } catch (convErr) {
    console.error('[resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }

  if (!newConvId) {
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }

  return { conversationId: newConvId, contactId, contactCreated };
}
