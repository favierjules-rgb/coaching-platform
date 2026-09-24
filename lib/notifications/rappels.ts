import "server-only";

import { jourDeLaSemaineFr, rappelEntrainementDu, rappelNutritionDu } from "@/lib/rappels-automatiques";
import { getAssignedProgramsForStudent } from "@/lib/supabase/programs";
import { computeCurrentWeekNumber } from "@/lib/training-schedule";
import type { EleveVise, GenreRappelAuto } from "@/lib/notifications/depot";
import type { AdminStudent } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * QUI DOIT RECEVOIR UN RAPPEL AUTOMATIQUE, CE MATIN OU CE SOIR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE RÔLE DE CE MODULE
 * ════════════════════════════════════════════════════════════════════════
 * Les campagnes système visent les élèves qui ont ACTIVÉ le rappel (leur
 * appartenance à `notification_campaign_targets` EST le réglage). Ce module
 * retire de cette liste ceux pour qui la condition du jour n'est pas remplie —
 * et il ne fait que ça : il ne planifie rien, n'écrit rien, n'envoie rien.
 *
 * ⚠️ IL ÉCHOUE FERMÉ. Une lecture qui ne répond pas retire l'élève de la liste
 * au lieu de le garder : un rappel manquant est un désagrément, un rappel faux
 * (« ta séance t'attend » alors qu'elle est faite, ou qu'il n'y en a pas) est
 * la raison pour laquelle on coupe les notifications d'une application.
 *
 * ⚠️ AUCUNE RÈGLE N'EST ÉCRITE ICI. Les deux conditions vivent dans
 * lib/rappels-automatiques.ts, pur et testé seul ; la semaine du programme
 * vient de `computeCurrentWeekNumber`, INCHANGÉ — la seule autorité sur « quelle
 * semaine du programme on est ».
 */

type ClientType = SupabaseClient<Database>;

interface Reponse {
  data: unknown;
  error: unknown;
}

interface Chaine {
  select: (colonnes?: string) => Chaine;
  eq: (colonne: string, valeur: unknown) => Chaine;
  in: (colonne: string, valeurs: unknown[]) => Chaine;
  then: <R>(suite: (reponse: Reponse) => R) => Promise<R>;
}

interface ClientMinimal {
  from: (table: string) => Chaine;
}

const texte = (v: unknown): string => (typeof v === "string" ? v : "");

function lignes(reponse: Reponse): Record<string, unknown>[] {
  if (reponse.error || !reponse.data) return [];
  return reponse.data as Record<string, unknown>[];
}

/**
 * La date de début de suivi de chaque élève.
 *
 * ⚠️ POURQUOI ON LA LIT. `ancreDeSemaine` retombe sur `students.start_date`
 * quand l'affectation n'a pas de date de début — 14 affectations étaient dans ce
 * cas au moment du lot « date de début de programme ». Passer `null` ferait
 * répondre « semaine 1 » pour ces élèves, donc rappeler la séance du lundi de la
 * semaine 1 à quelqu'un qui en est à la semaine 6.
 */
async function datesDeSuivi(admin: unknown, studentIds: readonly string[]): Promise<Map<string, string>> {
  const reponse = await (admin as ClientMinimal)
    .from("students")
    .select("id, start_date")
    .in("id", [...studentIds]);
  const parEleve = new Map<string, string>();
  for (const l of lignes(reponse)) {
    const id = texte(l.id);
    const debut = texte(l.start_date);
    if (id && debut) parEleve.set(id, debut);
  }
  return parEleve;
}

/**
 * Les séances que cet élève a VALIDÉES, parmi une liste de séances.
 *
 * On ne lit que ce qui sert : la condition ne porte que sur les séances du jour,
 * donc la liste envoyée est minuscule (une ou deux séances).
 */
async function seancesValidees(
  admin: unknown,
  studentId: string,
  sessionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (sessionIds.length === 0) return new Set();
  const reponse = await (admin as ClientMinimal)
    .from("workout_feedback")
    .select("session_id")
    .eq("student_id", studentId)
    .eq("completed", true)
    .in("session_id", [...sessionIds]);
  const validees = new Set<string>();
  for (const l of lignes(reponse)) {
    const id = texte(l.session_id);
    if (id) validees.add(id);
  }
  return validees;
}

/**
 * Le rappel d'entraînement est-il justifié pour cet élève, à cette date ?
 *
 * Séance prévue aujourd'hui + non terminée. Les programmes NON ACTIFS sont
 * écartés : `computeCurrentWeekNumber` rend « semaine 1 » pour un brouillon ou
 * un archivé, ce qui ferait rappeler la première semaine d'un programme que
 * personne ne suit.
 */
