"use client";

import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ChevronRight, ShoppingBasket, Sparkles, Star } from "lucide-react";

import { ColorKeyDot } from "@/components/ui/ColorKeyDot";
import { ListeDeCoursesPersistante } from "@/components/student/ListeDeCoursesPersistante";
import { StudentMealChoices, type ItemPourEnregistrement } from "@/components/student/StudentMealChoices";
import {
  useListeDeCourses,
  type RepasAValider,
  type ResultatValidationSemaine,
} from "@/hooks/useListeDeCourses";
import { useRaccourcisAliments } from "@/hooks/useRaccourcisAliments";
import { formatQuantite } from "@/lib/nutrition/liste-de-courses";
import { calculDuRepas, cleDeComposition, type SelectionDeChoix } from "@/lib/nutrition/meal-choice-selection";
import { MODES_COURSES, type ModeCourses, type ModeCoursesChoisi } from "@/lib/nutrition/mode-courses";
import {
  DUREES_COURSES,
  construirePeriode,
  libellePeriode,
  type DureeCourses,
} from "@/lib/nutrition/periode-courses";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import { cleAlimentRapide } from "@/lib/supabase/consumed-meals";
import {
  itemsAValider,
  optionsProposables,
  proposerSemaine,
  type OptionProposable,
} from "@/lib/nutrition/proposition-rapide";
import type { RepasDeLaPeriode } from "@/lib/nutrition/repas-de-la-periode";
import { compterCartes, groupesParJour, type CarteRepas, type GroupeDeJour } from "@/lib/nutrition/repas-par-jour";

/**
 * COURSES C1.1 — DEUX MANIÈRES DE PRÉPARER SA SEMAINE, UNE SEULE LISTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE PARCOURS
 * ────────────────────────────────────────────────────────────────────────────
 *   DURÉE → MODE → ┬─ RAPIDE : préférences courtes → semaine proposée ─┐
 *                  └─ PERSONNALISÉ ─────────────────────────────────────┴→ REPAS → LISTE
 *
 * ⚠️ LES DEUX MODES CONVERGENT. Après validation, l'écran des repas et la
 * liste sont EXACTEMENT les mêmes : `EcranRepasParJour` et `EcranListe` ne
 * savent pas par quel chemin on est arrivé. Deux écrans finaux auraient voulu
 * dire deux vérités possibles pour la même semaine.
 *
 * ⚠️ AUCUN DÉFAUT, NI POUR LA DURÉE NI POUR LE MODE. `null` dans les deux cas,
 * et le bouton reste désactivé tant que la question n'a pas de réponse.
 *
 * ⚠️ AUCUNE ÉCRITURE DE LISTE. Le seul geste qui écrit reste celui de C0 —
 * `enregistrer_repas_planifie` — appelé repas par repas.
 */

