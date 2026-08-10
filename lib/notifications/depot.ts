import "server-only";

/**
 * L'ACCÈS AUX QUATRE TABLES DE CAMPAGNES — TYPÉ ICI, ET NULLE PART AILLEURS.
 *
 * Même raison que `lib/push/depot-abonnements.ts` : `types/supabase.ts` est
 * maintenu à la main et incomplet ; y ajouter des tables rend TypeScript
 * assez précis pour casser les routes qui visent les tables absentes. Le
 * typage reste donc CONTENU dans ce module, avec une seule conversion
 * explicite, au lieu de déstabiliser le fichier partagé.
 *
 * Aucun secret d'abonnement ne transite ici : les envois référencent un
 * `subscription_id`, jamais un endpoint ni une clé.
 */

export type GenreCible = "all" | "students";
export type GenreProgrammation = "now" | "once" | "recurring";
export type StatutCampagne = "programmee" | "envoyee" | "partielle" | "echouee" | "annulee";
export type StatutOccurrence = "en_attente" | "en_cours" | "envoyee" | "partielle" | "echouee";
export type StatutEnvoi = "en_attente" | "en_cours" | "envoyee" | "echouee" | "interrompue";

export interface Campagne {
  id: string;
  createdBy: string | null;
  titre: string;
  corps: string;
  destination: string;
  genreCible: GenreCible;
  genreProgrammation: GenreProgrammation;
  fuseau: string;
  recurrence: unknown;
  prochaineEcheance: string | null;
  active: boolean;
  statut: StatutCampagne;
  creeeLe: string;
}

export interface Occurrence {
  id: string;
  campaignId: string;
  echeance: string;
  statut: StatutOccurrence;
  termineeLe: string | null;
}

export interface Envoi {
  id: string;
  occurrenceId: string;
  userId: string;
  subscriptionId: string;
  statut: StatutEnvoi;
  codeErreur: string | null;
}

interface Reponse {
  data: unknown;
  error: unknown;
}

/** Le strict minimum de l'API Supabase réellement utilisé ci-dessous. */
interface Chaine {
  select: (colonnes?: string) => Chaine;
  insert: (valeurs: unknown) => Chaine;
  update: (valeurs: unknown) => Chaine;
  delete: () => Chaine;
  eq: (colonne: string, valeur: unknown) => Chaine;
  in: (colonne: string, valeurs: unknown[]) => Chaine;
  is: (colonne: string, valeur: null) => Chaine;
  lte: (colonne: string, valeur: unknown) => Chaine;
  not: (colonne: string, operateur: string, valeur: unknown) => Chaine;
  order: (colonne: string, options?: { ascending?: boolean }) => Chaine;
  maybeSingle: () => Promise<Reponse>;
  then: <R>(suite: (reponse: Reponse) => R) => Promise<R>;
}

interface ClientMinimal {
  from: (table: string) => Chaine;
}

function tables(client: unknown): ClientMinimal {
  return client as ClientMinimal;
}

function lignes(reponse: Reponse): Record<string, unknown>[] {
  if (reponse.error || !reponse.data) return [];
  return reponse.data as Record<string, unknown>[];
}

const texte = (v: unknown): string => (typeof v === "string" ? v : "");
const texteOuNul = (v: unknown): string | null => (typeof v === "string" ? v : null);

function versCampagne(l: Record<string, unknown>): Campagne {
  return {
    id: texte(l.id),
    createdBy: texteOuNul(l.created_by),
    titre: texte(l.title),
    corps: texte(l.body),
    destination: texte(l.destination),
    genreCible: texte(l.target_kind) as GenreCible,
    genreProgrammation: texte(l.schedule_kind) as GenreProgrammation,
    fuseau: texte(l.timezone),
    recurrence: l.recurrence ?? null,
    prochaineEcheance: texteOuNul(l.next_run_at),
    active: l.active === true,
    statut: texte(l.status) as StatutCampagne,
    creeeLe: texte(l.created_at),
  };
}

const COLONNES_CAMPAGNE =
  "id, created_by, title, body, destination, target_kind, schedule_kind, timezone, recurrence, next_run_at, active, status, created_at";

/* ════════════════════════════ CAMPAGNES ════════════════════════════ */

