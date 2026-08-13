"use client";

import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import type { MacroTotals } from "@/lib/nutrition/consumed";

/**
 * OBJECTIF · CONSOMMÉ · RESTANT — la synthèse d'une journée (§7 de l'énoncé).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE DÉPASSEMENT S'AFFICHE, IL NE SE TRONQUE PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Quand le restant devient négatif, on l'écrit négatif, en rouge. Ramener à
 * zéro effacerait exactement l'information que l'élève est venu chercher : de
 * combien il a dépassé.
 *
 * L'objectif est celui du JOUR, prescrit par le coach. Le consommé additionne
 * TOUT : repas prescrits ET repas libres. Une collation compte autant qu'un
 * déjeuner.
 */
export function DailyIntakeSummary({
  objectif,
  consommé,
}: {
  /** `null` quand le profil du jour est introuvable — on n'invente pas d'objectif. */
  objectif: MacroTotals | null;
  consommé: MacroTotals;
}) {
  const restant: MacroTotals | null = objectif
    ? {
        proteinG: objectif.proteinG - consommé.proteinG,
        carbG: objectif.carbG - consommé.carbG,
        fatG: objectif.fatG - consommé.fatG,
        kcal: objectif.kcal - consommé.kcal,
      }
    : null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Colonne titre="Objectif du jour" totaux={objectif} vide="Aucun objectif prescrit" />
      <Colonne titre="Consommé" totaux={consommé} vide="" />
      <Colonne
        titre="Restant"
        totaux={restant}
        vide="—"
        alerte={restant !== null && restant.kcal < 0}
      />
    </div>
  );
}

function Colonne({
  titre,
  totaux,
  vide,
  alerte = false,
}: {
  titre: string;
  totaux: MacroTotals | null;
  vide: string;
  alerte?: boolean;
}) {
  return (
    <div
      className={`rounded-panel border p-3 ${
        alerte ? "border-destructive/40 bg-destructive/5" : "border-border bg-surface-soft/40"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {titre}
      </p>
      {totaux === null ? (
        <p className="mt-1 text-sm text-muted-foreground">{vide}</p>
      ) : (
        <>
          <p
            className={`mt-1 text-lg font-bold tabular-nums ${alerte ? "text-destructive" : "text-foreground"}`}
          >
            {formatIntegerFr(totaux.kcal)}
            {NBSP}kcal
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            P{NBSP}
            {formatDecimalFr(totaux.proteinG, 0)}
            {NBSP}· G{NBSP}
            {formatDecimalFr(totaux.carbG, 0)}
            {NBSP}· L{NBSP}
            {formatDecimalFr(totaux.fatG, 0)}
          </p>
          {alerte && (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
              Objectif dépassé
            </p>
          )}
        </>
      )}
    </div>
  );
}
