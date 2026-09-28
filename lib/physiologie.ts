import { paceSecondsFromSpeedKmh } from "@/lib/cardio";

/**
 * LES CALCULS PHYSIOLOGIQUES — UNE SEULE FORMULE PAR GRANDEUR, DANS CE FICHIER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il convertit des RÉFÉRENCES (FCmax, VMA, FTP, PMA) et des POURCENTAGES en
 * valeurs affichables (bpm, km/h, allure, watts). Il ne décide de rien : ni
 * les bornes des zones (lib/zones-physiologiques.ts), ni ce qu'on affiche
 * quand une donnée manque (l'appelant, via `SourceValeur`).
 *
 * ⚠️ AUCUNE FORMULE N'EST INVENTÉE ICI. Chacune est vérifiée contre les
 * valeurs des captures de référence :
 *   · FCmax 190, 75 %        → 142,5 → 143 bpm   ✔ capture « Général »
 *   · VMA 11 km/h, 85 %      → 9,35 km/h         ✔ capture « Course »
 *   · 9,35 km/h              → 6:25 min/km       ✔ capture « Course »
 *   · FTP 210 W, 55 %        → 115,5 → 116 W     ✔ capture « Course »/« Vélo »
 *   · PMA 320 W, 50 %        → 160 W             ✔ capture « Cyclisme »
 *   · VMA nat 3 km/h, 70 %   → 2,1 km/h → 2:51/100 m ✔ capture « Natation »
 * Une formule qui ne se vérifie sur aucune capture n'entre pas dans ce
 * fichier ; elle est signalée comme ambiguïté au coach.
 *
 * ⚠️ `Math.round` PARTOUT, ET C'EST UN CHOIX MESURÉ. 0,75 × 190 = 142,5, et la
 * capture affiche 143 : l'arrondi est au plus proche, demi vers le haut. Un
 * `floor` afficherait 142 et ferait diverger toute la colonne FC.
 *
 * ⚠️ CE MODULE NE DUPLIQUE PAS lib/cardio.ts. `paceSecondsFromSpeedKmh` y vit
 * déjà depuis le chantier V3 et reste la seule implémentation de
 * « allure = 3600 / vitesse » ; on l'importe au lieu de la réécrire.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. LA PROVENANCE D'UNE VALEUR EST UNE DONNÉE, PAS UN DÉTAIL
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ « ESTIMÉE » NE DOIT JAMAIS SE LIRE COMME « MESURÉE ». C'est la leçon de
 * `ancreDeSemaine` (lib/training-schedule.ts) : un repli silencieux finit
 * toujours par être pris pour une mesure. Une FCmax déclarée au doigt mouillé
 * et une FCmax sortie d'un test ne valent pas la même chose pour prescrire,
 * et l'écran doit le dire.
 *
 * ⚠️ AUCUNE ESTIMATION N'EST CALCULÉE PAR CE MODULE. Les captures de
 * référence ne documentent aucune formule d'estimation de FCmax par l'âge, et
 * le projet n'en contient aucune. Inventer « 220 − âge » et l'attribuer au
 * modèle de référence serait fabriquer une règle métier. Le statut est donc
 * DÉCLARÉ par le coach, jamais déduit.
 */
export type SourceValeur = "mesuree" | "estimee" | "absente";

export interface ValeurPhysio {
  readonly valeur: number | null;
  readonly source: SourceValeur;
}

/** Fabrique une `ValeurPhysio` : `null` ou `NaN` deviennent « absente ». */
export function valeurPhysio(valeur: number | null | undefined, source: SourceValeur): ValeurPhysio {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) {
    return { valeur: null, source: "absente" };
  }
  return { valeur, source: source === "absente" ? "mesuree" : source };
}

export const VALEUR_ABSENTE: ValeurPhysio = { valeur: null, source: "absente" };

/** `true` quand la valeur existe ET peut servir de référence à un calcul. */
export function estExploitable(v: ValeurPhysio | null | undefined): v is ValeurPhysio & { valeur: number } {
  return Boolean(v && v.valeur !== null && Number.isFinite(v.valeur) && v.valeur > 0);
}