export interface NouvelleCampagne {
  createdBy: string;
  titre: string;
  corps: string;
  destination: string;
  genreCible: GenreCible;
  genreProgrammation: GenreProgrammation;
  fuseau: string;
  recurrence: unknown;
  prochaineEcheance: string | null;
}

export async function creerCampagne(client: unknown, c: NouvelleCampagne): Promise<Campagne | null> {
  const reponse = await tables(client)
    .from("notification_campaigns")
    .insert({
      created_by: c.createdBy,
      title: c.titre,
      body: c.corps,
      destination: c.destination,
      target_kind: c.genreCible,
      schedule_kind: c.genreProgrammation,
      timezone: c.fuseau,
      recurrence: c.recurrence,
      next_run_at: c.prochaineEcheance,
    })
    .select(COLONNES_CAMPAGNE)
    .maybeSingle();
  if (reponse.error || !reponse.data) return null;
  return versCampagne(reponse.data as Record<string, unknown>);
}

export async function lireCampagne(client: unknown, id: string): Promise<Campagne | null> {
  const reponse = await tables(client)
    .from("notification_campaigns")
    .select(COLONNES_CAMPAGNE)
    .eq("id", id)
    .maybeSingle();
  if (reponse.error || !reponse.data) return null;
  return versCampagne(reponse.data as Record<string, unknown>);
}

export async function listerCampagnes(client: unknown): Promise<Campagne[]> {
  const reponse = await tables(client)
    .from("notification_campaigns")
    .select(COLONNES_CAMPAGNE)
    .order("created_at", { ascending: false });
  return lignes(reponse).map(versCampagne);
}

/** Les campagnes dont l'échéance est atteinte. Le planificateur ne lit rien d'autre. */
export async function campagnesAEcheance(client: unknown, maintenant: string): Promise<Campagne[]> {
  const reponse = await tables(client)
    .from("notification_campaigns")
    .select(COLONNES_CAMPAGNE)
    .eq("active", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", maintenant)
    .order("next_run_at", { ascending: true });
  return lignes(reponse).map(versCampagne);
}

export interface ModificationCampagne {
  titre?: string;
  corps?: string;
  destination?: string;
  genreCible?: GenreCible;
  recurrence?: unknown;
  prochaineEcheance?: string | null;
  active?: boolean;
  statut?: StatutCampagne;
}

export async function majCampagne(
  client: unknown,
  id: string,
  patch: ModificationCampagne,
): Promise<boolean> {
  const valeurs: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.titre !== undefined) valeurs.title = patch.titre;
  if (patch.corps !== undefined) valeurs.body = patch.corps;
  if (patch.destination !== undefined) valeurs.destination = patch.destination;
  if (patch.genreCible !== undefined) valeurs.target_kind = patch.genreCible;
  if (patch.recurrence !== undefined) valeurs.recurrence = patch.recurrence;
  if (patch.prochaineEcheance !== undefined) valeurs.next_run_at = patch.prochaineEcheance;
  if (patch.active !== undefined) valeurs.active = patch.active;
  if (patch.statut !== undefined) valeurs.status = patch.statut;

  const reponse = await tables(client).from("notification_campaigns").update(valeurs).eq("id", id);
  return !reponse.error;
}

/* ════════════════════════════ CIBLES ════════════════════════════ */

export async function cibles(client: unknown, campaignId: string): Promise<string[]> {
  const reponse = await tables(client)
    .from("notification_campaign_targets")
    .select("student_id")
    .eq("campaign_id", campaignId);
  return lignes(reponse).map((l) => texte(l.student_id));
}

export async function remplacerCibles(
  client: unknown,
  campaignId: string,
  studentIds: string[],
): Promise<boolean> {
  await tables(client).from("notification_campaign_targets").delete().eq("campaign_id", campaignId);
  if (studentIds.length === 0) return true;
  const reponse = await tables(client)
    .from("notification_campaign_targets")
    .insert(studentIds.map((student_id) => ({ campaign_id: campaignId, student_id })));
  return !reponse.error;
}

/**
 * Les COMPTES visés par une campagne — jamais les fiches élèves.
 *
 * Un élève sans compte d'authentification (`user_id` nul) n'est joignable
 * par aucun canal : il est écarté ici, silencieusement et à dessein.
 */
