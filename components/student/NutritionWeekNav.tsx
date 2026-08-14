"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import type { ResumeSemaine } from "@/lib/nutrition/historique";

/**
 * LA NAVIGATION PAR SEMAINE (ALIMENTS A5.7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX NIVEAUX, ET UN SEUL GESTE PAR NIVEAU
 * ────────────────────────────────────────────────────────────────────────────
 * Niveau 1, ici : la SEMAINE, changée par deux flèches.
 * Niveau 2, en dessous : le JOUR, changé par un glissement.
 *
 * Deux systèmes de navigation concurrents sur le même axe rendraient l'écran
 * imprévisible — glisser changerait tantôt de jour, tantôt de semaine. Les
 * flèches sont donc EXTÉRIEURES au carrousel, et le glissement lui reste
 * réservé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE COMPOSANT N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Changer de semaine ne déplace aucun repas, ne copie aucune consommation
 * et ne touche à aucun `consumed_on`. Il rend deux boutons et un titre : il
 * n'a ni client Supabase, ni fonction d'écriture, et un contrôle le vérifie
 * sur son source.
 */

export function NutritionWeekNav({
  libellé,
  resume,
  estSemaineCourante,
  onPrecedente,
  onSuivante,
}: {
  /** « du 10 au 16 août ». Calculé par `libelleSemaine`, pas ici. */
  libellé: string;
  /** `null` tant que la semaine n'est pas chargée. */
  resume: ResumeSemaine | null;
  estSemaineCourante: boolean;
  onPrecedente: () => void;
  onSuivante: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrecedente}
          aria-label="Semaine précédente"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="min-w-0 text-center">
          {estSemaineCourante && (
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              Semaine en cours
            </p>
          )}
          <p className="truncate font-heading text-sm font-bold uppercase tracking-widest text-foreground">
            Semaine {libellé}
          </p>
        </div>

        {/* Le bouton « suivante » est TOUJOURS actif, y compris sur la semaine
            en cours : consulter une semaine à venir n'a rien d'illégitime — le
            coach y a peut-être déjà prescrit — et la désactiver donnerait
            l'impression que l'application s'arrête aujourd'hui. */}
        <button
          type="button"
          onClick={onSuivante}
          aria-label="Semaine suivante"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ⚠️ UNE SEMAINE SANS SAISIE NE S'AFFICHE PAS COMME UNE SEMAINE À ZÉRO.
          « Aucune consommation enregistrée » et « 0 kcal consommées » sont deux
          faits différents, et le second reprocherait à l'élève quelque chose
          qu'il n'a pas fait. */}
      {resume !== null &&
        (resume.joursSuivis === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Aucune consommation enregistrée cette semaine.
          </p>
        ) : (
          <dl className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-1.5">
              <dt className="uppercase tracking-wide">Jours suivis</dt>
              <dd className="font-bold tabular-nums text-foreground">
                {resume.joursSuivis}/{resume.joursTotal}
              </dd>
            </div>
            {resume.moyennes !== null && (
              <>
                <div className="flex items-baseline gap-1.5">
                  {/* « par jour suivi », et pas « par jour » : la nuance est
                      tout l'intérêt du chiffre. */}
                  <dt className="uppercase tracking-wide">Moyenne / jour suivi</dt>
                  <dd className="font-bold tabular-nums text-foreground">
                    {formatIntegerFr(Math.round(resume.moyennes.kcal))}
                    {NBSP}kcal
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5 tabular-nums">
                  <dt className="sr-only">Macros moyennes</dt>
                  <dd>
                    P{NBSP}
                    {formatIntegerFr(Math.round(resume.moyennes.proteinG))}
                    {NBSP}· G{NBSP}
                    {formatIntegerFr(Math.round(resume.moyennes.carbG))}
                    {NBSP}· L{NBSP}
                    {formatIntegerFr(Math.round(resume.moyennes.fatG))}
                  </dd>
                </div>
              </>
            )}
          </dl>
        ))}
    </div>
  );
}
