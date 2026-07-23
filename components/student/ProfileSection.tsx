import type { ReactNode } from "react";

export function ProfileSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

export function TagList({ items }: { items: string[] }) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {safeItems.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border bg-surface-soft/50 px-3 py-1 text-xs text-muted-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
