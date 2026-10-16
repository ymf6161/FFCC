export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-4 lg:mb-6">
      <h1 className="type-title">{title}</h1>
      {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
    </header>
  );
}
