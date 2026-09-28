/**
 * Harnais — LA PHYSIOLOGIE ET LES SEPT ZONES, VÉRIFIÉES CONTRE LES CAPTURES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que chaque nombre affiché par le tableau des zones se retrouve, au chiffre
 * près, dans le modèle de référence transmis le 28/09/2026 — pour un athlète
 * de FCmax 190, FC repos 50, VMA course 11 km/h, VMA natation 3 km/h, FTP
 * 210 W et PMA 320 W. Ce ne sont pas des attentes inventées : ce sont les
 * valeurs lues sur les captures, recopiées ici comme oracle.
 *
 * Il prouve aussi ce que le barème NE doit pas faire : pas de Karvonen, pas de
 * FC en Z6/Z7, pas de fuite d'un athlète vers un autre, et un « réinitialiser »
 * qui ne touche à AUCUNE donnée physiologique.
 *
 * Lancement : npm run test:physiologie-zones
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  allureSecondesPar100m,
  allureSecondesParKm,
  bpmDepuisPourcentageFcMax,
  estExploitable,
  fcReserve,
  formatMinutesSecondes,
  formatMinutesSecondesLarge,
  formatVitesse,
  valeurPhysio,
  VALEUR_ABSENTE,
  vitesseDepuisPourcentage,
  vitesseDepuisTest400m,
  vmaDepuisTest6Minutes,
  wattsDepuisPourcentage,
} from "../../lib/physiologie";
import {
  FC_PAR_ZONE,
  FTP_PAR_ZONE,
  PMA_PAR_ZONE,
  REGLAGES_PAR_DEFAUT,
  RPE_PAR_ZONE,
  VMA_COURSE_PAR_ZONE,
  VMA_NATATION_PAR_ZONE,
  ZONES,
  fcMaxDuSport,
  reinitialiserZones,
  tableauZones,
  type NumeroZone,
  type ReferencesAthlete,
  type ReglagesZones,
} from "../../lib/zones-physiologiques";

const lireSource = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ── L'athlète des captures ───────────────────────────────────────────── */

const MARCO: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(50, "mesuree"),
  vmaCourseKmh: valeurPhysio(11, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};

const VIDE: ReferencesAthlete = {
  fcMax: VALEUR_ABSENTE, fcRepos: VALEUR_ABSENTE, vmaCourseKmh: VALEUR_ABSENTE,
  vmaNatationKmh: VALEUR_ABSENTE, ftpWatts: VALEUR_ABSENTE, pmaWatts: VALEUR_ABSENTE,
};

const ligne = (sport: "course" | "velo" | "natation", zone: NumeroZone, refs = MARCO, r: ReglagesZones = REGLAGES_PAR_DEFAUT) =>
  tableauZones(sport, refs, r)[zone - 1]!;

/* ════════════════════════════════════════════════════════════════════════
 * I. LE BARÈME DE RÉFÉRENCE, RECOPIÉ TEL QUEL
 * ════════════════════════════════════════════════════════════════════════ */

test("BAREME1. RPE par zone — 1, 2, 3, 5, 7, 9, 10", () => {
  assert.deepEqual(ZONES.map((z) => RPE_PAR_ZONE[z]), [1, 2, 3, 5, 7, 9, 10]);
});

test("BAREME2. %VMA course — 0/60/70/85/92/105/150/250", () => {
  assert.deepEqual(ZONES.map((z) => VMA_COURSE_PAR_ZONE[z]), [
    [0, 60], [60, 70], [70, 85], [85, 92], [92, 105], [105, 150], [150, 250],
  ]);
});

test("BAREME3. %FTP — 0/55/75/90/105/120/150/300", () => {
  assert.deepEqual(ZONES.map((z) => FTP_PAR_ZONE[z]), [
    [0, 55], [55, 75], [75, 90], [90, 105], [105, 120], [120, 150], [150, 300],
  ]);
});

test("BAREME4. %PMA — 0/50/60/75/85/105/150/250", () => {
  assert.deepEqual(ZONES.map((z) => PMA_PAR_ZONE[z]), [
    [0, 50], [50, 60], [60, 75], [75, 85], [85, 105], [105, 150], [150, 250],
  ]);
});

