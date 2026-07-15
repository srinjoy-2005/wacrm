// ============================================================
// GET  /api/v1/contacts  — list contacts (scope: contacts:read)
// POST /api/v1/contacts  — create a contact  (scope: contacts:write)
//
// List is keyset-paginated (see src/lib/api/v1/pagination.ts) and
// supports `?search=` (name/phone) and `?tag=<tagId>` filters. Create
// is find-or-create by phone: an existing match returns 200 with
// `created: false`; a new row returns 201 with `created: true`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilterDrizzle,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  findOrCreateContactDrizzle,
  setContactTagsDrizzle,
  getContactByIdDrizzle,
  resolveAuditUserIdDrizzle,
  ContactError,
} from '@/lib/api/v1/contacts.drizzle';
import { db } from '@/db';
import { contacts, collection_members, collections } from '@/db/schema';
import { eq, or, ilike, and, desc, sql, inArray } from 'drizzle-orm';

// PostgREST filter values are comma/paren-delimited; strip anything
// that could break the `.or()` grammar before interpolating a search
// term. Leaves the characters a phone or name legitimately contains.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');
    const tag = url.searchParams.get('tag');

    // Build WHERE clauses
    const whereClauses = [eq(contacts.account_id, ctx.accountId)];

    if (search) {
      whereClauses.push(
        or(
          ilike(contacts.name, `%${search}%`),
          ilike(contacts.phone, `%${search}%`)
        )!
      );
    }

    if (tag) {
      whereClauses.push(
        inArray(
          contacts.id,
          db.select({ id: collection_members.contact_id }).from(collection_members).where(eq(collection_members.collection_id, tag))
        )
      );
    }

    const kf = keysetFilterDrizzle(cursor, contacts);
    if (kf) whereClauses.push(kf);

    // Drizzle requires an array for and() only if there's >1, but spreading into and() works.
    const queryResult = await db
      .select()
      .from(contacts)
      .where(and(...whereClauses))
      .orderBy(desc(contacts.created_at), desc(contacts.id))
      .limit(limit + 1);

    // To serialize, we need to hydrate the tags for the retrieved contacts.
    const contactIds = queryResult.map(c => c.id);
    let allTags: any[] = [];
    if (contactIds.length > 0) {
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

    // Attach tags to contacts
    const rows = queryResult.map(contact => {
      const contactTags = allTags
        .filter(t => t.contact_id === contact.id)
        .map(t => t.tag);
      return {
        ...contact,
        tags: contactTags,
        created_at: contact.created_at.toISOString(),
        updated_at: contact.updated_at.toISOString(),
      };
    });

    const { items, nextCursor } = buildPage(rows, limit);
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return fail('bad_request', "'phone' is required", 400);
    }

    const auditUserId = await resolveAuditUserIdDrizzle(ctx.accountId);

    const { id, created } = await findOrCreateContactDrizzle(
      ctx.accountId,
      auditUserId,
      {
        phone,
        name: typeof body.name === 'string' ? body.name : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
        company: typeof body.company === 'string' ? body.company : undefined,
      }
    );

    if (Array.isArray(body.tags)) {
      await setContactTagsDrizzle(
        ctx.accountId,
        auditUserId,
        id,
        body.tags.filter((t): t is string => typeof t === 'string')
      );
    }

    const contact = await getContactByIdDrizzle(ctx.accountId, id);
    return ok(contact, created ? 201 : 200);
  } catch (err) {
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
