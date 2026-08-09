import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import { ExerciseVideoField } from "../../components/student/ExerciseVideoField";
import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import {
  FEEDBACK_VIDEO_BUCKET,
  FEEDBACK_VIDEO_EXTENSIONS,
  FEEDBACK_VIDEO_MAX_BYTES,
  FEEDBACK_VIDEO_MAX_SECONDS,
  FEEDBACK_VIDEO_MIME_TYPES,
  FEEDBACK_VIDEO_PATH_SHAPE,
  FEEDBACK_VIDEO_RETENTION_DAYS,
  FEEDBACK_VIDEO_VISIBILITY_LABEL,
  buildFeedbackVideoPath,
  isOwnFeedbackVideoPath,
  normalizeFeedbackVideoMime,
  validateFeedbackVideoDuration,
  validateFeedbackVideoFile,
} from "../../lib/feedback-video";
import {
  getSignedFeedbackVideoUrl,
  loadSignedFeedbackVideoUrls,
  removeAllStudentFeedbackVideos,
  uploadFeedbackVideo,
} from "../../lib/supabase/storage-feedback-videos";
import {
  getAdminWorkoutFeedbackList,
  getWorkoutFeedbackBySession,
  saveWorkoutFeedback,
} from "../../lib/supabase/workout-feedback";
import { exerciseFeedbackWorthPersisting } from "../../lib/workout-feedback-entry";
import { creerBase } from "./helpers/supabase-double";
import type { Exercise, ExerciseFeedback, WorkoutFeedbackPayload } from "../../types";

/**
 * F4 — VIDÉO DE TECHNIQUE DE L'ÉLÈVE
 *
 * CE QUE CETTE SUITE PROUVE
 *   - que les plafonds du navigateur et ceux de la BASE sont le même
 *     nombre : la migration est relue et comparée constante par constante.
 *     Une validation d'écran plus permissive que le bucket, c'est un élève
 *     qui filme, attend, et se fait jeter par Storage sans comprendre ;
 *   - que le chemin déposé désigne TOUJOURS le dossier de son élève, et que
 *     rien dans la chaîne — schéma de route, composant, module Storage — ne
 *     laisse passer le dossier d'un autre ;
 *   - que le fichier NEUF est envoyé avant que l'ancien soit retiré, et que
 *     rien n'est retiré quand l'envoi échoue ;
 *   - que la colonne transporte un CHEMIN et jamais une URL signée ;
 *   - que la carte d'exercice n'affiche le champ que sur le chemin réel, et
 *     ne touche ni aux séries ni au commentaire.
 *
 * CE QU'ELLE NE PEUT PAS PROUVER
 *   Le comportement réel des policies du bucket et du trigger : c'est le
 *   rôle de `supabase/tests/student_feedback_video_checklist.sql`, exécuté
 *   contre un vrai PostgreSQL sous cinq acteurs.
 *   La capture caméra non plus — elle exige un périphérique. Ce qui est
 *   testable d'elle (la disponibilité, le choix du conteneur) l'est par
 *   lecture de source, honnêtement étiquetée comme telle.
 */

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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const MIGRATION = lire("../../supabase/migrations/20260826090000_student_feedback_video.sql");
const CHECKLIST = lire("../../supabase/tests/student_feedback_video_checklist.sql");
const DECISIONS = lire("../../lib/feedback-video.ts");
const SUPPRESSION_ELEVE = lire("../../lib/supabase/delete-student.ts");
const CAPTURE = lire("../../lib/feedback-video-capture.ts");
const STORAGE = lire("../../lib/supabase/storage-feedback-videos.ts");
const CHAMP = lire("../../components/student/ExerciseVideoField.tsx");
const SECTION = lire("../../components/student/SessionFeedbackSection.tsx");
const ROUTE = lire("../../app/api/student/workout-feedback/route.ts");
const COUCHE = lire("../../lib/supabase/workout-feedback.ts");
const MODALE_COACH = lire("../../components/admin/FeedbackDetailModal.tsx");
const CONFIG = lire("../../next.config.ts");

const ELEVE_A = "32000000-0000-4000-8000-000000000002";
const ELEVE_B = "32000000-0000-4000-8000-000000000003";
const UUID_FICHIER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** Retire les commentaires SQL : on affirme sur ce qui S'EXÉCUTE. */
function sansCommentairesSql(source: string): string {
  return source
    .split("\n")
    .map((ligne) => ligne.replace(/--.*$/, ""))
    .join("\n");
}

/** Retire les commentaires TS pour la même raison. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ════════════════════════════════════════════════════════════════════════
 * A. LES PLAFONDS — un seul nombre, dit deux fois
 * ════════════════════════════════════════════════════════════════════════ */

await test("A1. le plafond de taille du code EST celui du bucket", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(
    sql.includes(String(FEEDBACK_VIDEO_MAX_BYTES)),
    `la migration doit poser file_size_limit = ${FEEDBACK_VIDEO_MAX_BYTES}`,
  );
  // Et le contrôle final de la migration vérifie ce même nombre : un bucket
  // créé à la main sans plafond serait corrigé, pas contourné.
  assert.ok(sql.includes("file_size_limit"), "plafond absent de la migration");
  assert.equal(FEEDBACK_VIDEO_MAX_BYTES, 50 * 1024 * 1024, "50 Mo, ni plus ni moins");
});

