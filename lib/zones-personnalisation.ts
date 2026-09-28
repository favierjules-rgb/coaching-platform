import {
  FC_PAR_ZONE,
  FTP_PAR_ZONE,
  PMA_PAR_ZONE,
  VMA_COURSE_PAR_ZONE,
  VMA_NATATION_PAR_ZONE,
  ZONES,
  type BorneFc,
  type BorneZone,
  type NumeroZone,
  type ReglagesZones,
  type SportZone,
} from "@/lib/zones-physiologiques";

/**
 * LA PERSONNALISATION DES BORNES DE ZONES — fonctions pures, testables seules.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST ENREGISTRÉ, ET CE QUI NE L'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ SEULE UNE BORNE QUI DIFFÈRE DU BARÈME iDO EST ÉCRITE. Recopier les sept
 * zones dans `zone_settings` dès la première modification paraîtrait plus
 * simple, mais figerait l'athlète : une correction future du barème de
 * référence ne l'atteindrait plus jamais, sans que rien ne le signale. Une
 * borne remise à sa valeur de référence DISPARAÎT donc des réglages.
 *
 * ⚠️ « RÉINITIALISER MES ZONES iDO » N'EST PAS UNE RÉÉCRITURE. C'est un
 * EFFACEMENT (`zone_settings` → NULL) : voir `reinitialiserZones`. Écrire le
 * barème par-dessus produirait le même affichage aujourd'hui et un athlète
 * définitivement désynchronisé demain.
 */

/** Les cinq familles de bornes qu'un athlète peut personnaliser. */
export type FamilleBornes = "fc" | "vmaCourse" | "ftp" | "pma" | "vmaNatation";

export const LIBELLE_FAMILLE: Readonly<Record<FamilleBornes, string>> = {
  fc: "% FC max",
  vmaCourse: "% VMA",
  ftp: "% FTP",
  pma: "% PMA",
  vmaNatation: "% VMA natation",
};

/** Le barème de référence de chaque famille — jamais recopié à la main ailleurs. */
export const BAREME_PAR_FAMILLE: Readonly<Record<FamilleBornes, Readonly<Record<NumeroZone, BorneFc>>>> = {
  fc: FC_PAR_ZONE,
  vmaCourse: VMA_COURSE_PAR_ZONE,
  ftp: FTP_PAR_ZONE,
  pma: PMA_PAR_ZONE,
  vmaNatation: VMA_NATATION_PAR_ZONE,
};

/**
 * Les familles pertinentes pour un sport, dans l'ordre d'affichage.
 *
 * ⚠️ LE VÉLO EN A DEUX. %FTP et %PMA sont deux référentiels indépendants : la
 * PMA n'est pas déduite du FTP, et l'inverse non plus.
 */
export function famillesDuSport(sport: SportZone): readonly FamilleBornes[] {
  if (sport === "course") return ["vmaCourse", "fc"];
  if (sport === "velo") return ["ftp", "pma", "fc"];
  return ["vmaNatation", "fc"];
}

/** La borne de référence d'une zone (`null` = non significatif, Z6/Z7 en FC). */
export function bornesDeReference(famille: FamilleBornes, zone: NumeroZone): BorneFc {
  return BAREME_PAR_FAMILLE[famille][zone];
}

/** La borne effectivement appliquée : le réglage de l'athlète, sinon le barème. */
export function bornesAppliquees(famille: FamilleBornes, zone: NumeroZone, reglages: ReglagesZones): BorneFc {
  const perso = reglages[famille]?.[zone];
  return perso === undefined ? bornesDeReference(famille, zone) : perso;
}

/** `true` quand cette borne a été personnalisée pour cet athlète. */
export function estPersonnalisee(famille: FamilleBornes, zone: NumeroZone, reglages: ReglagesZones): boolean {
  return reglages[famille]?.[zone] !== undefined;
}

/** `true` dès qu'une seule borne, un seul RPE ou un seul nom est personnalisé. */
export function possedeUnePersonnalisation(reglages: ReglagesZones): boolean {
  return (["fc", "vmaCourse", "ftp", "pma", "vmaNatation", "rpe", "noms"] as const).some((cle) => {
    const valeur = reglages[cle];
    return valeur !== undefined && Object.keys(valeur).length > 0;
  });
}

