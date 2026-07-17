import { db } from "@/db";
import { contacts, accounts, collection_members, collections } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { findExistingContactDrizzle, isUniqueViolation } from "@/lib/contacts/dedupe.drizzle";
import { resolveImportTagIdsDrizzle } from "@/lib/contacts/resolve-import-tags.drizzle";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  segment: string | null;
  avatar_url: string | null;
  preferred_language: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

export async function resolveAuditUserIdDrizzle(
  accountId: string
): Promise<string> {
  const account = await db
    .select({ owner_user_id: accounts.owner_user_id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
    .then((res) => res[0]);

  const owner = account?.owner_user_id;
  if (!owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  segment?: string | null;
  preferred_language?: string | null;
}

export async function findOrCreateContactDrizzle(
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  const sanitized = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitized)) {
    throw new ContactError(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  const existing = await findExistingContactDrizzle(accountId, sanitized);
  if (existing) return { id: existing.id, created: false };

  let createdId: string | null = null;
  try {
    const result = await db
      .insert(contacts)
      .values({
        account_id: accountId,
        user_id: auditUserId,
        phone: sanitized,
        name: input.name ?? sanitized,
        email: input.email ?? null,
        company: input.company ?? null,
        segment: input.segment ?? null,
        preferred_language: input.preferred_language ?? 'en',
      })
      .returning({ id: contacts.id });
    createdId = result[0]?.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContactDrizzle(accountId, sanitized);
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }

  if (!createdId) throw new ContactError('Failed to create contact', 500);

  return { id: createdId, created: true };
}

export async function setContactTagsDrizzle(
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIdsDrizzle({
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  const desired = new Set(tagIdByKey.values());

  const current = await db
    .select({ collection_id: collection_members.collection_id })
    .from(collection_members)
    .where(eq(collection_members.contact_id, contactId));

  const existing = new Set(
    (current ?? []).map((r) => r.collection_id)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    await db
      .delete(collection_members)
      .where(
        and(
          eq(collection_members.contact_id, contactId),
          inArray(collection_members.collection_id, toRemove)
        )
      );
  }
  
  if (toAdd.length > 0) {
    await db
      .insert(collection_members)
      .values(toAdd.map((collection_id) => ({ contact_id: contactId, collection_id })));
  }
}

export async function getContactByIdDrizzle(
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  const contactRecord = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.account_id, accountId)
      )
    )
    .limit(1)
    .then((res) => res[0]);

  if (!contactRecord) return null;

  const tags = await db
    .select({
      id: collections.id,
      name: collections.name,
      color: collections.color,
    })
    .from(collection_members)
    .innerJoin(collections, eq(collection_members.collection_id, collections.id))
    .where(eq(collection_members.contact_id, contactId));

  return {
    id: contactRecord.id,
    phone: contactRecord.phone,
    name: contactRecord.name,
    email: contactRecord.email,
    company: contactRecord.company,
    segment: contactRecord.segment,
    avatar_url: contactRecord.avatar_url,
    preferred_language: contactRecord.preferred_language,
    tags: tags,
    created_at: contactRecord.created_at.toISOString(),
    updated_at: contactRecord.updated_at.toISOString(),
  };
}
