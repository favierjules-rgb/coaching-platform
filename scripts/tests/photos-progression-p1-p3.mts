/**
 * Harnais — PHOTOS DE PROGRESSION P1 / P2 / P3A.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Deux niveaux, et chacun prouve ce que l'autre ne peut pas :
 *
 * 1. Les couches d'accès sont APPELÉES POUR DE VRAI contre un double de
 *    Supabase qui applique réellement `.eq()`, `.neq()`, `.delete()`,
 *    `.maybeSingle()`, et qui enregistre chaque ordre Storage. On observe donc
 *    les requêtes ÉMISES et les fichiers RÉELLEMENT visés — pas une intention
 *    lue dans le code.
 * 2. Les règles d'ARCHITECTURE — « ce chemin ne produit plus de dataUrl »,
 *    « cette suppression se confirme » — sont vérifiées sur le texte des
 *    fichiers : une absence ne s'observe pas à l'exécution.
 *
 * ⚠️ CE QUE CE HARNAIS NE PROUVE PAS. Il ne remplace ni la RLS, ni les
 * policies Storage, qui ne s'éprouvent qu'en base. Il montre que le code
 * NOMME le bon chemin, pas que Postgres l'aurait refusé autrement.
 *
 * Lancement : npm run test:photos-progression
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createProgressPhotoWithUpload,
  deleteProgressPhotoPermanently,
  listProgressPhotos,
} from "../../lib/supabase/progress-photos";
import {
  addProgressPhotoSupabase,
  deleteProgressPhotoSupabase,
  getStudentProgressPhotos,
} from "../../lib/supabase/students";
import {
  PROGRESS_PHOTOS_BUCKET,
  validateProgressPhotoFile,
} from "../../lib/supabase/storage-progress-photos";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_MODALE = lire("../../components/student/AddProgressPhotoModal.tsx");
const CODE_MODALE = sansProse(SOURCE_MODALE);
const SOURCE_PHOTOS = lire("../../components/student/ProgressPhotos.tsx");
const CODE_PHOTOS = sansProse(SOURCE_PHOTOS);
const CODE_SECTION_GALERIE = sansProse(lire("../../components/student/ProgressPhotoGallerySection.tsx"));
const CODE_SECTION_PARTAGEE = sansProse(lire("../../components/shared/ProgressPhotosSection.tsx"));
const CODE_STUDENTS = sansProse(lire("../../lib/supabase/students.ts"));
const CODE_PHOTOS_LIB = sansProse(lire("../../lib/supabase/progress-photos.ts"));
const CODE_GALERIE_HOOK = sansProse(lire("../../hooks/useProgressPhotosGallery.ts"));
const CODE_PROFIL = sansProse(lire("../../components/student/ProfilPageContent.tsx"));
const CODE_FICHE_COACH = sansProse(lire("../../app/admin/eleves/[studentId]/page.tsx"));
const CODE_HOOK_PROFIL = sansProse(lire("../../hooks/useSupabaseStudentProfile.ts"));
const CODE_HOOK_DETAIL = sansProse(lire("../../hooks/useSupabaseStudentDetail.ts"));

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE DE SUPABASE — il applique VRAIMENT les filtres et trace Storage
   ══════════════════════════════════════════════════════════════════════════ */

interface Ordre {
  readonly cible: string;
  readonly action: string;
  readonly filtres: Record<string, unknown>;
  readonly valeurs?: Record<string, unknown>;
  readonly chemins?: readonly string[];
}

type Ligne = Record<string, unknown>;

/**
 * UN TERME `col.op.valeur` DE POSTGREST, ÉVALUÉ AVEC LA SÉMANTIQUE DE POSTGRES.
 *
 * ⚠️ C'EST LE CŒUR DU TEST NULL, PAS UN DÉTAIL D'IMPLÉMENTATION DU DOUBLE.
 * `status <> 'archived'` s'évalue à NULL — donc à faux — quand `status` est
 * NULL : un `.neq()` n'inclut PAS les lignes NULL. Un double qui traduirait
 * `neq` par le `!==` de JavaScript les inclurait, et un `.neq()` seul passerait
 * alors les tests ici tout en perdant ces lignes en production. Le double doit
 * donc reproduire le piège, pas l'adoucir.
 *
 * Toute opération non implémentée lève : un terme inconnu ne doit jamais
 * être interprété comme « vrai pour tout le monde ».
 */
function predicatPostgrest(terme: string): (ligne: Ligne) => boolean {
  const [colonne, operation, ...reste] = terme.trim().split(".");
  const valeur = reste.join(".");
  switch (operation) {
    case "eq":
      return (l) => l[colonne] === valeur;
    case "neq":
      // NOT NULL implicite : voir l'en-tête.
      return (l) => l[colonne] != null && l[colonne] !== valeur;
    case "is":
      if (valeur === "null") return (l) => l[colonne] == null;
      if (valeur === "not.null") return (l) => l[colonne] != null;
      throw new Error(`predicatPostgrest : \`is.${valeur}\` non implémenté`);
    default:
      throw new Error(`predicatPostgrest : opération \`${operation}\` non implémentée (${terme})`);
  }
}

