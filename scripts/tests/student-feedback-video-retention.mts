import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  FEEDBACK_VIDEO_ORPHAN_GRACE_HOURS,
  FEEDBACK_VIDEO_ORPHAN_GRACE_MS,
  PURGE_VIDEO_MAX_PAR_EXECUTION,
  FEEDBACK_VIDEO_RETENTION_MS,
  bornerCandidats,
  classerObjetFeedbackVideo,
  statutHttpPurge,
} from "../../lib/feedback-video-retention";
import { purgeFeedbackVideos } from "../../lib/supabase/purge-feedback-videos";
import { GET as purgeRoute } from "../../app/api/cron/purge-feedback-videos/route";
import { creerBase, type BaseFactice } from "./helpers/supabase-double";

/**
 * F4.1 — RÉTENTION ET PURGE DES VIDÉOS DE TECHNIQUE
 *
 * CE QUE CETTE SUITE PROUVE
 *   Elle fait TOURNER `purgeFeedbackVideos` contre la base factice partagée,
 *   et regarde l'état du bucket et des références après coup. Aucun de ces
 *   contrôles ne se contente de lire du source : la leçon de l'audit F4 est
 *   qu'une suite verte peut couvrir du code mort.
 *
 *   - l'âge vient de `storage.objects.created_at`, JAMAIS de
 *     `video_uploaded_at` — une resoumission ne prolonge rien (A3) ;
 *   - Storage d'abord, base ensuite, et rien n'est déréférencé si le fichier
 *     n'est pas parti (A7) ;
 *   - un orphelin re-référencé entre l'inventaire et la suppression est
 *     épargné (A6) ;
 *   - la purge ne sort jamais de `feedback-videos` (A11) ni ne touche un
 *     chemin difforme (A14) ;
 *   - elle pagine au-delà de 100 objets (A10) et elle est idempotente (A9).
 *
 * CE QU'ELLE NE PEUT PAS PROUVER
 *   Que Vercel appelle bien la route : cela dépend de `vercel.json` et de la
 *   configuration du projet. On vérifie la DÉCLARATION du cron, et le
 *   comportement de la route face à un secret absent, faux, ou juste (A12,
 *   A13). Le reste appartient à la Preview.
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

const ELEVE_A = "32000000-0000-4000-8000-000000000002";
const ELEVE_B = "32000000-0000-4000-8000-000000000003";

const MAINTENANT = Date.parse("2026-09-01T12:00:00.000Z");
const IL_Y_A = (ms: number) => new Date(MAINTENANT - ms).toISOString();
const JOUR = 24 * 60 * 60 * 1000;
const HEURE = 60 * 60 * 1000;

/** Un chemin conforme, indexé pour que chaque test ait le sien. */
function chemin(eleve: string, n: number, ext = "mp4"): string {
  return `${eleve}/${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.${ext}`;
}

/** Pose un objet dans le bucket avec une date de création RÉELLE. */
function poser(base: BaseFactice, path: string, creeIlYaMs: number): string {
  base.objets.add(path);
  base.datesObjets.set(path, IL_Y_A(creeIlYaMs));
  return path;
}

/**
 * Une ligne d'exercice qui RÉFÉRENCE un chemin. On écrit directement dans la
 * table du double : ce qui est testé ici est la purge, pas l'écriture d'un
 * retour — celle-là a sa propre suite.
 *
 * `video_uploaded_at` est posé volontairement RÉCENT sur demande : c'est le
 * cœur du contrôle A3.
 */
function referencer(base: BaseFactice, path: string, videoUploadedAt: string): void {
  base.table("exercise_feedback").push({
    id: `ef-${base.table("exercise_feedback").length + 1}`,
    workout_feedback_id: "wf-1",
    student_id: path.split("/")[0],
    exercise_name: "Développé couché",
    exercise_order: 0,
    comment: "",
    video_path: path,
    video_uploaded_at: videoUploadedAt,
  });
}

const purger = (base: BaseFactice, options: { maximumParExecution?: number } = {}) =>
  purgeFeedbackVideos(base.client, { maintenant: MAINTENANT, ...options });

/* ════════════════════════════════════════════════════════════════════════
 * LES DÉCISIONS PURES — avant de faire tourner quoi que ce soit
 * ════════════════════════════════════════════════════════════════════════ */

await test("P1. les seuils sont ceux annoncés : 30 jours, 24 heures", () => {
  assert.equal(FEEDBACK_VIDEO_RETENTION_MS, 30 * JOUR);
  assert.equal(FEEDBACK_VIDEO_ORPHAN_GRACE_HOURS, 24);
  assert.equal(FEEDBACK_VIDEO_ORPHAN_GRACE_MS, JOUR);
});

await test("P2. la classification tranche les quatre cas, et signale le difforme", () => {
  const vieux = { path: chemin(ELEVE_A, 1), creeLe: MAINTENANT - 31 * JOUR };
  const jeune = { path: chemin(ELEVE_A, 2), creeLe: MAINTENANT - 2 * JOUR };

  assert.deepEqual(classerObjetFeedbackVideo(vieux, { estReference: true, maintenant: MAINTENANT }), {
    action: "supprimer",
    raison: "expired_reference",
  });
  assert.deepEqual(classerObjetFeedbackVideo(jeune, { estReference: true, maintenant: MAINTENANT }), {
    action: "garder",
    raison: "referencee_non_expiree",
  });
  assert.deepEqual(classerObjetFeedbackVideo(jeune, { estReference: false, maintenant: MAINTENANT }), {
    action: "supprimer",
    raison: "orphan",
  });
  assert.deepEqual(
    classerObjetFeedbackVideo(
      { path: chemin(ELEVE_A, 3), creeLe: MAINTENANT - 2 * HEURE },
      { estReference: false, maintenant: MAINTENANT },
    ),
    { action: "garder", raison: "delai_de_grace" },
  );
  // La forme est jugée EN PREMIER : un chemin illisible ne tombe jamais dans
  // la branche « supprimer », même vieux de dix ans et référencé par rien.
  assert.deepEqual(
    classerObjetFeedbackVideo(
      { path: "n-importe-quoi.mp4", creeLe: MAINTENANT - 3650 * JOUR },
      { estReference: false, maintenant: MAINTENANT },
    ),
    { action: "signaler", raison: "chemin_malforme" },
  );
});

