/**
 * LE CHRONOMÈTRE DE SÉANCE — la machine à états, sans React et sans écran.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LA LOGIQUE N'EST PAS DANS LE COMPOSANT
 * ════════════════════════════════════════════════════════════════════════
 * Un compte à rebours a exactement quatre façons de se tromper, et aucune ne
 * se voit sur une capture d'écran :
 *   1. il continue de décrémenter après une pause ;
 *   2. il passe sous zéro au lieu de s'arrêter ;
 *   3. il dérive, parce qu'on soustrait 1 s à chaque tick d'un `setInterval`
 *      qui, lui, ne dure jamais exactement 1 s ;
 *   4. il repart de zéro quand on referme le panneau.
 * Mises dans un composant, ces quatre fautes ne sont testables qu'en
 * simulant des horloges dans un DOM. Mises ici, elles sont testables en
 * appelant des fonctions avec un « maintenant » choisi à la milliseconde.
 *
 * ════════════════════════════════════════════════════════════════════════
 * COMMENT LA DÉRIVE EST ÉVITÉE
 * ════════════════════════════════════════════════════════════════════════
 * En marche, l'état ne mémorise PAS « combien il reste » : il mémorise
 * `echeanceMs`, la DATE de fin. Le temps restant est RECALCULÉ à chaque
 * lecture par soustraction. Un `setInterval` en retard, un onglet mis en
 * veille par le navigateur, un téléphone verrouillé pendant dix minutes :
 * aucun n'a d'effet, parce qu'aucun tick n'est comptabilisé. Le tick ne sert
 * qu'à REDESSINER, jamais à compter.
 *
 * À l'arrêt, en pause et à la fin, c'est l'inverse : `restantMs` fait foi et
 * `echeanceMs` vaut `null`. L'invariant « une seule des deux valeurs fait
 * foi, selon l'état » est ce qui empêche une pause de continuer à courir.
 */

/** Durée maximale réglable : 24 h. Au-delà, ce n'est plus un repos de série. */
export const DUREE_MAX_MS = 24 * 60 * 60 * 1000;

/** Durée proposée à la première ouverture : 1 minute (repos de série usuel). */
export const DUREE_PAR_DEFAUT_MS = 60 * 1000;

/** Pas des deux boutons d'ajustement rapide. */
export const PAS_AJUSTEMENT_MS = 30 * 1000;

export type EtatChronometre = "arrete" | "encours" | "pause" | "termine";

export interface Chronometre {
  readonly etat: EtatChronometre;
  /** Durée vers laquelle « réinitialiser » ramène. */
  readonly dureeInitialeMs: number;
  /** Temps restant — fait foi SAUF en `encours`. */
  readonly restantMs: number;
  /** Date de fin — fait foi UNIQUEMENT en `encours`, `null` partout ailleurs. */
  readonly echeanceMs: number | null;
}

function borner(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(Math.round(ms), DUREE_MAX_MS);
}

export function creerChronometre(dureeInitialeMs: number = DUREE_PAR_DEFAUT_MS): Chronometre {
  const duree = borner(dureeInitialeMs);
  return { etat: "arrete", dureeInitialeMs: duree, restantMs: duree, echeanceMs: null };
}

/**
 * Temps restant en MILLISECONDES, recalculé depuis l'échéance quand la
 * machine tourne. Jamais négatif.
 */
export function restantMs(chrono: Chronometre, maintenantMs: number): number {
  if (chrono.etat !== "encours" || chrono.echeanceMs === null) return chrono.restantMs;
  return Math.max(0, chrono.echeanceMs - maintenantMs);
}

/**
 * Temps restant en SECONDES pour l'affichage. Arrondi vers le HAUT : tant
 * qu'il reste un millième de seconde, le cadran affiche encore « 1 » — donc
 * « 00:00 » ne s'affiche qu'une fois le temps réellement écoulé, et la
 * dernière seconde est visible pendant une seconde entière.
 */
export function restantSecondes(chrono: Chronometre, maintenantMs: number): number {
  return Math.ceil(restantMs(chrono, maintenantMs) / 1000);
}

/** Démarre (ou redémarre après la fin). Sans temps à écouler, rien ne part. */
export function demarrer(chrono: Chronometre, maintenantMs: number): Chronometre {
  if (chrono.etat === "encours") return chrono;
  const base = chrono.etat === "termine" ? chrono.dureeInitialeMs : chrono.restantMs;
  if (base <= 0) return chrono;
  return { ...chrono, etat: "encours", restantMs: base, echeanceMs: maintenantMs + base };
}