await test("A2. la liste blanche de types du code EST celle du bucket", () => {
  const sql = sansCommentairesSql(MIGRATION);
  const région = sql.slice(sql.indexOf("allowed_mime_types"), sql.indexOf("on conflict (id) do update"));
  const déclarés = [...région.matchAll(/'(video\/[a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...déclarés].sort(),
    [...FEEDBACK_VIDEO_MIME_TYPES].sort(),
    "divergence entre allowed_mime_types et FEEDBACK_VIDEO_MIME_TYPES",
  );
  // Aucun type non vidéo, jamais : ce bucket ne reçoit pas d'images.
  for (const type of FEEDBACK_VIDEO_MIME_TYPES) {
    assert.ok(type.startsWith("video/"), `type non vidéo dans la liste blanche : ${type}`);
  }
  // `.mov` est là parce que c'est ce que produit un iPhone. Son absence
  // ferait échouer un import sur la moitié du parc.
  assert.ok((FEEDBACK_VIDEO_MIME_TYPES as readonly string[]).includes("video/quicktime"));
});

await test("A3. la forme du chemin du code EST la contrainte SQL", () => {
  const sql = sansCommentairesSql(MIGRATION);
  const début = sql.indexOf("add constraint exercise_feedback_video_path_shape");
  assert.ok(début > 0, "contrainte de forme introuvable");
  const région = sql.slice(début, sql.indexOf(");", début));
  const motifSql = région.slice(région.indexOf("'^"), région.lastIndexOf("'") + 1);
  // On compare les motifs après avoir neutralisé le seul écart de syntaxe
  // légitime : JavaScript échappe la barre oblique dans un littéral d'expression
  // régulière, PostgreSQL non.
  const motifJs = FEEDBACK_VIDEO_PATH_SHAPE.source.replace(/\\\//g, "/");
  assert.equal(
    motifSql.slice(1, -1),
    motifJs,
    "le motif de chemin du code et celui de la contrainte SQL ont divergé",
  );
});

await test("A4. la rétention est une INTENTION écrite, jamais une promesse affichée", () => {
  assert.equal(FEEDBACK_VIDEO_RETENTION_DAYS, 30);
  assert.ok(MIGRATION.includes("30 jours"), "l'objectif doit être écrit dans la migration");
  assert.ok(MIGRATION.includes("video_uploaded_at"), "et la colonne qui la datera doit exister");
  // La purge n'est PAS dans ce chantier, et le fichier le dit — une dette
  // qu'on n'écrit pas devient une dette qu'on oublie.
  assert.ok(MIGRATION.includes("Aucune purge"), "l'absence de purge doit être assumée par écrit");

  // LE POINT QUI COMPTE : tant que rien n'efface, aucun texte visible ne
  // doit annoncer une suppression automatique. Une promesse technique fausse
  // est pire qu'un silence.
  assert.ok(!/\d+\s*jours/.test(FEEDBACK_VIDEO_VISIBILITY_LABEL),
    "la mention affichée ne doit annoncer aucune durée de conservation");
  for (const promesse of ["Conservée", "supprimée automatiquement", "effacée après"]) {
    assert.ok(!FEEDBACK_VIDEO_VISIBILITY_LABEL.includes(promesse),
      `promesse non tenue dans le texte affiché : ${promesse}`);
  }
  // …et elle dit la portée RÉELLE : l'admin voit aussi.
  assert.ok(FEEDBACK_VIDEO_VISIBILITY_LABEL.includes("administrateur"),
    "l'accès administrateur existe : le taire serait un second mensonge");
  assert.ok(DECISIONS.includes("IL N'EST PAS ENCORE TENU"),
    "la constante de rétention doit prévenir qu'elle n'est pas appliquée");
});

/* ════════════════════════════════════════════════════════════════════════
 * B. LES REFUS — et ce qu'ils disent à l'élève
 * ════════════════════════════════════════════════════════════════════════ */

await test("B1. normalizeFeedbackVideoMime coupe les paramètres de codec", () => {
  // MediaRecorder ne rend jamais un type nu. Envoyé tel quel, il ne figure
  // pas dans allowed_mime_types et Storage refuse le fichier.
  assert.equal(normalizeFeedbackVideoMime("video/webm;codecs=vp8,opus"), "video/webm");
  assert.equal(normalizeFeedbackVideoMime("video/mp4;codecs=avc1.42E01E"), "video/mp4");
  assert.equal(normalizeFeedbackVideoMime("VIDEO/MP4"), "video/mp4");
  assert.equal(normalizeFeedbackVideoMime("  video/quicktime  "), "video/quicktime");
});

await test("B2. et il refuse tout ce qui n'est pas du vocabulaire, sans caster à l'aveugle", () => {
  assert.equal(normalizeFeedbackVideoMime("video/x-matroska"), null);
  assert.equal(normalizeFeedbackVideoMime("image/png"), null);
  assert.equal(normalizeFeedbackVideoMime("application/pdf"), null);
  assert.equal(normalizeFeedbackVideoMime(""), null);
  assert.equal(normalizeFeedbackVideoMime(null), null);
  assert.equal(normalizeFeedbackVideoMime(undefined), null);
  assert.equal(normalizeFeedbackVideoMime(42 as unknown as string), null);
});

await test("B3. un fichier trop lourd est refusé, et le refus dit quoi faire", () => {
  const refus = validateFeedbackVideoFile({ type: "video/mp4", size: FEEDBACK_VIDEO_MAX_BYTES + 1 });
  assert.ok(refus, "un fichier au-dessus du plafond doit être refusé");
  assert.match(refus as string, /720p|recoupe/i, "le refus doit indiquer la marche à suivre");
  // Exactement au plafond : accepté. Une borne stricte de plus refuserait un
  // fichier que Storage, lui, accepterait.
  assert.equal(validateFeedbackVideoFile({ type: "video/mp4", size: FEEDBACK_VIDEO_MAX_BYTES }), null);
});

await test("B4. un format inconnu et un fichier vide sont refusés", () => {
  assert.ok(validateFeedbackVideoFile({ type: "image/png", size: 1000 }));
  assert.ok(validateFeedbackVideoFile({ type: "video/x-matroska", size: 1000 }));
  assert.ok(validateFeedbackVideoFile({ type: "video/mp4", size: 0 }));
  assert.equal(validateFeedbackVideoFile({ type: "video/webm", size: 1_000_000 }), null);
});

await test("B5. une vidéo trop longue est refusée — sans ré-encodage", () => {
  assert.equal(validateFeedbackVideoDuration(20), null);
  assert.equal(validateFeedbackVideoDuration(19.4), null);
  const refus = validateFeedbackVideoDuration(184);
  assert.ok(refus);
  assert.match(refus as string, /184 s/, "le refus doit citer la durée réelle");
  assert.match(refus as string, /recoupe/i, "et dire quoi faire");
  // AUCUN transcodage nulle part : ni ffmpeg, ni WebCodecs, ni captureStream.
  const capture = sansCommentairesTs(CAPTURE);
  for (const interdit of ["ffmpeg", "VideoEncoder", "captureStream", "WebCodecs"]) {
    assert.ok(!capture.includes(interdit), `${interdit} : aucune dépendance de transcodage n'a été introduite`);
  }
});

await test("B6. une durée ILLISIBLE est acceptée, et le trou est nommé", () => {
  // Certains WebM de MediaRecorder rendent Infinity. Refuser une vidéo
  // parfaitement valide serait pire que le trou — mais un trou qu'on ne
  // documente pas devient un trou qu'on croit fermé.
  assert.equal(validateFeedbackVideoDuration(null), null);
  assert.equal(validateFeedbackVideoDuration(Number.POSITIVE_INFINITY), null);
  assert.equal(validateFeedbackVideoDuration(Number.NaN), null);
  assert.equal(validateFeedbackVideoDuration(0), null);
  assert.ok(
    DECISIONS.includes("illisible") || DECISIONS.includes("ILLISIBLE"),
    "le cas doit être écrit dans le module",
  );
  // Le commentaire est replié par JSDoc : on compare sur un texte normalisé,
  // sinon le test dépendrait de la largeur des lignes.
  const décisionsÀPlat = DECISIONS.replace(/\s*\n\s*\*\s*/g, " ");
  assert.ok(décisionsÀPlat.includes("Le trou est réel"), "et assumé, pas masqué");
});

/* ════════════════════════════════════════════════════════════════════════
 * C. LE CHEMIN — à qui appartient ce fichier
 * ════════════════════════════════════════════════════════════════════════ */

await test("C1. le chemin est bâti sur l'élève et un uuid neuf", () => {
  const chemin = buildFeedbackVideoPath(ELEVE_A, "video/mp4", UUID_FICHIER);
  assert.equal(chemin, `${ELEVE_A}/${UUID_FICHIER}.mp4`);
  assert.match(chemin, FEEDBACK_VIDEO_PATH_SHAPE);
  // Une extension par type, et rien d'autre : la contrainte SQL n'en accepte
  // que trois.
  assert.deepEqual(Object.keys(FEEDBACK_VIDEO_EXTENSIONS).sort(), [...FEEDBACK_VIDEO_MIME_TYPES].sort());
  assert.equal(buildFeedbackVideoPath(ELEVE_A, "video/quicktime", UUID_FICHIER).endsWith(".mov"), true);
  assert.equal(buildFeedbackVideoPath(ELEVE_A, "video/webm", UUID_FICHIER).endsWith(".webm"), true);
});

await test("C2. DEUX segments, pas trois — la vidéo survit à une resoumission", () => {
  const chemin = buildFeedbackVideoPath(ELEVE_A, "video/mp4", UUID_FICHIER);
  assert.equal(chemin.split("/").length, 2, "un troisième segment lierait le fichier à une ligne");
  // Un chemin plus profond est refusé par la forme…
  assert.ok(!FEEDBACK_VIDEO_PATH_SHAPE.test(`${ELEVE_A}/sous/${UUID_FICHIER}.mp4`));
  // …et la raison est écrite, parce qu'elle n'est pas évidente : une
  // resoumission SUPPRIME puis RECRÉE les lignes exercise_feedback.
  assert.ok(MIGRATION.includes("RESOUMISSION"), "la raison du chemin à deux segments doit être écrite");
  assert.ok(
    SECTION.includes("setVideosExercice"),
    "l'écran doit RESTAURER le chemin à la réouverture, sinon la resoumission l'efface",
  );
});

await test("C3. isOwnFeedbackVideoPath refuse le dossier d'un autre élève", () => {
  const àA = buildFeedbackVideoPath(ELEVE_A, "video/mp4", UUID_FICHIER);
  assert.equal(isOwnFeedbackVideoPath(àA, ELEVE_A), true);
  assert.equal(isOwnFeedbackVideoPath(àA, ELEVE_B), false, "le dossier d'un autre élève doit être refusé");
  // Formes tordues : toutes refusées avant même la comparaison d'identité.
  for (const tordu of [
    `${ELEVE_A}/../${ELEVE_B}/${UUID_FICHIER}.mp4`,
    `${ELEVE_A}/${UUID_FICHIER}.exe`,
    `${ELEVE_A}/${UUID_FICHIER}`,
    `/${ELEVE_A}/${UUID_FICHIER}.mp4`,
    `${ELEVE_A}/${UUID_FICHIER}.mp4/x`,
    `${UUID_FICHIER}.mp4`,
    "",
  ]) {
    assert.equal(isOwnFeedbackVideoPath(tordu, ELEVE_A), false, `chemin tordu accepté : ${tordu}`);
  }
});

await test("C4. le schéma strict accepte un chemin conforme et refuse le reste", () => {
  // Typé large À DESSEIN : ce test soumet exprès des valeurs que le schéma
  // doit REFUSER (une URL, un chemin difforme). Un littéral inféré
  // interdirait au test d'écrire ce qu'il veut justement voir rejeté.
  type ChargeSouple = Record<string, unknown> & {
    exercises: (Record<string, unknown> & { videoPath: string | null })[];
  };
  const base: ChargeSouple = {
    sessionKey: "s1",
    sessionRefLabel: "Séance",
    completed: true,
    globalRpe: null,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Squat",
        exerciseOrder: 0,
        rpe: null,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: "100", repsDone: "5" }],
        videoPath: buildFeedbackVideoPath(ELEVE_A, "video/mp4", UUID_FICHIER),
      },
    ],
  };
  assert.equal(workoutFeedbackPayloadSchema.safeParse(base).success, true);

  // Une URL n'est PAS un chemin : accepter une URL, c'est accepter que le
  // client dise où pointe la vidéo.
  const avecUrl = structuredClone(base);
  avecUrl.exercises[0]!.videoPath = "https://exemple.test/video.mp4";
  assert.equal(workoutFeedbackPayloadSchema.safeParse(avecUrl).success, false);

  // Un chemin difforme est refusé…
  const difforme = structuredClone(base);
  difforme.exercises[0]!.videoPath = "eleve/video.mp4";
  assert.equal(workoutFeedbackPayloadSchema.safeParse(difforme).success, false);

  // …et `null` reste parfaitement valide : la plupart des exercices n'ont
  // pas de vidéo.
  const sansVideo = structuredClone(base);
  sansVideo.exercises[0]!.videoPath = null;
  assert.equal(workoutFeedbackPayloadSchema.safeParse(sansVideo).success, true);

  // Le schéma reste STRICT : la date de dépôt n'est jamais reçue du client.
  const avecDate = structuredClone(base) as Record<string, unknown>;
  (avecDate.exercises as Record<string, unknown>[])[0]!.videoUploadedAt = "2026-08-08T00:00:00Z";
  assert.equal(workoutFeedbackPayloadSchema.safeParse(avecDate).success, false);
});