await test("P3. le plafond garde les PLUS ANCIENS et reporte le reste", () => {
  const candidats = Array.from({ length: 7 }, (_, n) => ({
    path: chemin(ELEVE_A, n),
    creeLe: MAINTENANT - (n + 1) * JOUR,
  }));
  const { retenus, reportes } = bornerCandidats(candidats, 3);
  assert.equal(retenus.length, 3);
  assert.equal(reportes, 4);
  // Le plus vieux d'abord : le backlog se draine par le bon bout.
  assert.deepEqual(retenus.map((o) => o.creeLe), [
    MAINTENANT - 7 * JOUR,
    MAINTENANT - 6 * JOUR,
    MAINTENANT - 5 * JOUR,
  ]);
  assert.equal(PURGE_VIDEO_MAX_PAR_EXECUTION, 500);
});

/* ════════════════════════════════════════════════════════════════════════
 * A. CATÉGORIE A — LES VIDÉOS RÉFÉRENCÉES EXPIRÉES
 * ════════════════════════════════════════════════════════════════════════ */

await test("A1. vidéo référencée de plus de 30 jours : objet supprimé, référence levée", async () => {
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, v, IL_Y_A(31 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.expireesDetectees, 1);
  assert.equal(bilan.expireesSupprimees, 1);
  assert.equal(bilan.referencesNettoyees, 1);
  assert.ok(!base.objets.has(v), "l'objet doit avoir disparu du bucket");
  const ligne = base.table("exercise_feedback")[0]!;
  assert.equal(ligne.video_path, null, "video_path doit être levé");
  assert.equal(ligne.video_uploaded_at, null, "et video_uploaded_at avec — dérivé par le gardien");
  assert.deepEqual(bilan.suppressions.map((s) => s.raison), ["expired_reference"]);
});

await test("A2. vidéo référencée de moins de 30 jours : rien ne bouge", async () => {
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 29 * JOUR);
  referencer(base, v, IL_Y_A(29 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.expireesDetectees, 0);
  assert.equal(bilan.orphelinsDetectes, 0);
  assert.ok(base.objets.has(v));
  assert.equal(base.table("exercise_feedback")[0]!.video_path, v);
  assert.equal(base.journalStorage.filter((l) => l.startsWith("remove:")).length, 0);
});

await test("A3. video_uploaded_at RÉCENT mais objet vieux : la vidéo part quand même", async () => {
  // LE CONTRÔLE CENTRAL DE F4.1. Le retour a été resoumis hier, donc le
  // trigger a redaté `video_uploaded_at`. Si la purge s'appuyait dessus, la
  // vidéo serait éternelle : il suffirait de rouvrir son retour tous les 29
  // jours. Seul `storage.objects.created_at` fait autorité.
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 45 * JOUR);
  referencer(base, v, IL_Y_A(1 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.expireesSupprimees, 1, "l'âge du FICHIER doit primer sur la date de la ligne");
  assert.ok(!base.objets.has(v));
  assert.equal(base.table("exercise_feedback")[0]!.video_path, null);
  // Et la trace dit bien l'âge réel, pas celui de la ligne.
  assert.equal(bilan.suppressions[0]!.creeLe, IL_Y_A(45 * JOUR));
});

/* ════════════════════════════════════════════════════════════════════════
 * B. CATÉGORIE B — LES ORPHELINS
 * ════════════════════════════════════════════════════════════════════════ */

await test("A4. orphelin de plus de 24 h : supprimé", async () => {
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 25 * HEURE);

  const bilan = await purger(base);

  assert.equal(bilan.orphelinsDetectes, 1);
  assert.equal(bilan.orphelinsSupprimes, 1);
  assert.ok(!base.objets.has(v));
  assert.deepEqual(bilan.suppressions.map((s) => s.raison), ["orphan"]);
});

await test("A5. orphelin de moins de 24 h : conservé", async () => {
  // Le cas réel que ce délai protège : la vidéo est déposée AVANT l'envoi du
  // retour. Sans grâce, la purge effacerait le fichier d'un élève en train
  // de remplir sa séance.
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 3 * HEURE);

  const bilan = await purger(base);

  assert.equal(bilan.orphelinsDetectes, 0);
  assert.ok(base.objets.has(v));
  assert.equal(base.journalStorage.filter((l) => l.startsWith("remove:")).length, 0);
});

await test("A6. orphelin RÉFÉRENCÉ entre l'inventaire et la suppression : épargné", async () => {
  // La course réelle : la purge inventorie, l'élève envoie son retour, la
  // purge s'apprête à effacer. La revalidation est le seul rempart.
  const base = creerBase();
  const v = poser(base, chemin(ELEVE_A, 1), 30 * HEURE);

  // On force la course, de façon DÉTERMINISTE : la lecture groupée des
  // références se résout d'abord (le fichier est bien orphelin à cet
  // instant), et c'est juste APRÈS, avant la boucle B, que l'élève envoie
  // son retour. C'est exactement la fenêtre que la revalidation existe pour
  // couvrir. Un `setTimeout` ou un `queueMicrotask` ne garantirait pas
  // l'ordre — on se greffe donc sur la résolution elle-même.
  type Chaine = { then: (r: (v: unknown) => void) => void };
  const clientProxy = base.client as unknown as { from: (n: string) => Chaine };
  const fromOriginal = clientProxy.from.bind(clientProxy);
  let courseDeclenchee = false;
  clientProxy.from = (nom: string) => {
    const chaine = fromOriginal(nom);
    if (nom === "exercise_feedback" && !courseDeclenchee) {
      courseDeclenchee = true;
      const thenOriginal = chaine.then.bind(chaine);
      chaine.then = (resoudre: (v: unknown) => void) =>
        thenOriginal((valeur: unknown) => {
          referencer(base, v, IL_Y_A(1 * HEURE));
          resoudre(valeur);
        });
    }
    return chaine;
  };

  const bilan = await purger(base);

  assert.equal(bilan.orphelinsDetectes, 1, "il était bien candidat au moment de l'inventaire");
  assert.equal(bilan.orphelinsSupprimes, 0, "mais il ne doit PAS avoir été supprimé");
  assert.equal(bilan.orphelinsEpargnesParRevalidation, 1);
  assert.ok(base.objets.has(v), "la vidéo tout juste rattachée doit survivre");
});

