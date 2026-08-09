import { currentDate } from "@/lib/clock";

/**
 * « LA SÉANCE DU JOUR » — et cette fois, vraiment celle du jour.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Le dépôt possède déjà `getHighlightedScheduleDay` (`data/student.ts`).
 * Elle ne dit PAS « la séance d'aujourd'hui » : elle dit « la séance à
 * mettre en avant », et quand aucune séance n'est prévue aujourd'hui, elle
 * rend LA PREMIÈRE DE LA SEMAINE. C'est très bien pour un tableau de bord
 * qui invite à s'entraîner. Ce serait désastreux ici.
 *
 * Le scénario qu'il faut avoir en tête : l'élève prépare son application
 * lundi, s'entraîne, ferme tout. Mardi matin, dans le métro, sans réseau,
 * il ouvre SETH. Avec le repli du tableau de bord, il verrait la séance de
 * lundi présentée comme celle du jour, la remplirait, et enverrait un
 * second retour sur une séance déjà faite. Rien dans l'écran ne le
 * préviendrait.
 *
 * Ici, il n'y a donc AUCUN repli. Une journée sans séance prévue est une
 * journée sans séance du jour : les menus restent, l'écran dit qu'il n'y a
 * rien à faire aujourd'hui, et c'est exact.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA DATE MÉTIER — CE QUE LE PROJET FAIT DÉJÀ, RELEVÉ ET NON DÉCIDÉ ICI
 * ════════════════════════════════════════════════════════════════════════
 * Audit du 09/08/2026, trois constats :
 *
 *   • `currentDate()` (`lib/clock.ts`) rend `new Date()`. Son commentaire
 *     mentionne « Europe/Paris pour cette application », mais RIEN dans le
 *     code ne fixe ce fuseau : c'est celui du runtime. Sur le chemin de la
 *     séance, tout est `"use client"` — donc le fuseau de L'APPAREIL ;
 *   • `buildScheduleForWeek` (`lib/training-schedule.ts:71`) calcule son
 *     `isToday` avec `getDay()`, méthode locale ;
 *   • `sanitizePerformedAt` (`lib/workout-history.ts:185`) retombe, LUI, sur
 *     `toISOString().slice(0, 10)` — de l'UTC, calculé sur le serveur.
 *
 * La convention réellement en vigueur pour « quel jour sommes-nous » est
 * donc le fuseau du navigateur, et c'est elle qu'on suit ici. Fixer
 * Europe/Paris serait inventer une règle que le projet n'applique nulle
 * part, et créer deux « aujourd'hui » différents dans la même application :
 * la séance mise en avant par le planning et celle du snapshot pourraient
 * alors désigner deux jours distincts.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS `toISOString()`
 * ────────────────────────────────────────────────────────────────────────
 * Non pas « à 23 h 30 en France » — la formulation serait trop étroite. Le
 * vrai problème est que le jour LOCAL et le jour UTC ne coïncident pas
 * pendant une partie de chaque journée, et le décalage joue dans les deux
 * sens : à l'est de Greenwich, les premières heures du jour local sont
 * encore la veille en UTC ; à l'ouest, les dernières heures sont déjà le
 * lendemain. Dans les deux cas, une séance se verrait attribuer un autre
 * jour que celui du planning qui l'a produite. Le format `YYYY-MM-DD` est
 * donc composé à partir des accesseurs LOCAUX, sans conversion.
 *
 * Cet écart existe aussi côté serveur, où `sanitizePerformedAt` calcule en
 * UTC. Il cesse d'avoir prise dès que le client envoie `performedAt`
 * explicitement — ce que fait désormais le brouillon, avec la date figée de
 * la séance.
 */

/** Date métier `YYYY-MM-DD`, heure locale de l'appareil. */
export function dateMetier(reference: Date = currentDate()): string {
  const annee = reference.getFullYear();
  const mois = String(reference.getMonth() + 1).padStart(2, "0");
  const jour = String(reference.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

/** Une journée du planning hebdomadaire, réduite à ce qui nous intéresse. */
export interface JourPlanning {
  isToday?: boolean;
  sessionId?: string | null;
}

/**
 * L'identifiant de la séance RÉELLEMENT prévue aujourd'hui, ou `null`.
 *
 * Deux conditions, toutes les deux obligatoires : la journée doit être
 * marquée comme aujourd'hui, ET porter une séance. Aucun repli sur un autre
 * jour, dans aucun sens.
 */
export function seanceReellementDuJour(planning: readonly JourPlanning[]): string | null {
  for (const jour of planning) {
    if (jour.isToday === true && typeof jour.sessionId === "string" && jour.sessionId !== "") {
      return jour.sessionId;
    }
  }
  return null;
}

/**
 * Ce snapshot peut-il être présenté comme la séance D'AUJOURD'HUI ?
 *
 * Appelé à CHAQUE ouverture, y compris hors ligne, y compris sur une
 * application restée ouverte pendant la nuit. Le passage de minuit ne
 * déclenche aucun événement : sans cette vérification à la lecture, le
 * snapshot d'hier resterait affiché comme celui du jour jusqu'au prochain
 * rechargement avec réseau.
 *
 * Le snapshot n'est PAS supprimé pour autant — il n'est simplement pas
 * rendu. Une opération en attente qui s'y rattache doit survivre au
 * changement de date jusqu'à sa synchronisation (règle de purge locale).
 */
export function snapshotEstDuJour(
  snapshot: { businessDate: string } | null,
  aujourdhui: string = dateMetier(),
): boolean {
  return snapshot !== null && snapshot.businessDate === aujourdhui;
}
