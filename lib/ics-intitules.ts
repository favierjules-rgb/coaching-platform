/**
 * Intitulés (`SUMMARY`) des invitations calendrier, personnalisés selon le
 * destinataire — lot 2.
 *
 * Deux destinataires, deux titres, un seul rendez-vous :
 *   - agenda du coach : « Coaching — Prénom NOM » (nom de l'ÉLÈVE) ;
 *   - agenda de l'élève : « Séance de coaching — Prénom NOM » (nom du COACH).
 *
 * Ce module ne fait QUE formater. Il ne lit aucune base et ne décide d'aucun
 * destinataire : les identités lui arrivent déjà résolues, côté serveur par
 * `getCoachProprietaireRendezVous`/`getStudentById` au service role, côté
 * navigateur par la RPC `get_my_coach_public_profile`. Aucune valeur ne vient
 * donc du navigateur de l'appelant.
 *
 * ⚠️ UN NOM QU'ON NE PEUT PAS PROUVER N'EST PAS ÉCRIT. Quand l'identité
 * manque, le titre le dit (`INTITULE_SECOURS_*`) au lieu de nommer quelqu'un
 * d'autre : c'est la règle du lot 1 appliquée à l'affichage — jamais le coach
 * principal comme substitut.
 */

export type DestinataireIcs = "coach" | "eleve";

export const PREFIXE_INTITULE_COACH = "Coaching";
export const PREFIXE_INTITULE_ELEVE = "Séance de coaching";

/** Tiret cadratin U+2014 entouré d'espaces simples, comme dans la spécification du lot. */
const SEPARATEUR = " — ";

export const INTITULE_SECOURS_COACH = `${PREFIXE_INTITULE_COACH}${SEPARATEUR}élève non identifié`;
export const INTITULE_SECOURS_ELEVE = `${PREFIXE_INTITULE_ELEVE}${SEPARATEUR}coach non identifié`;

/**
 * « Prénom NOM » : prénom tel quel, nom de famille en majuscules.
 *
 * Les deux moitiés peuvent manquer indépendamment — `students.first_name` et
 * `students.last_name` sont `NOT NULL` mais peuvent valoir la chaîne vide, et
 * `coaches.name` peut ne contenir qu'un seul mot. On rend alors ce qu'on a,
 * sans jamais compléter : une identité partielle vaut mieux qu'une identité
 * inventée.
 */
export function formaterPrenomNom(prenom: string, nom: string): string {
  const p = (prenom ?? "").trim();
  const n = (nom ?? "").trim();
  if (!p && !n) return "";
  if (!n) return p;
  if (!p) return n.toLocaleUpperCase("fr-FR");
  return `${p} ${n.toLocaleUpperCase("fr-FR")}`;
}

/** Identité de l'élève, à partir des deux colonnes dédiées de `students`. */
export function formaterIdentiteEleve(firstName: string, lastName: string): string {
  return formaterPrenomNom(firstName, lastName);
}

/**
 * Découpage de `coaches.name` — colonne UNIQUE : la table n'a ni `first_name`
 * ni `last_name` (relevé dans types/supabase.ts, `name text NOT NULL`).
 *
 * ⚠️ CONVENTION REPRISE, PAS INVENTÉE. C'est celle que la migration
 * 20260726220000 applique déjà dans `get_my_coach_public_profile()` :
 * découpage au PREMIER espace, le premier élément est le prénom, tout le
 * reste est le nom. « Jean-Pierre De La Tour » donne donc « Jean-Pierre » +
 * « DE LA TOUR ».
 *
 * ⚠️ DEUX ÉCARTS MESURÉS AVEC LE SQL, tous deux assumés et testés :
 *   - le SQL ne coupe pas les espaces de tête : pour « ␣Jules FAVIER » il rend
 *     un prénom vide. Ici la chaîne est `trim()` d'abord. C'est une
 *     normalisation, pas un autre point de découpe.
 *   - pour un nom d'UN SEUL mot, le SQL rend le mot DEUX FOIS (`strpos` vaut
 *     0, donc `substr(name, 1)` rend la chaîne entière) : « Jules » ressort en
 *     first_name = last_name = « Jules », et `getMyCoachPublicInfo` les
 *     recolle en « Jules Jules ». Ici le nom est vide et l'intitulé rend
 *     « Jules ». C'est la convention ÉNONCÉE (« reste = nom ») plutôt que
 *     l'accident du `strpos`. Le défaut SQL est signalé, pas corrigé : ce lot
 *     ne touche aucune migration.
 */
export function decouperNomCoach(nomComplet: string): { prenom: string; nom: string } {
  const complet = (nomComplet ?? "").trim();
  if (!complet) return { prenom: "", nom: "" };
  const premierEspace = complet.indexOf(" ");
  if (premierEspace < 0) return { prenom: complet, nom: "" };
  return { prenom: complet.slice(0, premierEspace), nom: complet.slice(premierEspace + 1).trim() };
}

/** Identité du coach, à partir de la colonne unique `coaches.name`. */
export function formaterIdentiteCoach(nomComplet: string): string {
  const { prenom, nom } = decouperNomCoach(nomComplet);
  return formaterPrenomNom(prenom, nom);
}

/**
 * Intitulé de l'invitation pour UN destinataire.
 *
 * L'agenda du coach porte le nom de l'élève, celui de l'élève le nom du
 * coach : chacun voit l'AUTRE partie, jamais la sienne. Une identité absente
 * fait basculer sur l'intitulé de secours du même destinataire.
 */
export function construireIntituleIcs(entree: {
  destinataire: DestinataireIcs;
  identiteEleve: string;
  identiteCoach: string;
}): string {
  switch (entree.destinataire) {
    case "coach": {
      const eleve = (entree.identiteEleve ?? "").trim();
      return eleve ? `${PREFIXE_INTITULE_COACH}${SEPARATEUR}${eleve}` : INTITULE_SECOURS_COACH;
    }
    case "eleve": {
      const coach = (entree.identiteCoach ?? "").trim();
      return coach ? `${PREFIXE_INTITULE_ELEVE}${SEPARATEUR}${coach}` : INTITULE_SECOURS_ELEVE;
    }
    default: {
      // Exhaustivité confiée au compilateur : un troisième destinataire ne
      // compile pas tant qu'il n'a pas son intitulé.
      const jamais: never = entree.destinataire;
      throw new Error(`Destinataire d'invitation inconnu : ${String(jamais)}`);
    }
  }
}
