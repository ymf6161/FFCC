import { and, eq, isNull } from "drizzle-orm";
import { type Actor, insertAudited } from "@/audit";
import type { Executor } from "@/db";
import { categories } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SYSTEM_CATEGORIES } from "@/seed/categories";

export type Category = typeof categories.$inferSelect;

/** Makes sure the household has every system category the engine files into. */
export async function ensureSystemCategories(ex: Executor, householdId: string, actor: Actor): Promise<Category[]> {
  const existing = await ex.select().from(categories).where(and(eq(categories.householdId, householdId), isNull(categories.deletedAt)));
  const names = new Set(existing.map((c) => c.name));
  const now = nowIso();
  for (const c of SYSTEM_CATEGORIES) {
    if (names.has(c.name)) continue;
    existing.push(
      await insertAudited(
        ex,
        categories,
        { id: newId(), householdId, name: c.name, kind: c.kind, maaserEffect: c.maaserEffect, isSystem: true, createdAt: now, updatedAt: now },
        { actor, reason: "Added a missing system category" },
      ),
    );
  }
  return existing;
}