/* ════════════════════════════════════════════════════════════════════════
 * II. FRÉQUENCE CARDIAQUE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * FC de réserve = FCmax − FC repos. CALCULÉE, jamais saisie.
 *
 * Vérifié : 190 − 50 = 140 bpm (capture « Général »).
 *
 * ⚠️ ELLE NE SERT PAS À CALCULER LES ZONES. Le modèle de référence prescrit
 * en % de FCmax, PAS en % de FC de réserve (Karvonen) : 75 % de 190 donne
 * 143 bpm sur la capture, là où Karvonen donnerait 50 + 0,75 × 140 = 155. La
 * FC de réserve est une information affichée, et rien d'autre.
 */
export function fcReserve(fcMax: ValeurPhysio, fcRepos: ValeurPhysio): ValeurPhysio {
  if (!estExploitable(fcMax) || !estExploitable(fcRepos)) return VALEUR_ABSENTE;
  const reserve = fcMax.valeur - fcRepos.valeur;
  if (reserve <= 0) return VALEUR_ABSENTE;
  // Dérivée de deux mesures : elle ne peut pas être « plus sûre » que la moins
  // sûre des deux.
  const source: SourceValeur = fcMax.source === "estimee" || fcRepos.source === "estimee" ? "estimee" : "mesuree";
  return { valeur: Math.round(reserve), source };
}

/** bpm correspondant à un % de FCmax. Vérifié : 190 × 75 % → 143. */
export function bpmDepuisPourcentageFcMax(fcMaxKnown: number, pourcentage: number): number {
  return Math.round((fcMaxKnown * pourcentage) / 100);
}

/* ════════════════════════════════════════════════════════════════════════
 * III. VITESSE, ALLURE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Vitesse correspondant à un % d'une référence de vitesse (VMA course, VMA
 * natation). Vérifié : 11 × 85 % → 9,35 km/h ; 3 × 70 % → 2,1 km/h.
 *
 * ⚠️ ARRONDI À 2 DÉCIMALES, et les captures l'imposent : 10,12 et 11,55
 * apparaissent tels quels. Un arrondi à 1 décimale afficherait 10,1.
 */
export function vitesseDepuisPourcentage(referenceKmh: number, pourcentage: number): number {
  return arrondir2((referenceKmh * pourcentage) / 100);
}

/**
 * Allure en secondes par 100 m à partir d'une vitesse en km/h — l'unité de la
 * natation. Vérifié : 3 km/h → 120 s = 02:00/100 m ; 2,1 km/h → 171 s = 02:51.
 *
 * ⚠️ PAS UNE VARIANTE DE `paceSecondsFromSpeedKmh`, UNE AUTRE DISTANCE. 100 m
 * = 0,1 km, donc 3600 × 0,1 = 360. Écrire `paceSecondsFromSpeedKmh(v) / 10`
 * donnerait le même nombre mais dirait une autre chose ; ici la constante est
 * la distance, et elle se lit.
 */
export function allureSecondesPar100m(vitesseKmh: number): number {
  if (!vitesseKmh || vitesseKmh <= 0) return 0;
  return Math.round(360 / vitesseKmh);
}

/** Allure en secondes par km — délègue à lib/cardio.ts, seule implémentation. */
export function allureSecondesParKm(vitesseKmh: number): number {
  return paceSecondsFromSpeedKmh(vitesseKmh);
}