export async function comptesVises(client: unknown, campagne: Campagne): Promise<string[]> {
  if (campagne.genreCible === "all") {
    const reponse = await tables(client).from("students").select("user_id").not("user_id", "is", null);
    return lignes(reponse).map((l) => texte(l.user_id)).filter(Boolean);
  }
  const ids = await cibles(client, campagne.id);
  if (ids.length === 0) return [];
  const reponse = await tables(client)
    .from("students")
    .select("user_id")
    .in("id", ids)
    .not("user_id", "is", null);
  return lignes(reponse).map((l) => texte(l.user_id)).filter(Boolean);
}

/* ════════════════════════════ OCCURRENCES ════════════════════════════ */

/**
 * Crée l'occurrence de cette échéance, ou rend celle qui existe déjà.
 *
 * `unique (campaign_id, scheduled_for)` fait tout le travail : deux
 * planificateurs qui se croisent produisent une seule occurrence, et le
 * second reçoit une erreur de conflit qu'on traite comme « elle existe ».
 */
export async function ouvrirOccurrence(
  client: unknown,
  campaignId: string,
  echeance: string,
): Promise<Occurrence | null> {
  const creation = await tables(client)
    .from("notification_occurrences")
    .insert({ campaign_id: campaignId, scheduled_for: echeance })
    .select("id, campaign_id, scheduled_for, status, finished_at")
    .maybeSingle();

  if (!creation.error && creation.data) {
    const l = creation.data as Record<string, unknown>;
    return {
      id: texte(l.id), campaignId: texte(l.campaign_id), echeance: texte(l.scheduled_for),
      statut: texte(l.status) as StatutOccurrence, termineeLe: texteOuNul(l.finished_at),
    };
  }

  const existante = await tables(client)
    .from("notification_occurrences")
    .select("id, campaign_id, scheduled_for, status, finished_at")
    .eq("campaign_id", campaignId)
    .eq("scheduled_for", echeance)
    .maybeSingle();
  if (existante.error || !existante.data) return null;
  const l = existante.data as Record<string, unknown>;
  return {
    id: texte(l.id), campaignId: texte(l.campaign_id), echeance: texte(l.scheduled_for),
    statut: texte(l.status) as StatutOccurrence, termineeLe: texteOuNul(l.finished_at),
  };
}

/**
 * RÉSERVE l'occurrence — le seul point où deux planificateurs simultanés
 * pourraient dédoubler un envoi.
 *
 * L'`update` est conditionné à `status = 'en_attente'` : la base arbitre, et
 * un seul des deux voit une ligne modifiée. Celui qui n'en voit aucune
 * abandonne cette occurrence. Aucune lecture préalable ne peut remplacer
 * cette condition — entre le `select` et l'`update`, l'autre serait passé.
 */
export async function reserverOccurrence(client: unknown, occurrenceId: string): Promise<boolean> {
  const reponse = await tables(client)
    .from("notification_occurrences")
    .update({ status: "en_cours", claimed_at: new Date().toISOString() })
    .eq("id", occurrenceId)
    .eq("status", "en_attente")
    .select("id");
  return lignes(reponse).length === 1;
}

export async function terminerOccurrence(
  client: unknown,
  occurrenceId: string,
  statut: StatutOccurrence,
): Promise<void> {
  await tables(client)
    .from("notification_occurrences")
    .update({ status: statut, finished_at: new Date().toISOString() })
    .eq("id", occurrenceId);
}

export async function occurrences(client: unknown, campaignIds: string[]): Promise<Occurrence[]> {
  if (campaignIds.length === 0) return [];
  const reponse = await tables(client)
    .from("notification_occurrences")
    .select("id, campaign_id, scheduled_for, status, finished_at")
    .in("campaign_id", campaignIds)
    .order("scheduled_for", { ascending: false });
  return lignes(reponse).map((l) => ({
    id: texte(l.id), campaignId: texte(l.campaign_id), echeance: texte(l.scheduled_for),
    statut: texte(l.status) as StatutOccurrence, termineeLe: texteOuNul(l.finished_at),
  }));
}