function fauxSupabase(
  tables: Record<string, Ligne[]>,
  options: { echecDelete?: boolean; echecInsert?: boolean; echecUpload?: boolean } = {},
) {
  const ordres: Ordre[] = [];

  function constructeur(table: string) {
    let lignes = [...(tables[table] ?? [])];
    const filtres: Record<string, unknown> = {};
    let action = "select";
    let valeurs: Record<string, unknown> | undefined;

    const chaine = {
      select() {
        return chaine;
      },
      insert(v: Ligne) {
        action = "insert";
        valeurs = { ...v };
        return chaine;
      },
      delete() {
        action = "delete";
        return chaine;
      },
      update(v: Ligne) {
        action = "update";
        valeurs = { ...v };
        return chaine;
      },
      eq(colonne: string, valeur: unknown) {
        filtres[`eq:${colonne}`] = valeur;
        lignes = lignes.filter((l) => l[colonne] === valeur);
        return chaine;
      },
      neq(colonne: string, valeur: unknown) {
        filtres[`neq:${colonne}`] = valeur;
        // SÉMANTIQUE POSTGRES : les lignes à NULL sont EXCLUES. Voir
        // `predicatPostgrest`.
        lignes = lignes.filter((l) => l[colonne] != null && l[colonne] !== valeur);
        return chaine;
      },
      or(expression: string) {
        filtres["or"] = expression;
        const predicats = expression.split(",").map(predicatPostgrest);
        lignes = lignes.filter((l) => predicats.some((p) => p(l)));
        return chaine;
      },
      order() {
        return chaine;
      },
      limit() {
        return chaine;
      },
      maybeSingle() {
        ordres.push({ cible: table, action, filtres: { ...filtres }, valeurs });
        return Promise.resolve({ data: lignes[0] ?? null, error: null });
      },
      single() {
        ordres.push({ cible: table, action, filtres: { ...filtres }, valeurs });
        if (action === "insert" && options.echecInsert) {
          return Promise.resolve({ data: null, error: { message: "INSERT refusé (test)" } });
        }
        if (action === "insert") {
          const creee = { id: "photo-creee", ...valeurs } as Ligne;
          (tables[table] ??= []).push(creee);
          return Promise.resolve({ data: creee, error: null });
        }
        return Promise.resolve({ data: lignes[0] ?? null, error: null });
      },
      then(resoudre: (r: { data: unknown; error: { message: string } | null }) => void) {
        ordres.push({ cible: table, action, filtres: { ...filtres }, valeurs });
        if (action === "delete") {
          if (options.echecDelete) {
            resoudre({ data: null, error: { message: "DELETE refusé (test)" } });
            return;
          }
          const aSupprimer = new Set(lignes.map((l) => l.id));
          tables[table] = (tables[table] ?? []).filter((l) => !aSupprimer.has(l.id));
          resoudre({ data: lignes, error: null });
          return;
        }
        if (action === "insert") {
          if (options.echecInsert) {
            resoudre({ data: null, error: { message: "INSERT refusé (test)" } });
            return;
          }
          (tables[table] ??= []).push({ id: "ligne-creee", ...valeurs } as Ligne);
        }
        resoudre({ data: lignes, error: null });
      },
    };
    return chaine;
  }

  const storage = {
    from(bucket: string) {
      return {
        upload(path: string, ...reste: unknown[]) {
          // `reste` = (fichier, options) — non inspectés : ce double ne juge pas
          // le contenu du fichier, seulement le CHEMIN visé et l'ordre des appels.
          void reste;
          ordres.push({ cible: `storage:${bucket}`, action: "upload", filtres: {}, chemins: [path] });
          return Promise.resolve(
            options.echecUpload ? { error: { message: "upload refusé (test)" } } : { error: null },
          );
        },
        remove(paths: string[]) {
          ordres.push({ cible: `storage:${bucket}`, action: "remove", filtres: {}, chemins: [...paths] });
          return Promise.resolve({ error: null });
        },
        createSignedUrl(path: string) {
          ordres.push({ cible: `storage:${bucket}`, action: "sign", filtres: {}, chemins: [path] });
          return Promise.resolve({ data: { signedUrl: `signe://${path}` }, error: null });
        },
      };
    },
  };

  return {
    client: { from: (table: string) => constructeur(table), storage } as never,
    ordres,
    tables,
  };
}

/* ── Le banc ────────────────────────────────────────────────────────────── */

const ELEVE = "11111111-1111-4111-8111-111111111111";

