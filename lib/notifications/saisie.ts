/**
 * CE QUE LE NAVIGATEUR A LE DROIT DE DIRE — ET RIEN DE PLUS.
 *
 * Module PUR : aucune base, aucun réseau, aucune horloge implicite (`maintenant`
 * est un paramètre). C'est ce qui permet de l'exécuter tel quel dans les tests,
 * et c'est là que se joue l'essentiel de la sécurité du composer.
 *
 * La destination, en particulier, n'est jamais une URL saisie : elle est
 * comparée à la liste interne, exactement comme la contrainte SQL le fait de
 * son côté. Les deux disent la même chose, et il faudrait tromper les deux.
 */

import { estDestinationInterne } from "@/lib/push/destinations";
import {
  FUSEAU_PAR_DEFAUT,
  lireRegle,
  instantPourHeureLocale,
  type RegleRecurrence,
} from "@/lib/notifications/recurrence";

export const LIMITE_TITRE = 80;
export const LIMITE_CORPS = 300;
/** Un envoi ne vise jamais plus d'élèves que le studio n'en a jamais eu. */
export const LIMITE_ELEVES = 500;

export interface SaisieValide {
  titre: string;
  corps: string;
  destination: string;
  genreCible: "all" | "students";
  studentIds: string[];
  genreProgrammation: "now" | "once" | "recurring";
  fuseau: string;
  recurrence: RegleRecurrence | null;
  /** ISO, ou `null` pour un envoi immédiat traité sur-le-champ. */
  prochaineEcheance: string | null;
}

export type Lecture = { ok: true; saisie: SaisieValide } | { ok: false; erreur: string };

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-9a-fA-F][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function chaine(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.trim() : "";
}

/**
 * `maintenant` est injecté : une validation qui lit l'horloge elle-même est
 * intestable, et un test qui attend 60 secondes ne prouve rien.
 */
export function lireSaisie(brut: unknown, maintenant: Date): Lecture {
  if (!brut || typeof brut !== "object") return { ok: false, erreur: "Requête illisible." };
  const c = brut as Record<string, unknown>;

  const titre = chaine(c.titre);
  if (titre.length === 0 || titre.length > LIMITE_TITRE) {
    return { ok: false, erreur: `Le titre doit faire entre 1 et ${LIMITE_TITRE} caractères.` };
  }
  const corps = chaine(c.corps);
  if (corps.length === 0 || corps.length > LIMITE_CORPS) {
    return { ok: false, erreur: `Le message doit faire entre 1 et ${LIMITE_CORPS} caractères.` };
  }

  const destination = chaine(c.destination);
  if (!estDestinationInterne(destination)) {
    // Une URL externe, un `javascript:`, une route d'administration : refus,
    // et le même refus que celui de la contrainte SQL.
    return { ok: false, erreur: "Destination refusée : seules les pages internes sont autorisées." };
  }

  const cible = (c.cible ?? {}) as Record<string, unknown>;
  const genreCible = cible.genre === "all" ? "all" : cible.genre === "students" ? "students" : null;
  if (!genreCible) return { ok: false, erreur: "Destinataires non précisés." };

  let studentIds: string[] = [];
  if (genreCible === "students") {
    const liste = Array.isArray(cible.studentIds) ? cible.studentIds : [];
    for (const id of liste) {
      if (typeof id !== "string" || !UUID.test(id)) {
        return { ok: false, erreur: "Élève invalide dans la sélection." };
      }
      if (!studentIds.includes(id)) studentIds.push(id);
    }
    if (studentIds.length === 0) return { ok: false, erreur: "Aucun élève sélectionné." };
    if (studentIds.length > LIMITE_ELEVES) return { ok: false, erreur: "Trop d'élèves sélectionnés." };
    studentIds = studentIds.slice();
  }

  const quand = (c.quand ?? {}) as Record<string, unknown>;
  const fuseau = chaine(quand.fuseau) || FUSEAU_PAR_DEFAUT;
  if (fuseau !== FUSEAU_PAR_DEFAUT) {
    return { ok: false, erreur: "Fuseau non pris en charge." };
  }

  const base: Pick<SaisieValide, "titre" | "corps" | "destination" | "genreCible" | "studentIds" | "fuseau"> =
    { titre, corps, destination, genreCible, studentIds, fuseau };

  if (quand.mode === "now") {
    return {
      ok: true,
      saisie: { ...base, genreProgrammation: "now", recurrence: null, prochaineEcheance: null },
    };
  }

  if (quand.mode === "once") {
    const date = chaine(quand.date);
    const heure = chaine(quand.heure);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) {
      return { ok: false, erreur: "Date ou heure invalide." };
    }
    const [annee, mois, jour] = date.split("-").map(Number);
    const [h, min] = heure.split(":").map(Number);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || h > 23 || min > 59) {
      return { ok: false, erreur: "Date ou heure invalide." };
    }
    const echeance = instantPourHeureLocale(fuseau, annee, mois, jour, h, min);
    if (echeance.getTime() <= maintenant.getTime()) {
      return { ok: false, erreur: "Cette échéance est déjà passée." };
    }
    return {
      ok: true,
      saisie: {
        ...base,
        genreProgrammation: "once",
        recurrence: null,
        prochaineEcheance: echeance.toISOString(),
      },
    };
  }

  if (quand.mode === "recurring") {
    const regle = lireRegle(quand.recurrence);
    if (!regle) return { ok: false, erreur: "Règle de répétition invalide." };
    return {
      ok: true,
      saisie: {
        ...base,
        genreProgrammation: "recurring",
        recurrence: regle,
        // L'échéance est calculée par l'appelant : elle dépend du calendrier
        // du fuseau, pas de la saisie.
        prochaineEcheance: null,
      },
    };
  }

  return { ok: false, erreur: "Mode d'envoi non précisé." };
}
