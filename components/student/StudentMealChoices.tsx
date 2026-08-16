"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Check, ChevronRight, Star } from "lucide-react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  AUCUNE_SELECTION,
  compositionIdentique,
  selectionDepuisComposition,
  type ChoixPersiste,
  calculDuRepas,
  choisirOption,
  optionChoisie,
  optionExploitable,
  progressionDesChoix,
  type SelectionDeChoix,
} from "@/lib/nutrition/meal-choice-selection";
import type { MealChoiceSolution, MealMacroTarget } from "@/lib/nutrition/meal-choice-solver";
import { APPROXIMATE_TOLERANCE_GRAMS, APPROXIMATE_TOLERANCE_RATIO } from "@/lib/nutrition/recipe-solver";
import type { MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";
import { colorKeyBorderClass } from "@/components/ui/ColorKeyDot";

/**
 * N1.4 — L'ÉLÈVE CHOISIT UN ALIMENT DANS CHAQUE LISTE DE SON REPAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FERMÉ PAR DÉFAUT, ET RÉELLEMENT FERMÉ
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LES OPTIONS NE SONT PAS RENDUES TANT QUE L'OCCURRENCE EST FERMÉE. Elles ne
 * sont pas masquées en CSS : elles n'existent pas dans le DOM. Un repas à dix
 * listes de dix aliments poserait cent lignes qu'aucun lecteur d'écran ne
 * devrait avoir à traverser, et que personne n'a demandé à voir.
 *
 * ⚠️ UNE SEULE OUVERTE À LA FOIS — mais ouvrir n'a AUCUN effet sur les choix
 * des autres occurrences. Replier n'efface rien.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE LOT NE CALCULE RIEN ET N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE QUANTITÉ N'EST AFFICHÉE DANS LES LISTES elles-mêmes. Un aliment
 * proposé n'a pas de quantité : elle dépend des NEUF autres choix du repas.
 * Les quantités arrivent plus bas, une fois la composition complète — voir la
 * section N1.5 en fin de fichier.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * N1.5 — LE CALCUL VIENT APRÈS LES CHOIX, ET IL EST GLOBAL
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ RIEN N'EST CALCULÉ TANT QUE LA COMPOSITION EST INCOMPLÈTE. Deux choix sur
 * cinq ne donnent pas « deux cinquièmes du repas » : ils ne donnent RIEN. Les
 * trois macros du repas se répartissent entre TOUS les aliments à la fois ;
 * en afficher avant la fin voudrait dire les recalculer entièrement à chaque
 * nouveau choix, sous les yeux de l'élève, avec des valeurs fausses entre
 * temps.
 *
 * ⚠️ CHANGER UN CHOIX RECALCULE TOUT. La solution est DÉRIVÉE de la sélection
 * (`useMemo`), jamais rangée dans un état : il n'existe donc aucun chemin par
 * lequel une quantité pourrait survivre au choix qui l'a produite.
 *
 * ⚠️ AUCUNE ÉCRITURE. Ce composant n'importe pas Supabase, n'appelle aucune
 * RPC, ne crée aucun repas consommé. `ouvrir_repas_prescrit` reste déclenchée
 * par le seul « Ajouter un aliment » de la section consommation, comme avant.
 * Il n'y a donc PAS de bouton « Enregistrer » : il mentirait, puisqu'il n'y a
 * encore ni quantité à enregistrer, ni consommation à créer.
 *
 * ⚠️ ET AUCUNE RECHERCHE LIBRE. Le coach a déjà réduit le choix : l'élève ne
 * voit que `meal_choice_options` de CETTE occurrence. Pas de catalogue, pas de
 * scan, pas d'Open Food Facts.
 */
/**
 * COURSES C1 — « CET ALIMENT EST L'UN DE MES PRÉFÉRÉS ».
 *
 * ⚠️ UNE AIDE AU CHOIX, JAMAIS UNE SOURCE D'ALIMENTS. La fonction est
 * INTERROGÉE avec une option qui vient déjà du snapshot du coach ; elle rend
 * un booléen, et ne peut donc, par construction, ni ajouter, ni retirer, ni
 * remplacer une option. Elle est facultative : sans elle, cet écran est celui
 * de N1.4 au caractère près.
 */
export type MiseEnAvantDOption = (cible: { readonly type: "aliment" | "produit"; readonly id: string }) => boolean;

/**
 * COURSES C1.1 — CORRECTIF D-2.
 *   `"validation"` = le clic ÉCRIT en base (C0). Libellé « Valider mes choix ».
 *   `"brouillon"`  = le clic ne fait qu'appliquer la retouche à une proposition
 *                    non encore écrite. Libellé « Appliquer mes choix ».
 */
export type ModeDeValidation = "validation" | "brouillon";

export function StudentMealChoices({
  occurrences,
  cible = null,
  enregistrement = null,
  validation = null,
  misEnAvant = null,
  propositionInitiale = null,
}: {
  /** COURSES C1 — voir `MiseEnAvantDOption`. `null` = aucun repère affiché. */
  readonly misEnAvant?: MiseEnAvantDOption | null;
  /**
   * COURSES C1.1 — LE POINT DE DÉPART PROPOSÉ PAR LE MODE RAPIDE.
   *
   * ⚠️ CE N'EST PAS UNE COMPOSITION VALIDÉE, et l'écran ne le dit jamais. Rien
   * n'est écrit en base : `dejaValide` et `aJour` restent gouvernés par la
   * SEULE `compositionValidee`, donc le bouton affiche bien « Valider mes
   * choix » et non « Choix validés ». C'est un brouillon pré-rempli, que
   * l'élève peut modifier occurrence par occurrence comme s'il l'avait fait
   * lui-même.
   *
   * ⚠️ LA COMPOSITION VALIDÉE L'EMPORTE TOUJOURS. Une proposition ne recouvre
   * jamais un repas que l'élève a déjà composé — ce serait effacer son travail.
   *
   * `null` (le défaut) laisse l'écran exactement dans son état N1.4/N1.5/C0.
   */
  readonly propositionInitiale?: SelectionDeChoix | null;
  readonly occurrences: readonly MealChoiceSlot[];
  /**
   * N1.6B — DE QUOI ENREGISTRER LA PROPOSITION DANS « CE QUE J'AI MANGÉ ».
   *
   * ⚠️ `null` LAISSE L'ÉCRAN STRICTEMENT DANS SON ÉTAT N1.5.3 : aucun bouton,
   * aucune écriture, aucun import Supabase par ce composant. C'est le parent
   * qui branche la persistance ; celui-ci reste PUR et rendu hors navigateur
   * par les tests.
   */
  readonly enregistrement?: {
    readonly dejaEnregistre: boolean;
    readonly enCours: boolean;
    readonly onEnregistrer: (items: readonly ItemPourEnregistrement[]) => void;
  } | null;
  /**
   * COURSES C0 — DE QUOI VALIDER UNE COMPOSITION PRÉVUE, SANS LA MANGER.
   *
   * ⚠️ `null` LAISSE L'ÉCRAN EXACTEMENT DANS SON ÉTAT N1.6. Comme pour
   * `enregistrement`, c'est le parent qui branche la persistance ; ce
   * composant reste pur et rendu hors navigateur par les tests.
   */
  readonly validation?: {
    /** La composition DÉJÀ en base, ou `null` si ce repas n'est pas validé. */
    readonly compositionValidee: readonly ChoixPersiste[] | null;
    readonly enCours: boolean;
    readonly onValider: (items: readonly ItemPourEnregistrement[]) => void;
    /**
     * COURSES C1.1 — CORRECTIF D-2 : CE QUE LE BOUTON PROMET RÉELLEMENT.
     *
     * ⚠️ UN LIBELLÉ NE DOIT JAMAIS PROMETTRE UNE ÉCRITURE QUI N'A PAS LIEU.
     * Dans le parcours C0, `onValider` appelle `enregistrer_repas_planifie` :
     * le bouton dit « Valider mes choix », et c'est vrai. Dans la semaine
     * PROPOSÉE du mode Rapide, il ne fait que retenir une retouche en
     * mémoire — l'écriture n'arrive qu'au « VALIDER MA SEMAINE » final. Le
     * bouton dit alors « Appliquer mes choix ».
     *
     * ⚠️ EXPLICITE, JAMAIS DEVINÉ. On ne renifle pas le callback pour savoir
     * s'il écrit : c'est l'appelant qui le déclare. Une détection fragile se
     * tromperait le jour où le parent changerait d'implémentation.
     *
     * Défaut `"validation"` : le parcours C0 est inchangé au caractère près.
     */
    readonly mode?: ModeDeValidation;
  } | null;
  /**
   * ⚠️ LA CIBLE DU REPAS VIENT DU PLAN DU COACH, PAS D'ICI. C'est la valeur
   * DÉJÀ affichée en tête du repas par `StudentPrescribedWeek` — donc
   * `slotMacrosForDay` appliqué au jour, ou les macros saisies à la main sur
   * un repas antérieur au modèle v2. Aucune répartition parallèle n'est
   * recalculée : les deux endroits doivent dire le même nombre, et la seule
   * façon d'en être sûr est qu'il n'y en ait qu'un.
   *
   * `null` quand le jour n'a pas de cible exploitable (profil introuvable,
   * créneau désactivé) : il n'y a alors rien à viser, donc rien à calculer.
   */
  readonly cible?: MealMacroTarget | null;
}) {
  // ⚠️ L'ÉTAT VIT ICI, ET LE COMPOSANT EST MONTÉ AVEC UNE CLÉ repas+date.
  // Changer de repas ou de jour démonte donc ce composant et son brouillon
  // avec lui : une composition ne peut pas fuir d'un repas vers un autre.
  // ── COURSES C0 — LA SÉLECTION EST DÉRIVÉE, PAS SYNCHRONISÉE ─────────────
  // ⚠️ `null` NE VEUT PAS DIRE « VIDE », MAIS « L'ÉLÈVE N'A RIEN TOUCHÉ ». La
  // sélection effective est alors celle RESTAURÉE depuis la base. Dès le
  // premier clic, le brouillon local prend la main et ne la rend plus.
  //
  // ⚠️ AUCUN `useEffect` DE SYNCHRONISATION, ET C'EST VOLONTAIRE. La
  // composition validée arrive de façon asynchrone ; la recopier dans un état
  // par effet créerait une fenêtre où l'écran montre « aucun choix » sur un
  // repas validé, puis se corrige tout seul — et écraserait un brouillon en
  // cours si la relecture arrivait entre deux clics. Une dérivation pure n'a
  // ni fenêtre ni course.
  const [brouillon, setBrouillon] = useState<SelectionDeChoix | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const titreId = useId();

  const composition = validation?.compositionValidee ?? null;
  // ⚠️ LA SÉLECTION DE DÉPART. Elle vient de la composition VALIDÉE quand elle
  // existe — et, à défaut seulement, de la proposition du mode Rapide (C1.1),
  // qui n'est écrite nulle part. L'ordre n'est pas négociable : le validé
  // l'emporte toujours sur le proposé.
  const selectionValidee = useMemo(
    () => (composition === null ? propositionInitiale : selectionDepuisComposition(occurrences, composition)),
    [occurrences, composition, propositionInitiale],
  );
  const selection = brouillon ?? selectionValidee ?? AUCUNE_SELECTION;

  const choisir = useCallback(
    (slotId: string, optionId: string) => {
      // ⚠️ LE PREMIER CLIC PART DE LA SÉLECTION RESTAURÉE, pas d'un objet vide :
      // changer sa protéine ne doit pas effacer son féculent déjà validé.
      setBrouillon((precedente) =>
        choisirOption(precedente ?? selectionValidee ?? AUCUNE_SELECTION, slotId, optionId),
      );
      // Le choix fait, la liste se referme : l'élève voit sa composition, pas
      // dix listes ouvertes les unes sous les autres.
      setOuverte(null);
    },
    [selectionValidee],
  );

  const progression = progressionDesChoix(occurrences, selection);

  // ── N1.5 — LA SOLUTION EST DÉRIVÉE, PAS STOCKÉE ─────────────────────────
  // ⚠️ AUCUN `useState<Solution>`, AUCUN `useEffect`. La sélection est la
  // seule source de vérité ; les quantités en découlent par pur calcul. Un
  // état parallèle pourrait rester en retard d'un choix — c'est exactement le
  // défaut que « changer un choix recalcule tout le repas » interdit.
  //
  // ⚠️ LES DÉPENDANCES SONT DES NOMBRES, PAS L'OBJET `cible`. Le parent
  // reconstruit cet objet à chaque rendu ; s'y fier ferait re-résoudre pour
  // rien. Trois nombres identiques = même cible.
  const cibleP = cible?.proteinGrams ?? null;
  const cibleG = cible?.carbGrams ?? null;
  const cibleL = cible?.fatGrams ?? null;

  const calcul = useMemo(
    () =>
      calculDuRepas(
        occurrences,
        selection,
        cibleP === null || cibleG === null || cibleL === null
          ? null
          : { proteinGrams: cibleP, carbGrams: cibleG, fatGrams: cibleL },
      ),
    [occurrences, selection, cibleP, cibleG, cibleL],
  );

  // ⚠️ APRÈS LES HOOKS, JAMAIS AVANT. Un repas sans occurrence ne rend rien —
  // le parcours d'un repas libre est inchangé à l'octet près.
  if (occurrences.length === 0) return null;

  return (
    <section aria-labelledby={titreId} className="mt-3 flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 id={titreId} className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Choix alimentaires
        </h5>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progression.choisis} / {progression.total}
        </span>
      </div>

      <ol className="flex min-w-0 flex-col gap-2">
        {occurrences.map((occurrence) => (
          <LigneChoix
            key={occurrence.id}
            occurrence={occurrence}
            choisie={optionChoisie(occurrence, selection)}
            ouverte={ouverte === occurrence.id}
            onBasculer={() => setOuverte(ouverte === occurrence.id ? null : occurrence.id)}
            onChoisir={(optionId) => choisir(occurrence.id, optionId)}
            misEnAvant={misEnAvant}
          />
        ))}
      </ol>

      {calcul.etat === "non-calculable" && (
        <p className="rounded-control border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Les quantités ne peuvent pas être calculées : un aliment de ta composition n&apos;est plus
          disponible. Choisis-en un autre dans la liste concernée.
        </p>
      )}

      {calcul.etat === "calcule" && (
        <QuantitesDuRepas
          solution={calcul.solution}
          enregistrement={enregistrement}
          validation={
            validation === null
              ? null
              : {
                  // ⚠️ « DÉJÀ VALIDÉ » NE SUFFIT PAS : il faut savoir si ce qui
                  // est À L'ÉCRAN est ce qui est EN BASE. C'est cette
                  // comparaison — identités ET quantités — qui distingue
                  // « choix validés » de « modifications non validées ».
                  aJour:
                    composition !== null &&
                    compositionIdentique(occurrences, calcul.solution.items, composition),
                  dejaValide: composition !== null,
                  enCours: validation.enCours,
                  onValider: validation.onValider,
                  mode: validation.mode ?? "validation",
                }
          }
        />
      )}
    </section>
  );
}