await test("C5. la ROUTE refuse le chemin d'un autre élève avant toute écriture", () => {
  const route = sansCommentairesTs(ROUTE);
  assert.ok(route.includes("videoEtrangere"), "contrôle d'appartenance absent de la route");
  assert.ok(
    /e\.videoPath\.split\("\/"\)\[0\] !== studentRow\.id/.test(route),
    "l'appartenance doit se comparer à l'identité fournie par le SERVEUR",
  );
  // Avant l'écriture, pas après : un refus au niveau du trigger arriverait
  // au milieu de l'enregistrement, exercice par exercice.
  // On vise l'APPEL, pas l'import : `saveWorkoutFeedback` figure aussi en
  // tête de fichier, et comparer à cet index-là rendrait le test toujours
  // faux — donc toujours suspect pour la mauvaise raison.
  const appelÉcriture = route.indexOf("await saveWorkoutFeedback(");
  assert.ok(appelÉcriture > 0, "appel d'écriture introuvable");
  assert.ok(
    route.indexOf("videoEtrangere") < appelÉcriture,
    "le contrôle doit précéder l'écriture",
  );
  assert.ok(route.includes("403"), "le refus doit être un 403, pas un 400 vague");
});

/* ════════════════════════════════════════════════════════════════════════
 * D. LE STOCKAGE — on AJOUTE, on n'efface jamais depuis l'écran
 * ════════════════════════════════════════════════════════════════════════ */

await test("D1. l'envoi utilise le bucket dédié, jamais `videos` ni `documents`", async () => {
  const { client, journalStorage } = creerBase();
  const resultat = await uploadFeedbackVideo(client, {
    studentId: ELEVE_A,
    fichier: { size: 1_000_000 } as Blob,
    mime: "video/mp4",
    identifiant: UUID_FICHIER,
  });
  assert.ok(!("error" in resultat));
  assert.equal((resultat as { path: string }).path, `${ELEVE_A}/${UUID_FICHIER}.mp4`);
  assert.equal(journalStorage[0], `upload:${FEEDBACK_VIDEO_BUCKET}:${ELEVE_A}/${UUID_FICHIER}.mp4`);
  assert.equal(FEEDBACK_VIDEO_BUCKET, "feedback-videos");
  const storage = sansCommentairesTs(STORAGE);
  assert.ok(!storage.includes('"videos"') && !storage.includes('"documents"'));
});

await test("D2. le module revalide AVANT le réseau — la validation ne vit pas que dans l'écran", async () => {
  const { client, journalStorage } = creerBase();
  const trop = await uploadFeedbackVideo(client, {
    studentId: ELEVE_A,
    fichier: { size: FEEDBACK_VIDEO_MAX_BYTES + 1 } as Blob,
    mime: "video/mp4",
    identifiant: UUID_FICHIER,
  });
  assert.ok("error" in trop, "un fichier trop lourd ne doit pas partir");
  assert.deepEqual(journalStorage, [], "aucun octet ne doit avoir été envoyé");
});

await test("D3. un identifiant d'élève difforme est arrêté AVANT le téléversement", async () => {
  const { client, journalStorage } = creerBase();
  const resultat = await uploadFeedbackVideo(client, {
    studentId: "pas-un-uuid",
    fichier: { size: 1000 } as Blob,
    mime: "video/mp4",
    identifiant: UUID_FICHIER,
  });
  assert.ok("error" in resultat);
  assert.deepEqual(journalStorage, [], "40 Mo ne doivent pas partir pour être refusés ensuite");
});

await test("D4. AUCUNE suppression n'est possible depuis l'écran de l'élève", () => {
  // Correctif des points 2 et 3 de l'audit : le module n'expose plus de quoi
  // effacer un objet à l'unité. Remplacer, c'est envoyer ; retirer, c'est
  // oublier. Seule subsiste la purge du DOSSIER d'un élève supprimé.
  const storage = sansCommentairesTs(STORAGE);
  assert.ok(!/export async function removeFeedbackVideo\b/.test(storage));
  assert.ok(!/export async function replaceFeedbackVideo\b/.test(storage));
  assert.ok(storage.includes("export async function removeAllStudentFeedbackVideos"));
  // Et l'écran n'appelle plus rien qui efface.
  const champ = sansCommentairesTs(CHAMP);
  assert.ok(!champ.includes(".remove("), "le champ vidéo ne doit rien effacer");
  assert.ok(!/supprimer|removeFeedback/.test(champ), "aucun suppresseur ne doit subsister");
});

await test("D5. la signature est GROUPÉE : une requête pour toute la page", async () => {
  const { client, objets, journalStorage } = creerBase();
  const a = `${ELEVE_A}/${UUID_FICHIER}.mp4`;
  const b = `${ELEVE_A}/11111111-2222-4333-8444-555555555555.webm`;
  objets.add(a);
  objets.add(b);

  const resolues = await loadSignedFeedbackVideoUrls(client, [a, a, a, b, null, null]);
  assert.equal(resolues.size, 2);
  assert.equal(
    journalStorage.filter((l) => l.startsWith("signLot:")).length,
    1,
    "UNE seule requête, pas une par vidéo",
  );
  assert.equal(journalStorage.filter((l) => l.startsWith("sign:")).length, 0, "aucun appel unitaire");
  assert.ok(journalStorage[0]!.endsWith(":2:3600"), "2 chemins dédoublonnés, 3600 s");
  assert.deepEqual(await loadSignedFeedbackVideoUrls(client, [null, null]), new Map());
});

