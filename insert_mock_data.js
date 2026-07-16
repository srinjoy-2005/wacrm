require('dotenv').config({ path: '.env.local' });
const postgres = require('postgres');
const crypto = require('crypto');

async function main() {
  const sql = postgres(process.env.DATABASE_URL);
  const accountId = 'cf4082a0-44b7-4338-8fd6-8d447f114dfe';
  const userId = crypto.randomUUID();

  console.log(`Inserting mock account: ${accountId}, user: ${userId}`);
  
  await sql`
    INSERT INTO accounts (id, name, owner_user_id)
    VALUES (${accountId}, 'Test Account', ${userId})
    ON CONFLICT DO NOTHING
  `;
  
  await sql`
    INSERT INTO whatsapp_config (user_id, account_id, phone_number_id, access_token, status)
    VALUES (${userId}, ${accountId}, 'test_phone_id', 'test_token', 'connected')
    ON CONFLICT DO NOTHING
  `;
  
  console.log('Inserted.');
  await sql.end();
}
main();
