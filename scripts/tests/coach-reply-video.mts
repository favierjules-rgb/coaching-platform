import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  COACH_REPLY_VIDEO_BUCKET,
  COACH_REPLY_VIDEO_MAX_BYTES,
  COACH_REPLY_VIDEO_MAX_SECONDS,
  COACH_REPLY_VIDEO_PATH_SHAPE,
  COACH_REPLY_VIDEO_RETENTION_DAYS,

  buildCoachReplyVideoPath,
  isCoachReplyVideoPathFor,
  joursRestantsAvantPurge,
  mentionDelaiCoachReplyVideo,
  validateCoachReplyVideoDuration,
  validateCoachReplyVideoFile,
} from "../../lib/coach-reply-video";
import {
  COACH_REPLY_VIDEO_ORPHAN_GRACE_MS,
  COACH_REPLY_VIDEO_RETENTION_MS,
  classerObjetCoachReplyVideo,
} from "../../lib/coach-reply-video-retention";
import { FEEDBACK_VIDEO_RETENTION_MS } from "../../lib/feedback-video-retention";
import {
  ANNOTATIONS_MAX,
  ANNOTATIONS_OCTETS_MAX,
  ANNOTATION_INSTANT_MAX,
  ANNOTATION_POINTS_MAX,
  ANNOTATION_TEXTE_MAX,
  annotationsVisibles,
  calquePlein,
  tailleCalque,
  boiteContenuVideo,
  calqueVide,
  parseAnnotations,
  serialiserAnnotations,
  versNormalise,
  versPixels,
  type Annotation,
} from "../../lib/video-annotations";
import {
  getSignedCoachReplyVideoUrl,
  loadSignedCoachReplyVideoUrls,
  removeAllStudentCoachReplyVideos,
  uploadCoachReplyVideo,
} from "../../lib/supabase/storage-coach-reply-videos";
import {
  captureCoachDisponible,
  decoupeDisponible,
  decouperVideo,
  verifierIntervalleDecoupe,
} from "../../lib/coach-reply-video-capture";
import { purgeCoachReplyVideos } from "../../lib/supabase/purge-coach-reply-videos";
import { purgeFeedbackVideos } from "../../lib/supabase/purge-feedback-videos";
import { deleteStudentCompletely } from "../../lib/supabase/delete-student";
import {
  getWorkoutFeedbackForStudent,
  updateWorkoutFeedbackCoachReply,
} from "../../lib/supabase/workout-feedback";
import { installerFauxNavigateur } from "./helpers/faux-navigateur";
import { GET as purgeRoute } from "../../app/api/cron/purge-coach-reply-videos/route";
import { creerBase, type BaseFactice } from "./helpers/supabase-double";

/**
 * F5 — RÉPONSE VIDÉO DU COACH
 *
 * CE QUE CETTE SUITE PROUVE
 *   Elle fait TOURNER le code contre la base factice partagée — dépôt,
 *   écriture de la réponse, purge — et regarde l'état après coup. Les
 *   contrôles de source ne portent que sur ce qu'aucune exécution ne peut
 *   montrer (un en-tête HTTP, une déclaration de cron, l'absence d'une
 *   dépendance).
 *
 *   - le calque est un MODÈLE, pas un dessin : parse défensif, sérialisation
 *     reconstruite, visibilité dans le temps (P1–P8) ;
 *   - la géométrie tombe juste malgré les bandes noires (P9–P11) ;
 *   - le dépôt vise le dossier de l'ÉLÈVE DESTINATAIRE, jamais du coach (S1–S5) ;
 *   - l'écriture pose chemin ET calque en une fois, et le retrait emporte le
 *     calque (W1–W5) ;
 *   - la purge à 3 JOURS ne touche jamais le bucket des élèves (R1–R8) ;
 *   - la suppression d'un élève emporte AUSSI les réponses qu'il a reçues (G4).
 *
 * CE QU'ELLE NE PEUT PAS PROUVER
 *   La DÉCOUPE. Elle n'existe que dans un navigateur : `canvas.captureStream`,
 *   `MediaRecorder`, un `AudioContext`. On vérifie ici les DÉCISIONS qui
 *   l'entourent (disponibilité annoncée, bornes, message de repli) et la
 *   Preview fait le reste. Le dire vaut mieux que de simuler trois API et
 *   d'appeler ça une preuve.
 *   Les 120 secondes non plus : elles sont tenues par une minuterie de
 *   navigateur et par la mesure de durée d'un fichier importé.
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
const sansCommentairesTs = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const MIGRATION = lire("../../supabase/migrations/20260827090000_coach_reply_video.sql");
const CHECKLIST = lire("../../supabase/tests/coach_reply_video_checklist.sql");
const CONFIG = lire("../../next.config.ts");
const CAPTURE = lire("../../lib/coach-reply-video-capture.ts");
const CHAMP = lire("../../components/admin/CoachReplyVideoField.tsx");
const EDITEUR = lire("../../components/admin/VideoAnnotationEditor.tsx");
const LECTEUR = lire("../../components/shared/AnnotatedVideoPlayer.tsx");
const MODALE = lire("../../components/admin/FeedbackDetailModal.tsx");
const HISTORIQUE = lire("../../app/(student)/entrainement/historique/page.tsx");
const STORAGE = lire("../../lib/supabase/storage-coach-reply-videos.ts");
const PURGE = lire("../../lib/supabase/purge-coach-reply-videos.ts");
const MOTEUR = lire("../../lib/supabase/purge-video-bucket.ts");
const SUPPRESSION_ELEVE = lire("../../lib/supabase/delete-student.ts");

const ELEVE_A = "52000000-0000-4000-8000-000000000002";
const ELEVE_B = "52000000-0000-4000-8000-000000000003";

const MAINTENANT = Date.parse("2026-09-01T12:00:00.000Z");
const IL_Y_A = (ms: number) => new Date(MAINTENANT - ms).toISOString();
const JOUR = 24 * 60 * 60 * 1000;
const HEURE = 60 * 60 * 1000;

function chemin(eleve: string, n: number, ext = "mp4"): string {
  return `${eleve}/${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.${ext}`;
}

/** Une base dont le bucket « réel » est celui des RÉPONSES, pas des vidéos d'élève. */
const creerBaseCoach = (options: Parameters<typeof creerBase>[0] = {}): BaseFactice =>
  creerBase({ bucketPrincipal: COACH_REPLY_VIDEO_BUCKET, ...options });

function poser(base: BaseFactice, path: string, creeIlYaMs: number): string {
  base.objets.add(path);
  base.datesObjets.set(path, IL_Y_A(creeIlYaMs));
  return path;
}

/** Un retour de séance, avec ou sans réponse vidéo déjà rattachée. */
function retour(base: BaseFactice, studentId: string, cheminVideo: string | null): string {
  const id = `wf-${base.table("workout_feedback").length + 1}`;
  base.table("workout_feedback").push({
    id,
    student_id: studentId,
    session_key: `s-${id}`,
    session_ref_label: "Séance",
    // Les mêmes valeurs par défaut que celles que le double applique à
    // l'INSERT : on écrit ici directement dans la table, donc elles ne
    // passeraient pas par lui, et la lecture buterait sur une date absente.
    completed: true,
    global_rpe: null,
    global_comment: "",
    pain: "",
    status: "a-traiter",
    prescribed_snapshot: null,
    performed_at: null,
    duration_minutes: null,
    session_status: null,
    submitted_at: IL_Y_A(0),
    created_at: IL_Y_A(0),
    updated_at: IL_Y_A(0),
    coach_reply: "",
    coach_reply_video_path: cheminVideo,
    coach_reply_video_uploaded_at: cheminVideo ? IL_Y_A(0) : null,
    coach_reply_video_annotations: null,
  });
  return id;
}

const purger = (base: BaseFactice, options: { maximumParExecution?: number } = {}) =>
  purgeCoachReplyVideos(base.client, { maintenant: MAINTENANT, ...options });

/* ════════════════════════════════════════════════════════════════════════
 * P. LE CALQUE — un modèle, testable sans navigateur
 * ════════════════════════════════════════════════════════════════════════ */

await test("P1. les bornes sont celles annoncées, et miroir de la base", () => {
  assert.equal(COACH_REPLY_VIDEO_MAX_SECONDS, 120);
  assert.equal(COACH_REPLY_VIDEO_MAX_BYTES, 209_715_200);
  assert.equal(COACH_REPLY_VIDEO_RETENTION_DAYS, 3);
  assert.equal(ANNOTATIONS_MAX, 200);
  // La base porte les MÊMES chiffres : deux vérités divergentes vaudraient
  // moins qu'une seule.
  assert.ok(MIGRATION.includes("209715200"), "le plafond du bucket doit être le même qu'en code");
  assert.ok(
    new RegExp(`jsonb_array_length\\(p_calque\\) <= ${ANNOTATIONS_MAX}`).test(MIGRATION),
    "le plafond de tracés doit être le même en base et en code",
  );
});

await test("P2. un calque illisible n'efface pas la vidéo : on écarte tracé par tracé", () => {
  const brut = [
    { id: "ok", type: "cercle", debut: 1, duree: 2, couleur: "#ffffff", centre: { x: 0.5, y: 0.5 }, rayon: 0.1 },
    { type: "laser", debut: 1, duree: 2 },
    { type: "cercle", debut: 1 },
    { type: "cercle", debut: -1, duree: 2, centre: { x: 0, y: 0 }, rayon: 0.1 },
    { type: "cercle", debut: 1, duree: 0, centre: { x: 0, y: 0 }, rayon: 0.1 },
    null,
    "pas un objet",
  ];
  const calque = parseAnnotations(brut);
  assert.equal(calque.length, 1, "un seul tracé était valide");
  assert.equal(calque[0]!.id, "ok");
  // Ni exception, ni calque vidé : les deux seraient des façons de perdre le
  // travail du coach pour une entrée abîmée.
  assert.deepEqual(parseAnnotations(null), []);
  assert.deepEqual(parseAnnotations({ type: "cercle" }), []);
});

await test("P3. un point qui déborde est BORNÉ, pas refusé", () => {
  // Un geste qui sort du cadre vient d'une main, pas d'une attaque : refuser
  // ferait disparaître un tracé entier pour un pixel.
  const [tr] = parseAnnotations([
    { type: "fleche", debut: 0, duree: 1, de: { x: -0.5, y: 1.4 }, a: { x: 0.5, y: 0.5 } },
  ]);
  assert.ok(tr && tr.type === "fleche");
  assert.deepEqual((tr as Extract<Annotation, { type: "fleche" }>).de, { x: 0, y: 1 });
});