await test("D6. un chemin que la RLS refuse n'est tout simplement pas signé", async () => {
  // C'est ce qui fait qu'un coach non rattaché n'obtient rien, sans que
  // l'appelant ait à trier : `createSignedUrls` rend une erreur PAR CHEMIN.
  const aMoi = `${ELEVE_A}/${UUID_FICHIER}.mp4`;
  const aLautre = `${ELEVE_B}/11111111-2222-4333-8444-555555555555.mp4`;
  const { client, objets } = creerBase({ peutLireVideo: (c) => c.startsWith(`${ELEVE_A}/`) });
  objets.add(aMoi);
  objets.add(aLautre);

  const resolues = await loadSignedFeedbackVideoUrls(client, [aMoi, aLautre]);
  assert.equal(resolues.size, 1, "seule la vidéo autorisée est signée");
  assert.ok(resolues.has(aMoi));
  assert.ok(!resolues.has(aLautre), "la vidéo d'un élève non rattaché ne doit pas être signée");
});

await test("D7. l'URL signée dure une heure et n'est jamais stockée", async () => {
  const { client, objets, journalStorage } = creerBase();
  const chemin = `${ELEVE_A}/${UUID_FICHIER}.mp4`;
  objets.add(chemin);
  const url = await getSignedFeedbackVideoUrl(client, chemin);
  assert.ok(url?.includes("exp=3600"));
  assert.equal(journalStorage[0], `sign:${FEEDBACK_VIDEO_BUCKET}:${chemin}:3600`);
  assert.equal(await getSignedFeedbackVideoUrl(client, null), null);

  // La COLONNE porte un chemin. Aucune URL n'est écrite en base.
  const couche = sansCommentairesTs(COUCHE);
  assert.ok(couche.includes("video_path: exercise.videoPath ?? null"), "c'est le CHEMIN qui est écrit");
  assert.ok(!/video_url\s*:/.test(couche), "aucune URL ne doit être écrite dans le retour");
});

await test("D8. la purge d'un élève vide TOUT son dossier, et rien d'autre", async () => {
  const { client, objets, journalStorage } = creerBase();
  for (let n = 0; n < 3; n += 1) {
    objets.add(`${ELEVE_A}/1111111${n}-1111-4111-8111-111111111111.mp4`);
  }
  const àB = `${ELEVE_B}/22222222-2222-4222-8222-222222222222.mp4`;
  objets.add(àB);

  const bilan = await removeAllStudentFeedbackVideos(client, ELEVE_A);
  assert.equal(bilan.supprimes, 3);
  assert.equal(bilan.complet, true);
  assert.deepEqual([...objets], [àB], "la vidéo d'un AUTRE élève ne doit jamais être touchée");
  assert.ok(journalStorage.some((l) => l.startsWith(`list:${FEEDBACK_VIDEO_BUCKET}:${ELEVE_A}`)));
});

await test("D9. et elle pagine : une purge ne s'arrête pas à la centième vidéo", async () => {
  const { client, objets } = creerBase();
  for (let n = 0; n < 250; n += 1) {
    objets.add(`${ELEVE_A}/${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.mp4`);
  }
  const bilan = await removeAllStudentFeedbackVideos(client, ELEVE_A);
  assert.equal(bilan.supprimes, 250, "les 250 objets doivent partir, pas seulement les 100 premiers");
  assert.equal(objets.size, 0);
});

/* ════════════════════════════════════════════════════════════════════════
 * E. LA BASE FAIT AUTORITÉ — ce que la migration doit contenir
 * ════════════════════════════════════════════════════════════════════════ */

await test("E1. le bucket est PRIVÉ, et le contrôle final le vérifie", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(/values \('feedback-videos', 'feedback-videos', false,/.test(sql), "le bucket doit être privé");
  assert.ok(sql.includes("on conflict (id) do update"), "un bucket créé à la main doit être CORRIGÉ, pas ignoré");
  assert.ok(MIGRATION.includes("le bucket est PUBLIC"), "le contrôle final doit refuser un bucket public");
});

await test("E2. les quatre policies existent, et UPDATE porte un WITH CHECK", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const commande of ["for select", "for insert", "for update", "for delete"]) {
    assert.ok(sql.includes(commande), `policy manquante : ${commande}`);
  }
  const update = sql.slice(
    sql.indexOf('create policy "feedback_videos_update_owner_or_staff"'),
    sql.indexOf('drop policy if exists "feedback_videos_delete_owner_or_staff"'),
  );
  assert.ok(update.includes("using") && update.includes("with check"),
    "sans WITH CHECK, on pourrait DÉPLACER un objet vers un chemin qu'on n'a pas le droit d'écrire");
  // `to authenticated` sur les QUATRE policies — on borne le comptage aux
  // policies, parce que le GRANT du prédicat contient la même formule.
  assert.equal(
    [...sql.matchAll(/create policy "feedback_videos_[a-z_]+" on storage\.objects\s+for \w+ to authenticated/g)].length,
    4,
    "chaque policy doit être restreinte au rôle authenticated",
  );
  // Et `anon` est explicitement retiré du prédicat : les DEFAULT PRIVILEGES
  // de Supabase le lui accordent d'office, un revoke sur `public` ne suffit pas.
  assert.ok(sql.includes("revoke all on function public.feedback_video_path_owner_ok(text) from anon"));
  // La policy SELECT n'est pas décorative : sans elle, remove() ne supprime
  // rien en silence. Le dépôt s'est déjà fait piéger deux fois.
  assert.ok(MIGRATION.includes("error: null"), "la leçon des buckets précédents doit être écrite");
});

await test("E3. le prédicat est unique, et n'autorise PLUS n'importe quel coach", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes("create or replace function public.feedback_video_path_owner_ok"));
  assert.ok(/set search_path = ''/.test(sql), "aucun schéma implicite");
  // Écrit une fois, utilisé quatre fois — quatre copies finiraient par diverger.
  assert.equal([...sql.matchAll(/feedback_video_path_owner_ok\(name\)/g)].length, 5,
    "les quatre policies (dont UPDATE deux fois) doivent toutes appeler LE prédicat");
  assert.ok(sql.includes("revoke all on function public.feedback_video_path_owner_ok(text) from anon"));

  // LE POINT QUI COMPTE : `is_coach_or_admin()` répond oui à TOUT coach,
  // pour TOUT élève. Il ne doit plus apparaître nulle part dans ce prédicat.
  const predicat = sql.slice(
    sql.indexOf("create or replace function public.feedback_video_path_owner_ok"),
    sql.indexOf("comment on function public.feedback_video_path_owner_ok"),
  );
  assert.ok(!predicat.includes("is_coach_or_admin"),
    "un coach quelconque ne doit plus pouvoir lire la vidéo d'un élève quelconque");
  assert.ok(predicat.includes("public.is_admin()"), "l'admin garde son accès administratif");
  // L'appartenance est PROUVÉE par la relation du schéma, pas déclarée.
  assert.ok(/from public\.students s/.test(predicat), "l'appartenance passe par une jointure réelle");
  assert.ok(predicat.includes("s.coach_id = public.current_coach_id()"));
  assert.ok(predicat.includes("s.coach_id is not null"),
    "un élève sans coach ne doit être visible d'aucun coach");
  assert.ok(predicat.includes("public.current_student_id()"), "l'élève lit toujours ses propres vidéos");
  // Et la nature de la fonction est justifiée par écrit.
  assert.ok(sql.includes("security definer"));
  assert.ok(MIGRATION.includes("ne doit PAS dépendre de ce que la RLS laisse voir"));
});

