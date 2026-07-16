const fs = require('fs');
const file = 'src/app/api/whatsapp/webhook/route.ts';
let code = fs.readFileSync(file, 'utf8');

// POST config fetch
code = code.replace(
  /const { data, error } = await supabaseAdmin\(\)\s*\.from\('whatsapp_config'\)\s*\.select\('\*'\)\s*\.limit\(1\)/g,
  `const data = await db.select().from(whatsapp_config).limit(1);\n        const error = null;`
);

code = code.replace(
  /const { data, error } = await supabaseAdmin\(\)\s*\.from\('whatsapp_config'\)\s*\.select\('\*'\)\s*\.eq\('phone_number_id', phoneNumberId\)/g,
  `const data = await db.select().from(whatsapp_config).where(eq(whatsapp_config.phone_number_id, phoneNumberId));\n        const error = null;`
);

// handleStatusUpdate
code = code.replace(
  /const { error: msgErr } = await supabaseAdmin\(\)\s*\.from\('messages'\)\s*\.update\({ status: status\.status }\)\s*\.eq\('message_id', status\.id\)/g,
  `let msgErr = null;\n  try { await db.update(messages).set({ status: status.status }).where(eq(messages.message_id, status.id)); } catch(e) { msgErr = e; }`
);

code = code.replace(
  /const { data: recipient, error: recFetchErr } = await supabaseAdmin\(\)\s*\.from\('broadcast_recipients'\)\s*\.select\('id, status'\)\s*\.eq\('whatsapp_message_id', status\.id\)\s*\.maybeSingle\(\)/g,
  `let recFetchErr = null;\n  const recipient = await db.select({ id: broadcast_recipients.id, status: broadcast_recipients.status }).from(broadcast_recipients).where(eq(broadcast_recipients.whatsapp_message_id, status.id)).limit(1).then(r => r[0] || null).catch(e => { recFetchErr = e; return null; });`
);

code = code.replace(
  /const { error: recUpdateErr } = await supabaseAdmin\(\)\s*\.from\('broadcast_recipients'\)\s*\.update\(update\)\s*\.eq\('id', recipient\.id\)/g,
  `let recUpdateErr = null;\n    try { await db.update(broadcast_recipients).set(update as any).where(eq(broadcast_recipients.id, recipient.id)); } catch(e) { recUpdateErr = e; }`
);

