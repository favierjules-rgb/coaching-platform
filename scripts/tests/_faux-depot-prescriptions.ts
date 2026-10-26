/*
 * ════════════════════════════════════════════════════════════════════════════
 * DÉCOR PARTAGÉ — UNE BASE FACTICE QUI MODÉLISE LE DIFF DES PRESCRIPTIONS
 * ════════════════════════════════════════════════════════════════════════════
 * Extrait de `reprise-relecture-echouee.mts` pour être partagé avec
 * `reprise-interface-desynchronisee.mts`. UN SEUL faux dépôt pour les deux
 * suites : deux copies auraient divergé, et la divergence se serait lue comme
 * un désaccord entre deux tests plutôt que comme le défaut qu'elle serait.
 *
 * ⚠️ CE FICHIER N'EST PAS UNE SUITE DE TESTS — préfixe `_`, extension `.ts` et
 * non `.mts`, aucun `test()`. L'importer n'exécute rien, et le balayage de
 * `aliments-a1.mts` (qui interdit aux SUITES de figer un compte de migrations)
 * ne le parcourt donc pas : il n'en contient aucun.
 */
import { isUuid } from "../../lib/training-blocks";
import type { AdminProgram, AdminWorkoutSession, TrainingBlock } from "../../types";
import type { ProgramBuilderData } from "../../components/admin/ProgramBuilder";

/* ══════════════════════════════════════════════════════════════════════════
   UNE BASE FACTICE QUI MODÉLISE LES PRESCRIPTIONS COMME LE SERVEUR
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ ELLE MODÉLISE LE DIFF, PAS UN REMPLACEMENT. Sans cela le test ne pourrait
   pas distinguer « identifiant conservé » de « ligne recréée à l'identique » —
   justement la différence que le lot D introduit.
   ══════════════════════════════════════════════════════════════════════════ */

export interface LignePresc { id: string; block_id: string; title: string; position: number }
export interface LigneBloc { id: string; session_id: string; type: string; position: number }
export interface LigneSeance { id: string; program_id: string; week_id: string; name: string; updated_at: string }

