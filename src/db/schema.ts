import { pgTable, uuid, text, timestamp, varchar, jsonb, boolean, integer, unique } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  owner_user_id: uuid('owner_user_id').notNull(),
  default_currency: varchar('default_currency', { length: 3 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  full_name: text('full_name').notNull(),
  email: text('email').notNull(),
  avatar_url: text('avatar_url'),
  hashed_password: text('hashed_password'),
  role: text('role').default('user'),
  account_id: uuid('account_id').references(() => accounts.id),
  account_role: text('account_role'),
  beta_features: text('beta_features').array(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const contacts = pgTable('contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  account_id: uuid('account_id').notNull().references(() => accounts.id),
  phone: text('phone').notNull(),
  phone_normalized: text('phone_normalized'),
  name: text('name'),
  email: text('email'),
  company: text('company'),
  avatar_url: text('avatar_url'),
  segment: text('segment'),
  preferred_language: text('preferred_language').default('en'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const collections = pgTable('collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  account_id: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  color: text('color').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const collection_members = pgTable('collection_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  contact_id: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  collection_id: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  unq: unique().on(t.contact_id, t.collection_id),
}));

// ============================================================
// Phase 1.2 Messaging Schema
// ============================================================

export const whatsapp_config = pgTable('whatsapp_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  account_id: uuid('account_id').notNull().references(() => accounts.id),
  phone_number_id: text('phone_number_id').notNull().unique(),
  waba_id: text('waba_id'),
  access_token: text('access_token').notNull(),
  verify_token: text('verify_token'),
  status: text('status').default('disconnected').notNull(),
  connected_at: timestamp('connected_at', { withTimezone: true }),
  registered_at: timestamp('registered_at', { withTimezone: true }),
  subscribed_apps_at: timestamp('subscribed_apps_at', { withTimezone: true }),
  last_registration_error: text('last_registration_error'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  account_id: uuid('account_id').notNull().references(() => accounts.id),
  contact_id: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  status: text('status').default('open').notNull(),
  assigned_agent_id: uuid('assigned_agent_id'),
  last_message_text: text('last_message_text'),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  unread_count: integer('unread_count').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  unq: unique().on(t.account_id, t.contact_id),
}));

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversation_id: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  sender_type: text('sender_type').notNull(),
  sender_id: uuid('sender_id'),
  content_type: text('content_type').notNull(),
  content_text: text('content_text'),
  media_url: text('media_url'),
  template_name: text('template_name'),
  message_id: text('message_id'), // Meta's WA message ID
  status: text('status').default('sending').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reply_to_message_id: uuid('reply_to_message_id'),
  interactive_reply_id: text('interactive_reply_id'),
});

export const message_reactions = pgTable('message_reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  message_id: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  conversation_id: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  actor_type: text('actor_type').notNull(),
  actor_id: uuid('actor_id'),
  emoji: text('emoji').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  account_id: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  template_name: text('template_name').notNull(),
  template_language: text('template_language').notNull(),
  template_variables: jsonb('template_variables'),
  audience_filter: jsonb('audience_filter'),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
  status: text('status').default('draft').notNull(),
  total_recipients: integer('total_recipients').default(0).notNull(),
  sent_count: integer('sent_count').default(0).notNull(),
  delivered_count: integer('delivered_count').default(0).notNull(),
  read_count: integer('read_count').default(0).notNull(),
  replied_count: integer('replied_count').default(0).notNull(),
  failed_count: integer('failed_count').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const broadcast_recipients = pgTable('broadcast_recipients', {
  id: uuid('id').defaultRandom().primaryKey(),
  broadcast_id: uuid('broadcast_id').notNull().references(() => broadcasts.id, { onDelete: 'cascade' }),
  contact_id: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  status: text('status').default('pending').notNull(),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  read_at: timestamp('read_at', { withTimezone: true }),
  replied_at: timestamp('replied_at', { withTimezone: true }),
  error_message: text('error_message'),
  whatsapp_message_id: text('whatsapp_message_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================
// Phase 2: Automations & Templates Schema
// ============================================================

export const message_templates = pgTable('message_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  language: text('language').notNull(),
  header_type: text('header_type'),
  header_content: text('header_content'),
  header_handle: text('header_handle'),
  body_text: text('body_text').notNull(),
  footer_text: text('footer_text'),
  buttons: jsonb('buttons'),
  sample_values: jsonb('sample_values'),
  status: text('status').notNull(),
  meta_template_id: text('meta_template_id'),
  quality_score: text('quality_score'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automations = pgTable('automations', {
  id: uuid('id').defaultRandom().primaryKey(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  trigger_type: text('trigger_type').notNull(),
  trigger_config: jsonb('trigger_config').default({}).notNull(),
  is_active: boolean('is_active').default(false).notNull(),
  execution_count: integer('execution_count').default(0).notNull(),
  last_executed_at: timestamp('last_executed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automation_steps = pgTable('automation_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  automation_id: uuid('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  parent_step_id: uuid('parent_step_id'),
  branch: text('branch'),
  step_type: text('step_type').notNull(),
  step_config: jsonb('step_config').default({}).notNull(),
  position: integer('position').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automation_logs = pgTable('automation_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  automation_id: uuid('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull(),
  contact_id: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  trigger_event: text('trigger_event').notNull(),
  steps_executed: jsonb('steps_executed').default([]).notNull(),
  status: text('status').notNull(),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automation_pending_executions = pgTable('automation_pending_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  automation_id: uuid('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull(),
  contact_id: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  log_id: uuid('log_id').references(() => automation_logs.id, { onDelete: 'cascade' }),
  parent_step_id: uuid('parent_step_id'),
  branch: text('branch'),
  next_step_position: integer('next_step_position').notNull(),
  context: jsonb('context').default({}).notNull(),
  run_at: timestamp('run_at', { withTimezone: true }).notNull(),
  status: text('status').default('pending').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