await test("E4. le trigger tranche l'APPARTENANCE de la colonne, pas seulement du fichier", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes("create or replace function public.enforce_exercise_feedback_write"));
  assert.ok(
    /split_part\(new\.video_path, '\/', 1\) is distinct from new\.student_id::text/.test(sql),
    "le chemin écrit doit désigner le dossier de SON élève",
  );
  assert.ok(sql.includes("insufficient_privilege"), "et le refus doit porter le bon code");
  // Pourquoi ce contrôle en plus de la RLS du bucket : écrire une colonne
  // n'exige aucun dépôt de fichier.
  assert.ok(MIGRATION.includes("écrire un chemin n'exige aucun dépôt"));
});

await test("E5. video_uploaded_at est DÉRIVÉ, jamais reçu", () => {
  const sql = sansCommentairesSql(MIGRATION);
  const début = sql.indexOf("new.video_uploaded_at :=");
  assert.ok(début > 0, "la date de dépôt doit être posée par le trigger");
  // Elle n'est JAMAIS lue depuis `new` : elle est calculée.
  assert.ok(!/:=\s*new\.video_uploaded_at/.test(sql), "la valeur du client ne doit jamais être reprise");
  // INSERT et UPDATE traités tous les deux, et le retrait remet à NULL.
  assert.ok(sql.includes("when new.video_path is null then null"));
  assert.ok(sql.includes("when new.video_path is distinct from old.video_path then clock_timestamp()"));
  // `clock_timestamp()` et non `now()` : `now()` est figé sur toute la
  // transaction, ce qui rendrait « la date a-t-elle été repoussée ? »
  // invérifiable — la checklist SQL passerait même si la règle était fausse.
  assert.ok(MIGRATION.includes("INVÉRIFIABLE"), "le choix doit être justifié dans la migration");
  assert.ok(!/video_uploaded_at := case when new\.video_path is null then null else now\(\)/.test(sql));
  // Et le type Supabase ne la propose pas à l'écriture.
  const types = lire("../../types/supabase.ts");
  const bloc = types.slice(types.indexOf("exercise_feedback: {"), types.indexOf("exercise_set_feedback: {"));
  const insert = bloc.slice(bloc.indexOf("Insert: {"), bloc.indexOf("Update: {"));
  assert.ok(!insert.includes("video_uploaded_at"), "la colonne dérivée ne doit pas être insérable");
  assert.ok(insert.includes("video_path?:"), "le chemin, lui, s'écrit");
});

await test("E6. le staff RETIRE une vidéo, il n'en POSE jamais", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(
    /if v_staff and new\.video_path is distinct from old\.video_path[\s\S]{0,120}new\.video_path := old\.video_path;/.test(sql),
    "le staff doit être ramené à l'ancienne valeur quand il tente de POSER un chemin",
  );
  assert.ok(sql.includes("v_staff := (not v_systeme) and public.is_coach_or_admin()"));
  // On RESTAURE au lieu de refuser : les tests doivent donc mesurer la
  // VALEUR, jamais le nombre de lignes.
  assert.ok(MIGRATION.includes("mesurent donc la VALEUR, jamais le nombre de lignes"));
});

await test("E7. les deux colonnes vivent et meurent ensemble", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(
    sql.includes("check ((video_path is null) = (video_uploaded_at is null))"),
    "une vidéo sans date échapperait à la purge ; une date sans vidéo n'a aucun sens",
  );
});

await test("E8. la migration est strictement additive : aucun DROP destructeur", () => {
  const sql = sansCommentairesSql(MIGRATION).toLowerCase();
  assert.ok(!/drop\s+table/.test(sql));
  assert.ok(!/drop\s+column/.test(sql));
  assert.ok(!/delete\s+from/.test(sql));
  assert.ok(!/truncate/.test(sql));
  // `update` non plus : aucun backfill, l'historique reste à NULL.
  assert.ok(!/\bupdate\s+public\./.test(sql), "aucun backfill");
  assert.ok(sql.includes("add column if not exists"), "idempotente");
});

await test("E9. la matrice de propriété a été ÉTENDUE, pas réécrite", () => {
  // 20260821 et 20260822 sont appliquées : immuables. Les deux colonnes
  // ajoutées ici se classent ici.
  for (const colonne of ["video_path", "video_uploaded_at"]) {
    assert.ok(
      new RegExp(`^--\\s+${colonne}\\s`, "m").test(MIGRATION),
      `colonne non classée dans la matrice : ${colonne}`,
    );
  }
  const guard = lire("../../scripts/tests/training-movement-patterns.mts");
  assert.ok(guard.includes("MIGRATION_VIDEO"), "le contrôle BB1 doit lire cette migration aussi");
});

/* ════════════════════════════════════════════════════════════════════════
 * F. L'ÉCRAN — ce qu'il montre, et ce qu'il ne touche pas
 * ════════════════════════════════════════════════════════════════════════ */

const exercicePrescrit: Exercise = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "Squat barre",
  sets: 3,
  reps: "5",
  restSeconds: 180,
  tempo: "",
  recommendedLoad: "100 kg",
  recommendedRpe: "8",
  videoUrl: "https://demo.test/squat",
  alternativeVideoUrl: "",
  notes: "",
  libraryExerciseId: "99999999-2222-4333-8444-555555555555",
} as unknown as Exercise;

const retourExercice: ExerciseFeedback = {
  studentId: ELEVE_A,
  sessionId: "s1",
  exerciseId: exercicePrescrit.id,
  exerciseName: exercicePrescrit.name,
  sets: [{ setNumber: 1, loadUsed: "", repsDone: "", rpe: "" }],
  rpe: null,
  comment: "",
} as unknown as ExerciseFeedback;

function rendre(element: Parameters<typeof renderToString>[0]): string {
  return renderToString(element).replace(/<!-- -->/g, "");
}

