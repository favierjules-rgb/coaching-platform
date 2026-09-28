/**
 * Harnais — LE CALENDRIER ET LA BIBLIOTHÈQUE CARDIO.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. un déplacement annoncé réussi alors qu'AUCUNE ligne n'a bougé ;
 *   2. un déplacement ou une suppression qui atteindrait la séance d'un AUTRE
 *      athlète ;
 *   3. une séance créée dans une semaine que le programme ne contient pas ;
 *   4. un modèle de bibliothèque appliqué PAR RÉFÉRENCE (modifier la séance
 *      modifierait le modèle, ou l'inverse) ;
 *   5. l'erreur « colonne inconnue » remontée telle quelle au coach tant que la
 *      migration 20260930100000 n'est pas appliquée ;
 *   6. un jour de repos affiché comme une séance.
 *
 * Lancement : npm run test:calendrier-cardio
 */
import assert from "node:assert/strict";

import {
  blocsCardioDuModele,
  blocsDuModelePourApplication,
  estModeleCardio,
  modelesCardio,
  resumeDuModeleCardio,
  seanceSyntheticPourModele,
} from "../../lib/bibliotheque-cardio";
import {
  creerSeanceCalendrier,
  deplacerSeance,
  messageDeColonneAbsente,
  seancesDuCalendrier,
  supprimerSeance,
} from "../../lib/supabase/calendrier-seances";
import type { AdminWorkoutSession, SessionTemplate, TrainingBlock } from "../../types";

let réussis = 0;
let échecs = 0;
async function test(nom: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * LE DOUBLE POSTGREST (mêmes sémantiques que persistance-date-debut)
 * ════════════════════════════════════════════════════════════════════════ */

type Ligne = Record<string, unknown>;

function creerBase(colonnesConnues?: readonly string[]) {
  const tables = new Map<string, Ligne[]>();
  const ordres: { table: string; op: string; valeurs: Ligne; filtres: [string, unknown][] }[] = [];
  const appelsRpc: Record<string, unknown>[] = [];
  let compteur = 0;
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom) as Ligne[];
  };

  /**
   * Reproduit le refus PostgREST d'une colonne absente du cache de schéma —
   * c'est l'état RÉEL de la base tant que la migration dort.
   */
  function colonneInconnue(valeurs: Ligne): string | null {
    if (!colonnesConnues) return null;
    for (const cle of Object.keys(valeurs)) {
      if (!colonnesConnues.includes(cle)) {
        return `Could not find the '${cle}' column of 'workout_sessions' in the schema cache`;
      }
    }
    return null;
  }

  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "update" | "delete";
      valeurs?: Ligne;
      filtres: [string, unknown][];
      representation: boolean;
    } = { op: "select", filtres: [], representation: false };
    const correspond = (l: Ligne) => état.filtres.every(([c, v]) => l[c] === v);

    const exécuter = (): { lignes: Ligne[]; erreur: { message: string } | null } => {
      const lignes = table(nom);
      if (état.op === "select") return { lignes: lignes.filter(correspond).map((l) => ({ ...l })), erreur: null };
      if (état.op === "insert") {
        const message = nom === "workout_sessions" ? colonneInconnue(état.valeurs ?? {}) : null;
        if (message) return { lignes: [], erreur: { message } };
        const ligne: Ligne = {
          // Un UUID RÉEL : la RPC (et son adaptateur) refusent tout autre format,
          // et un double qui rendrait « workout_sessions-1 » masquerait ce refus.
          id: `00000000-0000-4000-8000-${String((compteur += 1)).padStart(12, "0")}`,
          updated_at: "2026-09-28T12:00:00.000Z",
          ...(état.valeurs ?? {}),
        };
        lignes.push(ligne);
        ordres.push({ table: nom, op: "insert", valeurs: { ...(état.valeurs ?? {}) }, filtres: [] });
        return { lignes: [{ ...ligne }], erreur: null };
      }
      if (état.op === "update") {
        const message = nom === "workout_sessions" ? colonneInconnue(état.valeurs ?? {}) : null;
        if (message) return { lignes: [], erreur: { message } };
        ordres.push({ table: nom, op: "update", valeurs: { ...(état.valeurs ?? {}) }, filtres: [...état.filtres] });
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return { lignes: touchées.map((l) => ({ ...l })), erreur: null };
      }
      const supprimées = lignes.filter(correspond).map((l) => ({ ...l }));
      ordres.push({ table: nom, op: "delete", valeurs: {}, filtres: [...état.filtres] });
      tables.set(nom, lignes.filter((l) => !correspond(l)));
      return { lignes: supprimées, erreur: null };
    };

    const chaîne: Record<string, unknown> = {
      select: () => {
        état.representation = true;
        return chaîne;
      },
      insert(v: Ligne) {
        état.op = "insert";
        état.valeurs = v;
        return chaîne;
      },
      update(v: Ligne) {
        état.op = "update";
        état.valeurs = v;
        return chaîne;
      },
      delete() {
        état.op = "delete";
        return chaîne;
      },
      eq(c: string, v: unknown) {
        état.filtres.push([c, v]);
        return chaîne;
      },
      order: () => chaîne,
      maybeSingle: () => {
        const { lignes, erreur } = exécuter();
        return Promise.resolve({ data: lignes[0] ?? null, error: erreur });
      },
      single: () => {
        const { lignes, erreur } = exécuter();
        return Promise.resolve({ data: lignes[0] ?? null, error: erreur ?? (lignes[0] ? null : { message: "aucune ligne" }) });
      },
      then: (résoudre: (v: { data: Ligne[] | null; error: { message: string } | null }) => void) => {
        const { lignes, erreur } = exécuter();
        const rendable = état.op === "select" || état.representation;
        return Promise.resolve(résoudre({ data: erreur ? null : rendable ? lignes : null, error: erreur }));
      },
    };
    return chaîne;
  }

  const client = {
    rest: {},
    from,
    rpc(_fn: string, args: { p_payload: Record<string, unknown> }) {
      appelsRpc.push(args.p_payload);
      return Promise.resolve({
        data: {
          session_id: args.p_payload.session_id,
          updated_at: "2026-09-28T12:30:00.000Z",
          session_type: "cardio",
          scheduled_date: null,
          blocks: [],
          id_mapping: { blocks: {}, exercises: {} },
          warnings: { detached_exercise_feedback_count: 0 },
        },
        error: null,
      });
    },
  };
  return { client: client as never, table, ordres, appelsRpc };
}

