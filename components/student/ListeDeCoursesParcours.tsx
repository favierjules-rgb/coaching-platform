"use client";

import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingBasket, Star } from "lucide-react";

import { ColorKeyDot } from "@/components/ui/ColorKeyDot";
import { StudentMealChoices, type ItemPourEnregistrement } from "@/components/student/StudentMealChoices";
import { useListeDeCourses } from "@/hooks/useListeDeCourses";
import { useRaccourcisAliments } from "@/hooks/useRaccourcisAliments";
import { formatQuantite } from "@/lib/nutrition/liste-de-courses";
import { cleDeComposition } from "@/lib/nutrition/meal-choice-selection";
import {
  DUREES_COURSES,
  construirePeriode,
  libellePeriode,
  type DureeCourses,
} from "@/lib/nutrition/periode-courses";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import { optionsAutoriseesDeLaPeriode, type RepasDeLaPeriode } from "@/lib/nutrition/repas-de-la-periode";
import { WEEKDAY_LABELS_FR } from "@/lib/nutrition/weekdays";
import { jourDeLaDate } from "@/lib/nutrition/periode-courses";

/**
 * COURSES C1 — LE PARCOURS : DURÉE → PRÉFÉRENCES → REPAS → LISTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUATRE ÉCRANS, UN SEUL ÉTAT, AUCUNE PERSISTANCE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA DURÉE SURVIT AU RETOUR. Elle vit dans CE composant, pas dans l'URL ni
 * dans une table : revenir d'un écran ne la reperd donc pas, et fermer l'onglet
 * ne laisse rien derrière. Aucun besoin de persistance n'est établi en C1 — le
 * jour où l'élève voudra retrouver sa liste demain, ce sera C2 et sa table.
 *
 * ⚠️ AUCUNE ÉCRITURE DE LISTE. Ni `shopping_lists`, ni `shopping_list_items`,
 * ni `shopping_list_state`. Le seul geste qui écrit est celui de C0 — valider
 * la composition d'un repas — et il écrit `planned_meals` / `planned_meal_items`
 * comme il le faisait déjà depuis l'écran du plan.
 *
 * ⚠️ AUCUN SECOND SÉLECTEUR D'ALIMENTS. Les repas à composer montent
 * `StudentMealChoices`, le composant de N1.4/N1.5/C0, avec exactement les
 * mêmes props que l'écran du plan. Une seconde interface de choix aurait
 * signifié deux solveurs, deux arrondis et deux vérités.
 */

type Etape = "duree" | "preferences" | "repas" | "liste";

const ETAPES: readonly Etape[] = ["duree", "preferences", "repas", "liste"];

