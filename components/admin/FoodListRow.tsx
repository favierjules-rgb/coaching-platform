"use client";

import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";

import type { FoodListSummary } from "@/lib/supabase/food-lists";
import { ColorKeyDot } from "@/components/ui/ColorKeyDot";

/**
 * N1.2 — UNE LIGNE DE L'INDEX.
 *
 * Extraite de la page pour être MESURABLE : un débordement horizontal ne se
 * prouve que dans un moteur de rendu, et une page entière branchée sur des
 * hooks de données ne se rend pas hors du navigateur. Cette ligne-ci, si.
 *
 * ⚠️ C'est elle qui porte le nom le plus long de l'écran. `min-w-0` + `truncate`
 * sur le nom, `flex-shrink-0` sur l'action : sans le premier, un nom sans
 * espace pousse la ligne au-delà du viewport, quel que soit le `truncate`.
 */
export function FoodListRow({
  liste,
  occupe,
  desactive,
  onDupliquer,
}: {
  readonly liste: FoodListSummary;
  readonly occupe: boolean;
  readonly desactive: boolean;
  readonly onDupliquer: () => void;
}) {
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-panel border border-border bg-card px-4 py-3">
        <Link
          href={`/admin/nutrition/listes/${liste.id}`}
          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-control transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="flex min-w-0 items-center gap-2">
            {/* ⚠️ N1.6A — PASTILLE AVANT LE NOM, jamais à la place. */}
            <ColorKeyDot colorKey={liste.colorKey} />
            <span className="truncate text-sm font-bold text-foreground">{liste.name}</span>
            {liste.archivedAt !== null && (
              <span className="flex-shrink-0 rounded-control border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Archivée
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {liste.nbAliments} aliment{liste.nbAliments > 1 ? "s" : ""}
          </span>
        </Link>
        <button
          type="button"
          onClick={onDupliquer}
          disabled={desactive}
          aria-label={`Dupliquer ${liste.name}`}
          className="pressable flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-control border border-border px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {occupe ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
          Dupliquer
        </button>
      </div>
    </li>
  );
}
