import { pgTable, uuid, text, timestamp, varchar, jsonb, boolean, integer } from 'drizzle-orm/pg-core';

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
});
