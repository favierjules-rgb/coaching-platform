/**
 * HORS LIGNE — LE SCHÉMA LOCAL, ET RIEN QUE LUI.
 *
 * Ce module ne stocke rien : il décrit ce qui a le droit d'être stocké, sous
 * quelle clé, et dans quelle version. Tout le reste (`depot.ts`, `idb.ts`)
 * s'y réfère.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS RÈGLES, ET AUCUNE N'EST NÉGOCIABLE
 * ════════════════════════════════════════════════════════════════════════
 *
 * 1. TOUT EST SCINDÉ PAR `userId`. Pas « filtré à l'affichage » : la clé
 *    elle-même commence par l'identifiant du compte. Un même iPhone peut
 *    servir à deux élèves ; il ne doit exister aucun chemin de code capable
 *    de lire l'enregistrement d'un autre, pas même par erreur. C'est
 *    pourquoi il n'y a nulle part de « tout lire » sans identifiant.
 *
 * 2. AUCUN JETON, AUCUNE SESSION. Ce qui est écrit ici est une saisie
 *    d'entraînement : des kilos, des répétitions, un commentaire. Jamais un
 *    jeton d'authentification, jamais un `access_token`, jamais un cookie.
 *    L'authentification reste où elle est, gérée par `@supabase/ssr`.
 *
 * 3. CHAQUE ENREGISTREMENT PORTE SA VERSION. Un enregistrement d'une version
 *    inconnue n'est jamais rendu « au mieux » : il est IGNORÉ. Servir à
 *    moitié une structure qu'on ne comprend plus, c'est afficher des
 *    chiffres faux à quelqu'un qui n'a aucun moyen de le savoir.
 */

import type { WorkoutFeedbackPayload } from "@/types";

/**
 * Version du schéma local.
 *
 * À incrémenter dès qu'une des formes ci-dessous change de sens. Les
 * enregistrements d'une autre version sont ignorés à la lecture (voir
 * `estCompatible`) — jamais migrés en silence, jamais rendus tels quels.
 */
export const SCHEMA_VERSION = 1;

/** Nom de la base. Une seule, pour toute l'application. */
export const NOM_BASE = "seth-offline";

export const MAGASINS = {
  snapshot: "training_snapshot",
  brouillon: "training_draft",
  outbox: "training_outbox",
  /** Métadonnées d'AFFICHAGE, jamais d'autorisation (voir plus bas). */
  affichage: "display_prefs",
} as const;

export type NomMagasin = (typeof MAGASINS)[keyof typeof MAGASINS];

/* ════════════════════════════════════════════════════════════════════════
 * LES CLÉS
 * ════════════════════════════════════════════════════════════════════════
 * Composées, et toujours préfixées par l'identifiant du compte. Elles sont
 * construites ici et nulle part ailleurs : c'est ce qui rend vérifiable
 * l'affirmation « aucun croisement entre deux comptes possible ».
 */

/**
 * Sépare les morceaux d'une clé. Absent des UUID comme des dates ISO, donc
 * aucun risque de collision entre deux clés différentes.
 *
 * Le préfixe de compte est construit par `prefixeCompte` et NULLE PART
 * ailleurs : c'est ce qui garantit que la sélection « les enregistrements de
 * ce compte » utilise exactement le même séparateur que l'écriture. Les
 * dupliquer, ne serait-ce qu'une fois, suffit à ce que la sélection ne
 * trouve plus rien — sans erreur, sans exception, juste un dépôt qui paraît
 * vide.
 */
const SEPARATEUR = ":";

/** Préfixe commun à toutes les clés d'un compte. */
export function prefixeCompte(userId: string): string {
  return `${userId}${SEPARATEUR}`;
}

export function cleSnapshot(userId: string, dateMetier: string): string {
  return `${userId}${SEPARATEUR}${dateMetier}`;
}

export function cleBrouillon(userId: string, sessionId: string): string {
  return `${userId}${SEPARATEUR}${sessionId}`;
}

/**
 * L'outbox est indexée par (compte, séance) — PAS par opération.
 *
 * C'est la traduction exacte de la règle produit : une séance n'a jamais
 * qu'UNE opération en attente, qui porte le dernier état complet du retour.
 * Empiler « +2 répétitions », puis « +5 kg », puis « RPE 8 » comme trois
 * opérations indépendantes serait à la fois inutile — le serveur remplace
 * tout à chaque envoi — et dangereux : trois envois pour un seul retour.
 *
 * `operationId` existe quand même dans l'enregistrement, pour l'idempotence
 * et le diagnostic ; il n'est simplement pas la clé.
 */
export function cleOutbox(userId: string, sessionId: string): string {
  return `${userId}${SEPARATEUR}${sessionId}`;
}

export function cleAffichage(userId: string): string {
  return userId;
}

/* ════════════════════════════════════════════════════════════════════════
 * LES ENREGISTREMENTS
 * ════════════════════════════════════════════════════════════════════════ */

interface Versionne {
  schemaVersion: number;
  userId: string;
}

/**
 * La séance du jour, figée pendant qu'il y avait du réseau.
 *
 * `payload` est le view model CANONIQUE déjà consommé par l'écran
 * (`StudentSessionBlockView[]` et ce qui l'accompagne). On ne crée pas un
 * second modèle métier : deux modèles finissent toujours par diverger, et
 * c'est l'élève qui voit la différence.
 */
export interface SnapshotSeance extends Versionne {
  /** Date métier `YYYY-MM-DD` à laquelle cette séance était CELLE DU JOUR. */
  businessDate: string;
  sessionId: string;
  payload: unknown;
  /** Horodatage de la dernière capture réussie, en millisecondes. */
  syncedAt: number;
}