/* ════════════════════════════════════════════════════════════════════════
 * C. ÉCHECS, IDEMPOTENCE, VOLUME, CLOISONNEMENT
 * ════════════════════════════════════════════════════════════════════════ */

await test("A7a. échec du nettoyage DB : RIEN n'est effacé, tout est réessayable", async () => {
  // L'ordre est base d'abord, storage ensuite. Un échec au premier temps
  // doit donc laisser l'état parfaitement intact : le fichier ET sa
  // référence. C'est le cas le plus bénin, et il doit le rester.
  const base = creerBase({ echecNettoyageBase: () => "deadlock detected" });
  const v = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, v, IL_Y_A(31 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.expireesDetectees, 1);
  assert.equal(bilan.expireesSupprimees, 0);
  assert.equal(bilan.referencesNettoyees, 0);
  assert.ok(base.objets.has(v), "l'objet ne doit PAS avoir été effacé");
  assert.equal(base.table("exercise_feedback")[0]!.video_path, v, "la référence tient");
  assert.deepEqual(bilan.echecs, [{ path: v, etape: "base", message: "deadlock detected" }]);
  assert.equal(
    base.journalStorage.filter((l) => l.startsWith("remove:")).length,
    0,
    "aucune suppression ne doit être tentée quand la base a refusé",
  );

  // Le passage suivant, sans la panne, aboutit : rien n'était perdu.
  const base2 = creerBase();
  const v2 = poser(base2, v, 31 * JOUR);
  referencer(base2, v2, IL_Y_A(31 * JOUR));
  const bilan2 = await purger(base2);
  assert.equal(bilan2.expireesSupprimees, 1);
  assert.equal(bilan2.referencesNettoyees, 1);
});

await test("A7b. DB nettoyée puis échec Storage : l'objet devient un ORPHELIN récupérable", async () => {
  // Le cas que l'inversion de l'ordre rend bénin. Avant, c'était l'inverse
  // qui se produisait — fichier effacé, référence intacte — et comme les
  // candidats sont inventoriés DEPUIS Storage, cette référence cassée
  // n'aurait plus jamais été retrouvée.
  const base = creerBase({ echecSuppression: () => "Service Unavailable" });
  const v = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, v, IL_Y_A(31 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.referencesNettoyees, 1, "la référence a bien été levée");
  assert.equal(bilan.expireesSupprimees, 0, "…mais le fichier n'est pas parti");
  assert.equal(bilan.expireesDereferenceesSansSuppression, 1);
  const ligne = base.table("exercise_feedback")[0]!;
  assert.equal(ligne.video_path, null, "video_path est NULL");
  assert.equal(ligne.video_uploaded_at, null, "et la date suit, dérivée par le gardien");
  assert.ok(base.objets.has(v), "l'objet est toujours là — orphelin, pas perdu");
  assert.equal(bilan.echecs.length, 1);
  assert.equal(bilan.echecs[0]!.etape, "storage");

  // ON NE RECRÉE JAMAIS LA RÉFÉRENCE : elle pointerait vers un fichier qu'on
  // vient de décider d'effacer. C'est la catégorie B qui reprend l'objet au
  // passage suivant, sans panne cette fois.
  const suivant = creerBase();
  poser(suivant, v, 31 * JOUR);
  const bilan2 = await purger(suivant);
  assert.equal(bilan2.orphelinsDetectes, 1, "l'objet relève désormais de la catégorie B");
  assert.equal(bilan2.orphelinsSupprimes, 1);
  assert.equal(suivant.objets.size, 0);
});

await test("A7c. REMPLACEMENT concurrent avant l'UPDATE : le nouveau chemin n'est jamais effacé", async () => {
  // V1 est expirée et référencée à l'inventaire. Entre l'inventaire et
  // l'action, l'élève remplace par V2 : la ligne porte désormais V2, donc
  // l'UPDATE conditionné sur V1 ne touche AUCUNE ligne. Ce n'est pas une
  // suppression réussie — et surtout, V2 ne doit pas être emportée.
  const base = creerBase();
  const v1 = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  const v2 = poser(base, chemin(ELEVE_A, 2), 1 * HEURE);
  referencer(base, v1, IL_Y_A(31 * JOUR));

  type Chaine = { then: (r: (v: unknown) => void) => void };
  const clientProxy = base.client as unknown as { from: (n: string) => Chaine };
  const fromOriginal = clientProxy.from.bind(clientProxy);
  let coursePosee = false;
  clientProxy.from = (nom: string) => {
    const chaine = fromOriginal(nom);
    if (nom === "exercise_feedback" && !coursePosee) {
      coursePosee = true;
      const thenOriginal = chaine.then.bind(chaine);
      chaine.then = (resoudre: (v: unknown) => void) =>
        thenOriginal((valeur: unknown) => {
          // L'élève vient d'envoyer son retour avec la nouvelle vidéo.
          base.table("exercise_feedback")[0]!.video_path = v2;
          resoudre(valeur);
        });
    }
    return chaine;
  };

  const bilan = await purger(base);

  assert.equal(bilan.expireesSupprimees, 0, "zéro ligne touchée n'est pas une suppression réussie");
  assert.equal(bilan.referencesNettoyees, 0);
  assert.equal(bilan.expireesRemplaceesEntreTemps, 1);
  assert.equal(base.table("exercise_feedback")[0]!.video_path, v2, "LE NOUVEAU CHEMIN EST INTACT");
  assert.ok(base.objets.has(v2), "et son fichier aussi");
  // V1, elle, n'est plus référencée : la catégorie B la reprend, revalidation
  // comprise — et comme elle a 31 jours, elle passe le délai de grâce.
  assert.ok(!base.objets.has(v1), "V1 est traitée comme l'orpheline qu'elle est devenue");
  assert.deepEqual(bilan.suppressions.map((s) => s.raison), ["orphan"]);
});

