const postgres = require('postgres');
require('dotenv').config({ path: '.env.local' });
const client = postgres(process.env.DATABASE_URL);
async function run() {
  const result = await client`select column_name from information_schema.columns where table_name = 'profiles'`;
  console.log(result.map(r => r.column_name));
  process.exit(0);
}
run();