export function creerBase() {
  let horloge = 1;
  let compteur = 1000;
  const nouvelUuid = () => `00000000-0000-4000-8000-${String((compteur += 1)).padStart(12, "0")}`;

  const programs: Record<string, unknown>[] = [
    { id: "prog-1", name: "Programme", status: "actif", updated_at: "t0" },
  ];
  const weeks = [{ id: "w-1", program_id: "prog-1", week_number: 1 }];
  const seances: LigneSeance[] = [
    { id: "00000000-0000-4000-8000-000000000001", program_id: "prog-1", week_id: "w-1", name: "Séance A", updated_at: "t1" },
  ];
  const blocs: LigneBloc[] = [];
  const prescriptions: LignePresc[] = [];
  /** Chaque appel RPC observé — pour prouver qu'un refus n'écrit rien. */
  const appels: { fn: string; issue: string }[] = [];

  function rpc(fn: string, args: { p_payload: Record<string, unknown> }) {
    const p = args.p_payload;
    const refus = (message: string) => {
      appels.push({ fn, issue: message });
      return Promise.resolve({ data: null, error: { message } });
    };
    if (fn !== "save_training_program_sessions") return refus(`fonction inconnue ${fn}`);

    const prog = programs.find((x) => x.id === p.program_id);
    if (!prog) return refus("PROGRAM_NOT_FOUND_OR_FORBIDDEN");
    if (p.expected_program_updated_at != null && prog.updated_at !== p.expected_program_updated_at) {
      return refus("STALE_TRAINING_PROGRAM");
    }

    /*
     * ⚠️ LA TRANSACTION EST SIMULÉE PAR UN INSTANTANÉ, et c'est indispensable.
     * La RPC est atomique : un refus au milieu doit laisser la base EXACTEMENT
     * comme avant. Sans cette copie, le test montrerait des écritures
     * partielles que le vrai serveur n'aurait jamais commises, et il
     * « prouverait » un doublon qui n'existe pas.
     */
    const avant = {
      blocs: blocs.map((b) => ({ ...b })),
      prescriptions: prescriptions.map((x) => ({ ...x })),
      seances: seances.map((s) => ({ ...s })),
      prog: { ...prog },
    };
    const annuler = () => {
      blocs.splice(0, blocs.length, ...avant.blocs);
      prescriptions.splice(0, prescriptions.length, ...avant.prescriptions);
      seances.splice(0, seances.length, ...avant.seances);
      Object.assign(prog, avant.prog);
    };

    const patch = (p.program_patch ?? null) as Record<string, unknown> | null;
    if (patch) {
      for (const [k, v] of Object.entries(patch)) prog[k] = v as never;
      prog.updated_at = `t${(horloge += 1)}`;
    }

    const resultats: Record<string, unknown>[] = [];

    /** Le moteur par séance : verrou, puis diff des blocs et des prescriptions. */
    function ecrireSeance(sessionId: string, attendu: string, blocksEntrants: unknown[]): string | null {
      const ligne = seances.find((s) => s.id === sessionId && s.program_id === p.program_id);
      if (!ligne) return `SESSION_FAILED ${sessionId}: séance absente de ce programme`;
      // ⚠️ LE VERROU OPTIMISTE : c'est lui qui refuse une sauvegarde partant
      // d'un état client que la base a dépassé.
      if (ligne.updated_at !== attendu) return `SESSION_FAILED ${sessionId}: STALE_TRAINING_SESSION`;

      const blocsConserves: string[] = [];
      const mappingBlocs: Record<string, string> = {};
      const mappingPresc: Record<string, string> = {};

      for (const [i, brut] of blocksEntrants.entries()) {
        const b = brut as Record<string, unknown>;
        const idEntrant = String(b.id);
        let blocId: string;
        if (isUuid(idEntrant)) {
          const existant = blocs.find((x) => x.id === idEntrant && x.session_id === sessionId);
          if (!existant) return `SESSION_FAILED ${sessionId}: FOREIGN_BLOCK_ID`;
          existant.position = i;
          blocId = existant.id;
        } else {
          blocId = nouvelUuid();
          blocs.push({ id: blocId, session_id: sessionId, type: String(b.category), position: i });
          mappingBlocs[idEntrant] = blocId;
        }
        blocsConserves.push(blocId);

        if (b.category !== "cardio") continue;

        // ── Diff des prescriptions ──────────────────────────────────────────
        const entrantes = (b.prescriptions ?? []) as Record<string, unknown>[];
        const uuidEntrants = entrantes.map((x) => String(x.id)).filter(isUuid);
        const existantes = prescriptions.filter((x) => x.block_id === blocId).map((x) => x.id);
        const etrangere = uuidEntrants.find((u) => !existantes.includes(u));
        if (etrangere) return `SESSION_FAILED ${sessionId}: FOREIGN_PRESCRIPTION_ID: ${etrangere}`;

        const conservees: string[] = [];
        for (const [j, brute] of entrantes.entries()) {
          const idP = String(brute.id);
          if (isUuid(idP)) {
            const existante = prescriptions.find((x) => x.id === idP);
            if (!existante) return `SESSION_FAILED ${sessionId}: FOREIGN_PRESCRIPTION_ID: ${idP}`;
            if (brute.title !== undefined) existante.title = String(brute.title);
            existante.position = j;
            conservees.push(idP);
          } else {
            const neuf = nouvelUuid();
            prescriptions.push({ id: neuf, block_id: blocId, title: String(brute.title ?? ""), position: j });
            mappingPresc[idP] = neuf;
            conservees.push(neuf);
          }
        }
        // Suppression BORNÉE à ce bloc : seules les lignes retirées partent.
        for (let k = prescriptions.length - 1; k >= 0; k -= 1) {
          if (prescriptions[k]!.block_id === blocId && !conservees.includes(prescriptions[k]!.id)) {
            prescriptions.splice(k, 1);
          }
        }
      }

      // Blocs retirés de la séance (cascade sur leurs prescriptions).
      for (let k = blocs.length - 1; k >= 0; k -= 1) {
        if (blocs[k]!.session_id === sessionId && !blocsConserves.includes(blocs[k]!.id)) {
          const mort = blocs[k]!.id;
          for (let m = prescriptions.length - 1; m >= 0; m -= 1) {
            if (prescriptions[m]!.block_id === mort) prescriptions.splice(m, 1);
          }
          blocs.splice(k, 1);
        }
      }

      ligne.updated_at = `t${(horloge += 1)}`;
      resultats.push({
        session_id: sessionId, updated_at: ligne.updated_at, session_type: "cardio", created: false,
        id_mapping: { blocks: mappingBlocs, exercises: {}, prescriptions: mappingPresc },
        warnings: { detached_exercise_feedback_count: 0 },
      });
      return null;
    }

    for (const maj of (p.sessions_to_update ?? []) as Record<string, unknown>[]) {
      const erreur = ecrireSeance(
        String(maj.session_id), String(maj.expected_updated_at),
        (maj.blocks ?? []) as unknown[],
      );
      if (erreur) { annuler(); return refus(erreur); }
    }
    for (const neuve of (p.sessions_to_create ?? []) as Record<string, unknown>[]) {
      const id = nouvelUuid();
      seances.push({ id, program_id: String(p.program_id), week_id: "w-1",
        name: String(neuve.name ?? ""), updated_at: `t${(horloge += 1)}` });
      const erreur = ecrireSeance(id, seances[seances.length - 1]!.updated_at,
        (neuve.blocks ?? []) as unknown[]);
      if (erreur) { annuler(); return refus(erreur); }
    }

    appels.push({ fn, issue: "ok" });
    return Promise.resolve({
      data: {
        program_id: p.program_id, program_updated_at: prog.updated_at,
        weeks: {}, week_count: weeks.length,
        sessions: resultats, session_count: resultats.length,
      },
      error: null,
    });
  }

  const client = { from: () => { throw new Error("aucune lecture directe attendue"); }, rpc } as never;
  return { client, programs, weeks, seances, blocs, prescriptions, appels };
}