code = code.replace(
  /const { data: msgRow } = await supabaseAdmin\(\)\s*\.from\('messages'\)\s*\.select\('conversation_id, conversations\(account_id\)'\)\s*\.eq\('message_id', status\.id\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/g,
  `const msgRow = await db.select({ conversation_id: messages.conversation_id, account_id: conversations.account_id }).from(messages).innerJoin(conversations, eq(messages.conversation_id, conversations.id)).where(eq(messages.message_id, status.id)).limit(1).then(r => r[0] ? { conversation_id: r[0].conversation_id, conversations: { account_id: r[0].account_id } } : null);`
);

// flagBroadcastReplyIfAny
code = code.replace(
  /const { data: recs, error } = await supabaseAdmin\(\)\s*\.from\('broadcast_recipients'\)\s*\.select\('id, status, broadcast_id, broadcasts!inner\(account_id\)'\)\s*\.eq\('contact_id', contactId\)\s*\.eq\('broadcasts\.account_id', accountId\)\s*\.in\('status', \['sent', 'delivered', 'read'\]\)\s*\.order\('created_at', { ascending: false }\)\s*\.limit\(1\)/g,
  `// broadcast is not fully migrated, leaving as supabaseAdmin\n    const { data: recs, error } = await supabaseAdmin().from('broadcast_recipients').select('id, status, broadcast_id, broadcasts!inner(account_id)').eq('contact_id', contactId).eq('broadcasts.account_id', accountId).in('status', ['sent', 'delivered', 'read']).order('created_at', { ascending: false }).limit(1)`
);

code = code.replace(
  /const { error: updErr } = await supabaseAdmin\(\)\s*\.from\('broadcast_recipients'\)\s*\.update\({ status: 'replied', replied_at: new Date\(\)\.toISOString\(\) }\)\s*\.eq\('id', row\.id\)/g,
  `let updErr = null;\n    try { await db.update(broadcast_recipients).set({ status: 'replied', replied_at: new Date() }).where(eq(broadcast_recipients.id, row.id)); } catch(e) { updErr = e; }`
);

// lookupInternalIdByMetaId
code = code.replace(
  /const { data, error } = await supabaseAdmin\(\)\s*\.from\('messages'\)\s*\.select\('id'\)\s*\.eq\('message_id', metaId\)\s*\.eq\('conversation_id', conversationId\)\s*\.maybeSingle\(\)/g,
  `let error = null;\n  const data = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.message_id, metaId), eq(messages.conversation_id, conversationId))).limit(1).then(r => r[0] || null).catch(e => { error = e; return null; });`
);

// handleReaction
code = code.replace(
  /const { error: delError } = await supabaseAdmin\(\)\s*\.from\('message_reactions'\)\s*\.delete\(\)\s*\.eq\('message_id', targetInternalId\)\s*\.eq\('actor_type', 'customer'\)\s*\.eq\('actor_id', contactId\)/g,
  `let delError = null;\n    try { await db.delete(message_reactions).where(and(eq(message_reactions.message_id, targetInternalId), eq(message_reactions.actor_type, 'customer'), eq(message_reactions.actor_id, contactId))); } catch(e) { delError = e; }`
);

code = code.replace(
  /const { error: upsertError } = await supabaseAdmin\(\)\s*\.from\('message_reactions'\)\s*\.upsert\(\s*\{\s*message_id: targetInternalId,\s*conversation_id: conversationId,\s*actor_type: 'customer',\s*actor_id: contactId,\s*emoji: reaction\.emoji,\s*\},\s*\{ onConflict: 'message_id,actor_type,actor_id' \}\s*\)/g,
  `let upsertError = null;\n  try { await db.insert(message_reactions).values({ message_id: targetInternalId, conversation_id: conversationId, actor_type: 'customer', actor_id: contactId, emoji: reaction.emoji }).onConflictDoUpdate({ target: [message_reactions.message_id, message_reactions.actor_type, message_reactions.actor_id], set: { emoji: reaction.emoji } }); } catch(e) { upsertError = e; }`
);

// processMessage inserts
code = code.replace(
  /const { count: priorCustomerMsgCount } = await supabaseAdmin\(\)\s*\.from\('messages'\)\s*\.select\('id', \{ count: 'exact', head: true \}\)\s*\.eq\('conversation_id', conversation\.id\)\s*\.eq\('sender_type', 'customer'\)/g,
  `const priorCustomerMsgCountRes = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversation_id, conversation.id), eq(messages.sender_type, 'customer'))).limit(1);\n  const priorCustomerMsgCount = priorCustomerMsgCountRes.length;`
);

code = code.replace(
  /const { error: msgError } = await supabaseAdmin\(\)\.from\('messages'\)\.insert\(\{/g,
  `let msgError = null;\n  try { await db.insert(messages).values({`
);

code = code.replace(
  /interactive_reply_id: interactiveReplyId,\s*\}\)/g,
  `interactive_reply_id: interactiveReplyId,\n  }); } catch(e) { msgError = e; }`
);

code = code.replace(
  /const { error: convError } = await supabaseAdmin\(\)\s*\.from\('conversations'\)\s*\.update\(\{\s*last_message_text: contentText \|\| `\[\$\{message\.type\}\]`,\s*last_message_at: new Date\(\)\.toISOString\(\),\s*unread_count: \(conversation\.unread_count \|\| 0\) \+ 1,\s*updated_at: new Date\(\)\.toISOString\(\),\s*\}\)\s*\.eq\('id', conversation\.id\)/g,
  `let convError = null;\n  try { await db.update(conversations).set({ last_message_text: contentText || \`[\${message.type}]\`, last_message_at: new Date(), unread_count: (conversation.unread_count || 0) + 1, updated_at: new Date() }).where(eq(conversations.id, conversation.id)); } catch(e) { convError = e; }`
);

// We need to replace findOrCreateContact and findOrCreateConversation with resolveConversationByPhoneDrizzle.
code = code.replace(
  /const contactOutcome = await findOrCreateContact\([\s\S]*?if \(!convResult\) return\s*const conversation = convResult\.conversation/g,
  `let conversationId = '';
  let contactId = '';
  let contactCreated = false;
  try {
    const resolved = await resolveConversationByPhoneDrizzle(
      accountId,
      senderPhone,
      contactName
    );
    conversationId = resolved.conversationId;
    contactId = resolved.contactId;
    contactCreated = resolved.contactCreated;
  } catch (err) {
    console.error('Error resolving conversation:', err);
    return;
  }

  const contactRecord = { id: contactId };
  // We don't have conversation unread_count directly from resolveConversationByPhoneDrizzle, so fetch it
  const conversation = await db.select({ id: conversations.id, unread_count: conversations.unread_count }).from(conversations).where(eq(conversations.id, conversationId)).limit(1).then(r => r[0]);
  if (!conversation) return;
  const convResult = { created: contactCreated }; // Approximate conv created with contact created for webhook trigger
  const contactOutcome = { wasCreated: contactCreated };`
);

fs.writeFileSync(file, code);
console.log('Patched');
