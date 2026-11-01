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
}

export const DEMONSTRATION_ETEINTE: EtatDemonstration = {
  feuilleAjout: false,
  onglet: "recherche",
  recherche: false,
  choix: false,
  scanner: false,
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
    fusion.scanner === etat.scanner
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
  "feuille-vide": { feuilleAjout: true, onglet: "recherche", recherche: false, choix: false, scanner: false },
  /** Un terme tapé et ses résultats affichés. */
  "recherche-resultats": { feuilleAjout: true, onglet: "recherche", recherche: true, choix: false, scanner: false },
  /** Un aliment choisi : l'étape quantité est à l'écran. */
  "quantite": { feuilleAjout: true, onglet: "recherche", recherche: true, choix: true, scanner: false },
  /** L'onglet de saisie manuelle. */
  "saisie-manuelle": { feuilleAjout: true, onglet: "manuel", recherche: false, choix: false, scanner: false },
  /** L'écran du scanner, caméra ÉTEINTE et jamais demandée. */
  "scanner": { feuilleAjout: true, onglet: "recherche", recherche: false, choix: false, scanner: true },
  /** Plus rien : la page réelle, telle qu'elle était. */
  "aucun": DEMONSTRATION_ETEINTE,
} as const satisfies Record<string, EtatDemonstration>;

export type CleDemonstration = keyof typeof SCENARIOS_DEMONSTRATION;

export function appliquerScenario(cle: CleDemonstration): void {
  appliquerDemonstration(SCENARIOS_DEMONSTRATION[cle]);
}
