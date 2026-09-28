/**
 * Harnais — LE CALENDRIER ACCEPTE DE LA MUSCULATION, DU CARDIO ET DU MIXTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. un calendrier qui ne saurait poser QUE du cardio — le bouton « + » doit
 *      offrir musculation, cardio, mixte et bibliothèque, et la bibliothèque ne
 *      doit PLUS être filtrée sur le cardio ;
 *   2. une séance posée depuis la bibliothèque qui partagerait ses blocs avec le
 *      modèle (modifier la copie modifierait le modèle, ou l'inverse) ;
 *   3. un `session_type` saisi au lieu d'être DÉRIVÉ des blocs ;
 *   4. un bloc cardio dont `sport` ou `rounds` disparaîtrait en traversant
 *      l'éditeur de blocs — sans sport, plus aucune conversion physiologique
 *      n'est possible, et rien ne le signalerait ;
 *   5. des références d'athlète qui n'atteindraient pas les segments cardio
 *      édités depuis le calendrier (l'élève verrait des consignes en %, sans
 *      valeur) ;
 *   6. une écriture de séance complète en portée « cardio » (elle perdrait la
 *      musculation) ou une écriture cardio en portée « all » (elle la
 *      supprimerait) ;
 *   7. une modification du calendrier d'un athlète qui atteindrait le PROGRAMME
 *      SOURCE ou un autre élève.
 *
 * Lancement : npm run test:calendrier-seances-completes
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  blocsDeDepart,
  blocsDepuisModele,
  CHOIX_DAJOUT,
  LIBELLE_TYPE,
  modeleDepuisSeance,
  refusDEnregistrement,
  seanceDeTravail,
  typeAffiche,
} from "../../lib/calendrier-composition";
import { modelesCardio, modelesDuCalendrier, resumeDuModele } from "../../lib/bibliotheque-cardio";
import { creerSeanceCalendrier, deplacerSeance, supprimerSeance } from "../../lib/supabase/calendrier-seances";
import { valeurPhysio, VALEUR_ABSENTE } from "../../lib/physiologie";
import { EditeurSeanceCalendrier } from "../../components/admin/cardio/EditeurSeanceCalendrier";
import type { ReferencesAthlete } from "../../lib/zones-physiologiques";
import type { AdminWorkoutSession, SessionTemplate, TrainingBlock } from "../../types";

const RACINE = new URL("../../", import.meta.url).pathname;
const lireSource = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
const sansMarqueursReact = (html: string) => html.replace(/<!--\s*-->/g, "");
const texte = (html: string) => sansMarqueursReact(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

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
 * LE DOUBLE POSTGREST — mêmes sémantiques que calendrier-cardio
 * ════════════════════════════════════════════════════════════════════════ */

type Ligne = Record<string, unknown>;

