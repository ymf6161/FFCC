import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success-tint text-money-in",
  warning: "bg-warning-tint text-warning-strong",
  error: "bg-error-tint text-error",
  neutral: "bg-sunken text-muted-foreground",
} as const;

/** DESIGN.md chip: pill, 13px / 700, tint background, always a word. */
export function Chip({ tone, children, className }: { tone: keyof typeof tones; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.8125rem] font-bold", tones[tone], className)}>
      {children}
    </span>
  );
}