/** « 6:25 » — sans suffixe, l'appelant ajoute « min/km » ou « /100m ». */
export function formatMinutesSecondes(secondes: number | null | undefined): string {
  if (!secondes || secondes <= 0 || !Number.isFinite(secondes)) return "—";
  const minutes = Math.floor(secondes / 60);
  const reste = Math.round(secondes % 60);
  // 59,6 s arrondit à 60 : on reporte, sinon on afficherait « 6:60 ».
  if (reste === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(reste).padStart(2, "0")}`;
}

/** « 02:51 » — la graphie de la natation, minutes sur deux chiffres. */
export function formatMinutesSecondesLarge(secondes: number | null | undefined): string {
  const compact = formatMinutesSecondes(secondes);
  if (compact === "—") return compact;
  const [minutes, sec] = compact.split(":");
  return `${String(minutes).padStart(2, "0")}:${sec}`;
}

/** « 9.35 » — 2 décimales, zéros de fin retirés (11 × 0,6 → « 6.6 », pas « 6.60 »). */
export function formatVitesse(kmh: number | null | undefined): string {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return "—";
  return String(arrondir2(kmh));
}

/* ════════════════════════════════════════════════════════════════════════
 * IV. PUISSANCE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Watts correspondant à un % d'une référence de puissance (FTP ou PMA).
 * Vérifié : 210 × 55 % → 115,5 → 116 W ; 320 × 50 % → 160 W.
 */
export function wattsDepuisPourcentage(referenceWatts: number, pourcentage: number): number {
  return Math.round((referenceWatts * pourcentage) / 100);
}

/* ════════════════════════════════════════════════════════════════════════
 * V. TESTS — DE LA PERFORMANCE À LA RÉFÉRENCE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * VMA à partir d'un test de 6 minutes (demi-Cooper) : la distance parcourue,
 * ramenée à une vitesse moyenne.
 *
 *     v (km/h) = distance (m) / 1000 ÷ (6/60 h) = distance × 0,01
 *
 * Vérifié contre la capture : 14 km/h correspond à 1400 m en 6 minutes.
 * Utilisable en course comme en natation — c'est la même moyenne, pas une
 * seconde formule.
 */
export function vmaDepuisTest6Minutes(distanceMetres: number): number | null {
  if (!Number.isFinite(distanceMetres) || distanceMetres <= 0) return null;
  return arrondir2(distanceMetres * 0.01);
}

/**
 * Vitesse à partir d'un test chronométré sur 400 m (natation) :
 *
 *     v (km/h) = 0,4 km ÷ (t/3600 h) = 1440 / t
 *
 * Vérifié : 400 m en 6:00 (360 s) → 4 km/h, soit 01:30/100 m — les deux
 * valeurs de la capture « Calculer ma VMA natation ».
 *
 * ⚠️ AUCUN COEFFICIENT CORRECTEUR N'EST APPLIQUÉ. Certaines écoles dérivent
 * une « vitesse critique » du 400 m avec un abattement ; l'interface de
 * référence affiche la vitesse brute du test, et rien n'autorise à supposer
 * autre chose. Si tu veux un coefficient, il devra être décidé, pas deviné.
 */
export function vitesseDepuisTest400m(secondes: number): number | null {
  if (!Number.isFinite(secondes) || secondes <= 0) return null;
  return arrondir2(1440 / secondes);
}

/* ─── Outil interne ─── */

/** Arrondi à 2 décimales SANS zéros de fin (9.35 → 9.35 ; 6.60 → 6.6 ; 16.50 → 16.5). */
function arrondir2(valeur: number): number {
  if (!Number.isFinite(valeur)) return 0;
  return Math.round(valeur * 100) / 100;
}

/**
 * Lit un temps saisi « mm:ss », « m:ss » ou « 360 » (secondes) en secondes.
 *
 * ⚠️ AUCUNE TOLÉRANCE SILENCIEUSE. « 6:75 » n'est pas 7 min 15 s : c'est une
 * faute de saisie, et la convertir donnerait une VMA fausse sans que personne
 * ne s'en aperçoive. Une entrée invalide rend `null`, et l'écran le dit.
 */
export function secondesDepuisMinutesSecondes(texte: string): number | null {
  const propre = texte.trim().replace(",", ":");
  if (propre === "") return null;
  if (/^\d+$/.test(propre)) {
    const secondes = Number(propre);
    return secondes > 0 ? secondes : null;
  }
  const correspondance = /^(\d{1,3}):([0-5]\d)$/.exec(propre);
  if (!correspondance) return null;
  const total = Number(correspondance[1]) * 60 + Number(correspondance[2]);
  return total > 0 ? total : null;
}