await test("A8. un échec n'empêche pas les AUTRES objets d'être traités", async () => {
  const recalcitrant = chemin(ELEVE_A, 1);
  const base = creerBase({ echecSuppression: (c) => (c === recalcitrant ? "Locked" : null) });
  poser(base, recalcitrant, 31 * JOUR);
  referencer(base, recalcitrant, IL_Y_A(31 * JOUR));
  const ok1 = poser(base, chemin(ELEVE_A, 2), 40 * JOUR);
  referencer(base, ok1, IL_Y_A(40 * JOUR));
  const ok2 = poser(base, chemin(ELEVE_B, 3), 5 * JOUR);

  const bilan = await purger(base);

  assert.equal(bilan.expireesSupprimees, 1, "l'autre vidéo expirée doit être partie");
  assert.equal(bilan.orphelinsSupprimes, 1, "et l'orphelin aussi");
  assert.equal(bilan.echecs.length, 1);
  assert.equal(bilan.expireesDereferenceesSansSuppression, 1, "le récalcitrant est devenu orphelin");
  assert.ok(base.objets.has(recalcitrant), "seul le récalcitrant reste");
  assert.ok(!base.objets.has(ok1));
  assert.ok(!base.objets.has(ok2));
});

await test("A9. IDEMPOTENCE : un second passage immédiat ne fait plus rien", async () => {
  const base = creerBase();
  const expiree = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, expiree, IL_Y_A(31 * JOUR));
  poser(base, chemin(ELEVE_A, 2), 25 * HEURE);
  const gardee = poser(base, chemin(ELEVE_B, 3), 2 * JOUR);
  referencer(base, gardee, IL_Y_A(2 * JOUR));

  const premier = await purger(base);
  assert.equal(premier.expireesSupprimees, 1);
  assert.equal(premier.orphelinsSupprimes, 1);

  base.journalStorage.length = 0;
  const second = await purger(base);

  assert.equal(second.expireesDetectees, 0);
  assert.equal(second.orphelinsDetectes, 0);
  assert.equal(second.expireesSupprimees, 0);
  assert.equal(second.orphelinsSupprimes, 0);
  assert.equal(second.echecs.length, 0);
  assert.equal(
    base.journalStorage.filter((l) => l.startsWith("remove:")).length,
    0,
    "aucune suppression au second passage",
  );
  assert.ok(base.objets.has(gardee), "et la vidéo encore valide n'a pas bougé");
});

await test("A10. PAGINATION : 250 objets répartis sur trois dossiers sont tous vus", async () => {
  const base = creerBase();
  const eleves = [ELEVE_A, ELEVE_B, "32000000-0000-4000-8000-000000000006"];
  let poses = 0;
  for (const eleve of eleves) {
    // 110 par dossier : au-dessus des 100 que `list()` rend par défaut, donc
    // la seconde page est réellement nécessaire. Un test à 84 par dossier
    // aurait dépassé 250 au total sans jamais exercer la pagination.
    for (let n = 0; n < 110; n += 1) {
      poser(base, chemin(eleve, n), 40 * JOUR);
      poses += 1;
    }
  }
  assert.equal(poses, 330, "plus de 100 par dossier : la pagination est réellement exercée");

  const bilan = await purger(base);

  assert.equal(bilan.objetsInventories, 330, "list() ne s'arrête pas à la centième");
  assert.equal(bilan.orphelinsDetectes, 330);
  assert.equal(bilan.orphelinsSupprimes, 330);
  assert.equal(base.objets.size, 0);
  // La pagination est visible dans le journal : plusieurs pages par dossier.
  const pages = base.journalStorage.filter((l) => l.startsWith("list:feedback-videos:32"));
  assert.ok(pages.length >= 6, `au moins deux pages par dossier (${pages.length})`);
});

await test("A10bis. le plafond par exécution borne le travail et reporte le reste", async () => {
  const base = creerBase();
  for (let n = 0; n < 120; n += 1) poser(base, chemin(ELEVE_A, n), (40 + n) * JOUR);

  const bilan = await purger(base, { maximumParExecution: 50 });

  assert.equal(bilan.orphelinsDetectes, 120);
  assert.equal(bilan.orphelinsSupprimes, 50, "le plafond mord");
  assert.equal(bilan.reportesAuProchainPassage, 70);
  assert.equal(base.objets.size, 70);

  // Le backlog se draine de lui-même aux passages suivants.
  await purger(base, { maximumParExecution: 50 });
  await purger(base, { maximumParExecution: 50 });
  assert.equal(base.objets.size, 0, "trois passages suffisent, sans intervention");
});

await test("A11. CLOISONNEMENT : aucun autre bucket n'est touché", async () => {
  const base = creerBase();
  poser(base, chemin(ELEVE_A, 1), 40 * JOUR);
  // Des objets vieux et non référencés dans les autres buckets du dépôt :
  // s'ils partaient, la purge aurait débordé de son périmètre.
  for (const seau of ["videos", "progress-photos", "recipe-images", "documents", "banners"]) {
    base.autresBuckets.set(seau, new Set([`${ELEVE_A}/00000000-0000-4000-8000-000000000000.mp4`]));
  }

  const bilan = await purger(base);

  assert.equal(bilan.orphelinsSupprimes, 1);
  for (const [seau, contenu] of base.autresBuckets) {
    assert.equal(contenu.size, 1, `le bucket ${seau} a été touché`);
  }
  // Le journal ne doit mentionner AUCUN autre bucket.
  const buckets = new Set(base.journalStorage.map((l) => l.split(":")[1]));
  assert.deepEqual([...buckets], ["feedback-videos"]);
});

await test("A14. un chemin MALFORMÉ est signalé, jamais effacé", async () => {
  const base = creerBase();
  // Trois formes tordues, toutes très anciennes et référencées par rien :
  // sans le contrôle de forme, elles partiraient toutes.
  const tordus = [
    `${ELEVE_A}/pas-un-uuid.mp4`,
    `${ELEVE_A}/00000000-1111-4111-8111-111111111111.exe`,
  ];
  for (const t of tordus) poser(base, t, 90 * JOUR);
  const sain = poser(base, chemin(ELEVE_B, 9), 90 * JOUR);

  const bilan = await purger(base);

  assert.equal(bilan.cheminsMalformes.length, 2, "les deux doivent être SIGNALÉS");
  assert.deepEqual([...bilan.cheminsMalformes].sort(), [...tordus].sort());
  for (const t of tordus) assert.ok(base.objets.has(t), `objet difforme effacé : ${t}`);
  assert.ok(!base.objets.has(sain), "…mais le chemin conforme, lui, est bien traité");
  assert.equal(bilan.orphelinsSupprimes, 1);
});

