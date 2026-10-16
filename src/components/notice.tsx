import type * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  warning: "bg-warning-tint text-warning-strong",
  success: "bg-success-tint text-foreground",
  error: "bg-error-tint text-error",
} as const;

/** Full-width rounded band in a tint with a sentence and at most one action (DESIGN.md "Notice"). */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: keyof typeof tones;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role="status" className={cn("rounded-lg px-5 py-4", tones[tone])}>
      <p className="font-bold">{title}</p>
      {children ? <div className="mt-1 text-foreground">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