function ligne(partiel: Partial<Ligne> = {}): Ligne {
  return {
    id: "p1",
    student_id: ELEVE,
    type: "mensuelle",
    date: "2026-09-10",
    weight_kg: 70,
    note: "",
    image_url: null,
    storage_path: null,
    pending: false,
    photo_type: "autre",
    uploaded_by: null,
    file_name: null,
    file_size_bytes: null,
    file_mime_type: null,
    is_before_candidate: false,
    is_after_candidate: false,
    status: "active",
    created_at: "2026-09-10T10:00:00.000Z",
    updated_at: "2026-09-10T10:00:00.000Z",
    ...partiel,
  };
}

const ACTIVE_STORAGE = ligne({ id: "p-active-storage", storage_path: `${ELEVE}/1-face-a.jpg` });
const ACTIVE_BASE64 = ligne({ id: "p-active-base64", image_url: "data:image/jpeg;base64,AAAA" });
const ARCHIVEE = ligne({ id: "p-archivee", status: "archived", storage_path: `${ELEVE}/2-face-b.jpg` });
const SANS_STATUT = ligne({ id: "p-sans-statut", status: null });
/** Un statut que le type ne connaît pas : la règle dit « visible », puisqu'il n'est pas "archived". */
const AUTRE_STATUT = ligne({ id: "p-autre-statut", status: "brouillon" });

function banc(extra: Ligne[] = []) {
  return {
    progress_photos: [ACTIVE_STORAGE, ACTIVE_BASE64, ARCHIVEE, ...extra].map((l) => ({ ...l })),
    activity_events: [] as Ligne[],
  };
}

function fichier(nom = "photo.jpg", type = "image/jpeg", octets = 1024): File {
  return new File([new Uint8Array(octets)], nom, { type });
}

/* ══════════════════════════════════════════════════════════════════════════
   P1 — VISIBILITÉ / ARCHIVAGE
   ══════════════════════════════════════════════════════════════════════════ */

await test("P1-1. `getStudentProgressPhotos` exclut les archivées", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const photos = await getStudentProgressPhotos(client, ELEVE);
  const ids = photos.map((p) => p.id).sort();
  assert.ok(!ids.includes("p-archivee"), "une photo archivée ne doit plus être rendue");
  assert.deepEqual(ids, ["p-active-base64", "p-active-storage"], "les actives, elles, restent");
  // La requête ÉMISE porte bien le filtre, et sous sa forme NULL-safe.
  const lecture = ordres.find((o) => o.cible === "progress_photos" && o.action === "select");
  assert.equal(
    lecture?.filtres["or"],
    "status.neq.archived,status.is.null",
    "le filtre doit être émis, pas supposé — et porter les DEUX termes",
  );
  assert.ok(
    !("neq:status" in (lecture?.filtres ?? {})),
    "⚠️ un `.neq()` seul perdrait les lignes à NULL (voir P1-6)",
  );
  assert.equal(lecture?.filtres["eq:student_id"], ELEVE, "et l'élève reste nommé");
});

await test("P1-2. le filtre est un `or` NULL-safe, et aucune des trois formes fausses", () => {
  const index = CODE_STUDENTS.indexOf('from("progress_photos")');
  assert.ok(index > 0);
  const fenetre = CODE_STUDENTS.slice(index, index + 400);
  assert.ok(
    fenetre.includes('.or("status.neq.archived,status.is.null")'),
    "le filtre doit être présent, avec sa branche NULL",
  );
  // ⚠️ CONTRÔLE D'INVERSION. Un `.eq("status","archived")` ne garderait QUE les
  // archivées : exactement le défaut à l'envers, et invisible à la relecture.
  assert.ok(
    !/\.eq\(\s*"status"\s*,\s*"archived"\s*\)/.test(CODE_STUDENTS),
    "ne JAMAIS filtrer sur `eq status archived`",
  );
  assert.ok(
    !/\.neq\(\s*"status"\s*,\s*"active"\s*\)/.test(CODE_STUDENTS),
    "ni sur `neq status active`",
  );
  // ⚠️ ET SURTOUT PAS LE `.neq()` SEUL, qui PARAÎT correct et perd les NULL.
  assert.ok(
    !/\.neq\(\s*"status"\s*,\s*"archived"\s*\)/.test(CODE_STUDENTS),
    "`.neq(\"status\", \"archived\")` seul exclut les lignes à NULL : interdit ici",
  );
  assert.ok(
    !/\.eq\(\s*"status"\s*,\s*"active"\s*\)/.test(CODE_STUDENTS),
    "ni `eq status active`, qui ferait disparaître un troisième statut",
  );
});

await test("P1-3. un statut absent/null reste traité comme actif", async () => {
  const { client } = fauxSupabase(banc([SANS_STATUT]));
  const photos = await getStudentProgressPhotos(client, ELEVE);
  assert.ok(
    photos.some((p) => p.id === "p-sans-statut"),
    "`neq` conserve ce que `eq(active)` aurait fait disparaître",
  );
  // Et la doctrine défensive subsiste dans les écrans.
  assert.ok(
    CODE_SECTION_PARTAGEE.includes('(p.status ?? "active")'),
    "ProgressPhotosSection garde son repli défensif",
  );
});