/**
 * N1.5 / N1.5.3 — « QUANTITÉS POUR TON REPAS ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * N1.5.3 — « IMPOSSIBLE » N'AFFICHE PLUS UNE PAGE VIDE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE COMPOSANT DISAIT L'INVERSE, ET C'EST LE CŒUR DE CE LOT. Il portait
 * « ON N'AFFICHE JAMAIS UNE QUANTITÉ QUI MENT » et remplaçait la liste des
 * grammes par un paragraphe dès que le statut valait `impossible`. Le terrain
 * a tranché : l'élève voyait une phrase de refus et AUCUN nombre, sans savoir
 * ni ce qu'il aurait, ni ce qui manquait.
 *
 * La prémisse était fausse. Depuis N1.5.3, le solveur ne rend plus « un point
 * faisable » mais **l'optimum certifié de la boîte** (conditions KKT
 * vérifiées) : la solution affichée est la MEILLEURE réalisable avec ces
 * choix-là. Elle ne ment pas — elle est simplement loin de la cible, et l'écran
 * le dit maintenant en chiffres plutôt qu'en silence.
 *
 * ⚠️ LA SEULE RAISON QUI RESTE DE NE RIEN AFFICHER EST STRUCTURELLE, et elle
 * n'arrive jamais jusqu'ici : unité inconnue, identité introuvable,
 * minimum > maximum, données invalides, solveur non convergent. Tous ces cas
 * sont filtrés en amont par `calculDuRepas`, qui rend `non-calculable`.
 *
 * ⚠️ L'ORDRE EST CELUI DES OCCURRENCES DU COACH. Ni par quantité, ni par
 * ordre alphabétique, ni par ordre de résolution : l'élève doit retrouver
 * ses lignes là où il vient de les choisir.
 *
 * ⚠️ LES NOMBRES AFFICHÉS SONT CEUX QUI ONT SERVI AU VERDICT. `actual` est
 * recalculé sur les quantités ARRONDIES, jamais sur les quantités exactes :
 * « RÉSULTAT » est donc littéralement ce que produisent les grammes écrits
 * juste au-dessus — et les écarts aussi.
 */
