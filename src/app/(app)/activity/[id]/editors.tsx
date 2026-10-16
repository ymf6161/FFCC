"use client";

import { useMemo, useState, useTransition } from "react";
import { Chip } from "@/components/chip";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { parseAmountToPence } from "@/money";
import { addDetailAction, changeCategoryAction, confirmAction, createRuleAction, notesAction, removeDetailAction, saveSplitsAction } from "../actions";

type Cat = { id: string; name: string; kind: string };

/** Change the category; then offer "Always do this for [merchant]?" (workflow 4). */
export function CategoryEditor({
  transactionId,
  categoryId,
  categories,
  status,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: Cat[];
  status: string;
}) {
  const [value, setValue] = useState(categoryId ?? "");
  const [offer, setOffer] = useState<{ merchant: string; categoryName: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const groups = ["expense", "income", "transfer"].map((k) => ({ k, items: categories.filter((c) => c.kind === k) }));
  const label = { expense: "Spending", income: "Income", transfer: "Moves between our accounts" } as Record<string, string>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Category" htmlFor="category" className="flex-1">
          <Select id="category" value={value} onChange={(e) => setValue(e.target.value)}>
            {!categoryId ? <option value="">Choose a category</option> : null}
            {groups.map((g) => (
              <optgroup key={g.k} label={label[g.k]}>
                {g.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Button
          disabled={pending || !value || (value === categoryId && status === "confirmed")}
          onClick={() =>
            start(async () => {
              setMessage(null);
              const r = await changeCategoryAction({ transactionId, categoryId: value });
              if (!r.ok) return setMessage({ tone: "error", text: r.error });
              setMessage({ tone: "success", text: `Saved as ${r.categoryName}.` });
              setOffer(r.offerRule && r.merchant ? { merchant: r.merchant, categoryName: r.categoryName } : null);
            })
          }
        >
          {pending ? "Saving…" : "Save category"}
        </Button>
        {status !== "confirmed" && categoryId ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await confirmAction({ transactionId });
                setMessage(r.ok ? { tone: "success", text: "Confirmed." } : { tone: "error", text: r.error });
              })
            }
          >
            Looks right
          </Button>
        ) : null}
      </div>
      {message ? <Notice tone={message.tone} title={message.text} /> : null}
      {offer ? (
        <Notice tone="success" title={`Always file ${offer.merchant} as ${offer.categoryName}?`}>
          <p>We’ll do this for future payments, and for the ones still waiting to be confirmed.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await createRuleAction({ transactionId });
                  if (!r.ok) return setMessage({ tone: "error", text: r.error });
                  setOffer(null);
                  setMessage({
                    tone: "success",
                    text: `Saved. We’ll file ${r.merchant} as ${r.categoryName} from now on.${r.appliedTo > 0 ? ` Updated ${r.appliedTo} other payment${r.appliedTo === 1 ? "" : "s"}.` : ""}`,
                  });
                })
              }
            >
              Yes, always
            </Button>
            <Button variant="quiet" onClick={() => setOffer(null)}>
              Just this once
            </Button>
          </div>
        </Notice>
      ) : null}
    </div>
  );
}

