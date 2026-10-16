import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** DESIGN.md "Button": pill, 48px tall, Figtree 700, labels are verbs. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-[transform,background-color] duration-100 active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border-strong bg-card text-foreground hover:bg-sunken",
        quiet: "text-teal-text underline-offset-4 hover:underline",
        destructive: "bg-error text-on-error hover:bg-error/90",
        onField: "bg-on-ink text-ink hover:bg-on-ink/90",
      },
      size: {
        default: "h-12 px-5 text-base",
        compact: "h-11 px-4 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