/**
 * Met en pause. Le restant est FIGÉ dans l'état et l'échéance est effacée :
 * plus aucun calcul ne dépend de l'horloge tant qu'on n'a pas repris.
 */
export function pauser(chrono: Chronometre, maintenantMs: number): Chronometre {
  if (chrono.etat !== "encours") return chrono;
  return { ...chrono, etat: "pause", restantMs: restantMs(chrono, maintenantMs), echeanceMs: null };
}

/** Reprend après une pause : une NOUVELLE échéance est calculée depuis maintenant. */
export function reprendre(chrono: Chronometre, maintenantMs: number): Chronometre {
  if (chrono.etat !== "pause") return chrono;
  if (chrono.restantMs <= 0) return { ...chrono, etat: "termine", echeanceMs: null };
  return { ...chrono, etat: "encours", echeanceMs: maintenantMs + chrono.restantMs };
}

/** Ramène à la durée initiale et à l'arrêt, depuis N'IMPORTE QUEL état. */
export function reinitialiser(chrono: Chronometre): Chronometre {
  return {
    etat: "arrete",
    dureeInitialeMs: chrono.dureeInitialeMs,
    restantMs: chrono.dureeInitialeMs,
    echeanceMs: null,
  };
}

/**
 * Ajoute ou retire du temps (boutons −30 s / +30 s), y compris EN MARCHE :
 * l'échéance est déplacée, aucun redémarrage. Retirer plus de temps qu'il
 * n'en reste amène à 00:00 et termine le compte à rebours — ce n'est pas une
 * erreur, c'est « j'arrête là ».
 */
export function ajuster(chrono: Chronometre, deltaMs: number, maintenantMs: number): Chronometre {
  const cible = borner(restantMs(chrono, maintenantMs) + deltaMs);

  if (chrono.etat === "encours") {
    if (cible <= 0) return { ...chrono, etat: "termine", restantMs: 0, echeanceMs: null };
    return { ...chrono, restantMs: cible, echeanceMs: maintenantMs + cible };
  }

  // À l'arrêt, en pause ou terminé, ajuster redéfinit AUSSI la durée de
  // référence : le prochain « réinitialiser » retombe sur la valeur réglée,
  // et non sur celle d'avant l'ajustement.
  return {
    etat: cible <= 0 ? "termine" : chrono.etat === "termine" ? "arrete" : chrono.etat,
    dureeInitialeMs: cible,
    restantMs: cible,
    echeanceMs: null,
  };
}

/**
 * Règle explicitement la durée (champs minutes + secondes). Arrête le compte
 * à rebours : régler pendant une marche en cours produirait un état où le
 * chiffre lu et le chiffre réglé divergent.
 */
export function reglerDuree(chrono: Chronometre, dureeMs: number): Chronometre {
  const duree = borner(dureeMs);
  return { etat: "arrete", dureeInitialeMs: duree, restantMs: duree, echeanceMs: null };
}

/**
 * Ce que l'affichage appelle à chaque battement. SEULE fonction qui fait
 * passer en « termine » toute seule — et elle n'y passe QUE si l'échéance
 * est atteinte. Elle ne décrémente rien : elle constate.
 */
export function tic(chrono: Chronometre, maintenantMs: number): Chronometre {
  if (chrono.etat !== "encours") return chrono;
  const reste = restantMs(chrono, maintenantMs);
  if (reste > 0) return chrono;
  return { ...chrono, etat: "termine", restantMs: 0, echeanceMs: null };
}

/**
 * Cadran « MM:SS » (« H:MM:SS » au-delà de l'heure).
 *
 * ⚠️ N'UTILISE VOLONTAIREMENT PAS `formaterDuree` de lib/duree.ts. Un cadran
 * a besoin d'une LARGEUR STABLE : « 1 min 30 s » puis « 1 min 9 s » puis
 * « 59 s » ferait sauter les chiffres à chaque seconde, sous les yeux de
 * quelqu'un qui les regarde. Le libellé accessible, lui, passe bien par
 * `formaterDuree` (voir ChronometreSeance) : un lecteur d'écran n'a que faire
 * d'une largeur fixe et doit entendre des unités.
 */
export function cadran(secondes: number): string {
  const total = Math.max(0, Math.floor(secondes));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
