import {
  allureSecondesPar100m,
  allureSecondesParKm,
  bpmDepuisPourcentageFcMax,
  estExploitable,
  vitesseDepuisPourcentage,
  wattsDepuisPourcentage,
  type ValeurPhysio,
} from "@/lib/physiologie";

/**
 * LES SEPT ZONES — BARÈME DE RÉFÉRENCE, PERSONNALISATION, RÉINITIALISATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENNENT CES NOMBRES
 * ════════════════════════════════════════════════════════════════════════
 * Du modèle de référence transmis le 28/09/2026, recopié tel quel. Ils ne
 * sont PAS un choix de ce module : ils sont sa donnée d'entrée, et aucun
 * n'a été déduit, arrondi ou « corrigé ». Chaque colonne a été revérifiée
 * contre les captures, valeur par valeur (FC 143/162/175/182/190 pour une
 * FCmax de 190 ; vitesses 6.6/7.7/9.35/10.12/11.55/16.5/27.5 pour une VMA de
 * 11 ; watts 116/158/189/221/252/315/630 pour un FTP de 210 ; watts
 * 160/192/240/272/336/480/800 pour une PMA de 320 ; allures natation
 * 2:51/2:34/2:26/2:16/2:05/2:00/1:26 pour une VMA nat de 3).
 *
 * ⚠️ RIEN ICI N'EST CODÉ EN DUR POUR UN ATHLÈTE. Ce barème est le DÉFAUT ;
 * chaque athlète peut le surcharger, et sa surcharge ne vit que chez lui.
 *
 * ⚠️ LA FC SE PRESCRIT EN % DE FCmax, PAS EN KARVONEN. Décision explicite du
 * 28/09/2026, et les captures la confirment : 75 % de 190 y vaut 143 bpm.
 * Karvonen (FCrepos + % × réserve) donnerait 155. La FC de réserve reste
 * affichée, elle n'entre dans aucun calcul de zone.
 *
 * ⚠️ Z6 ET Z7 N'ONT PAS DE FC. Le modèle les déclare « non significatif » :
 * au-delà de la FCmax, la fréquence cardiaque cesse de discriminer l'effort.
 * Calculer 110 % d'une FCmax produirait un nombre, pas une information.
 */

export const ZONES = [1, 2, 3, 4, 5, 6, 7] as const;
export type NumeroZone = (typeof ZONES)[number];

/** Sports couverts. Le « général » porte la FC, commune aux trois. */
export type SportZone = "course" | "velo" | "natation";

/** Une borne de zone : `[min, max]` en pourcentage de la référence. */
export type BorneZone = readonly [number, number];

/** `null` = « non significatif » — voir Z6/Z7 en FC. */
export type BorneFc = BorneZone | null;

/* ════════════════════════════════════════════════════════════════════════
 * I. LE BARÈME DE RÉFÉRENCE
 * ════════════════════════════════════════════════════════════════════════ */

/** RPE indicatif par zone. Transmis : 1, 2, 3, 5, 7, 9, 10. */
export const RPE_PAR_ZONE: Readonly<Record<NumeroZone, number>> = {
  1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 9, 7: 10,
};

/**
 * % de FCmax. Z1 part de la FC de repos (pas de 0 %) : la capture affiche
 * « FC Repos – 143 », donc la borne basse de Z1 est une FC, pas un
 * pourcentage. On la représente par `0` et l'affichage la remplace par la FC
 * de repos réelle — voir `ligneZone`.
 */
export const FC_PAR_ZONE: Readonly<Record<NumeroZone, BorneFc>> = {
  1: [0, 75], 2: [75, 85], 3: [85, 92], 4: [92, 96], 5: [96, 100],
  6: null, 7: null,
};

/** % de VMA — COURSE. */
export const VMA_COURSE_PAR_ZONE: Readonly<Record<NumeroZone, BorneZone>> = {
  1: [0, 60], 2: [60, 70], 3: [70, 85], 4: [85, 92], 5: [92, 105], 6: [105, 150], 7: [150, 250],
};

/** % de FTP — identique en course et en vélo dans le modèle de référence. */
export const FTP_PAR_ZONE: Readonly<Record<NumeroZone, BorneZone>> = {
  1: [0, 55], 2: [55, 75], 3: [75, 90], 4: [90, 105], 5: [105, 120], 6: [120, 150], 7: [150, 300],
};

