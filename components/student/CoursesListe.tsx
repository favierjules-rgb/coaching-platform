"use client";

import { NBSP, formatDecimalFr } from "@/lib/nutrition/basis-points";
import {
  LIBELLES_RAYONS,
  lignesParRayon,
  type LigneCourses,
} from "@/lib/courses/agregation";
import type { AvertissementCourses } from "@/lib/courses/besoins";

/**
 * COURSES C1 — LA LISTE, PREMIÈRE VERSION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE C1 N'AFFICHE PAS, ET C'EST VOULU
 * ────────────────────────────────────────────────────────────────────────────
 * Ni prix, ni magasin, ni conditionnement, ni budget, ni placard, ni PDF, ni
 * partage. Le §10 du cahier des charges les renvoie aux lots suivants, et les
 * esquisser ici donnerait l'illusion d'une fonctionnalité qui n'existe pas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE COMPOSANT NE CALCULE RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Il reçoit des lignes déjà agrégées par `lib/courses/agregation.ts` et les
 * range par rayon. Aucune quantité n'est additionnée ici, aucune unité
 * convertie — refaire l'addition à l'affichage créerait un second total.
 */

/** Une unité telle qu'on l'écrit à l'élève. `piece` reste une pièce. */
export function afficherUnite(quantite: number, unite: string): string {
  if (unite === "g" || unite === "ml") return unite;
  const pluriel = quantite >= 2;
  if (unite === "piece") return pluriel ? "pièces" : "pièce";
  if (unite === "portion") return pluriel ? "portions" : "portion";
  // Unité libre venue d'une recette (« wrap », « tranche ») : on la rend telle
  // quelle, au pluriel simple. Aucune conversion en grammes — décision 4.
  return pluriel ? `${unite}s` : unite;
}

export function LigneCoursesLigne({ ligne }: { ligne: LigneCourses }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{ligne.label}</span>
      <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
        {formatDecimalFr(ligne.quantite, ligne.quantite % 1 === 0 ? 0 : 1)}
        {NBSP}
        {afficherUnite(ligne.quantite, ligne.unite)}
      </span>
    </li>
  );
}

const MESSAGES: Readonly<Record<AvertissementCourses["code"], string>> = {
  aucun_plan: "Aucun plan alimentaire n'est assigné sur cette période.",
  aucune_cible: "Un repas de ta journée n'a pas d'objectif défini.",
  aucune_recette: "Aucune recette disponible pour l'un des repas.",
  tout_exclu: "Tout ce qui était disponible pour un repas a été écarté par tes exclusions.",
  cible_approchee: "Une recette approche l'objectif sans l'atteindre exactement.",
  cible_impossible: "Une recette ne peut pas atteindre l'objectif demandé.",
  variete_limitee: "Peu de recettes disponibles pour un repas : il revient plusieurs fois.",
};

export function CoursesListe({
  titre,
  periode,
  lignes,
  avertissements,
}: {
  titre: string;
  /** « du 14 au 16 août », déjà formaté par `libellePeriode`. */
  periode: string;
  lignes: readonly LigneCourses[];
  avertissements: readonly AvertissementCourses[];
}) {
  const rayons = lignesParRayon(lignes);
  // Un message par CODE, pas un par occurrence : sept jours sans recette
  // produiraient sinon sept fois la même phrase.
  const codes = [...new Set(avertissements.map((a) => a.code))];

  return (
    <section aria-label="Liste de courses" className="flex flex-col gap-4">
      <header>
        <h2 className="font-heading text-lg font-bold uppercase tracking-widest text-foreground">
          {titre}
        </h2>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{periode}</p>
      </header>

      {codes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-panel border border-border bg-surface-soft/40 px-3 py-2">
          {codes.map((c) => (
            <li key={c} className="text-xs text-muted-foreground">
              {MESSAGES[c]}
            </li>
          ))}
        </ul>
      )}

      {rayons.length === 0 ? (
        <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Aucun article à acheter pour cette période.
        </p>
      ) : (
        rayons.map(([rayon, ligne]) => (
          <div key={rayon} className="rounded-panel border border-border bg-card px-3 py-2">
            <h3 className="border-b border-border pb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {LIBELLES_RAYONS[rayon]}
            </h3>
            <ul className="flex flex-col divide-y divide-border">
              {ligne.map((l) => (
                <LigneCoursesLigne key={`${l.identity}|${l.unite}`} ligne={l} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
