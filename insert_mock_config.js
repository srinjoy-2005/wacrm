require('dotenv').config({ path: '.env.local' });
const postgres = require('postgres');

async function main() {
  const sql = postgres(process.env.DATABASE_URL);
  
  const apiKeys = await sql`SELECT id, account_id, created_by FROM api_keys LIMIT 1`;
  console.log('API Keys:', apiKeys);
  
  if (apiKeys.length > 0) {
    const accountId = apiKeys[0].account_id;
    const userId = apiKeys[0].created_by;
    console.log(`Inserting whatsapp_config for account: ${accountId}, user: ${userId}`);
    
    await sql`
      INSERT INTO whatsapp_config (user_id, account_id, phone_number_id, access_token, status)
      VALUES (${userId}, ${accountId}, 'test_phone_id', 'test_token', 'connected')
      ON CONFLICT DO NOTHING
    `;
    console.log('Inserted.');
  }
  
  await sql.end();
}
main();