/** % de PMA — VÉLO. */
export const PMA_PAR_ZONE: Readonly<Record<NumeroZone, BorneZone>> = {
  1: [0, 50], 2: [50, 60], 3: [60, 75], 4: [75, 85], 5: [85, 105], 6: [105, 150], 7: [150, 250],
};

/** % de VMA natation. */
export const VMA_NATATION_PAR_ZONE: Readonly<Record<NumeroZone, BorneZone>> = {
  1: [0, 70], 2: [70, 78], 3: [78, 82], 4: [82, 88], 5: [88, 96], 6: [96, 100], 7: [100, 140],
};

/** Nom et perception par zone (capture « Général »). */
export const NOM_PAR_ZONE: Readonly<Record<NumeroZone, string>> = {
  1: "Régénération", 2: "Endurance", 3: "Tempo", 4: "Seuil", 5: "VO2Max", 6: "Anaérobie", 7: "Vitesse",
};

export const PERCEPTION_PAR_ZONE: Readonly<Record<NumeroZone, string>> = {
  1: "Très (trop) facile, je peux chanter !",
  2: "Entraînement social, discussion très facile",
  3: "Possibilité de faire des phrases, mais discussion un peu saccadée",
  4: "La respiration s'accélère, possibilité de faire des phrases courtes",
  5: "Discussion impossible, peut-être un mot de temps en temps",
  6: "Vite mais pas à fond, discussion impossible !",
  7: "À fond (sprints), discussion impossible !",
};

/**
 * Clés de couleur par zone, dans le nuancier du dépôt (`BLOCK_COLOR_STYLES`).
 * Le modèle va du gris clair au pourpre ; on n'introduit pas de couleur
 * nouvelle, on choisit dans celles qui existent.
 */
export const COULEUR_PAR_ZONE: Readonly<Record<NumeroZone, string>> = {
  1: "gray", 2: "gray", 3: "rose", 4: "red", 5: "red", 6: "red", 7: "purple",
};

/* ════════════════════════════════════════════════════════════════════════
 * II. LA PERSONNALISATION — CE QUE L'ATHLÈTE PEUT SURCHARGER
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Surcharges d'un athlète, telles que stockées (une seule colonne jsonb).
 *
 * ⚠️ PARTIEL PAR CONSTRUCTION. Une clé absente veut dire « barème de
 * référence », pas « zéro ». C'est ce qui permet au bouton de
 * réinitialisation d'être une SUPPRESSION plutôt qu'une réécriture — et donc
 * de ne pas pouvoir toucher, même par accident, à la VMA, au FTP, à la PMA, à
 * la FCmax, à la FC de repos ou au poids, qui vivent dans d'autres colonnes.
 */
export interface ReglagesZones {
  readonly rpe?: Partial<Record<NumeroZone, number>>;
  readonly fc?: Partial<Record<NumeroZone, BorneFc>>;
  readonly vmaCourse?: Partial<Record<NumeroZone, BorneZone>>;
  readonly ftp?: Partial<Record<NumeroZone, BorneZone>>;
  readonly pma?: Partial<Record<NumeroZone, BorneZone>>;
  readonly vmaNatation?: Partial<Record<NumeroZone, BorneZone>>;
  readonly noms?: Partial<Record<NumeroZone, string>>;
}

/** Les réglages d'un athlète qui n'a rien personnalisé. */
export const REGLAGES_PAR_DEFAUT: ReglagesZones = {};

/**
 * « Réinitialiser mes zones » — rend des réglages VIDES.
 *
 * ⚠️ CE N'EST PAS UNE RÉÉCRITURE, C'EST UN EFFACEMENT, et la différence est
 * toute la garantie demandée. Réécrire le barème dans la colonne obligerait à
 * énumérer ce qu'on remet ; effacer rend impossible d'atteindre une autre
 * donnée, puisque la colonne ne contient QUE les zones. La VMA, le FTP, la
 * PMA, la FCmax, la FC de repos, le poids et le VO2max vivent dans leurs
 * propres colonnes et ne sont pas nommés ici.
 */
export function reinitialiserZones(): ReglagesZones {
  return REGLAGES_PAR_DEFAUT;
}

/** Barème effectif d'un athlète : le défaut, surchargé par ses réglages. */
function borne(
  defaut: BorneZone,
  surcharge: BorneZone | undefined,
): BorneZone {
  return surcharge ?? defaut;
}

