import type * as React from "react";
import { AddMenu } from "./add-menu";
import { BottomNav, RailNav } from "./app-nav";
import { Wordmark } from "./wordmark";

function QuestionsCount({ count }: { count: number }) {
  if (count === 0) return <p className="type-label text-on-ink-muted">No questions waiting</p>;
  return (
    <p className="type-label flex items-center gap-2 text-on-ink">
      <span className="rounded-full bg-saffron px-2 py-0.5 text-[0.8125rem] font-bold text-on-saffron">{count}</span>
      {count === 1 ? "question waiting" : "questions waiting"}
    </p>
  );
}

/**
 * Phone (below 1024px): top row with wordmark and Add, ink pill nav at the bottom.
 * Desktop: a 248px ink rail with wordmark, Add, the five areas and the questions count.
 */
export function AppShell({ openQuestions, children }: { openQuestions: number; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-6 lg:bg-ink lg:p-5 lg:text-on-ink">
        <Wordmark className="px-2 pt-1 text-on-ink" />
        <AddMenu onInk />
        <RailNav />
        <div className="mt-auto px-2 pb-1">
          <QuestionsCount count={openQuestions} />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 lg:hidden">
          <Wordmark className="text-ink" />
          <AddMenu />
        </div>
        <main className="mx-auto w-full max-w-[1120px] px-3 pb-32 pt-2 sm:px-4 lg:px-8 lg:pb-12 lg:pt-10">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