await test("A17. un fichier posé À LA RACINE du bucket est SIGNALÉ, jamais ignoré", async () => {
  // Les policies l'interdisent, mais le tableau de bord Supabase, lui, ne
  // demande rien à personne. L'inventaire ne descendait que dans les
  // dossiers : un fichier racine était donc INVISIBLE — ni supprimé, ni
  // signalé, ni compté. C'est le pire des trois états.
  const base = creerBase();
  base.objets.add("foo.mp4");
  base.datesObjets.set("foo.mp4", IL_Y_A(90 * JOUR));
  base.objets.add("sans-extension");
  base.datesObjets.set("sans-extension", IL_Y_A(90 * JOUR));
  const sain = poser(base, chemin(ELEVE_A, 1), 40 * JOUR);

  const bilan = await purger(base);

  assert.deepEqual([...bilan.cheminsMalformes].sort(), ["foo.mp4", "sans-extension"]);
  assert.ok(base.objets.has("foo.mp4"), "un fichier racine ne doit JAMAIS être supprimé");
  assert.ok(base.objets.has("sans-extension"));
  // …et le balayage normal continue autour d'eux.
  assert.ok(!base.objets.has(sain));
  assert.equal(bilan.orphelinsSupprimes, 1);
});

await test("A18. un SOUS-DOSSIER inattendu est signalé, et rien n'y est effacé", async () => {
  // `feedback-videos/<student_id>/extra/video.mp4`. La forme n'a que deux
  // segments : on ne descend pas dans ce troisième niveau — on ne saurait
  // pas quoi y faire — mais on le NOMME, avec sa barre finale pour qu'on
  // voie tout de suite que ce n'est pas un fichier.
  const base = creerBase();
  const enfoui = `${ELEVE_A}/extra/00000000-1111-4111-8111-111111111111.mp4`;
  base.objets.add(enfoui);
  base.datesObjets.set(enfoui, IL_Y_A(90 * JOUR));
  const sain = poser(base, chemin(ELEVE_A, 1), 40 * JOUR);

  const bilan = await purger(base);

  assert.deepEqual(bilan.cheminsMalformes, [`${ELEVE_A}/extra/`]);
  assert.ok(base.objets.has(enfoui), "rien du sous-dossier ne doit être effacé");
  assert.ok(!base.objets.has(sain), "le voisin conforme, lui, est bien traité");
  // Un dossier non-UUID à la racine se signale par la forme du chemin qu'il
  // produit, pas par sa profondeur — les deux chemins mènent au même refus.
  const base2 = creerBase();
  base2.objets.add("foo/bar.mp4");
  base2.datesObjets.set("foo/bar.mp4", IL_Y_A(90 * JOUR));
  const bilan2 = await purger(base2);
  assert.deepEqual(bilan2.cheminsMalformes, ["foo/bar.mp4"]);
  assert.ok(base2.objets.has("foo/bar.mp4"));
});