const COLONNES_AVANT_MIGRATION = [
  "program_id", "program_week_id", "day", "is_rest_day", "name", "muscle_group",
  "duration_minutes", "warmup", "coach_notes", "session_type", "banner_url",
];

/* ════════════════════════════════════════════════════════════════════════
 * I. LA PROJECTION DES SÉANCES
 * ════════════════════════════════════════════════════════════════════════ */

function seance(partiel: Partial<AdminWorkoutSession>): AdminWorkoutSession {
  return {
    id: partiel.id ?? "s1",
    programId: partiel.programId ?? "copie-jules",
    weekNumber: partiel.weekNumber ?? 1,
    day: partiel.day ?? "Lundi",
    isRestDay: partiel.isRestDay ?? false,
    name: partiel.name ?? "Séance",
    muscleGroup: "",
    durationMinutes: partiel.durationMinutes ?? 45,
    warmup: "",
    coachNotes: partiel.coachNotes ?? "",
    exercises: [],
    blocks: partiel.blocks ?? [],
    updatedAt: partiel.updatedAt ?? "2026-09-28T10:00:00.000Z",
    scheduledDate: partiel.scheduledDate,
  };
}

const BLOC_CARDIO_COURSE: TrainingBlock = {
  id: "b-cardio", category: "cardio", position: 0, title: "VMA", colorKey: "red",
  cardioType: "vma_intervals", sport: "course", rounds: 3,
  prescriptions: [{ id: "p1", order: 0, segmentType: "work", title: "Effort", intensityTargetType: "vma_percentage", targetVmaPercentage: 105 }],
};
const BLOC_MUSCU: TrainingBlock = {
  id: "b-muscu", category: "strength", position: 1, title: "Bas", colorKey: "gray",
  exercises: [{ id: "e1", order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" }],
};

await test("PROJ1. une séance non datée prend la date CALCULÉE, une séance datée la sienne", () => {
  const seances = seancesDuCalendrier(
    [
      seance({ id: "a", weekNumber: 1, day: "Lundi" }),
      seance({ id: "b", weekNumber: 3, day: "Mercredi", scheduledDate: "2026-10-12" }),
    ],
    "2026-09-21",
  );
  assert.deepEqual(seances.map((s) => [s.id, s.date, s.origineDate]), [
    ["a", "2026-09-21", "calculee"],
    ["b", "2026-10-12", "planifiee"],
  ]);
});

await test("PROJ2. sans date de début, les séances non datées restent SANS date", () => {
  const seances = seancesDuCalendrier([seance({ id: "a" }), seance({ id: "b", scheduledDate: "2026-10-12" })], null);
  assert.equal(seances[0].date, null);
  assert.equal(seances[0].origineDate, "indeterminee");
  assert.equal(seances[1].date, "2026-10-12");
});

await test("PROJ3. un jour de repos n'entre pas dans le calendrier", () => {
  const seances = seancesDuCalendrier([seance({ id: "repos", isRestDay: true }), seance({ id: "vraie" })], "2026-09-21");
  assert.deepEqual(seances.map((s) => s.id), ["vraie"]);
});

await test("PROJ4. sports, couleur et type dérivé viennent des BLOCS, jamais d'une saisie", () => {
  const [mixte] = seancesDuCalendrier([seance({ blocks: [BLOC_CARDIO_COURSE, BLOC_MUSCU] })], "2026-09-21");
  assert.deepEqual(mixte.sports, ["course"]);
  assert.equal(mixte.couleur, "red", "la couleur du bloc cardio mène");
  assert.equal(mixte.typeDerive, "mixed");
  const [cardio] = seancesDuCalendrier([seance({ blocks: [BLOC_CARDIO_COURSE] })], "2026-09-21");
  assert.equal(cardio.typeDerive, "cardio");
  const [vide] = seancesDuCalendrier([seance({ blocks: [] })], "2026-09-21");
  assert.deepEqual(vide.sports, []);
  assert.equal(vide.couleur, "gray");
});

await test("PROJ5. la version de la séance est TRANSMISE — sans elle, aucun enregistrement possible", () => {
  const [s] = seancesDuCalendrier([seance({ updatedAt: "2026-09-28T10:00:00.000Z" })], "2026-09-21");
  assert.equal(s.updatedAt, "2026-09-28T10:00:00.000Z");
});

await test("PROJ6. les notes du coach traversent la projection — sinon ENREGISTRER les effacerait", () => {
  /*
   * ⚠️ DÉFAUT RÉEL DE CE CHANTIER, TROUVÉ AVANT LIVRAISON. La modale d'édition
   * renvoie un `session_patch` avec `coach_notes` : elle partait d'une chaîne
   * vide, donc un enregistrement écrasait les notes de la séance.
   */
  const [s] = seancesDuCalendrier([seance({ coachNotes: "attention au vent" })], "2026-09-21");
  assert.equal(s.coachNotes, "attention au vent");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. DÉPLACER
 * ════════════════════════════════════════════════════════════════════════ */

function decorDeuxAthletes() {
  const base = creerBase();
  base.table("workout_sessions").push({ id: "seance-jules", program_id: "copie-jules", day: "Lundi", scheduled_date: null });
  base.table("workout_sessions").push({ id: "seance-marco", program_id: "copie-marco", day: "Lundi", scheduled_date: null });
  return base;
}

await test("DEPL1. la date arrive en base, et seule la séance visée change", async () => {
  const base = decorDeuxAthletes();
  const resultat = await deplacerSeance(base.client, "seance-jules", "2026-10-12");
  assert.equal(resultat.ok, true);
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-jules")?.scheduled_date, "2026-10-12");
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-marco")?.scheduled_date, null,
    "la séance de l'autre athlète a bougé");
  assert.deepEqual(base.ordres.at(-1)?.filtres, [["id", "seance-jules"]]);
  assert.deepEqual(Object.keys(base.ordres.at(-1)?.valeurs ?? {}), ["scheduled_date"],
    "aucune autre colonne ne doit être écrite — surtout pas program_start_date");
});

await test("DEPL2. `null` ramène la séance au calcul historique", async () => {
  const base = decorDeuxAthletes();
  await deplacerSeance(base.client, "seance-jules", "2026-10-12");
  const resultat = await deplacerSeance(base.client, "seance-jules", null);
  assert.equal(resultat.ok, true);
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-jules")?.scheduled_date, null);
});

await test("DEPL3. zéro ligne touchée = ÉCHEC, jamais un faux déplacement", async () => {
  const base = decorDeuxAthletes();
  const resultat = await deplacerSeance(base.client, "seance-inconnue", "2026-10-12");
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /rien n'a été déplacé/);
});

await test("DEPL4. AVANT LA MIGRATION, l'échec est expliqué en français", async () => {
  const base = creerBase(COLONNES_AVANT_MIGRATION);
  base.table("workout_sessions").push({ id: "seance-jules", program_id: "copie-jules", day: "Lundi" });
  const resultat = await deplacerSeance(base.client, "seance-jules", "2026-10-12");
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /migration 20260930100000 n'est pas appliquée/);
  assert.match(String(resultat.erreur), /Aucune séance n'a été déplacée/);
  // Et la traduction ne masque pas les autres erreurs.
  assert.equal(messageDeColonneAbsente("violation de contrainte"), "violation de contrainte");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. SUPPRIMER
 * ════════════════════════════════════════════════════════════════════════ */

await test("SUPPR1. seule la séance visée disparaît", async () => {
  const base = decorDeuxAthletes();
  const resultat = await supprimerSeance(base.client, "seance-jules");
  assert.equal(resultat.ok, true);
  assert.deepEqual(base.table("workout_sessions").map((l) => l.id), ["seance-marco"]);
});

await test("SUPPR2. supprimer ce qui n'existe pas est un ÉCHEC signalé", async () => {
  const base = decorDeuxAthletes();
  const resultat = await supprimerSeance(base.client, "seance-inconnue");
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /rien n'a été supprimé/);
  assert.equal(base.table("workout_sessions").length, 2);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. CRÉER
 * ════════════════════════════════════════════════════════════════════════ */

const NOUVELLE = {
  programId: "copie-jules",
  weekNumber: 3,
  day: "Mercredi",
  name: "VMA courte",
  durationMinutes: 45,
  coachNotes: "",
  scheduledDate: "2026-10-07",
  blocks: [BLOC_CARDIO_COURSE],
};

await test("CREER1. la séance est insérée dans SA semaine, puis ses blocs écrits par la RPC", async () => {
  const base = creerBase();
  base.table("program_weeks").push({ id: "semaine-3", program_id: "copie-jules", week_number: 3 });
  const resultat = await creerSeanceCalendrier(base.client, NOUVELLE);
  assert.equal(resultat.ok, true, String(resultat.erreur));
  const ligne = base.table("workout_sessions")[0];
  assert.equal(ligne.program_week_id, "semaine-3");
  assert.equal(ligne.day, "Mercredi");
  assert.equal(ligne.scheduled_date, "2026-10-07");
  assert.equal(ligne.is_rest_day, false);
  assert.equal(ligne.session_type, "cardio", "le type est DÉRIVÉ des blocs, jamais saisi");
  // La RPC reçoit la version EXACTE rendue par l'INSERT.
  assert.equal(base.appelsRpc.length, 1);
  assert.equal(base.appelsRpc[0].expected_updated_at, "2026-09-28T12:00:00.000Z");
  assert.equal((base.appelsRpc[0].blocks as unknown[]).length, 1);
});

await test("CREER2. une semaine inexistante n'est PAS inventée", async () => {
  const base = creerBase();
  base.table("program_weeks").push({ id: "semaine-1", program_id: "copie-jules", week_number: 1 });
  const resultat = await creerSeanceCalendrier(base.client, NOUVELLE);
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /la semaine 3 n'existe pas/);
  assert.equal(base.table("workout_sessions").length, 0, "aucune séance orpheline");
  assert.equal(base.appelsRpc.length, 0);
});

await test("CREER3. la semaine visée est celle DU PROGRAMME DE L'ÉLÈVE, pas un homonyme", async () => {
  const base = creerBase();
  base.table("program_weeks").push({ id: "semaine-3-marco", program_id: "copie-marco", week_number: 3 });
  const resultat = await creerSeanceCalendrier(base.client, NOUVELLE);
  assert.equal(resultat.ok, false, "la semaine 3 d'un AUTRE programme ne doit pas servir");
  assert.equal(base.table("workout_sessions").length, 0);
});

await test("CREER4. sans date demandée, la clé `scheduled_date` n'est PAS envoyée", async () => {
  const base = creerBase(COLONNES_AVANT_MIGRATION);
  base.table("program_weeks").push({ id: "semaine-3", program_id: "copie-jules", week_number: 3 });
  const resultat = await creerSeanceCalendrier(base.client, { ...NOUVELLE, scheduledDate: null });
  assert.equal(resultat.ok, true, `la création doit fonctionner AVANT la migration : ${String(resultat.erreur)}`);
  const insertion = base.ordres.find((o) => o.table === "workout_sessions" && o.op === "insert");
  assert.ok(insertion && !("scheduled_date" in insertion.valeurs));
});

await test("CREER5. AVANT la migration, une date demandée fait échouer la création — et le dit", async () => {
  const base = creerBase(COLONNES_AVANT_MIGRATION);
  base.table("program_weeks").push({ id: "semaine-3", program_id: "copie-jules", week_number: 3 });
  const resultat = await creerSeanceCalendrier(base.client, NOUVELLE);
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /migration 20260930100000/);
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LA BIBLIOTHÈQUE
 * ════════════════════════════════════════════════════════════════════════ */

function modele(partiel: Partial<SessionTemplate>): SessionTemplate {
  return {
    id: partiel.id ?? "m1",
    name: partiel.name ?? "Modèle",
    description: partiel.description ?? "",
    sessionType: partiel.sessionType ?? "cardio",
    muscleGroup: "",
    durationMinutes: partiel.durationMinutes ?? 45,
    content: { warmup: "", coachNotes: "", exercises: [], cardioBlocks: [] },
    blocks: partiel.blocks ?? [BLOC_CARDIO_COURSE],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

await test("BIBLIO1. le filtre porte sur les BLOCS, donc une séance mixte est un modèle cardio", () => {
  assert.equal(estModeleCardio(modele({})), true);
  assert.equal(estModeleCardio(modele({ sessionType: "mixed", blocks: [BLOC_MUSCU, BLOC_CARDIO_COURSE] })), true,
    "exclure les mixtes priverait le coach de ses séances les plus fréquentes");
  assert.equal(estModeleCardio(modele({ sessionType: "strength", blocks: [BLOC_MUSCU] })), false);
  assert.equal(estModeleCardio(modele({ blocks: [] })), false);
});

await test("BIBLIO2. la liste est triée par nom, et n'emporte que les modèles cardio", () => {
  const liste = modelesCardio([
    modele({ id: "z", name: "Zone 2 longue" }),
    modele({ id: "m", name: "Muscu", sessionType: "strength", blocks: [BLOC_MUSCU] }),
    modele({ id: "a", name: "Anaérobie" }),
  ]);
  assert.deepEqual(liste.map((m) => m.id), ["a", "z"]);
});

await test("BIBLIO3. le résumé compte les blocs, les segments et nomme les sports", () => {
  const resume = resumeDuModeleCardio(modele({ blocks: [BLOC_CARDIO_COURSE, BLOC_MUSCU] }));
  assert.equal(resume.nombreDeBlocs, 1);
  assert.equal(resume.nombreDeSegments, 1);
  assert.deepEqual(resume.sports, ["course"]);
  assert.equal(resume.avecMusculation, true, "le coach doit savoir qu'il y a de la musculation dedans");
  assert.equal(blocsCardioDuModele(modele({ blocks: [BLOC_CARDIO_COURSE, BLOC_MUSCU] })).length, 1);
});

await test("BIBLIO4. appliquer un modèle est une COPIE : de nouveaux identifiants, aucun lien vivant", () => {
  const source = modele({ blocks: [BLOC_CARDIO_COURSE, BLOC_MUSCU] });
  const blocs = blocsDuModelePourApplication(source);
  assert.equal(blocs.length, 2);
  for (const bloc of blocs) {
    assert.notEqual(bloc.id, "b-cardio");
    assert.notEqual(bloc.id, "b-muscu");
  }
  const cardio = blocs.find((b) => b.category === "cardio");
  assert.equal(cardio?.category === "cardio" ? cardio.sport : null, "course", "le sport survit à l'application");
  assert.equal(cardio?.category === "cardio" ? cardio.rounds : null, 3, "les séries survivent à l'application");
  // La source n'a pas bougé.
  assert.equal(source.blocks[0].id, "b-cardio");
});

await test("BIBLIO5. la séance synthétique ne porte que ce qu'un modèle sait stocker", () => {
  const synthetique = seanceSyntheticPourModele({
    name: "VMA courte", durationMinutes: 45, coachNotes: "attention au vent", blocks: [BLOC_CARDIO_COURSE],
  });
  assert.equal(synthetique.name, "VMA courte");
  assert.equal(synthetique.durationMinutes, 45);
  assert.equal(synthetique.coachNotes, "attention au vent");
  assert.equal(synthetique.isRestDay, false);
  assert.equal(synthetique.blocks?.length, 1);
  assert.equal(synthetique.exercises.length, 0);
  assert.equal(synthetique.programId, "", "un modèle n'appartient à aucun programme");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
