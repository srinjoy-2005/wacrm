import { createClient } from '@supabase/supabase-js';
import { db } from '../src/db';
import { accounts, profiles, contacts, collections, collection_members } from '../src/db/schema';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseDates(rows: any[]) {
  return rows.map(row => {
    const newRow = { ...row };
    if (newRow.created_at) newRow.created_at = new Date(newRow.created_at);
    if (newRow.updated_at) newRow.updated_at = new Date(newRow.updated_at);
    return newRow;
  });
}

async function main() {
  console.log("Starting data transfer from Supabase to Neon...");

  // 1. Accounts
  console.log("Fetching accounts...");
  const { data: accountsData, error: accountsErr } = await supabase.from('accounts').select('*');
  if (accountsErr) throw accountsErr;
  if (accountsData && accountsData.length > 0) {
    console.log(`Inserting ${accountsData.length} accounts...`);
    await db.insert(accounts).values(parseDates(accountsData)).onConflictDoNothing();
  }

  // 2. Profiles
  console.log("Fetching profiles...");
  const { data: profilesData, error: profilesErr } = await supabase.from('profiles').select('*');
  if (profilesErr) throw profilesErr;
  if (profilesData && profilesData.length > 0) {
    console.log(`Inserting ${profilesData.length} profiles...`);
    await db.insert(profiles).values(parseDates(profilesData)).onConflictDoNothing();
  }

  // 3. Contacts
  console.log("Fetching contacts...");
  const { data: contactsData, error: contactsErr } = await supabase.from('contacts').select('*');
  if (contactsErr) throw contactsErr;
  if (contactsData && contactsData.length > 0) {
    console.log(`Inserting ${contactsData.length} contacts...`);
    await db.insert(contacts).values(parseDates(contactsData)).onConflictDoNothing();
  }

  // 4. Collections
  console.log("Fetching collections...");
  let { data: collectionsData, error: collectionsErr } = await supabase.from('collections').select('*');
  
  // NOTE: If the user's live Supabase DB is still using 'tags' instead of 'collections', we might need to fallback.
  let finalCollectionsData = collectionsData;
  if (collectionsErr && collectionsErr.code === 'PGRST205') { // undefined_table
    console.log("Table 'collections' not found, falling back to 'tags'...");
    const { data: tagsData, error: tagsErr } = await supabase.from('tags').select('*');
    if (tagsErr) throw tagsErr;
    finalCollectionsData = tagsData;
  } else if (collectionsErr) {
      throw collectionsErr;
  }
  
  if (finalCollectionsData && finalCollectionsData.length > 0) {
    console.log(`Inserting ${finalCollectionsData.length} collections...`);
    await db.insert(collections).values(parseDates(finalCollectionsData)).onConflictDoNothing();
  }

  // 5. Collection Members
  console.log("Fetching collection members...");
  let { data: membersData, error: membersErr } = await supabase.from('collection_members').select('*');
  let finalMembersData = membersData;
  
  if (membersErr && membersErr.code === 'PGRST205') { // undefined_table
    console.log("Table 'collection_members' not found, falling back to 'contact_tags'...");
    const { data: tagsData, error: tagsErr } = await supabase.from('contact_tags').select('id, contact_id, collection_id:tag_id, created_at');
    if (tagsErr) throw tagsErr;
    finalMembersData = tagsData;
  } else if (membersErr) {
    throw membersErr;
  }

  if (finalMembersData && finalMembersData.length > 0) {
    console.log(`Inserting ${finalMembersData.length} collection members...`);
    await db.insert(collection_members).values(parseDates(finalMembersData)).onConflictDoNothing();
  }

  console.log("Data transfer completed successfully!");
  process.exit(0);
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