/** Split a payment across categories. Save is only possible when the lines add up exactly (rule 5). */
export function SplitEditor({
  transactionId,
  amount,
  categories,
  initial,
}: {
  transactionId: string;
  amount: number;
  categories: Cat[];
  initial: { categoryId: string | null; amount: number }[];
}) {
  const abs = Math.abs(amount);
  const toText = (p: number) => (Math.abs(p) / 100).toFixed(2);
  const [lines, setLines] = useState(
    initial.length ? initial.map((l) => ({ categoryId: l.categoryId ?? "", amount: toText(l.amount) })) : [{ categoryId: "", amount: toText(abs) }, { categoryId: "", amount: "" }],
  );
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const allocated = useMemo(() => lines.reduce((s, l) => s + (l.amount ? (parseAmountToPence(l.amount).ok ? (parseAmountToPence(l.amount) as { pence: number }).pence : NaN) : 0), 0), [lines]);
  const left = abs - allocated;
  const valid = Number.isFinite(allocated) && left === 0 && lines.every((l) => l.categoryId && l.amount);
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={`Line ${i + 1} category`} htmlFor={`split-cat-${i}`} className="flex-1">
            <Select id={`split-cat-${i}`} value={line.categoryId} onChange={(e) => set(i, { categoryId: e.target.value })}>
              <option value="">Choose a category</option>
              {categories
                .filter((c) => c.kind !== "transfer")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={`Line ${i + 1} amount`} htmlFor={`split-amt-${i}`} className="sm:w-40">
            <Input id={`split-amt-${i}`} inputMode="decimal" value={line.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          </Field>
          {lines.length > 2 ? (
            <Button variant="quiet" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              Remove line {i + 1}
            </Button>
          ) : null}
        </div>
      ))}
      <p className="tabular-nums" role="status">
        {!Number.isFinite(allocated) ? (
          <span className="text-error">One of the amounts doesn’t look right. Try something like 25.00.</span>
        ) : left === 0 ? (
          <span className="text-money-in">Adds up to the payment.</span>
        ) : left > 0 ? (
          <>
            <Money pence={left} kind="transfer" /> still to split.
          </>
        ) : (
          <span className="text-error">
            <Money pence={-left} kind="transfer" className="text-error" /> more than the payment.
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { categoryId: "", amount: left > 0 ? toText(left) : "" }])}>
          Add a line
        </Button>
        <Button
          disabled={!valid || pending}
          onClick={() =>
            start(async () => {
              const r = await saveSplitsAction({ transactionId, amount, lines });
              setMessage(r.ok ? { tone: "success", text: "Split saved." } : { tone: "error", text: r.error });
            })
          }
        >
          {pending ? "Saving…" : "Save split"}
        </Button>
        {initial.length ? (
          <Button
            variant="quiet"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveSplitsAction({ transactionId, amount, lines: [] });
                setMessage(r.ok ? { tone: "success", text: "No longer split." } : { tone: "error", text: r.error });
              })
            }
          >
            Remove the split
          </Button>
        ) : null}
      </div>
      {message ? <Notice tone={message.tone} title={message.text} /> : null}
    </div>
  );
}

/** Tags, events and people: added by the family only (never suggested). */
export function DetailEditor({
  transactionId,
  kind,
  label,
  items,
}: {
  transactionId: string;
  kind: "tag" | "event" | "person";
  label: string;
  items: { id: string; name: string }[];
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <p className="type-label font-semibold">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? <span className="type-label text-muted-foreground">None</span> : null}
        {items.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-1">
            <Chip tone="neutral">
              <span dir="auto">{item.name}</span>
            </Chip>
            <button
              type="button"
              className="type-label min-h-8 rounded-full px-2 text-teal-text underline-offset-4 hover:underline"
              aria-label={`Remove ${item.name}`}
              disabled={pending}
              onClick={() => start(async () => void (await removeDetailAction({ kind, detailId: item.id, transactionId })))}
            >
              Remove
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input aria-label={`Add ${kind === "event" ? "an" : "a"} ${kind}`} placeholder={`Add ${kind === "event" ? "an" : "a"} ${kind}`} value={name} dir="auto" onChange={(e) => setName(e.target.value)} />
        <Button
          variant="secondary"
          disabled={pending || !name.trim()}
          onClick={() =>
            start(async () => {
              const r = await addDetailAction({ kind, name, transactionIds: [transactionId] });
              if (!r.ok) return setError(r.error);
              setError(null);
              setName("");
            })
          }
        >
          Add
        </Button>
      </div>
      {error ? <p className="text-error">{error}</p> : null}
    </div>
  );
}

export function NotesEditor({ transactionId, notes }: { transactionId: string; notes: string | null }) {
  const [value, setValue] = useState(notes ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <label htmlFor="notes" className="type-label block font-semibold">
        Note
      </label>
      <textarea
        id="notes"
        dir="auto"
        rows={3}
        maxLength={1000}
        className="w-full rounded-md border border-input bg-card p-3 text-base"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={pending || value === (notes ?? "")}
          onClick={() =>
            start(async () => {
              const r = await notesAction({ transactionId, notes: value });
              setSaved(r.ok ? "Note saved." : r.error);
            })
          }
        >
          Save note
        </Button>
        {saved ? <span role="status">{saved}</span> : null}
      </div>
    </div>
  );
}