/** L'état de synchronisation d'un brouillon. */
export type EtatSynchronisation = "brouillon" | "en_attente" | "synchronise";

/**
 * Ce que l'élève a saisi, sauvegardé en continu.
 *
 * Pas de `commenceLe` ni de `startedAt` : la durée est DÉCLARÉE par l'élève
 * (arbitrage du 09/08/2026), elle ne se mesure pas. Un chronomètre aurait
 * transformé une séance d'une heure, laissée ouverte trois heures dans une
 * poche, en séance de quatre heures.
 */
export interface BrouillonSeance extends Versionne {
  sessionId: string;
  /**
   * Numéro de révision, strictement croissant pour une même séance.
   *
   * Il existe pour une raison précise, et une seule : les écritures de ce
   * brouillon ne sont pas ordonnées. La saisie est enregistrée avec un
   * léger différé (le temps que l'élève finisse de taper), si bien qu'une
   * écriture « état A », programmée puis oubliée, peut se déclencher APRÈS
   * la validation finale « état B ». Sans révision, elle écraserait B —
   * l'élève verrait sa séance revenir en arrière, et personne ne saurait
   * pourquoi.
   *
   * Toute écriture portant une révision inférieure ou égale à celle déjà
   * enregistrée est donc REFUSÉE. C'est une garantie d'ordre, pas un simple
   * horodatage : deux écritures dans la même milliseconde restent
   * départageables.
   */
  revision: number;
  /**
   * Date métier de la SÉANCE, figée à la création du brouillon.
   *
   * Elle ne bouge plus. Une séance saisie le lundi soir et synchronisée le
   * mardi matin reste une séance du lundi — recalculer cette date au moment
   * de l'envoi la déplacerait d'un jour, silencieusement.
   */
  businessDate: string;
  payload: unknown;
  updatedAt: number;
  syncStatus: EtatSynchronisation;
}

/** Le retour complet qui attend d'être envoyé. */
export interface OperationOutbox extends Versionne {
  /**
   * Identifiant du RETOUR — stable tant que ce retour n'a pas été acquitté,
   * même quand l'élève le corrige. Sert à l'idempotence et au diagnostic.
   *
   * Il ne suffit PAS à distinguer deux états successifs : c'est exactement
   * pour cela qu'il reste stable. La distinction, c'est `revision` qui la
   * porte.
   */
  operationId: string;
  /**
   * Révision du payload contenu ici — la MÊME que celle du brouillon écrit
   * dans la même transaction.
   *
   * Elle répond à la course la plus dangereuse du système : le
   * synchroniseur envoie l'état A, l'élève corrige sa séance pendant la
   * requête, l'outbox devient B, puis le serveur confirme A. Sans révision,
   * l'acquittement supprimerait B — une correction que l'élève croit
   * enregistrée, partie sans laisser de trace. On n'acquitte donc que si la
   * révision présente est encore celle qui a été envoyée.
   */
  revision: number;
  sessionId: string;
  /** Le payload EXACT attendu par `/api/student/workout-feedback`. */
  payload: WorkoutFeedbackPayload;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

/** Les seules valeurs qu'un `access_type` peut prendre, côté serveur comme ici. */
export const TYPES_ACCES = ["coaching", "programme_seul"] as const;
export type TypeAcces = (typeof TYPES_ACCES)[number];

/**
 * MÉTADONNÉE D'AFFICHAGE — et le mot « affichage » est à prendre au pied de
 * la lettre.
 *
 * Le seul but de cet enregistrement est que la barre latérale montre HORS
 * LIGNE exactement les mêmes entrées qu'en ligne. Un compte
 * « programme_seul » voit deux entrées ; sans cette valeur, le hook ne
 * répond jamais hors ligne, il reste sur son défaut « coaching », et les
 * sept entrées s'affichent. Ce n'est pas une fuite — les gardes serveur
 * redirigent toujours — mais ce n'est pas le produit demandé.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE N'EST PAS UN CONTRÔLE D'AUTORISATION, ET ÇA NE DOIT JAMAIS LE DEVENIR
 * ────────────────────────────────────────────────────────────────────────
 * Une valeur écrite sur le disque du téléphone est modifiable par qui
 * possède le téléphone. S'en servir pour DÉCIDER d'un accès reviendrait à
 * demander à l'utilisateur quels droits il souhaite. L'autorité reste
 * entière : `requireCoachingFeature`, `requireActiveStudentAccess` et les
 * politiques RLS. Ici, on ne fait que reproduire un masquage de menu que le
 * serveur applique déjà.
 *
 * D'où `estTypeAcces` : une valeur inconnue — corrompue, bricolée — n'est
 * pas « interprétée au mieux », elle est refusée.
 */
export interface PreferenceAffichage extends Versionne {
  accessType: TypeAcces;
  updatedAt: number;
}

export function estTypeAcces(valeur: unknown): valeur is TypeAcces {
  return typeof valeur === "string" && (TYPES_ACCES as readonly string[]).includes(valeur);
}

/* ════════════════════════════════════════════════════════════════════════
 * LECTURE DÉFENSIVE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Un enregistrement est-il exploitable POUR CE COMPTE, DANS CETTE VERSION ?
 *
 * Les deux contrôles sont faits ensemble et à chaque lecture, jamais l'un
 * sans l'autre. La clé garantit déjà l'isolement des comptes ; cette
 * vérification est la seconde barrière — celle qui tient encore si une clé
 * est un jour construite ailleurs qu'ici.
 */
export function estCompatible(enregistrement: unknown, userId: string): boolean {
  if (typeof enregistrement !== "object" || enregistrement === null) {
    return false;
  }
  const e = enregistrement as Partial<Versionne>;
  return e.schemaVersion === SCHEMA_VERSION && typeof e.userId === "string" && e.userId === userId;
}
