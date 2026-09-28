import { speedKmhFromPaceSeconds } from "@/lib/cardio";
import {
  allureSecondesPar100m,
  allureSecondesParKm,
  bpmDepuisPourcentageFcMax,
  estExploitable,
  formatMinutesSecondes,
  formatMinutesSecondesLarge,
  formatVitesse,
  vitesseDepuisPourcentage,
  wattsDepuisPourcentage,
} from "@/lib/physiologie";
import {
  fcMaxDuSport,
  ligneZone,
  REGLAGES_PAR_DEFAUT,
  ZONES,
  type NumeroZone,
  type ReferencesAthlete,
  type ReglagesZones,
  type SportZone,
} from "@/lib/zones-physiologiques";
import type { AdminCardioSegment, SportCardio } from "@/types";

/**
 * CE QUE L'ATHLÈTE DOIT COURIR — la prescription traduite en valeurs concrètes.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LA TRADUCTION SE FAIT À L'AFFICHAGE, ET PAS À LA PRESCRIPTION
 * ════════════════════════════════════════════════════════════════════════
 * Une prescription relative (« 105 % VMA », « Z4 ») est enregistrée TELLE
 * QUELLE ; la vitesse correspondante est recalculée chaque fois qu'elle est
 * affichée, contre les références du moment. C'est un choix, et il a une
 * conséquence qu'il faut connaître :
 *
 * ⚠️ QUAND LA VMA D'UN ATHLÈTE CHANGE, LES SÉANCES PASSÉES SE RELISENT AVEC LA
 * NOUVELLE. « 105 % VMA » restera 105 % VMA, mais les 11,55 km/h affichés
 * deviendront 12,60 km/h — y compris sur une séance faite il y a trois mois.
 * Aucune colonne de `training_prescriptions` ne porte de photographie des
 * références, et en ajouter une est une DÉCISION MÉTIER (faut-il qu'un
 * historique garde ses allures d'époque ?) qui n'appartient pas à ce module.
 * Le coach qui veut figer une consigne a déjà le moyen de le faire : prescrire
 * en ABSOLU (`speed_kmh`, `pace`, `power`), ce que le modèle sait stocker
 * depuis juillet 2026.
 *
 * ⚠️ AUCUNE FORMULE N'EST RÉÉCRITE ICI. Vitesses, allures, watts et bpm
 * viennent de `lib/physiologie.ts` ; les bornes de zones de
 * `lib/zones-physiologiques.ts` ; la conversion allure → vitesse de
 * `lib/cardio.ts`. Ce module ne fait que choisir laquelle appeler.
 */

export interface CibleResolue {
  /** Ce qui est prescrit, tel que le coach l'a saisi (« 105 % VMA », « Z4 »). */
  readonly consigne: string;
  /** Les valeurs concrètes déduites (vitesse, allure, bpm, watts). Vide si rien n'est calculable. */
  readonly valeurs: readonly string[];
  /** `true` quand la référence physiologique nécessaire manque à l'athlète. */
  readonly referenceManquante: boolean;
  /** `true` quand la conversion exige un sport que le bloc ne porte pas. */
  readonly sportManquant: boolean;
}

const RIEN: CibleResolue = { consigne: "Libre", valeurs: [], referenceManquante: false, sportManquant: false };

/** Le sport du bloc, ramené aux trois sports que le barème connaît. */
export function sportDesZones(sport: SportCardio | undefined): SportZone | null {
  if (sport === "course" || sport === "velo" || sport === "natation") return sport;
  return null;
}

function estUneZone(valeur: number | undefined): valeur is NumeroZone {
  return valeur !== undefined && (ZONES as readonly number[]).includes(valeur);
}

function vitesseEtAllure(sport: SportZone, vitesseKmh: number): string[] {
  if (vitesseKmh <= 0) return [];
  if (sport === "natation") {
    return [`${formatVitesse(vitesseKmh)} km/h`, `${formatMinutesSecondesLarge(allureSecondesPar100m(vitesseKmh))} /100 m`];
  }
  return [`${formatVitesse(vitesseKmh)} km/h`, `${formatMinutesSecondes(allureSecondesParKm(vitesseKmh))} /km`];
}

/**
 * Traduit l'intensité d'un segment pour UN athlète.
 *
 * ⚠️ FONCTION PURE, ET SANS ATHLÈTE IMPLICITE. Les références sont un argument :
 * deux appels avec deux athlètes ne peuvent pas se contaminer, et c'est ce qui
 * rend l'isolation vérifiable sur le calendrier comme dans le builder.
 */
