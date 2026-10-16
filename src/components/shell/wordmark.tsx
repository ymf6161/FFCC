import Link from "next/link";
import { cn } from "@/lib/utils";

/** "ffcc" in lower case, Bricolage Grotesque 800 (DESIGN.md "Imagery and icons"). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="ffcc, go to Home"
      className={cn("font-display text-[1.75rem] font-extrabold leading-none tracking-[-0.03em]", className)}
    >
      ffcc
    </Link>
  );
}
