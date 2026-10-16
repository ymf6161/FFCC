"use client";

import { Camera, MessageSquareText, PenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The capture button: receipt, cash note, manual transaction. Each arrives in a later update. */
export function AddMenu({ onInk = false }: { onInk?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={onInk ? "onField" : "primary"} size="compact" className={onInk ? "w-full" : undefined}>
          <Plus aria-hidden />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={onInk ? "start" : "end"}>
        <DropdownMenuLabel>Coming in a later update</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <Camera aria-hidden />
          Upload a receipt
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <MessageSquareText aria-hidden />
          Add a cash note
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <PenLine aria-hidden />
          Add a transaction by hand
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
