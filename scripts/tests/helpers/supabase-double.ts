/**
 * DOUBLE DE SUPABASE POUR LES TESTS — une seule implémentation, partagée.
 *
 * POURQUOI CE FICHIER EXISTE
 *   Il a d'abord vécu à l'intérieur de `training-movement-patterns.mts`. F4 a
 *   eu besoin du même outil, et un second exemplaire aurait divergé du
 *   premier au premier correctif. Une seule base factice, donc, que les deux
 *   suites font évoluer ensemble.
 *
 * CE QU'IL REPRODUIT VOLONTAIREMENT
 *   - l'INDEX UNIQUE partiel `(student_id, session_id)` (20260823090000),
 *     sans lequel le rattrapage de collision ne serait jamais exercé ;
 *   - le trigger `enforce_exercise_feedback_write` sur les points qui
 *     comptent pour l'application : le nom du remplaçant est DÉRIVÉ, la date
 *     de dépôt de la vidéo est DÉRIVÉE, un chemin de vidéo qui désigne un
 *     autre élève est REFUSÉ ;
 *   - la RLS du bucket `feedback-videos` : une signature n'est rendue que
 *     pour un chemin que l'appelant a le droit de lire.
 *
 * CE QU'IL NE REMPLACE PAS
 *   Le vrai PostgreSQL. Les policies, les contraintes et les triggers font
 *   foi dans les checklists SQL. Ici on prouve le comportement de
 *   l'APPLICATION : quelles requêtes elle émet, dans quel ordre, et ce
 *   qu'elle fait des réponses.
 */

export type Ligne = Record<string, unknown>;

export interface OptionsBase {
  /** Fiches de banque, pour dériver le nom du remplaçant comme le fait le trigger. */
  banque?: Record<string, string>;
  /**
   * RLS du bucket, reproduite : rend `true` si l'appelant a le droit de lire
   * ce chemin. Par défaut tout est lisible — les tests qui veulent prouver un
   * cloisonnement fournissent leur propre prédicat.
   */
  peutLireVideo?: (chemin: string) => boolean;
}

export interface BaseFactice {
  /** À passer aux fonctions de `lib/supabase/*` — typé `never` pour être accepté. */
  client: never;
  /** Accès direct à une table, pour préparer un décor ou vérifier un état. */
  table: (nom: string) => Ligne[];
  /** Charges utiles réellement envoyées à `exercise_feedback.insert`. */
  envoyé: Ligne[];
  /** Objets présents dans le bucket `feedback-videos`, par chemin. */
  objets: Set<string>;
  /** Journal des appels Storage, dans l'ordre — `upload:…`, `remove:…`, `sign:…`, `list:…`. */
  journalStorage: string[];
  /** Pose une erreur sur le PROCHAIN insert de `workout_feedback`. */
  injecterErreur: (e: { code: string; message: string }) => void;
}