function memesBornes(a: BorneFc, b: BorneFc): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Pose (ou retire) une borne personnalisée et rend les réglages complets.
 *
 * ⚠️ FONCTION PURE : elle ne modifie pas `reglages`, elle en rend un nouveau.
 * Muter l'objet lu ferait disparaître la valeur d'origine avant même que
 * l'enregistrement ait réussi.
 */
export function avecBornes(
  reglages: ReglagesZones,
  famille: FamilleBornes,
  zone: NumeroZone,
  bornes: BorneZone,
): ReglagesZones {
  const famillePrecedente: Record<number, BorneFc | undefined> = { ...(reglages[famille] ?? {}) };
  if (memesBornes(bornes, bornesDeReference(famille, zone))) {
    delete famillePrecedente[zone];
  } else {
    famillePrecedente[zone] = bornes;
  }
  const suivant: Record<string, unknown> = { ...reglages };
  if (Object.keys(famillePrecedente).length === 0) {
    delete suivant[famille];
  } else {
    suivant[famille] = famillePrecedente;
  }
  return suivant as ReglagesZones;
}

export interface SaisieBornes {
  readonly min: string;
  readonly max: string;
}

/** Les bornes saisies pour un sport, indexées « famille:zone ». */
export type SaisieBornesParZone = Readonly<Record<string, SaisieBornes>>;

export function cleSaisie(famille: FamilleBornes, zone: NumeroZone): string {
  return `${famille}:${zone}`;
}

export interface ResultatBornes {
  readonly ok: boolean;
  readonly erreurs: Readonly<Record<string, string>>;
  readonly reglages: ReglagesZones;
}

/**
 * Applique une saisie complète (un sport) sur les réglages existants.
 *
 * ⚠️ UNE BORNE REFUSÉE ANNULE TOUT L'ENREGISTREMENT. Appliquer les zones
 * valides et ignorer les autres produirait un tableau où Z3 finit plus haut que
 * Z4 commence — des allures qui se chevauchent, présentées comme cohérentes.
 *
 * ⚠️ MIN STRICTEMENT INFÉRIEUR À MAX. Une borne inversée rendrait une plage de
 * vitesse décroissante et une allure « de 4:00 à 6:00 » lue à l'envers.
 */
export function reglagesDepuisSaisie(
  reglages: ReglagesZones,
  sport: SportZone,
  saisie: SaisieBornesParZone,
): ResultatBornes {
  const erreurs: Record<string, string> = {};
  let resultat = reglages;

  for (const famille of famillesDuSport(sport)) {
    for (const zone of ZONES) {
      // Une zone sans borne de référence (Z6/Z7 en FC) n'est pas personnalisable :
      // le barème iDO la déclare non significative, et lui inventer des bornes
      // afficherait une plage que le modèle de référence refuse.
      if (bornesDeReference(famille, zone) === null) continue;
      const cle = cleSaisie(famille, zone);
      const valeurs = saisie[cle];
      if (!valeurs) continue;

      const min = Number(String(valeurs.min).replace(",", "."));
      const max = Number(String(valeurs.max).replace(",", "."));
      if (String(valeurs.min).trim() === "" || String(valeurs.max).trim() === "") {
        erreurs[cle] = "Les deux bornes sont attendues.";
        continue;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        erreurs[cle] = "Nombres attendus.";
        continue;
      }
      if (min < 0 || max < 0) {
        erreurs[cle] = "Pourcentages positifs attendus.";
        continue;
      }
      if (min >= max) {
        erreurs[cle] = "La borne basse doit être inférieure à la borne haute.";
        continue;
      }
      resultat = avecBornes(resultat, famille, zone, [min, max]);
    }
  }

  if (Object.keys(erreurs).length > 0) {
    return { ok: false, erreurs, reglages };
  }
  return { ok: true, erreurs: {}, reglages: resultat };
}

/** Pré-remplit la saisie d'un sport depuis les bornes appliquées. */
export function saisieDepuisReglages(sport: SportZone, reglages: ReglagesZones): Record<string, SaisieBornes> {
  const saisie: Record<string, SaisieBornes> = {};
  for (const famille of famillesDuSport(sport)) {
    for (const zone of ZONES) {
      const bornes = bornesAppliquees(famille, zone, reglages);
      if (bornes === null) continue;
      saisie[cleSaisie(famille, zone)] = { min: String(bornes[0]), max: String(bornes[1]) };
    }
  }
  return saisie;
}