await test("P1-4. la galerie coach garde son `includeArchived`", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const sansArchive = await listProgressPhotos(client, ELEVE);
  assert.deepEqual(
    sansArchive.map((p) => p.id).sort(),
    ["p-active-base64", "p-active-storage"],
    "par défaut, les archivées sont écartées",
  );
  const avecArchive = await listProgressPhotos(client, ELEVE, { includeArchived: true });
  assert.ok(
    avecArchive.some((p) => p.id === "p-archivee"),
    "le coach doit continuer à les obtenir — c'est son compteur « N archivée(s) »",
  );
  // Et c'est bien le MÊME appel qui change de comportement selon l'option.
  const lectures = ordres.filter((o) => o.cible === "progress_photos");
  assert.equal(lectures[0]?.filtres["eq:status"], "active");
  assert.ok(!("eq:status" in (lectures[1]?.filtres ?? {})));
  assert.ok(
    CODE_GALERIE_HOOK.includes('includeArchived: actorType === "coach"'),
    "le hook garde sa règle d'origine",
  );
});

await test("P1-5. les quatre chemins restent cohérents", () => {
  // `progress.ts` n'est qu'une enveloppe sur getFullAdminStudent : corriger la
  // lecture de students.ts corrige donc /progression élève du même coup.
  const progression = sansProse(lire("../../lib/supabase/progress.ts"));
  assert.ok(
    progression.includes("getFullAdminStudent(supabase, studentId)"),
    "le wrapper doit rester un wrapper",
  );
  assert.ok(
    !progression.includes('from("progress_photos")'),
    "progress.ts ne doit pas ouvrir un cinquième chemin de lecture",
  );
  // Aucune autre lecture directe de la table hors des deux couches connues.
  for (const [nom, code] of [
    ["components/student/ProfilPageContent.tsx", CODE_PROFIL],
    ["app/admin/eleves/[studentId]/page.tsx", CODE_FICHE_COACH],
    ["hooks/useProgressPhotosGallery.ts", CODE_GALERIE_HOOK],
  ] as const) {
    assert.ok(!code.includes('from("progress_photos")'), `${nom} ne lit pas la table directement`);
  }
});

await test("P1-6. TABLE DE VÉRITÉ COMPLÈTE DU FILTRE — seul \"archived\" est masqué", async () => {
  // ⚠️ CE TEST EST ROUGE SI `.neq("status", "archived")` EST UTILISÉ SEUL.
  // Le double applique la sémantique de Postgres (`predicatPostgrest`) :
  // `status <> 'archived'` vaut NULL, donc faux, sur une ligne à NULL. La ligne
  // `p-sans-statut` disparaîtrait alors ici exactement comme en production.
  const { client, ordres } = fauxSupabase(banc([SANS_STATUT, AUTRE_STATUT]));
  const ids = (await getStudentProgressPhotos(client, ELEVE)).map((p) => p.id).sort();

  assert.ok(ids.includes("p-active-storage"), 'status = "active" → VISIBLE');
  assert.ok(ids.includes("p-active-base64"), 'status = "active" (base64) → VISIBLE');
  assert.ok(ids.includes("p-sans-statut"), "status = NULL → VISIBLE");
  assert.ok(ids.includes("p-autre-statut"), 'status = "brouillon" → VISIBLE');
  assert.ok(!ids.includes("p-archivee"), 'status = "archived" → MASQUÉ');
  // Exhaustif : rien de plus, rien de moins. Un filtre trop large passerait les
  // quatre premières assertions tout en laissant revenir les archivées.
  assert.deepEqual(
    ids,
    ["p-active-base64", "p-active-storage", "p-autre-statut", "p-sans-statut"],
    "exactement les quatre non-archivées",
  );

  // CONTRÔLE NÉGATIF DU DOUBLE LUI-MÊME. Si `neq` se mettait à laisser passer
  // les NULL, ce harnais cesserait de pouvoir prouver quoi que ce soit : on
  // vérifie donc le piège directement, sur le prédicat.
  assert.equal(
    predicatPostgrest("status.neq.archived")({ status: null }),
    false,
    "`neq` doit EXCLURE les NULL — sinon P1-6 ne prouve plus rien",
  );
  assert.equal(predicatPostgrest("status.is.null")({ status: null }), true);
  assert.equal(predicatPostgrest("status.neq.archived")({ status: "brouillon" }), true);
  assert.equal(predicatPostgrest("status.neq.archived")({ status: "archived" }), false);
  // Et une opération inconnue lève, au lieu d'être vraie par défaut.
  assert.throws(() => predicatPostgrest("status.like.arch%"), /non implémentée/);

  // La requête émise reste conjointe à l'élève : un `or` mal placé ferait
  // fuiter les photos d'un autre élève.
  const lecture = ordres.find((o) => o.cible === "progress_photos" && o.action === "select");
  assert.equal(lecture?.filtres["eq:student_id"], ELEVE);
});