function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const ordres: { table: string; op: string; valeurs: Ligne; filtres: [string, unknown][] }[] = [];
  const appelsRpc: Record<string, unknown>[] = [];
  let compteur = 0;
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom) as Ligne[];
  };

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
        const ligne: Ligne = {
          id: `00000000-0000-4000-8000-${String((compteur += 1)).padStart(12, "0")}`,
          updated_at: "2026-09-28T12:00:00.000Z",
          ...(état.valeurs ?? {}),
        };
        lignes.push(ligne);
        ordres.push({ table: nom, op: "insert", valeurs: { ...(état.valeurs ?? {}) }, filtres: [] });
        return { lignes: [{ ...ligne }], erreur: null };
      }
      if (état.op === "update") {
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
          session_type: "mixed",
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

/* ── Fabriques ─────────────────────────────────────────────────────────────── */

const JULES: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(48, "mesuree"),
  vmaCourseKmh: valeurPhysio(16, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};

const BLOC_MUSCU: TrainingBlock = {
  id: "b-muscu",
  category: "strength",
  position: 0,
  title: "Bas du corps",
  colorKey: "gray",
  exercises: [
    { id: "e1", order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" },
  ],
};

const BLOC_CARDIO: TrainingBlock = {
  id: "b-cardio",
  category: "cardio",
  position: 1,
  title: "VMA courte",
  colorKey: "red",
  cardioType: "vma_intervals",
  sport: "course",
  rounds: 3,
  prescriptions: [
    { id: "p1", order: 0, segmentType: "work", title: "Effort", durationSeconds: 30, intensityTargetType: "vma_percentage", targetVmaPercentage: 100 },
  ],
};

function modele(partiel: Partial<SessionTemplate> & { blocks: TrainingBlock[] }): SessionTemplate {
  return {
    id: partiel.id ?? "t1",
    name: partiel.name ?? "Modèle",
    description: partiel.description ?? "",
    muscleGroup: partiel.muscleGroup ?? "",
    durationMinutes: partiel.durationMinutes ?? 60,
    sessionType: partiel.sessionType,
    content: partiel.content ?? { exercises: [], cardioBlocks: [], warmup: "", coachNotes: "" },
    blocks: partiel.blocks,
    createdAt: partiel.createdAt ?? "2026-09-01T00:00:00.000Z",
  } as SessionTemplate;
}

/* ════════════════════════════════════════════════════════════════════════
 * I. LE MENU « + » — quatre entrées, pas une
 * ════════════════════════════════════════════════════════════════════════ */

await test("MENU1. le bouton « + » propose musculation, cardio, mixte ET bibliothèque", () => {
  assert.deepEqual(
    CHOIX_DAJOUT.map((choix) => choix.cle),
    ["musculation", "cardio", "mixte", "bibliotheque"],
    "les quatre entrées du chantier, dans cet ordre",
  );
  for (const choix of CHOIX_DAJOUT) {
    assert.ok(choix.libelle.length > 3, `${choix.cle} doit porter un libellé lisible`);
    assert.ok(choix.description.length > 10, `${choix.cle} doit dire ce qu'il fait`);
  }
});

await test("MENU2. le calendrier ne filtre PLUS la bibliothèque sur le cardio", () => {
  const source = sansCommentaires(lireSource("components/admin/cardio/CalendrierAthlete.tsx"));
  assert.ok(
    source.includes("modelesDuCalendrier(etat.modeles)"),
    "la modale d'ajout doit lister TOUS les modèles : une séance de musculation existante doit pouvoir être posée",
  );
  assert.ok(
    !/modelesCardio\s*\(/.test(source),
    "`modelesCardio` filtrerait les séances de musculation hors du calendrier",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES BLOCS D'AMORÇAGE — et le type qui s'en déduit
 * ════════════════════════════════════════════════════════════════════════ */

await test("AMOR1. « musculation » amorce UN bloc de musculation, et le type dérivé le dit", () => {
  const blocs = blocsDeDepart("musculation");
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].category, "strength");
  assert.equal(blocs[0].position, 0);
  assert.ok(blocs[0].id.startsWith("new-block:"), "id temporaire STRICT, sinon la RPC refuse");
  assert.equal(typeAffiche(blocs), "strength");
  assert.equal(LIBELLE_TYPE[typeAffiche(blocs)], "Musculation");
});

await test("AMOR2. « cardio » amorce UN bloc cardio", () => {
  const blocs = blocsDeDepart("cardio");
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].category, "cardio");
  assert.equal(typeAffiche(blocs), "cardio");
});

await test("AMOR3. « mixte » amorce musculation PUIS cardio, positions 0 et 1", () => {
  const blocs = blocsDeDepart("mixte");
  assert.deepEqual(blocs.map((bloc) => [bloc.category, bloc.position]), [
    ["strength", 0],
    ["cardio", 1],
  ]);
  assert.equal(typeAffiche(blocs), "mixed");
  assert.equal(LIBELLE_TYPE[typeAffiche(blocs)], "Mixte");
  assert.equal(new Set(blocs.map((bloc) => bloc.id)).size, 2, "deux blocs, deux identifiants");
});

await test("AMOR4. « bibliothèque » n'amorce AUCUN bloc", () => {
  assert.deepEqual(blocsDeDepart("bibliotheque"), [], "un bloc vide s'ajouterait AU modèle appliqué");
});

await test("AMOR5. le genre choisi ne fige rien : retirer le cardio d'une mixte donne une séance de musculation", () => {
  const blocs = blocsDeDepart("mixte").filter((bloc) => bloc.category !== "cardio");
  assert.equal(typeAffiche(blocs), "strength", "`session_type` est DÉRIVÉ : il suit le contenu, il ne le précède pas");
  assert.equal(typeAffiche([]), "rest");
  assert.equal(LIBELLE_TYPE.rest, "Vide");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. CE QUI EMPÊCHE D'ENREGISTRER
 * ════════════════════════════════════════════════════════════════════════ */

await test("REFUS1. une séance sans nom, sans bloc, ou dont un bloc cardio n'a aucun segment est refusée", () => {
  const sansNom = seanceDeTravail({ meta: { name: "  ", durationMinutes: null, coachNotes: "" }, blocks: [BLOC_MUSCU] });
  assert.match(refusDEnregistrement(sansNom) ?? "", /nom/i);

  const sansBloc = seanceDeTravail({ meta: { name: "Séance", durationMinutes: null, coachNotes: "" }, blocks: [] });
  assert.match(refusDEnregistrement(sansBloc) ?? "", /au moins un bloc/i);

  const cardioVide = seanceDeTravail({
    meta: { name: "Séance", durationMinutes: null, coachNotes: "" },
    blocks: [{ ...BLOC_CARDIO, prescriptions: [] } as TrainingBlock],
  });
  assert.match(refusDEnregistrement(cardioVide) ?? "", /segment/i);
});

await test("REFUS2. un bloc de MUSCULATION sans exercice est accepté — c'est l'état normal d'une séance à remplir", () => {
  const amorcee = seanceDeTravail({
    meta: { name: "Jambes", durationMinutes: null, coachNotes: "" },
    blocks: blocsDeDepart("musculation"),
  });
  assert.equal(
    refusDEnregistrement(amorcee),
    null,
    "le builder de programme l'accepte déjà : deux règles pour la même donnée créeraient une incohérence",
  );
});

await test("REFUS3. une séance valide ne produit AUCUN refus", () => {
  const valide = seanceDeTravail({
    meta: { name: "Mixte", durationMinutes: 75, coachNotes: "RAS" },
    blocks: [BLOC_MUSCU, BLOC_CARDIO],
  });
  assert.equal(refusDEnregistrement(valide), null);
  assert.equal(valide.durationMinutes, 75);
  assert.equal(valide.coachNotes, "RAS");
  assert.equal(valide.isRestDay, false);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. LA COPIE — le modèle source ne doit JAMAIS bouger
 * ════════════════════════════════════════════════════════════════════════ */

await test("COPIE1. `seanceDeTravail` recopie les blocs : muter la séance de travail n'atteint pas la source", () => {
  const source: TrainingBlock[] = [{ ...BLOC_MUSCU }];
  const travail = seanceDeTravail({ meta: { name: "X", durationMinutes: null, coachNotes: "" }, blocks: source });
  assert.notEqual(travail.blocks[0], source[0], "un objet partagé propagerait chaque frappe dans la source");
  (travail.blocks[0] as { title: string | null }).title = "MODIFIÉ";
  assert.equal(source[0].title, "Bas du corps");
});

await test("COPIE2. un modèle posé dans le calendrier reçoit de NOUVEAUX identifiants", () => {
  const t = modele({ blocks: [BLOC_MUSCU, BLOC_CARDIO] });
  const posés = blocsDepuisModele(t);
  assert.equal(posés.length, 2);
  for (const bloc of posés) {
    assert.ok(bloc.id.startsWith("new-block:"), `« ${bloc.id} » : réutiliser l'id du modèle ferait écrire DANS le modèle`);
  }
  const muscuPosé = posés.find((bloc) => bloc.category === "strength");
  assert.ok(muscuPosé && muscuPosé.category === "strength");
  assert.ok(muscuPosé.exercises[0].id.startsWith("new-exercise:"));
  assert.equal(muscuPosé.exercises[0].name, "Squat", "le contenu est CONSERVÉ, seuls les identifiants changent");
});

await test("COPIE3. modifier la séance posée ne modifie pas le modèle de la bibliothèque", () => {
  const t = modele({ blocks: [BLOC_MUSCU, BLOC_CARDIO] });
  const posés = blocsDepuisModele(t);
  const cardioPosé = posés.find((bloc) => bloc.category === "cardio");
  assert.ok(cardioPosé && cardioPosé.category === "cardio");
  cardioPosé.prescriptions[0].targetVmaPercentage = 999;
  cardioPosé.prescriptions.push({ ...cardioPosé.prescriptions[0], id: "ajout", order: 1 });

  const original = t.blocks.find((bloc) => bloc.category === "cardio");
  assert.ok(original && original.category === "cardio");
  assert.equal(original.prescriptions.length, 1, "le modèle a gagné un segment : les tableaux sont partagés");
  assert.equal(original.prescriptions[0].targetVmaPercentage, 100);
});

await test("COPIE4. le sport et les séries du bloc cardio survivent à l'application du modèle", () => {
  const posés = blocsDepuisModele(modele({ blocks: [BLOC_CARDIO] }));
  const cardio = posés[0];
  assert.ok(cardio.category === "cardio");
  assert.equal(cardio.sport, "course", "sans sport, plus aucune conversion physiologique n'est possible");
  assert.equal(cardio.rounds, 3);
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LA BIBLIOTHÈQUE, NON FILTRÉE ET RÉSUMÉE
 * ════════════════════════════════════════════════════════════════════════ */

await test("BIB1. `modelesDuCalendrier` garde TOUT, trié par nom — `modelesCardio` filtre encore", () => {
  const muscu = modele({ id: "m", name: "Bas du corps", blocks: [BLOC_MUSCU] });
  const cardio = modele({ id: "c", name: "Ascenseur VMA", blocks: [BLOC_CARDIO] });
  const tous = modelesDuCalendrier([muscu, cardio]);
  assert.deepEqual(tous.map((t) => t.id), ["c", "m"], "tri français par nom");
  assert.deepEqual(
    modelesCardio([muscu, cardio]).map((t) => t.id),
    ["c"],
    "`modelesCardio` reste disponible là où seul le cardio a du sens",
  );
});

await test("BIB2. `resumeDuModele` classe Musculation / Cardio / Mixte / Vide, et compte le contenu réel", () => {
  assert.equal(resumeDuModele(modele({ blocks: [BLOC_MUSCU] })).categorie, "Musculation");
  assert.equal(resumeDuModele(modele({ blocks: [BLOC_CARDIO] })).categorie, "Cardio");
  assert.equal(resumeDuModele(modele({ blocks: [BLOC_MUSCU, BLOC_CARDIO] })).categorie, "Mixte");
  assert.equal(resumeDuModele(modele({ blocks: [] })).categorie, "Vide");

  const mixte = resumeDuModele(modele({ blocks: [BLOC_MUSCU, BLOC_CARDIO] }));
  assert.equal(mixte.nombreDExercices, 1);
  assert.equal(mixte.nombreDeBlocsCardio, 1);
  assert.equal(mixte.nombreDeSegments, 1);
  assert.deepEqual(mixte.sports, ["course"]);
});

await test("BIB3. « enregistrer dans ma bibliothèque » emporte TOUS les blocs, copiés", () => {
  const travail = seanceDeTravail({ meta: { name: "Mixte", durationMinutes: 75, coachNotes: "n" }, blocks: [BLOC_MUSCU, BLOC_CARDIO] });
  const synthétique: AdminWorkoutSession = modeleDepuisSeance(travail);
  assert.equal(synthétique.blocks?.length, 2, "un modèle qui ne garderait que le cardio perdrait la musculation");
  assert.equal(synthétique.name, "Mixte");
  assert.equal(synthétique.durationMinutes, 75);
  assert.notEqual(synthétique.blocks?.[0], travail.blocks[0], "objets recopiés, jamais partagés");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LA CRÉATION EN BASE — muscu, cardio, mixte
 * ════════════════════════════════════════════════════════════════════════ */

function baseAvecProgramme() {
  const base = creerBase();
  base.table("program_weeks").push({ id: "w1", program_id: "copie-jules", week_number: 1 });
  return base;
}

async function creer(blocks: TrainingBlock[], base = baseAvecProgramme()) {
  const résultat = await creerSeanceCalendrier(base.client, {
    programId: "copie-jules",
    weekNumber: 1,
    day: "Lundi",
    name: "Séance du calendrier",
    durationMinutes: 60,
    coachNotes: "",
    scheduledDate: "2026-10-05",
    blocks,
  });
  return { base, résultat };
}

await test("CREA1. une séance de MUSCULATION est créée, et son `session_type` est dérivé", async () => {
  const { base, résultat } = await creer(blocsDeDepart("musculation"));
  assert.equal(résultat.ok, true, résultat.erreur ?? "");
  const insérée = base.ordres.find((o) => o.table === "workout_sessions" && o.op === "insert");
  assert.ok(insérée);
  assert.equal(insérée.valeurs.session_type, "strength");
  assert.equal(insérée.valeurs.scheduled_date, "2026-10-05");
  assert.equal(insérée.valeurs.is_rest_day, false);
});

await test("CREA2. une séance CARDIO est créée avec son sport et ses segments", async () => {
  const { base, résultat } = await creer([{ ...BLOC_CARDIO, position: 0 }]);
  assert.equal(résultat.ok, true, résultat.erreur ?? "");
  const insérée = base.ordres.find((o) => o.table === "workout_sessions" && o.op === "insert");
  assert.equal(insérée?.valeurs.session_type, "cardio");

  assert.equal(base.appelsRpc.length, 1, "les blocs DOIVENT être écrits : une séance créée vide n'est pas une séance");
  const payload = base.appelsRpc[0] as { blocks: { category: string; sport?: string | null; prescriptions?: unknown[] }[] };
  assert.equal(payload.blocks.length, 1);
  assert.equal(payload.blocks[0].category, "cardio");
  assert.equal(payload.blocks[0].sport, "course", "un sport perdu rend la séance inconvertible pour l'athlète");
  assert.equal(payload.blocks[0].prescriptions?.length, 1);
});

await test("CREA3. une séance MIXTE garde ses deux catégories, dans l'ordre", async () => {
  const { base, résultat } = await creer([BLOC_MUSCU, BLOC_CARDIO]);
  assert.equal(résultat.ok, true, résultat.erreur ?? "");
  const insérée = base.ordres.find((o) => o.table === "workout_sessions" && o.op === "insert");
  assert.equal(insérée?.valeurs.session_type, "mixed");

  const payload = base.appelsRpc[0] as { blocks: { category: string; position: number }[] };
  assert.deepEqual(
    payload.blocks.map((bloc) => [bloc.category, bloc.position]),
    [
      ["strength", 0],
      ["cardio", 1],
    ],
    "muscu → cardio : l'ordre du coach, pas un regroupement par catégorie",
  );
});

await test("CREA4. la création passe par l'adaptateur canonique — les ids clients sont TRADUITS", async () => {
  const { base } = await creer(blocsDeDepart("mixte"));
  const payload = base.appelsRpc[0] as { blocks: { id: string }[]; session_id: string };
  for (const bloc of payload.blocks) {
    assert.ok(
      bloc.id.startsWith("new-block:"),
      `« ${bloc.id} » : un id non traduit fait échouer la RPC sur UNRECOGNIZED_BLOCK_ID, et la séance reste SANS blocs`,
    );
  }
  assert.match(payload.session_id, /^[0-9a-f-]{36}$/, "un sessionId non UUID est refusé par la RPC");
});

await test("CREA5. une semaine absente du programme REFUSE la création, sans rien insérer", async () => {
  const base = creerBase();
  const résultat = await creerSeanceCalendrier(base.client, {
    programId: "copie-jules",
    weekNumber: 9,
    day: "Lundi",
    name: "Séance",
    durationMinutes: null,
    coachNotes: "",
    scheduledDate: "2026-10-05",
    blocks: blocsDeDepart("musculation"),
  });
  assert.equal(résultat.ok, false);
  assert.match(résultat.erreur ?? "", /semaine 9 n'existe pas/);
  assert.equal(base.ordres.filter((o) => o.table === "workout_sessions").length, 0, "aucune séance ne doit être créée");
  assert.equal(base.appelsRpc.length, 0);
});

await test("CREA6. la création écrit en portée COMPLÈTE — c'est légitime, la séance n'existait pas", async () => {
  const { base } = await creer([BLOC_MUSCU, BLOC_CARDIO]);
  const payload = base.appelsRpc[0] as { scope?: string };
  assert.ok(
    payload.scope === undefined || payload.scope === "all",
    "une portée « cardio » à la création n'écrirait jamais la musculation de la séance",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. LA COPIE INDIVIDUELLE — le programme source et l'élève d'à côté
 * ════════════════════════════════════════════════════════════════════════ */

await test("IND1. déplacer une séance ne touche QUE sa ligne, jamais le programme", async () => {
  const base = creerBase();
  base.table("workout_sessions").push(
    { id: "s-jules", program_id: "copie-jules", scheduled_date: null },
    { id: "s-marco", program_id: "copie-marco", scheduled_date: null },
    { id: "s-modele", program_id: "modele-source", scheduled_date: null },
  );
  const résultat = await deplacerSeance(base.client, "s-jules", "2026-10-19");
  assert.equal(résultat.ok, true, résultat.erreur ?? "");

  const écritures = base.ordres.filter((o) => o.op !== "select");
  assert.deepEqual(écritures.map((o) => o.table), ["workout_sessions"], "ni `programs`, ni `assignments`");
  assert.deepEqual(écritures[0].filtres, [["id", "s-jules"]], "le filtre est l'id de LA séance");
  assert.equal(base.table("workout_sessions").find((l) => l.id === "s-marco")?.scheduled_date, null);
  assert.equal(base.table("workout_sessions").find((l) => l.id === "s-modele")?.scheduled_date, null);
});

await test("IND2. supprimer une séance ne touche QUE sa ligne", async () => {
  const base = creerBase();
  base.table("workout_sessions").push(
    { id: "s-jules", program_id: "copie-jules" },
    { id: "s-modele", program_id: "modele-source" },
  );
  const résultat = await supprimerSeance(base.client, "s-jules");
  assert.equal(résultat.ok, true, résultat.erreur ?? "");
  assert.deepEqual(base.table("workout_sessions").map((l) => l.id), ["s-modele"]);
  const suppressions = base.ordres.filter((o) => o.op === "delete");
  assert.equal(suppressions.length, 1);
  assert.deepEqual(suppressions[0].filtres, [["id", "s-jules"]]);
});

await test("IND3. créer une séance n'écrit JAMAIS dans `programs` ni dans `assignments`", async () => {
  const { base } = await creer([BLOC_MUSCU, BLOC_CARDIO]);
  const touchées = new Set(base.ordres.filter((o) => o.op !== "select").map((o) => o.table));
  assert.ok(!touchées.has("programs"), "le programme source doit rester inchangé");
  assert.ok(!touchées.has("assignments"), "`program_start_date` ne doit pas bouger : cela décalerait tout le programme");
  assert.deepEqual([...touchées], ["workout_sessions"]);
});

/* ════════════════════════════════════════════════════════════════════════
 * VIII. LES DEUX PORTÉES D'ÉCRITURE, ET POURQUOI IL EN FAUT DEUX
 * ════════════════════════════════════════════════════════════════════════ */

await test("PORT1. l'éditeur CARDIO enregistre en portée « cardio », l'éditeur COMPLET en portée « all »", () => {
  const source = sansCommentaires(lireSource("hooks/useCalendrierAthlete.ts"));
  const cardio = source.indexOf("const enregistrerSeance ");
  const complet = source.indexOf("const enregistrerSeanceComplete ");
  assert.ok(cardio !== -1 && complet !== -1, "les deux chemins doivent exister séparément");

  const [premier, second] = cardio < complet ? [cardio, complet] : [complet, cardio];
  const bloc1 = source.slice(premier, second);
  const bloc2 = source.slice(second);
  const portée = (bloc: string) => /scope:\s*"(\w+)"/.exec(bloc)?.[1];
  const portéeCardio = cardio < complet ? portée(bloc1) : portée(bloc2);
  const portéeComplete = cardio < complet ? portée(bloc2) : portée(bloc1);

  assert.equal(portéeCardio, "cardio", "sans portée, un enregistrement cardio supprimerait la musculation de la séance");
  assert.equal(portéeComplete, "all", "l'éditeur complet envoie TOUS les blocs : rien ne peut disparaître par omission");
});

await test("PORT2. l'éditeur COMPLET renvoie tous les blocs ; l'éditeur CARDIO n'en renvoie que le cardio", () => {
  const complet = sansCommentaires(lireSource("components/admin/cardio/EditeurSeanceCalendrier.tsx"));
  assert.ok(/blocks:\s*session\.blocks\.map/.test(complet), "l'éditeur complet doit renvoyer la séance entière");
  assert.ok(
    !/blocksCardio/.test(complet),
    "réutiliser le contrat cardio ici enverrait une liste partielle en portée « all » : la musculation serait supprimée",
  );

  const cardio = sansCommentaires(lireSource("components/admin/cardio/EditeurBlocsCardio.tsx"));
  assert.ok(
    /blocksCardio:\s*blocsCardioPourEnregistrement\(blocs\)/.test(cardio),
    "l'éditeur cardio doit continuer à ne renvoyer QUE le cardio",
  );
});

await test("PORT3. l'écran branche chaque éditeur sur SA portée", () => {
  const source = sansCommentaires(lireSource("components/admin/cardio/CalendrierAthlete.tsx"));
  assert.ok(
    /enregistrerSeanceComplete\(ouverte,\s*enregistrement\.blocks/.test(source),
    "l'éditeur complet doit passer par le chemin de portée « all »",
  );
  assert.ok(
    /enregistrerSeance\(ouverte,\s*enregistrement\.blocksCardio/.test(source),
    "l'éditeur cardio doit rester sur le chemin de portée « cardio »",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * IX. `sport` ET `rounds` TRAVERSENT L'ÉDITEUR DE BLOCS
 * ════════════════════════════════════════════════════════════════════════ */

await test("ADAPT1. `CardioBlockEditor` porte `sport` et `rounds` DANS LES DEUX SENS", () => {
  const source = sansCommentaires(lireSource("components/admin/blocks/CardioBlockEditor.tsx"));
  assert.ok(/sport:\s*block\.sport/.test(source), "sans ceci, le formulaire s'ouvre avec « Sport non renseigné »");
  assert.ok(/rounds:\s*block\.rounds/.test(source), "sans ceci, le nombre de séries s'ouvre vide");
  assert.ok(
    /sport:\s*updated\.sport/.test(source),
    "sans ceci, toucher n'importe quel champ EFFACE le sport — et la conversion physiologique devient impossible",
  );
  assert.ok(/rounds:\s*updated\.rounds/.test(source), "sans ceci, toucher n'importe quel champ efface les séries");
});

await test("ADAPT2. le sport du bloc est SÉLECTIONNÉ à l'écran, pas seulement présent dans la liste", () => {
  const html = renderToString(
    createElement(EditeurSeanceCalendrier, {
      meta: { name: "Mixte", durationMinutes: 75, coachNotes: "" },
      blocks: [BLOC_CARDIO],
      library: [],
      references: JULES,
      onEnregistrer: () => {},
    }),
  );
  assert.match(html, /<option[^>]*selected[^>]*value="course"|<option[^>]*value="course"[^>]*selected/);
  assert.match(html, /value="3"/, "les 3 séries du bloc doivent être affichées");
});

/* ════════════════════════════════════════════════════════════════════════
 * X. LES RÉFÉRENCES DE L'ATHLÈTE ATTEIGNENT LES SEGMENTS
 * ════════════════════════════════════════════════════════════════════════ */

function rendreEditeurComplet(references?: ReferencesAthlete) {
  return renderToString(
    createElement(EditeurSeanceCalendrier, {
      meta: { name: "Mixte", durationMinutes: 75, coachNotes: "" },
      blocks: [BLOC_MUSCU, BLOC_CARDIO],
      library: [],
      references,
      onEnregistrer: () => {},
    }),
  );
}

await test("PHYSIO1. avec les références de l'athlète, le segment affiche SA vitesse et SON allure", () => {
  const lu = texte(rendreEditeurComplet(JULES));
  assert.ok(lu.includes("16"), "100 % de VMA = 16 km/h pour cet athlète");
  assert.ok(/km\/h/.test(lu), "la vitesse calculée doit être lisible sur la ligne du segment");
  assert.ok(/3:45|3:45\/km/.test(lu), "16 km/h → 3:45/km : l'allure doit être calculée, pas laissée au coach");
});

await test("PHYSIO2. SANS références, rien n'est inventé — et l'aide de rédaction réapparaît", () => {
  const lu = texte(rendreEditeurComplet(undefined));
  assert.ok(
    lu.includes("VMA réf. aperçu"),
    "dans le builder de programme il n'y a pas d'athlète : le champ d'aide doit rester",
  );
  const avec = texte(rendreEditeurComplet(JULES));
  assert.ok(
    !avec.includes("VMA réf. aperçu"),
    "afficher une VMA saisie à la main à côté des vraies références ferait croire qu'elle influence ce que l'élève verra",
  );
});

await test("PHYSIO3. une référence absente est DITE, jamais remplacée par une valeur", () => {
  const sansVma: ReferencesAthlete = { ...JULES, vmaCourseKmh: VALEUR_ABSENTE };
  const lu = texte(
    renderToString(
      createElement(EditeurSeanceCalendrier, {
        meta: { name: "Cardio", durationMinutes: null, coachNotes: "" },
        blocks: [{ ...BLOC_CARDIO, position: 0 }],
        library: [],
        references: sansVma,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(/référence indisponible/i.test(lu), "le coach doit voir POURQUOI rien n'est calculé");
  assert.ok(!/ 16 km\/h/.test(lu), "aucune vitesse ne doit apparaître sans VMA");
});

await test("PHYSIO4. un bloc cardio SANS sport le signale au lieu de convertir au hasard", () => {
  const lu = texte(
    renderToString(
      createElement(EditeurSeanceCalendrier, {
        meta: { name: "Cardio", durationMinutes: null, coachNotes: "" },
        blocks: [{ ...BLOC_CARDIO, position: 0, sport: undefined }],
        library: [],
        references: JULES,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(/sport du bloc non renseign/i.test(lu), "%VMA course ≠ %VMA natation : sans sport, convertir serait arbitraire");
});

/* ════════════════════════════════════════════════════════════════════════
 * XI. L'ÉCRAN COMPLET — musculation ET cardio, et le type déduit
 * ════════════════════════════════════════════════════════════════════════ */

await test("ECRAN1. l'éditeur complet montre la musculation ET le cardio de la séance", () => {
  const html = rendreEditeurComplet(JULES);
  const lu = texte(html);
  /*
   * ⚠️ « Squat » EST CHERCHÉ DANS LE HTML, PAS DANS LE TEXTE. Le nom d'un
   * exercice est la VALEUR d'un champ de saisie : `texte()` retire les balises,
   * et donc les attributs. Le chercher dans le texte rendu échouerait alors même
   * que l'exercice est bien éditable — un test faussement rouge.
   */
  assert.ok(
    html.includes('value="Squat"'),
    "l'exercice de musculation doit être ÉDITABLE ici, pas seulement visible ailleurs",
  );
  assert.ok(lu.includes("Effort") || html.includes('value="Effort"') || lu.includes("VMA courte"), "le bloc cardio doit être présent");
  assert.ok(lu.includes("Ajouter un bloc"), "il faut pouvoir ajouter un bloc des DEUX catégories");
});

await test("ECRAN2. le type de séance est affiché comme DÉDUIT, et n'est pas un champ de saisie", () => {
  const html = rendreEditeurComplet(JULES);
  const lu = texte(html);
  assert.ok(lu.includes("Mixte"), "musculation + cardio = mixte");
  assert.ok(lu.includes("déduit des blocs"), "l'écran doit dire que le type n'est pas saisi");
  assert.ok(
    !/name="sessionType"|id="sessionType"/.test(html),
    "un sélecteur de type permettrait à l'étiquette de contredire le contenu",
  );
});

await test("ECRAN3. l'aperçu d'une séance liste aussi les blocs de MUSCULATION", () => {
  const source = sansCommentaires(lireSource("components/admin/cardio/CalendrierAthlete.tsx"));
  assert.ok(
    /muscu\.map\(/.test(source),
    "un aperçu qui n'affiche que le cardio annonce « aucun bloc cardio » sur une séance de musculation bien remplie",
  );
  assert.ok(
    !/Cette séance ne contient aucun bloc cardio/.test(source),
    "ce message était faux dès qu'une séance de musculation entrait dans le calendrier",
  );
});

await test("ECRAN4. une séance sans sport affiche son TYPE dans la grille, pas un tiret", () => {
  const source = sansCommentaires(lireSource("components/admin/cardio/CalendrierAthlete.tsx"));
  assert.ok(
    /LIBELLE_TYPE\[seance\.typeDerive\]/.test(source),
    "une séance de musculation n'a pas de sport : la pastille affichait « — »",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * XII. LE BUILDER DE PROGRAMME N'A PAS ÉTÉ DÉTOURNÉ
 * ════════════════════════════════════════════════════════════════════════ */

await test("BUILDER1. les références restent OPTIONNELLES dans le builder de blocs", () => {
  for (const chemin of [
    "components/admin/blocks/SessionBlockList.tsx",
    "components/admin/blocks/TrainingBlockCard.tsx",
    "components/admin/blocks/CardioBlockEditor.tsx",
  ]) {
    const source = sansCommentaires(lireSource(chemin));
    assert.ok(
      /references\?:\s*ReferencesAthlete/.test(source),
      `${chemin} : un programme MODÈLE n'appartient à personne, les références ne peuvent pas être obligatoires`,
    );
  }
});

await test("BUILDER2. le panneau du builder de programme ne transmet AUCUNE référence", () => {
  const source = sansCommentaires(lireSource("components/admin/blocks/SessionBlockPanel.tsx"));
  assert.ok(
    !/references=/.test(source),
    "le builder de programme n'a pas d'athlète : y injecter des références afficherait les valeurs de quelqu'un",
  );
});

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
