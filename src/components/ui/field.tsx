import type * as React from "react";
import { cn } from "@/lib/utils";

/** DESIGN.md inputs: 48px tall, 12px radius, border-strong outline, label above, hint below. */
export const inputClass =
  "h-12 w-full rounded-md border border-input bg-card px-3 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50";

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="type-label block font-semibold text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="type-label text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(inputClass, "pr-8", className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}
