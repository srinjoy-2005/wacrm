// ============================================================
// Outbound message send — Drizzle port.
// ============================================================

import { db } from "@/db";
import { contacts, conversations, whatsapp_config, messages } from "@/db/schema";
import { eq, and } from "drizzle-orm";

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { SendMessageError, validateSendMessageParams, MEDIA_KINDS, type SendMessageParams, type SendMessageResult } from '@/lib/whatsapp/send-message';

export async function sendMessageToConversationDrizzle(
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({ messageType, contentText, mediaUrl, templateName });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  const conversationRecord = await db
    .select({
      id: conversations.id,
      contact_id: conversations.contact_id,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.account_id, accountId)
      )
    )
    .limit(1)
    .then((res) => res[0]);

  if (!conversationRecord) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contactRecord = await db
    .select({
      id: contacts.id,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(eq(contacts.id, conversationRecord.contact_id))
    .limit(1)
    .then((res) => res[0]);

  if (!contactRecord?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contactRecord.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  const config = await db
    .select()
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

  const accessToken = decrypt(config.access_token);

  if (isLegacyFormat(config.access_token)) {
    void db
      .update(whatsapp_config)
      .set({ access_token: encrypt(accessToken) })
      .where(eq(whatsapp_config.id, config.id))
      .then(() => {})
      .catch((error: Error) => {
        console.warn('[send-message] access_token GCM upgrade failed:', error.message);
      });
  }

  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const parent = await db
      .select({ message_id: messages.message_id })
      .from(messages)
      .where(
        and(
          eq(messages.id, replyToMessageId),
          eq(messages.conversation_id, conversationId)
        )
      )
      .limit(1)
      .then((res) => res[0]);

    if (!parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    // Wait, message_templates is not migrated to Drizzle yet! (Phase 1.2 focuses on messaging, Broadcasts/Templates is Phase 1.4 or something)
    // I need to use supabaseAdmin() here for message_templates, since it hasn't been ported.
    const { data } = await supabaseAdmin()
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();

    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(`[send-message] variant "${variant}" rejected by Meta, trying next…`);
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(`[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`);
    await db
      .update(contacts)
      .set({ phone: workingPhone })
      .where(eq(contacts.id, contactRecord.id));
  }

  let insertedMessageId: string | null = null;
  try {
    const result = await db
      .insert(messages)
      .values({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: messageType,
        content_text: contentText || null,
        media_url: mediaUrl || null,
        template_name: templateName || null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .returning({ id: messages.id });
    insertedMessageId = result[0]?.id;
  } catch (msgError: any) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  if (!insertedMessageId) {
    throw new SendMessageError('db_error', 'Failed to save message to DB', 500);
  }

  await db
    .update(conversations)
    .set({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('sessions')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactRecord.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: insertedMessageId, whatsappMessageId: waMessageId };
}