await test("P4. un trait d'un seul point ne se dessine pas : il est écarté", () => {
  assert.deepEqual(parseAnnotations([{ type: "trait", debut: 0, duree: 1, points: [{ x: 0.1, y: 0.1 }] }]), []);
  const [tr] = parseAnnotations([
    { type: "trait", debut: 0, duree: 1, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
  ]);
  assert.equal(tr?.type, "trait");
});

await test("P5. le texte est borné et jamais vide", () => {
  assert.deepEqual(
    parseAnnotations([{ type: "texte", debut: 0, duree: 1, position: { x: 0.1, y: 0.1 }, contenu: "   " }]),
    [],
  );
  const [tr] = parseAnnotations([
    { type: "texte", debut: 0, duree: 1, position: { x: 0.1, y: 0.1 }, contenu: "x".repeat(500) },
  ]);
  assert.equal((tr as Extract<Annotation, { type: "texte" }>).contenu.length, ANNOTATION_TEXTE_MAX);
});

await test("P6. la sérialisation RECONSTRUIT : rien de l'éditeur ne passe en base", () => {
  const sale = [
    {
      id: "a1",
      type: "cercle",
      debut: 1.23456,
      duree: 3,
      couleur: "#ffffff",
      centre: { x: 0.123456789, y: 0.5 },
      rayon: 0.1,
      // Ce que l'éditeur pourrait traîner : un état d'interface, une
      // référence circulaire, un identifiant interne.
      selectionne: true,
      brouillon: { profond: true },
    },
  ] as unknown as Annotation[];
  const [sorti] = serialiserAnnotations(sale) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(sorti!).sort(), ["centre", "couleur", "debut", "duree", "id", "rayon", "type"]);
  assert.equal((sorti!.centre as { x: number }).x, 0.1235, "coordonnées arrondies au dix-millième");
});

await test("P7. la visibilité : début INCLUSIF, fin EXCLUSIVE", () => {
  const calque = parseAnnotations([
    { id: "a", type: "cercle", debut: 0, duree: 2, centre: { x: 0.5, y: 0.5 }, rayon: 0.1 },
    { id: "b", type: "cercle", debut: 2, duree: 2, centre: { x: 0.5, y: 0.5 }, rayon: 0.1 },
  ]);
  assert.deepEqual(annotationsVisibles(calque, 0).map((t) => t.id), ["a"]);
  assert.deepEqual(annotationsVisibles(calque, 1.9).map((t) => t.id), ["a"]);
  // Sans cette asymétrie, deux tracés qui se succèdent exactement
  // clignoteraient ensemble sur une image.
  assert.deepEqual(annotationsVisibles(calque, 2).map((t) => t.id), ["b"]);
  assert.deepEqual(annotationsVisibles(calque, 4).map((t) => t.id), []);
  assert.ok(calqueVide([]));
});

await test("P8. les plafonds tiennent : 200 tracés, 240 points", () => {
  const trop = Array.from({ length: 250 }, (_, n) => ({
    id: `a${n}`, type: "cercle", debut: 0, duree: 1, centre: { x: 0.5, y: 0.5 }, rayon: 0.1,
  }));
  assert.equal(parseAnnotations(trop).length, ANNOTATIONS_MAX);
  const [tr] = parseAnnotations([
    {
      type: "trait", debut: 0, duree: 1,
      points: Array.from({ length: 500 }, (_, n) => ({ x: n / 500, y: 0.5 })),
    },
  ]);
  assert.equal((tr as Extract<Annotation, { type: "trait" }>).points.length, ANNOTATION_POINTS_MAX);
});

/* ── La géométrie : le défaut qui ne se verrait que chez l'élève ───────── */

await test("P9. la boîte de l'image tient compte des bandes noires", () => {
  // Vidéo 16/9 dans un cadre carré de 400 : bandes en haut et en bas.
  const boite = boiteContenuVideo(400, 400, 1920, 1080);
  assert.equal(boite.largeur, 400);
  assert.equal(boite.hauteur, 225);
  assert.equal(boite.x, 0);
  assert.equal(boite.y, 87.5);

  // Vidéo verticale dans un cadre large : bandes à gauche et à droite.
  const debout = boiteContenuVideo(400, 400, 1080, 1920);
  assert.equal(debout.hauteur, 400);
  assert.equal(debout.largeur, 225);
  assert.equal(debout.x, 87.5);
});

await test("P10. avant les métadonnées, on se replie sur le cadre au lieu de diviser par zéro", () => {
  // `videoWidth` vaut 0 tant que les métadonnées ne sont pas chargées.
  assert.deepEqual(boiteContenuVideo(400, 300, 0, 0), { x: 0, y: 0, largeur: 400, hauteur: 300 });
  assert.deepEqual(boiteContenuVideo(400, 300, Number.NaN, 100), { x: 0, y: 0, largeur: 400, hauteur: 300 });
});

await test("P11. un aller-retour pixels ↔ normalisé retombe sur ses pieds", () => {
  // C'EST LE CONTRÔLE QUI COMPTE. Le coach annote sur un écran de bureau,
  // l'élève regarde sur un téléphone en portrait : si la conversion n'est pas
  // exactement réciproque, la flèche pointe le plafond.
  const bureau = boiteContenuVideo(1200, 500, 1920, 1080);
  const point = versNormalise(700, 260, bureau);
  const retour = versPixels(point, bureau);
  assert.ok(Math.abs(retour.x - 700) < 1e-9);
  assert.ok(Math.abs(retour.y - 260) < 1e-9);

  // Et le MÊME point normalisé tombe au bon endroit sur un autre écran :
  // au tiers de la largeur de l'image dans les deux cas.
  const centre = versNormalise(bureau.x + bureau.largeur / 3, bureau.y + bureau.hauteur / 2, bureau);
  const telephone = boiteContenuVideo(390, 700, 1920, 1080);
  const surTelephone = versPixels(centre, telephone);
  assert.ok(Math.abs(surTelephone.x - (telephone.x + telephone.largeur / 3)) < 1e-9);
  assert.ok(Math.abs(surTelephone.y - (telephone.y + telephone.hauteur / 2)) < 1e-9);

  // Un geste sur la bande noire est ramené au bord, jamais au-delà.
  const debord = versNormalise(0, 0, bureau);
  assert.ok(debord.y >= 0 && debord.y <= 1);
});

/* ════════════════════════════════════════════════════════════════════════
 * D. LES DÉCISIONS PURES DU FICHIER
 * ════════════════════════════════════════════════════════════════════════ */

await test("D1. le chemin désigne l'élève DESTINATAIRE, jamais l'auteur", () => {
  const p = buildCoachReplyVideoPath(ELEVE_A, "video/mp4", "5b000000-0000-4000-8000-0000000000a1");
  assert.equal(p, `${ELEVE_A}/5b000000-0000-4000-8000-0000000000a1.mp4`);
  assert.ok(COACH_REPLY_VIDEO_PATH_SHAPE.test(p));
  assert.ok(isCoachReplyVideoPathFor(p, ELEVE_A));
  assert.ok(!isCoachReplyVideoPathFor(p, ELEVE_B));
  // Miroir EXACT de la contrainte SQL : les deux regex doivent accepter et
  // refuser les mêmes chemins, sans quoi la base refuserait après l'envoi.
  assert.ok(MIGRATION.includes("(mp4|mov|webm)"), "les mêmes extensions des deux côtés");
  assert.ok(!COACH_REPLY_VIDEO_PATH_SHAPE.test(`${ELEVE_A}/sous/dossier.mp4`));
  assert.ok(!COACH_REPLY_VIDEO_PATH_SHAPE.test("a-la-racine.mp4"));
  assert.ok(!COACH_REPLY_VIDEO_PATH_SHAPE.test(`${ELEVE_A}/pas-un-uuid.mp4`));
});

await test("D2. un fichier trop lourd ou d'un type inconnu est refusé AVANT l'envoi", () => {
  assert.equal(validateCoachReplyVideoFile({ type: "video/mp4", size: 1000 }), null);
  assert.ok(validateCoachReplyVideoFile({ type: "video/avi", size: 1000 }));
  assert.ok(validateCoachReplyVideoFile({ type: "video/mp4", size: COACH_REPLY_VIDEO_MAX_BYTES + 1 }));
  assert.ok(validateCoachReplyVideoFile({ type: "video/mp4", size: 0 }));
  // Le paramètre de codec ne doit pas faire refuser un MP4 parfaitement bon.
  assert.equal(validateCoachReplyVideoFile({ type: "video/mp4;codecs=avc1", size: 1000 }), null);
});

await test("D3. une durée ILLISIBLE est acceptée, et le trou est nommé", () => {
  // Certains WebM de MediaRecorder ne portent pas de durée. Refuser
  // interdirait au coach d'envoyer ce qu'il vient de filmer.
  assert.equal(validateCoachReplyVideoDuration(null), null);
  assert.equal(validateCoachReplyVideoDuration(119), null);
  assert.ok(validateCoachReplyVideoDuration(200));
  const source = lire("../../lib/coach-reply-video.ts");
  assert.ok(/trou/.test(source), "le trou de mesure doit être écrit, pas masqué");
});

await test("D4. le compte à rebours part du DÉPÔT, et n'annonce jamais une heure précise", () => {
  const depose = IL_Y_A(0);
  assert.equal(joursRestantsAvantPurge(depose, MAINTENANT), 3);
  assert.equal(joursRestantsAvantPurge(IL_Y_A(2 * JOUR), MAINTENANT), 1);
  assert.equal(joursRestantsAvantPurge(IL_Y_A(3 * JOUR), MAINTENANT), 0);
  assert.ok(joursRestantsAvantPurge(IL_Y_A(4 * JOUR), MAINTENANT)! < 0);
  assert.equal(joursRestantsAvantPurge(null, MAINTENANT), null);
  assert.equal(joursRestantsAvantPurge("pas une date", MAINTENANT), null);

  assert.match(mentionDelaiCoachReplyVideo(IL_Y_A(2 * JOUR), MAINTENANT)!, /1 jour/);
  assert.match(mentionDelaiCoachReplyVideo(IL_Y_A(3 * JOUR), MAINTENANT)!, /Dernier jour/);
  // On annonce un PLANCHER, jamais une échéance : le balayage est quotidien,
  // donc la vidéo peut rester quelques heures de plus — jamais moins.
  for (const texte of [
    mentionDelaiCoachReplyVideo(IL_Y_A(0), MAINTENANT)!,
    mentionDelaiCoachReplyVideo(IL_Y_A(2 * JOUR), MAINTENANT)!,
  ]) {
    assert.ok(!/exactement|précis|à \d+h/.test(texte), `promesse trop précise : ${texte}`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * S. LE STOCKAGE
 * ════════════════════════════════════════════════════════════════════════ */

await test("S1. le dépôt vise le dossier de l'ÉLÈVE, et rend son chemin", async () => {
  const base = creerBaseCoach();
  const resultat = await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A,
    fichier: new Blob(["x"]),
    mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-0000000000a1",
  });
  assert.ok(!("error" in resultat));
  assert.equal((resultat as { path: string }).path, `${ELEVE_A}/5b000000-0000-4000-8000-0000000000a1.mp4`);
  assert.deepEqual(base.journalStorage, [
    `upload:${COACH_REPLY_VIDEO_BUCKET}:${ELEVE_A}/5b000000-0000-4000-8000-0000000000a1.mp4`,
  ]);
});

await test("S2. un fichier refusé ne part PAS sur le réseau", async () => {
  const base = creerBaseCoach();
  const trop = await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A,
    fichier: { size: COACH_REPLY_VIDEO_MAX_BYTES + 1 } as Blob,
    mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-0000000000a1",
  });
  assert.ok("error" in trop);
  assert.deepEqual(base.journalStorage, [], "200 Mo ne doivent pas partir pour être refusés ensuite");

  // Un identifiant d'élève difforme produirait un chemin que la base
  // refuserait APRÈS le téléversement.
  const mauvais = await uploadCoachReplyVideo(base.client, {
    studentId: "pas-un-uuid",
    fichier: new Blob(["x"]),
    mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-0000000000a1",
  });
  assert.ok("error" in mauvais);
  assert.deepEqual(base.journalStorage, []);
});

