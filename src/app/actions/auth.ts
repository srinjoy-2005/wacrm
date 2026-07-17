"use server";

import { db } from "@/db";
import { profiles, accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function fetchProfileAndAccountAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return null;
  }
  
  const userId = (session.user as any).id;
  
  const profile = await db
    .select()
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1)
    .then(res => res[0]);
    
  if (!profile) return null;
  
  let account = null;
  if (profile.account_id) {
    account = await db
      .select({ id: accounts.id, name: accounts.name, default_currency: accounts.default_currency })
      .from(accounts)
      .where(eq(accounts.id, profile.account_id))
      .limit(1)
      .then(res => res[0]);
  }
  
  return {
    profile,
    account
  };
}

export async function signUpAction(data: { email: string; password: string; fullName: string }) {
  const existing = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, data.email))
    .limit(1)
    .then(res => res[0]);

  if (existing) {
    return { error: "User already exists with this email" };
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const userId = crypto.randomUUID();

  // Create a default account for the new user
  const accountId = crypto.randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    name: `${data.fullName}'s Account`,
    owner_user_id: userId,
  });

  await db.insert(profiles).values({
    user_id: userId,
    full_name: data.fullName,
    email: data.email,
    hashed_password: hashedPassword,
    role: "admin", // default role
    account_id: accountId,
    account_role: "owner", // they own the account they just created
  });

  return { success: true };
}
