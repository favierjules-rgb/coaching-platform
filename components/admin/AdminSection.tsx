import type { ReactNode } from "react";

export function AdminSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

export function TagList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="border border-border px-3 py-1 text-xs text-muted-foreground">
          {item}
        </span>
      ))}
    </div>
  );
}