await test("S3. la signature est GROUPÉE, et la RLS décide seule de ce qui revient", async () => {
  const aMoi = chemin(ELEVE_A, 1);
  const aLautre = chemin(ELEVE_B, 1);
  const base = creerBaseCoach({ peutLireVideo: (c) => c.startsWith(`${ELEVE_A}/`) });
  base.objets.add(aMoi);
  base.objets.add(aLautre);

  const resolues = await loadSignedCoachReplyVideoUrls(base.client, [aMoi, aMoi, aLautre, null]);
  assert.equal(resolues.size, 1, "un chemin refusé n'a pas d'URL, et les doublons ne coûtent rien");
  assert.ok(resolues.has(aMoi));
  assert.ok(!resolues.has(aLautre));
  // UNE requête pour toute la page, pas une par vidéo.
  assert.deepEqual(base.journalStorage, [`signLot:${COACH_REPLY_VIDEO_BUCKET}:2:3600`]);

  assert.deepEqual(await loadSignedCoachReplyVideoUrls(base.client, [null, null]), new Map());
  assert.equal(await getSignedCoachReplyVideoUrl(base.client, null), null);
  assert.ok(await getSignedCoachReplyVideoUrl(base.client, aMoi));
});

await test("S4. AUCUNE suppression à l'unité n'est exposée par ce module", () => {
  // Même règle qu'en F4, et pour la même raison : la base n'apprend le
  // nouveau chemin qu'à l'envoi de la réponse. Effacer tout de suite ferait
  // pointer la base vers un objet disparu si le coach ferme la modale.
  const storage = sansCommentairesTs(STORAGE);
  assert.ok(!/export async function removeCoachReplyVideo\b/.test(storage));
  assert.ok(!/export async function replaceCoachReplyVideo\b/.test(storage));
  assert.ok(storage.includes("export async function removeAllStudentCoachReplyVideos"));
  const champ = sansCommentairesTs(CHAMP);
  assert.ok(!champ.includes(".remove("), "l'écran du coach ne doit rien effacer");
});

await test("S5. la purge RGPD vide le dossier PAGE PAR PAGE", async () => {
  const base = creerBaseCoach();
  // 110 objets : la pagination de `list()` s'arrête à 100 par défaut, et une
  // purge qui s'arrêterait là laisserait exactement ce qu'elle prétend vider.
  for (let n = 0; n < 110; n += 1) base.objets.add(chemin(ELEVE_A, n));
  base.objets.add(chemin(ELEVE_B, 1));

  const bilan = await removeAllStudentCoachReplyVideos(base.client, ELEVE_A);
  assert.equal(bilan.supprimes, 110);
  assert.ok(bilan.complet);
  assert.equal(base.objets.size, 1, "seul le dossier de l'autre élève subsiste");
  assert.ok(base.objets.has(chemin(ELEVE_B, 1)));
});

/* ════════════════════════════════════════════════════════════════════════
 * W. L'ÉCRITURE DE LA RÉPONSE
 * ════════════════════════════════════════════════════════════════════════ */

const CALQUE: Annotation[] = [
  { id: "a1", type: "fleche", debut: 1, duree: 3, couleur: "#ffffff", de: { x: 0.1, y: 0.1 }, a: { x: 0.5, y: 0.5 } },
];

await test("W1. texte, chemin et calque partent en UNE seule écriture", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 0);
  const id = retour(base, ELEVE_A, null);

  const ok = await updateWorkoutFeedbackCoachReply(base.client, id, {
    texte: "Regarde ta position de départ.",
    videoPath: p,
    annotations: CALQUE,
  });
  assert.ok(ok);
  const ligne = base.table("workout_feedback")[0]!;
  assert.equal(ligne.coach_reply, "Regarde ta position de départ.");
  assert.equal(ligne.coach_reply_video_path, p);
  assert.equal((ligne.coach_reply_video_annotations as unknown[]).length, 1);
  assert.equal(ligne.status, "traité");
  // Séparer en deux écritures laisserait exister, entre les deux, un retour
  // portant une vidéo sans son calque — que l'élève pourrait ouvrir.
  assert.equal(ligne.coach_reply_video_uploaded_at !== null, true, "la date est DÉRIVÉE, jamais envoyée");
});

await test("W2. la date de dépôt n'est JAMAIS envoyée par l'application", () => {
  const couche = sansCommentairesTs(lire("../../lib/supabase/workout-feedback.ts"));
  assert.ok(
    !/coach_reply_video_uploaded_at\s*:/.test(couche),
    "la couche d'écriture ne doit jamais poser la date de dépôt",
  );
  // Et le type l'interdit : la règle est PORTÉE, pas seulement commentée.
  const types = lire("../../types/supabase.ts");
  const bloc = types.slice(types.indexOf("workout_feedback: {"), types.indexOf("exercise_feedback: {"));
  const update = bloc.slice(bloc.lastIndexOf("Update: {"));
  assert.ok(!update.includes("coach_reply_video_uploaded_at"), "Update ne doit pas exposer la date");
  assert.ok(update.includes("coach_reply_video_path"), "mais bien le chemin");
});

await test("W3. RETIRER la vidéo emporte le calque", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 0);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p, annotations: CALQUE });

  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: null, annotations: CALQUE });
  const ligne = base.table("workout_feedback")[0]!;
  assert.equal(ligne.coach_reply_video_path, null);
  assert.equal(ligne.coach_reply_video_annotations, null, "un calque sans vidéo ne recouvre rien");
  assert.equal(ligne.coach_reply_video_uploaded_at, null);
});

await test("W4. un calque VIDE part en null, jamais en tableau vide", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 0);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p, annotations: [] });
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_annotations, null);
});

await test("W5. une réponse SANS vidéo ne touche pas celle qui est déjà là", async () => {
  // `videoPath` absent (undefined) veut dire « je ne parle pas de la vidéo »,
  // et non « retire-la ». Sans cette distinction, corriger une faute de
  // frappe dans le texte effacerait la vidéo.
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 0);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p, annotations: CALQUE });

  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "texte corrigé" });
  const ligne = base.table("workout_feedback")[0]!;
  assert.equal(ligne.coach_reply, "texte corrigé");
  assert.equal(ligne.coach_reply_video_path, p, "la vidéo doit être intacte");
  assert.equal((ligne.coach_reply_video_annotations as unknown[]).length, 1);
});

await test("W6. le chemin d'un AUTRE élève est refusé par le gardien", async () => {
  const base = creerBaseCoach();
  const pourB = poser(base, chemin(ELEVE_B, 1), 0);
  const id = retour(base, ELEVE_A, null);
  const ok = await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: pourB });
  assert.equal(ok, false, "coller sur le retour de A une vidéo destinée à B doit échouer");
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, null);
});

/* ════════════════════════════════════════════════════════════════════════
 * R. LA RÉTENTION — 3 jours, et le cloisonnement des deux buckets
 * ════════════════════════════════════════════════════════════════════════ */

await test("R1. les seuils sont ceux annoncés : 3 jours, 24 heures", () => {
  assert.equal(COACH_REPLY_VIDEO_RETENTION_MS, 3 * JOUR);
  assert.equal(COACH_REPLY_VIDEO_ORPHAN_GRACE_MS, JOUR);
  // Et surtout : ce n'est PAS la rétention des élèves. Partager le balayeur
  // ne doit jamais avoir partagé les durées.
  assert.notEqual(COACH_REPLY_VIDEO_RETENTION_MS, FEEDBACK_VIDEO_RETENTION_MS);
});

await test("R2. la classification tranche les quatre cas, et signale le difforme", () => {
  const vieux = { path: chemin(ELEVE_A, 1), creeLe: MAINTENANT - 4 * JOUR };
  const jeune = { path: chemin(ELEVE_A, 2), creeLe: MAINTENANT - 2 * JOUR };
  assert.deepEqual(classerObjetCoachReplyVideo(vieux, { estReference: true, maintenant: MAINTENANT }), {
    action: "supprimer", raison: "expired_reference",
  });
  // 2 jours : encore visible côté élève. C'est la différence avec F4.1, où
  // le même objet aurait vingt-huit jours devant lui.
  assert.deepEqual(classerObjetCoachReplyVideo(jeune, { estReference: true, maintenant: MAINTENANT }), {
    action: "garder", raison: "referencee_non_expiree",
  });
  assert.deepEqual(classerObjetCoachReplyVideo(jeune, { estReference: false, maintenant: MAINTENANT }), {
    action: "supprimer", raison: "orphan",
  });
  assert.deepEqual(
    classerObjetCoachReplyVideo({ path: chemin(ELEVE_A, 3), creeLe: MAINTENANT - 2 * HEURE },
      { estReference: false, maintenant: MAINTENANT }),
    { action: "garder", raison: "delai_de_grace" },
  );
  assert.deepEqual(
    classerObjetCoachReplyVideo({ path: "difforme.mp4", creeLe: MAINTENANT - 3650 * JOUR },
      { estReference: false, maintenant: MAINTENANT }),
    { action: "signaler", raison: "chemin_malforme" },
  );
});

await test("R3. une réponse de plus de 3 jours part, référence et calque compris", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 4 * JOUR);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p, annotations: CALQUE });

  const bilan = await purger(base);
  assert.equal(bilan.bucket, COACH_REPLY_VIDEO_BUCKET);
  assert.equal(bilan.expireesSupprimees, 1);
  assert.ok(!base.objets.has(p));
  const ligne = base.table("workout_feedback")[0]!;
  assert.equal(ligne.coach_reply_video_path, null);
  assert.equal(ligne.coach_reply_video_annotations, null, "le calque part avec la vidéo");
  // Le TEXTE de la réponse, lui, survit : c'est la vidéo qui a une durée de
  // vie, pas le conseil écrit.
  assert.equal(ligne.coach_reply, "x");
});

await test("R4. à 2 jours, rien ne bouge : l'élève a encore le temps", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 2 * JOUR);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p });

  const bilan = await purger(base);
  assert.equal(bilan.expireesDetectees, 0);
  assert.ok(base.objets.has(p));
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, p);
});

