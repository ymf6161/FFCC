import Link from "next/link";
import type * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  teal: "bg-teal text-on-teal",
  saffron: "bg-saffron text-on-saffron",
  plum: "bg-plum text-on-plum",
} as const;

const labelTones = {
  teal: "text-on-teal-muted",
  saffron: "text-on-saffron",
  plum: "text-on-plum-muted",
} as const;

/** A flat colour field for a headline figure (DESIGN.md "Field tile"). At most three per screen. */
export function Tile({
  tone,
  label,
  href,
  className,
  children,
}: {
  tone: keyof typeof tones;
  label: string;
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <p className={cn("text-[0.9375rem] font-medium", labelTones[tone])}>{label}</p>
      <div className="mt-2">{children}</div>
    </>
  );
  const classes = cn("block rounded-lg p-5 lg:p-6", tones[tone], className);
  if (href) {
    return (
      <Link href={href} className={cn(classes, "transition-transform duration-100 active:scale-[0.98]")}>
        {body}
      </Link>
    );
  }
  return <section className={classes}>{body}</section>;
}
