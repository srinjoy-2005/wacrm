import { db } from "@/db";
import { collections, collection_members } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_TAG_COLOR = '#3b82f6';

export interface ResolveImportTagsResult {
  tagIdByKey: Map<string, string>;
  skippedNames: string[];
}

export async function resolveImportTagIdsDrizzle(
  params: {
    accountId: string;
    userId: string;
    tagNames: string[];
    canCreateTags: boolean;
    defaultColor?: string;
  }
): Promise<ResolveImportTagsResult> {
  const { accountId, userId, tagNames, canCreateTags } = params;
  const defaultColor = params.defaultColor ?? DEFAULT_TAG_COLOR;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { tagIdByKey: new Map(), skippedNames: [] };
  }

  const existing = await db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(eq(collections.account_id, accountId));

  const tagIdByKey = new Map<string, string>();
  for (const tag of existing ?? []) {
    const key = tag.name.trim().toLowerCase();
    if (!tagIdByKey.has(key)) tagIdByKey.set(key, tag.id);
  }

  const skippedNames: string[] = [];
  const toCreate: string[] = [];

  for (const name of uniqueNames) {
    const key = name.toLowerCase();
    if (tagIdByKey.has(key)) continue;
    if (canCreateTags) toCreate.push(name);
    else skippedNames.push(name);
  }

  if (toCreate.length > 0) {
    const created = await db
      .insert(collections)
      .values(
        toCreate.map((name) => ({
          user_id: userId,
          account_id: accountId,
          name,
          color: defaultColor,
        }))
      )
      .returning({ id: collections.id, name: collections.name });

    for (const tag of created ?? []) {
      tagIdByKey.set(tag.name.trim().toLowerCase(), tag.id);
    }
  }

  return { tagIdByKey, skippedNames };
}

export interface ContactTagAssignment {
  contactId: string;
  tagNames: string[];
}

export async function assignImportedContactTagsDrizzle(
  assignments: ContactTagAssignment[],
  tagIdByKey: Map<string, string>
): Promise<number> {
  const rows: { contact_id: string; collection_id: string }[] = [];

  for (const { contactId, tagNames } of assignments) {
    const assignedTagIds = new Set<string>();
    for (const name of tagNames) {
      const tagId = tagIdByKey.get(name.trim().toLowerCase());
      if (!tagId || assignedTagIds.has(tagId)) continue;
      assignedTagIds.add(tagId);
      rows.push({ contact_id: contactId, collection_id: tagId });
    }
  }

  if (rows.length === 0) return 0;

  const chunkSize = 100;
  let assigned = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db
      .insert(collection_members)
      .values(chunk)
      .onConflictDoNothing({ target: [collection_members.contact_id, collection_members.collection_id] });
    assigned += chunk.length;
  }

  return assigned;
}
