import type { ReactNode } from "react";

export function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-border bg-card p-6">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

export function TagList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="border border-border px-3 py-1 text-xs text-muted-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