export function QuantitesDuRepas({
  solution,
  enregistrement = null,
  validation = null,
}: {
  readonly solution: MealChoiceSolution;
  readonly enregistrement?: {
    readonly dejaEnregistre: boolean;
    readonly enCours: boolean;
    readonly onEnregistrer: (items: readonly ItemPourEnregistrement[]) => void;
  } | null;
  /** COURSES C0 — l'état de la composition PRÉVUE, face à ce qui est affiché. */
  readonly validation?: {
    /** La base contient DÉJÀ une composition pour ce repas et cette date. */
    readonly dejaValide: boolean;
    /** …et elle est EXACTEMENT celle qui est affichée. */
    readonly aJour: boolean;
    readonly enCours: boolean;
    readonly onValider: (items: readonly ItemPourEnregistrement[]) => void;
    /** COURSES C1.1 — voir `ModeDeValidation`. Défaut : `"validation"`. */
    readonly mode?: ModeDeValidation;
  } | null;
}) {
  const titreId = useId();
  const ecarts = ecartsAAfficher(solution);

  return (
    <section
      aria-labelledby={titreId}
      className="mt-1 flex min-w-0 flex-col gap-2 rounded-control border border-border bg-card p-3"
    >
      <h5 id={titreId} className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Quantités pour ton repas
      </h5>

      {/* ⚠️ TOUJOURS RENDUE, QUEL QUE SOIT LE STATUT. */}
      <ul className="flex min-w-0 flex-col gap-1">
        {solution.items.map((item) => (
          <li key={item.optionId} className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
            {/* ⚠️ L'UNITÉ EST CELLE DE L'ALIMENT, LUE ET JAMAIS DEVINÉE. Elle
                vient de `nutrition_unit`, l'unité dans laquelle ses macros sont
                données « pour 100 » — jamais de son nom ni de sa catégorie. Un
                aliment calculé en grammes s'affiche en grammes, même si son nom
                contient « jus ». */}
            <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
              {formatIntegerFr(item.displayQuantity)}
              {NBSP}
              {item.unit}
            </span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="uppercase tracking-wide">Cible du repas</dt>
          <dd className="tabular-nums">{ligneMacros(solution.target)}</dd>
        </div>
        {/* ⚠️ AFFICHÉ MÊME EN « IMPOSSIBLE ». C'est précisément là qu'il sert. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="uppercase tracking-wide">Résultat</dt>
          <dd className="tabular-nums">{ligneMacros(solution.actual)}</dd>
        </div>
      </dl>

      {/* ⚠️ UNE PHRASE, PAS UNE ERREUR TECHNIQUE. Ni « approché » ni
          « impossible » ne sont des échecs de l'élève : c'est le meilleur que
          ces aliments-là puissent faire, et on le lui dit comme tel. */}
      {solution.status !== "exact" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {solution.status === "approximate"
            ? "Cette combinaison s'approche au mieux de ton objectif."
            : "Cette combinaison ne permet pas d'atteindre exactement ton objectif, mais voici la meilleure proposition possible avec tes choix."}
        </p>
      )}

      {ecarts.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs leading-relaxed text-muted-foreground">Pour te rapprocher de la cible :</p>
          <ul className="flex min-w-0 flex-col gap-0.5">
            {ecarts.map((ecart) => (
              <li key={ecart.macro} className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true" className="flex-shrink-0 text-muted-foreground">
                  •
                </span>
                {/* ⚠️ « AJOUTER » / « RÉDUIRE », JAMAIS UN SIGNE NU. Un « −5 g »
                    laisse l'élève deviner de quel côté aller. */}
                <span className="min-w-0">
                  {ecart.grammes > 0 ? "Ajouter" : "Réduire"} environ{NBSP}
                  <span className="tabular-nums font-bold text-foreground">
                    {formatIntegerFr(Math.abs(ecart.grammes))}
                    {NBSP}g
                  </span>{" "}
                  de {ecart.libelle}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── N1.6B — ENREGISTRER LE REPAS ────────────────────────────────
          ⚠️ LE STATUT NE BLOQUE JAMAIS. `exact`, `approché` et `impossible`
          s'enregistrent tous : c'est l'élève qui décide de ce qu'il mange, et
          une « meilleure proposition possible » reste une proposition qu'il
          peut suivre. Ce qui bloque, ce sont les impossibilités STRUCTURELLES
          — choix incomplets, aliment non calculable, solveur non convergent —
          et elles n'atteignent même pas ce composant : `calculDuRepas` rend
          alors « incomplet » ou « non-calculable », et rien de tout ceci n'est
          rendu.

          ⚠️ LES QUANTITÉS ENVOYÉES SONT CELLES QUI SONT AFFICHÉES.
          `displayQuantity`, l'entier d'après l'arrondi borné — jamais
          `quantity`, la valeur flottante interne. L'écran dit 163 g, la base
          doit dire 163. */}
      {/* ── COURSES C0 — VALIDER MES CHOIX ──────────────────────────────
          ⚠️ DEUX GESTES, DEUX SENS, ET AUCUN N'EST L'AUTRE.
            · VALIDER  = « je PRÉVOIS de manger ça » → planned_meals /
              planned_meal_items. C'est la source de la liste de courses.
            · ENREGISTRER = « j'AI mangé ça » → consumed_meals / meal_entries.
              C'est A5, et c'est inchangé.
          Le libellé « Repas enregistré » est donc RÉSERVÉ au second : l'écrire
          après une validation ferait croire à l'élève qu'il a déclaré un repas
          qu'il n'a pas encore mangé.

          ⚠️ VALIDER N'EST JAMAIS UN PASSAGE OBLIGÉ. « Enregistrer le repas »
          reste disponible sans validation préalable — la RPC de consommation
          appelle elle-même `enregistrer_repas_planifie`. Le parcours de N1.6
          est intact.

          ⚠️ ET APRÈS CONSOMMATION, ON NE PROPOSE PLUS DE VALIDER. Mesuré dans
          `courses_c0_validation_checklist.sql` (V-I) : la RPC accepterait de
          réécrire le planifié d'un repas déjà consommé, et le planifié et le
          consommé DIVERGERAIENT en silence. Le garde-fou est ici, faute d'en
          avoir un en base — et le rapport le signale comme à arbitrer. */}
      {validation !== null && enregistrement?.dejaEnregistre !== true && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-2">
          {validation.aJour ? (
            <>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-foreground">
                <Check size={14} aria-hidden="true" />
                Choix validés
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Cette composition sera prise en compte pour ta liste de courses.
              </p>
            </>
          ) : (
            <>
              {validation.dejaValide && (
                <p className="text-xs font-bold uppercase tracking-widest text-foreground">
                  Modifications non validées
                </p>
              )}
              {validation.dejaValide && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Ta liste de courses utilise encore la composition précédente.
                </p>
              )}
              <button
                type="button"
                disabled={validation.enCours}
                onClick={() =>
                  validation.onValider(
                    solution.items.map((item) => ({
                      slotId: item.slotId,
                      optionId: item.optionId,
                      quantity: item.displayQuantity,
                      unit: item.unit,
                    })),
                  )
                }
                className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {/* ⚠️ CORRECTIF D-2 — LE LIBELLÉ SUIT CE QUI SE PASSE VRAIMENT.
                    En mode brouillon, aucune RPC n'est appelée : promettre une
                    validation ferait croire à l'élève que son repas est
                    enregistré alors que rien ne l'est encore. */}
                {(validation.mode ?? "validation") === "brouillon"
                  ? "Appliquer mes choix"
                  : validation.enCours
                    ? "Validation\u2026"
                    : validation.dejaValide
                      ? "Mettre \u00e0 jour mes choix"
                      : "Valider mes choix"}
              </button>
            </>
          )}
        </div>
      )}

      {enregistrement !== null && (
        <div className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
          {enregistrement.dejaEnregistre ? (
            <>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-foreground">
                <Check size={14} aria-hidden="true" />
                Repas enregistré
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Les quantités ont été ajoutées à «&nbsp;Ce que j&apos;ai mangé&nbsp;». Modifie-les
                ci-dessous si tu as mangé autre chose.
              </p>
            </>
          ) : (
            <button
              type="button"
              disabled={enregistrement.enCours}
              onClick={() =>
                enregistrement.onEnregistrer(
                  solution.items.map((item) => ({
                    slotId: item.slotId,
                    optionId: item.optionId,
                    quantity: item.displayQuantity,
                    unit: item.unit,
                  })),
                )
              }
              className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {enregistrement.enCours ? "Enregistrement…" : "Enregistrer le repas"}
            </button>
          )}
        </div>
      )}

      {/* ⚠️ AUCUN ALIMENT PRÉCIS N'EST SUGGÉRÉ, ET CE N'EST PAS UN OUBLI.
          « Ajoute 10 g d'huile » réintroduirait un rôle nutritionnel par la
          bande : il faudrait décider que l'huile « sert » les lipides, donc
          qu'un aliment a une fonction. Tout ce module tient sur le refus de
          cette idée. On nomme la MACRO, et on renvoie au bouton « Modifier »
          que l'élève a déjà sous les yeux sur chacune de ses listes. */}
      {solution.status !== "exact" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Modifie un de tes choix pour t&apos;en rapprocher.
        </p>
      )}
    </section>
  );
}

/**
 * N1.6B — CE QUE L'ÉCRAN REMET AU PARENT POUR ENREGISTRER.
 *
 * ⚠️ AUCUNE MACRO N'EN FAIT PARTIE, et ce n'est pas un oubli : le serveur
 * recharge la source et calcule. Les envoyer d'ici créerait un second modèle
 * de calcul dont rien ne garantirait qu'il dise la même chose.
 *
 * ⚠️ `optionId` PLUTÔT QUE L'IDENTITÉ. C'est le parent qui résout l'option en
 * `catalog_food_id` / `product_id` : cet écran ne connaît que ce que le
 * solveur lui a rendu, et inventer une identité ici serait la deviner.
 */
export interface ItemPourEnregistrement {
  readonly slotId: string;
  readonly optionId: string;
  /** ⚠️ L'ENTIER AFFICHÉ, après arrondi borné. Jamais la valeur flottante. */
  readonly quantity: number;
  readonly unit: "g" | "ml";
}

/** Le libellé élève d'une macro. Aucun jargon, aucune abréviation. */
const LIBELLE_MACRO = {
  proteinGrams: "protéines",
  carbGrams: "glucides",
  fatGrams: "lipides",
} as const;

type MacroClef = keyof typeof LIBELLE_MACRO;

export interface EcartAffiche {
  readonly macro: MacroClef;
  readonly libelle: string;
  /** Arrondi au gramme. > 0 : à ajouter. < 0 : à réduire. */
  readonly grammes: number;
}

/**
 * N1.5.3 — QUELS ÉCARTS MÉRITENT UNE PHRASE.
 *
 * ⚠️ UN SEUL SEUIL, ET IL N'EST PAS ARBITRAIRE : LE GRAMME. C'est le pas
 * d'affichage des quantités ; en dessous, l'écart ARRONDI vaut zéro et il n'y a
 * littéralement rien à écrire. « Il manque 0,1 g de protéines » serait du bruit.
 *
 * ⚠️ LE STATUT NE DÉCIDE PAS DE L'AFFICHAGE DES ÉCARTS, et c'est délibéré. Un
 * repas `approximate` peut parfaitement dire « réduire environ 2 g de lipides » :
 * le statut nutritionnel reste jugé par `determineStatus` seul, l'écart reste
 * une information utile. Lier les deux ferait taire l'écran précisément dans le
 * cas où un petit ajustement suffirait.
 *
 * ⚠️ L'ORDRE EST CELUI DE LA GÉOMÉTRIE DU SOLVEUR, pas celui des grammes bruts.
 * On trie par écart RAPPORTÉ à la tolérance de la macro — la même grandeur que
 * `determineStatus` et que la métrique d'optimisation. Sans ça, une grande
 * cible passerait toujours devant : 9 g de glucides sur 158 pèsent moins que
 * 6 g de lipides sur 42, et c'est ce dernier qu'il faut lire en premier.
 */
export function ecartsAAfficher(solution: MealChoiceSolution): readonly EcartAffiche[] {
  const tolerance = (cible: number): number =>
    Math.max(APPROXIMATE_TOLERANCE_GRAMS, Math.abs(cible) * APPROXIMATE_TOLERANCE_RATIO);

  return (Object.keys(LIBELLE_MACRO) as MacroClef[])
    .map((macro) => ({
      macro,
      libelle: LIBELLE_MACRO[macro],
      grammes: Math.round(solution.ecartsVersLaCible[macro]),
      poids: Math.abs(solution.ecartsVersLaCible[macro]) / tolerance(solution.target[macro]),
    }))
    .filter((ecart) => ecart.grammes !== 0)
    .sort((a, b) => b.poids - a.poids)
    .map(({ macro, libelle, grammes }) => ({ macro, libelle, grammes }));
}

function ligneMacros(macros: {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
}): string {
  return `P${NBSP}${formatIntegerFr(macros.proteinGrams)}${NBSP}g · G${NBSP}${formatIntegerFr(macros.carbGrams)}${NBSP}g · L${NBSP}${formatIntegerFr(macros.fatGrams)}${NBSP}g`;
}

function LigneChoix({
  occurrence,
  choisie,
  ouverte,
  onBasculer,
  onChoisir,
  misEnAvant = null,
}: {
  readonly occurrence: MealChoiceSlot;
  readonly choisie: ReturnType<typeof optionChoisie>;
  readonly ouverte: boolean;
  readonly onBasculer: () => void;
  readonly onChoisir: (optionId: string) => void;
  readonly misEnAvant?: MiseEnAvantDOption | null;
}) {
  const groupeId = useId();

  return (
    /* ⚠️ N1.6A — L'ACCENT DE COULEUR EST UNE BARRE LATÉRALE, ET RIEN D'AUTRE.
       Le libellé de l'occurrence reste devant, écrit : la couleur ne dit
       jamais seule ce qu'est cette liste. Sans couleur, la classe est vide et
       le gabarit est celui d'avant N1.6A, au pixel près. */
    <li className={`min-w-0 rounded-control border border-border bg-card ${colorKeyBorderClass(occurrence.colorKey)}`}>
      {/* ⚠️ UN VRAI BOUTON, PAS UN DIV CLIQUABLE. `aria-expanded` dit l'état,
          et le libellé ne dépend jamais du seul chevron. */}
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        aria-controls={groupeId}
        className="pressable flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-foreground">{occurrence.label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {choisie ? (choisie.displayName ?? "Aliment indisponible") : "Aucun choix"}
          </span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {choisie ? "Modifier" : "Choisir"}
          </span>
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={`text-muted-foreground transition-transform ${ouverte ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {/* ⚠️ RENDU SEULEMENT QUAND C'EST OUVERT. Voir l'en-tête du fichier. */}
      {ouverte && (
        <div
          id={groupeId}
          role="radiogroup"
          aria-label={occurrence.label}
          className="flex min-w-0 flex-col gap-1 border-t border-border p-2"
        >
          {occurrence.options.map((option) => {
            const exploitable = optionExploitable(option);
            const selectionnee = choisie?.optionId !== undefined && choisie.optionId === option.optionId;
            return (
              <button
                key={option.optionId ?? `${option.type}-${option.id}`}
                type="button"
                role="radio"
                aria-checked={selectionnee}
                disabled={!exploitable}
                onClick={() => option.optionId && onChoisir(option.optionId)}
                className="pressable flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-control px-3 py-2 text-left transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    selectionnee ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {selectionnee && <Check size={10} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {/* ⚠️ LE NOM, ET RIEN QUE LE NOM. Pas de grammes, pas de
                      macros : elles n'existent pas encore à cette étape. */}
                  {option.displayName ?? "Aliment indisponible"}
                </span>
                {/* ⚠️ COURSES C1 — LA PRÉFÉRENCE MET EN AVANT, ELLE NE FILTRE
                    PAS. L'étoile se pose SUR une option déjà présente dans
                    `occurrence.options` : elle n'en ajoute aucune, n'en retire
                    aucune, ne réordonne pas la liste du coach, et n'empêche
                    aucun choix. Sans `misEnAvant`, rien n'est rendu et l'écran
                    est exactement celui de N1.4. */}
                {misEnAvant?.({ type: option.type, id: option.id }) === true && (
                  <span className="flex flex-shrink-0 items-center">
                    <Star size={13} aria-hidden="true" className="fill-info text-info" />
                    <span className="sr-only">Aliment préféré</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
