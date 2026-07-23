import type { ReactNode } from "react";
import { Dumbbell } from "lucide-react";

import { BLOCK_COLOR_STYLES } from "@/components/admin/blocks/block-view-model";
import { normalizeColorKey } from "@/lib/training-block-editing";

/**
 * Carte d'un bloc de MUSCULATION dans le détail d'une séance élève. Purement
 * présentationnelle : en-tête (colorKey canonique + catégorie + titre) puis
 * ses exercices (passés en `children`, dans l'ordre canonique). Ne concatène
 * jamais les exercices de plusieurs blocs — chaque bloc a sa propre carte.
 */
export function StudentStrengthBlockCard({
  colorKey,
  title,
  children,
}: {
  colorKey: string;
  title: string | null;
  children: ReactNode;
}) {
  const color = BLOCK_COLOR_STYLES[normalizeColorKey(colorKey, "gray")];
  return (
    <section className={`rounded-card border border-l-4 border-border ${color.borderLeft} ${color.softBg} p-5 shadow-soft`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${color.dot}`} aria-hidden="true" />
        <Dumbbell size={15} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Musculation</span>
        {title ? <h2 className="font-heading text-sm font-bold uppercase text-foreground">· {title}</h2> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
