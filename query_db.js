const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT account_id, id FROM whatsapp_config', (err, res) => {
  if (err) console.error(err);
  else console.log(res.rows);
  pool.end();
});