await test("R5. LE CLOISONNEMENT : la purge des coachs ne voit pas le bucket des élèves", async () => {
  const base = creerBaseCoach();
  poser(base, chemin(ELEVE_A, 1), 40 * JOUR);
  // Un objet TRÈS vieux dans l'autre bucket : s'il disparaissait, le partage
  // du balayeur aurait cassé le cloisonnement.
  const autre = base.autresBuckets.get("feedback-videos") ?? new Set<string>();
  autre.add(chemin(ELEVE_A, 9));
  base.autresBuckets.set("feedback-videos", autre);

  await purger(base);
  assert.equal(autre.size, 1, "le bucket des vidéos d'élève doit être intact");
  assert.ok(!base.journalStorage.some((l) => l.includes("feedback-videos")),
    "le balayeur ne doit même pas avoir listé l'autre bucket");
});

await test("R6. un orphelin de plus de 24 h part ; un orphelin frais est épargné", async () => {
  const base = creerBaseCoach();
  const vieux = poser(base, chemin(ELEVE_A, 1), 30 * HEURE);
  const frais = poser(base, chemin(ELEVE_A, 2), 2 * HEURE);
  const bilan = await purger(base);
  assert.equal(bilan.orphelinsSupprimes, 1);
  assert.ok(!base.objets.has(vieux));
  assert.ok(base.objets.has(frais), "le coach est peut-être en train de rédiger sa réponse");
});

await test("R7. un échec Storage ne lève AUCUNE référence supplémentaire, et le cron passe au ROUGE", async () => {
  const base = creerBaseCoach({ echecSuppression: () => "storage indisponible" });
  const p = poser(base, chemin(ELEVE_A, 1), 4 * JOUR);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p });

  const bilan = await purger(base);
  // La référence est levée AVANT le fichier : l'objet devient un orphelin
  // ordinaire, jamais une référence cassée.
  assert.equal(bilan.expireesSupprimees, 0);
  assert.equal(bilan.expireesDereferenceesSansSuppression, 1);
  assert.ok(base.objets.has(p), "le fichier est toujours là");
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, null);
  assert.ok(bilan.echecs.length > 0);
});

await test("R8. un nettoyage DB raté n'efface AUCUN fichier", async () => {
  const base = creerBaseCoach({ echecNettoyageBase: () => "base indisponible" });
  const p = poser(base, chemin(ELEVE_A, 1), 4 * JOUR);
  const id = retour(base, ELEVE_A, null);
  base.table("workout_feedback")[0]!.coach_reply_video_path = p;
  base.table("workout_feedback")[0]!.coach_reply_video_uploaded_at = IL_Y_A(4 * JOUR);
  assert.equal(id, "wf-1");

  const bilan = await purger(base);
  assert.equal(bilan.expireesSupprimees, 0);
  assert.ok(base.objets.has(p), "rien n'a été effacé : tout est intact, le passage suivant réessaiera");
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, p);
  assert.ok(bilan.echecs.some((e) => e.etape === "base"));
});

await test("R9. la purge est IDEMPOTENTE", async () => {
  const base = creerBaseCoach();
  const p = poser(base, chemin(ELEVE_A, 1), 4 * JOUR);
  const id = retour(base, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p });
  await purger(base);
  const second = await purger(base);
  assert.equal(second.expireesDetectees, 0);
  assert.equal(second.orphelinsDetectes, 0);
  assert.equal(second.echecs.length, 0);
});

/* ════════════════════════════════════════════════════════════════════════
 * C. LE CRON
 * ════════════════════════════════════════════════════════════════════════ */

const requete = (entetes: Record<string, string> = {}) =>
  new Request("https://exemple.test/api/cron/purge-coach-reply-videos", { headers: entetes });