type Etape = "duree" | "mode" | "preferences" | "proposition" | "repas" | "liste";

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
  // ⚠️ MÊME RÈGLE POUR LE MODE. Pré-sélectionner « Rapide » enverrait la
  // moitié des élèves dans un parcours qu'ils n'ont pas demandé.
  const [mode, setMode] = useState<ModeCourses>(null);
  /** Les identités que l'élève aimerait retrouver. Préférences POSITIVES seules. */
  const [preferences, setPreferences] = useState<ReadonlySet<string>>(new Set());
  const [resultat, setResultat] = useState<ResultatValidationSemaine | null>(null);

  const periode = useMemo(() => construirePeriode(aujourdHui, duree), [aujourdHui, duree]);
  const courses = useListeDeCourses(week, periode, etape !== "duree" && etape !== "mode");
  // ⚠️ LES FAVORIS SONT UN SIGNAL AUTOMATIQUE (C1.1). On les CHARGE dès que le
  // mode est choisi, sans jamais demander à l'élève de parcourir un catalogue
  // pour les cocher un par un — c'était le défaut de C1.
  const raccourcis = useRaccourcisAliments(studentId, mode !== null);

  // ⚠️ LA MÊME CLÉ QUE `cleFavori` / `cleAlimentRapide` — on réutilise la
  // fonction du projet plutôt que de recomposer « aliment:UUID » à la main.
  const favoris = useMemo(
    () => new Set(raccourcis.favoris.map(cleAlimentRapide)),
    [raccourcis.favoris],
  );

  /** La proposition du mode Rapide. Dérivée, jamais rangée dans un état. */
  const proposition = useMemo(
    () => (mode === "rapide" ? proposerSemaine(courses.repas, preferences, favoris) : new Map()),
    [mode, courses.repas, preferences, favoris],
  );

  const groupes = useMemo(() => groupesParJour(courses.repas), [courses.repas]);

  const chemin = useMemo<readonly Etape[]>(
    () =>
      mode === "rapide"
        ? ["duree", "mode", "preferences", "proposition", "repas", "liste"]
        : ["duree", "mode", "repas", "liste"],
    [mode],
  );

  const reculer = useCallback(() => {
    setEtape((actuelle) => {
      const rang = chemin.indexOf(actuelle);
      return rang <= 0 ? actuelle : chemin[rang - 1];
    });
  }, [chemin]);
  const avancer = useCallback(() => {
    setEtape((actuelle) => {
      const rang = chemin.indexOf(actuelle);
      return rang === -1 || rang >= chemin.length - 1 ? actuelle : chemin[rang + 1];
    });
  }, [chemin]);

  const basculerPreference = useCallback((cle: string) => {
    setPreferences((actuelles) => {
      const suivantes = new Set(actuelles);
      if (suivantes.has(cle)) suivantes.delete(cle);
      else suivantes.add(cle);
      return suivantes;
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <EnTete etape={etape} periode={periode} onReculer={reculer} />

      {etape === "duree" && <EcranDuree duree={duree} onChoisir={setDuree} onSuivant={avancer} />}

      {etape === "mode" && <EcranMode mode={mode} onChoisir={setMode} onSuivant={avancer} />}

      {etape === "preferences" && (
        <EcranPreferencesRapides
          repas={courses.repas}
          favoris={favoris}
          preferences={preferences}
          onBasculer={basculerPreference}
          chargement={courses.chargement || raccourcis.chargement}
          onSuivant={avancer}
        />
      )}

      {etape === "proposition" && (
        <EcranProposition
          groupes={groupes}
          proposition={proposition}
          estFavori={raccourcis.estFavori}
          chargement={courses.chargement}
          ok={courses.ok}
          enCours={courses.enCours}
          resultat={resultat}
          onValiderSemaine={async (entrees) => {
            const r = await courses.validerSemaine(entrees);
            setResultat(r);
            if (r.complet) avancer();
          }}
          onSuivant={avancer}
        />
      )}

      {etape === "repas" && (
        <EcranRepasParJour
          groupes={groupes}
          chargement={courses.chargement}
          ok={courses.ok}
          enCours={courses.enCours}
          erreur={courses.erreur}
          onValider={courses.validerRepas}
          estFavori={raccourcis.estFavori}
          onSuivant={avancer}
        />
      )}

      {/*
        COURSES C2 — LA LISTE EST DÉSORMAIS PERSISTÉE.

        ⚠️ `EcranListe` (C1) EST CONSERVÉ, ET RESTE EXPORTÉ. Il porte
        l'affichage local de la liste agrégée, et la suite `liste-de-courses-ux`
        le mesure directement. Le supprimer obligerait à réécrire des tests hors
        périmètre pour retrouver du vert — ce qui est précisément interdit.
        C'est C2 qui prend la place à l'écran, pas C2 qui efface C1.
      */}
      {etape === "liste" && (
        <ListeDeCoursesPersistante
          periode={periode}
          lignesDuPlan={courses.lignes}
          studentId={studentId}
          restants={courses.aComposer.length}
        />
      )}
    </div>
  );
}

/**
 * CORRECTIF D-1 — L'UNIQUE MESSAGE DE LECTURE IMPOSSIBLE.
 *
 * ⚠️ « LA LECTURE A ÉCHOUÉ » ET « IL N'Y A RIEN » SONT DEUX FAITS DIFFÉRENTS.
 * Les confondre affiche « aucun repas » à un élève qui a tout validé, et
 * l'envoie tout refaire. Ce composant existe pour que les DEUX écrans qui
 * lisent le planifié disent exactement la même chose — un second message
 * aurait divergé au premier ajustement.
 */
function LectureImpossible() {
  return (
    <p
      className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      Impossible de lire tes repas prévus. Vérifie ta connexion, puis reviens sur cet écran.
    </p>
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
  const titre =
    etape === "liste"
      ? "MA LISTE DE COURSE"
      : etape === "proposition"
        ? "TA SEMAINE PROPOSÉE"
        : "GÉNÉRER MA LISTE DE COURSE";
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
 * ⚠️ LES ÉCRANS SONT EXPORTÉS POUR ÊTRE MESURÉS. Le responsive se vérifie
 * écran par écran, à six largeurs : sans export, le banc ne pourrait atteindre
 * que le premier, et « aucun débordement » ne vaudrait que pour lui. Ils ne
 * sont montés nulle part ailleurs que par `ListeDeCoursesParcours`.
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
   ÉCRAN 2 — LE MODE
   ══════════════════════════════════════════════════════════════════════════ */

export function EcranMode({
  mode,
  onChoisir,
  onSuivant,
}: {
  /** `null` = aucun mode sélectionné. Aucune pré-sélection. */
  readonly mode: ModeCourses;
  readonly onChoisir: (valeur: ModeCoursesChoisi) => void;
  readonly onSuivant: () => void;
}) {
  const nom = useId();
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-heading text-lg font-bold uppercase text-foreground">
          Comment veux-tu préparer ta semaine&nbsp;?
        </legend>
        {/* ⚠️ RENDU EN BOUCLE SUR `MODES_COURSES`. Le jour où « Comme la
            semaine passée » arrivera, il suffira d'une entrée dans la table :
            cet écran n'a aucune connaissance des modes qu'il affiche. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {MODES_COURSES.map((description) => {
            const choisi = description.cle === mode;
            return (
              <label
                key={description.cle}
                className={`pressable flex min-h-[44px] cursor-pointer flex-col gap-2 rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-info/50 ${
                  choisi ? "border-info bg-info/10" : "border-border bg-card hover:border-info/60"
                }`}
              >
                <input
                  type="radio"
                  name={nom}
                  value={description.cle}
                  checked={choisi}
                  onChange={() => onChoisir(description.cle)}
                  className="sr-only"
                />
                <span className="flex min-w-0 items-center gap-2">
                  {/* L'état est écrit ET marqué : jamais la couleur seule. */}
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                      choisi ? "border-info bg-info/30" : "border-border"
                    }`}
                  >
                    {choisi && <Check size={10} className="text-info" />}
                  </span>
                  <span className="min-w-0 truncate font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                    {description.titre}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {description.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <BoutonPrincipal onClick={onSuivant} desactive={mode === null}>
        {mode === null ? "Choisis un mode" : "Continuer"}
      </BoutonPrincipal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 3 (RAPIDE) — LES PRÉFÉRENCES COURTES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ AUCUNE CATÉGORIE, ET CE N'EST PAS UN RACCOURCI. Le modèle ne porte
 * aucune classification alimentaire fiable — `food_catalog` n'a ni tag ni
 * groupe, `source_ref` ne stocke que le code Ciqual sans sa table de groupes,
 * et le contrat Open Food Facts ne demande pas `categories_tags`. Inventer
 * « VIANDES / FÉCULENTS / LÉGUMES » à partir des noms serait faux au premier
 * « bouillon de poulet ». On pose donc une question courte et honnête.
 *
 * ⚠️ PRÉFÉRENCES POSITIVES SEULEMENT. Aucune exclusion, aucune allergie,
 * aucun « je ne veux jamais » : ces notions demandent une taxonomie qui
 * n'existe pas, et se tromper sur une allergie n'est pas une erreur d'UI.
 */
export function EcranPreferencesRapides({
  repas,
  favoris,
  preferences,
  onBasculer,
  chargement,
  onSuivant,
}: {
  readonly repas: readonly RepasDeLaPeriode[];
  readonly favoris: ReadonlySet<string>;
  readonly preferences: ReadonlySet<string>;
  readonly onBasculer: (cle: string) => void;
  readonly chargement: boolean;
  readonly onSuivant: () => void;
}) {
  const options = useMemo(() => optionsProposables(repas, favoris), [repas, favoris]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Qu&apos;est-ce que tu préfères cette semaine&nbsp;?
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Voici quelques aliments que ton coach autorise sur cette période. Choisis-en autant que tu
          veux&nbsp;: on les mettra en avant dans la proposition. Tu pourras tout modifier ensuite,
          et ne rien choisir reste possible.
        </p>
      </div>

      {chargement && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {!chargement && options.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune liste d&apos;aliments n&apos;est proposée sur cette période.
        </p>
      )}

      {options.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <li key={option.cle}>
              <CartePreference
                option={option}
                choisie={preferences.has(option.cle)}
                onBasculer={() => onBasculer(option.cle)}
              />
            </li>
          ))}
        </ul>
      )}

      <BoutonPrincipal onClick={onSuivant}>Voir ma semaine proposée</BoutonPrincipal>
    </div>
  );
}

function CartePreference({
  option,
  choisie,
  onBasculer,
}: {
  readonly option: OptionProposable;
  readonly choisie: boolean;
  readonly onBasculer: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisie}
      onClick={onBasculer}
      className={`pressable flex min-h-[44px] w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50 ${
        choisie ? "border-info bg-info/10" : "border-border bg-card hover:border-info/40"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border ${
            choisie ? "border-info bg-info/25" : "border-border"
          }`}
        >
          {choisie && <Check size={10} className="text-info" />}
        </span>
        <span className="min-w-0 truncate text-sm text-foreground">
          {option.displayName === "" ? "Aliment sans nom" : option.displayName}
        </span>
      </span>
      {/* ⚠️ LE FAVORI EST UN SIGNAL AUTOMATIQUE, PAS UNE CASE À COCHER. L'étoile
          dit « tu l'as déjà en favori », elle ne se clique pas ici. */}
      {option.favori && (
        <span className="flex flex-shrink-0 items-center">
          <Star size={14} aria-hidden="true" className="fill-info text-info" />
          <span className="sr-only">Déjà dans tes favoris</span>
        </span>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 4 (RAPIDE) — LA SEMAINE PROPOSÉE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ UNE PROPOSITION EST UN BROUILLON. Rien n'est écrit tant que l'élève n'a
 * pas cliqué « VALIDER MA SEMAINE ». Chaque repas reste ouvrable et modifiable
 * — le composant monté est `StudentMealChoices`, pré-rempli par
 * `propositionInitiale`, jamais un second sélecteur.
 */
export function EcranProposition({
  groupes,
  proposition,
  estFavori,
  chargement,
  ok,
  enCours,
  resultat,
  onValiderSemaine,
  onSuivant,
}: {
  readonly groupes: readonly GroupeDeJour[];
  readonly proposition: ReadonlyMap<string, { readonly selection: SelectionDeChoix; readonly complet: boolean }>;
  readonly estFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;
  readonly chargement: boolean;
  /** CORRECTIF D-1 — `false` si la lecture a échoué. Ce n'est PAS « 0 repas ». */
  readonly ok: boolean;
  readonly enCours: boolean;
  readonly resultat: ResultatValidationSemaine | null;
  readonly onValiderSemaine: (entrees: readonly RepasAValider[]) => void | Promise<void>;
  readonly onSuivant: () => void;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  /** Les modifications faites par l'élève sur la proposition, avant validation. */
  const [retouches, setRetouches] = useState<ReadonlyMap<string, readonly ItemPourEnregistrement[]>>(new Map());

  // ⚠️ CE QUI PARTIRA EN BASE, CALCULÉ PAR LE SOLVEUR EXISTANT ET LUI SEUL.
  // `calculDuRepas` → solveur de N1.5 → `itemsAValider` recopie l'entier
  // AFFICHÉ. Aucun calcul de quantité n'a lieu dans le mode Rapide.
  const aValider = useMemo<readonly RepasAValider[]>(() => {
    const entrees: RepasAValider[] = [];
    for (const groupe of groupes) {
      for (const carte of groupe.cartes) {
        if (carte.pret || carte.consomme) continue;
        const libelle = `${groupe.libelleJour} ${groupe.libelleDate} · ${carte.libelleCreneau}`;
        const retouche = retouches.get(carte.repas.cle);
        if (retouche) {
          entrees.push({ repas: carte.repas, libelle, items: retouche });
          continue;
        }
        const proposee = proposition.get(carte.repas.cle);
        if (!proposee?.complet) continue;
        const calcul = calculDuRepas(carte.repas.occurrences, proposee.selection, carte.repas.cible);
        if (calcul.etat !== "calcule") continue;
        entrees.push({ repas: carte.repas, libelle, items: itemsAValider(calcul.solution) });
      }
    }
    return entrees;
  }, [groupes, proposition, retouches]);

  const comptes = compterCartes(groupes);
  const proposables = aValider.length;

  if (chargement) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  // ⚠️ CORRECTIF D-1 — L'ERREUR AVANT LE VIDE, comme sur l'écran des repas.
  if (!ok) return <LectureImpossible />;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Rien n&apos;est encore enregistré. Ouvre un repas pour changer un aliment, puis valide ta
        semaine quand elle te convient.
      </p>

      {/* ⚠️ CORRECTIF D-1 — « aucun repas » n'est dit QUE si la lecture a réussi. */}
      {groupes.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun repas à valider sur cette période.</p>
      )}

      {/* ⚠️ CORRECTIF D-3 — LES REPAS À RECOMPOSER SONT COMPTÉS ET DITS. Ils ne
          peuvent pas être proposés (ce serait substituer un aliment retiré par
          le coach), mais ils ne doivent pas non plus disparaître en silence. */}
      {comptes.aRecomposer > 0 && (
        <p
          className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
          {comptes.aRecomposer} repas {comptes.aRecomposer > 1 ? "sont" : "est"} à
          recomposer&nbsp;: ton coach a modifié les aliments autorisés depuis ta validation. Ouvre-les
          pour choisir à nouveau — aucun aliment n&apos;a été remplacé à ta place.
        </p>
      )}

      {resultat !== null && <RapportDeValidation resultat={resultat} />}

      <ListeDesJours
        groupes={groupes}
        ouvert={ouvert}
        onOuvrir={setOuvert}
        estFavori={estFavori}
        proposition={proposition}
        enCours={enCours}
        onRetoucher={(cle, items) =>
          setRetouches((actuelles) => new Map(actuelles).set(cle, items))
        }
      />

      {/* ⚠️ LE BOUTON DIT COMBIEN DE REPAS IL VA ÉCRIRE. « Valider ma semaine »
          sans nombre laisserait croire que les 21 repas partent, alors que les
          repas déjà prêts ou déjà consommés ne sont pas retouchés. */}
      <BoutonPrincipal
        onClick={() => void onValiderSemaine(aValider)}
        desactive={enCours || proposables === 0}
      >
        {enCours
          ? "Validation…"
          : proposables === 0
            ? "Aucun repas à valider"
            : `VALIDER MA SEMAINE (${proposables})`}
      </BoutonPrincipal>

      {comptes.prets > 0 && (
        <button
          type="button"
          onClick={onSuivant}
          className="pressable min-h-[44px] self-start rounded-control px-2 text-xs uppercase tracking-widest text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
        >
          Passer à mes repas
        </button>
      )}
    </div>
  );
}

/**
 * ⚠️ JAMAIS « SEMAINE VALIDÉE » SI UNE PARTIE A ÉCHOUÉ. Il n'existe aucune
 * transaction entre repas : chaque repas est écrit par son propre appel. On
 * dit donc exactement ce qui est passé et ce qui reste — et on nomme les
 * repas concernés, sans quoi « 1 repas à corriger » est inexploitable.
 */
function RapportDeValidation({ resultat }: { readonly resultat: ResultatValidationSemaine }) {
  if (resultat.complet) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
      >
        <Check size={16} aria-hidden="true" className="flex-shrink-0" />
        {resultat.valides} repas validé{resultat.valides > 1 ? "s" : ""}.
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <p className="font-bold">
        {resultat.valides} repas validé{resultat.valides > 1 ? "s" : ""} ·{" "}
        {resultat.echecs.length} repas à corriger
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {resultat.echecs.map((echec) => (
          <li key={echec.cle} className="min-w-0">
            <span className="font-bold">{echec.libelle}</span> — {echec.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 5 — LES REPAS, GROUPÉS PAR JOUR (LES DEUX MODES CONVERGENT ICI)
   ══════════════════════════════════════════════════════════════════════════ */

export function EcranRepasParJour({
  groupes,
  chargement,
  ok,
  enCours,
  erreur,
  onValider,
  estFavori,
  onSuivant,
}: {
  readonly groupes: readonly GroupeDeJour[];
  readonly chargement: boolean;
  readonly ok: boolean;
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly onValider: (repas: RepasDeLaPeriode, items: readonly ItemPourEnregistrement[]) => Promise<boolean>;
  readonly estFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;
  readonly onSuivant: () => void;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const comptes = compterCartes(groupes);
  const restants = comptes.total - comptes.prets;

  if (chargement) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  // ⚠️ UNE LECTURE RATÉE N'EST PAS « RIEN DE PRÉVU ». Afficher « tout reste à
  // composer » à un élève qui a tout validé l'enverrait tout refaire.
  if (!ok) return <LectureImpossible />;

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
            {restants} repas rest{restants > 1 ? "ent" : "e"} à composer&nbsp;: seuls les repas
            validés entrent dans la liste.
          </p>
        )}
        {comptes.aRecomposer > 0 && (
          <p className="text-sm text-warning" role="status">
            {comptes.aRecomposer} repas {comptes.aRecomposer > 1 ? "sont" : "est"} à recomposer&nbsp;:
            ton coach a modifié les aliments autorisés depuis ta validation.
          </p>
        )}
      </div>

      {erreur && (
        <p
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {erreur}
        </p>
      )}

      {groupes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun repas à listes d&apos;aliments n&apos;est prescrit sur cette période.
        </p>
      )}

      <ListeDesJours
        groupes={groupes}
        ouvert={ouvert}
        onOuvrir={setOuvert}
        estFavori={estFavori}
        proposition={null}
        enCours={enCours}
        onValiderRepas={onValider}
      />

      <BoutonPrincipal onClick={onSuivant} desactive={restants > 0 || comptes.total === 0}>
        {restants > 0 ? `${restants} repas à composer` : "GÉNÉRER MA LISTE"}
      </BoutonPrincipal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LES JOURS ET LEURS CARTES — LE MÊME RENDU DANS LES DEUX MODES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ GROUPÉ PAR JOUR, ET LE CRÉNEAU EST ÉCRIT. Le défaut de C1 était une liste
 * plate où trois repas d'un même jour se lisaient « Lundi · 2026-08-17 »,
 * indiscernables. Ici chaque jour est un titre, chaque carte dit son créneau
 * en français, sa progression et son statut.
 *
 * ⚠️ AUCUN REPAS ARTIFICIEL. Les cartes viennent de `groupesParJour`, qui ne
 * rend que ce que le plan prescrit ce jour-là.
 */
function ListeDesJours({
  groupes,
  ouvert,
  onOuvrir,
  estFavori,
  proposition,
  enCours,
  onValiderRepas,
  onRetoucher,
}: {
  readonly groupes: readonly GroupeDeJour[];
  readonly ouvert: string | null;
  readonly onOuvrir: (cle: string | null) => void;
  readonly estFavori: (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;
  readonly proposition: ReadonlyMap<string, { readonly selection: SelectionDeChoix }> | null;
  readonly enCours: boolean;
  readonly onValiderRepas?: (repas: RepasDeLaPeriode, items: readonly ItemPourEnregistrement[]) => Promise<boolean>;
  readonly onRetoucher?: (cle: string, items: readonly ItemPourEnregistrement[]) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {groupes.map((groupe) => (
        <section key={groupe.date} className="flex min-w-0 flex-col gap-2">
          <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="font-heading text-base font-extrabold uppercase tracking-wide text-foreground">
              {groupe.libelleJour}
            </h3>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {groupe.libelleDate}
            </span>
            <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {groupe.prets}/{groupe.total} prêts
            </span>
          </header>

          <ul className="flex flex-col gap-2">
            {groupe.cartes.map((carte) => (
              <li key={carte.repas.cle} className="rounded-card border border-border bg-card">
                <CarteDeRepas
                  carte={carte}
                  ouverte={ouvert === carte.repas.cle}
                  onBasculer={() => onOuvrir(ouvert === carte.repas.cle ? null : carte.repas.cle)}
                />
                {ouvert === carte.repas.cle && (
                  <div className="border-t border-border px-4 py-4">
                    {/* ⚠️ LE COMPOSANT DE N1.4/N1.5/C0, TEL QUEL. Mêmes
                        occurrences, même cible, même geste de validation — et
                        en mode Rapide, une simple sélection de départ. */}
                    <StudentMealChoices
                      key={cleDeComposition(carte.repas.mealId, carte.repas.date)}
                      occurrences={carte.repas.occurrences}
                      cible={carte.repas.cible}
                      misEnAvant={estFavori}
                      propositionInitiale={proposition?.get(carte.repas.cle)?.selection ?? null}
                      validation={{
                        compositionValidee: carte.repas.composition,
                        enCours,
                        // ⚠️ CORRECTIF D-2 — LE MODE EST DÉCLARÉ, PAS DEVINÉ.
                        // `onRetoucher` ⇒ semaine proposée : rien n'est écrit,
                        // le bouton dira « Appliquer mes choix ».
                        mode: onRetoucher ? "brouillon" : "validation",
                        onValider: (items) => {
                          if (onRetoucher) onRetoucher(carte.repas.cle, items);
                          else void onValiderRepas?.(carte.repas, items);
                        },
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CarteDeRepas({
  carte,
  ouverte,
  onBasculer,
}: {
  readonly carte: CarteRepas;
  readonly ouverte: boolean;
  readonly onBasculer: () => void;
}) {
  const statut = carte.aRecomposer ? "À RECOMPOSER" : carte.pret ? "PRÊT" : "À COMPOSER";
  const teinte = carte.aRecomposer
    ? "border-warning/50 text-warning"
    : carte.pret
      ? "border-success/50 text-success"
      : "border-warning/50 text-warning";
  return (
    <button
      type="button"
      aria-expanded={ouverte}
      onClick={onBasculer}
      className="pressable flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-heading text-sm font-bold uppercase text-foreground">
          {carte.libelleCreneau}
        </span>
        {/* Le nom du coach n'apparaît que s'il apporte autre chose que le créneau. */}
        {carte.nomPersonnalise !== null && (
          <span className="truncate text-[11px] text-muted-foreground">{carte.nomPersonnalise}</span>
        )}
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {carte.choisis} / {carte.total} choix
        </span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        {/* ⚠️ L'ÉTAT S'ÉCRIT, il ne se devine pas à la teinte. */}
        <span
          className={`flex items-center gap-1.5 rounded-control border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${teinte}`}
        >
          {carte.pret && !carte.aRecomposer && <Check size={12} aria-hidden="true" />}
          {statut}
        </span>
        {ouverte ? (
          <ChevronDown size={16} aria-hidden="true" className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} aria-hidden="true" className="text-muted-foreground" />
        )}
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRAN 6 — LA LISTE
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
        <p
          className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
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

/** Réservé aux futurs modes : l'icône du mode Rapide. Ne rend rien aujourd'hui. */
void Sparkles;
