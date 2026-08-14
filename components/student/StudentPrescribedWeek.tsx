"use client";

import { useState } from "react";
import { NotebookPen, Plus } from "lucide-react";

import {
  ConsumedMealSection,
  StudentMealCard,
} from "@/components/student/ConsumedMealSection";
import { DailyIntakeSummary } from "@/components/student/DailyIntakeSummary";
import { DailyNutritionProgress } from "@/components/student/DailyNutritionProgress";
import { NutritionDayCarousel } from "@/components/student/NutritionDayCarousel";
import { NutritionWeekNav } from "@/components/student/NutritionWeekNav";
import { type ResumeSemaine, resumeSemaine, semaineContenant, libelleSemaine } from "@/lib/nutrition/historique";
import type { RaccourcisAlimentsUI } from "@/components/student/AddFoodSheet";
import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  type ConsumedMeal,
  type ConsumedUnit,
  prescribedConsumedMeal,
  studentMealsForDate,
  totalsForDay,
} from "@/lib/nutrition/consumed";
import { MEAL_SLOT_LABELS_FR } from "@/lib/nutrition/meal-distribution";
import {
  dailyTargetsForDay,
  orderedDays,
  slotMacrosForDay,
  type PlanV2Day,
  type PlanV2Week,
} from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * OUTIL 3 vu par l'élève — la semaine PRESCRITE par le coach, et, depuis
 * ALIMENTS A2, ce qu'il a RÉELLEMENT mangé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PRESCRIPTION N'A PAS BOUGÉ D'UN PIXEL
 * ────────────────────────────────────────────────────────────────────────────
 * Tout ce que le coach a défini — titre, cible kcal, P/G/L, texte alimentaire,
 * respirations entre les groupes, notes — se rend EXACTEMENT comme avant. Le
 * suivi s'ajoute dessous, derrière un séparateur, dans un bloc qui ne rend
 * jamais rien de ce que le coach a écrit.
 *
 * `suivi` est OPTIONNEL. Sans lui, ce composant est strictement celui d'avant
 * A2 : même arbre, mêmes classes, aucune écriture, aucun appel Supabase. C'est
 * ce qui garantit la non-régression demandée au §12 — un élève qui n'utilise
 * pas la nouvelle fonctionnalité retrouve son plan tel qu'il le connaît.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DU JOUR-TYPE À LA DATE
 * ────────────────────────────────────────────────────────────────────────────
 * La prescription n'a AUCUNE date : `nutrition_days.day` vaut `monday`…, et
 * `week_start_date` est NULL sur les 70 lignes de Production. La consommation,
 * elle, est datée. Le pont est `datesParJour`, fourni par l'appelant depuis
 * `getCurrentWeekDates()` — la même convention que le suivi hebdomadaire, pour
 * ne pas créer un second calendrier.
 */

