"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { KindChips, moneyKindFor, StatusChip } from "@/components/transaction-chips";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { addDetailAction } from "./actions";

export type ListRow = {
  id: string;
  date: string;
  dateLabel: string;
  amount: number;
  description: string;
  accountName: string;
  status: "auto" | "confirmed" | "unconfirmed";
  bookingStatus: "pending" | "booked";
  categoryName: string | null;
  categoryKind: "income" | "expense" | "transfer" | null;
  transferGroupId: string | null;
  refundOfId: string | null;
  refunded: boolean;
};

/** The transaction list with selection for tagging several rows at once (catch-up workflow). */
export function ActivityList({ rows }: { rows: ListRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  // Kept here, not in the bar, so the confirmation stays after the selection clears.
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  return (
    <>
      {message ? (
        <div className="mb-3">
          <Notice tone={message.tone} title={message.text} />
        </div>
      ) : null}
      {selected.size > 0 ? (
        <BulkBar
          ids={[...selected]}
          onResult={(m) => {
            setMessage(m);
            if (m.tone === "success") setSelected(new Set());
          }}
        />
      ) : null}
      <div className="flex items-center gap-3 border-b border-divider px-3 pb-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 type-label">
          <input
            type="checkbox"
            className="size-5 accent-[var(--teal)]"
            checked={allOn}
            onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
          />
          Select all shown
        </label>
      </div>
      <ul className="divide-y divide-divider lg:hidden">
        {rows.map((t) => (
          <li key={t.id} className="flex min-h-[60px] items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              aria-label={`Select ${t.description}`}
              className="size-5 shrink-0 accent-[var(--teal)]"
              checked={selected.has(t.id)}
              onChange={() => toggle(t.id)}
            />
            <Link href={`/activity/${t.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-semibold" dir="auto">
                    {t.description}
                  </span>
                  <StatusChip status={t.status} />
                  <KindChips row={t} />
                </p>
                <p className="type-label truncate text-muted-foreground">
                  {t.categoryName ?? "Not sorted yet"} · {t.accountName} · {t.dateLabel}
                </p>
              </div>
              <Money pence={t.amount} kind={moneyKindFor(t)} className="shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left lg:table">
        <caption className="sr-only">Transactions, newest first</caption>
        <thead>
          <tr className="type-label border-b border-divider text-muted-foreground">
            <th className="w-10 px-3 py-2 font-medium">
              <span className="sr-only">Select</span>
            </th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((t) => (
            <tr key={t.id} className="h-[60px] hover:bg-sunken/60">
              <td className="px-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${t.description}`}
                  className="size-5 accent-[var(--teal)]"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
              </td>
              <td className="whitespace-nowrap px-3 tabular-nums">{t.dateLabel}</td>
              <td className="whitespace-nowrap px-3 text-muted-foreground">{t.accountName}</td>
              <td className="px-3 py-2" dir="auto">
                <Link href={`/activity/${t.id}`} className="font-medium underline-offset-4 hover:underline">
                  {t.description}
                </Link>
                <span className="ml-2 align-middle">
                  <KindChips row={t} />
                </span>
              </td>
              <td className="px-3 text-muted-foreground">{t.categoryName ?? "Not sorted yet"}</td>
              <td className="whitespace-nowrap px-3">
                <StatusChip status={t.status} />
              </td>
              <td className="whitespace-nowrap px-3 text-right">
                <Money pence={t.amount} kind={moneyKindFor(t)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BulkBar({ ids, onResult }: { ids: string[]; onResult: (m: { tone: "success" | "error"; text: string }) => void }) {
  const [kind, setKind] = useState<"tag" | "event" | "person">("tag");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const label = { tag: "tag", event: "event", person: "person" }[kind];
  return (
    <div className="mb-3 space-y-3 rounded-md bg-sunken p-3" role="region" aria-label="Tag selected transactions">
      <p className="font-semibold">{ids.length} selected</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select aria-label="What to add" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="sm:w-40">
          <option value="tag">Tag</option>
          <option value="event">Event</option>
          <option value="person">Person</option>
        </Select>
        <Input aria-label={`Name of the ${label}`} placeholder={`Name of the ${label}`} value={name} dir="auto" onChange={(e) => setName(e.target.value)} />
        <Button
          disabled={pending || !name.trim()}
          onClick={() =>
            start(async () => {
              const result = await addDetailAction({ kind, name, transactionIds: ids });
              if (!result.ok) return onResult({ tone: "error", text: result.error });
              onResult({ tone: "success", text: `Added “${name.trim()}” to ${result.added} transaction${result.added === 1 ? "" : "s"}.` });
              setName("");
            })
          }
        >
          {pending ? "Adding…" : `Add to ${ids.length}`}
        </Button>
      </div>
    </div>
  );
}