export function cibleDuSegment(
  segment: AdminCardioSegment,
  sport: SportCardio | undefined,
  references: ReferencesAthlete,
  reglages: ReglagesZones = REGLAGES_PAR_DEFAUT,
): CibleResolue {
  const sportZone = sportDesZones(sport);

  switch (segment.intensityTargetType) {
    case "zone": {
      const zone = segment.targetZone;
      if (!estUneZone(zone)) return { ...RIEN, consigne: "Zone non précisée" };
      if (sportZone === null) {
        return { consigne: `Z${zone}`, valeurs: [], referenceManquante: false, sportManquant: true };
      }
      const ligne = ligneZone(sportZone, zone, references, reglages);
      const valeurs: string[] = [ligne.libellePourcentages];
      if (sportZone === "velo") {
        if (!ligne.puissanceFtp.referenceManquante && !ligne.puissanceFtp.nonSignificatif) {
          valeurs.push(ligne.puissanceFtp.libelle);
        }
      } else if (!ligne.vitesse.referenceManquante && !ligne.vitesse.nonSignificatif) {
        valeurs.push(ligne.vitesse.libelle);
        if (ligne.allure.min !== null && ligne.allure.max !== null) {
          const format = sportZone === "natation" ? formatMinutesSecondesLarge : formatMinutesSecondes;
          const unite = sportZone === "natation" ? "/100 m" : "/km";
          valeurs.push(`${format(ligne.allure.max)} - ${format(ligne.allure.min)} ${unite}`);
        }
      }
      if (!ligne.fc.referenceManquante && !ligne.fc.nonSignificatif) valeurs.push(`${ligne.fc.libelle} bpm`);
      return {
        consigne: `Z${zone} — ${ligne.nom}`,
        valeurs,
        referenceManquante: valeurs.length <= 1,
        sportManquant: false,
      };
    }

    case "vma_percentage": {
      const pourcentage = segment.targetVmaPercentage;
      if (pourcentage === undefined) return { ...RIEN, consigne: "% VMA non précisé" };
      const consigne = `${pourcentage} % VMA`;
      if (sportZone === null || sportZone === "velo") {
        return { consigne, valeurs: [], referenceManquante: false, sportManquant: true };
      }
      const reference = sportZone === "natation" ? references.vmaNatationKmh : references.vmaCourseKmh;
      if (!estExploitable(reference)) return { consigne, valeurs: [], referenceManquante: true, sportManquant: false };
      return {
        consigne,
        valeurs: vitesseEtAllure(sportZone, vitesseDepuisPourcentage(reference.valeur, pourcentage)),
        referenceManquante: false,
        sportManquant: false,
      };
    }

    case "heart_rate_percentage": {
      const pourcentage = segment.targetHrPercentage;
      if (pourcentage === undefined) return { ...RIEN, consigne: "% FC max non précisé" };
      const consigne = `${pourcentage} % FC max`;
      // ⚠️ LA FC DU SPORT QUAND ELLE EXISTE, LA GÉNÉRALE SINON — jamais une
      // FC spécifique inventée. Sans sport, la FC générale est la seule
      // référence honnête.
      const fcMax = sportZone === null ? references.fcMax : fcMaxDuSport(sportZone, references);
      if (!estExploitable(fcMax)) return { consigne, valeurs: [], referenceManquante: true, sportManquant: false };
      return {
        consigne,
        valeurs: [`${bpmDepuisPourcentageFcMax(fcMax.valeur, pourcentage)} bpm`],
        referenceManquante: false,
        sportManquant: false,
      };
    }

    case "ftp_percentage":
    case "pma_percentage": {
      const pourcentage = segment.targetPowerPercentage;
      const surFtp = segment.intensityTargetType === "ftp_percentage";
      const consigne = `${pourcentage ?? "?"} % ${surFtp ? "FTP" : "PMA"}`;
      if (pourcentage === undefined) return { ...RIEN, consigne };
      const reference = surFtp ? references.ftpWatts : references.pmaWatts;
      if (!estExploitable(reference)) return { consigne, valeurs: [], referenceManquante: true, sportManquant: false };
      return {
        consigne,
        valeurs: [`${wattsDepuisPourcentage(reference.valeur, pourcentage)} W`],
        referenceManquante: false,
        sportManquant: false,
      };
    }

    case "speed_kmh": {
      const vitesse = segment.targetSpeedKmh;
      if (vitesse === undefined) return { ...RIEN, consigne: "Vitesse non précisée" };
      return {
        consigne: `${formatVitesse(vitesse)} km/h`,
        valeurs: vitesseEtAllure(sportZone ?? "course", vitesse).slice(1),
        referenceManquante: false,
        sportManquant: false,
      };
    }

    case "pace": {
      const allure = segment.targetPaceSecondsPerKm;
      if (allure === undefined) return { ...RIEN, consigne: "Allure non précisée" };
      return {
        consigne: `${formatMinutesSecondes(allure)} /km`,
        valeurs: [`${formatVitesse(speedKmhFromPaceSeconds(allure))} km/h`],
        referenceManquante: false,
        sportManquant: false,
      };
    }

    case "power": {
      const watts = segment.targetPowerWatts;
      if (watts === undefined) return { ...RIEN, consigne: "Puissance non précisée" };
      return { consigne: `${watts} W`, valeurs: [], referenceManquante: false, sportManquant: false };
    }

    case "rpe": {
      // ⚠️ LE RPE EST DANS `intensityMin` — voir le commentaire de ce champ dans
      // types/index.ts. Le lire ailleurs afficherait « RPE non précisé » sur
      // toutes les prescriptions déjà en base.
      const rpe = segment.intensityMin;
      if (rpe === undefined) return { ...RIEN, consigne: "RPE non précisé" };
      return { consigne: `RPE ${rpe}`, valeurs: [], referenceManquante: false, sportManquant: false };
    }

    case "heart_rate_zone": {
      const zone = segment.targetHrZone?.trim();
      if (!zone) return { ...RIEN, consigne: "Zone FC non précisée" };
      return { consigne: zone, valeurs: [], referenceManquante: false, sportManquant: false };
    }

    case "race_pace":
      return { ...RIEN, consigne: "Allure de course" };
    case "custom":
      return { ...RIEN, consigne: "Personnalisé" };
    case "free":
    default:
      return RIEN;
  }
}
