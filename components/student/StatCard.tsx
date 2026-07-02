import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  accent?: boolean;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  accent = false,
}: StatCardProps) {
  return (
    <div className="border border-border bg-card p-5">
      <Icon size={18} className={`mb-3 ${accent ? "text-green-400" : "text-primary"}`} />
      <div
        className={`mb-1 font-heading text-xl font-bold ${
          accent ? "text-green-400" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
