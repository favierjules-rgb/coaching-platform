import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * C5.1 — LE CHIFFREMENT DES JETONS NOLIO.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CHIFFRER, ALORS QUE LA TABLE EST DÉJÀ FERMÉE
 * ════════════════════════════════════════════════════════════════════════
 * `nolio_connections` n'accorde AUCUN privilège à `authenticated` : la RLS
 * seule suffirait à empêcher un élève de lire les jetons d'un autre. Le
 * chiffrement protège d'autre chose — d'un dump SQL, d'une sauvegarde qui
 * traîne, d'une clé service-role fuitée. Trois scénarios où la RLS ne joue
 * plus, et où le refresh_token, lui, est encore valable.
 *
 * ⚠️ ET LE REFRESH_TOKEN N'EXPIRE PAS. Nolio l'a confirmé : pas d'expiration,
 * rotation à chaque usage. Une fuite est donc PERMANENTE jusqu'à un
 * `/deauthorize/` explicite. C'est ce fait, et lui seul, qui met la barre à ce
 * niveau.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AES-256-GCM, ET LA RAISON EST L'AUTHENTIFICATION
 * ════════════════════════════════════════════════════════════════════════
 * GCM est un mode AUTHENTIFIÉ : il produit un tag d'intégrité, et le
 * déchiffrement ÉCHOUE si le chiffré a été modifié d'un seul octet. Un mode
 * comme CBC déchiffrerait en silence un chiffré altéré et rendrait des octets
 * arbitraires — qu'on enverrait ensuite à Nolio comme s'ils étaient un jeton.
 *
 * ⚠️ L'IV EST TIRÉ AU HASARD À CHAQUE CHIFFREMENT, JAMAIS RÉUTILISÉ. Réutiliser
 * un IV avec la même clé en GCM ne fuite pas seulement le clair : cela permet
 * de RETROUVER la clé d'authentification. 12 octets, c'est la taille pour
 * laquelle GCM est spécifié.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE FORMAT PORTE TOUT CE QU'IL FAUT POUR DÉCHIFFRER
 * ════════════════════════════════════════════════════════════════════════
 *     v<version>.<iv>.<tag>.<chiffré>          — quatre champs, base64url
 *
 * ⚠️ LA VERSION EST DANS LA CHAÎNE, PAS SEULEMENT EN COLONNE. `key_version`
 * existe bien dans `nolio_connections`, mais un chiffré doit rester
 * déchiffrable même sorti de sa ligne — dans un export, un test, un correctif
 * manuel. Un format auto-descriptif ne dépend pas de son contexte.
 *
 * ⚠️ AUCUN SÉPARATEUR AMBIGU : base64url n'utilise ni `.` ni `+` ni `/`, donc
 * le point ne peut pas apparaître dans un champ. Un `split(".")` est sûr.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE NE FAIT JAMAIS
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ IL NE JOURNALISE RIEN. Ni la clé, ni le clair, ni le chiffré, ni même une
 * longueur. Un `console.error(erreur)` sur une erreur de déchiffrement
 * suffirait à faire apparaître un jeton dans les logs d'hébergement le jour
 * où la bibliothèque sous-jacente déciderait d'inclure l'entrée dans son
 * message.
 *
 * ⚠️ IL NE RÉVÈLE RIEN DANS SES ERREURS. `NolioCryptoErreur` porte un motif
 * court et fixe. Jamais la valeur qui a échoué.
 */

/** La version de clé écrite par ce lot. Bougera à la première rotation. */
export const VERSION_DE_CLE_COURANTE = 1;

const ALGORITHME = "aes-256-gcm" as const;
const OCTETS_DE_CLE = 32;
const OCTETS_IV = 12;
const OCTETS_TAG = 16;

export type MotifCrypto =
  | "cle-absente"
  | "cle-invalide"
  | "format-invalide"
  | "version-inconnue"
  | "authentification-echouee";

/**
 * ⚠️ UNE ERREUR QUI NE PORTE QU'UN MOTIF. Elle traverse les routes jusqu'aux
 * journaux : y mettre la donnée fautive reviendrait à écrire un jeton dans un
 * fichier de log, ce que tout le reste du module s'interdit.
 */
export class NolioCryptoErreur extends Error {
  readonly motif: MotifCrypto;

  constructor(motif: MotifCrypto) {
    super(`nolio-crypto: ${motif}`);
    this.name = "NolioCryptoErreur";
    this.motif = motif;
  }
}

/**
 * La clé, lue à CHAQUE appel plutôt que mémorisée au chargement du module.
 *
 * ⚠️ CE N'EST PAS UNE INEFFICACITÉ. Un module qui lit `process.env` à
 * l'importation fige la valeur au premier `import` — et rend les tests
 * incapables de vérifier le cas « clé absente », puisque l'ordre des imports
 * déciderait du résultat. Le coût d'un `Buffer.from` est négligeable devant un
 * aller-retour réseau vers Nolio.
 */