/* ══════════════════════════════════════════════════════════════════════════
   L'ÉTAT DU BUILDER
   ══════════════════════════════════════════════════════════════════════════ */

export const SESSION_ID = "00000000-0000-4000-8000-000000000001";

export function blocCardio(idBloc: string, segments: { id: string; title: string }[]): TrainingBlock {
  return {
    id: idBloc, category: "cardio", title: "Bloc cardio", colorKey: "green", position: 0,
    cardioType: "continuous_run",
    prescriptions: segments.map((s, i) => ({
      id: s.id, order: i, segmentType: "work", title: s.title,
      durationSeconds: 600, intensityTargetType: "free",
    })),
  } as unknown as TrainingBlock;
}

export function seance(updatedAt: string, blocks: TrainingBlock[]): AdminWorkoutSession {
  return {
    id: SESSION_ID, weekNumber: 1, day: "lundi", isRestDay: false, name: "Séance A",
    muscleGroup: "", durationMinutes: 60, warmup: "", coachNotes: "",
    sessionType: "cardio", bannerUrl: null, exercises: [], cardioBlocks: [],
    blocks, updatedAt,
  } as unknown as AdminWorkoutSession;
}

export function donnees(sessions: AdminWorkoutSession[]): ProgramBuilderData {
  return {
    name: "Programme", goal: "", level: "", durationWeeks: 1, description: "",
    status: "actif", bannerUrl: null, programMode: "individuel", groupStartDate: null,
    isPublic: false, publicSubscriptionTemplateId: null, sessions,
  } as unknown as ProgramBuilderData;
}

export function instantane(sessions: AdminWorkoutSession[]): AdminProgram {
  return {
    id: "prog-1", name: "Programme", goal: "", level: "", durationWeeks: 1, description: "",
    status: "actif", assignedStudentIds: [], sessions, createdAt: "", updatedAt: "t0",
    bannerUrl: null, programMode: "individuel", groupStartDate: null, isPublic: false,
    publicSubscriptionTemplateId: null,
  } as unknown as AdminProgram;
}

/* ══════════════════════════════════════════════════════════════════════════
   LE SCÉNARIO
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L'ÉTAT SERVEUR TEL QU'UNE RELECTURE RÉUSSIE LE RENDRAIT, reconstruit depuis
 * les lignes du faux dépôt.
 *
 * ⚠️ C'EST LA PIÈCE QUI MANQUAIT POUR TESTER LA REPRISE. Une relecture réussie
 * ne rend pas l'état local du coach : elle rend ce que la BASE contient, donc
 * les identifiants RÉELLEMENT persistés (`id` UUID des prescriptions créées) et
 * les `updated_at` à jour. Simuler la reprise avec l'instantané local aurait
 * prouvé l'inverse de ce qu'on cherche : que les identifiants temporaires
 * survivent.
 */
export function etatServeur(base: ReturnType<typeof creerBase>): AdminProgram {
  const sessions = base.seances.map((ligne) => {
    const blocs = base.blocs
      .filter((b) => b.session_id === ligne.id)
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        id: b.id,
        category: "cardio",
        title: "Bloc cardio",
        colorKey: "green",
        position: b.position,
        cardioType: "continuous_run",
        prescriptions: base.prescriptions
          .filter((p) => p.block_id === b.id)
          .sort((a, b2) => a.position - b2.position)
          .map((p, i) => ({
            id: p.id,
            order: i,
            segmentType: "work",
            title: p.title,
            durationSeconds: 600,
            intensityTargetType: "free",
          })),
      })) as unknown as TrainingBlock[];
    return {
      id: ligne.id,
      weekNumber: 1,
      day: "lundi",
      isRestDay: false,
      name: ligne.name,
      muscleGroup: "",
      durationMinutes: 60,
      warmup: "",
      coachNotes: "",
      sessionType: "cardio",
      bannerUrl: null,
      exercises: [],
      cardioBlocks: [],
      blocks: blocs,
      updatedAt: ligne.updated_at,
    } as unknown as AdminWorkoutSession;
  });
  const prog = instantane(sessions);
  return { ...prog, updatedAt: base.programs[0]!.updated_at } as AdminProgram;
}
