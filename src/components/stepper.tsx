/** DESIGN.md stepper: "Step 2 of 4: Check the columns" with a teal progress bar. */
export function Stepper({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="mb-5">
      <p className="type-label text-muted-foreground">
        Step {step} of {total}
      </p>
      <h2 className="type-heading mt-0.5">{title}</h2>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${total}`}
      >
        <div className="h-full rounded-full bg-teal transition-[width] duration-200" style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}