export function creerBase(options: OptionsBase = {}): BaseFactice {
  const banque: Record<string, string> = options.banque ?? {
    "33000000-0000-4000-8000-0000000000a2": "Développé couché haltères",
    "33000000-0000-4000-8000-0000000000a3": "Pompes lestées",
  };
  const peutLireVideo = options.peutLireVideo ?? (() => true);

  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  const défauts: Record<string, Ligne> = {
    workout_feedback: {
      session_id: null, program_id: null, completed: false, global_rpe: null, global_comment: "",
      pain: "", status: "a-traiter", coach_reply: "", prescribed_snapshot: null, performed_at: null,
      duration_minutes: null, session_status: null,
      submitted_at: "2026-08-08T10:00:00Z", created_at: "2026-08-08T10:00:00Z", updated_at: "2026-08-08T10:00:00Z",
    },
    exercise_feedback: {
      exercise_id: null, rpe: null, comment: "",
      substitute_exercise_library_id: null, substitute_exercise_name: null,
      video_path: null, video_uploaded_at: null,
      created_at: "2026-08-08T10:00:00Z", updated_at: "2026-08-08T10:00:00Z",
    },
    exercise_set_feedback: { load_used: "", reps_done: "", rpe: null },
  };
  let compteur = 0;
  let horloge = 0;
  const envoyé: Ligne[] = [];
  const objets = new Set<string>();
  const journalStorage: string[] = [];
  /** Erreur d'unicité posée par l'insert simulé, relue par `single()`. */
  let collision: { code: string; message: string } | null = null;
  /** Erreur arbitraire à injecter au PROCHAIN insert workout_feedback. */
  let erreurInjectée: { code: string; message: string } | null = null;

  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "update" | "delete";
      valeurs?: Ligne | Ligne[];
      filtres: [string, unknown][];
      dans: [string, unknown[]][];
    } = { op: "select", filtres: [], dans: [] };
    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) => l[c] === v) &&
      état.dans.every(([c, vs]) => vs.includes(l[c]));
    const exécuter = (): Ligne[] => {
      const lignes = table(nom);
      if (état.op === "select") return lignes.filter(correspond).map((l) => ({ ...l }));
      if (état.op === "insert") {
        const valeurs = Array.isArray(état.valeurs) ? état.valeurs : [état.valeurs ?? {}];
        // L'INDEX UNIQUE PARTIEL, reproduit (migration 20260823090000) :
        // un élève + une séance réelle = un seul retour. Sans lui, le
        // rattrapage de collision ne serait jamais exercé.
        if (nom === "workout_feedback") {
          for (const v of valeurs) {
            if (
              v.session_id &&
              table(nom).some((l) => l.student_id === v.student_id && l.session_id === v.session_id)
            ) {
              collision = { code: "23505", message: 'duplicate key value violates unique constraint "workout_feedback_one_per_student_session_uidx"' };
              return [];
            }
          }
        }
        return valeurs.map((v) => {
          if (nom === "exercise_feedback") envoyé.push({ ...v });
          const ligne: Ligne = { id: `${nom}-${(compteur += 1)}`, ...(défauts[nom] ?? {}), ...v };
          // ── LE TRIGGER, reproduit ──────────────────────────────────────
          if (nom === "exercise_feedback") {
            const idSub = ligne.substitute_exercise_library_id as string | null;
            ligne.substitute_exercise_name = idSub ? (banque[idSub] ?? null) : null;
            // F4 — le chemin doit désigner le dossier de SON élève, et la
            // date de dépôt est DÉRIVÉE, jamais reçue.
            const chemin = ligne.video_path as string | null;
            if (chemin && chemin.split("/")[0] !== ligne.student_id) {
              throw new Error(`Vidéo refusée : le chemin ${chemin} ne désigne pas le dossier de cet élève`);
            }
            ligne.video_uploaded_at = chemin ? `2026-08-08T10:00:${String((horloge += 1)).padStart(2, "0")}Z` : null;
          }
          lignes.push(ligne);
          return { ...ligne };
        });
      }
      if (état.op === "update") {
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const gardées = lignes.filter((l) => !correspond(l));
      tables.set(nom, gardées);
      return [];
    };
    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
      insert(v: Ligne | Ligne[]) { état.op = "insert"; état.valeurs = v; return chaîne; },
      update(v: Ligne) { état.op = "update"; état.valeurs = v; return chaîne; },
      delete() { état.op = "delete"; return chaîne; },
      eq(c: string, v: unknown) { état.filtres.push([c, v]); return chaîne; },
      in(c: string, v: unknown[]) { état.dans.push([c, v]); return chaîne; },
      order: () => chaîne,
      limit: () => chaîne,
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      single: () => {
        if (nom === "workout_feedback" && état.op === "insert" && erreurInjectée) {
          const erreur = erreurInjectée;
          erreurInjectée = null;
          return Promise.resolve({ data: null, error: erreur });
        }
        const [première] = exécuter();
        if (collision) {
          const erreur = collision;
          collision = null;
          return Promise.resolve({ data: null, error: erreur });
        }
        return Promise.resolve({ data: première ?? null, error: première ? null : { message: "aucune ligne" } });
      },
      then: (résoudre: (v: { data: Ligne[]; error: null }) => void) => résoudre({ data: exécuter(), error: null }),
    };
    return chaîne;
  }

  /** Le Storage : un ensemble de chemins, plus la RLS de lecture. */
  const storage = {
    from(bucket: string) {
      return {
        // Le contenu et les options ne sont pas relus : ce double prouve
        // QUEL chemin part et dans QUEL ordre, pas ce que contient le fichier.
        async upload(chemin: string) {
          journalStorage.push(`upload:${bucket}:${chemin}`);
          if (objets.has(chemin)) return { error: { message: "The resource already exists" } };
          objets.add(chemin);
          return { error: null };
        },
        async remove(chemins: string[]) {
          journalStorage.push(`remove:${bucket}:${chemins.join(",")}`);
          for (const c of chemins) objets.delete(c);
          return { data: chemins.map((c) => ({ name: c })), error: null };
        },
        async list(prefixe: string, opts?: { limit?: number; offset?: number }) {
          journalStorage.push(`list:${bucket}:${prefixe}:${opts?.offset ?? 0}`);
          const tous = [...objets]
            .filter((c) => c.startsWith(`${prefixe}/`))
            .sort()
            .map((c) => ({ name: c.slice(prefixe.length + 1) }));
          const début = opts?.offset ?? 0;
          const fin = opts?.limit ? début + opts.limit : undefined;
          return { data: tous.slice(début, fin), error: null };
        },
        async createSignedUrl(chemin: string, duree: number) {
          journalStorage.push(`sign:${bucket}:${chemin}:${duree}`);
          if (!objets.has(chemin) || !peutLireVideo(chemin)) {
            return { data: null, error: { message: "Object not found" } };
          }
          return { data: { signedUrl: `https://signee.test/${chemin}?exp=${duree}` }, error: null };
        },
        async createSignedUrls(chemins: string[], duree: number) {
          journalStorage.push(`signLot:${bucket}:${chemins.length}:${duree}`);
          return {
            data: chemins.map((chemin) =>
              objets.has(chemin) && peutLireVideo(chemin)
                ? { path: chemin, signedUrl: `https://signee.test/${chemin}?exp=${duree}`, error: null }
                : { path: chemin, signedUrl: null, error: "Object not found" },
            ),
            error: null,
          };
        },
      };
    },
  };

  const client = { from, storage } as never;
  return {
    client,
    table,
    envoyé,
    objets,
    journalStorage,
    injecterErreur: (e) => { erreurInjectée = e; },
  };
}
