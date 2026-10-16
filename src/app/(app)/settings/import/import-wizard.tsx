"use client";

import { useMemo, useState, useTransition } from "react";
import { Chip } from "@/components/chip";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { Stepper } from "@/components/stepper";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DATE_FORMAT_LABELS, DATE_FORMATS, type DateFormat } from "@/import/parse-values";
import { formatFullDate } from "@/lib/dates";
import {
  type AnalyseResult,
  analyseUpload,
  confirmImportAction,
  headersAt,
  type PreviewResult,
  previewImportAction,
} from "./actions";
import { ACCOUNT_TYPE_LABELS, NEW_ACCOUNT_TYPES } from "./shared";

type Account = { id: string; name: string; type: keyof typeof ACCOUNT_TYPE_LABELS };
type NewType = (typeof NEW_ACCOUNT_TYPES)[number];

type Form = {
  headerRow: number;
  dateColumn: string;
  dateFormat: DateFormat;
  amountStyle: "one" | "two";
  amountColumn: string;
  signConvention: "money_in_positive" | "money_out_positive";
  debitColumn: string;
  creditColumn: string;
  descriptionColumns: string[];
  runningBalanceColumn: string;
  externalIdColumn: string;
};

const STEPS = ["Choose a file", "Check the columns", "Check the rows", "Import"];
const NEW = "__new__";

/** Reads the file as UTF-8, falling back to Windows-1252 (common for older bank exports with £ signs). */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function formFromMapping(mapping: Record<string, unknown>, headerRow: number): Form {
  const str = (k: string) => (typeof mapping[k] === "string" ? (mapping[k] as string) : "");
  const twoColumns = !mapping.amountColumn && !!mapping.debitColumn;
  return {
    headerRow,
    dateColumn: str("dateColumn"),
    dateFormat: (DATE_FORMATS as readonly string[]).includes(str("dateFormat")) ? (str("dateFormat") as DateFormat) : "dd/mm/yyyy",
    amountStyle: twoColumns ? "two" : "one",
    amountColumn: str("amountColumn"),
    signConvention: mapping.signConvention === "money_out_positive" ? "money_out_positive" : "money_in_positive",
    debitColumn: str("debitColumn"),
    creditColumn: str("creditColumn"),
    descriptionColumns: Array.isArray(mapping.descriptionColumns) ? (mapping.descriptionColumns as string[]) : [],
    runningBalanceColumn: str("runningBalanceColumn"),
    externalIdColumn: str("externalIdColumn"),
  };
}