function lireCle(): Buffer {
  const brut = process.env.NOLIO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!brut) throw new NolioCryptoErreur("cle-absente");

  let cle: Buffer;
  try {
    cle = Buffer.from(brut, "base64");
  } catch {
    throw new NolioCryptoErreur("cle-invalide");
  }
  // ⚠️ LA LONGUEUR EST VÉRIFIÉE, ET C'EST INDISPENSABLE. `Buffer.from(x,
  // "base64")` ne lève JAMAIS : il ignore les caractères invalides et rend un
  // tampon plus court. Sans ce contrôle, une clé tronquée passerait, et
  // `createCipheriv` échouerait plus loin avec un message technique obscur.
  if (cle.length !== OCTETS_DE_CLE) throw new NolioCryptoErreur("cle-invalide");
  return cle;
}

/** `true` si une clé exploitable est configurée. Ne révèle jamais la clé. */
export function cleDeChiffrementDisponible(): boolean {
  try {
    lireCle();
    return true;
  } catch {
    return false;
  }
}

/** Chiffre un jeton. Rend la chaîne auto-descriptive décrite en en-tête. */
export function chiffrerJeton(clair: string): string {
  const cle = lireCle();
  const iv = randomBytes(OCTETS_IV);
  const chiffreur = createCipheriv(ALGORITHME, cle, iv);
  const chiffre = Buffer.concat([chiffreur.update(clair, "utf8"), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return [
    `v${VERSION_DE_CLE_COURANTE}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    chiffre.toString("base64url"),
  ].join(".");
}

/**
 * Déchiffre un jeton.
 *
 * ⚠️ LÈVE PLUTÔT QUE DE RENDRE `null`. Un appelant distrait traiterait un
 * `null` comme « pas de jeton » et poursuivrait ; une exception l'arrête. Sur
 * ce chemin-là, s'arrêter est toujours la bonne réponse.
 */
export function dechiffrerJeton(enveloppe: string): string {
  const cle = lireCle();

  const morceaux = enveloppe.split(".");
  if (morceaux.length !== 4) throw new NolioCryptoErreur("format-invalide");

  const [versionBrute, ivB64, tagB64, chiffreB64] = morceaux;
  if (!/^v[1-9][0-9]*$/.test(versionBrute)) throw new NolioCryptoErreur("format-invalide");
  if (Number(versionBrute.slice(1)) !== VERSION_DE_CLE_COURANTE) {
    // ⚠️ MOTIF DISTINCT DE « format-invalide ». Le jour de la rotation, il
    // faudra distinguer « chiffré illisible » de « chiffré d'une génération
    // précédente, à re-chiffrer » — deux situations, deux réponses.
    throw new NolioCryptoErreur("version-inconnue");
  }

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const chiffre = Buffer.from(chiffreB64, "base64url");
  if (iv.length !== OCTETS_IV || tag.length !== OCTETS_TAG) {
    throw new NolioCryptoErreur("format-invalide");
  }

  try {
    const dechiffreur = createDecipheriv(ALGORITHME, cle, iv);
    dechiffreur.setAuthTag(tag);
    return Buffer.concat([dechiffreur.update(chiffre), dechiffreur.final()]).toString("utf8");
  } catch {
    // ⚠️ ON N'INSPECTE PAS L'ERREUR SOUS-JACENTE, ET ON NE LA RELAIE PAS. Le
    // message de Node ne porte pas de donnée sensible aujourd'hui ; ce n'est
    // pas une garantie sur laquelle bâtir. Un motif fixe suffit à l'appelant.
    throw new NolioCryptoErreur("authentification-echouee");
  }
}

/**
 * Comparaison à temps constant de deux chaînes — pour le `state` OAuth.
 *
 * ⚠️ ELLE VIT ICI PLUTÔT QUE DANS LA ROUTE parce que c'est une primitive
 * cryptographique, et qu'une comparaison de `state` écrite avec `===` fuite le
 * nombre de caractères corrects par le temps de réponse.
 *
 * ⚠️ `timingSafeEqual` LÈVE SI LES LONGUEURS DIFFÈRENT — d'où le contrôle
 * préalable, qui rend `false` au lieu de propager une exception. La longueur
 * n'est pas un secret ici : le `state` en a toujours la même.
 */
export function comparerEnTempsConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Un `state` OAuth : 32 octets d'aléa cryptographique, en base64url. */
export function genererState(): string {
  return randomBytes(32).toString("base64url");
}