test("BAREME5. %VMA natation — 0/70/78/82/88/96/100/140", () => {
  assert.deepEqual(ZONES.map((z) => VMA_NATATION_PAR_ZONE[z]), [
    [0, 70], [70, 78], [78, 82], [82, 88], [88, 96], [96, 100], [100, 140],
  ]);
});

test("BAREME6. %FCmax — et Z6/Z7 SANS bornes", () => {
  assert.deepEqual(ZONES.map((z) => FC_PAR_ZONE[z]), [
    [0, 75], [75, 85], [85, 92], [92, 96], [96, 100], null, null,
  ]);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES VALEURS DES CAPTURES, AU CHIFFRE PRÈS
 * ════════════════════════════════════════════════════════════════════════ */

test("CAPTURE-FC. FCmax 190 → 143 / 162 / 175 / 182 / 190 bpm", () => {
  // Capture « Général » : Z1 « FC Repos - 143 », puis 143-162, 162-175,
  // 175-182, 182-190.
  assert.equal(ligne("course", 1).fc.libelle, "50 - 143", "Z1 part de la FC de repos réelle");
  /*
   * ⚠️ `min` DOIT DIRE LA MÊME CHOSE QUE LE LIBELLÉ. Un sabotage a montré qu'ils
   * pouvaient divergier : le libellé affichait « 50 - 143 » pendant que `min`
   * valait 0 bpm. Seul le libellé était testé ; les deux le sont désormais.
   */
  assert.equal(ligne("course", 1).fc.min, 50, "la borne basse exploitable de la Z1 est la FC de repos");
  assert.equal(ligne("course", 1).fc.max, 143);
  assert.equal(ligne("course", 2).fc.libelle, "143 - 162");
  assert.equal(ligne("course", 3).fc.libelle, "162 - 175");
  assert.equal(ligne("course", 4).fc.libelle, "175 - 182");
  assert.equal(ligne("course", 5).fc.libelle, "182 - 190");
});

test("CAPTURE-FC-Z6Z7. Z6 et Z7 sont NON SIGNIFICATIVES en FC", () => {
  for (const zone of [6, 7] as const) {
    const l = ligne("course", zone);
    assert.equal(l.fc.nonSignificatif, true, `Z${zone} devrait être non significative`);
    assert.equal(l.fc.min, null);
    assert.equal(l.fc.max, null);
    assert.equal(l.fc.libelle, "Non significatif");
  }
});

test("CAPTURE-VITESSE. VMA 11 km/h → 6.6 / 7.7 / 9.35 / 10.12 / 11.55 / 16.5 / 27.5", () => {
  const attendus = [
    [0, 6.6], [6.6, 7.7], [7.7, 9.35], [9.35, 10.12], [10.12, 11.55], [11.55, 16.5], [16.5, 27.5],
  ];
  for (const zone of ZONES) {
    const l = ligne("course", zone);
    assert.equal(l.vitesse.min, attendus[zone - 1]![0], `Z${zone} min`);
    assert.equal(l.vitesse.max, attendus[zone - 1]![1], `Z${zone} max`);
  }
});

test("CAPTURE-ALLURE. VMA 11 km/h → 9:05 / 7:48 / 6:25 / 5:56 / 5:12 / 3:38 / 2:11", () => {
  // Colonne « Allure (min/km) » de la capture « Course » : la borne HAUTE de
  // chaque zone (la plus rapide).
  const attendus = ["9:05", "7:48", "6:25", "5:56", "5:12", "3:38", "2:11"];
  for (const zone of ZONES) {
    const l = ligne("course", zone);
    assert.equal(formatMinutesSecondes(l.allure.min), attendus[zone - 1], `Z${zone} allure rapide`);
  }
  // Et la borne basse de Z1 (vitesse nulle) n'a PAS d'allure.
  assert.equal(ligne("course", 1).allure.max, null, "une vitesse nulle n'a pas d'allure");
});

test("CAPTURE-FTP. FTP 210 W → 116 / 158 / 189 / 221 / 252 / 315 / 630", () => {
  const attendus = [[0, 116], [116, 158], [158, 189], [189, 221], [221, 252], [252, 315], [315, 630]];
  for (const zone of ZONES) {
    const l = ligne("course", zone);
    assert.equal(l.puissanceFtp.min, attendus[zone - 1]![0], `Z${zone} min`);
    assert.equal(l.puissanceFtp.max, attendus[zone - 1]![1], `Z${zone} max`);
  }
});

test("CAPTURE-PMA. PMA 320 W → 160 / 192 / 240 / 272 / 336 / 480 / 800 (vélo)", () => {
  const attendus = [[0, 160], [160, 192], [192, 240], [240, 272], [272, 336], [336, 480], [480, 800]];
  for (const zone of ZONES) {
    const l = ligne("velo", zone);
    assert.equal(l.puissancePma.min, attendus[zone - 1]![0], `Z${zone} min`);
    assert.equal(l.puissancePma.max, attendus[zone - 1]![1], `Z${zone} max`);
  }
});

test("CAPTURE-NATATION. VMA nat 3 km/h → 2.1 / 2.34 / 2.46 / 2.64 / 2.88 / 3 / 4.2 km/h", () => {
  const vitesses = [[0, 2.1], [2.1, 2.34], [2.34, 2.46], [2.46, 2.64], [2.64, 2.88], [2.88, 3], [3, 4.2]];
  for (const zone of ZONES) {
    const l = ligne("natation", zone);
    assert.equal(l.vitesse.min, vitesses[zone - 1]![0], `Z${zone} min`);
    assert.equal(l.vitesse.max, vitesses[zone - 1]![1], `Z${zone} max`);
  }
  // Allures /100 m de la capture : 02:51, 02:34, 02:26, 02:16, 02:05, 02:00, 01:26.
  const allures = ["02:51", "02:34", "02:26", "02:16", "02:05", "02:00", "01:26"];
  for (const zone of ZONES) {
    const l = ligne("natation", zone);
    assert.equal(formatMinutesSecondesLarge(l.allure.min), allures[zone - 1], `Z${zone} allure /100m`);
  }
});

test("CAPTURE-VELO-FTP. le vélo garde les mêmes watts %FTP que la course", () => {
  for (const zone of ZONES) {
    assert.deepEqual(
      [ligne("velo", zone).puissanceFtp.min, ligne("velo", zone).puissanceFtp.max],
      [ligne("course", zone).puissanceFtp.min, ligne("course", zone).puissanceFtp.max],
      `Z${zone}`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. CE QUE LE MODÈLE NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════ */

test("NEG-KARVONEN. la FC se calcule en %FCmax, JAMAIS en % de FC de réserve", () => {
  /*
   * ⚠️ LE TEST QUI SÉPARE LES DEUX ÉCOLES. Karvonen rendrait
   * 50 + 0,75 × (190 − 50) = 155 bpm pour la borne de Z1/Z2 ; la capture
   * affiche 143, soit 0,75 × 190. Les deux sont défendables en physiologie,
   * une seule est celle du modèle retenu.
   */
  const karvonen = 50 + 0.75 * (190 - 50);
  assert.equal(karvonen, 155, "la fixture doit bien distinguer les deux formules");
  assert.equal(ligne("course", 2).fc.min, 143);
  assert.notEqual(ligne("course", 2).fc.min, 155, "Karvonen s'est glissé dans le calcul");
  // Et structurellement : le module ne connaît pas la FC de réserve.
  const source = sansCommentaires(lireSource("../../lib/zones-physiologiques.ts"));
  assert.ok(!/fcReserve/.test(source), "le module des zones utilise la FC de réserve");
});

test("NEG-REFERENCE. une référence absente ne produit JAMAIS un nombre", () => {
  for (const zone of ZONES) {
    const l = ligne("course", zone, VIDE);
    assert.equal(l.fc.min, null, `Z${zone} FC`);
    assert.equal(l.vitesse.min, null, `Z${zone} vitesse`);
    assert.equal(l.puissanceFtp.min, null, `Z${zone} watts`);
    if (!l.fc.nonSignificatif) assert.equal(l.fc.libelle, "—");
  }
});

test("NEG-ZERO. une vitesse nulle n'a pas d'allure — jamais « 0:00 »", () => {
  assert.equal(formatMinutesSecondes(0), "—");
  assert.equal(formatMinutesSecondes(null), "—");
  assert.equal(allureSecondesParKm(0), 0);
  assert.equal(allureSecondesPar100m(0), 0);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. PERSONNALISATION, ISOLATION, RÉINITIALISATION
 * ════════════════════════════════════════════════════════════════════════ */

test("PERSO1. modifier une borne recalcule immédiatement les valeurs", () => {
  // Le coach passe Z2 de 75-85 % à 74-84 % de FCmax.
  const reglages: ReglagesZones = { fc: { 2: [74, 84] } };
  assert.equal(ligne("course", 2).fc.libelle, "143 - 162", "avant");
  assert.equal(ligne("course", 2, MARCO, reglages).fc.libelle, "141 - 160", "après : 0,74×190=140,6→141 ; 0,84×190=159,6→160");
  // Les autres zones ne bougent pas.
  assert.equal(ligne("course", 3, MARCO, reglages).fc.libelle, "162 - 175");
});

test("PERSO2. chaque référentiel se personnalise séparément", () => {
  const reglages: ReglagesZones = { vmaCourse: { 3: [72, 86] }, ftp: { 3: [76, 91] }, rpe: { 3: 4 } };
  const l = ligne("course", 3, MARCO, reglages);
  assert.equal(l.vitesse.min, 7.92, "11 × 0,72");
  assert.equal(l.puissanceFtp.min, 160, "210 × 0,76 = 159,6 → 160");
  assert.equal(l.rpe, 4);
  // Et la FC, non personnalisée, garde le barème.
  assert.equal(l.fc.libelle, "162 - 175");
});

test("ISOLATION1. deux athlètes, deux tableaux — aucune contamination", () => {
  /*
   * ⚠️ L'ISOLATION EST STRUCTURELLE, PAS CONVENTIONNELLE. `tableauZones` est
   * pure : elle ne lit aucun état partagé, donc deux appels ne peuvent pas se
   * voir. Ce test le constate sur des valeurs, et le suivant sur les réglages.
   */
  const jules: ReferencesAthlete = { ...MARCO, fcMax: valeurPhysio(200, "mesuree"), vmaCourseKmh: valeurPhysio(16, "mesuree") };
  const tableauMarco = tableauZones("course", MARCO);
  const tableauJules = tableauZones("course", jules);
  assert.equal(tableauMarco[1]!.fc.libelle, "143 - 162");
  assert.equal(tableauJules[1]!.fc.libelle, "150 - 170", "0,75×200=150 ; 0,85×200=170");
  assert.equal(tableauMarco[1]!.vitesse.max, 7.7);
  assert.equal(tableauJules[1]!.vitesse.max, 11.2);
  // Le tableau de Marco n'a pas bougé après le calcul de celui de Jules.
  assert.deepEqual(tableauZones("course", MARCO), tableauMarco);
});

test("ISOLATION2. les réglages d'un athlète ne fuient pas vers l'autre", () => {
  const reglagesMarco: ReglagesZones = { fc: { 2: [70, 80] } };
  const avecReglages = ligne("course", 2, MARCO, reglagesMarco);
  const sansReglages = ligne("course", 2, MARCO);
  assert.equal(avecReglages.fc.libelle, "133 - 152");
  assert.equal(sansReglages.fc.libelle, "143 - 162", "le barème par défaut a été muté");
  // Et le barème exporté lui-même est intact.
  assert.deepEqual(FC_PAR_ZONE[2], [75, 85], "le barème de référence a été muté");
});

test("RESET1. réinitialiser rend des réglages VIDES — donc le barème de référence", () => {
  const personnalise: ReglagesZones = { fc: { 2: [70, 80] }, vmaCourse: { 3: [60, 90] }, rpe: { 5: 8 } };
  assert.equal(ligne("course", 2, MARCO, personnalise).fc.libelle, "133 - 152");
  const apresReset = reinitialiserZones();
  assert.deepEqual(apresReset, {}, "le reset doit EFFACER, pas réécrire");
  assert.equal(ligne("course", 2, MARCO, apresReset).fc.libelle, "143 - 162");
  assert.equal(ligne("course", 3, MARCO, apresReset).vitesse.max, 9.35);
  assert.equal(ligne("course", 5, MARCO, apresReset).rpe, 7);
});

test("RESET2. NÉGATIF — le reset ne touche à AUCUNE donnée physiologique", () => {
  /*
   * ⚠️ LA GARANTIE EST STRUCTURELLE : `reinitialiserZones` ne prend aucun
   * argument et rend un objet vide. Elle ne PEUT pas atteindre la VMA, le FTP,
   * la PMA, la FCmax, la FC de repos ou le poids — ils ne sont pas dans son
   * périmètre, et la colonne qu'elle vide ne contient que des zones.
   */
  const avant = { ...MARCO };
  const apres = reinitialiserZones();
  assert.deepEqual(apres, {});
  assert.deepEqual(MARCO, avant, "les références de l'athlète ont été modifiées");
  assert.equal(MARCO.vmaCourseKmh.valeur, 11);
  assert.equal(MARCO.ftpWatts.valeur, 210);
  assert.equal(MARCO.pmaWatts.valeur, 320);
  assert.equal(MARCO.fcMax.valeur, 190);
  assert.equal(MARCO.fcRepos.valeur, 50);

  const source = sansCommentaires(lireSource("../../lib/zones-physiologiques.ts"));
  const bloc = source.slice(source.indexOf("export function reinitialiserZones"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(!/vma|ftp|pma|fcMax|fcRepos|poids|weight/i.test(corps), "le reset nomme une donnée physiologique");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV-bis. LA FC MAX SPÉCIFIQUE AU SPORT
 * ════════════════════════════════════════════════════════════════════════ */

const MARCO_TRIATHLETE: ReferencesAthlete = {
  ...MARCO,
  fcMaxParSport: {
    velo: valeurPhysio(182, "mesuree"),
    natation: valeurPhysio(175, "mesuree"),
    // course : absente → repli sur la FC max générale (190).
  },
};

test("FCSPORT1. la FC max du sport l'emporte sur la générale quand elle existe", () => {
  assert.equal(fcMaxDuSport("velo", MARCO_TRIATHLETE).valeur, 182);
  assert.equal(fcMaxDuSport("natation", MARCO_TRIATHLETE).valeur, 175);
  assert.equal(fcMaxDuSport("course", MARCO_TRIATHLETE).valeur, 190, "absente → repli sur la générale");
});

test("FCSPORT2. les zones FC suivent la FC max DU SPORT", () => {
  // Vélo, FCmax 182 : Z2 = 75-85 % → 136,5→137 et 154,7→155.
  assert.equal(ligne("velo", 2, MARCO_TRIATHLETE).fc.libelle, "137 - 155");
  // Natation, FCmax 175 : Z2 → 131,25→131 et 148,75→149.
  assert.equal(ligne("natation", 2, MARCO_TRIATHLETE).fc.libelle, "131 - 149");
  // Course, pas de FC spécifique : la générale, donc les valeurs des captures.
  assert.equal(ligne("course", 2, MARCO_TRIATHLETE).fc.libelle, "143 - 162");
});

test("FCSPORT3. NÉGATIF — la FC générale ne doit PAS écraser une FC spécifique", () => {
  /*
   * ⚠️ LE SABOTAGE VISÉ : ignorer `fcMaxParSport` et retomber systématiquement
   * sur `fcMax`. Les trois sports afficheraient alors la même colonne FC, ce
   * qui est précisément ce que les champs « FC Max Bike » et « FC Max Nat. »
   * de l'écran de référence servent à éviter.
   */
  const velo = ligne("velo", 5, MARCO_TRIATHLETE).fc;
  const course = ligne("course", 5, MARCO_TRIATHLETE).fc;
  assert.notEqual(velo.libelle, course.libelle, "vélo et course affichent la même FC");
  assert.equal(velo.max, 182, "Z5 vélo doit plafonner à la FCmax vélo");
  assert.equal(course.max, 190, "Z5 course doit plafonner à la FCmax générale");
  // Et la ligne DIT d'où vient sa FC.
  assert.equal(ligne("velo", 2, MARCO_TRIATHLETE).fcSpecifiqueAuSport, true);
  assert.equal(ligne("course", 2, MARCO_TRIATHLETE).fcSpecifiqueAuSport, false);
});

test("FCSPORT4. une FC spécifique vide ou nulle ne remplace rien", () => {
  const bancal: ReferencesAthlete = {
    ...MARCO,
    fcMaxParSport: { velo: VALEUR_ABSENTE, natation: valeurPhysio(0, "mesuree") },
  };
  assert.equal(fcMaxDuSport("velo", bancal).valeur, 190, "absente → générale");
  assert.equal(fcMaxDuSport("natation", bancal).valeur, 190, "0 bpm n'est pas une référence");
  assert.equal(ligne("velo", 2, bancal).fcSpecifiqueAuSport, false);
});

test("FCSPORT5. sans AUCUNE FC max, les trois sports se taisent", () => {
  for (const sport of ["course", "velo", "natation"] as const) {
    assert.equal(ligne(sport, 2, VIDE).fc.libelle, "—", sport);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * V. MESURÉE / ESTIMÉE
 * ════════════════════════════════════════════════════════════════════════ */

test("SOURCE1. une valeur porte sa provenance, et l'absence en est une", () => {
  assert.deepEqual(valeurPhysio(190, "mesuree"), { valeur: 190, source: "mesuree" });
  assert.deepEqual(valeurPhysio(185, "estimee"), { valeur: 185, source: "estimee" });
  assert.deepEqual(valeurPhysio(null, "mesuree"), { valeur: null, source: "absente" });
  assert.deepEqual(valeurPhysio(Number.NaN, "mesuree"), { valeur: null, source: "absente" });
  assert.equal(estExploitable(valeurPhysio(0, "mesuree")), false, "0 bpm n'est pas une référence");
});

test("SOURCE2. une dérivée n'est jamais plus sûre que la moins sûre de ses sources", () => {
  assert.deepEqual(fcReserve(valeurPhysio(190, "mesuree"), valeurPhysio(50, "mesuree")), { valeur: 140, source: "mesuree" });
  assert.deepEqual(fcReserve(valeurPhysio(190, "estimee"), valeurPhysio(50, "mesuree")), { valeur: 140, source: "estimee" });
  assert.deepEqual(fcReserve(valeurPhysio(190, "mesuree"), valeurPhysio(50, "estimee")), { valeur: 140, source: "estimee" });
  assert.deepEqual(fcReserve(VALEUR_ABSENTE, valeurPhysio(50, "mesuree")), VALEUR_ABSENTE);
  assert.deepEqual(fcReserve(valeurPhysio(50, "mesuree"), valeurPhysio(190, "mesuree")), VALEUR_ABSENTE, "une réserve négative n'existe pas");
});

test("SOURCE3. NÉGATIF — aucune FCmax n'est estimée par une formule inventée", () => {
  /*
   * ⚠️ DEMANDE EXPLICITE DU 28/09/2026. Les captures ne documentent aucune
   * formule d'estimation par l'âge, et le projet n'en contient aucune :
   * écrire « 220 − âge » et l'attribuer au modèle de référence fabriquerait
   * une règle métier. Le statut « estimée » est DÉCLARÉ, jamais déduit.
   */
  for (const chemin of ["../../lib/physiologie.ts", "../../lib/zones-physiologiques.ts"]) {
    const source = sansCommentaires(lireSource(chemin));
    assert.ok(!/220\s*-\s*age|220\s*-\s*âge|208\s*-\s*0[.,]7/i.test(source), `${chemin} contient une formule d'estimation inventée`);
    assert.ok(!/\bage\b/i.test(source), `${chemin} calcule à partir de l'âge`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LES TESTS DE TERRAIN
 * ════════════════════════════════════════════════════════════════════════ */

test("TEST6MIN. 1400 m en 6 minutes → VMA 14 km/h, soit 4:17 min/km", () => {
  // Les deux valeurs de la capture « Calculer ma VMA » (course).
  assert.equal(vmaDepuisTest6Minutes(1400), 14);
  assert.equal(formatMinutesSecondes(allureSecondesParKm(14)), "4:17");
  assert.equal(vmaDepuisTest6Minutes(0), null);
  assert.equal(vmaDepuisTest6Minutes(-100), null);
});

test("TEST400M. 400 m en 6:00 → 4 km/h, soit 01:30 /100 m", () => {
  // Les deux valeurs de la capture « Calculer ma VMA natation ».
  assert.equal(vitesseDepuisTest400m(360), 4);
  assert.equal(formatMinutesSecondesLarge(allureSecondesPar100m(4)), "01:30");
  // Et le test de 6 minutes donne la même chose en natation : 400 m → 4 km/h.
  assert.equal(vmaDepuisTest6Minutes(400), 4);
  assert.equal(vitesseDepuisTest400m(0), null);
});

test("TEST-COHERENCE. les deux protocoles natation concordent", () => {
  // 400 m en 6 minutes, c'est 400 m parcourus en 6 minutes : les deux entrées
  // du même effort doivent rendre la même vitesse.
  assert.equal(vitesseDepuisTest400m(360), vmaDepuisTest6Minutes(400));
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. ARRONDIS ET FORMATS
 * ════════════════════════════════════════════════════════════════════════ */

test("ARRONDI1. le demi monte — 142,5 bpm devient 143, pas 142", () => {
  assert.equal(bpmDepuisPourcentageFcMax(190, 75), 143);
  assert.equal(bpmDepuisPourcentageFcMax(190, 85), 162, "161,5 → 162");
  assert.equal(bpmDepuisPourcentageFcMax(190, 96), 182, "182,4 → 182");
  assert.equal(wattsDepuisPourcentage(210, 55), 116, "115,5 → 116");
  assert.equal(wattsDepuisPourcentage(210, 105), 221, "220,5 → 221");
});

test("ARRONDI2. les vitesses gardent 2 décimales, sans zéros de fin", () => {
  assert.equal(vitesseDepuisPourcentage(11, 60), 6.6);
  assert.equal(vitesseDepuisPourcentage(11, 92), 10.12);
  assert.equal(vitesseDepuisPourcentage(11, 150), 16.5);
  assert.equal(formatVitesse(6.6), "6.6");
  assert.equal(formatVitesse(9.35), "9.35");
  assert.equal(formatVitesse(null), "—");
});

test("ARRONDI3. 59,6 secondes ne produit jamais « 6:60 »", () => {
  assert.equal(formatMinutesSecondes(359.6), "6:00");
  assert.equal(formatMinutesSecondes(360), "6:00");
});

test("PURETE. les deux modules ne lisent rien et n'appellent aucune horloge", () => {
  for (const chemin of ["../../lib/physiologie.ts", "../../lib/zones-physiologiques.ts"]) {
    const source = lireSource(chemin);
    assert.ok(!/currentDate\(|new Date\(/.test(source), `${chemin} fabrique une date`);
    assert.ok(!/supabase|fetch\(/.test(source), `${chemin} lit des données`);
    assert.ok(!/useState|useEffect/.test(source), `${chemin} est un composant`);
  }
});

test("NON-DUPLICATION. l'allure au km reste celle de lib/cardio.ts", () => {
  /*
   * ⚠️ « 3600 / vitesse » EXISTAIT DÉJÀ (paceSecondsFromSpeedKmh, chantier V3).
   * La recopier ici aurait créé la deuxième implémentation d'une même règle —
   * exactement ce que ce dépôt a déjà payé deux fois.
   */
  const source = sansCommentaires(lireSource("../../lib/physiologie.ts"));
  assert.match(source, /import \{ paceSecondsFromSpeedKmh \} from "@\/lib\/cardio"/);
  assert.ok(!/3600\s*\/\s*vitesse|3600\s*\/\s*speed/i.test(source), "la formule au km a été recopiée");
  // La constante 360 (natation) est LÉGITIME : c'est une autre distance.
  assert.match(source, /360 \/ vitesseKmh/);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
