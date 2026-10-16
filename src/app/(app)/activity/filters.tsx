import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

type Option = { id: string; name: string };
export type FilterValues = { q?: string; account?: string; category?: string; status?: string; from?: string; to?: string; tag?: string; event?: string; person?: string };

/** Search and filters as a plain GET form, so every filtered view has its own link. */
export function ActivityFilters({
  values,
  accounts,
  categories,
  tags,
  events,
  persons,
}: {
  values: FilterValues;
  accounts: Option[];
  categories: (Option & { kind: string })[];
  tags: Option[];
  events: Option[];
  persons: Option[];
}) {
  const more = Boolean(values.account || values.category || values.from || values.to || values.tag || values.event || values.person);
  return (
    <form method="get" action="/activity" className="mb-4 rounded-lg bg-card p-4 lg:p-5" role="search" aria-label="Search transactions">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search" htmlFor="q" className="flex-1">
          <Input id="q" name="q" defaultValue={values.q} dir="auto" placeholder="Shop, description or note" />
        </Field>
        <Field label="Show" htmlFor="status" className="sm:w-48">
          <Select id="status" name="status" defaultValue={values.status ?? ""}>
            <option value="">Everything</option>
            <option value="unconfirmed">Not sure</option>
            <option value="auto">Sorted automatically</option>
            <option value="confirmed">Confirmed</option>
          </Select>
        </Field>
        <Button type="submit" className="sm:w-auto">
          Search
        </Button>
      </div>
      <details className="mt-3" open={more}>
        <summary className="type-label cursor-pointer py-2 font-semibold text-teal-text">More filters</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Account" htmlFor="account">
            <Select id="account" name="account" defaultValue={values.account ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" name="category" defaultValue={values.category ?? ""}>
              <option value="">All categories</option>
              <option value="none">Not sorted yet</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={values.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={values.to} />
          </Field>
          {tags.length ? <DetailSelect id="tag" label="Tag" options={tags} value={values.tag} /> : null}
          {events.length ? <DetailSelect id="event" label="Event" options={events} value={values.event} /> : null}
          {persons.length ? <DetailSelect id="person" label="Person" options={persons} value={values.person} /> : null}
        </div>
      </details>
      {Object.values(values).some(Boolean) ? (
        <p className="mt-2">
          <Link href="/activity" className="text-teal-text underline-offset-4 hover:underline">
            Clear search and filters
          </Link>
        </p>
      ) : null}
    </form>
  );
}

function DetailSelect({ id, label, options, value }: { id: string; label: string; options: Option[]; value?: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} name={id} defaultValue={value ?? ""}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} dir="auto">
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