export function rpeDeLaZone(zone: NumeroZone, reglages: ReglagesZones = REGLAGES_PAR_DEFAUT): number {
  return reglages.rpe?.[zone] ?? RPE_PAR_ZONE[zone];
}

export function nomDeLaZone(zone: NumeroZone, reglages: ReglagesZones = REGLAGES_PAR_DEFAUT): string {
  return reglages.noms?.[zone] ?? NOM_PAR_ZONE[zone];
}

export function borneFcDeLaZone(zone: NumeroZone, reglages: ReglagesZones = REGLAGES_PAR_DEFAUT): BorneFc {
  const surcharge = reglages.fc?.[zone];
  return surcharge !== undefined ? surcharge : FC_PAR_ZONE[zone];
}

export function borneVmaCourse(zone: NumeroZone, r: ReglagesZones = REGLAGES_PAR_DEFAUT): BorneZone {
  return borne(VMA_COURSE_PAR_ZONE[zone], r.vmaCourse?.[zone]);
}
export function borneFtp(zone: NumeroZone, r: ReglagesZones = REGLAGES_PAR_DEFAUT): BorneZone {
  return borne(FTP_PAR_ZONE[zone], r.ftp?.[zone]);
}
export function bornePma(zone: NumeroZone, r: ReglagesZones = REGLAGES_PAR_DEFAUT): BorneZone {
  return borne(PMA_PAR_ZONE[zone], r.pma?.[zone]);
}
export function borneVmaNatation(zone: NumeroZone, r: ReglagesZones = REGLAGES_PAR_DEFAUT): BorneZone {
  return borne(VMA_NATATION_PAR_ZONE[zone], r.vmaNatation?.[zone]);
}

/* ════════════════════════════════════════════════════════════════════════
 * III. LES RÉFÉRENCES D'UN ATHLÈTE, ET LE TABLEAU QU'ELLES PRODUISENT
 * ════════════════════════════════════════════════════════════════════════ */

/** Ce que le calcul des zones a besoin de savoir d'un athlète. */
export interface ReferencesAthlete {
  /** FC max GÉNÉRALE — le repli quand le sport n'a pas la sienne. */
  readonly fcMax: ValeurPhysio;
  readonly fcRepos: ValeurPhysio;
  readonly vmaCourseKmh: ValeurPhysio;
  readonly vmaNatationKmh: ValeurPhysio;
  readonly ftpWatts: ValeurPhysio;
  readonly pmaWatts: ValeurPhysio;
  /**
   * FC max SPÉCIFIQUES, quand l'athlète les connaît.
   *
   * ⚠️ POURQUOI CES TROIS CHAMPS EXISTENT. Une FC max n'est pas la même en
   * course, à vélo et en natation : la position, la masse musculaire engagée et
   * l'immersion la déplacent de plusieurs battements. L'écran de référence
   * « Modifier mes données physiologiques » porte d'ailleurs trois champs
   * distincts (FC Max Bike, FC Max Nat.) à côté de la FC Max générale.
   *
   * ⚠️ AUCUNE FC SPÉCIFIQUE N'EST INVENTÉE. Absente, on retombe sur la FC max
   * générale — un repli, pas un calcul : il n'existe aucun coefficient
   * documenté pour déduire une FC max vélo d'une FC max course, et en fabriquer
   * un produirait des zones fausses avec l'autorité d'une mesure.
   */
  readonly fcMaxParSport?: {
    readonly course?: ValeurPhysio;
    readonly velo?: ValeurPhysio;
    readonly natation?: ValeurPhysio;
  };
}

/**
 * LA FC MAX QUI S'APPLIQUE À CE SPORT — spécifique si elle existe, générale sinon.
 *
 * Règle arrêtée le 28/09/2026 : `hr_max_run` / `hr_max_bike` / `hr_max_swim`
 * l'emportent sur `hr_max` quand ils sont renseignés, et seulement alors.
 */
export function fcMaxDuSport(sport: SportZone, references: ReferencesAthlete): ValeurPhysio {
  const specifique = references.fcMaxParSport?.[sport];
  return estExploitable(specifique) ? specifique : references.fcMax;
}