/* ══════════════════════════════════════════════════════════════════════════
   P2 — SUPPRESSION STORAGE
   ══════════════════════════════════════════════════════════════════════════ */

await test("P2-1. `storage_path` présent ⇒ le fichier est supprimé, avec le chemin de la BASE", async () => {
  const { client, ordres, tables } = fauxSupabase(banc());
  const ok = await deleteProgressPhotoSupabase(client, "p-active-storage");
  assert.equal(ok, true);
  const remove = ordres.find((o) => o.action === "remove");
  assert.ok(remove, "storage.remove doit être appelé");
  assert.equal(remove?.cible, `storage:${PROGRESS_PHOTOS_BUCKET}`);
  assert.deepEqual(remove?.chemins, [`${ELEVE}/1-face-a.jpg`], "et avec le chemin exact");
  assert.ok(
    !tables.progress_photos.some((l) => l.id === "p-active-storage"),
    "la ligne doit avoir disparu",
  );
});

await test("P2-2. `storage_path` absent ⇒ AUCUN appel Storage", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const ok = await deleteProgressPhotoSupabase(client, "p-active-base64");
  assert.equal(ok, true);
  assert.equal(
    ordres.filter((o) => o.action === "remove").length,
    0,
    "pas de remove([null]) ni de remove([]) sur une photo base64",
  );
});