await test("A19. STATUT HTTP : 200 si tout va bien, 500 dès qu'un objet a réellement échoué", async () => {
  // Purge propre : rien à signaler.
  const propre = creerBase();
  const v = poser(propre, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(propre, v, IL_Y_A(31 * JOUR));
  const bilanPropre = await purger(propre);
  assert.equal(bilanPropre.echecs.length, 0);
  assert.equal(statutHttpPurge(bilanPropre), 200);

  // Échec Storage réel : le cron doit être ROUGE, bilan rendu quand même.
  const casse = creerBase({ echecSuppression: () => "Service Unavailable" });
  const v2 = poser(casse, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(casse, v2, IL_Y_A(31 * JOUR));
  const bilanCasse = await purger(casse);
  assert.equal(bilanCasse.echecs.length, 1);
  assert.equal(statutHttpPurge(bilanCasse), 500);
  assert.ok(bilanCasse.suppressions !== undefined, "le bilan complet reste rendu");

  // Échec base réel : rouge aussi.
  const casseBase = creerBase({ echecNettoyageBase: () => "deadlock detected" });
  const v3 = poser(casseBase, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(casseBase, v3, IL_Y_A(31 * JOUR));
  assert.equal(statutHttpPurge(await purger(casseBase)), 500);

  // Chemins non traités SEULS : avertissement, pas panne. Un cron rouge en
  // permanence pour un fichier oublié une fois ne se lit plus.
  const avecAnomalie = creerBase();
  avecAnomalie.objets.add("foo.mp4");
  avecAnomalie.datesObjets.set("foo.mp4", IL_Y_A(90 * JOUR));
  const bilanAnomalie = await purger(avecAnomalie);
  assert.equal(bilanAnomalie.cheminsMalformes.length, 1);
  assert.equal(bilanAnomalie.echecs.length, 0);
  assert.equal(statutHttpPurge(bilanAnomalie), 200, "un avertissement ne fait pas échouer le cron");
});

await test("A20. et la route applique bien cette règle, sans la réécrire", () => {
  const route = lire("../../app/api/cron/purge-feedback-videos/route.ts");
  assert.ok(route.includes("statutHttpPurge(bilan)"), "la règle vit à UN seul endroit");
  assert.ok(route.includes("{ status: statut }"));
  assert.ok(route.includes("ok: statut === 200"));
  // Le bilan complet part quand même : un cron rouge sans détail n'aide personne.
  assert.ok(route.includes("...bilan"));
});

/* ════════════════════════════════════════════════════════════════════════
 * R. LA COURSE DISTRIBUÉE — et les deux filets qui la rattrapent
 *
 * PostgreSQL et Storage sont deux systèmes : aucun ordre, aucun UPDATE
 * conditionnel ne les rend atomiques. Ces quatre contrôles ne prouvent donc
 * pas que la course est impossible — elle ne l'est pas — mais qu'on en sort.
 * ════════════════════════════════════════════════════════════════════════ */

await test("R1. référence RÉAPPARUE pendant la fenêtre : levée dans la foulée", async () => {
  // La course exacte : la purge lève la référence de V1, un vieil onglet
  // renvoie le formulaire et réécrit V1, PUIS le remove aboutit. Sans le
  // second UPDATE, la base pointerait vers un fichier qui n'existe plus.
  const base = creerBase({
    avantSuppression: (c) => {
      // Le formulaire d'un onglet resté ouvert réattache exactement V1.
      const ligne = base.table("exercise_feedback")[0];
      if (ligne && ligne.video_path === null) ligne.video_path = c;
    },
  });
  const v1 = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, v1, IL_Y_A(31 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.expireesSupprimees, 1, "le fichier est bien parti");
  assert.ok(!base.objets.has(v1));
  // AUCUNE référence vers V1 ne doit subsister, ni dans la table…
  const restantes = base.table("exercise_feedback").filter((l) => l.video_path === v1);
  assert.deepEqual(restantes, [], "la référence réapparue doit avoir été levée");
  assert.equal(base.table("exercise_feedback")[0]!.video_uploaded_at, null,
    "et la date suit, dérivée par le gardien");
  // …ni dans le bilan : la reprise est comptée, pas silencieuse.
  assert.equal(bilan.referencesNettoyees, 2, "la première levée, puis la reprise");
});

await test("R2. nettoyage post-suppression en échec : la RÉCONCILIATION rattrape au passage suivant", async () => {
  // On fait échouer UNIQUEMENT le second UPDATE : le fichier part, la
  // référence réapparue reste. C'est exactement l'état que la réconciliation
  // existe pour réparer.
  let appels = 0;
  const base = creerBase({
    echecNettoyageBase: () => (++appels === 2 ? "connection reset" : null),
    avantSuppression: (c) => {
      const ligne = base.table("exercise_feedback")[0];
      if (ligne && ligne.video_path === null) ligne.video_path = c;
    },
  });
  const v1 = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, v1, IL_Y_A(31 * JOUR));

  const premier = await purger(base);

  assert.ok(!base.objets.has(v1), "le fichier est parti");
  assert.equal(premier.echecs.length, 1, "l'échec du second UPDATE est compté");
  assert.equal(premier.echecs[0]!.etape, "base");
  // La réconciliation de CE passage voit déjà la référence cassée : l'objet
  // ne fait plus partie des existants.
  assert.equal(premier.reconciliationExecutee, true);
  assert.equal(premier.referencesCasseesDetectees, 1);
  assert.equal(premier.referencesCasseesNettoyees, 1);
  assert.equal(base.table("exercise_feedback")[0]!.video_path, null);

  // Et si même cette réconciliation-là avait échoué, le passage SUIVANT la
  // referait : on le prouve en repartant d'un état où la référence cassée
  // subsiste, sans aucune panne cette fois.
  const suivant = creerBase();
  suivant.table("exercise_feedback").push({
    id: "ef-1",
    workout_feedback_id: "wf-1",
    student_id: ELEVE_A,
    exercise_name: "Développé couché",
    exercise_order: 0,
    comment: "",
    video_path: v1,
    video_uploaded_at: IL_Y_A(31 * JOUR),
  });

  const bilan2 = await purger(suivant);

  assert.equal(bilan2.reconciliationExecutee, true);
  assert.equal(bilan2.referencesCasseesDetectees, 1, "V1 est référencée mais absente du bucket");
  assert.equal(bilan2.referencesCasseesNettoyees, 1);
  assert.equal(suivant.table("exercise_feedback")[0]!.video_path, null);
  assert.equal(suivant.table("exercise_feedback")[0]!.video_uploaded_at, null);
});

await test("R3. un objet RÉELLEMENT présent : sa référence n'est jamais touchée", async () => {
  // Le contrôle qui empêche la réconciliation de devenir dangereuse. Trois
  // vidéos parfaitement saines, dont une très récente, une ancienne mais non
  // expirée, et une dans un autre dossier.
  const base = creerBase();
  const a = poser(base, chemin(ELEVE_A, 1), 2 * JOUR);
  const b = poser(base, chemin(ELEVE_A, 2), 29 * JOUR);
  const c = poser(base, chemin(ELEVE_B, 3), 10 * JOUR);
  referencer(base, a, IL_Y_A(2 * JOUR));
  referencer(base, b, IL_Y_A(29 * JOUR));
  referencer(base, c, IL_Y_A(10 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.reconciliationExecutee, true);
  assert.equal(bilan.referencesCasseesDetectees, 0, "rien n'est cassé, rien ne doit être détecté");
  assert.equal(bilan.referencesCasseesNettoyees, 0);
  assert.equal(bilan.erreursReconciliation, 0);
  for (const chemin of [a, b, c]) {
    assert.ok(base.objets.has(chemin), `objet effacé à tort : ${chemin}`);
    assert.equal(
      base.table("exercise_feedback").filter((l) => l.video_path === chemin).length,
      1,
      `référence effacée à tort : ${chemin}`,
    );
  }

  // Et un rattachement TOUT FRAIS vers un objet absent de l'inventaire — le
  // cas d'un dépôt intervenu pendant le passage — est épargné par le
  // garde-fou d'une heure, pas nettoyé par déduction.
  const frais = creerBase();
  referencer(frais, chemin(ELEVE_A, 9), IL_Y_A(5 * 60 * 1000));
  const bilanFrais = await purger(frais);
  assert.equal(bilanFrais.reconciliationExecutee, true);
  assert.equal(bilanFrais.referencesCasseesDetectees, 0, "un rattachement d'il y a 5 minutes est épargné");
  assert.equal(frais.table("exercise_feedback")[0]!.video_path, chemin(ELEVE_A, 9));
});

await test("R4. inventaire Storage INCOMPLET : aucune référence n'est nettoyée par déduction", async () => {
  // Un listing en erreur ferait passer des fichiers bien présents pour
  // disparus. Conclure depuis une information partielle, c'est effacer des
  // références valides — la réconciliation doit donc s'abstenir.
  const base = creerBase({
    echecListe: (prefixe) => (prefixe === "" ? null : "Internal Server Error"),
  });
  const v = poser(base, chemin(ELEVE_A, 1), 10 * JOUR);
  referencer(base, v, IL_Y_A(10 * JOUR));

  const bilan = await purger(base);

  assert.equal(bilan.reconciliationExecutee, false, "elle doit être IGNORÉE");
  assert.equal(bilan.referencesCasseesDetectees, 0);
  assert.equal(bilan.referencesCasseesNettoyees, 0);
  assert.equal(
    base.table("exercise_feedback")[0]!.video_path,
    v,
    "la référence d'un fichier bien présent ne doit surtout pas être levée",
  );
  assert.ok(bilan.echecs.some((e) => e.etape === "storage"), "l'échec de listing est remonté");
  assert.equal(statutHttpPurge(bilan), 500, "et le cron passe au rouge");

  // Même chose quand la RACINE échoue : rien n'est inventorié du tout.
  const racineKo = creerBase({ echecListe: () => "Bad Gateway" });
  const v2 = poser(racineKo, chemin(ELEVE_A, 1), 10 * JOUR);
  referencer(racineKo, v2, IL_Y_A(10 * JOUR));
  const bilan2 = await purger(racineKo);
  assert.equal(bilan2.reconciliationExecutee, false);
  assert.equal(racineKo.table("exercise_feedback")[0]!.video_path, v2);
});

/* ════════════════════════════════════════════════════════════════════════
 * D. LE CYCLE DE VIE RÉEL — remplacement et retrait
 * ════════════════════════════════════════════════════════════════════════ */

await test("A15. REMPLACEMENT V1→V2 : V1 survit 24 h, puis disparaît ; V2 reste", async () => {
  const construire = (ageV1: number) => {
    const base = creerBase();
    const v1 = poser(base, chemin(ELEVE_A, 1), ageV1);
    const v2 = poser(base, chemin(ELEVE_A, 2), 1 * HEURE);
    // Après envoi du retour, la base pointe V2. V1 n'est plus référencée.
    referencer(base, v2, IL_Y_A(1 * HEURE));
    return { base, v1, v2 };
  };

  const avant = construire(3 * HEURE);
  await purger(avant.base);
  assert.ok(avant.base.objets.has(avant.v1), "avant 24 h, V1 reste");
  assert.ok(avant.base.objets.has(avant.v2));

  const apres = construire(30 * HEURE);
  const bilan = await purger(apres.base);
  assert.ok(!apres.base.objets.has(apres.v1), "après 24 h, V1 part");
  assert.ok(apres.base.objets.has(apres.v2), "V2 est référencée et récente : elle reste");
  assert.deepEqual(bilan.suppressions.map((s) => s.path), [apres.v1]);
  assert.equal(apres.base.table("exercise_feedback")[0]!.video_path, apres.v2);
});

await test("A16. RETRAIT : la vidéo déréférencée devient un orphelin ordinaire", async () => {
  const construire = (age: number) => {
    const base = creerBase();
    const v = poser(base, chemin(ELEVE_A, 1), age);
    // L'élève a retiré la vidéo puis envoyé : la ligne existe, sans chemin.
    base.table("exercise_feedback").push({
      id: "ef-1",
      workout_feedback_id: "wf-1",
      student_id: ELEVE_A,
      exercise_name: "Squat",
      exercise_order: 0,
      comment: "",
      video_path: null,
      video_uploaded_at: null,
    });
    return { base, v };
  };

  const avant = construire(10 * HEURE);
  await purger(avant.base);
  assert.ok(avant.base.objets.has(avant.v), "avant 24 h, l'objet reste");

  const apres = construire(26 * HEURE);
  const bilan = await purger(apres.base);
  assert.ok(!apres.base.objets.has(apres.v), "après 24 h, il part");
  assert.deepEqual(bilan.suppressions.map((s) => s.raison), ["orphan"]);
  assert.equal(bilan.referencesNettoyees, 0, "aucune référence à lever : il n'y en avait plus");
});

/* ════════════════════════════════════════════════════════════════════════
 * E. LA ROUTE — authentification, et rien d'autre
 * ════════════════════════════════════════════════════════════════════════ */

const requete = (entetes: Record<string, string> = {}) =>
  new Request("https://exemple.test/api/cron/purge-feedback-videos", { headers: entetes });

await test("A12. sans secret, avec un mauvais secret, ou sans en-tête : REFUS", async () => {
  const secretOriginal = process.env.CRON_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    // 1. CRON_SECRET non configuré : la route refuse tout, plutôt que de
    //    rester ouverte « en attendant ».
    delete process.env.CRON_SECRET;
    const sansSecret = await purgeRoute(requete({ authorization: "Bearer peu-importe" }));
    assert.equal(sansSecret.status, 503, "secret absent : la route doit se fermer, pas s'ouvrir");

    process.env.CRON_SECRET = "le-vrai-secret";

    // 2. Aucun en-tête.
    assert.equal((await purgeRoute(requete())).status, 401);
    // 3. Mauvais secret.
    assert.equal((await purgeRoute(requete({ authorization: "Bearer faux" }))).status, 401);
    // 4. Bon secret, mauvais schéma.
    assert.equal((await purgeRoute(requete({ authorization: "le-vrai-secret" }))).status, 401);
    assert.equal((await purgeRoute(requete({ authorization: "Basic le-vrai-secret" }))).status, 401);

    // Et dans TOUS ces cas, aucune purge n'a été tentée : la route n'a même
    // pas construit de client Supabase.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await purgeRoute(requete({ authorization: "Bearer faux" }))).status, 401,
      "le refus doit précéder toute construction de client");
  } finally {
    if (secretOriginal === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secretOriginal;
    if (supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    if (serviceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  }
});

await test("A13. secret correct : la route s'exécute et rend un bilan structuré", async () => {
  const secretOriginal = process.env.CRON_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.CRON_SECRET = "le-vrai-secret";
    // Sans configuration Supabase, la route va jusqu'au bout de son
    // AUTHENTIFICATION puis s'arrête proprement en 503 : c'est exactement la
    // frontière que ce test vérifie — le secret est accepté, la suite dépend
    // de l'environnement.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const reponse = await purgeRoute(requete({ authorization: "Bearer le-vrai-secret" }));
    assert.equal(reponse.status, 503, "authentifiée, mais Supabase indisponible dans ce harnais");
    const corps = (await reponse.json()) as { error?: string };
    assert.match(corps.error ?? "", /service role/i);
  } finally {
    if (secretOriginal === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secretOriginal;
    if (supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    if (serviceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  }
});

await test("A13bis. le bilan porte tout ce qu'il faut pour comprendre un passage", async () => {
  const base = creerBase();
  const expiree = poser(base, chemin(ELEVE_A, 1), 31 * JOUR);
  referencer(base, expiree, IL_Y_A(31 * JOUR));
  poser(base, chemin(ELEVE_A, 2), 30 * HEURE);
  poser(base, `${ELEVE_A}/difforme.mp4`, 90 * JOUR);

  const bilan = await purger(base);

  for (const clef of [
    "demarreA", "termineA", "dureeMs", "objetsInventories",
    "expireesDetectees", "expireesSupprimees", "referencesNettoyees",
    "orphelinsDetectes", "orphelinsSupprimes", "orphelinsEpargnesParRevalidation",
    "cheminsMalformes", "reportesAuProchainPassage", "echecs", "suppressions",
  ]) {
    assert.ok(clef in bilan, `le bilan doit porter ${clef}`);
  }
  // Chaque suppression est tracée avec sa raison ET l'âge réel du fichier.
  assert.equal(bilan.suppressions.length, 2);
  for (const s of bilan.suppressions) {
    assert.ok(["expired_reference", "orphan"].includes(s.raison));
    assert.match(s.creeLe, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(s.path.includes("/"));
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * F. LA DÉCLARATION — cron, secret, cloisonnement du code
 * ════════════════════════════════════════════════════════════════════════ */

await test("F0. la rétention est annoncée sans borne haute inventée", () => {
  // « Rétention maximale de 31 jours » serait faux : un échec, un nouvel
  // essai, le plafond par exécution ou un arriéré peuvent repousser le
  // traitement. On annonce le cas nominal, et on dit que ce n'est pas une
  // garantie.
  for (const fichier of [
    "../../lib/feedback-video-retention.ts",
    "../../lib/supabase/purge-feedback-videos.ts",
    "../../app/api/cron/purge-feedback-videos/route.ts",
  ]) {
    const texte = lire(fichier);
    assert.ok(
      !/rétention (maximale|MAXIMALE)/.test(texte),
      `promesse de borne haute dans ${fichier}`,
    );
    assert.ok(
      texte.includes("généralement entre") && texte.includes("éligible"),
      `formulation nominale absente de ${fichier}`,
    );
  }
});

await test("F1. le cron quotidien est déclaré dans vercel.json", () => {
  const vercel = JSON.parse(lire("../../vercel.json"));
  const crons = vercel.crons as { path: string; schedule: string }[];
  assert.ok(Array.isArray(crons), "vercel.json doit déclarer des crons");
  const purge = crons.find((c) => c.path === "/api/cron/purge-feedback-videos");
  assert.ok(purge, "le cron de purge doit être déclaré");
  // Une fois par jour suffit pour une rétention de 30 jours ; plus souvent
  // ne ferait qu'ajouter des passages à vide.
  assert.match(purge!.schedule, /^\d+ \d+ \* \* \*$/, "une seule exécution quotidienne");
});

await test("F2. la route reprend la convention de sécurité existante", () => {
  const route = lire("../../app/api/cron/purge-feedback-videos/route.ts");
  const modele = lire("../../app/api/cron/appointment-reminders/route.ts");
  // Même secret, même en-tête, même refus par défaut que le cron déjà en place.
  for (const morceau of [
    "process.env.CRON_SECRET",
    'if (!cronSecret)',
    '{ status: 503 }',
    'authHeader !== `Bearer ${cronSecret}`',
    '{ status: 401 }',
    "createSupabaseAdminClient()",
  ]) {
    assert.ok(route.includes(morceau), `convention non reprise : ${morceau}`);
    assert.ok(modele.includes(morceau), `le modèle a changé : ${morceau}`);
  }
  // Le secret est documenté, et la conséquence de son absence aussi.
  const env = lire("../../.env.example");
  assert.ok(env.includes("purge-feedback-videos"));
  assert.ok(env.includes("refusent TOUT appel"));
});

await test("F3. la purge ne parle QUE du bucket des vidéos, et jamais en SQL", () => {
  const purge = lire("../../lib/supabase/purge-feedback-videos.ts");
  const sansCommentaires = purge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // Un seul bucket nommé, et par sa constante.
  assert.ok(sansCommentaires.includes("FEEDBACK_VIDEO_BUCKET"));
  for (const autre of ['"videos"', '"progress-photos"', '"recipe-images"', '"documents"', '"banners"']) {
    assert.ok(!sansCommentaires.includes(autre), `bucket étranger nommé : ${autre}`);
  }
  // JAMAIS de SQL sur storage.objects : supprimer la ligne laisserait le
  // fichier en place.
  assert.ok(!/storage\.objects/.test(sansCommentaires));
  assert.ok(!/from\("storage/.test(sansCommentaires));
  // La clé service role ne peut pas fuiter : le client admin importe
  // `server-only`, et la purge n'est jamais importée par un composant client.
  assert.ok(lire("../../lib/supabase/admin.ts").includes('import "server-only"'));
});

await test("F4. la purge ne repose sur AUCUN objet SQL qui lui soit propre", () => {
  // Formulation d'origine : « aucune migration n'a été ajoutée par ce
  // chantier », vérifiée par un compte de migrations. Ce compte mesurait le
  // dépôt entier, pas F4.1 : F5 a ajouté sa propre migration (pour ses
  // colonnes et son bucket, qui n'ont rien à voir avec la purge) et le
  // contrôle est tombé — alors que la propriété qu'il défendait, elle, est
  // toujours vraie.
  //
  // On mesure donc la propriété elle-même : tout ce dont la purge a besoin
  // est déjà lisible par les API existantes — l'âge par Storage, les
  // références par PostgREST. Aucune fonction privilégiée à créer, donc
  // aucune à protéger.
  for (const fichier of [
    "../../lib/supabase/purge-feedback-videos.ts",
    "../../lib/supabase/purge-video-bucket.ts",
    "../../lib/feedback-video-retention.ts",
    "../../app/api/cron/purge-feedback-videos/route.ts",
  ]) {
    const sansCommentaires = lire(fichier)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.ok(!/\.rpc\(/.test(sansCommentaires), `${fichier} appelle une fonction SQL dédiée`);
  }

  // Et le manifeste reste le miroir EXACT de ce qu'une base locale doit
  // rejouer : TOUTES les migrations postérieures au baseline, et rien
  // d'autre. Un fichier ajouté sans être inscrit ici ne serait jamais appliqué
  // localement — la suite passerait au vert contre un schéma qui n'est pas
  // celui de la Production.
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  const premiere = manifeste.borne.premiere_migration_a_rejouer as string;
  const surDisque = readdirSync(new URL("../../supabase/migrations", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f >= premiere);
  assert.deepEqual([...attendues].sort(), surDisque, "manifeste et dossier des migrations divergent");
  assert.ok(attendues.includes("20260826090000_student_feedback_video.sql"));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