export function ListeDeCoursesParcours({
  week,
  studentId,
  aujourdHui,
}: {
  readonly week: PlanV2Week | null;
  readonly studentId: string | null;
  /** La date du jour, ISO. Fournie par la page — jamais recalculée ici. */
  readonly aujourdHui: string;
}) {
  const [etape, setEtape] = useState<Etape>("duree");
  // ⚠️ `null` = L'ÉLÈVE N'A RIEN CHOISI. Ce n'est pas « zéro jour », et ce
  // n'est surtout pas trois : aucune case n'est cochée à l'ouverture, et le
  // parcours refuse d'avancer tant que la question n'a pas de réponse.
  const [duree, setDuree] = useState<DureeCourses | null>(null);

  const periode = useMemo(() => construirePeriode(aujourdHui, duree), [aujourdHui, duree]);
  const courses = useListeDeCourses(week, periode, etape !== "duree");
  const raccourcis = useRaccourcisAliments(studentId, etape === "preferences");

  const reculer = useCallback(() => {
    setEtape((actuelle) => ETAPES[Math.max(0, ETAPES.indexOf(actuelle) - 1)]);
  }, []);
  const avancer = useCallback(() => {
    setEtape((actuelle) => ETAPES[Math.min(ETAPES.length - 1, ETAPES.indexOf(actuelle) + 1)]);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <EnTete etape={etape} periode={periode} onReculer={reculer} />

      {etape === "duree" && <EcranDuree duree={duree} onChoisir={setDuree} onSuivant={avancer} />}

      {etape === "preferences" && (
        <EcranPreferences
          repas={courses.repas}
          estFavori={raccourcis.estFavori}
          basculerFavori={raccourcis.basculerFavori}
          chargement={raccourcis.chargement || courses.chargement}
          onSuivant={avancer}
        />
      )}

      {etape === "repas" && (
        <EcranRepas
          repas={courses.repas}
          aComposer={courses.aComposer}
          chargement={courses.chargement}
          ok={courses.ok}
          enCours={courses.enCours}
          erreur={courses.erreur}
          onValider={courses.validerRepas}
          estFavori={raccourcis.estFavori}
          onSuivant={avancer}
        />
      )}

      {etape === "liste" && (
        <EcranListe lignes={courses.lignes} periode={periode} restants={courses.aComposer.length} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   EN-TÊTE ET RETOUR
   ══════════════════════════════════════════════════════════════════════════ */

function EnTete({
  etape,
  periode,
  onReculer,
}: {
  readonly etape: Etape;
  readonly periode: ReturnType<typeof construirePeriode>;
  readonly onReculer: () => void;
}) {
  const titre = etape === "liste" ? "MA LISTE DE COURSE" : "GÉNÉRER MA LISTE DE COURSE";
  return (
    <div className="flex flex-col gap-3">
      {/* Le retour de la PREMIÈRE étape sort du parcours ; les suivants
          reculent d'un écran, sans jamais reperdre la durée choisie. */}
      {etape === "duree" ? (
        <Link
          href="/nutrition"
          className="pressable inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control px-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Nutrition
        </Link>
      ) : (
        <button
          type="button"
          onClick={onReculer}
          className="pressable inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control px-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Retour
        </button>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl">
          {titre}
        </h1>
        {periode !== null && etape !== "duree" && (
          <p className="text-sm text-muted-foreground">{libellePeriode(periode)}</p>
        )}
      </div>
    </div>
  );
}

/*
 * ⚠️ LES QUATRE ÉCRANS SONT EXPORTÉS POUR ÊTRE MESURÉS. Le responsive se
 * vérifie écran par écran, à cinq largeurs : sans export, le banc ne pourrait
 * atteindre que le premier, et « aucun débordement » ne vaudrait que pour lui.
 * Ils ne sont montés nulle part ailleurs que par `ListeDeCoursesParcours`.
 */

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 1 — LA DURÉE
   ══════════════════════════════════════════════════════════════════════════ */

export function EcranDuree({
  duree,
  onChoisir,
  onSuivant,
}: {
  /** `null` = aucune durée sélectionnée. Aucun repli, aucune pré-sélection. */
  readonly duree: DureeCourses | null;
  readonly onChoisir: (valeur: DureeCourses) => void;
  readonly onSuivant: () => void;
}) {
  const nom = useId();
  return (
    <div className="flex flex-col gap-5">
      {/* ⚠️ DES RADIOS NATIFS, PAS DES BOUTONS DÉGUISÉS. Le groupe est
          parcourable aux flèches, annonçable par un lecteur d'écran et
          sélectionnable au clavier sans une ligne de JavaScript — ce qu'un
          `<div role="radio">` aurait fallu réécrire, moins bien. */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-foreground">
          Pour combien de jours veux-tu générer ta liste&nbsp;?
        </legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {DUREES_COURSES.map((valeur) => {
            const choisi = valeur === duree;
            return (
              <label
                key={valeur}
                className={`pressable flex min-h-[44px] cursor-pointer items-center justify-center rounded-control border px-2 py-2 text-sm font-bold transition-colors focus-within:ring-2 focus-within:ring-info/50 ${
                  choisi
                    ? "border-info bg-info/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-info/60"
                }`}
              >
                <input
                  type="radio"
                  name={nom}
                  value={valeur}
                  checked={choisi}
                  onChange={() => onChoisir(valeur)}
                  className="sr-only"
                />
                {/* ⚠️ L'ÉTAT NE TIENT PAS QU'À LA COULEUR : le repère coché
                    est aussi une coche, lisible en niveaux de gris. */}
                <span className="flex items-center gap-1">
                  {choisi && <Check size={14} aria-hidden="true" className="text-info" />}
                  <span>{valeur}</span>
                </span>
                <span className="sr-only">{valeur > 1 ? " jours" : " jour"}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ⚠️ ON NE PRÉ-REMPLIT PAS NON PLUS LA PHRASE. Tant qu'aucune durée
          n'est choisie, l'écran dit ce qu'il attend — il n'annonce pas une
          période que personne n'a demandée. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {duree === null
          ? "Choisis une durée pour continuer."
          : `La période commence aujourd'hui. ${duree} jour${duree > 1 ? "s" : ""} inclus.`}
      </p>

      {/* ⚠️ DÉSACTIVÉ TANT QUE `duree` VAUT `null`, et le bouton le DIT : un
          bouton grisé sans explication laisse chercher ce qui manque. */}
      <BoutonPrincipal onClick={onSuivant} desactive={duree === null}>
        {duree === null ? "Choisis une durée" : "Continuer"}
      </BoutonPrincipal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 2 — LES PRÉFÉRENCES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ UNE PRÉFÉRENCE N'AJOUTE JAMAIS UN ALIMENT. La liste affichée ici sort
 * EXCLUSIVEMENT de `optionsAutoriseesDeLaPeriode`, c'est-à-dire des
 * `meal_choice_options` du snapshot du coach. Marquer un aliment en favori ne
 * le fait pas entrer dans un repas : cela le met en avant parmi les options
 * QUE LE COACH A DÉJÀ AUTORISÉES, au moment du choix.
 *
 * ⚠️ AUCUN SYSTÈME PARALLÈLE. Les favoris sont ceux d'ALIMENTS A5
 * (`food_favorites`, hook `useRaccourcisAliments`) : même table, même RLS,
 * mêmes identités. Aucun vocabulaire de « rayon », d'« envie » ou de « mode »
 * n'est réintroduit.
 */
export function EcranPreferences({
  repas,
  estFavori,
  basculerFavori,
  chargement,
  onSuivant,
}: {
  readonly repas: readonly RepasDeLaPeriode[];
  readonly estFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;
  readonly basculerFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => Promise<void>;
  readonly chargement: boolean;
  readonly onSuivant: () => void;
}) {
  const options = useMemo(() => optionsAutoriseesDeLaPeriode(repas), [repas]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">Tes préférences</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Voici les aliments que ton coach autorise sur cette période. Marque ceux que tu
          préfères&nbsp;: ils seront mis en avant au moment de composer tes repas. Une préférence
          n&apos;ajoute jamais un aliment hors de ces listes.
        </p>
      </div>

      {chargement && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {!chargement && options.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune liste d&apos;aliments n&apos;est proposée sur cette période.
        </p>
      )}

      {options.length > 0 && (
        <ul className="flex flex-col gap-2">
          {options.map((option) => {
            const cible = { type: option.type, id: option.id } as const;
            const favori = estFavori(cible);
            return (
              <li key={option.cle}>
                <button
                  type="button"
                  aria-pressed={favori}
                  onClick={() => void basculerFavori(cible)}
                  className={`pressable flex min-h-[44px] w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50 ${
                    favori ? "border-info/60 bg-info/10" : "border-border bg-card hover:border-info/40"
                  }`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {option.displayName === "" ? "Aliment sans nom" : option.displayName}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {option.occurrences} liste{option.occurrences > 1 ? "s" : ""} sur la période
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    <Star
                      size={16}
                      aria-hidden="true"
                      className={favori ? "fill-info text-info" : "text-muted-foreground"}
                    />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {favori ? "Préféré" : "Marquer"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BoutonPrincipal onClick={onSuivant}>Voir mes repas</BoutonPrincipal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 3 — LES REPAS DE LA PÉRIODE
   ══════════════════════════════════════════════════════════════════════════ */

export function EcranRepas({
  repas,
  aComposer,
  chargement,
  ok,
  enCours,
  erreur,
  onValider,
  estFavori,
  onSuivant,
}: {
  readonly repas: readonly RepasDeLaPeriode[];
  readonly aComposer: readonly RepasDeLaPeriode[];
  readonly chargement: boolean;
  readonly ok: boolean;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly onValider: (repas: RepasDeLaPeriode, items: readonly ItemPourEnregistrement[]) => Promise<boolean>;
  readonly estFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;
  readonly onSuivant: () => void;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const restants = aComposer.length;

  if (chargement) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  // ⚠️ UNE LECTURE RATÉE N'EST PAS « RIEN DE PRÉVU ». Afficher « tout reste à
  // composer » à un élève qui a tout validé l'enverrait tout refaire.
  if (!ok) {
    return (
      <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
        Impossible de lire tes repas prévus. Vérifie ta connexion, puis reviens sur cet écran.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">Tes repas</h2>
        {restants === 0 ? (
          <p className="text-sm text-success">
            Tous tes repas sont composés. Tu peux générer ta liste.
          </p>
        ) : (
          <p className="text-sm text-warning">
            {restants} repas rest{restants > 1 ? "ent" : "e"} à composer. Ouvre-les pour choisir tes
            aliments&nbsp;: seuls les repas validés entrent dans la liste.
          </p>
        )}
      </div>

      {erreur && (
        <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {erreur}
        </p>
      )}

      {repas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun repas à listes d&apos;aliments n&apos;est prescrit sur cette période.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {repas.map((r) => {
          const estOuvert = ouvert === r.cle;
          const jour = jourDeLaDate(r.date);
          return (
            <li key={r.cle} className="rounded-card border border-border bg-card">
              <button
                type="button"
                aria-expanded={estOuvert}
                onClick={() => setOuvert((actuel) => (actuel === r.cle ? null : r.cle))}
                className="pressable flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-heading text-sm font-bold uppercase text-foreground">
                    {r.nom}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {jour ? WEEKDAY_LABELS_FR[jour] : ""} · {r.date}
                  </span>
                </span>
                {/* ⚠️ L'ÉTAT S'ÉCRIT, il ne se devine pas à la teinte. */}
                <span
                  className={`flex flex-shrink-0 items-center gap-1.5 rounded-control border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    r.pret ? "border-success/50 text-success" : "border-warning/50 text-warning"
                  }`}
                >
                  {r.pret && <Check size={12} aria-hidden="true" />}
                  {r.pret ? "Prêt" : "À composer"}
                </span>
              </button>

              {estOuvert && (
                <div className="border-t border-border px-4 py-4">
                  {/* ⚠️ LE COMPOSANT DE N1.4/N1.5/C0, TEL QUEL. Mêmes
                      occurrences, même cible, même geste de validation. */}
                  <StudentMealChoices
                    key={cleDeComposition(r.mealId, r.date)}
                    occurrences={r.occurrences}
                    cible={r.cible}
                    misEnAvant={estFavori}
                    validation={{
                      compositionValidee: r.composition,
                      enCours,
                      onValider: (items) => void onValider(r, items),
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <BoutonPrincipal onClick={onSuivant} desactive={restants > 0 || repas.length === 0}>
        {restants > 0 ? `${restants} repas à composer` : "GÉNÉRER MA LISTE"}
      </BoutonPrincipal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 4 — LA LISTE
   ══════════════════════════════════════════════════════════════════════════ */

export function EcranListe({
  lignes,
  periode,
  restants,
}: {
  readonly lignes: readonly { cle: string; displayName: string; quantite: number; unit: string; colorKey: string | null }[];
  readonly periode: ReturnType<typeof construirePeriode>;
  readonly restants: number;
}) {
  // ⚠️ COCHAGE LOCAL, ET IL LE DIT. Rien n'est écrit en base : C2 apportera
  // `shopping_list_state`. Laisser croire à une persistance ferait perdre son
  // travail à l'élève sans le prévenir.
  const [coches, setCoches] = useState<ReadonlySet<string>>(new Set());
  const basculer = useCallback((cle: string) => {
    setCoches((actuel) => {
      const suivant = new Set(actuel);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {restants > 0 && (
        <p className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
          {restants} repas rest{restants > 1 ? "ent" : "e"} à composer&nbsp;: ils ne figurent pas
          dans cette liste.
        </p>
      )}

      {lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun repas validé sur cette période&nbsp;: il n&apos;y a rien à acheter tant que tu
          n&apos;as pas composé au moins un repas.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-card">
          {lignes.map((ligne) => {
            const coche = coches.has(ligne.cle);
            return (
              <li key={ligne.cle}>
                <button
                  type="button"
                  aria-pressed={coche}
                  onClick={() => basculer(ligne.cle)}
                  className="pressable flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px] border ${
                      coche ? "border-info bg-info/20" : "border-border"
                    }`}
                  >
                    {coche && <Check size={13} className="text-info" />}
                  </span>
                  <ColorKeyDot colorKey={ligne.colorKey} />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      coche ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {ligne.displayName === "" ? "Aliment sans nom" : ligne.displayName}
                  </span>
                  <span className="flex-shrink-0 whitespace-nowrap font-heading text-sm font-bold tabular-nums text-foreground">
                    {formatQuantite(ligne.quantite, ligne.unit)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Le cochage n&apos;est pas enregistré&nbsp;: il disparaîtra si tu quittes cet écran.
        {periode !== null && ` Liste calculée depuis tes repas validés ${libellePeriode(periode).toLowerCase()}.`}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   UN SEUL BOUTON PRINCIPAL, PARTOUT
   ══════════════════════════════════════════════════════════════════════════ */

function BoutonPrincipal({
  children,
  onClick,
  desactive = false,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly desactive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactive}
      className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-info bg-info/15 px-4 py-3 font-heading text-sm font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-info/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:self-start sm:px-8"
    >
      <ShoppingBasket size={16} aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
