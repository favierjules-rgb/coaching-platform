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
    tone === "primary" ? "text-primary" : tone === "amber" ? "text-amber-400" : "text-muted-foreground";
  return (
    <div className="border border-border bg-card p-5">
      <Icon size={18} className={iconClass} />
      <div className="mt-3 font-heading text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