await test("C1. sans secret, avec un mauvais secret, ou sans en-tête : REFUS", async () => {
  const original = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal((await purgeRoute(requete())).status, 503, "sans secret configuré, la route refuse TOUT");

  process.env.CRON_SECRET = "s3cr3t";
  assert.equal((await purgeRoute(requete())).status, 401, "sans en-tête");
  assert.equal((await purgeRoute(requete({ authorization: "Bearer faux" }))).status, 401);
  assert.equal((await purgeRoute(requete({ authorization: "s3cr3t" }))).status, 401, "sans le préfixe Bearer");
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

await test("C2. le cron est déclaré dans vercel.json, à sa propre heure", () => {
  const vercel = JSON.parse(lire("../../vercel.json"));
  const crons = vercel.crons as { path: string; schedule: string }[];
  const coach = crons.find((c) => c.path === "/api/cron/purge-coach-reply-videos");
  assert.ok(coach, "le cron des réponses doit être déclaré");
  assert.match(coach!.schedule, /^\d+ \d+ \* \* \*$/, "une seule exécution quotidienne");
  // DEUX routes, pas une qui balaie deux buckets : un cron rouge doit dire
  // QUOI a échoué.
  const eleve = crons.find((c) => c.path === "/api/cron/purge-feedback-videos");
  assert.ok(eleve, "le cron des élèves reste déclaré");
  assert.notEqual(coach!.schedule, eleve!.schedule, "les deux ne doivent pas démarrer ensemble");
  assert.ok(lire("../../.env.example").includes("purge-coach-reply-videos"), "le secret est documenté");
});

await test("C3. la route reprend la convention de sécurité existante, mot pour mot", () => {
  const route = lire("../../app/api/cron/purge-coach-reply-videos/route.ts");
  const modele = lire("../../app/api/cron/purge-feedback-videos/route.ts");
  for (const morceau of [
    "process.env.CRON_SECRET",
    "if (!cronSecret)",
    "{ status: 503 }",
    "authHeader !== `Bearer ${cronSecret}`",
    "{ status: 401 }",
    "createSupabaseAdminClient()",
    "statutHttpPurge(bilan)",
    "ok: statut === 200",
  ]) {
    assert.ok(route.includes(morceau), `convention non reprise : ${morceau}`);
    assert.ok(modele.includes(morceau), `le modèle a changé : ${morceau}`);
  }
});

await test("C4. la purge ne nomme QUE son bucket, et jamais de SQL sur storage.objects", () => {
  for (const source of [PURGE, MOTEUR]) {
    const sansCommentaires = sansCommentairesTs(source);
    assert.ok(!/storage\.objects/.test(sansCommentaires));
    assert.ok(!/from\("storage/.test(sansCommentaires));
  }
  const purge = sansCommentairesTs(PURGE);
  assert.ok(purge.includes("COACH_REPLY_VIDEO_BUCKET"), "le bucket est nommé par sa constante");
  for (const autre of ['"feedback-videos"', '"progress-photos"', '"documents"', '"videos"']) {
    assert.ok(!purge.includes(autre), `bucket étranger nommé : ${autre}`);
  }
  // Le MOTEUR, lui, ne doit nommer AUCUN bucket : il reçoit un profil.
  const moteur = sansCommentairesTs(MOTEUR);
  for (const litteral of ['"coach-reply-videos"', '"feedback-videos"']) {
    assert.ok(!moteur.includes(litteral), `le balayeur générique ne doit pas nommer ${litteral}`);
  }
});

await test("C5. la rétention est annoncée sans borne haute inventée", () => {
  for (const fichier of [
    "../../lib/coach-reply-video-retention.ts",
    "../../lib/supabase/purge-coach-reply-videos.ts",
    "../../app/api/cron/purge-coach-reply-videos/route.ts",
  ]) {
    const texte = lire(fichier);
    assert.ok(!/rétention (maximale|MAXIMALE)/.test(texte), `promesse de borne haute dans ${fichier}`);
    assert.ok(
      texte.includes("généralement entre") && texte.includes("éligible"),
      `formulation nominale absente de ${fichier}`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * I. L'INTERFACE — ce qu'aucune exécution ne montre
 * ════════════════════════════════════════════════════════════════════════ */

await test("I1. le micro est ouvert à CE SITE seul, et la capture du coach le demande", () => {
  // C'est un ASSOUPLISSEMENT par rapport à F4, et il a une raison : le coach
  // EXPLIQUE. Une réponse filmée muette ne vaudrait rien.
  assert.ok(CONFIG.includes("microphone=(self)"), "le coach doit pouvoir parler");
  assert.ok(!/microphone=\*/.test(CONFIG), "jamais toutes les origines");
  assert.ok(CONFIG.includes("camera=(self)"));
  const capture = sansCommentairesTs(CAPTURE);
  assert.ok(capture.includes("audio: true"), "et la capture du coach le demande réellement");
  // Sans `media-src`, la CSP ferait retomber les `<video>` sur `default-src`
  // et casserait le lecteur.
  assert.ok(/media-src 'self' blob:/.test(CONFIG));
});

await test("I2. la découpe est bornée, et son indisponibilité est DITE", () => {
  const capture = sansCommentairesTs(CAPTURE);
  // Trois briques testées SÉPARÉMENT : le message doit dire ce qui manque,
  // pas « non ».
  for (const brique of ["captureStream", "AudioContext", "MediaRecorder"]) {
    assert.ok(capture.includes(brique), `brique non testée : ${brique}`);
  }
  assert.ok(capture.includes("webkitAudioContext"), "Safari n'expose pas AudioContext sous ce nom");
  // On ne connecte JAMAIS la sortie aux haut-parleurs : le coach n'a pas à
  // réentendre sa voix pendant la découpe.
  assert.ok(!/connect\(audioCtx\.destination\)/.test(capture));
  assert.ok(capture.includes("COACH_REPLY_VIDEO_MAX_SECONDS"), "la capture est bornée à la source");

  const champ = sansCommentairesTs(CHAMP);
  assert.ok(champ.includes("decoupe.raison"), "quand la découpe manque, on le dit");
  // Le coût en TEMPS RÉEL est annoncé AVANT de lancer, pas découvert pendant.
  assert.ok(/temps réel/.test(CHAMP));
  assert.ok(/onglet/.test(CHAMP), "et la contrainte de rester sur l'onglet aussi");
});

await test("I3. une vidéo trop longue n'est pas refusée à l'import — elle l'est à l'envoi", () => {
  // Refuser à l'import interdirait la découpe exactement dans le cas où elle
  // sert : un coach qui filme trois minutes et veut en garder quatre-vingt-dix
  // secondes.
  const champ = sansCommentairesTs(CHAMP);
  const choisir = champ.slice(champ.indexOf("async function choisirFichier"), champ.indexOf("async function demarrerCapture"));
  assert.ok(choisir.includes("validateCoachReplyVideoFile"), "la TAILLE, elle, est opposable dès l'import");
  assert.ok(!choisir.includes("validateCoachReplyVideoDuration"), "la durée ne doit pas refuser l'import");
  const joindre = champ.slice(champ.indexOf("async function joindre"));
  assert.ok(joindre.includes("validateCoachReplyVideoDuration"), "elle est opposable à l'envoi");
});

await test("I4. remplacer la vidéo repart d'un calque VIERGE", () => {
  // Des tracés posés sur d'autres images ne veulent plus rien dire sur
  // celles-ci : les garder afficherait des flèches pointant n'importe où.
  const champ = sansCommentairesTs(CHAMP);
  assert.ok(/onChange\(\{ videoPath: resultat\.path, annotations: \[\] \}\)/.test(champ));
  assert.ok(/onChange\(\{ videoPath: null, annotations: \[\] \}\)/.test(champ), "et retirer aussi");
});

await test("I5. l'éditeur met la vidéo EN PAUSE dès que le coach dessine", () => {
  const editeur = sansCommentairesTs(EDITEUR);
  const commencer = editeur.slice(editeur.indexOf("function commencer"), editeur.indexOf("function suivre"));
  assert.ok(commencer.includes("video.pause()"), "dessiner sur une image qui défile produit un tracé faux");
  // Le geste est suivi EN CONTINU, et il continue même hors du cadre.
  assert.ok(commencer.includes("setPointerCapture"));
  assert.ok(editeur.includes("onPointerMove"), "le tracé suit le doigt, il n'apparaît pas au relâchement");
  // Sur tablette, sans cela, dessiner ferait défiler la page.
  assert.ok(EDITEUR.includes("touch-none"));
});

await test("I6. le lecteur de l'élève garde les contrôles NATIFS et ne capte aucun clic", () => {
  const lecteur = sansCommentairesTs(LECTEUR);
  assert.ok(/<video[\s\S]{0,400}controls/.test(lecteur), "plein écran, clavier, lecteurs d'écran");
  // Un canevas qui capte les clics recouvrirait la barre de lecture.
  assert.ok(/pointer-events-none/.test(lecteur));
  // Le CONTENU des annotations texte reste lisible autrement qu'en regardant.
  assert.ok(lecteur.includes("sr-only"));
  // La boucle de dessin ne tourne QUE pendant la lecture.
  assert.ok(lecteur.includes("if (!enLecture) return;"));
});

await test("I7. le calque est REJOUÉ par-dessus, jamais gravé dans le fichier", () => {
  // Aucun transcodage dans le navigateur : c'est la règle tenue depuis F4.
  const dessin = sansCommentairesTs(lire("../../lib/video-annotations-draw.ts"));
  assert.ok(dessin.includes("dessinerCalque"));
  // UNE seule routine de dessin pour les deux côtés : sinon ce que le coach
  // place ne serait pas tout à fait ce que l'élève voit.
  for (const source of [EDITEUR, LECTEUR]) {
    assert.ok(
      /useVideoAnnotationOverlay/.test(source),
      "éditeur et lecteur doivent partager la même plomberie de calque",
    );
  }
  const modele = lire("../../lib/video-annotations.ts");
  assert.ok(/PAS INFALSIFIABLE|pas.{0,20}gravé/i.test(modele), "la limite doit être nommée, pas masquée");
});

await test("I8. l'élève voit la réponse, son délai, et la raison d'une absence", () => {
  assert.ok(HISTORIQUE.includes("AnnotatedVideoPlayer"), "la vidéo est jouée avec son calque");
  assert.ok(HISTORIQUE.includes("mentionDelaiCoachReplyVideo"), "le compte à rebours est affiché");
  assert.ok(HISTORIQUE.includes("parseAnnotations"), "on ne fait jamais confiance au jsonb");
  // Un lecteur vide laisserait croire à une panne.
  assert.ok(/délai de conservation/.test(HISTORIQUE));
  // Le texte reste quand la vidéo est partie.
  assert.ok(HISTORIQUE.includes("feedback.coachReply || feedback.coachReplyVideo"));
  // Et l'écran demande explicitement les signatures : sans cela, la vidéo
  // serait là mais illisible.
  assert.ok(HISTORIQUE.includes("avecReponseVideo: true"));
});

await test("I9. le coach peut répondre en vidéo SEULE, jamais dans le vide", () => {
  const modale = sansCommentairesTs(MODALE);
  assert.ok(modale.includes("Boolean(reply.trim()) || Boolean(videoPath)"),
    "texte seul, vidéo seule, ou les deux — mais pas une réponse vide");
  assert.ok(modale.includes("onReply({ texte: reply.trim(), videoPath, annotations })"));
  assert.ok(modale.includes("parseAnnotations(feedback.coachReplyVideo?.annotations)"));
});

/* ════════════════════════════════════════════════════════════════════════
 * G. LE SOCLE
 * ════════════════════════════════════════════════════════════════════════ */

await test("G1. la migration est déclarée dans le manifeste du bootstrap", () => {
  // Une migration absente du manifeste n'est JAMAIS appliquée localement : la
  // suite passerait au vert contre un schéma qui n'est pas celui de la
  // Production.
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.ok(attendues.includes("20260827090000_coach_reply_video.sql"));
  const surDisque = readdirSync(new URL("../../supabase/migrations", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f >= (manifeste.borne.premiere_migration_a_rejouer as string));
  assert.deepEqual([...attendues].sort(), surDisque);
});

await test("G2. AUCUNE dépendance n'a été ajoutée", () => {
  // La découpe, le dessin et la lecture reposent sur des API du navigateur.
  // Une bibliothèque d'annotation aurait été plus rapide à écrire et bien
  // plus longue à sécuriser.
  const p = JSON.parse(lire("../../package.json"));
  const toutes = { ...p.dependencies, ...p.devDependencies } as Record<string, string>;
  for (const interdite of ["fabric", "konva", "ffmpeg", "@ffmpeg/ffmpeg", "video.js", "plyr"]) {
    assert.ok(!(interdite in toutes), `dépendance ajoutée : ${interdite}`);
  }
});

await test("G3. la checklist SQL couvre les cinq acteurs et le sens INVERSÉ", () => {
  for (const marqueur of [
    "B2. l''ÉLÈVE ne dépose RIEN, même dans son propre dossier",
    "B3. un coach NON rattaché ne dépose pas dans ce dossier",
    "B4. un élève SANS coach_id n''est ouvert à aucun coach",
    "C1. l''élève DESTINATAIRE lit la réponse qui lui est destinée",
    "C4. un coach ne lit pas la réponse d''un élève qu''il ne suit pas",
    "F1. un chemin désignant un AUTRE élève est REFUSÉ, admin compris",
    "G3. l''ADMINISTRATEUR non plus",
    "I1. anon ne lit AUCUN objet du bucket",
  ]) {
    assert.ok(CHECKLIST.includes(marqueur), `contrôle absent de la checklist : ${marqueur}`);
  }
  assert.ok(CHECKLIST.includes("coalesce(p_ok, false)"), "un verdict NULL doit compter comme un échec");
  assert.ok(CHECKLIST.includes("rollback;"), "la checklist ne doit rien laisser derrière elle");
  assert.ok(CHECKLIST.includes("la VALEUR"), "un trigger qui RESTAURE ne se mesure pas en lignes");
});

await test("G4. la suppression d'un élève emporte AUSSI les réponses qu'il a reçues", () => {
  // L'intuition inverse est facile : ce n'est pas parce que le COACH a filmé
  // cette vidéo qu'elle ne concerne pas l'élève. Elle le nomme, commente sa
  // technique, et vit dans SON dossier.
  const suppression = sansCommentairesTs(SUPPRESSION_ELEVE);
  assert.ok(suppression.includes("removeAllStudentCoachReplyVideos"));
  assert.ok(suppression.includes("removeAllStudentFeedbackVideos"), "sans perdre l'existant");
  // AVANT le DELETE SQL : après, l'identifiant ne dirait plus quel dossier vider.
  assert.ok(
    suppression.indexOf("removeAllStudentCoachReplyVideos") < suppression.indexOf('.from("students").delete()'),
  );
  // Et un échec ARRÊTE la suppression : un compte effacé qui laisse des
  // vidéos privées derrière lui n'est pas une suppression partielle, c'est
  // une suppression ratée.
  const bloc = suppression.slice(suppression.indexOf("removeAllStudentCoachReplyVideos"));
  assert.ok(/if \(!reponses\.complet\)[\s\S]{0,400}storage_error/.test(bloc));
});

await test("G5. la migration porte son propre contrôle final", () => {
  // Elle échoue si elle est incomplète — c'est ce qui a attrapé une mutation
  // rendant l'écriture accessible à l'élève.
  assert.ok(MIGRATION.includes("MIGRATION INCOMPLÈTE"));
  assert.ok(MIGRATION.includes("l''élève peut ÉCRIRE sa propre réponse de coach"));
  assert.ok(MIGRATION.includes("la lecture autorise TOUT coach (is_coach_or_admin)"));
  // Le trou du verdict NULL : `jsonb_typeof` d'une clé absente rend NULL, et
  // une comparaison avec NULL ne satisfait aucun WHERE.
  assert.ok(MIGRATION.includes("coalesce(jsonb_typeof(tr->'duree'), '')"));
  assert.ok(MIGRATION.includes("coalesce(jsonb_typeof(tr->'debut'), '')"));
});

/* ════════════════════════════════════════════════════════════════════════
 * Y. LE CYCLE COMPLET — sur le VRAI chemin applicatif, de bout en bout
 * ════════════════════════════════════════════════════════════════════════
 * A. le coach dépose V1 + texte + calque
 * B. l'élève ouvre son historique et reçoit tout
 * C. le coach ne change QUE le texte           → V1 intacte
 * D. le coach ne change QUE le calque          → V1 intacte
 * E. le coach remplace V1 par V2               → la base pointe V2
 * F. le coach retire la vidéo                  → chemin, calque et date à NULL
 *
 * Le point qui compte est C : une sauvegarde de texte seule ne doit remettre
 * à NULL ni le chemin, ni le calque, et ne doit pas REDATER le dépôt — cette
 * date est ce qui déclenche la purge à 3 jours, la repousser prolongerait la
 * vidéo à chaque correction de faute de frappe. */

await test("Y. cycle A→F : dépôt, lecture élève, texte seul, calque seul, remplacement, retrait", async () => {
  const base = creerBaseCoach();
  const id = retour(base, ELEVE_A, null);

  /* ── A. le coach dépose ─────────────────────────────────────────────── */
  const depot = await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A,
    fichier: new Blob(["v1"]),
    mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000a001",
  });
  assert.ok(!("error" in depot));
  const v1 = (depot as { path: string }).path;
  await updateWorkoutFeedbackCoachReply(base.client, id, {
    texte: "Regarde ta position de départ.",
    videoPath: v1,
    annotations: CALQUE,
  });

  const apresA = base.table("workout_feedback")[0]!;
  const dateDepot = apresA.coach_reply_video_uploaded_at as string;
  assert.equal(apresA.coach_reply_video_path, v1);
  assert.equal((apresA.coach_reply_video_annotations as unknown[]).length, 1);
  assert.ok(dateDepot, "A : la date de dépôt est posée");

  /* ── B. l'élève ouvre son historique ────────────────────────────────── */
  const vus = await getWorkoutFeedbackForStudent(base.client, ELEVE_A, { avecReponseVideo: true });
  assert.equal(vus.length, 1);
  assert.equal(vus[0]!.coachReply, "Regarde ta position de départ.");
  assert.ok(vus[0]!.coachReplyVideo, "B : l'élève reçoit la réponse vidéo");
  assert.ok(vus[0]!.coachReplyVideo!.videoUrl, "B : avec une URL signée");
  assert.equal(parseAnnotations(vus[0]!.coachReplyVideo!.annotations).length, 1, "B : et son calque");

  /* ── C. le texte SEUL ───────────────────────────────────────────────── */
  // C'est bien ce que la modale envoie : elle repasse le chemin et le calque
  // qu'elle a chargés, inchangés.
  await updateWorkoutFeedbackCoachReply(base.client, id, {
    texte: "Regarde ta position de départ, surtout les appuis.",
    videoPath: v1,
    annotations: CALQUE,
  });
  const apresC = base.table("workout_feedback")[0]!;
  assert.equal(apresC.coach_reply_video_path, v1, "C : la vidéo doit rester");
  assert.equal((apresC.coach_reply_video_annotations as unknown[]).length, 1, "C : le calque aussi");
  assert.equal(apresC.coach_reply_video_uploaded_at, dateDepot, "C : et la date ne doit PAS être repoussée");
  assert.ok(base.objets.has(v1), "C : le fichier est toujours là");

  /* ── D. le calque SEUL ──────────────────────────────────────────────── */
  const calqueEnrichi: Annotation[] = [
    ...CALQUE,
    { id: "a2", type: "texte", debut: 4, duree: 3, couleur: "#f59e0b", position: { x: 0.3, y: 0.7 }, contenu: "ici" },
  ];
  await updateWorkoutFeedbackCoachReply(base.client, id, {
    texte: "Regarde ta position de départ, surtout les appuis.",
    videoPath: v1,
    annotations: calqueEnrichi,
  });
  const apresD = base.table("workout_feedback")[0]!;
  assert.equal(apresD.coach_reply_video_path, v1, "D : la vidéo doit rester");
  assert.equal((apresD.coach_reply_video_annotations as unknown[]).length, 2);
  assert.equal(apresD.coach_reply_video_uploaded_at, dateDepot, "D : la date ne bouge pas non plus");

  /* ── E. remplacement V1 → V2 ────────────────────────────────────────── */
  const second = await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A,
    fichier: new Blob(["v2"]),
    mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000a002",
  });
  const v2 = (second as { path: string }).path;
  // Remplacer repart d'un calque vierge : c'est ce que fait l'écran.
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "Nouvelle explication.", videoPath: v2, annotations: [] });
  const apresE = base.table("workout_feedback")[0]!;
  assert.equal(apresE.coach_reply_video_path, v2, "E : la base pointe la nouvelle vidéo");
  assert.equal(apresE.coach_reply_video_annotations, null, "E : le calque de l'ancienne ne survit pas");
  assert.notEqual(apresE.coach_reply_video_uploaded_at, dateDepot, "E : un NOUVEAU fichier redate — c'est correct");
  assert.ok(base.objets.has(v1), "E : V1 reste un orphelin, jamais une référence cassée");
  assert.ok(base.objets.has(v2));

  /* ── F. retrait ─────────────────────────────────────────────────────── */
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "Vu en direct.", videoPath: null, annotations: [] });
  const apresF = base.table("workout_feedback")[0]!;
  assert.equal(apresF.coach_reply_video_path, null);
  assert.equal(apresF.coach_reply_video_annotations, null);
  assert.equal(apresF.coach_reply_video_uploaded_at, null);
  assert.equal(apresF.coach_reply, "Vu en direct.", "F : le texte, lui, reste");
  assert.ok(base.objets.has(v2), "F : le fichier devient orphelin, il n'est pas effacé sous la référence");
});

/* ════════════════════════════════════════════════════════════════════════
 * Z. REMPLACEMENT ET RETRAIT — UN ORPHELIN OUI, UNE RÉFÉRENCE CASSÉE NON
 * ════════════════════════════════════════════════════════════════════════ */

await test("Z1. REMPLACEMENT PUIS ABANDON : la base pointe encore V1, qui existe", async () => {
  // Le coach joint V2 puis ferme la modale sans envoyer. Rien n'a été
  // sauvegardé : la base doit continuer à désigner V1, et V1 doit exister.
  const base = creerBaseCoach();
  const id = retour(base, ELEVE_A, null);
  const v1 = (await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A, fichier: new Blob(["1"]), mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000b001",
  }) as { path: string }).path;
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: v1 });

  // …le coach joint V2, et n'envoie pas.
  const v2 = (await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A, fichier: new Blob(["2"]), mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000b002",
  }) as { path: string }).path;

  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, v1,
    "la base ne connaît V2 qu'à l'envoi");
  assert.ok(base.objets.has(v1), "V1 EXISTE ENCORE — la référence n'est pas cassée");
  assert.ok(base.objets.has(v2), "V2 est un orphelin, que le balayeur ramassera");
  // Et rien n'a été supprimé au passage.
  assert.ok(!base.journalStorage.some((l) => l.startsWith("remove:")), "aucune suppression");
});

