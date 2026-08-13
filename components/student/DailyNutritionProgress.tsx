"use client";

import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import type { MacroTotals } from "@/lib/nutrition/consumed";
import { anneau, calculerProgression, largeurBarre } from "@/lib/nutrition/progression";

/**
 * LE RÉSUMÉ VISUEL D'UNE JOURNÉE (ALIMENTS A5.6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNE HIÉRARCHIE, PAS UN TABLEAU DE BORD
 * ────────────────────────────────────────────────────────────────────────────
 * Les calories sont l'information principale : un anneau, au centre, lisible
 * d'un coup d'œil. Les trois macros sont secondaires : trois barres compactes,
 * sous le cercle. Les repas restent le contenu principal de la page, et ce bloc
 * ne doit pas les repousser hors de l'écran.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DES BARRES SOBRES, ET LE ROUGE RÉSERVÉ AU DÉPASSEMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Les trois macros partagent la MÊME couleur — celle du texte principal. Leur
 * distinction se lit dans leur libellé, pas dans un code couleur : donner à
 * chaque macro sa teinte fixe ferait de cet écran un tableau de bord d'appli
 * de fitness, et surtout rendrait le rouge illisible comme signal, puisqu'une
 * barre serait rouge en permanence.
 *
 * `destructive` ne sert donc QU'À une chose : dire qu'un objectif est dépassé.
 * Quand il apparaît, il veut dire quelque chose.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE COMPOSANT NE CALCULE RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Il reçoit `consommé` et `objectif` déjà établis — les mêmes objets que
 * `DailyIntakeSummary` — et les transforme en géométrie via
 * `lib/nutrition/progression.ts`. Aucun 4/4/9 n'est réécrit ici.
 */

export function DailyNutritionProgress({
  objectif,
  consommé,
}: {
  /** `null` quand aucun profil n'est prescrit ce jour-là. On n'invente pas d'objectif. */
  objectif: MacroTotals | null;
  consommé: MacroTotals;
}) {
  const kcal = calculerProgression(consommé.kcal, objectif?.kcal ?? null);

  return (
    <section
      aria-label="Résumé de la journée"
      className="flex flex-col items-center gap-4 rounded-panel border border-border bg-surface-soft/40 p-4"
    >
      <CalorieRing
        consommé={kcal.consomme}
        cible={kcal.cible}
        part={kcal.part}
        restant={kcal.restant}
        dépasse={kcal.depasse}
      />

      <dl className="flex w-full flex-col gap-2">
        <MacroProgressBar
          libellé="Protéines"
          court="P"
          consommé={consommé.proteinG}
          cible={objectif?.proteinG ?? null}
        />
        <MacroProgressBar
          libellé="Glucides"
          court="G"
          consommé={consommé.carbG}
          cible={objectif?.carbG ?? null}
        />
        <MacroProgressBar
          libellé="Lipides"
          court="L"
          consommé={consommé.fatG}
          cible={objectif?.fatG ?? null}
        />
      </dl>
    </section>
  );
}

/**
 * L'ANNEAU DES CALORIES.
 *
 * ⚠️ LE TRACÉ EST PLAFONNÉ, LE TEXTE NE L'EST JAMAIS. `part` vaut au plus 1 —
 * un anneau ne peut pas faire plus d'un tour — mais le centre continue
 * d'afficher 1 950 / 1 800 et le dépassement est écrit en toutes lettres.
 */
export function CalorieRing({
  consommé,
  cible,
  part,
  restant,
  dépasse,
  rayon = 52,
  épaisseur = 8,
}: {
  consommé: number;
  cible: number | null;
  part: number;
  restant: number | null;
  dépasse: boolean;
  rayon?: number;
  épaisseur?: number;
}) {
  const { dashArray, dashOffset } = anneau(rayon, part);
  const taille = (rayon + épaisseur) * 2;
  const centre = taille / 2;

  return (
    <div className="relative" style={{ width: taille, height: taille }}>
      <svg
        width={taille}
        height={taille}
        viewBox={`0 0 ${taille} ${taille}`}
        aria-hidden="true"
        className="block"
      >
        {/* La piste : l'objectif entier, toujours visible. Sans elle, un jour à
            10 % ressemblerait à un trait perdu dans le vide. */}
        <circle
          cx={centre}
          cy={centre}
          r={rayon}
          fill="none"
          stroke="currentColor"
          strokeWidth={épaisseur}
          className="text-border"
        />
        {/* Le remplissage. `rotate(-90)` fait partir l'anneau du haut : sans
            cette rotation, SVG commence à trois heures, et la progression
            paraîtrait décalée d'un quart de tour. */}
        <circle
          cx={centre}
          cy={centre}
          r={rayon}
          fill="none"
          stroke="currentColor"
          strokeWidth={épaisseur}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${centre} ${centre})`}
          // Transition COURTE et discrète : l'anneau rejoint sa nouvelle valeur
          // quand un aliment est ajouté, sans animation d'entrée ni rebond.
          className={`transition-[stroke-dashoffset] duration-500 ease-out ${
            dépasse ? "text-destructive" : "text-primary"
          }`}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-heading text-2xl font-bold tabular-nums leading-none text-foreground">
          {formatIntegerFr(Math.round(consommé))}
        </span>
        {cible === null ? (
          <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            kcal
          </span>
        ) : (
          <>
            <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              / {formatIntegerFr(Math.round(cible))}
              {NBSP}kcal
            </span>
            {restant !== null && (
              <span
                className={`mt-1 text-[11px] tabular-nums ${
                  dépasse ? "font-bold text-destructive" : "text-muted-foreground"
                }`}
              >
                {dépasse
                  ? `+${formatIntegerFr(Math.round(-restant))}${NBSP}kcal`
                  : `${formatIntegerFr(Math.round(restant))}${NBSP}kcal restantes`}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * UNE BARRE DE MACRO.
 *
 * Sobre : la même couleur que le texte principal, et un libellé pour la
 * distinguer. Le dépassement est le SEUL cas qui change la couleur — c'est ce
 * qui lui donne son sens.
 */
export function MacroProgressBar({
  libellé,
  court,
  consommé,
  cible,
}: {
  libellé: string;
  /** Une lettre, pour les écrans étroits. */
  court: string;
  consommé: number;
  cible: number | null;
}) {
  const p = calculerProgression(consommé, cible);

  return (
    <div className="flex items-center gap-3">
      <dt className="w-4 flex-shrink-0 text-xs font-bold uppercase text-muted-foreground">
        <abbr title={libellé} className="no-underline">
          {court}
        </abbr>
      </dt>
      <div
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={
          p.cible === null
            ? `${libellé} : ${formatDecimalFr(p.consomme, 0)} g consommés, aucun objectif`
            : `${libellé} : ${formatDecimalFr(p.consomme, 0)} g sur ${formatDecimalFr(p.cible, 0)} g`
        }
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            p.depasse ? "bg-destructive" : "bg-foreground"
          }`}
          style={{ width: largeurBarre(p.part) }}
        />
      </div>
      <dd
        className={`w-20 flex-shrink-0 text-right text-xs tabular-nums ${
          p.depasse ? "font-bold text-destructive" : "text-muted-foreground"
        }`}
      >
        {formatDecimalFr(p.consomme, 0)}
        {p.cible === null ? (
          <>{NBSP}g</>
        ) : (
          <>
            {NBSP}/{NBSP}
            {formatDecimalFr(p.cible, 0)}
            {NBSP}g
          </>
        )}
      </dd>
    </div>
  );
}
