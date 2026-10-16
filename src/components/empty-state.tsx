import type * as React from "react";

/** Text only, no illustrations: what will appear here and what fills it (DESIGN.md "Empty states"). */
export function EmptyState({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-card p-5 lg:p-6">
      <h2 className="type-heading">{title}</h2>
      <div className="mt-2 max-w-[65ch] space-y-2 text-muted-foreground">{children}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
