import { GENRES_RAPPEL, type GenreRappel } from "@/lib/rappels-automatiques";

/**
 * LES RAPPELS AUTOMATIQUES D'UN ÉLÈVE — lus et écrits par le coach.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE RÉGLAGE N'A PAS DE TABLE À LUI, ET C'EST EXPRÈS
 * ════════════════════════════════════════════════════════════════════════
 * « Rappels entraînement activés pour Bruno » se dit déjà avec une ligne de
 * `notification_campaign_targets` : `(campagne système, Bruno)`. ON = la ligne
 * existe, OFF = elle n'existe pas. Créer une table de préférences en parallèle
 * aurait donné deux réponses possibles à la même question — et un jour deux
 * ensembles d'élèves différents, l'un affiché, l'autre servi.
 *
 * ⚠️ TYPAGE CONTENU ICI, comme lib/notifications/depot.ts : `types/supabase.ts`
 * ne connaît pas les tables de notifications. Une seule conversion explicite,
 * dans ce fichier, plutôt qu'un fichier partagé déstabilisé.
 *
 * ⚠️ PAS DE `server-only` : c'est la fiche élève, composant client, qui règle
 * les rappels. La garde est la RLS `notification_campaign_targets` (staff
 * uniquement), pas ce fichier.
 */

interface Reponse {
  data: unknown;
  error: unknown;
}

interface Chaine {
  select: (colonnes?: string) => Chaine;
  insert: (valeurs: unknown) => Chaine;
  delete: () => Chaine;
  eq: (colonne: string, valeur: unknown) => Chaine;
  in: (colonne: string, valeurs: unknown[]) => Chaine;
  not: (colonne: string, operateur: string, valeur: unknown) => Chaine;
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

export type RappelsDeLEleve = Readonly<Record<GenreRappel, boolean>>;

export interface EtatRappels {
  readonly actifs: RappelsDeLEleve;
  /**
   * `false` quand les campagnes système n'existent pas encore (migration non
   * appliquée) ou que la lecture a échoué.
   *
   * ⚠️ L'INTERFACE DOIT LE DIRE PLUTÔT QUE D'AFFICHER « OFF ». Deux
   * interrupteurs éteints sur une base où les rails n'existent pas invitent le
   * coach à cliquer, et le clic échouerait sans rien expliquer.
   */
  readonly disponible: boolean;
}

const AUCUN: RappelsDeLEleve = { entrainement: false, nutrition: false };

/** `genre` → identifiant de la campagne système, pour les genres qui existent. */
export async function campagnesDeRappel(client: unknown): Promise<Map<GenreRappel, string>> {
  const reponse = await (client as ClientMinimal)
    .from("notification_campaigns")
    .select("id, rappel_auto")
    .not("rappel_auto", "is", null);

  const parGenre = new Map<GenreRappel, string>();
  for (const l of lignes(reponse)) {
    const genre = texte(l.rappel_auto);
    const id = texte(l.id);
    if (id && (GENRES_RAPPEL as readonly string[]).includes(genre)) {
      parGenre.set(genre as GenreRappel, id);
    }
  }
  return parGenre;
}

/** L'état des deux rappels pour cet élève. */
export async function lireRappelsEleve(client: unknown, studentId: string): Promise<EtatRappels> {
  const campagnes = await campagnesDeRappel(client);
  if (campagnes.size === 0) return { actifs: AUCUN, disponible: false };

  const parId = new Map<string, GenreRappel>();
  for (const [genre, id] of campagnes) parId.set(id, genre);

  const reponse = await (client as ClientMinimal)
    .from("notification_campaign_targets")
    .select("campaign_id")
    .eq("student_id", studentId)
    .in("campaign_id", [...parId.keys()]);

  if (reponse.error) return { actifs: AUCUN, disponible: false };

  const actifs: Record<GenreRappel, boolean> = { entrainement: false, nutrition: false };
  for (const l of lignes(reponse)) {
    const genre = parId.get(texte(l.campaign_id));
    if (genre) actifs[genre] = true;
  }
  return { actifs, disponible: true };
}

/**
 * Active ou coupe un rappel pour cet élève.
 *
 * ⚠️ AUCUNE ÉCRITURE SUR LA CAMPAGNE ELLE-MÊME. On n'ajoute ou ne retire qu'une
 * ligne de ciblage : l'heure, le texte et la récurrence du rail restent hors
 * d'atteinte depuis la fiche d'un élève. Couper un rappel pour Bruno ne peut pas
 * couper celui d'Alice.
 */
export async function definirRappelEleve(
  client: unknown,
  studentId: string,
  genre: GenreRappel,
  actif: boolean,
): Promise<boolean> {
  const campagnes = await campagnesDeRappel(client);
  const campaignId = campagnes.get(genre);
  if (!campaignId) return false;

  const table = (client as ClientMinimal).from("notification_campaign_targets");
  if (actif) {
    // La clé primaire est `(campaign_id, student_id)` : une seconde activation
    // est refusée par la base, ce qui est le bon comportement — pas un doublon.
    const reponse = await table.insert({ campaign_id: campaignId, student_id: studentId });
    return !reponse.error;
  }
  const reponse = await table.delete().eq("campaign_id", campaignId).eq("student_id", studentId);
  return !reponse.error;
}