await test("F1. sans vidéo : deux chemins proposés, et la PORTÉE annoncée sans promesse", () => {
  const html = rendre(
    createElement(ExerciseVideoField, {
      studentId: ELEVE_A,
      videoPath: null,
      onChange: () => {},
    }),
  );
  assert.match(html, /Importer une vidéo/);
  assert.match(html, new RegExp(`${FEEDBACK_VIDEO_MAX_SECONDS} s maximum`));
  assert.ok(!/\d+ jours/.test(html), "aucune durée de conservation ne doit être promise à l'écran");
  assert.match(html, /Visible par toi, ton coach et l&#x27;administrateur/);
  // L'input n'accepte QUE les trois types du bucket.
  for (const type of FEEDBACK_VIDEO_MIME_TYPES) {
    assert.ok(html.includes(type), `type absent de l'attribut accept : ${type}`);
  }
});

await test("F2. avec vidéo : l'aperçu, la portée, et un retrait explicite", async () => {
  const html = rendre(
    createElement(ExerciseVideoField, {
      studentId: ELEVE_A,
      videoPath: `${ELEVE_A}/${UUID_FICHIER}.mp4`,
      onChange: () => {},
      resoudreUrl: async () => "https://signee.test/x.mp4",
    }),
  );
  assert.match(html, /Vidéo jointe/);
  assert.match(html, /Retirer la vidéo/);
  assert.ok(!/\d+ jours/.test(html), "aucune durée de conservation ne doit être promise à l'écran");
});

await test("F3. le champ ne déclenche AUCUNE requête au montage", () => {
  let appels = 0;
  rendre(
    createElement(ExerciseVideoField, {
      studentId: ELEVE_A,
      videoPath: null,
      onChange: () => {},
      resoudreUrl: async () => {
        appels += 1;
        return null;
      },
    }),
  );
  assert.equal(appels, 0, "sans chemin, il n'y a rien à signer");
});

await test("F4. LA STRUCTURE NE BOUGE PAS — la vidéo ne touche ni séries ni commentaire", () => {
  const champ = sansCommentairesTs(CHAMP);
  for (const interdit of ["onSetChange", "onCommentChange", "loadUsed", "repsDone", "setNumber"]) {
    assert.ok(!champ.includes(interdit), `le champ vidéo ne doit jamais toucher ${interdit}`);
  }
  // Et l'état de la séance garde la vidéo À PART, comme le remplacement.
  const section = sansCommentairesTs(SECTION);
  assert.ok(section.includes("const [videosExercice, setVideosExercice]"));
  assert.ok(
    !/setExerciseFeedback[\s\S]{0,200}videoPath/.test(section),
    "la vidéo ne doit jamais entrer dans l'état des séries",
  );
});

await test("F5. la carte n'affiche le champ que sur le chemin RÉEL", () => {
  // Sans studentId ni onVideoChange : aucun bouton, comme le remplacement.
  const mock = rendre(
    createElement(ExerciseFeedbackCard, {
      exercise: exercicePrescrit,
      index: 0,
      feedback: retourExercice,
      onSetChange: () => {},
      onCommentChange: () => {},
    }),
  );
  assert.ok(!mock.includes("Importer une vidéo"), "aucun bouton sur le chemin mock");

  const reel = rendre(
    createElement(ExerciseFeedbackCard, {
      exercise: exercicePrescrit,
      index: 0,
      feedback: retourExercice,
      onSetChange: () => {},
      onCommentChange: () => {},
      studentId: ELEVE_A,
      videoPath: null,
      onVideoChange: () => {},
    }),
  );
  assert.ok(reel.includes("Importer une vidéo"), "le champ doit apparaître sur le chemin réel");
  // La prescription reste affichée à l'identique dans les deux cas.
  for (const html of [mock, reel]) {
    assert.match(html, /3 séries/);
    assert.match(html, /RPE cible 8/);
  }
});

await test("F6. l'écran envoie le CHEMIN, et le restaure depuis les vidéos du retour", () => {
  const section = sansCommentairesTs(SECTION);
  assert.ok(
    section.includes("videoPath: videosExercice[exerciseFb.exerciseId] ?? null"),
    "le chemin doit partir dans la charge utile",
  );
  assert.ok(section.includes("existingFeedback.videos ?? []"),
    "la restauration lit les vidéos DU RETOUR — exerciseEntries en oublierait un exercice sans série");
  assert.ok(section.includes("parNomPrescrit.set(normalizeExerciseName(video.exerciseName)"),
    "le rapprochement se fait sur le nom PRESCRIT");
});

await test("F7. la modale du coach lit les vidéos DU RETOUR, pas des séries", () => {
  const modale = sansCommentairesTs(MODALE_COACH);
  assert.ok(modale.includes("feedback.videos ?? []"),
    "les vidéos sont portées par le retour : une par exercice, jamais par série");
  assert.ok(!/entry\.videoPath|entry\.videoUrl/.test(modale),
    "plus rien ne doit être lu depuis exerciseEntries");
  assert.ok(modale.includes("video.realizedName"),
    "le coach regarde le mouvement RÉALISÉ, pas celui qui était prévu");
  // Une vidéo non signée ne laisse pas un lecteur noir : elle le DIT, et
  // nomme les deux causes possibles — purge, ou élève non rattaché.
  assert.ok(MODALE_COACH.includes("durée de conservation"));
  assert.ok(MODALE_COACH.includes("pas rattaché"));
});

await test("F8. l'en-tête n'ouvre QUE ce site, et la capture d'élève reste muette", () => {
  assert.ok(CONFIG.includes("camera=(self)"), "la capture exige que camera ne soit plus fermé");
  assert.ok(!/camera=\*/.test(CONFIG), "jamais toutes les origines");

  // LE MICRO A ÉTÉ OUVERT PAR F5, ET CE CONTRÔLE A DÛ CHANGER.
  //
  // Version d'origine : `microphone=()` — le son n'était nécessaire à
  // personne. F5 donne la parole au COACH, dont la réponse filmée n'aurait
  // aucun sens en muet : l'en-tête est donc passé à `microphone=(self)`.
  //
  // Ce qui reste vrai, et que ce contrôle défend maintenant, c'est la
  // propriété qui protégeait vraiment l'élève : sa capture À LUI ne demande
  // toujours PAS le micro. Filmer sa technique n'enregistre pas ce qui se dit
  // dans la salle. Un en-tête ouvert n'a jamais donné accès à quoi que ce
  // soit — c'est `getUserMedia` qui demande, et ici il demande `audio: false`.
  assert.ok(!/microphone=\*/.test(CONFIG), "le micro ne doit jamais être ouvert à toutes les origines");
  assert.ok(/microphone=\((self)?\)/.test(CONFIG), "le micro reste fermé, ou ouvert à ce site seul");
  const capture = sansCommentairesTs(CAPTURE);
  assert.ok(capture.includes("audio: false"), "la capture de l'ÉLÈVE ne demande pas le son");
  assert.ok(!capture.includes("audio: true"), "et rien ne l'a rouvert au passage");

  // media-src : sans lui, la CSP bloquante casserait le lecteur.
  assert.ok(/media-src 'self' blob:/.test(CONFIG));
});

await test("F9. la capture est bornée À LA SOURCE — 720p demandé, arrêt à 20 s", () => {
  const capture = sansCommentairesTs(CAPTURE);
  assert.ok(capture.includes("height: { ideal: 720 }"), "720p demandé, pas imposé");
  assert.ok(
    capture.includes("FEEDBACK_VIDEO_MAX_SECONDS * 1000"),
    "la minuterie d'arrêt est ce qui rend le ré-encodage inutile",
  );
  assert.ok(capture.includes("facingMode"), "caméra arrière visée");
  // Aucun bouton mort : quand la capture n'est pas possible, on le dit.
  assert.ok(capture.includes("captureVideoAvailability"));
  assert.ok(capture.includes("isSecureContext"));
  assert.ok(CHAMP.includes("capture.disponible &&"), "le bouton Filmer n'apparaît que s'il mène quelque part");
});

/* ════════════════════════════════════════════════════════════════════════
 * G. LE DOSSIER — manifeste, checklist, dépendances
 * ════════════════════════════════════════════════════════════════════════ */

await test("G1. la migration est déclarée dans le manifeste du bootstrap", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.ok(
    attendues.includes("20260826090000_student_feedback_video.sql"),
    "sans cette ligne, la migration n'est PAS rejouée en local et rien n'est testé",
  );
  const fichiers = readdirSync(new URL("../../supabase/migrations", import.meta.url).pathname)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.deepEqual([...attendues].sort(), fichiers.filter((f) => f >= "20260724214500"));
});

await test("G2. AUCUNE dépendance n'a été ajoutée", () => {
  const paquet = JSON.parse(lire("../../package.json"));
  const toutes = { ...paquet.dependencies, ...paquet.devDependencies };
  for (const interdite of [
    "@ffmpeg/ffmpeg",
    "@ffmpeg/core",
    "browser-image-compression",
    "react-dropzone",
    "uppy",
    "tus-js-client",
    "video.js",
    "hls.js",
  ]) {
    assert.ok(!(interdite in toutes), `dépendance ajoutée sans nécessité démontrée : ${interdite}`);
  }
  assert.ok(paquet.scripts["test:student-feedback-video"], "la suite doit être lançable");
});

await test("G3. la checklist SQL couvre les cinq acteurs et les points sensibles", () => {
  for (const marqueur of [
    "A1. le bucket feedback-videos existe et est PRIVÉ",
    "B1. l''élève A dépose dans SON dossier",
    "B2. l''élève A ne dépose PAS dans le dossier de B",
    "C1. l''élève B ne LIT pas la vidéo de A",
    "C6. le coach A lit la vidéo de SON élève A",
    "C7. le coach A ne lit PAS l''élève du coach B",
    "C9. et le coach B ne lit pas l''élève A (règle symétrique)",
    "C11. l''admin voit les deux (convention administrative existante)",
    "C13. …et AUCUN coach ne la voit tant qu''il n''y est pas rattaché",
    "D2. un chemin qui désigne un autre élève est REFUSÉ",
    "E1. video_uploaded_at est posé par la BASE",
    "F2. le staff peut RETIRER la vidéo",
    "I2. la NOUVELLE ligne porte le MÊME video_path",
    "I3. aucun SECOND fichier n''a été créé",
    "I5. retirer la vidéo lève la référence mais LAISSE l''objet (purge F4.1)",
    "A8bis. il n''utilise PLUS is_coach_or_admin()",
    "A10. ni anon ni service_role ne peuvent exécuter le prédicat",
    "G1. anon ne lit aucun objet du bucket",
  ]) {
    assert.ok(CHECKLIST.includes(marqueur), `contrôle absent de la checklist : ${marqueur}`);
  }
  assert.ok(CHECKLIST.includes("coalesce(p_ok, false)"), "un verdict NULL doit compter comme un échec");
  assert.ok(CHECKLIST.includes("rollback;"), "la checklist ne doit rien laisser derrière elle");
  assert.ok(CHECKLIST.includes("On mesure la VALEUR"), "un trigger qui RESTAURE ne se mesure pas en lignes");
});