await test("Z2. RETRAIT PUIS ABANDON : la base pointe encore V1, qui existe", async () => {
  const base = creerBaseCoach();
  const id = retour(base, ELEVE_A, null);
  const v1 = (await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A, fichier: new Blob(["1"]), mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000c001",
  }) as { path: string }).path;
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: v1 });

  // « Retirer » vide l'état LOCAL de l'écran. Aucun appel réseau.
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, v1);
  assert.ok(base.objets.has(v1));
  assert.ok(!base.journalStorage.some((l) => l.startsWith("remove:")));

  // Et après envoi, V1 devient un orphelin ordinaire — que le cron ramasse
  // une fois passé le délai de grâce.
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: null });
  base.datesObjets.set(v1, IL_Y_A(30 * HEURE));
  const bilan = await purger(base);
  assert.equal(bilan.orphelinsSupprimes, 1);
  assert.ok(!base.objets.has(v1), "c'est le BALAYEUR qui efface, jamais l'écran");
});

/* ════════════════════════════════════════════════════════════════════════
 * L. LE CHEMIN DE LECTURE DE L'ÉLÈVE — celui que la page emprunte vraiment
 * ════════════════════════════════════════════════════════════════════════ */

await test("L1. l'historique obtient une URL signée et le calque ; sans vidéo, rien ne change", async () => {
  const base = creerBaseCoach();
  const avecVideo = retour(base, ELEVE_A, null);
  const sansVideo = retour(base, ELEVE_A, null);
  const v = (await uploadCoachReplyVideo(base.client, {
    studentId: ELEVE_A, fichier: new Blob(["1"]), mime: "video/mp4",
    identifiant: "5b000000-0000-4000-8000-00000000d001",
  }) as { path: string }).path;
  await updateWorkoutFeedbackCoachReply(base.client, avecVideo, { texte: "avec", videoPath: v, annotations: CALQUE });
  await updateWorkoutFeedbackCoachReply(base.client, sansVideo, { texte: "texte seul" });

  // EXACTEMENT l'appel que fait app/(student)/entrainement/historique.
  const liste = await getWorkoutFeedbackForStudent(base.client, ELEVE_A, { avecReponseVideo: true });
  const avec = liste.find((f) => f.id === avecVideo)!;
  const sans = liste.find((f) => f.id === sansVideo)!;

  assert.ok(avec.coachReplyVideo?.videoUrl, "URL signée présente");
  assert.equal(parseAnnotations(avec.coachReplyVideo!.annotations).length, 1);
  assert.ok(avec.coachReplyVideo!.uploadedAt, "et la date, pour le compte à rebours");
  assert.equal(sans.coachReplyVideo, null, "un retour sans vidéo reste un retour sans vidéo");
  assert.equal(sans.coachReply, "texte seul");

  // Une SEULE requête de signature pour toute la page.
  assert.equal(base.journalStorage.filter((l) => l.startsWith("signLot:")).length, 1);
});

await test("L2. la RLS refuse le chemin d'un AUTRE élève : aucune URL n'en sort", async () => {
  // La page ne trie rien : c'est la RLS qui décide, et un chemin refusé
  // revient simplement sans URL.
  const base = creerBaseCoach({ peutLireVideo: (c) => c.startsWith(`${ELEVE_A}/`) });
  const id = retour(base, ELEVE_A, null);
  const aLautre = poser(base, chemin(ELEVE_B, 7), 0);
  // On force en base un chemin qui ne lui est pas destiné — ce que le gardien
  // refuse, mais qui prouve ici que la SIGNATURE ne le laisserait pas passer.
  base.table("workout_feedback")[0]!.coach_reply_video_path = aLautre;
  base.table("workout_feedback")[0]!.coach_reply_video_uploaded_at = IL_Y_A(0);
  assert.equal(id, "wf-1");

  const liste = await getWorkoutFeedbackForStudent(base.client, ELEVE_A, { avecReponseVideo: true });
  assert.equal(liste[0]!.coachReplyVideo!.videoUrl, null, "aucune URL pour un chemin que la RLS refuse");
});

await test("L3. sans le drapeau, aucune signature n'est fabriquée", async () => {
  // Les statistiques (lib/supabase/progress.ts) empruntent la même lecture et
  // n'affichent aucune vidéo : leur faire payer des jetons d'accès à chaque
  // calcul serait du gaspillage, et des jetons fabriqués pour personne.
  const base = creerBaseCoach();
  const id = retour(base, ELEVE_A, null);
  const v = poser(base, chemin(ELEVE_A, 1), 0);
  await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: v });

  const liste = await getWorkoutFeedbackForStudent(base.client, ELEVE_A);
  assert.ok(liste[0]!.coachReplyVideo, "le CHEMIN reste présent");
  assert.equal(liste[0]!.coachReplyVideo!.videoUrl, null, "mais aucune URL n'a été fabriquée");
  assert.equal(base.journalStorage.filter((l) => l.startsWith("signLot:")).length, 0);
});

/* ════════════════════════════════════════════════════════════════════════
 * B. LES BORNES DU CALQUE — opposables, et pas seulement affichées
 * ════════════════════════════════════════════════════════════════════════ */

await test("B1. le calque est borné en NOMBRE et en TAILLE, et l'éditeur s'arrête avant la base", () => {
  const petit = parseAnnotations([
    { id: "a", type: "cercle", debut: 0, duree: 1, centre: { x: 0.5, y: 0.5 }, rayon: 0.1 },
  ]);
  assert.ok(!calquePlein(petit));
  assert.ok(tailleCalque(petit) < 300);

  // Compter les tracés ne borne rien : des traits libres pèsent lourd bien
  // avant d'être deux cents.
  const lourds: Annotation[] = Array.from({ length: 60 }, (_, n) => ({
    id: `t${n}`, type: "trait", debut: 0, duree: 1, couleur: "#ffffff",
    points: Array.from({ length: ANNOTATION_POINTS_MAX }, (_, i) => ({ x: i / 1000, y: 0.5 })),
  }));
  assert.ok(lourds.length < ANNOTATIONS_MAX, "moins de 200 tracés…");
  assert.ok(calquePlein(lourds), "…et pourtant le calque est plein : c'est la TAILLE qui mord");

  // Le budget de l'éditeur est PLUS SERRÉ que celui de la base : c'est ce qui
  // garantit qu'un calque produit par l'application n'est jamais refusé à
  // l'enregistrement.
  assert.ok(ANNOTATIONS_OCTETS_MAX < 262144, "l'éditeur doit s'arrêter avant la base");
  assert.ok(MIGRATION.includes("length(p_calque::text) <= 262144"), "et la base doit porter la borne");
});