/** Une plage calculée, ou l'explication de son absence. */
export interface PlageCalculee {
  readonly min: number | null;
  readonly max: number | null;
  /** « 143 - 162 », « Non significatif », « — ». */
  readonly libelle: string;
  /** `true` quand la plage n'a pas de sens pour cette zone (Z6/Z7 en FC). */
  readonly nonSignificatif: boolean;
  /** `true` quand la référence manque chez l'athlète. */
  readonly referenceManquante: boolean;
}

const NON_SIGNIFICATIF: PlageCalculee = {
  min: null, max: null, libelle: "Non significatif", nonSignificatif: true, referenceManquante: false,
};
const REFERENCE_MANQUANTE: PlageCalculee = {
  min: null, max: null, libelle: "—", nonSignificatif: false, referenceManquante: true,
};

/** Une ligne du tableau des zones, pour un sport donné. */
export interface LigneZone {
  readonly zone: NumeroZone;
  readonly nom: string;
  readonly perception: string;
  readonly couleur: string;
  readonly rpe: number;
  /** Bornes en % telles qu'affichées dans la colonne « % … ». */
  readonly pourcentages: BorneZone | null;
  readonly libellePourcentages: string;
  /** bpm — calculés depuis la FC max DE CE SPORT (voir `fcMaxDuSport`). */
  readonly fc: PlageCalculee;
  /** `true` quand la FC de cette ligne vient d'une FC max propre au sport. */
  readonly fcSpecifiqueAuSport: boolean;
  /** km/h (course, natation). */
  readonly vitesse: PlageCalculee;
  /** min/km (course) ou min/100 m (natation). */
  readonly allure: PlageCalculee;
  /** watts — %FTP (course, vélo). */
  readonly puissanceFtp: PlageCalculee;
  /** watts — %PMA (vélo seulement). */
  readonly puissancePma: PlageCalculee;
}

/**
 * LE TABLEAU DES ZONES D'UN ATHLÈTE, POUR UN SPORT.
 *
 * ⚠️ FONCTION PURE. Elle ne lit rien, n'écrit rien, ne connaît aucun athlète
 * en particulier : on lui donne des références et des réglages, elle rend des
 * lignes. C'est ce qui rend l'isolation entre athlètes structurelle — deux
 * appels avec deux jeux de références ne peuvent pas se contaminer.
 */
export function tableauZones(
  sport: SportZone,
  references: ReferencesAthlete,
  reglages: ReglagesZones = REGLAGES_PAR_DEFAUT,
): LigneZone[] {
  return ZONES.map((zone) => ligneZone(sport, zone, references, reglages));
}

export function ligneZone(
  sport: SportZone,
  zone: NumeroZone,
  references: ReferencesAthlete,
  reglages: ReglagesZones = REGLAGES_PAR_DEFAUT,
): LigneZone {
  const pourcentages = pourcentagesPrincipaux(sport, zone, reglages);
  return {
    zone,
    nom: nomDeLaZone(zone, reglages),
    perception: PERCEPTION_PAR_ZONE[zone],
    couleur: COULEUR_PAR_ZONE[zone],
    rpe: rpeDeLaZone(zone, reglages),
    pourcentages,
    libellePourcentages: pourcentages ? `${pourcentages[0]}% - ${pourcentages[1]}%` : "Non significatif",
    fc: plageFc(sport, zone, references, reglages),
    fcSpecifiqueAuSport: estExploitable(references.fcMaxParSport?.[sport]),
    vitesse: plageVitesse(sport, zone, references, reglages),
    allure: plageAllure(sport, zone, references, reglages),
    puissanceFtp: plagePuissance(references.ftpWatts, borneFtp(zone, reglages), sport === "natation"),
    puissancePma: plagePuissance(references.pmaWatts, bornePma(zone, reglages), sport !== "velo"),
  };
}

/** Le pourcentage « principal » affiché pour ce sport (celui de la colonne %). */
function pourcentagesPrincipaux(sport: SportZone, zone: NumeroZone, r: ReglagesZones): BorneZone | null {
  if (sport === "course") return borneVmaCourse(zone, r);
  if (sport === "natation") return borneVmaNatation(zone, r);
  return borneFtp(zone, r);
}

/**
 * ⚠️ Z1 PART DE LA FC DE REPOS, PAS DE ZÉRO. La capture affiche
 * « FC Repos – 143 » : la borne basse de Z1 est une fréquence réelle, celle de
 * l'athlète au repos. Rendre 0 bpm annoncerait un cœur arrêté.
 */