/* ════════════════════════════ ENVOIS ════════════════════════════ */

/**
 * Ouvre l'envoi pour CET appareil, ou rend `null` s'il existe déjà.
 *
 * `unique (occurrence_id, subscription_id)` : un appareil n'est jamais servi
 * deux fois pour la même occurrence, et deux appareils du même élève le sont
 * chacun une fois.
 */
export async function ouvrirEnvoi(
  client: unknown,
  occurrenceId: string,
  userId: string,
  subscriptionId: string,
): Promise<string | null> {
  const reponse = await tables(client)
    .from("notification_deliveries")
    .insert({
      occurrence_id: occurrenceId,
      user_id: userId,
      subscription_id: subscriptionId,
      status: "en_cours",
      attempted_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (reponse.error || !reponse.data) return null;
  return texte((reponse.data as Record<string, unknown>).id);
}

export async function conclureEnvoi(
  client: unknown,
  envoiId: string,
  statut: StatutEnvoi,
  codeErreur: string | null,
): Promise<void> {
  await tables(client)
    .from("notification_deliveries")
    .update({
      status: statut,
      error_code: codeErreur,
      sent_at: statut === "envoyee" ? new Date().toISOString() : null,
    })
    .eq("id", envoiId);
}

export async function envois(client: unknown, occurrenceIds: string[]): Promise<Envoi[]> {
  if (occurrenceIds.length === 0) return [];
  const reponse = await tables(client)
    .from("notification_deliveries")
    .select("id, occurrence_id, user_id, subscription_id, status, error_code")
    .in("occurrence_id", occurrenceIds);
  return lignes(reponse).map((l) => ({
    id: texte(l.id), occurrenceId: texte(l.occurrence_id), userId: texte(l.user_id),
    subscriptionId: texte(l.subscription_id), statut: texte(l.status) as StatutEnvoi,
    codeErreur: texteOuNul(l.error_code),
  }));
}

/* ════════════════════════════ APPAREILS JOIGNABLES ════════════════════════════ */

export interface AppareilJoignable {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Les appareils vivants de PLUSIEURS comptes, en une requête.
 *
 * Volontairement ici, et non dans `lib/push/depot-abonnements.ts` : le socle
 * Push est validé sur iPhone et ne doit plus bouger. Cette lecture-ci
 * appartient au centre de notifications.
 */
export async function appareilsJoignables(
  client: unknown,
  userIds: string[],
): Promise<AppareilJoignable[]> {
  if (userIds.length === 0) return [];
  const reponse = await tables(client)
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .is("disabled_at", null);
  return lignes(reponse).map((l) => ({
    id: texte(l.id), userId: texte(l.user_id), endpoint: texte(l.endpoint),
    p256dh: texte(l.p256dh), auth: texte(l.auth),
  }));
}

/* ════════════════════════════ REPRISE APRÈS INTERRUPTION ════════════════════════════ */

/**
 * AT-MOST-ONCE, ET SA CONSÉQUENCE ASSUMÉE.
 *
 * Un envoi resté `en_cours` décrit exactement la situation décrite au
 * contrat : le push est peut-être parti, le serveur est tombé avant de
 * pouvoir l'écrire. On ne réessaie pas — on le nomme `interrompue`, une
 * fois pour toutes, pour que l'historique dise la vérité plutôt que de
 * prétendre à un succès ou à un échec qu'on ignore.
 *
 * Les occurrences correspondantes deviennent `echouee` : un état TERMINAL,
 * donc jamais reprise par `reserverOccurrence` qui n'accepte que
 * `en_attente`. C'est ce qui garantit qu'on n'enverra pas deux fois.
 */
export async function balayerInterrompus(client: unknown, avant: string): Promise<number> {
  const envoisMorts = await tables(client)
    .from("notification_deliveries")
    .update({ status: "interrompue", error_code: "interruption" })
    .eq("status", "en_cours")
    .lte("attempted_at", avant)
    .select("id");
  const nombre = lignes(envoisMorts).length;

  await tables(client)
    .from("notification_occurrences")
    .update({ status: "echouee", finished_at: new Date().toISOString() })
    .eq("status", "en_cours")
    .lte("claimed_at", avant);

  return nombre;
}
