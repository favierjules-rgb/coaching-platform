import type { LucideIcon } from "lucide-react";

export type StatCardTone = "default" | "positive" | "negative";

const toneTextClass: Record<StatCardTone, string> = {
  default: "text-foreground",
  positive: "text-success",
  negative: "text-destructive",
};

interface StatCardProps {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: StatCardTone;
  /** "md" (défaut, listes compactes type dashboard/progression) ou "lg"
   *  (ligne de chiffres clés en tête d'une page de détail, ex. programme /
   *  plan nutrition). Deux tailles contrôlées plutôt qu'une valeur libre par
   *  page — audit design juillet 2026, Lot 2. */
  size?: "md" | "lg";
}

/**
 * Carte "chiffre clé" partagée (icône optionnelle + valeur + label + note
 * secondaire optionnelle) — fusionne deux implémentations quasi identiques
 * qui coexistaient (components/student/StatCard.tsx et le SummaryCard
 * interne de components/shared/ProgressSummaryCards.tsx). Le StatCard de
 * components/shared/TrainingMetricsSummary.tsx n'est délibérément pas
 * fusionné ici : il est aussi rendu depuis components/admin/ProgramBuilder.tsx
 * (Training Builder), hors périmètre tant que le Lot 3 n'est pas validé
 * (audit design juillet 2026, Lot 2).
 */
export function StatCard({ icon: Icon, label, value, hint, tone = "default", size = "md" }: StatCardProps) {
  const valueSizeClass = size === "lg" ? "text-2xl" : "text-xl";
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-soft">
      {Icon && (
        <Icon
          size={18}
          className={`mb-3 ${tone === "default" ? "text-primary" : toneTextClass[tone]}`}
          aria-hidden="true"
        />
      )}
      <div className={`font-heading ${valueSizeClass} font-bold ${toneTextClass[tone]}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
