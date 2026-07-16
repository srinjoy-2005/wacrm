import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from './src/db';
import { whatsapp_config } from './src/db/schema';

async function main() {
  const configs = await db.select().from(whatsapp_config);
  console.log(configs);
}
main();