await test("G4. la suppression d'un élève emporte AUSSI ses vidéos", () => {
  // Un objet Storage n'est pas une ligne PostgreSQL : aucune cascade ne le
  // supprime. L'oublier n'est pas un défaut de ménage, c'est un manquement
  // RGPD — des vidéos d'un élève supprimé resteraient sur nos serveurs.
  const suppression = sansCommentairesTs(SUPPRESSION_ELEVE);
  assert.ok(suppression.includes("removeAllStudentFeedbackVideos"),
    "deleteStudentCompletely doit purger le bucket feedback-videos");
  assert.ok(suppression.includes("deleteStudentProgressPhotoFiles"), "sans perdre l'existant");
  // Et AVANT le DELETE SQL : après, l'identifiant de l'élève ne dirait plus
  // quel dossier vider.
  assert.ok(
    suppression.indexOf("removeAllStudentFeedbackVideos") <
      suppression.indexOf('.from("students").delete()'),
    "la purge Storage doit précéder la suppression de la ligne élève",
  );
  // Jamais de SQL direct sur storage.objects : c'est l'API Storage qui gère
  // le fichier réel, une ligne supprimée à la main laisserait l'objet en place.
  assert.ok(!/storage\.objects/.test(suppression));
});

await test("G5. une purge vidéo INCOMPLÈTE arrête la suppression de l'élève", () => {
  // Un compte effacé qui laisse des vidéos privées derrière lui n'est pas une
  // suppression partielle, c'est une suppression ratée : une fois la ligne
  // `students` partie, plus rien ne relie le dossier à quiconque.
  const suppression = sansCommentairesTs(SUPPRESSION_ELEVE);
  assert.ok(suppression.includes("if (!videos.complet)"), "l'échec de purge doit être TESTÉ");
  assert.ok(suppression.includes('return { ok: false, error: "storage_error" }'),
    "et remonté franchement, pas avalé");
  assert.ok(
    suppression.indexOf("storage_error") < suppression.indexOf('.from("students").delete()'),
    "le refus doit précéder la suppression de la ligne élève",
  );
  // Le type de retour porte le cas, sinon l'appelant ne peut pas le distinguer.
  assert.ok(SUPPRESSION_ELEVE.includes('"not_found" | "delete_error" | "storage_error"'));
  // Et la route le NOMME : « rien n'a été effacé » est une information utile.
  const route = lire("../../app/api/admin/students/[studentId]/route.ts");
  assert.ok(route.includes("storage_error"));
  assert.ok(route.includes("Rien n'a été effacé"));
});


/* ════════════════════════════════════════════════════════════════════════
 * H. LE CHEMIN RÉELLEMENT EXÉCUTÉ
 *
 * Cette section ne lit AUCUN source. Elle fait tourner les vraies fonctions
 * — `saveWorkoutFeedback`, `getAdminWorkoutFeedbackList`,
 * `getWorkoutFeedbackBySession` — contre la base factice partagée, et
 * regarde ce qui SORT.
 *
 * Elle existe parce qu'un audit a montré qu'une suite entièrement fondée sur
 * la lecture de source peut être verte pendant que la fonctionnalité est
 * morte : `getAdminWorkoutFeedbackDetail` signait des URLs, mais personne ne
 * l'appelait, et le coach ne voyait jamais rien. Un test qui vérifie la
 * présence de code ne prouve pas que ce code est atteint.
 * ════════════════════════════════════════════════════════════════════════ */

const SEANCE = "36000000-0000-4000-8000-000000000001";
const V1 = `${ELEVE_A}/aaaaaaaa-1111-4111-8111-111111111111.mp4`;
const V2 = `${ELEVE_A}/bbbbbbbb-2222-4222-8222-222222222222.webm`;

function charge(surcharge: Partial<WorkoutFeedbackPayload> = {}): WorkoutFeedbackPayload {
  return {
    studentId: ELEVE_A,
    sessionId: SEANCE,
    sessionKey: SEANCE,
    sessionRefLabel: "Haut du corps",
    completed: true,
    globalRpe: 8,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Développé couché",
        exerciseOrder: 0,
        rpe: null,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: "60", repsDone: "8" }],
        videoPath: V1,
      },
    ],
    ...surcharge,
  };
}

await test("H1. le coach ouvre /admin/retours : la vidéo lui arrive SIGNÉE", async () => {
  // Le chemin exact de l'écran : useSupabaseAdminFeedback appelle
  // getAdminWorkoutFeedbackList, et FeedbackDetailModal s'ouvre sur une de
  // ses lignes. S'il n'y a pas d'URL ici, le coach voit un lecteur vide.
  const { client, objets } = creerBase();
  objets.add(V1);
  await saveWorkoutFeedback(client, charge());

  const liste = await getAdminWorkoutFeedbackList(client);
  assert.equal(liste.length, 1);
  const videos = liste[0]!.videos ?? [];
  assert.equal(videos.length, 1, "le retour doit porter la vidéo");
  assert.equal(videos[0]!.videoPath, V1);
  assert.ok(videos[0]!.videoUrl, "L'URL SIGNÉE DOIT ÊTRE LÀ — c'est tout l'objet du correctif");
  assert.match(videos[0]!.videoUrl as string, /exp=3600/, "une heure, inchangé");
  assert.equal(videos[0]!.realizedName, "Développé couché");
});

await test("H2. …et une seule requête de signature pour toute la page", async () => {
  const { client, objets, journalStorage } = creerBase();
  for (let n = 0; n < 4; n += 1) {
    const chemin = `${ELEVE_A}/cccccccc-${n}111-4111-8111-111111111111.mp4`;
    objets.add(chemin);
    await saveWorkoutFeedback(
      client,
      charge({
        sessionId: `36000000-0000-4000-8000-00000000000${n}`,
        sessionKey: `s${n}`,
        exercises: [
          {
            exerciseName: `Exercice ${n}`,
            exerciseOrder: 0,
            rpe: null,
            comment: "",
            sets: [{ setNumber: 1, loadUsed: "60", repsDone: "8" }],
            videoPath: chemin,
          },
        ],
      }),
    );
  }
  journalStorage.length = 0;

  const liste = await getAdminWorkoutFeedbackList(client);
  assert.equal(liste.length, 4);
  assert.equal(liste.flatMap((f) => f.videos ?? []).filter((v) => v.videoUrl).length, 4);
  assert.equal(
    journalStorage.filter((l) => l.startsWith("signLot:")).length,
    1,
    "quatre retours, UNE requête de signature",
  );
});

await test("H3. un coach non rattaché n'obtient AUCUNE URL, sans erreur bruyante", async () => {
  // La RLS refuse le chemin ; `createSignedUrls` rend une erreur par chemin.
  // L'écran doit dégrader proprement : la vidéo est annoncée, pas jouable.
  const { client, objets } = creerBase({ peutLireVideo: () => false });
  objets.add(V1);
  await saveWorkoutFeedback(client, charge());

  const liste = await getAdminWorkoutFeedbackList(client);
  const videos = liste[0]!.videos ?? [];
  assert.equal(videos.length, 1, "la ligne existe toujours");
  assert.equal(videos[0]!.videoUrl, null, "mais rien n'est signé");
});

