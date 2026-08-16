"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  AUCUNE_SELECTION,
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
export function StudentMealChoices({
  occurrences,
  cible = null,
  enregistrement = null,
}: {
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
  const [selection, setSelection] = useState<SelectionDeChoix>(AUCUNE_SELECTION);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const titreId = useId();

  const choisir = useCallback((slotId: string, optionId: string) => {
    setSelection((precedente) => choisirOption(precedente, slotId, optionId));
    // Le choix fait, la liste se referme : l'élève voit sa composition, pas
    // dix listes ouvertes les unes sous les autres.
    setOuverte(null);
  }, []);

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
        <QuantitesDuRepas solution={calcul.solution} enregistrement={enregistrement} />
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
}: {
  readonly solution: MealChoiceSolution;
  readonly enregistrement?: {
    readonly dejaEnregistre: boolean;
    readonly enCours: boolean;
    readonly onEnregistrer: (items: readonly ItemPourEnregistrement[]) => void;
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
}: {
  readonly occurrence: MealChoiceSlot;
  readonly choisie: ReturnType<typeof optionChoisie>;
  readonly ouverte: boolean;
  readonly onBasculer: () => void;
  readonly onChoisir: (optionId: string) => void;
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
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