await test("B2. la base refuse ce que le lecteur se contentait d'écarter", () => {
  // Ces cinq bornes ne vivaient que dans le navigateur. Elles sont désormais
  // dans le CHECK — la checklist SQL les exécute réellement (H7 à H11), on
  // vérifie ici qu'elles y sont bien écrites.
  for (const borne of [
    "or (tr->>'debut')::numeric > 120",
    "or (tr->>'duree')::numeric > 120",
    "or length(tr->>'contenu') > 80",
    "(pt->>'x')::numeric < 0 or (pt->>'x')::numeric > 1",
    "jsonb_array_length(tr->'points') > 240",
  ]) {
    assert.ok(MIGRATION.includes(borne), `borne absente du CHECK : ${borne}`);
  }
  for (const marqueur of [
    "H7. un tracé SANS de quoi le dessiner est REFUSÉ",
    "H8. une coordonnée HORS du cadre est REFUSÉE",
    "H9. un texte d''annotation trop long est REFUSÉ",
    "H10. un instant au-delà de la vidéo est REFUSÉ",
    "H11. un calque de plus de 256 Ko est REFUSÉ",
  ]) {
    assert.ok(CHECKLIST.includes(marqueur), `contrôle absent de la checklist : ${marqueur}`);
  }
});

await test("B3. le lecteur écarte ce que la base refuserait — les deux bornes s'accordent", () => {
  // Sans cet accord, un calque hérité serait chargé, réaffiché, puis REFUSÉ à
  // l'enregistrement suivant : le coach perdrait son travail sur une règle
  // qu'il n'a pas enfreinte.
  assert.deepEqual(
    parseAnnotations([{ type: "cercle", debut: 999, duree: 2, centre: { x: 0.5, y: 0.5 }, rayon: 0.1 }]),
    [],
  );
  assert.deepEqual(
    parseAnnotations([{ type: "cercle", debut: 1, duree: 999, centre: { x: 0.5, y: 0.5 }, rayon: 0.1 }]),
    [],
  );
  assert.equal(ANNOTATION_INSTANT_MAX, COACH_REPLY_VIDEO_MAX_SECONDS);
});

await test("B4. letterbox : les deux orientations, et un redimensionnement", () => {
  const point = { x: 0.25, y: 0.75 };
  // Le MÊME point normalisé doit tomber au même endroit RELATIF de l'image,
  // quelle que soit la forme du cadre.
  for (const [l, h] of [[1200, 500], [390, 700], [800, 800], [1920, 200]] as [number, number][]) {
    const boite = boiteContenuVideo(l, h, 1920, 1080);
    const px = versPixels(point, boite);
    assert.ok(Math.abs((px.x - boite.x) / boite.largeur - point.x) < 1e-9, `x faux en ${l}×${h}`);
    assert.ok(Math.abs((px.y - boite.y) / boite.hauteur - point.y) < 1e-9, `y faux en ${l}×${h}`);
    // Et le point reste DANS l'image, jamais sur la bande noire.
    assert.ok(px.x >= boite.x - 1e-9 && px.x <= boite.x + boite.largeur + 1e-9);
    assert.ok(px.y >= boite.y - 1e-9 && px.y <= boite.y + boite.hauteur + 1e-9);
  }

  // Vidéo VERTICALE dans un cadre horizontal : bandes à gauche et à droite.
  const debout = boiteContenuVideo(1200, 500, 1080, 1920);
  assert.equal(debout.hauteur, 500);
  assert.ok(debout.x > 0 && debout.y === 0);

  // Un redimensionnement ne déplace pas l'annotation : c'est tout l'intérêt
  // des coordonnées normalisées, et le contrôle qui l'atteste.
  const avant = boiteContenuVideo(1200, 500, 1920, 1080);
  const apres = boiteContenuVideo(600, 250, 1920, 1080);
  const relatifAvant = (versPixels(point, avant).x - avant.x) / avant.largeur;
  const relatifApres = (versPixels(point, apres).x - apres.x) / apres.largeur;
  assert.ok(Math.abs(relatifAvant - relatifApres) < 1e-9);

  // Et le canevas est remesuré quand le cadre bouge — sinon le calque
  // resterait dessiné à l'ancienne échelle, ou disparaîtrait.
  const hook = lire("../../hooks/useVideoAnnotationOverlay.ts");
  assert.ok(hook.includes("REND `true` quand le canevas a été touché"));
  for (const source of [LECTEUR, EDITEUR]) {
    assert.ok(/ResizeObserver/.test(source), "le redimensionnement doit être observé");
    assert.ok(/if \(mesurer\(\)\)/.test(source), "et déclencher un redessin");
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * T. LA DÉCOUPE — l'intervalle en Node, le flot de contrôle sous double
 * ════════════════════════════════════════════════════════════════════════ */

await test("T1. l'intervalle demandé : début seul, fin seule, les deux, aucune découpe", () => {
  const duree = 40;
  // Début seul : on coupe l'entrée en matière.
  assert.deepEqual(verifierIntervalleDecoupe({ debut: 5, fin: 40, dureeSource: duree }), { couvreTout: false, duree: 35 });
  // Fin seule : on coupe la fin.
  assert.deepEqual(verifierIntervalleDecoupe({ debut: 0, fin: 30, dureeSource: duree }), { couvreTout: false, duree: 30 });
  // Les deux.
  assert.deepEqual(verifierIntervalleDecoupe({ debut: 5, fin: 30, dureeSource: duree }), { couvreTout: false, duree: 25 });
  // AUCUNE DÉCOUPE : réencoder coûterait quarante secondes pour rendre le
  // même contenu, en un peu moins bon.
  assert.deepEqual(verifierIntervalleDecoupe({ debut: 0, fin: 40, dureeSource: duree }), { couvreTout: true });
  // Un extrait de quelques centaines de millisecondes reste recevable.
  const court = verifierIntervalleDecoupe({ debut: 10, fin: 10.3, dureeSource: duree });
  assert.ok("couvreTout" in court && court.couvreTout === false && Math.abs(court.duree - 0.3) < 1e-9);
});

await test("T2. un intervalle impossible est refusé, et un extrait trop long aussi", () => {
  assert.ok("error" in verifierIntervalleDecoupe({ debut: 10, fin: 10 }));
  assert.ok("error" in verifierIntervalleDecoupe({ debut: 20, fin: 10 }));
  assert.ok("error" in verifierIntervalleDecoupe({ debut: 0, fin: Number.NaN }));
  const trop = verifierIntervalleDecoupe({ debut: 0, fin: COACH_REPLY_VIDEO_MAX_SECONDS + 10 });
  assert.ok("error" in trop && /dépasse/.test(trop.error));
});

await test("T3. hors navigateur, la découpe REFUSE proprement — jamais un bouton qui tourne", async () => {
  const resultat = await decouperVideo(new Blob(["x"]), { debut: 0, fin: 1 });
  assert.ok("error" in resultat, "aucun fichier ne doit sortir d'un environnement qui ne sait pas découper");
});

await test("T4. lecture normale : l'extrait est produit", async () => {
  const faux = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 4, avecRvfc: true });
  try {
    const resultat = await decouperVideo(new Blob(["src"]), { debut: 0.5, fin: 2, margeGardeMs: 2000 });
    assert.ok(!("error" in resultat), `découpe refusée : ${JSON.stringify(resultat)}`);
    assert.ok((resultat as { fichier: Blob }).fichier.size > 0);
  } finally {
    faux.restaurer();
  }
});

await test("T5. UNE VIDÉO QUI CALE NE FIGE PAS L'ÉCRAN — le garde-fou tranche", async () => {
  // LE DÉFAUT CORRIGÉ. La boucle d'origine ne sortait que depuis le rappel de
  // frame ; or c'est précisément ce rappel qui cesse d'arriver quand plus
  // aucune image n'est décodée. L'écran restait sur « Découpe en cours »
  // indéfiniment, et le bouton « Interrompre » lui-même n'était plus lu.
  const faux = installerFauxNavigateur({
    scenario: { genre: "bloque", aLaSeconde: 1 },
    duree: 10,
    avecRvfc: true,
  });
  try {
    const resultat = await decouperVideo(new Blob(["src"]), { debut: 0, fin: 8, margeGardeMs: 300 });
    assert.ok("error" in resultat, "un extrait tronqué ne doit JAMAIS être rendu comme valide");
    assert.match((resultat as { error: string }).error, /incomplet|arrêtée/);
  } finally {
    faux.restaurer();
  }
});

await test("T6. une erreur de décodage est vue même sans rappel de frame", async () => {
  const faux = installerFauxNavigateur({
    scenario: { genre: "erreur_lecture", aLaSeconde: 1 },
    duree: 10,
    avecRvfc: true,
  });
  try {
    const resultat = await decouperVideo(new Blob(["src"]), { debut: 0, fin: 8, margeGardeMs: 5000 });
    assert.ok("error" in resultat);
  } finally {
    faux.restaurer();
  }
});

await test("T7. une panne de MediaRecorder ne rend PAS les morceaux déjà collectés", async () => {
  const faux = installerFauxNavigateur({
    scenario: { genre: "panne_enregistreur", aLaSeconde: 1 },
    duree: 10,
    avecRvfc: false,
  });
  try {
    const resultat = await decouperVideo(new Blob(["src"]), { debut: 0, fin: 6, margeGardeMs: 3000 });
    assert.ok("error" in resultat, "des fragments partiels ne font pas une réponse");
    assert.match((resultat as { error: string }).error, /interrompue|incomplet|arrêtée/);
    assert.ok(faux.fragments() > 0, "…et il y AVAIT bien des fragments à rendre : c'est tout l'enjeu");
  } finally {
    faux.restaurer();
  }
});

await test("T8. une vidéo plus courte que la borne demandée donne un extrait LÉGITIMEMENT court", async () => {
  // `ended` est le cas honnête : la borne de fin dépassait la durée réelle,
  // on a tout capturé. Le refus ne doit pas mordre ici.
  const faux = installerFauxNavigateur({
    scenario: { genre: "fin_precoce", aLaSeconde: 2 },
    duree: 10,
    avecRvfc: false,
  });
  try {
    const resultat = await decouperVideo(new Blob(["src"]), { debut: 0, fin: 8, margeGardeMs: 3000 });
    assert.ok(!("error" in resultat), `refus injustifié : ${JSON.stringify(resultat)}`);
  } finally {
    faux.restaurer();
  }
});

await test("T9. une interruption rend une ERREUR, jamais un demi-fichier", async () => {
  const faux = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 10, avecRvfc: false });
  try {
    const controleur = new AbortController();
    setTimeout(() => controleur.abort(), 30);
    const resultat = await decouperVideo(new Blob(["src"]), {
      debut: 0, fin: 9, signal: controleur.signal, margeGardeMs: 5000,
    });
    assert.ok("error" in resultat);
    assert.match((resultat as { error: string }).error, /interrompue|incomplet|arrêtée/);
  } finally {
    faux.restaurer();
  }
});