function plageFc(sport: SportZone, zone: NumeroZone, references: ReferencesAthlete, reglages: ReglagesZones): PlageCalculee {
  const bornes = borneFcDeLaZone(zone, reglages);
  if (bornes === null) return NON_SIGNIFICATIF;
  // ⚠️ LA FC DU SPORT, PAS LA GÉNÉRALE PAR DÉFAUT. Voir `fcMaxDuSport`.
  const fcMax = fcMaxDuSport(sport, references);
  if (!estExploitable(fcMax)) return REFERENCE_MANQUANTE;

  const haut = bpmDepuisPourcentageFcMax(fcMax.valeur, bornes[1]);
  const basCalcule = bpmDepuisPourcentageFcMax(fcMax.valeur, bornes[0]);
  const partDuRepos = bornes[0] === 0;
  const bas = partDuRepos && estExploitable(references.fcRepos) ? references.fcRepos.valeur : basCalcule;
  /*
   * ⚠️ LE LIBELLÉ DÉRIVE DE `bas`, IL NE LE RECALCULE PAS. Il l'a recalculé, et
   * c'est un sabotage qui l'a montré : en remplaçant `bas` par le calcul brut
   * (0 bpm pour la borne 0 % de la Z1), le libellé continuait d'afficher la FC de
   * repos réelle tandis que `min` valait 0 — deux vérités différentes dans le
   * même objet, dont une seule était testée. Il n'y a désormais qu'une source.
   */
  const reposInconnu = partDuRepos && !estExploitable(references.fcRepos);
  return { min: reposInconnu ? null : bas, max: haut,
    libelle: `${reposInconnu ? "FC repos" : String(bas)} - ${haut}`,
    nonSignificatif: false, referenceManquante: false };
}

function plageVitesse(sport: SportZone, zone: NumeroZone, references: ReferencesAthlete, reglages: ReglagesZones): PlageCalculee {
  if (sport === "velo") return NON_SIGNIFICATIF;
  const reference = sport === "course" ? references.vmaCourseKmh : references.vmaNatationKmh;
  if (!estExploitable(reference)) return REFERENCE_MANQUANTE;
  const bornes = sport === "course" ? borneVmaCourse(zone, reglages) : borneVmaNatation(zone, reglages);
  const min = vitesseDepuisPourcentage(reference.valeur, bornes[0]);
  const max = vitesseDepuisPourcentage(reference.valeur, bornes[1]);
  return { min, max, libelle: `${min} - ${max} km/h`, nonSignificatif: false, referenceManquante: false };
}

/**
 * ⚠️ UNE VITESSE NULLE N'A PAS D'ALLURE, ET « 0 » N'EN EST PAS UNE. La borne
 * basse de Z1 vaut 0 % : le temps au kilomètre y est infini. Le libellé le dit
 * (« — ») plutôt que d'afficher un zéro qui se lirait « instantané ».
 */
function plageAllure(sport: SportZone, zone: NumeroZone, references: ReferencesAthlete, reglages: ReglagesZones): PlageCalculee {
  const vitesse = plageVitesse(sport, zone, references, reglages);
  if (vitesse.nonSignificatif) return NON_SIGNIFICATIF;
  if (vitesse.referenceManquante || vitesse.min === null || vitesse.max === null) return REFERENCE_MANQUANTE;

  const convertir = sport === "natation" ? allureSecondesPar100m : allureSecondesParKm;
  // L'allure s'inverse : la vitesse MIN donne l'allure la plus LENTE.
  const lente = vitesse.min > 0 ? convertir(vitesse.min) : null;
  const rapide = vitesse.max > 0 ? convertir(vitesse.max) : null;
  return { min: rapide, max: lente, libelle: "", nonSignificatif: false, referenceManquante: false };
}

function plagePuissance(reference: ValeurPhysio, bornes: BorneZone, horsSujet: boolean): PlageCalculee {
  if (horsSujet) return NON_SIGNIFICATIF;
  if (!estExploitable(reference)) return REFERENCE_MANQUANTE;
  const min = wattsDepuisPourcentage(reference.valeur, bornes[0]);
  const max = wattsDepuisPourcentage(reference.valeur, bornes[1]);
  return { min, max, libelle: `${min} - ${max} w`, nonSignificatif: false, referenceManquante: false };
}