async function doitRappelerEntrainement(
  admin: unknown,
  eleve: EleveVise,
  dateDeSuivi: string | null,
  maintenant: Date,
): Promise<boolean> {
  const programmes = await getAssignedProgramsForStudent(admin as ClientType, eleve.studentId);
  const actifs = programmes.filter((p) => p.status === "actif");
  if (actifs.length === 0) return false;

  /*
   * ⚠️ UN ÉLÈVE RÉDUIT À CE QUE `ancreDeSemaine` LIT.
   *
   * `computeCurrentWeekNumber` prend un `AdminStudent`, mais n'en lit qu'UN
   * champ : `startDate` (voir `ancreDeSemaine`). Construire un profil complet
   * depuis le cron imposerait de lire une fiche entière par élève pour une seule
   * date. La conversion est explicite et nommée, et
   * `scripts/tests/rappels-automatiques.mts` vérifie que ce chemin rend la même
   * semaine que l'appel complet — si la fonction se mettait à lire un autre
   * champ, ce test le dirait.
   */
  const eleveAncre = { startDate: dateDeSuivi ?? "" } as unknown as AdminStudent;
  const jour = jourDeLaSemaineFr(maintenant);

  for (const programme of actifs) {
    const semaineCalendaire = computeCurrentWeekNumber(programme, eleveAncre, maintenant);
    const seances = programme.sessions.map((s) => ({
      id: s.id,
      day: s.day,
      weekNumber: s.weekNumber,
      isRestDay: s.isRestDay,
    }));
    const duJour = seances.filter(
      (s) => s.weekNumber === semaineCalendaire && s.day === jour && !s.isRestDay,
    );
    if (duJour.length === 0) continue;

    const validees = await seancesValidees(admin, eleve.studentId, duJour.map((s) => s.id));
    if (rappelEntrainementDu({ seances, semaineCalendaire, jour, seancesTerminees: validees })) {
      return true;
    }
  }
  return false;
}

/**
 * Les élèves dont la journée alimentaire est INCOMPLÈTE à cette date.
 *
 * Une seule requête pour tout le monde : `planned_meals` porte `student_id` et
 * `planned_on`, donc la question se pose en un seul aller-retour.
 *
 * ⚠️ AUCUN REPAS PLANIFIÉ ⇒ AUCUN RAPPEL. L'élève sans plan alimentaire n'a
 * rien à compléter ; il n'apparaît simplement pas dans le résultat.
 */
async function elevesJourneeIncomplete(
  admin: unknown,
  studentIds: readonly string[],
  dateIso: string,
): Promise<Set<string>> {
  const incomplets = new Set<string>();
  if (studentIds.length === 0) return incomplets;

  const reponse = await (admin as ClientMinimal)
    .from("planned_meals")
    .select("id, student_id, consumed_meal_id")
    .eq("planned_on", dateIso)
    .in("student_id", [...studentIds]);

  const parEleve = new Map<string, { id: string; consomme: boolean }[]>();
  for (const l of lignes(reponse)) {
    const eleve = texte(l.student_id);
    if (!eleve) continue;
    const repas = { id: texte(l.id), consomme: texte(l.consumed_meal_id) !== "" };
    const deja = parEleve.get(eleve);
    if (deja) deja.push(repas);
    else parEleve.set(eleve, [repas]);
  }

  for (const [eleve, repas] of parEleve) {
    if (rappelNutritionDu({ repas })) incomplets.add(eleve);
  }
  return incomplets;
}

/**
 * La liste des élèves à avertir, filtrée par la condition du genre.
 *
 * `maintenant` est l'ÉCHÉANCE traitée, pas l'instant du traitement : un
 * planificateur en retard de trois minutes doit juger la journée visée.
 */
export async function elevesAAvertir(
  admin: unknown,
  genre: GenreRappelAuto,
  eleves: readonly EleveVise[],
  maintenant: Date,
): Promise<EleveVise[]> {
  if (eleves.length === 0) return [];

  if (genre === "nutrition") {
    const dateIso = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(
      maintenant.getDate(),
    ).padStart(2, "0")}`;
    const incomplets = await elevesJourneeIncomplete(
      admin,
      eleves.map((e) => e.studentId),
      dateIso,
    );
    return eleves.filter((e) => incomplets.has(e.studentId));
  }

  const dates = await datesDeSuivi(
    admin,
    eleves.map((e) => e.studentId),
  );
  const retenus: EleveVise[] = [];
  for (const eleve of eleves) {
    if (await doitRappelerEntrainement(admin, eleve, dates.get(eleve.studentId) ?? null, maintenant)) {
      retenus.push(eleve);
    }
  }
  return retenus;
}
