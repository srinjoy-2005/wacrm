'use server';

import { requireRole } from '@/lib/auth/account';
import { db } from '@/db';
import { contacts, collection_members, collections } from '@/db/schema';
import { eq, inArray, ilike, or, and, desc } from 'drizzle-orm';
import { resolveImportTagIdsDrizzle } from '@/lib/contacts/resolve-import-tags.drizzle';

// ----------------------------------------------------------------------------
// Contacts Server Actions
// These actions execute on the server and use Drizzle ORM to query Neon,
// bypassing the browser's direct connection to Supabase Postgres.
// ----------------------------------------------------------------------------

export async function getContactsAction(params: {
  page: number;
  pageSize: number;
  search?: string;
  tagIds?: string[];
}) {
  const ctx = await requireRole('viewer');
  const { page, pageSize, search, tagIds } = params;

  try {
    const conditions = [eq(contacts.account_id, ctx.accountId)];

    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(ilike(contacts.name, like), ilike(contacts.phone, like), ilike(contacts.email, like))!
      );
    }

    if (tagIds && tagIds.length > 0) {
      // Find all contact IDs that have at least one of these tags
      const matchingMembers = await db
        .select({ contact_id: collection_members.contact_id })
        .from(collection_members)
        .where(inArray(collection_members.collection_id, tagIds));

      const matchingContactIds = Array.from(new Set(matchingMembers.map((m) => m.contact_id)));
      if (matchingContactIds.length === 0) {
        return { data: [], total: 0 }; // Short-circuit if no tags match
      }

      conditions.push(inArray(contacts.id, matchingContactIds));
    }

    const query = db.select().from(contacts).where(and(...conditions));
    
    // Clone the query to get the total count (ignoring pagination)
    const allMatching = await query;
    const total = allMatching.length;

    // Apply pagination
    const data = await db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.created_at))
      .limit(pageSize)
      .offset(page * pageSize);

    return { data, total };
  } catch (error: any) {
    console.error('[getContactsAction]', error);
    throw new Error('Failed to fetch contacts');
  }
}

export async function getContactTagsAction(contactIds: string[]) {
  if (!contactIds || contactIds.length === 0) return [];
  const ctx = await requireRole('viewer');

  try {
    const data = await db
      .select({
        contact_id: collection_members.contact_id,
        collection_id: collection_members.collection_id,
      })
      .from(collection_members)
      .where(inArray(collection_members.contact_id, contactIds));
    return data;
  } catch (error: any) {
    console.error('[getContactTagsAction]', error);
    throw new Error('Failed to fetch contact tags');
  }
}

export async function getTagsAction() {
  const ctx = await requireRole('viewer');
  try {
    const data = await db.select().from(collections).where(eq(collections.account_id, ctx.accountId));
    return data.map(d => ({
      ...d,
      created_at: d.created_at?.toISOString() || null
    }));
  } catch (error: any) {
    console.error('[getTagsAction]', error);
    throw new Error('Failed to fetch tags');
  }
}

export async function deleteContactsAction(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const ctx = await requireRole('agent');
  
  try {
    await db
      .delete(contacts)
      .where(and(eq(contacts.account_id, ctx.accountId), inArray(contacts.id, ids)));
  } catch (error: any) {
    console.error('[deleteContactsAction]', error);
    throw new Error('Failed to delete contacts');
  }
}

export async function checkDuplicateContactAction(phone: string) {
  const ctx = await requireRole('viewer');
  try {
    const existing = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.account_id, ctx.accountId), eq(contacts.phone, phone)))
      .limit(1);
    return existing[0] || null;
  } catch (error) {
    console.error('[checkDuplicateContactAction]', error);
    return null;
  }
}

export async function upsertContactAction(data: {
  id?: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  segment?: string;
  preferred_language?: string;
  tagIds?: string[];
}) {
  const ctx = await requireRole('agent');
  
  try {
    let contactId = data.id;

    if (contactId) {
      await db
        .update(contacts)
        .set({
          name: data.name || null,
          phone: data.phone,
          email: data.email || null,
          company: data.company || null,
          segment: data.segment || null,
          preferred_language: data.preferred_language || null,
          updated_at: new Date(),
        })
        .where(and(eq(contacts.account_id, ctx.accountId), eq(contacts.id, contactId)));
    } else {
      const inserted = await db
        .insert(contacts)
        .values({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          name: data.name || null,
          phone: data.phone,
          email: data.email || null,
          company: data.company || null,
          segment: data.segment || null,
          preferred_language: data.preferred_language || null,
        })
        .returning({ id: contacts.id });
      contactId = inserted[0].id;
    }

    // Sync tags
    await db
      .delete(collection_members)
      .where(eq(collection_members.contact_id, contactId));

    if (data.tagIds && data.tagIds.length > 0) {
      const tagRows = data.tagIds.map(tid => ({
        contact_id: contactId!,
        collection_id: tid,
      }));
      await db.insert(collection_members).values(tagRows);
    }

    return contactId;
  } catch (error: any) {
    console.error('[upsertContactAction]', error);
    if (error.code === '23505') { // Postgres unique violation
      throw new Error('A contact with this phone number already exists');
    }
    throw new Error('Failed to save contact');
  }
}
