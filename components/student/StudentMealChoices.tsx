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
import type { MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";

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
}: {
  readonly occurrences: readonly MealChoiceSlot[];
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

      {calcul.etat === "calcule" && <QuantitesDuRepas solution={calcul.solution} />}
    </section>
  );
}

/**
 * N1.5 — « QUANTITÉS POUR TON REPAS ».
 *
 * ⚠️ ON N'AFFICHE JAMAIS UNE QUANTITÉ QUI MENT. Quand la combinaison ne peut
 * pas atteindre la cible, il n'y a PAS de liste de grammes : des quantités
 * accompagnées d'un avertissement seraient recopiées et suivies quand même.
 * On dit ce qui se passe, et on invite à changer un choix.
 *
 * ⚠️ L'ORDRE EST CELUI DES OCCURRENCES DU COACH. Ni par quantité, ni par
 * ordre alphabétique, ni par ordre de résolution : l'élève doit retrouver
 * ses lignes là où il vient de les choisir.
 *
 * ⚠️ LES NOMBRES AFFICHÉS SONT CEUX QUI ONT SERVI AU VERDICT. `actual` est
 * recalculé sur les quantités ARRONDIES, jamais sur les quantités exactes :
 * « RÉSULTAT » est donc littéralement ce que produisent les grammes écrits
 * juste au-dessus.
 */
export function QuantitesDuRepas({ solution }: { readonly solution: MealChoiceSolution }) {
  const titreId = useId();
  const impossible = solution.status === "impossible";

  return (
    <section
      aria-labelledby={titreId}
      className="mt-1 flex min-w-0 flex-col gap-2 rounded-control border border-border bg-card p-3"
    >
      <h5 id={titreId} className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Quantités pour ton repas
      </h5>

      {impossible ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cette combinaison ne permet pas d&apos;atteindre les objectifs de ce repas. Modifie un de
          tes choix pour t&apos;en rapprocher.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1">
          {solution.items.map((item) => (
            <li key={item.optionId} className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
              {/* ⚠️ L'UNITÉ EST CELLE DE L'ALIMENT. Un yaourt à boire est
                  compté en millilitres, un riz en grammes, et les deux ne
                  s'additionnent nulle part — seules leurs macros s'ajoutent. */}
              <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
                {formatIntegerFr(item.displayQuantity)}
                {NBSP}
                {item.unit}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="uppercase tracking-wide">Cible du repas</dt>
          <dd className="tabular-nums">{ligneMacros(solution.target)}</dd>
        </div>
        {!impossible && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="uppercase tracking-wide">Résultat</dt>
            <dd className="tabular-nums">{ligneMacros(solution.actual)}</dd>
          </div>
        )}
      </dl>

      {/* ⚠️ UNE PHRASE, PAS UNE ERREUR TECHNIQUE. « approché » n'est pas un
          échec : c'est le meilleur que ces aliments-là puissent faire. */}
      {solution.status === "approximate" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cette combinaison approche au mieux les objectifs de ce repas.
        </p>
      )}
    </section>
  );
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
    <li className="min-w-0 rounded-control border border-border bg-card">
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
