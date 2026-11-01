import { kcalFromMacros } from "@/lib/nutrition/consumed";
import type { MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { RecipeTargetResult } from "@/lib/nutrition/recipe-matching";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import type { RecipeMacroTarget } from "@/lib/nutrition/recipe-types";
import type { CatalogFood, ProduitLocal } from "@/lib/supabase/consumed-meals";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LE MODE DÉMONSTRATION DE LA VISITE GUIDÉE
 * ════════════════════════════════════════════════════════════════════════════
 * Une visite qui doit montrer « comment on enregistre un aliment » se heurte à
 * un mur : l'étape de quantité et le bouton de confirmation N'EXISTENT PAS tant
 * qu'un aliment n'a pas été choisi, et choisir un aliment réel pour l'occasion
 * ferait manipuler le journal d'un élève pour illustrer une phrase.
 *
 * Ce module résout le problème sans rien inventer à l'écran : il met la VRAIE
 * feuille d'ajout — `AddFoodSheet`, le composant que l'application utilise —
 * dans un état de démonstration, avec des aliments de fixture et des fonctions
 * d'écriture débranchées.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA GARANTIE, ET OÙ ELLE EST POSÉE
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE ÉCRITURE N'EST POSSIBLE DEPUIS CE MODE, et ce n'est pas une
 * promesse de bonne conduite : la feuille de démonstration est montée par
 * `GuideDemonstration` avec des callbacks qui ne reçoivent AUCUNE fonction de
 * `lib/supabase`. Il n'y a rien à appeler. Le pire qu'un clic puisse faire est
 * d'afficher un message de simulation.
 *
 * C'est aussi pour cela que la démonstration monte SA PROPRE feuille plutôt que
 * d'ouvrir celle d'un repas : ouvrir un vrai repas appelle `onOuvrirConteneur`,
 * qui CRÉE une ligne en base quand le repas n'existe pas encore. Le guide
 * n'ouvre donc jamais le journal réel — il en montre une copie inerte.
 *
 * ⚠️ RIEN N'EST PERSISTÉ. Pas de `localStorage`, pas de cookie, pas de requête.
 * L'état vit dans ce module, en mémoire, et `reinitialiserDemonstration()` le
 * remet à zéro à la sortie du guide — y compris en cas de sortie par `Échap`,
 * par le voile, ou par démontage.
 */

/** Ce que la démonstration affiche, étape par étape. */
export interface EtatDemonstration {
  /** La feuille d'ajout d'aliment, montée par la démonstration. */
  readonly feuilleAjout: boolean;
  /** Onglet affiché dans cette feuille. */
  readonly onglet: "recherche" | "manuel";
  /** Un terme de recherche pré-saisi, et ses résultats de fixture. */
  readonly recherche: boolean;
  /** Un aliment déjà choisi : l'étape quantité est alors rendue. */
  readonly choix: boolean;
  /** L'écran du scanner, SANS caméra ni demande d'autorisation. */
  readonly scanner: boolean;
  /**
   * Une recette d'exemple, UNIQUEMENT si le coach n'en a publié aucune.
   *
   * ⚠️ ELLE NE REMPLACE JAMAIS UNE VRAIE RECETTE. La substitution ne se fait
   * que lorsque la bibliothèque reçue est vide : sinon la visite montrerait un
   * exemple à un élève qui a de vraies recettes sous les yeux, ce qui serait
   * pire que de ne rien montrer.
   */
  readonly recettes: boolean;
}

export const DEMONSTRATION_ETEINTE: EtatDemonstration = {
  feuilleAjout: false,
  onglet: "recherche",
  recherche: false,
  choix: false,
  scanner: false,
  recettes: false,
};

/* ══════════════════════════════════════════════════════════════════════════
   LES FIXTURES
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ DES VALEURS PLAUSIBLES, PAS DES VALEURS INVENTÉES AU HASARD. Les macros
   ci-dessous sont celles, arrondies, d'aliments courants de la table Ciqual.
   Un écran de démonstration qui afficherait « banane : 40 g de protéines »
   apprendrait quelque chose de faux à qui le lit.

   ⚠️ LES IDENTIFIANTS SONT MARQUÉS. Préfixe `demo-`, jamais un UUID : si l'un
   d'eux arrivait par accident dans une requête, il ne désignerait rien et se
   verrait dans n'importe quel journal. Un test vérifie ce préfixe.
   ══════════════════════════════════════════════════════════════════════════ */

export const PREFIXE_DEMONSTRATION = "demo-";

export const TERME_DEMONSTRATION = "banane";

export const ALIMENTS_DEMONSTRATION: readonly CatalogFood[] = [
  {
    id: `${PREFIXE_DEMONSTRATION}banane`,
    name: "Banane, pulpe, crue",
    nutritionUnit: "g",
    proteinPer100: 1.1,
    carbPer100: 19.6,
    fatPer100: 0.3,
    pieceWeightG: 120,
  },
  {
    id: `${PREFIXE_DEMONSTRATION}banane-sechee`,
    name: "Banane séchée",
    nutritionUnit: "g",
    proteinPer100: 3.9,
    carbPer100: 61.4,
    fatPer100: 1.4,
    pieceWeightG: null,
  },
] as const;

export const PRODUITS_DEMONSTRATION: readonly ProduitLocal[] = [
  {
    id: `${PREFIXE_DEMONSTRATION}produit-cereales`,
    gtin: "0000000000000",
    name: "Pétales de céréales complètes",
    brand: "Marque d'exemple",
    nutritionUnit: "g",
    proteinPer100: 8.4,
    carbPer100: 72.1,
    fatPer100: 2.6,
    imageUrl: null,
    hydratee: true,
  },
] as const;

/** La quantité pré-saisie à l'étape quantité, et son unité. */
export const QUANTITE_DEMONSTRATION = "120";

/**
 * UNE RECETTE D'EXEMPLE, pour la page des recettes quand la bibliothèque du
 * coach est vide.
 *
 * ⚠️ `slotKey: null` — « convient à tous les créneaux ». C'est le comportement
 * de `recipesForSlot`, pas une astuce : une recette sans créneau déclaré est
 * proposée partout. La visite peut donc ouvrir n'importe quel créneau et y
 * trouver quelque chose à montrer.
 *
 * ⚠️ LES MACROS SONT COHÉRENTES ENTRE ELLES. Le solveur ajuste réellement ces
 * quantités pour atteindre la cible du créneau : des valeurs fantaisistes
 * donneraient des quantités absurdes à l'écran, et la démonstration
 * enseignerait le contraire de ce qu'elle veut montrer. Ce sont les ordres de
 * grandeur de la table Ciqual pour du poulet, du riz et de l'huile d'olive.
 *
 * ⚠️ `sourceKey` porte le préfixe de démonstration, comme les aliments.
 */
export const RECETTES_DEMONSTRATION: readonly RecipeWithTags[] = [
  {
    recipe: {
      id: `${PREFIXE_DEMONSTRATION}recette-poulet-riz`,
      name: "Exemple — poulet, riz et légumes",
      slot: null,
      ingredients: [
        {
          id: `${PREFIXE_DEMONSTRATION}ing-poulet`,
          name: "Blanc de poulet, cru",
          role: "protein",
          proteinPer100g: 23,
          carbPer100g: 0,
          fatPer100g: 1.5,
          referenceGrams: 150,
          minGrams: 80,
          maxGrams: 250,
        },
        {
          id: `${PREFIXE_DEMONSTRATION}ing-riz`,
          name: "Riz blanc, cru",
          role: "carbohydrate",
          proteinPer100g: 7,
          carbPer100g: 78,
          fatPer100g: 0.6,
          referenceGrams: 80,
          minGrams: 40,
          maxGrams: 160,
        },
        {
          id: `${PREFIXE_DEMONSTRATION}ing-huile`,
          name: "Huile d'olive",
          role: "fat",
          proteinPer100g: 0,
          carbPer100g: 0,
          fatPer100g: 100,
          referenceGrams: 10,
          minGrams: 5,
          maxGrams: 25,
        },
        {
          id: `${PREFIXE_DEMONSTRATION}ing-legumes`,
          name: "Courgette, cuite",
          role: "free",
          proteinPer100g: 1.2,
          carbPer100g: 2.3,
          fatPer100g: 0.3,
          referenceGrams: 150,
        },
      ],
    },
    slotKey: null,
    status: "active",
    tags: [],
    description: "Recette d'exemple affichée pendant la visite guidée.",
    sourceKey: `${PREFIXE_DEMONSTRATION}visite-guidee`,
    imagePath: null,
    updatedAt: null,
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   LE MAGASIN
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ UN MAGASIN EXTÉRIEUR À REACT, PAS UN CONTEXTE. Le moteur du guide n'est
   pas un ancêtre de la feuille d'ajout : il ne peut rien lui transmettre par
   les props ni par un contexte. Un magasin lu avec `useSyncExternalStore` est
   l'outil prévu pour exactement cela, et il garde la lecture correcte au rendu
   serveur (instantané « éteint ») comme à l'hydratation.
   ══════════════════════════════════════════════════════════════════════════ */

let etat: EtatDemonstration = DEMONSTRATION_ETEINTE;
const abonnes = new Set<() => void>();

function diffuser(): void {
  for (const abonne of abonnes) abonne();
}

export function abonnerDemonstration(auChangement: () => void): () => void {
  abonnes.add(auChangement);
  return () => void abonnes.delete(auChangement);
}

export function lireDemonstration(): EtatDemonstration {
  return etat;
}

/** Instantané du rendu serveur : la démonstration n'existe jamais côté serveur. */
export function demonstrationServeur(): EtatDemonstration {
  return DEMONSTRATION_ETEINTE;
}

/**
 * Applique un état de démonstration.
 *
 * ⚠️ APPELÉ UNIQUEMENT PAR LE MOTEUR DU GUIDE. Aucune page, aucun formulaire,
 * aucun composant métier ne doit allumer la démonstration : elle met à l'écran
 * des valeurs qui ne sont pas celles de l'utilisateur, et seule une visite
 * guidée, qui s'annonce comme telle, a le droit de faire cela.
 */
export function appliquerDemonstration(suivant: Partial<EtatDemonstration>): void {
  const fusion = { ...etat, ...suivant };
  if (
    fusion.feuilleAjout === etat.feuilleAjout &&
    fusion.onglet === etat.onglet &&
    fusion.recherche === etat.recherche &&
    fusion.choix === etat.choix &&
    fusion.scanner === etat.scanner &&
    fusion.recettes === etat.recettes
  ) {
    return;
  }
  etat = fusion;
  diffuser();
}

/** Remet tout à zéro. Appelé à chaque sortie du guide, quelle qu'en soit la cause. */
export function reinitialiserDemonstration(): void {
  if (etat === DEMONSTRATION_ETEINTE) return;
  etat = DEMONSTRATION_ETEINTE;
  diffuser();
}

/* ══════════════════════════════════════════════════════════════════════════
   LES SCÉNARIOS, NOMMÉS
   ══════════════════════════════════════════════════════════════════════════
   Une étape de visite ne décrit pas un état complet : elle nomme un scénario.
   Les étapes restent lisibles, et l'ensemble des états possibles reste ici,
   énumérable et testable.
   ══════════════════════════════════════════════════════════════════════════ */

export const SCENARIOS_DEMONSTRATION = {
  /** La feuille ouverte, champ vide : favoris, récents, scanner, saisie manuelle. */
  "feuille-vide": { feuilleAjout: true, onglet: "recherche", recherche: false, choix: false, scanner: false, recettes: false },
  /** Un terme tapé et ses résultats affichés. */
  "recherche-resultats": { feuilleAjout: true, onglet: "recherche", recherche: true, choix: false, scanner: false, recettes: false },
  /** Un aliment choisi : l'étape quantité est à l'écran. */
  "quantite": { feuilleAjout: true, onglet: "recherche", recherche: true, choix: true, scanner: false, recettes: false },
  /** L'onglet de saisie manuelle. */
  "saisie-manuelle": { feuilleAjout: true, onglet: "manuel", recherche: false, choix: false, scanner: false, recettes: false },
  /** L'écran du scanner, caméra ÉTEINTE et jamais demandée. */
  "scanner": { feuilleAjout: true, onglet: "recherche", recherche: false, choix: false, scanner: true, recettes: false },
  /** La page des recettes, avec un exemple si le coach n'en a publié aucune. */
  "recettes": { feuilleAjout: false, onglet: "recherche", recherche: false, choix: false, scanner: false, recettes: true },
  /** Plus rien : la page réelle, telle qu'elle était. */
  "aucun": DEMONSTRATION_ETEINTE,
} as const satisfies Record<string, EtatDemonstration>;

export type CleDemonstration = keyof typeof SCENARIOS_DEMONSTRATION;

export function appliquerScenario(cle: CleDemonstration): void {
  appliquerDemonstration(SCENARIOS_DEMONSTRATION[cle]);
}

/* ══════════════════════════════════════════════════════════════════════════
   UN OBJECTIF DE CRÉNEAU FICTIF — POUR QUE LE CALCUL PUISSE AVOIR LIEU
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ POURQUOI IL EXISTE. La page des recettes ne calcule rien sans cible :
   `buildRecipeTargetForMealSlot` REFUSE explicitement un profil sans calories
   plutôt que de rendre une cible à zéro — et ce refus est juste, parce qu'une
   cible à zéro est une cible valide que le solveur traiterait. Conséquence :
   sur un plan dont le coach n'a pas encore fixé les objectifs, la liste des
   recettes n'est pas rendue du tout, et la visite guidée n'avait rien à
   montrer, même avec sa recette d'exemple.

   ⚠️ IL N'ACCOMPAGNE JAMAIS UNE VRAIE RECETTE. La substitution de la cible est
   liée à celle de la recette : elle n'a lieu que lorsque la bibliothèque du
   coach est vide et que la visite est lancée. Doser une recette RÉELLE avec un
   objectif inventé afficherait des quantités que personne n'a prescrites —
   c'est précisément ce qu'il ne faut pas faire.

   ⚠️ IL NE SE FAIT PAS PASSER POUR UN OBJECTIF DU COACH. L'écran le marque, et
   un test vérifie cette mention.

   ⚠️ LES CALORIES SONT DÉRIVÉES, PAS SAISIES. Elles passent par
   `kcalFromMacros`, le 4/4/9 de l'application : un trio de macros et un total
   écrits à la main auraient fini par se contredire.
   ══════════════════════════════════════════════════════════════════════════ */

/** Grammes d'un créneau d'exemple — l'ordre de grandeur d'un déjeuner. */
export const MACROS_CIBLE_DEMONSTRATION: RecipeMacroTarget = {
  proteinGrams: 45,
  carbGrams: 75,
  fatGrams: 20,
};

export function cibleDemonstration(slot: MealSlotKey): RecipeTargetResult {
  return {
    ok: true,
    slot,
    target: MACROS_CIBLE_DEMONSTRATION,
    calories: kcalFromMacros(
      MACROS_CIBLE_DEMONSTRATION.proteinGrams,
      MACROS_CIBLE_DEMONSTRATION.carbGrams,
      MACROS_CIBLE_DEMONSTRATION.fatGrams,
    ),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LES DEUX DÉCISIONS DE SUBSTITUTION, ISOLÉES ET PURES
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ POURQUOI ELLES VIVENT ICI PLUTÔT QUE DANS LE COMPOSANT. Ce sont ELLES qui
   portent la garantie — « jamais par-dessus de vraies données » — et une règle
   enfouie dans un rendu React ne se vérifie qu'en rendant la page, ce qui
   demande un navigateur. Sorties du composant, les quatre situations du cahier
   des charges s'éprouvent directement, sans DOM.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * La bibliothèque à afficher.
 *
 * ⚠️ DEUX CONDITIONS, PAS UNE. La visite doit être lancée ET le coach ne doit
 * avoir publié aucune recette. Afficher un exemple à un élève qui a de vraies
 * recettes lui ferait croire que son coach lui a prescrit ce plat.
 */
export function recettesAAfficher(
  demonstrationActive: boolean,
  recettesReelles: readonly RecipeWithTags[],
): { readonly recettes: readonly RecipeWithTags[]; readonly exemple: boolean } {
  const exemple = demonstrationActive && recettesReelles.length === 0;
  return { recettes: exemple ? RECETTES_DEMONSTRATION : recettesReelles, exemple };
}

/**
 * La cible du créneau à utiliser.
 *
 * ⚠️ `exemple` EN PREMIER ARGUMENT, ET CE N'EST PAS UN DÉTAIL. La cible fictive
 * est conditionnée à la substitution de la RECETTE : il devient impossible de
 * doser une recette réelle avec un objectif que personne n'a fixé. Les
 * quantités inventées ne peuvent accompagner qu'une recette inventée.
 */
export function cibleAAfficher(
  exemple: boolean,
  slot: MealSlotKey | null,
  cibleReelle: RecipeTargetResult | null,
): { readonly cible: RecipeTargetResult | null; readonly fictive: boolean } {
  const fictive = exemple && slot !== null && cibleReelle?.ok !== true;
  return { cible: fictive && slot ? cibleDemonstration(slot) : cibleReelle, fictive };
}
