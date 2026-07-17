// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's session via NextAuth.
// ============================================================

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** `session.user.id` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their JWT. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
}

/**
 * Resolve the caller's user + account + role via NextAuth session.
 *
 * Throws `UnauthorizedError` if there's no active session.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    throw new UnauthorizedError();
  }

  const user = session.user as any;

  if (!user.accountId || !user.role) {
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(user.role)) {
    throw new ForbiddenError(`Unknown account role: ${user.role}`);
  }

  return {
    userId: user.id,
    accountId: user.accountId,
    role: user.role,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