function mappingFromForm(f: Form) {
  const opt = (v: string) => (v ? v : undefined);
  return {
    headerRow: f.headerRow,
    dateColumn: f.dateColumn,
    dateFormat: f.dateFormat,
    ...(f.amountStyle === "one"
      ? { amountColumn: opt(f.amountColumn) }
      : { debitColumn: opt(f.debitColumn), creditColumn: opt(f.creditColumn) }),
    signConvention: f.signConvention,
    descriptionColumns: f.descriptionColumns,
    runningBalanceColumn: opt(f.runningBalanceColumn),
    externalIdColumn: opt(f.externalIdColumn),
  };
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export function ImportWizard({ accounts }: { accounts: Account[] }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [accountChoice, setAccountChoice] = useState(accounts[0]?.id ?? NEW);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<NewType>("current");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);

  const [analysis, setAnalysis] = useState<Extract<AnalyseResult, { ok: true }> | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [profileName, setProfileName] = useState("");
  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);

  const target = useMemo(
    () => (accountChoice === NEW ? { newAccount: { name: newName.trim(), type: newType } } : { accountId: accountChoice }),
    [accountChoice, newName, newType],
  );
  const accountLabel = accountChoice === NEW ? newName.trim() || "the new account" : (accounts.find((a) => a.id === accountChoice)?.name ?? "");

  const update = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setPreview(null);
  };

  function goToColumns() {
    setError(null);
    if (accountChoice === NEW && !newName.trim()) return setError("Give the new account a name.");
    if (!file) return setError("Choose a CSV file exported from your bank.");
    startTransition(async () => {
      const result = await analyseUpload({ csvText: file.text });
      if (!result.ok) return setError(result.error);
      setAnalysis(result);
      setHeaders(result.headers);
      setForm(formFromMapping(result.mapping, result.headerRow));
      setProfileName(result.recognisedAs ?? "");
      setStep(2);
    });
  }

  function changeHeaderRow(headerRow: number) {
    if (!file) return;
    startTransition(async () => {
      const result = await headersAt({ csvText: file.text, headerRow });
      if (!result.ok) return setError(result.error);
      setHeaders(result.headers);
      update({ headerRow, dateColumn: "", amountColumn: "", debitColumn: "", creditColumn: "", descriptionColumns: [], runningBalanceColumn: "", externalIdColumn: "" });
    });
  }

  function goToPreview() {
    setError(null);
    if (!file || !form) return;
    if (!form.dateColumn) return setError("Choose the date column.");
    if (form.amountStyle === "one" ? !form.amountColumn : !form.debitColumn || !form.creditColumn)
      return setError(form.amountStyle === "one" ? "Choose the amount column." : "Choose both the paid-out and the paid-in columns.");
    if (form.descriptionColumns.length === 0) return setError("Choose at least one description column.");
    startTransition(async () => {
      const result = await previewImportAction({ target, csvText: file.text, mapping: mappingFromForm(form) });
      if (!result.ok) return setError(result.error);
      setPreview(result);
      setStep(3);
    });
  }

  function runImport() {
    setError(null);
    if (!file || !form) return;
    startTransition(async () => {
      const result = await confirmImportAction({ target, fileName: file.name, csvText: file.text, mapping: mappingFromForm(form), profileName: profileName || "My bank" });
      // On success the action redirects; anything returned is an error.
      if (result && !result.ok) setError(result.error);
    });
  }

  const back = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const toStore = preview ? preview.counts.new + preview.counts.nearDuplicate : 0;

  return (
    <section className="rounded-lg bg-card p-5 lg:p-6" aria-live="polite">
      <Stepper step={step} total={STEPS.length} title={STEPS[step - 1]!} />

      {error ? (
        <div className="mb-4">
          <Notice tone="error" title={error} />
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Which account is this statement for?" htmlFor="account">
            <Select id="account" value={accountChoice} onChange={(e) => setAccountChoice(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({ACCOUNT_TYPE_LABELS[a.type]})
                </option>
              ))}
              <option value={NEW}>A new account</option>
            </Select>
          </Field>
          {accountChoice === NEW ? (
            <>
              <Field label="Name of the new account" htmlFor="new-name" hint="For example: Joint current account">
                <Input id="new-name" value={newName} maxLength={60} dir="auto" onChange={(e) => setNewName(e.target.value)} />
              </Field>
              <Field label="Type of account" htmlFor="new-type">
                <Select id="new-type" value={newType} onChange={(e) => setNewType(e.target.value as NewType)}>
                  {NEW_ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Field
            label="Bank statement (CSV file)"
            htmlFor="file"
            hint="Export the statement from your bank’s website as CSV. Importing the same file twice is safe: nothing is added twice."
            className="md:col-span-2"
          >
            <input
              id="file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full rounded-md border border-input bg-card p-3 text-base file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-sunken file:px-4 file:font-bold file:text-foreground"
              onChange={async (e) => {
                const chosen = e.target.files?.[0];
                setError(null);
                setFile(chosen ? { name: chosen.name, text: await readText(chosen) } : null);
              }}
            />
          </Field>
          <div className="md:col-span-2">
            <Button onClick={goToColumns} disabled={pending}>
              {pending ? "Reading the file…" : "Continue"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 && form && analysis ? (
        <div className="space-y-5">
          {analysis.recognisedAs ? (
            <Notice tone="success" title={`We recognised this layout: ${analysis.recognisedAs}.`}>
              Check the columns below, then continue.
            </Notice>
          ) : (
            <Notice tone="warning" title="We haven’t seen this layout before.">
              We’ve made a first guess. Please check each column below; we’ll remember your choices for next time.
            </Notice>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Column names are on row" htmlFor="header-row" hint="Some banks put an account summary above the table.">
              <Select id="header-row" value={form.headerRow} onChange={(e) => changeHeaderRow(Number(e.target.value))}>
                {Array.from({ length: 15 }, (_, i) => (
                  <option key={i} value={i}>
                    Row {i + 1}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Save these settings as" htmlFor="profile-name" hint="Next time a file like this is recognised straight away.">
              <Input id="profile-name" value={profileName} maxLength={80} placeholder="My bank" onChange={(e) => setProfileName(e.target.value)} />
            </Field>

            <ColumnSelect id="date-col" label="Date" headers={headers} value={form.dateColumn} onChange={(v) => update({ dateColumn: v })} />
            <Field label="Dates look like" htmlFor="date-format">
              <Select id="date-format" value={form.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {DATE_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Amounts are in" htmlFor="amount-style" className="md:col-span-2">
              <Select id="amount-style" value={form.amountStyle} onChange={(e) => update({ amountStyle: e.target.value as Form["amountStyle"] })}>
                <option value="one">One column</option>
                <option value="two">Two columns: paid out and paid in</option>
              </Select>
            </Field>
            {form.amountStyle === "one" ? (
              <>
                <ColumnSelect id="amount-col" label="Amount" headers={headers} value={form.amountColumn} onChange={(v) => update({ amountColumn: v })} />
                <Field label="In this column, money out is shown as" htmlFor="sign" hint="Card statements often show spending as positive.">
                  <Select id="sign" value={form.signConvention} onChange={(e) => update({ signConvention: e.target.value as Form["signConvention"] })}>
                    <option value="money_in_positive">Negative (−12.50 is money out)</option>
                    <option value="money_out_positive">Positive (12.50 is money out)</option>
                  </Select>
                </Field>
              </>
            ) : (
              <>
                <ColumnSelect id="debit-col" label="Paid out" headers={headers} value={form.debitColumn} onChange={(v) => update({ debitColumn: v })} />
                <ColumnSelect id="credit-col" label="Paid in" headers={headers} value={form.creditColumn} onChange={(v) => update({ creditColumn: v })} />
              </>
            )}

            <fieldset className="space-y-2 md:col-span-2">
              <legend className="type-label font-semibold">Description (choose one or more)</legend>
              <div className="flex flex-wrap gap-2">
                {headers.map((h, i) =>
                  h ? (
                    <label key={`${h}-${i}`} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-input px-4 has-[:checked]:border-teal has-[:checked]:bg-sunken">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--teal)]"
                        checked={form.descriptionColumns.includes(h)}
                        onChange={(e) =>
                          update({
                            descriptionColumns: e.target.checked ? [...form.descriptionColumns, h] : form.descriptionColumns.filter((c) => c !== h),
                          })
                        }
                      />
                      <span dir="auto">{h}</span>
                    </label>
                  ) : null,
                )}
              </div>
            </fieldset>

            <ColumnSelect
              id="balance-col"
              label="Balance (optional)"
              hint="If your bank includes a running balance, we use it to check our figures."
              headers={headers}
              value={form.runningBalanceColumn}
              optional
              onChange={(v) => update({ runningBalanceColumn: v })}
            />
            <ColumnSelect
              id="id-col"
              label="Transaction ID (optional)"
              hint="A unique reference per payment, if your bank provides one."
              headers={headers}
              value={form.externalIdColumn}
              optional
              onChange={(v) => update({ externalIdColumn: v })}
            />
          </div>

          <SampleTable headers={headers} rows={analysis.headerRow === form.headerRow ? analysis.sampleRows : []} />

          <div className="flex flex-wrap gap-3">
            <Button onClick={goToPreview} disabled={pending}>
              {pending ? "Checking the rows…" : "Continue"}
            </Button>
            <Button variant="secondary" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && preview ? (
        <div className="space-y-5">
          <p className="text-[1.0625rem]">
            {plural(preview.counts.total, "row")} in the file: <strong>{preview.counts.new.toLocaleString("en-GB")} new</strong>
            {preview.counts.duplicate ? `, ${preview.counts.duplicate.toLocaleString("en-GB")} already imported` : ""}
            {preview.counts.nearDuplicate ? `, ${preview.counts.nearDuplicate.toLocaleString("en-GB")} to check` : ""}
            {preview.counts.error ? `, ${preview.counts.error.toLocaleString("en-GB")} we can’t read` : ""}.
          </p>
          {preview.firstDate && preview.lastDate ? (
            <p className="text-muted-foreground">
              From {formatFullDate(preview.firstDate)} to {formatFullDate(preview.lastDate)}. Money in{" "}
              <Money pence={preview.moneyIn} kind="in" />, money out <Money pence={preview.moneyOut} kind="out" />. If money in and out look the wrong way round, go back and change how money out is shown.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-divider">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">The first 20 rows of the file</caption>
              <thead className="bg-sunken">
                <tr className="type-label text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatFullDate(r.date)}</td>
                    <td className="px-3 py-3" dir="auto">
                      {r.description}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <Money pence={r.amount} kind={r.amount > 0 ? "in" : "out"} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.balance === null ? "" : <Money pence={r.balance} kind="balance" />}</td>
                    <td className="px-3 py-3">
                      {r.status === "new" ? <Chip tone="success">New</Chip> : r.status === "duplicate" ? <Chip tone="neutral">Already imported</Chip> : <Chip tone="warning">Possible duplicate</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.counts.total > preview.rows.length ? (
            <p className="type-label text-muted-foreground">Showing the first {preview.rows.length} rows in date order.</p>
          ) : null}

          {preview.errors.length > 0 ? (
            <Notice tone="warning" title={`${plural(preview.counts.error, "row")} can’t be read and will be left out`}>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {preview.errors.map((e) => (
                  <li key={e.rowNumber}>
                    Row {e.rowNumber}: {e.reason}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {preview.counts.nearDuplicate > 0 ? (
            <Notice tone="warning" title={`${plural(preview.counts.nearDuplicate, "payment")} look like ones already here`}>
              They will be imported, and we’ll ask you whether each one is the same payment.
            </Notice>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setStep(4)} disabled={pending}>
              Continue
            </Button>
            <Button variant="secondary" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {step === 4 && preview ? (
        <div className="space-y-5">
          <p className="type-subheading">
            {toStore === 0
              ? `Everything in this file is already in ${accountLabel}. Importing will add nothing.`
              : `Import ${plural(toStore, "transaction")} into ${accountLabel}?`}
          </p>
          <p className="text-muted-foreground">
            {preview.counts.duplicate ? `${plural(preview.counts.duplicate, "row")} already here will be skipped. ` : ""}
            You can undo this import at any time from Settings.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={runImport} disabled={pending}>
              {pending ? "Importing…" : toStore === 0 ? "Record this import" : `Import ${plural(toStore, "transaction")}`}
            </Button>
            <Button variant="secondary" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ColumnSelect({
  id,
  label,
  headers,
  value,
  onChange,
  optional = false,
  hint,
}: {
  id: string;
  label: string;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? "None" : "Choose a column"}</option>
        {headers.map((h, i) =>
          h ? (
            <option key={`${h}-${i}`} value={h}>
              {h}
            </option>
          ) : null,
        )}
      </Select>
    </Field>
  );
}

function SampleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="type-label mb-2 font-semibold">The first rows of your file</p>
      <div className="overflow-x-auto rounded-md border border-divider">
        <table className="w-full text-left text-[0.9375rem]">
          <thead className="bg-sunken">
            <tr className="type-label text-muted-foreground">
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-medium" dir="auto">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {rows.map((r, i) => (
              <tr key={i}>
                {headers.map((_, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-2" dir="auto">
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
