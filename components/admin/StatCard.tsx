import type { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "default" | "primary" | "amber";
}) {
  const iconClass =
    tone === "primary" ? "text-primary" : tone === "amber" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-soft">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-panel bg-surface-soft/60">
        <Icon size={18} className={iconClass} />
      </span>
      <div className="mt-3 font-heading text-2xl font-bold leading-none text-foreground">{value}</div>
      <div className="mt-1.5 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
