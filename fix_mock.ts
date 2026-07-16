import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { encrypt } from './src/lib/whatsapp/encryption';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const enc = encrypt('test_token');
  await sql`UPDATE whatsapp_config SET access_token = ${enc}`;
  console.log('Fixed token!');
  await sql.end();
}
main();
