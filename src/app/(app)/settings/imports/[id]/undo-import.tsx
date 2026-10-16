"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { undoImportAction } from "../../import/actions";

/** Destructive action, confirmed in place with what will happen (DESIGN.md "Button"). */
export function UndoImport({ batchId, transactionCount, confirmedOrEdited }: { batchId: string; transactionCount: number; confirmedOrEdited: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const n = (count: number, word: string) => `${count.toLocaleString("en-GB")} ${word}${count === 1 ? "" : "s"}`;

  if (!confirming) {
    return (
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Undo this import
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      <Notice tone="error" title={`Undo this import? ${n(transactionCount, "transaction")} will be removed.`}>
        {confirmedOrEdited > 0
          ? `${confirmedOrEdited.toLocaleString("en-GB")} of them ${confirmedOrEdited === 1 ? "has" : "have"} been confirmed or edited.`
          : "None of them have been confirmed or edited yet."}
      </Notice>
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await undoImportAction({ batchId });
              if (result && !result.ok) setError(result.error);
            })
          }
        >
          {pending ? "Undoing…" : `Yes, remove ${n(transactionCount, "transaction")}`}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
          Keep the import
        </Button>
      </div>
    </div>
  );
}
