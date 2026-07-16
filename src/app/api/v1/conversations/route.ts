// ============================================================
// GET /api/v1/conversations — list conversations (scope: conversations:read)
//
// Keyset-paginated (newest first). Filters: `?status=` (open/pending/
// closed) and `?contact_id=`. Each conversation embeds its contact +
// tags via the shared CONVERSATION_SELECT.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilterDrizzle,
  buildPage,
} from '@/lib/api/v1/pagination';
import { serializeConversation } from '@/lib/api/v1/conversations';
import { resolveAuditUserIdDrizzle } from '@/lib/api/v1/contacts.drizzle';
import type { Conversation, Contact, Tag } from '@/types';
import { db } from '@/db';
import { conversations, contacts, collection_members, collections } from '@/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');

    const whereClauses = [eq(conversations.account_id, ctx.accountId)];

    if (status) whereClauses.push(eq(conversations.status, status));
    if (contactId) whereClauses.push(eq(conversations.contact_id, contactId));

    const kf = keysetFilterDrizzle(cursor, conversations);
    if (kf) whereClauses.push(kf);

    const queryResult = await db
      .select()
      .from(conversations)
      .where(and(...whereClauses))
      .orderBy(desc(conversations.created_at), desc(conversations.id))
      .limit(limit + 1);

    const contactIds = Array.from(new Set(queryResult.map((c) => c.contact_id)));

    let allContacts: any[] = [];
    let allTags: any[] = [];
    if (contactIds.length > 0) {
      allContacts = await db
        .select()
        .from(contacts)
        .where(inArray(contacts.id, contactIds));

      allTags = await db
        .select({
          contact_id: collection_members.contact_id,
          tag: {
            id: collections.id,
            name: collections.name,
            color: collections.color,
          }
        })
        .from(collection_members)
        .innerJoin(collections, eq(collection_members.collection_id, collections.id))
        .where(inArray(collection_members.contact_id, contactIds));
    }

    const rows = queryResult.map((conv) => {
      const c = allContacts.find((contact) => contact.id === conv.contact_id);
      let contactObj: Contact | undefined;
      if (c) {
        const contactTags = allTags
          .filter((t) => t.contact_id === c.id)
          .map((t) => t.tag as Tag);
        contactObj = {
          ...c,
          tags: contactTags,
          created_at: c.created_at.toISOString(),
          updated_at: c.updated_at.toISOString(),
        } as unknown as Contact; // Type casting for serialization
      }

      return {
        ...conv,
        contact: contactObj,
        created_at: conv.created_at.toISOString(),
        updated_at: conv.updated_at.toISOString(),
        last_message_at: conv.last_message_at ? conv.last_message_at.toISOString() : null,
      } as unknown as Conversation;
    });

    const { items, nextCursor } = buildPage(rows, limit);
    return okList(items.map(serializeConversation), nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    if (!contactId) {
      return fail('bad_request', "'contact_id' is required", 400);
    }

    // Try to find open conversation
    const existing = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contact_id, contactId),
          eq(conversations.status, 'open')
        )
      )
      .limit(1)
      .then((res) => res[0]);

    if (existing) {
      const c = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).then(r => r[0]);
      let contactObj: Contact | undefined;
      if (c) {
        const tags = await db.select({ id: collections.id, name: collections.name, color: collections.color })
          .from(collection_members)
          .innerJoin(collections, eq(collection_members.collection_id, collections.id))
          .where(eq(collection_members.contact_id, c.id));
        contactObj = { ...c, tags, created_at: c.created_at.toISOString(), updated_at: c.updated_at.toISOString() } as unknown as Contact;
      }
      const existingConv = { ...existing, contact: contactObj, created_at: existing.created_at.toISOString(), updated_at: existing.updated_at.toISOString(), last_message_at: existing.last_message_at ? existing.last_message_at.toISOString() : null } as unknown as Conversation;
      return ok(serializeConversation(existingConv), 200);
    }

    const auditUserId = await resolveAuditUserIdDrizzle(ctx.accountId);

    // Create new conversation
    const newConvResult = await db
      .insert(conversations)
      .values({
        contact_id: contactId,
        account_id: ctx.accountId,
        user_id: auditUserId,
        status: 'open',
      })
      .returning();

    const newConv = newConvResult[0];

    const c = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).then(r => r[0]);
    let contactObj: Contact | undefined;
    if (c) {
      const tags = await db.select({ id: collections.id, name: collections.name, color: collections.color })
        .from(collection_members)
        .innerJoin(collections, eq(collection_members.collection_id, collections.id))
        .where(eq(collection_members.contact_id, c.id));
      contactObj = { ...c, tags, created_at: c.created_at.toISOString(), updated_at: c.updated_at.toISOString() } as unknown as Contact;
    }

    const createdConv = { ...newConv, contact: contactObj, created_at: newConv.created_at.toISOString(), updated_at: newConv.updated_at.toISOString(), last_message_at: newConv.last_message_at ? newConv.last_message_at.toISOString() : null } as unknown as Conversation;

    return ok(serializeConversation(createdConv), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
