import type { MotifEchec } from "@/lib/scan/camera";

/**
 * CE QUE L'ÉLÈVE LIT, ET CE QU'IL PEUT FAIRE ENSUITE (ALIMENTS A4, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CES TABLES NE VIVENT PAS DANS LE COMPOSANT
 * ────────────────────────────────────────────────────────────────────────────
 * Pour la même raison que `selection-aliment.ts` en A3 phase 5 : le dépôt n'a ni
 * jsdom ni bibliothèque de test DOM, et ses harnais de rendu s'arrêtent à
 * `renderToString`, qui n'exécute aucun effet et ne clique sur rien. Une règle
 * écrite dans un `switch` au milieu d'un JSX ne serait éprouvée que par de la
 * lecture de code — c'est-à-dire pas éprouvée.
 *
 * Sorties ici, deux garanties se prouvent pour de vrai :
 *
 *   1. AUCUN CUL-DE-SAC. Chaque échec, sans exception, propose au moins une
 *      porte de sortie. C'est vérifiable par une boucle sur TOUS les motifs, pas
 *      par la relecture d'un composant de 300 lignes.
 *   2. AUCUNE FUITE TECHNIQUE. « 429 », « 503 », « OFF », « timeout »,
 *      « NotAllowedError » n'apprennent rien à quelqu'un debout dans un rayon de
 *      supermarché. Une assertion peut balayer tous les messages d'un coup.
 *
 * Ce module est une FEUILLE : ni React, ni réseau, ni décodeur.
 */

/**
 * Les portes de sortie. Quatre, et pas une de plus — chacune correspond à un
 * geste que l'élève peut réellement faire depuis l'écran où il est.
 */
export type ActionRepli = "reessayer" | "rescanner" | "recherche" | "manuel";

export const LIBELLE_ACTION: Readonly<Record<ActionRepli, string>> = {
  reessayer: "Réessayer",
  rescanner: "Scanner un autre produit",
  recherche: "Rechercher par nom",
  manuel: "Saisir à la main",
};

/* ══════════════════════════════════════════════════════════════════════════
   APRÈS LE SCAN — CE QUE LA FICHE PRODUIT A RÉPONDU
   ══════════════════════════════════════════════════════════════════════════ */

/** Les trois échecs possibles d'un lookup, du point de vue de l'écran. */
export type EchecLookup = "introuvable" | "incomplet" | "indisponible";

/**
 * ⚠️ TROIS MESSAGES, ET NON UN SEUL « IMPOSSIBLE ».
 *
 * Les confondre enverrait quelqu'un réessayer indéfiniment un produit qui
 * n'existe pas dans la base — le geste utile n'est pas le même selon le motif,
 * et c'est précisément ce que le message doit lui dire.
 *
 * « Ce produit existe mais ses valeurs manquent » est notamment très différent
 * de « ce produit n'existe pas » : dans le premier cas, l'emballage sous la main
 * contient exactement ce qui manque.
 */
export const MESSAGE_LOOKUP: Readonly<Record<EchecLookup, string>> = {
  introuvable: "Produit introuvable.",
  incomplet: "Données nutritionnelles insuffisantes pour ce produit.",
  indisponible: "Impossible de récupérer ce produit pour le moment.",
};

/**
 * Les actions offertes après un échec de lookup.
 *
 * L'ORDRE EST UNE DÉCISION, pas un hasard : la première action proposée est
 * celle qui a le plus de chances d'aboutir. Pour un produit dont les valeurs
 * manquent, c'est la saisie manuelle — l'emballage est dans la main de l'élève,
 * et rescanner le même code redonnerait exactement la même réponse.
 */
export function actionsPourLookup(échec: EchecLookup): readonly ActionRepli[] {
  if (échec === "incomplet") return ["manuel", "rescanner", "recherche"];
  if (échec === "indisponible") return ["rescanner", "recherche", "manuel"];
  return ["rescanner", "recherche", "manuel"];
}

/* ══════════════════════════════════════════════════════════════════════════
   AVANT LE SCAN — CE QUE LA CAMÉRA A RÉPONDU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les messages de caméra. Ils nomment la CAUSE en français courant, jamais le
 * nom d'exception du navigateur : `NotAllowedError` et `NotReadableError` sont
 * des mots pour nous, pas pour un élève.
 */
export const MESSAGE_CAMERA: Readonly<Record<MotifEchec, string>> = {
  permission_refusee: "Accès à la caméra refusé.",
  aucune_camera: "Aucune caméra disponible.",
  camera_occupee: "La caméra n'est pas disponible pour le moment.",
  contrainte_impossible: "La caméra n'a pas pu démarrer avec les réglages demandés.",
  contexte_non_securise: "Le scanner a besoin d'une connexion sécurisée.",
  inconnu: "La caméra n'a pas pu démarrer.",
};

/**
 * Les actions offertes quand la caméra n'a pas voulu s'ouvrir.
 *
 * ⚠️ « Réessayer » N'EST PAS UNE RELANCE AUTOMATIQUE. C'est un bouton, et il
 * n'apparaît que là où réessayer a un sens : une permission refusée peut être
 * accordée au second essai, une caméra prise par une autre application peut se
 * libérer. Redemander la permission tout seul, en boucle, transformerait un
 * refus en harcèlement — et certains navigateurs finissent par bloquer
 * définitivement le site qui insiste.
 *
 * Sans caméra du tout, « réessayer » serait un mensonge : l'appareil n'en aura
 * pas plus au second essai.
 */
export function actionsPourCamera(motif: MotifEchec): readonly ActionRepli[] {
  if (motif === "aucune_camera" || motif === "contexte_non_securise") {
    return ["recherche", "manuel"];
  }
  return ["reessayer", "recherche", "manuel"];
}
