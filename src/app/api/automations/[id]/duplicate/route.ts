import { NextResponse } from 'next/server'
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from '@/db'
import { automations, automation_steps } from '@/db/schema'
import { eq, and, asc } from 'drizzle-orm'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any

  let original;
  try {
    const res = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.user_id, user.id)))
      .limit(1);
    original = res[0];
  } catch (origErr: any) {
    return NextResponse.json({ error: origErr.message }, { status: 500 })
  }
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let copy;
  try {
    const res = await db
      .insert(automations)
      .values({
        account_id: original.account_id,
        user_id: user.id,
        name: `${original.name} (Copy)`,
        description: original.description,
        trigger_type: original.trigger_type,
        trigger_config: original.trigger_config,
        is_active: false,
      } as any)
      .returning();
    copy = res[0];
  } catch (copyErr: any) {
    return NextResponse.json({ error: copyErr?.message ?? 'copy failed' }, { status: 500 })
  }

  if (!copy) {
    return NextResponse.json({ error: 'copy failed' }, { status: 500 })
  }

  let steps: any[] = [];
  try {
    steps = await db
      .select({
        id: automation_steps.id,
        parent_step_id: automation_steps.parent_step_id,
        branch: automation_steps.branch,
        step_type: automation_steps.step_type,
        step_config: automation_steps.step_config,
        position: automation_steps.position,
      })
      .from(automation_steps)
      .where(eq(automation_steps.automation_id, id))
      .orderBy(asc(automation_steps.position));
  } catch (err) {
    steps = [];
  }

  if (steps && steps.length > 0) {
    // Re-map parent_step_id: build old→new id map first so the second
    // pass inserts rows with correct parent references.
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id as string, uid())

    const rows = steps.map((row) => ({
      id: idMap.get(row.id as string)!,
      automation_id: copy.id,
      parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id as string) : null,
      branch: row.branch,
      step_type: row.step_type,
      step_config: row.step_config,
      position: row.position,
    }))
    try {
      await db.insert(automation_steps).values(rows as any)
    } catch (insErr: any) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}