await test("T10. « aucune découpe » ne réencode rien : la source est rendue telle quelle", async () => {
  const faux = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 12, avecRvfc: false });
  try {
    const source = new Blob(["source"]);
    const resultat = await decouperVideo(source, {
      debut: 0, fin: 12, mimeSource: "video/mp4", dureeSource: 12, margeGardeMs: 2000,
    });
    assert.ok(!("error" in resultat));
    assert.equal((resultat as { fichier: Blob }).fichier, source, "le fichier rendu EST la source");
    assert.equal(faux.fragments(), 0, "aucun enregistrement n'a été lancé");
  } finally {
    faux.restaurer();
  }
});

await test("T11. l'écran abandonne la découpe et la caméra quand il disparaît", () => {
  // Non prouvable ici : `useEffect` ne s'exécute pas au rendu serveur. Ce
  // contrôle atteste le CÂBLAGE, et la checklist iPhone atteste l'effet.
  const champ = sansCommentairesTs(CHAMP);
  assert.ok(/return \(\) => \{\s*interruption\.current\?\.abort\(\);/.test(champ),
    "fermer la modale doit interrompre la découpe en cours");
  assert.ok(/capturePourNettoyage\.current\?\.abandonner\(\)/.test(champ),
    "et éteindre la caméra restée ouverte");
  // La durée du résultat est MESURÉE, pas déduite de l'intervalle demandé.
  assert.ok(champ.includes("await lireDureeVideo(resultat.fichier)"),
    "la durée opposée au plafond doit venir du fichier produit");
});

/* ════════════════════════════════════════════════════════════════════════
 * S7. SAFARI — la détection est RÉELLE, pas déclarative
 * ════════════════════════════════════════════════════════════════════════ */

await test("S7. chaque brique de la découpe est cherchée avant d'être utilisée", async () => {
  // Hors navigateur : indisponible, sans raison affichable (il n'y a pas
  // d'utilisateur à prévenir dans Node).
  assert.equal(decoupeDisponible().disponible, false);
  assert.equal(captureCoachDisponible().disponible, false);

  // Avec toutes les briques : disponible.
  const complet = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 5 });
  try {
    assert.equal(decoupeDisponible().disponible, true);
  } finally {
    complet.restaurer();
  }

  // AudioContext présent mais AMPUTÉ de la méthode dont la découpe a besoin :
  // c'est le cas qui ferait échouer au milieu du traitement si l'on se
  // contentait de tester le constructeur.
  const ampute = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 5 });
  try {
    const w = (globalThis as unknown as { window: { AudioContext: { prototype: Record<string, unknown> } } }).window;
    delete w.AudioContext.prototype.createMediaStreamDestination;
    const verdict = decoupeDisponible();
    assert.equal(verdict.disponible, false);
    assert.ok(verdict.raison, "et l'utilisateur doit LIRE pourquoi, avec un repli");
    assert.match(verdict.raison!, /entière/, "le repli proposé est d'envoyer la vidéo entière");
  } finally {
    ampute.restaurer();
  }

  // Aucun format d'enregistrement accepté : même traitement.
  const sansType = installerFauxNavigateur({ scenario: { genre: "normal" }, duree: 5, typesAcceptes: [] });
  try {
    const verdict = decoupeDisponible();
    assert.equal(verdict.disponible, false);
    assert.match(verdict.raison!, /entière/);
  } finally {
    sansType.restaurer();
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * X. LES DEUX PROFILS DE PURGE, DANS LA MÊME SUITE
 * ════════════════════════════════════════════════════════════════════════ */

await test("X1. CLOISONNEMENT DANS LES DEUX SENS : aucune purge ne voit le bucket de l'autre", async () => {
  // Sens 1 : le balayeur des COACHS ne touche pas les vidéos d'élève.
  const cotéCoach = creerBaseCoach();
  poser(cotéCoach, chemin(ELEVE_A, 1), 40 * JOUR);
  const videosEleve = new Set<string>([chemin(ELEVE_A, 9)]);
  cotéCoach.autresBuckets.set("feedback-videos", videosEleve);
  await purger(cotéCoach);
  assert.equal(videosEleve.size, 1, "les vidéos d'élève sont intactes");
  assert.ok(!cotéCoach.journalStorage.some((l) => l.includes("feedback-videos")));

  // Sens 2 : le balayeur des ÉLÈVES ne touche pas les réponses de coach.
  // Même durée d'objet (40 jours) : s'il y touchait, il les jugerait expirées.
  const cotéEleve = creerBase();
  cotéEleve.objets.add(chemin(ELEVE_A, 1));
  cotéEleve.datesObjets.set(chemin(ELEVE_A, 1), IL_Y_A(40 * JOUR));
  const reponsesCoach = new Set<string>([chemin(ELEVE_A, 9)]);
  cotéEleve.autresBuckets.set(COACH_REPLY_VIDEO_BUCKET, reponsesCoach);
  await purgeFeedbackVideos(cotéEleve.client, { maintenant: MAINTENANT });
  assert.equal(reponsesCoach.size, 1, "les réponses de coach sont intactes");
  assert.ok(!cotéEleve.journalStorage.some((l) => l.includes(COACH_REPLY_VIDEO_BUCKET)));
});

await test("X2. les deux profils gardent LEURS seuils : 30 jours contre 3", async () => {
  // Un objet de 10 jours : expiré côté coach, parfaitement vivant côté élève.
  // C'est le contrôle qui attrape un profil recopié de travers.
  const coach = creerBaseCoach();
  const pc = poser(coach, chemin(ELEVE_A, 1), 10 * JOUR);
  const idc = retour(coach, ELEVE_A, null);
  await updateWorkoutFeedbackCoachReply(coach.client, idc, { texte: "x", videoPath: pc });
  const bilanCoach = await purger(coach);
  assert.equal(bilanCoach.expireesSupprimees, 1, "3 jours : la réponse est partie");

  const eleve = creerBase();
  const pe = chemin(ELEVE_A, 1);
  eleve.objets.add(pe);
  eleve.datesObjets.set(pe, IL_Y_A(10 * JOUR));
  eleve.table("exercise_feedback").push({
    id: "ef-1", workout_feedback_id: "wf-1", student_id: ELEVE_A,
    exercise_name: "Développé couché", exercise_order: 0, comment: "",
    video_path: pe, video_uploaded_at: IL_Y_A(10 * JOUR),
  });
  const bilanEleve = await purgeFeedbackVideos(eleve.client, { maintenant: MAINTENANT });
  assert.equal(bilanEleve.expireesSupprimees, 0, "30 jours : la vidéo d'élève reste");
  assert.ok(eleve.objets.has(pe));
});

await test("X3. le plafond par exécution et la réconciliation valent AUSSI pour les réponses", async () => {
  // Le plafond : trois expirées, deux autorisées par passage.
  const base = creerBaseCoach();
  for (let n = 1; n <= 3; n += 1) {
    const p = poser(base, chemin(ELEVE_A, n), (10 + n) * JOUR);
    const id = retour(base, ELEVE_A, null);
    await updateWorkoutFeedbackCoachReply(base.client, id, { texte: "x", videoPath: p });
  }
  const borne = await purger(base, { maximumParExecution: 2 });
  assert.equal(borne.expireesSupprimees, 2);
  assert.equal(borne.reportesAuProchainPassage, 1);
  // Les PLUS ANCIENNES d'abord : le retard se draine par le bon bout.
  assert.ok(!base.objets.has(chemin(ELEVE_A, 3)));
  assert.ok(base.objets.has(chemin(ELEVE_A, 1)));

  // La réconciliation : une référence qui désigne un objet absent du bucket
  // est nettoyée — c'est le filet différé de la course distribuée.
  const casse = creerBaseCoach();
  const id = retour(casse, ELEVE_A, null);
  casse.table("workout_feedback")[0]!.coach_reply_video_path = chemin(ELEVE_A, 42);
  casse.table("workout_feedback")[0]!.coach_reply_video_uploaded_at = IL_Y_A(5 * HEURE);
  assert.equal(id, "wf-1");
  const bilan = await purger(casse);
  assert.ok(bilan.reconciliationExecutee, "l'inventaire est complet : elle peut conclure");
  assert.equal(bilan.referencesCasseesDetectees, 1);
  assert.equal(bilan.referencesCasseesNettoyees, 1);
  assert.equal(casse.table("workout_feedback")[0]!.coach_reply_video_path, null);
});

await test("X4. un rattachement TOUT FRAIS n'est jamais déclaré cassé", async () => {
  // Il désigne peut-être un fichier déposé APRÈS l'inventaire : il n'est pas
  // cassé, il est plus récent que notre photographie du bucket.
  const base = creerBaseCoach();
  const id = retour(base, ELEVE_A, null);
  base.table("workout_feedback")[0]!.coach_reply_video_path = chemin(ELEVE_A, 42);
  base.table("workout_feedback")[0]!.coach_reply_video_uploaded_at = IL_Y_A(60_000);
  assert.equal(id, "wf-1");
  const bilan = await purger(base);
  assert.equal(bilan.referencesCasseesDetectees, 0);
  assert.equal(base.table("workout_feedback")[0]!.coach_reply_video_path, chemin(ELEVE_A, 42));
});

/* ════════════════════════════════════════════════════════════════════════
 * G6. SUPPRESSION D'UN ÉLÈVE — les deux buckets, ou rien
 * ════════════════════════════════════════════════════════════════════════ */

await test("G6. l'élève supprimé emporte ses DEUX dossiers, même au-delà de 100 objets", async () => {
  const base = creerBaseCoach();
  for (let n = 0; n < 110; n += 1) base.objets.add(chemin(ELEVE_A, n));
  const videosEleve = new Set<string>();
  for (let n = 0; n < 110; n += 1) videosEleve.add(chemin(ELEVE_A, n));
  base.autresBuckets.set("feedback-videos", videosEleve);
  base.table("students").push({ id: ELEVE_A, user_id: null });

  const resultat = await deleteStudentCompletely(base.client, ELEVE_A);
  assert.deepEqual(resultat, { ok: true });
  assert.equal(base.objets.size, 0, "les 110 réponses de coach sont parties");
  assert.equal(videosEleve.size, 0, "les 110 vidéos d'élève aussi");
  assert.equal(base.table("students").length, 0);
});

await test("G7. une purge INCOMPLÈTE des réponses ARRÊTE la suppression de l'élève", async () => {
  // Un compte effacé qui laisse derrière lui des vidéos privées n'est pas une
  // suppression partielle, c'est une suppression ratée : une fois la ligne
  // partie, plus rien ne relie ce dossier à qui que ce soit.
  const base = creerBaseCoach({
    echecSuppression: (c) => (c.startsWith(`${ELEVE_A}/`) ? "storage indisponible" : null),
  });
  base.objets.add(chemin(ELEVE_A, 1));
  base.table("students").push({ id: ELEVE_A, user_id: null });

  const resultat = await deleteStudentCompletely(base.client, ELEVE_A);
  assert.deepEqual(resultat, { ok: false, error: "storage_error" });
  assert.equal(base.table("students").length, 1, "l'élève n'a PAS été supprimé");
  assert.ok(base.objets.has(chemin(ELEVE_A, 1)));
});


console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
