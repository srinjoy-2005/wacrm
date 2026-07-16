require('dotenv').config({ path: '.env.local' });
const postgres = require('postgres');
const crypto = require('crypto');

const GCM_IV_LENGTH = 12;

function encrypt(text) {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
    iv
  );
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL);
  const enc = encrypt('test_token');
  await sql`UPDATE whatsapp_config SET access_token = ${enc}`;
  console.log('Fixed token!');
  await sql.end();
}
main();
