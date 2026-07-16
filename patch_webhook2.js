const fs = require('fs');
const file = 'src/app/api/whatsapp/webhook/route.ts';
let code = fs.readFileSync(file, 'utf8');

// Fix 4: Add import resolveConversationByPhoneDrizzle
code = code.replace(
  /import { getMediaUrl } from '@\/lib\/whatsapp\/meta-api'/g,
  `import { resolveConversationByPhoneDrizzle } from '@/lib/whatsapp/resolve-conversation.drizzle';\nimport { getMediaUrl } from '@/lib/whatsapp/meta-api'`
);

// Fix 1, 2, 3: (e instanceof Error ? e.message : String(e))
code = code.replace(
  /error\.message/g,
  `(error instanceof Error ? error.message : String(error))`
);
code = code.replace(
  /delError\.message/g,
  `(delError instanceof Error ? delError.message : String(delError))`
);
code = code.replace(
  /upsertError\.message/g,
  `(upsertError instanceof Error ? upsertError.message : String(upsertError))`
);

// Fix 5: Date object instead of toISOString for created_at
code = code.replace(
  /created_at: new Date\(parseInt\(message\.timestamp\) \* 1000\)\.toISOString\(\)/g,
  `created_at: new Date(parseInt(message.timestamp) * 1000)`
);

fs.writeFileSync(file, code);
console.log('Patched again');