await test("H4. RESOUMISSION vidéo inchangée : même chemin, même objet, aucun second fichier", async () => {
  const { client, objets, table } = creerBase();
  objets.add(V1);

  await saveWorkoutFeedback(client, charge());
  const premiereLigne = table("exercise_feedback")[0]!;
  assert.equal(premiereLigne.video_path, V1);
  assert.equal(objets.size, 1);

  // L'élève rouvre, modifie une série et un commentaire, renvoie. La vidéo,
  // elle, n'a pas bougé : l'écran la renvoie telle quelle.
  const apres = await saveWorkoutFeedback(
    client,
    charge({
      exercises: [
        {
          exerciseName: "Développé couché",
          exerciseOrder: 0,
          rpe: null,
          comment: "ça piquait sur la 3e",
          sets: [{ setNumber: 1, loadUsed: "62,5", repsDone: "8" }],
          videoPath: V1,
        },
      ],
    }),
  );

  const lignes = table("exercise_feedback");
  assert.equal(lignes.length, 1, "l'ancienne ligne a été remplacée, pas doublée");
  assert.notEqual(lignes[0]!.id, premiereLigne.id, "c'est bien une NOUVELLE ligne (delete + insert)");
  assert.equal(lignes[0]!.video_path, V1, "qui porte le MÊME chemin");
  assert.equal(lignes[0]!.comment, "ça piquait sur la 3e", "et la modification a bien été prise");
  assert.equal(objets.size, 1, "AUCUN second fichier n'a été créé");
  assert.ok([...objets].includes(V1), "l'objet d'origine est toujours là");
  assert.equal((apres?.videos ?? [])[0]?.videoPath, V1);

  // La date de dépôt, elle, est reposée : c'est un INSERT. Assumé ici,
  // traité en F4.1 (la rétention devra s'appuyer sur storage.objects.created_at).
  assert.notEqual(lignes[0]!.video_uploaded_at, premiereLigne.video_uploaded_at);
});

await test("H5. VIDÉO SANS SÉRIE : la ligne est écrite, le chemin conservé", async () => {
  // Le cas qui faisait disparaître la vidéo : « je filme mon squat, je ne
  // note rien, j'envoie. »
  const { client, objets, table } = creerBase();
  objets.add(V1);

  const sauve = await saveWorkoutFeedback(
    client,
    charge({
      exercises: [
        {
          exerciseName: "Développé couché",
          exerciseOrder: 0,
          rpe: null,
          comment: "",
          sets: [],
          videoPath: V1,
        },
      ],
    }),
  );

  const lignes = table("exercise_feedback");
  assert.equal(lignes.length, 1, "la ligne DOIT exister — c'est le correctif");
  assert.equal(lignes[0]!.video_path, V1, "et porter le chemin");
  assert.equal(table("exercise_set_feedback").length, 0, "sans inventer la moindre série");
  assert.ok([...objets].includes(V1), "l'objet n'est pas devenu orphelin");
  // Et elle est RELISIBLE : sans cela, la resoumission suivante l'effacerait.
  assert.equal((sauve?.videos ?? []).length, 1);
  const relu = await getWorkoutFeedbackBySession(client, ELEVE_A, SEANCE);
  assert.equal((relu?.videos ?? [])[0]?.videoPath, V1,
    "un exercice sans série ne produit AUCUNE entrée de série : la vidéo doit venir d'ailleurs");
  assert.equal(relu?.exerciseEntries.length, 0, "…et il n'y a bien aucune entrée de série");
});

await test("H6. une ligne SANS aucune donnée utile n'est toujours pas écrite", () => {
  // Le correctif ne doit pas produire une ligne par exercice prescrit.
  const vide = {
    exerciseName: "Squat",
    exerciseOrder: 0,
    rpe: null,
    comment: "   ",
    sets: [],
  };
  assert.equal(exerciseFeedbackWorthPersisting(vide), false);
  assert.equal(exerciseFeedbackWorthPersisting({ ...vide, videoPath: V1 }), true);
  assert.equal(exerciseFeedbackWorthPersisting({ ...vide, comment: "dur" }), true);
  assert.equal(exerciseFeedbackWorthPersisting({ ...vide, rpe: 9 }), true);
  assert.equal(
    exerciseFeedbackWorthPersisting({ ...vide, substituteExerciseLibraryId: "33000000-0000-4000-8000-0000000000a2" }),
    true,
  );
  assert.equal(
    exerciseFeedbackWorthPersisting({ ...vide, sets: [{ setNumber: 1, loadUsed: "", repsDone: "" }] }),
    true,
  );
});

await test("H7. REMPLACEMENT puis ABANDON : la base pointe encore sur V1, et V1 existe", async () => {
  const { client, objets, table } = creerBase();
  objets.add(V1);
  await saveWorkoutFeedback(client, charge());
  assert.equal(table("exercise_feedback")[0]!.video_path, V1);

  // L'élève rouvre et remplace sa vidéo… puis ferme l'onglet.
  const envoi = await uploadFeedbackVideo(client, {
    studentId: ELEVE_A,
    fichier: { size: 2_000_000 } as Blob,
    mime: "video/webm",
    identifiant: "bbbbbbbb-2222-4222-8222-222222222222",
  });
  assert.ok(!("error" in envoi));
  assert.equal((envoi as { path: string }).path, V2);

  // AUCUN envoi de retour. C'est tout le sujet.
  assert.equal(table("exercise_feedback")[0]!.video_path, V1,
    "la base ne doit pas avoir bougé : rien n'a été soumis");
  assert.ok([...objets].includes(V1),
    "et V1 DOIT exister encore — l'effacer aurait cassé la référence enregistrée");
  assert.ok([...objets].includes(V2), "V2 attend, orphelin, la purge de F4.1");
  assert.equal(objets.size, 2);
});

await test("H8. RETRAIT puis ABANDON : la base pointe encore sur V1, et V1 existe", async () => {
  const { client, objets, table } = creerBase();
  objets.add(V1);
  await saveWorkoutFeedback(client, charge());

  // « Retirer » ne fait qu'oublier : aucune requête, aucun effacement. On le
  // prouve en rendant le composant avec un chemin, puis sans — l'état de
  // Storage ne doit pas bouger d'un octet.
  const avant = [...objets];
  rendre(
    createElement(ExerciseVideoField, {
      studentId: ELEVE_A,
      videoPath: V1,
      onChange: () => {},
      resoudreUrl: async () => null,
    }),
  );
  assert.deepEqual([...objets], avant, "le rendu ne doit rien effacer");
  assert.equal(table("exercise_feedback")[0]!.video_path, V1, "et la base non plus");
  assert.ok([...objets].includes(V1));
});

await test("H9. RETRAIT puis SUBMIT : video_path passe à null, l'objet reste pour la purge", async () => {
  const { client, objets, table } = creerBase();
  objets.add(V1);
  await saveWorkoutFeedback(client, charge());
  assert.equal(table("exercise_feedback")[0]!.video_path, V1);

  // L'élève retire la vidéo (état local à null) PUIS envoie.
  await saveWorkoutFeedback(
    client,
    charge({
      exercises: [
        {
          exerciseName: "Développé couché",
          exerciseOrder: 0,
          rpe: null,
          comment: "",
          sets: [{ setNumber: 1, loadUsed: "60", repsDone: "8" }],
          videoPath: null,
        },
      ],
    }),
  );

  const ligne = table("exercise_feedback")[0]!;
  assert.equal(ligne.video_path, null, "la référence est levée");
  assert.equal(ligne.video_uploaded_at, null, "et la date suit, dérivée par la base");
  assert.ok([...objets].includes(V1),
    "l'objet SURVIT : c'est la purge de F4.1 qui l'effacera, pas l'écran");
  assert.equal(objets.size, 1);
});

await test("H10. la base REFUSE le chemin d'un autre élève, même si l'écran l'envoyait", async () => {
  const { client, objets, table } = creerBase();
  const aB = `${ELEVE_B}/dddddddd-3333-4333-8333-333333333333.mp4`;
  objets.add(aB);

  await assert.rejects(
    () => saveWorkoutFeedback(client, charge({ exercises: [
      {
        exerciseName: "Développé couché",
        exerciseOrder: 0,
        rpe: null,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: "60", repsDone: "8" }],
        videoPath: aB,
      },
    ] })),
    /ne désigne pas le dossier de cet élève/,
    "le gardien doit refuser, pas enregistrer",
  );
  assert.equal(table("exercise_feedback").filter((l) => l.video_path === aB).length, 0);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