export interface SuiviConsommation {
  /** `monday` → `2026-08-10`, etc. Convention de `getCurrentWeekDates()`. */
  readonly datesParJour: Readonly<Record<WeekdayKey, string>>;
  readonly meals: readonly ConsumedMeal[];
  readonly chargement: boolean;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly onEffacerErreur: () => void;
  readonly onOuvrirPrescrit: (mealId: string, date: string) => Promise<string | null>;
  readonly onCreerRepas: (date: string, libellé: string) => Promise<string | null>;
  readonly onRenommerRepas: (consumedMealId: string, libellé: string) => Promise<boolean>;
  readonly onSupprimerRepas: (consumedMealId: string) => Promise<boolean>;
  readonly onAjouterCatalogue: (
    consumedMealId: string,
    foodId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly onAjouterProduit?: (
    consumedMealId: string,
    productId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly onAjouterManuel: (
    consumedMealId: string,
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    p: number,
    g: number,
    l: number,
  ) => Promise<boolean>;
  readonly onCorriger: (
    entryId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  readonly onSupprimerAliment: (entryId: string) => Promise<boolean>;
  /** Favoris et récents (A5) — optionnels : l'écran reste entier sans eux. */
  readonly raccourcis?: RaccourcisAlimentsUI;
  /**
   * La date du jour, au format ISO (A5.6).
   *
   * INJECTÉE, jamais lue depuis l'horloge dans le rendu : une valeur calculée
   * pendant le rendu diffère entre le serveur et le client autour de minuit, et
   * React remplace alors silencieusement le HTML pré-rendu.
   */
  readonly aujourdHui?: string;
  /**
   * NAVIGATION PAR SEMAINE (A5.7) — optionnelle, comme tout le reste : sans
   * elle, l'écran affiche la semaine que `datesParJour` lui donne, sans en
   * proposer d'autre.
   */
  readonly onSemainePrecedente?: () => void;
  readonly onSemaineSuivante?: () => void;
}

export function StudentPrescribedWeek({
  week,
  suivi,
}: {
  week: PlanV2Week;
  suivi?: SuiviConsommation;
}) {
  const jours = orderedDays(week.days);

  if (jours.length === 0) {
    return (
      <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Ton coach n&apos;a pas encore construit la semaine de ce plan.
      </p>
    );
  }

  // A5.6 — LES SEPT JOURS EN CARROUSEL, AUJOURD'HUI EN PREMIER.
  //
  // Sans `suivi`, il n'y a ni dates ni consommation : l'écran retombe sur la
  // grille d'origine, qui reste juste — c'est la prescription seule, et elle
  // n'a pas de « jour courant ».
  const rendu = (index: number) => rendreJour(jours[index]);

  if (suivi && suivi.aujourdHui) {
    const dates = jours.map((j) => suivi.datesParJour[j.day] ?? "");
    // La semaine AFFICHÉE est celle des dates reçues, pas celle de l'horloge :
    // c'est ce qui permet de remonter dans l'historique sans que le titre
    // continue d'annoncer la semaine en cours.
    const semaine = semaineContenant(dates[0] ?? suivi.aujourdHui);
    const semaineCourante = semaineContenant(suivi.aujourdHui);
    const résumé: ResumeSemaine | null = semaine ? resumeSemaine(suivi.meals, semaine) : null;

    return (
      <div className="flex flex-col gap-3">
        {semaine && suivi.onSemainePrecedente && suivi.onSemaineSuivante && (
          <NutritionWeekNav
            libellé={libelleSemaine(semaine)}
            resume={résumé}
            estSemaineCourante={semaine.debut === semaineCourante?.debut}
            onPrecedente={suivi.onSemainePrecedente}
            onSuivante={suivi.onSemaineSuivante}
          />
        )}
        <NutritionDayCarousel
          dates={dates}
          libellés={jours.map((j) => WEEKDAY_LABELS_FR[j.day])}
          aujourdHui={suivi.aujourdHui}
          rendreJour={rendu}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {jours.map((jour) => rendreJour(jour))}
    </div>
  );

  function rendreJour(jour: PlanV2Day) {
        const cibles = dailyTargetsForDay(week, jour);
        const date = suivi?.datesParJour[jour.day] ?? null;
        // Le CONSOMMÉ du jour, pour le résumé visuel. Même source que
        // `BlocRepasLibres` — `totalsForDay` sur les repas de cette date —, et
        // surtout pas un second calcul.
        const repasDuJour = suivi && date ? suivi.meals.filter((r) => r.consumedOn === date) : [];
        return (
          <section
            key={jour.id}
            className="overflow-hidden rounded-panel border border-border bg-card shadow-soft"
          >
            <header className="border-b border-border bg-surface-soft px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">
                  {WEEKDAY_LABELS_FR[jour.day]}
                </h3>
                {cibles && (
                  <span className="text-xs text-muted-foreground">
                    {formatIntegerFr(cibles.calories.totalCalories)}
                    {NBSP}kcal
                  </span>
                )}
              </div>
              {cibles && (
                <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  P{NBSP}
                  {formatIntegerFr(cibles.grams.proteinGrams)}
                  {NBSP}g · G{NBSP}
                  {formatIntegerFr(cibles.grams.carbGrams)}
                  {NBSP}g · L{NBSP}
                  {formatIntegerFr(cibles.grams.fatGrams)}
                  {NBSP}g
                </p>
              )}
            </header>

            <div className="flex flex-col gap-3 p-4">
              {/* A5.6 — LE RÉSUMÉ VISUEL, EN TÊTE DE JOURNÉE.
                  Il ne calcule rien : il reçoit le consommé (`totalsForDay`,
                  la MÊME source que la synthèse chiffrée plus bas) et
                  l'objectif du PROFIL DU JOUR — jamais une moyenne
                  hebdomadaire, erreur qu'une version antérieure de cet écran
                  avait commise. */}
              {suivi && date && (
                <DailyNutritionProgress
                  objectif={
                    cibles
                      ? {
                          proteinG: cibles.grams.proteinGrams,
                          carbG: cibles.grams.carbGrams,
                          fatG: cibles.grams.fatGrams,
                          kcal: cibles.calories.totalCalories,
                        }
                      : null
                  }
                  consommé={totalsForDay(repasDuJour)}
                />
              )}

              {jour.meals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun repas prescrit ce jour-là.
                </p>
              ) : (
                jour.meals.map((repas) => {
                  // CE QUE CE REPAS DOIT APPORTER. Le coach ne saisit plus de
                  // kcal ni de macros par repas : il règle les objectifs du
                  // JOUR, puis la part de chaque créneau. On applique donc
                  // simplement cette part aux objectifs du jour —
                  // `slotMacrosForDay` compose les fonctions existantes, aucune
                  // formule n'est réécrite ici.
                  //
                  // Un repas enregistré AVANT ce changement porte encore ses
                  // propres valeurs : elles priment, pour ne rien réécrire du
                  // passé.
                  const créneau = slotMacrosForDay(week, jour, repas.slot);
                  const saisiParLeCoach = repas.calories > 0 || repas.protein + repas.carbs + repas.fat > 0;
                  const cible = saisiParLeCoach
                    ? {
                        calories: repas.calories,
                        proteinGrams: repas.protein,
                        carbGrams: repas.carbs,
                        fatGrams: repas.fat,
                      }
                    : créneau;

                  return (
                  <article
                    key={repas.id}
                    className="rounded-panel border border-border bg-surface-soft/40 p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {MEAL_SLOT_LABELS_FR[repas.slot]}
                      </span>
                      {cible && (
                        <span className="text-sm font-bold text-foreground">
                          {formatIntegerFr(cible.calories)}
                          {NBSP}kcal
                        </span>
                      )}
                    </div>

                    {repas.name && (
                      <h4 className="mt-1 text-sm font-bold text-foreground">{repas.name}</h4>
                    )}

                    {cible && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        P{NBSP}
                        {formatIntegerFr(cible.proteinGrams)}
                        {NBSP}g · G{NBSP}
                        {formatIntegerFr(cible.carbGrams)}
                        {NBSP}g · L{NBSP}
                        {formatIntegerFr(cible.fatGrams)}
                        {NBSP}g
                      </p>
                    )}

                    {/* Une ligne sans nom NI quantité est la respiration
                        voulue par le coach entre deux groupes d'aliments :
                        on rend l'espace, pas une puce vide. */}
                    {repas.items.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
                        {repas.items.map((aliment, index) =>
                          !aliment.name && !aliment.quantity ? (
                            <li key={`${repas.id}-${index}`} aria-hidden="true" className="h-3" />
                          ) : (
                            <li key={`${repas.id}-${index}`} className="flex flex-wrap gap-x-2">
                              <span className="whitespace-pre-wrap">{aliment.name}</span>
                              {aliment.quantity && (
                                <span className="whitespace-pre-wrap text-muted-foreground">
                                  {aliment.quantity}
                                </span>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    )}

                    {repas.coachNotes && (
                      <p className="mt-3 flex items-start gap-2 rounded-control border border-border bg-card px-3 py-2 text-xs italic leading-relaxed text-muted-foreground">
                        <NotebookPen size={14} className="mt-0.5 flex-shrink-0" />
                        <span>{repas.coachNotes}</span>
                      </p>
                    )}

                    {/* ── FRONTIÈRE ── Tout ce qui précède appartient au COACH
                        et n'est jamais modifié. Tout ce qui suit appartient à
                        l'ÉLÈVE. Le séparateur en pointillés est là pour que la
                        distinction se voie sans avoir à la lire. */}
                    {suivi && date && (
                      <ConsumedMealSection
                        repas={prescribedConsumedMeal(suivi.meals, repas.id, date)}
                        titre={repas.name || MEAL_SLOT_LABELS_FR[repas.slot]}
                        cibleFigée
                        enCours={suivi.enCours}
                        erreur={suivi.erreur}
                        onOuvrirConteneur={() => suivi.onOuvrirPrescrit(repas.id, date)}
                        onAjouterCatalogue={suivi.onAjouterCatalogue}
                        onAjouterProduit={suivi.onAjouterProduit}
                        onAjouterManuel={suivi.onAjouterManuel}
                        onCorriger={suivi.onCorriger}
                        onSupprimerAliment={suivi.onSupprimerAliment}
                        onEffacerErreur={suivi.onEffacerErreur}
                        raccourcis={suivi.raccourcis}
                      />
                    )}
                  </article>
                  );
                })
              )}

              {suivi && date && (
                <BlocRepasLibres jour={jour} date={date} suivi={suivi} objectif={cibles} />
              )}
            </div>
          </section>
        );
  }
}

/**
 * Les repas LIBRES d'une journée, le bouton pour en créer un, et la synthèse.
 *
 * Le champ de saisie n'apparaît qu'après un clic sur « Ajouter un repas » :
 * l'écran d'un élève qui n'utilise pas la fonctionnalité reste le sien, avec
 * une seule ligne en plus.
 */
function BlocRepasLibres({
  jour,
  date,
  suivi,
  objectif,
}: {
  jour: PlanV2Day;
  date: string;
  suivi: SuiviConsommation;
  objectif: ReturnType<typeof dailyTargetsForDay>;
}) {
  const [saisie, setSaisie] = useState(false);
  const [nom, setNom] = useState("");

  const libres = studentMealsForDate(suivi.meals, date);
  const repasDuJour = suivi.meals.filter((r) => r.consumedOn === date);
  const consommé = totalsForDay(repasDuJour);
  const aConsommé = repasDuJour.some((r) => r.entries.length > 0);

  async function créer() {
    const propre = nom.trim();
    if (propre === "") return;
    if (await suivi.onCreerRepas(date, propre)) {
      setNom("");
      setSaisie(false);
    }
  }

  return (
    <>
      {libres.map((repas) => (
        // La clé est l'IDENTIFIANT, jamais le libellé : deux « Collation » le
        // même jour sont deux repas distincts, et c'est voulu.
        <StudentMealCard
          key={repas.id}
          repas={repas}
          enCours={suivi.enCours}
          erreur={suivi.erreur}
          onRenommer={(libellé) => suivi.onRenommerRepas(repas.id, libellé)}
          onSupprimerRepas={() => suivi.onSupprimerRepas(repas.id)}
          onAjouterCatalogue={suivi.onAjouterCatalogue}
          onAjouterProduit={suivi.onAjouterProduit}
          onAjouterManuel={suivi.onAjouterManuel}
          onCorriger={suivi.onCorriger}
          onSupprimerAliment={suivi.onSupprimerAliment}
          onEffacerErreur={suivi.onEffacerErreur}
          raccourcis={suivi.raccourcis}
        />
      ))}

      {saisie ? (
        <div className="flex flex-col gap-2 rounded-panel border border-border p-3">
          <label
            htmlFor={`nouveau-repas-${jour.id}`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Nom du repas
          </label>
          <input
            id={`nouveau-repas-${jour.id}`}
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Collation, Restaurant, Post-entraînement…"
            className="min-h-[44px] w-full rounded-control border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void créer()}
              disabled={suivi.enCours || nom.trim() === ""}
              className="pressable min-h-[44px] flex-1 rounded-control bg-primary py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {suivi.enCours ? "Création…" : "Créer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSaisie(false);
                setNom("");
              }}
              disabled={suivi.enCours}
              className="pressable min-h-[44px] flex-1 rounded-control border border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSaisie(true)}
          disabled={suivi.enCours}
          className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-border text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
        >
          <Plus size={14} />
          Ajouter un repas
        </button>
      )}

      {/* La synthèse n'apparaît qu'à partir du moment où il y a quelque chose à
          synthétiser : un écran vide n'a pas besoin d'annoncer « 0 kcal
          consommés ». */}
      {aConsommé && (
        <div className="mt-1">
          <DailyIntakeSummary
            objectif={
              objectif
                ? {
                    proteinG: objectif.grams.proteinGrams,
                    carbG: objectif.grams.carbGrams,
                    fatG: objectif.grams.fatGrams,
                    kcal: objectif.calories.totalCalories,
                  }
                : null
            }
            consommé={consommé}
          />
        </div>
      )}
    </>
  );
}