await test("P2-3. le chemin ne vient PAS de l'appelant — il est relu en base", async () => {
  // L'appelant ne fournit RIEN : c'est le cas réel depuis le correctif.
  const { client, ordres } = fauxSupabase(banc());
  await deleteProgressPhotoPermanently(client, "p-active-storage");
  assert.deepEqual(
    ordres.find((o) => o.action === "remove")?.chemins,
    [`${ELEVE}/1-face-a.jpg`],
    "le chemin doit venir de la ligne, pas d'un argument",
  );
  // La lecture précède la suppression — après le DELETE, la ligne n'existe plus.
  const surLaTable = ordres.filter((o) => o.cible === "progress_photos");
  assert.equal(surLaTable[0]?.action, "select", "LIRE d'abord");
  assert.equal(surLaTable[1]?.action, "delete", "SUPPRIMER ensuite");

  // ⚠️ IL N'EXISTE PLUS DE TROISIÈME PARAMÈTRE. Un `?? cheminConnu` en repli
  // suffisait à laisser revenir l'état React dès que la base répond NULL : la
  // signature a donc été réduite, et c'est cette réduction qu'on fige ici.
  assert.equal(
    deleteProgressPhotoPermanently.length,
    2,
    "la signature doit être (supabase, photoId) — rien de plus",
  );
  const iSignature = CODE_PHOTOS_LIB.indexOf("export async function deleteProgressPhotoPermanently");
  assert.ok(iSignature > 0);
  const signature = CODE_PHOTOS_LIB.slice(iSignature, CODE_PHOTOS_LIB.indexOf("{", iSignature));
  assert.ok(!/chemin/i.test(signature), "aucun chemin ne doit entrer par la signature");
  const corpsSuppression = CODE_PHOTOS_LIB.slice(iSignature, iSignature + 1600);
  assert.ok(
    !/\?\?\s*chemin/i.test(corpsSuppression),
    "et aucun `?? chemin…` ne doit réintroduire un repli",
  );

  // Le hook ne doit plus aller chercher le chemin dans son état React.
  assert.ok(
    !/storagePath/.test(CODE_GALERIE_HOOK),
    "useProgressPhotosGallery ne doit plus manipuler storagePath",
  );
  assert.ok(
    !/photos\.find\(/.test(CODE_GALERIE_HOOK),
    "ni retrouver la photo dans sa liste pour la supprimer",
  );
});

await test("P2-4. DELETE en erreur ⇒ le fichier N'EST PAS supprimé", async () => {
  const { client, ordres, tables } = fauxSupabase(banc(), { echecDelete: true });
  const ok = await deleteProgressPhotoSupabase(client, "p-active-storage");
  assert.equal(ok, false, "l'échec doit remonter");
  assert.equal(
    ordres.filter((o) => o.action === "remove").length,
    0,
    "⚠️ supprimer l'image d'une ligne toujours présente la rendrait cassée à jamais",
  );
  assert.ok(
    tables.progress_photos.some((l) => l.id === "p-active-storage"),
    "la ligne est toujours là — contrôle négatif du double",
  );
});

await test("P2-5. l'ordre LIRE → DELETE → REMOVE est écrit, pas déduit", () => {
  const index = CODE_PHOTOS_LIB.indexOf("export async function deleteProgressPhotoPermanently");
  assert.ok(index > 0);
  const corps = CODE_PHOTOS_LIB.slice(index, index + 1600);
  const iLecture = corps.indexOf('.select("storage_path")');
  const iDelete = corps.indexOf(".delete()");
  const iRemove = corps.indexOf("deleteProgressPhotoFile");
  assert.ok(iLecture > 0 && iDelete > 0 && iRemove > 0, "les trois étapes doivent exister");
  assert.ok(iLecture < iDelete, "la lecture précède la suppression de la ligne");
  assert.ok(iDelete < iRemove, "la ligne part avant le fichier");
  // Et la sortie anticipée en cas d'erreur est bien AVANT la suppression du fichier.
  const iSortie = corps.indexOf("return false");
  assert.ok(iSortie > iDelete && iSortie < iRemove, "une erreur DELETE sort avant le remove");
});

await test("P2-6. une seule implémentation de la suppression", () => {
  // `deleteProgressPhotoSupabase` délègue : deux implémentations divergeraient,
  // et c'est précisément ce qui a produit le défaut.
  const index = CODE_STUDENTS.indexOf("export async function deleteProgressPhotoSupabase");
  assert.ok(index > 0);
  const corps = CODE_STUDENTS.slice(index, index + 300);
  assert.ok(corps.includes("deleteProgressPhotoPermanently(supabase, photoId)"), "elle doit déléguer");
  assert.ok(
    !corps.includes('from("progress_photos").delete()'),
    "et ne plus faire son propre delete",
  );
});

await test("P2-7. `storage_path` NULL en base ⇒ une valeur d'appelant périmée est TOTALEMENT ignorée", async () => {
  // Cas réel du défaut : la liste React porte encore le chemin d'une AUTRE
  // photo (identifiant réutilisé, liste non rafraîchie) et la base, elle,
  // répond `storage_path = NULL` — photo base64, ou lecture refusée par la RLS.
  // On force la valeur par un cast : si un troisième paramètre existait, ou si
  // un `?? repli` subsistait, le fichier d'autrui serait supprimé.
  const { client, ordres } = fauxSupabase(banc());
  const PERIME = "/student/wrong-or-stale-file.jpg";
  const force = deleteProgressPhotoPermanently as unknown as (
    ...args: unknown[]
  ) => Promise<boolean>;
  const ok = await force(client, "p-active-base64", PERIME);

  assert.equal(ok, true, "la ligne doit bien être supprimée");
  assert.equal(
    ordres.filter((o) => o.action === "remove").length,
    0,
    "⚠️ AUCUN appel Storage : `storage_path` NULL signifie « aucun fichier »",
  );
  // Exhaustif : la valeur périmée ne doit apparaître dans AUCUN ordre, quel
  // qu'il soit — ni remove, ni sign, ni upload.
  assert.ok(
    !ordres.some((o) => (o.chemins ?? []).includes(PERIME)),
    "la valeur venue de l'appelant doit être totalement ignorée",
  );
});

await test("P2-8. `storage_path` en base ⇒ c'est LUI qui est supprimé, pas la valeur de l'appelant", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const MENTEUR = "/student/wrong-file.jpg";
  const force = deleteProgressPhotoPermanently as unknown as (
    ...args: unknown[]
  ) => Promise<boolean>;
  await force(client, "p-active-storage", MENTEUR);

  const remove = ordres.find((o) => o.action === "remove");
  assert.deepEqual(
    remove?.chemins,
    [`${ELEVE}/1-face-a.jpg`],
    "le chemin supprimé est celui de la BASE",
  );
  assert.ok(
    !ordres.some((o) => (o.chemins ?? []).includes(MENTEUR)),
    "et la valeur contradictoire n'est touchée nulle part",
  );
  assert.equal(
    ordres.filter((o) => o.action === "remove").length,
    1,
    "un seul fichier supprimé — pas les deux « au cas où »",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   P3A — CONVERGENCE DES NOUVEAUX UPLOADS
   ══════════════════════════════════════════════════════════════════════════ */

await test("P3-1. `addProgressPhotoSupabase` REFUSE une image base64", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const refuse = await addProgressPhotoSupabase(client, ELEVE, {
    type: "mensuelle",
    date: "2026-10-05",
    weightKg: 70,
    note: "",
    imageUrl: "data:image/jpeg;base64,AAAA",
    storagePath: null,
    pending: false,
  });
  assert.equal(refuse, null, "l'écriture doit échouer explicitement");
  assert.equal(
    ordres.filter((o) => o.cible === "progress_photos" && o.action === "insert").length,
    0,
    "⚠️ et AUCUN insert ne doit partir — pas un échec après écriture",
  );
  // Contrôle négatif : une URL classique reste acceptée (contrat inchangé).
  const accepte = await addProgressPhotoSupabase(client, ELEVE, {
    type: "mensuelle",
    date: "2026-10-05",
    weightKg: 70,
    note: "",
    imageUrl: "https://exemple.test/photo.jpg",
    storagePath: null,
    pending: false,
  });
  assert.ok(accepte !== null, "une URL http ne doit pas être refusée");
});

await test("P3-2. plus aucune dataUrl ne part vers la base", async () => {
  // Niveau code : le mode Storage de la modale ne produit pas de dataUrl.
  const iStorage = CODE_MODALE.indexOf("if (modeStorage) {");
  assert.ok(iStorage > 0, "la modale doit porter un mode Storage explicite");
  const brancheStorage = CODE_MODALE.slice(iStorage, CODE_MODALE.indexOf("lireApercuDemonstration(selected)"));
  assert.ok(!brancheStorage.includes("readAsDataURL"), "le mode Storage n'encode rien en dataUrl");
  assert.ok(brancheStorage.includes("URL.createObjectURL"), "il prévisualise comme /progression");
  assert.ok(brancheStorage.includes("validateProgressPhotoFile"), "et valide avant d'accepter");

  // `readAsDataURL` ne subsiste QUE dans la fonction de démonstration.
  const occurrences = [...CODE_MODALE.matchAll(/readAsDataURL/g)];
  assert.equal(occurrences.length, 1, "une seule occurrence, et elle est nommée");
  const iDemo = CODE_MODALE.indexOf("function lireApercuDemonstration");
  assert.ok(iDemo > 0 && occurrences[0].index > iDemo, "elle vit dans la fonction de démonstration");
  assert.ok(
    CODE_MODALE.includes("if (!onUpload)") || CODE_MODALE.includes("modeStorage"),
    "et elle est gardée par le mode",
  );
});

await test("P3-3. validation MIME et taille obligatoires", () => {
  assert.equal(validateProgressPhotoFile(fichier("a.jpg", "image/jpeg", 10)), null);
  assert.equal(validateProgressPhotoFile(fichier("a.png", "image/png", 10)), null);
  assert.equal(validateProgressPhotoFile(fichier("a.webp", "image/webp", 10)), null);
  assert.match(
    validateProgressPhotoFile(fichier("a.gif", "image/gif", 10)) ?? "",
    /Format non supporté/,
    "un GIF doit être refusé",
  );
  assert.match(
    validateProgressPhotoFile(fichier("a.pdf", "application/pdf", 10)) ?? "",
    /Format non supporté/,
  );
  assert.match(
    validateProgressPhotoFile(fichier("gros.jpg", "image/jpeg", 10 * 1024 * 1024 + 1)) ?? "",
    /trop volumineux/,
    "au-delà de 10 Mo, refusé",
  );
  assert.equal(
    validateProgressPhotoFile(fichier("limite.jpg", "image/jpeg", 10 * 1024 * 1024)),
    null,
    "exactement 10 Mo passe — la borne est inclusive, comportement existant",
  );
  // Et la modale ne redéfinit pas sa propre règle.
  assert.ok(
    CODE_MODALE.includes('from "@/lib/supabase/storage-progress-photos"'),
    "la modale importe la validation partagée",
  );
  assert.ok(
    !/image\/jpeg["']\s*,\s*["']image\/png/.test(CODE_MODALE),
    "elle ne recopie pas la liste des MIME",
  );
});

await test("P3-4. le chemin Storage commence par `{studentId}/`", async () => {
  const { client, ordres } = fauxSupabase(banc());
  const resultat = await createProgressPhotoWithUpload(client, ELEVE, fichier(), {
    photoType: "autre",
    type: "avant",
    date: "2026-10-05",
    weightKg: 70,
    note: "ok",
    uploadedBy: null,
    actorType: "student",
  });
  assert.ok(!("error" in resultat), "l'upload doit réussir");
  const upload = ordres.find((o) => o.action === "upload");
  assert.ok(upload?.chemins?.[0].startsWith(`${ELEVE}/`), "premier segment = students.id");
  assert.equal(upload?.cible, `storage:${PROGRESS_PHOTOS_BUCKET}`);
  // La policy exige ce premier segment : la convention est écrite dans la couche.
  const codeStorage = sansProse(lire("../../lib/supabase/storage-progress-photos.ts"));
  assert.ok(
    codeStorage.includes("`${studentId}/${Date.now()}-${photoType}-${sanitizeFileName(file.name)}`"),
    "le chemin doit rester construit à partir de studentId",
  );
});

await test("P3-5. le RÔLE de la photo est conservé, et aucune dataUrl n'est insérée", async () => {
  const { client, ordres } = fauxSupabase(banc());
  await createProgressPhotoWithUpload(client, ELEVE, fichier(), {
    photoType: "autre",
    type: "objectif",
    date: "2026-10-05",
    weightKg: 68.5,
    note: "une note",
    uploadedBy: null,
    actorType: "coach",
  });
  const insert = ordres.find((o) => o.cible === "progress_photos" && o.action === "insert");
  assert.equal(insert?.valeurs?.type, "objectif", "le rôle choisi au formulaire doit survivre");
  assert.equal(insert?.valeurs?.photo_type, "autre");
  assert.equal(insert?.valeurs?.date, "2026-10-05");
  assert.equal(insert?.valeurs?.weight_kg, 68.5);
  assert.equal(insert?.valeurs?.note, "une note");
  assert.equal(insert?.valeurs?.image_url, null, "⚠️ jamais de dataUrl par ce chemin");
  assert.ok(String(insert?.valeurs?.storage_path ?? "").startsWith(`${ELEVE}/`));
  // Défaut préservé quand le rôle n'est pas fourni.
  const autre = fauxSupabase(banc());
  await createProgressPhotoWithUpload(autre.client, ELEVE, fichier(), {
    photoType: "face",
    date: "2026-10-05",
    weightKg: null,
    note: "",
    uploadedBy: null,
    actorType: "student",
  });
  assert.equal(
    autre.ordres.find((o) => o.action === "insert")?.valeurs?.type,
    "mensuelle",
    "comportement historique de /progression inchangé",
  );
});

await test("P3-6. INSERT en échec ⇒ le fichier téléversé est supprimé", async () => {
  const { client, ordres } = fauxSupabase(banc(), { echecInsert: true });
  const resultat = await createProgressPhotoWithUpload(client, ELEVE, fichier(), {
    photoType: "autre",
    type: "mensuelle",
    date: "2026-10-05",
    weightKg: null,
    note: "",
    uploadedBy: null,
    actorType: "student",
  });
  assert.ok("error" in resultat, "l'échec doit remonter");
  const upload = ordres.find((o) => o.action === "upload");
  const remove = ordres.find((o) => o.action === "remove");
  assert.ok(upload && remove, "le rollback doit avoir lieu");
  assert.deepEqual(remove?.chemins, upload?.chemins, "et porter sur le fichier qui vient d'être posé");
});

await test("P3-7. le mode est décidé par `onUpload`, et câblé aux deux écrans", () => {
  assert.ok(CODE_MODALE.includes("onUpload?:"), "la prop doit être optionnelle");
  assert.ok(
    CODE_MODALE.includes('const modeStorage = typeof onUpload === "function"'),
    "le mode se lit de la prop, pas d'un drapeau externe",
  );
  assert.ok(CODE_SECTION_GALERIE.includes("onUpload={onUpload}"), "la section relaie la prop");
  // /profil : fourni seulement sous Supabase.
  assert.ok(
    CODE_PROFIL.includes("const uploadPhoto = useSupabase ? supabaseProfile.uploadPhoto : undefined"),
    "/profil ne fournit le téléverseur que sous Supabase",
  );
  assert.ok(CODE_PROFIL.includes("onUpload={uploadPhoto}"));
  // Fiche coach : idem.
  assert.ok(
    CODE_FICHE_COACH.includes("onUpload={isSupabaseStudent ? supabaseDetail.uploadPhoto : undefined}"),
    "la fiche coach ne le fournit que pour un élève Supabase",
  );
  // Les deux hooks passent par la couche Storage, jamais par l'ancienne.
  for (const [nom, code] of [
    ["hooks/useSupabaseStudentProfile.ts", CODE_HOOK_PROFIL],
    ["hooks/useSupabaseStudentDetail.ts", CODE_HOOK_DETAIL],
  ] as const) {
    assert.ok(code.includes("createProgressPhotoWithUpload("), `${nom} doit téléverser`);
    assert.ok(!code.includes("readAsDataURL"), `${nom} ne doit pas encoder d'image`);
  }
});

await test("P3-8. le parcours de démonstration reste intact", () => {
  // La dataUrl est le FORMAT du mode démonstration : une blob: ne survivrait
  // pas à localStorage. Le retirer casserait l'exemple.
  assert.ok(CODE_MODALE.includes("lireApercuDemonstration"), "la fonction de démonstration existe");
  assert.ok(CODE_MODALE.includes("onAdd(photo)"), "elle rend toujours la photo à l'appelant");
  assert.ok(
    CODE_PROFIL.includes("mockProfile.addPhoto"),
    "/profil garde son chemin localStorage hors Supabase",
  );
  assert.ok(SOURCE_MODALE.length > 6000, "contrôle négatif : le fichier n'a pas été dépouillé");
});

/* ══════════════════════════════════════════════════════════════════════════
   SÉCURITÉ DE SUPPRESSION
   ══════════════════════════════════════════════════════════════════════════ */

await test("SUPPR-1. la suppression depuis /profil demande confirmation", () => {
  assert.ok(CODE_PHOTOS.includes("window.confirm"), "le bouton corbeille doit confirmer");
  const index = CODE_PHOTOS.indexOf("window.confirm");
  const iAppel = CODE_PHOTOS.indexOf("onDelete(photo.id)");
  assert.ok(index > 0 && iAppel > 0, "les deux doivent exister");
  assert.ok(index < iAppel, "la confirmation précède l'appel");
  // Même libellé que /progression : un seul geste, un seul message.
  assert.ok(
    CODE_PHOTOS.includes("Supprimer définitivement cette photo ?"),
    "libellé aligné sur ProgressPhotosSection",
  );
  assert.ok(
    CODE_SECTION_PARTAGEE.includes("Supprimer définitivement cette photo ?"),
    "contrôle de la référence",
  );
  assert.ok(CODE_PHOTOS.startsWith('"use client"'), "le composant doit être client pour confirmer");
});
