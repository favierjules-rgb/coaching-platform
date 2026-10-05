/**
 * Harnais — DOCUMENTS, LOT A : SYNCHRONISATION RÉELLE DE LA CONSULTATION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * 1. La couche d'accès est APPELÉE POUR DE VRAI contre un double de Supabase
 *    qui exécute `mark_document_viewed` AVEC SA SÉMANTIQUE RÉELLE — y compris
 *    la clause `viewed_at is null` et la dérivation serveur de l'élève. On
 *    observe les ordres ÉMIS et les lignes RÉELLEMENT touchées.
 * 2. Les règles d'ARCHITECTURE — « cet écran ne lit plus localStorage »,
 *    « le marquage vient après la signature » — sont vérifiées sur le texte
 *    des fichiers : une absence ne s'observe pas à l'exécution.
 *
 * ⚠️ TOUTE OPÉRATION NON IMPLÉMENTÉE DANS LE DOUBLE LÈVE. Un faux qui laisse
 * passer silencieusement un appel inconnu ne prouve rien : il prouve
 * seulement qu'on ne l'a pas regardé.
 *
 * ⚠️ CE HARNAIS NE PROUVE PAS LA RLS NI LA MIGRATION A0. Elles ne s'éprouvent
 * qu'en base. Il montre que le code NOMME le bon chemin — la RPC plutôt qu'un
 * `.update()` — pas que Postgres aurait refusé l'autre.
 *
 * Lancement : npm run test:documents-consultation
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getDocumentViewStats,
  getStudentDocumentsWithAvailability,
  markDocumentViewed,
} from "../../lib/supabase/documents";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_BIBLIO = lire("../../components/student/RealDocumentLibrary.tsx");
const CODE_BIBLIO = sansProse(SOURCE_BIBLIO);
const CODE_DOCUMENTS = sansProse(lire("../../lib/supabase/documents.ts"));
const CODE_PAGE_ELEVE = sansProse(lire("../../app/(student)/documents/page.tsx"));
const CODE_PAGE_COACH = sansProse(lire("../../app/admin/documents/page.tsx"));
const CODE_FICHE_COACH = sansProse(lire("../../app/admin/eleves/[studentId]/page.tsx"));
const CODE_HOOK_COACH = sansProse(lire("../../hooks/useSupabaseDocuments.ts"));
const SQL_A0_BRUT = lire(
  "../../supabase/migrations/20261001090000_documents_consultation_securisee.sql",
);
/**
 * ⚠️ LES COMMENTAIRES SQL SONT RETIRÉS AVANT TOUTE VÉRIFICATION.
 *
 * La migration NOMME en prose ce qu'elle ne touche pas (« `document_levels`
 * … ne sont pas nommés une seule fois ici ») et ce qu'elle refuse de faire
 * (« un `insert … on conflict` serait exactement le vecteur qu'on vient de
 * fermer »). Une assertion posée sur le texte brut rougirait sur la prose qui
 * explique la règle, et verdirait si on retirait cette prose : exactement
 * l'inverse de ce qu'on veut mesurer. On mesure le CODE.
 */
function sansCommentairesSql(source: string): string {
  return source
    .split("\n")
    .map((ligne) => {
      const i = ligne.indexOf("--");
      return i === -1 ? ligne : ligne.slice(0, i);
    })
    .join("\n");
}
const SQL_A0 = sansCommentairesSql(SQL_A0_BRUT);

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE DE SUPABASE — il exécute la RPC, il ne la simule pas
   ══════════════════════════════════════════════════════════════════════════ */

interface Ordre {
  readonly cible: string;
  readonly action: string;
  readonly filtres: Record<string, unknown>;
  readonly valeurs?: Record<string, unknown>;
  readonly args?: Record<string, unknown>;
}

type Ligne = Record<string, unknown>;

interface OptionsDouble {
  /** Élève que `current_student_id()` renverrait côté serveur. `null` = personne. */
  eleveCourant?: string | null;
  /** La RPC échoue (réseau, permission). */
  echecRpc?: boolean;
  /** L'insertion dans activity_events échoue. */
  echecEvenement?: boolean;
}

function fauxSupabase(tables: Record<string, Ligne[]>, options: OptionsDouble = {}) {
  const ordres: Ordre[] = [];
  const eleveCourant = options.eleveCourant === undefined ? null : options.eleveCourant;

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
      update(v: Ligne) {
        action = "update";
        valeurs = { ...v };
        return chaine;
      },
      delete() {
        action = "delete";
        return chaine;
      },
      eq(colonne: string, valeur: unknown) {
        filtres[`eq:${colonne}`] = valeur;
        lignes = lignes.filter((l) => l[colonne] === valeur);
        return chaine;
      },
      in(colonne: string, valeurs_: unknown[]) {
        filtres[`in:${colonne}`] = [...valeurs_];
        const ensemble = new Set(valeurs_);
        lignes = lignes.filter((l) => ensemble.has(l[colonne]));
        return chaine;
      },
      order() {
        return chaine;
      },
      maybeSingle() {
        ordres.push({ cible: table, action, filtres: { ...filtres }, valeurs });
        return Promise.resolve({ data: lignes[0] ?? null, error: null });
      },
      then(resoudre: (r: { data: unknown; error: { message: string } | null }) => void) {
        ordres.push({ cible: table, action, filtres: { ...filtres }, valeurs });
        if (action === "insert") {
          if (table === "activity_events" && options.echecEvenement) {
            resoudre({ data: null, error: { message: "INSERT activity_events refusé (test)" } });
            return;
          }
          (tables[table] ??= []).push({ id: `${table}-cree`, ...valeurs } as Ligne);
        }
        resoudre({ data: lignes, error: null });
      },
    };
    return chaine;
  }

  /**
   * `mark_document_viewed`, AVEC SA SÉMANTIQUE RÉELLE.
   *
   * ⚠️ L'ÉLÈVE EST DÉRIVÉ ICI, PAS REÇU. C'est tout l'objet de la fonction
   * SQL : `current_student_id()` est serveur, et aucun argument ne peut le
   * contredire. Le double doit reproduire exactement ça, sinon un test qui
   * passerait un `student_id` falsifié semblerait fonctionner.
   *
   * La clause `viewed_at is null` est évaluée ici aussi : c'est elle qui rend
   * l'opération idempotente, et c'est elle qui fournit le booléen de retour.
   */
  function rpc(nom: string, args: Record<string, unknown>) {
    if (nom !== "mark_document_viewed") {
      throw new Error(`fauxSupabase.rpc : « ${nom} » non implémentée — un appel inconnu ne passe jamais en silence`);
    }
    ordres.push({ cible: "rpc", action: nom, filtres: {}, args: { ...args } });
    if (options.echecRpc) {
      return Promise.resolve({ data: null, error: { message: "RPC refusée (test)" } });
    }
    const documentId = args.p_document_id;
    if (!documentId || !eleveCourant) {
      return Promise.resolve({ data: false, error: null });
    }
    const cible = (tables.document_assignments ?? []).find(
      (l) => l.document_id === documentId && l.student_id === eleveCourant && l.viewed_at == null,
    );
    if (!cible) {
      return Promise.resolve({ data: false, error: null });
    }
    cible.viewed_at = new Date().toISOString();
    cible.updated_at = cible.viewed_at;
    ordres.push({
      cible: "document_assignments",
      action: "update",
      filtres: { "eq:document_id": documentId, "eq:student_id": eleveCourant, "is:viewed_at": null },
      valeurs: { viewed_at: cible.viewed_at, updated_at: cible.updated_at },
    });
    return Promise.resolve({ data: true, error: null });
  }

  return {
    client: {
      from: (table: string) => constructeur(table),
      rpc: (nom: string, args: Record<string, unknown>) => rpc(nom, args),
      storage: {
        from() {
          throw new Error("fauxSupabase.storage : non implémentée dans le lot A");
        },
      },
    } as never,
    ordres,
    tables,
  };
}

/* ── Le banc ────────────────────────────────────────────────────────────── */

const ELEVE = "11111111-1111-4111-8111-111111111111";
const AUTRE_ELEVE = "22222222-2222-4222-8222-222222222222";
const DOC_ASSIGNE = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC_DEJA_VU = "aaaaaaaa-0000-4000-8000-000000000002";
const DOC_NON_ASSIGNE = "aaaaaaaa-0000-4000-8000-000000000003";
const DOC_GLOBAL = "aaaaaaaa-0000-4000-8000-000000000004";

function ligneDocument(partiel: Partial<Ligne> = {}): Ligne {
  return {
    id: DOC_ASSIGNE,
    coach_id: null,
    title: "Guide nutrition",
    description: "",
    type: "pdf",
    category: "nutrition",
    level: 1,
    distribution_mode: "disponible-immediatement",
    unlock_after_weeks: null,
    file_url: null,
    video_url: null,
    external_url: null,
    storage_path: `${DOC_ASSIGNE}/1-guide.pdf`,
    status: "publié",
    important: false,
    full_description: "",
    difficulty: "intermédiaire",
    content_text: "",
    visibility: "assigned",
    unlock_at: null,
    tags: [],
    file_name: "guide.pdf",
    file_size_bytes: 1024,
    file_mime_type: "application/pdf",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...partiel,
  };
}

function ligneAssignation(partiel: Partial<Ligne> = {}): Ligne {
  return {
    id: `as-${String(partiel.document_id ?? DOC_ASSIGNE)}-${String(partiel.student_id ?? ELEVE)}`,
    document_id: DOC_ASSIGNE,
    student_id: ELEVE,
    viewed_at: null,
    manually_unlocked: false,
    unlock_at: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...partiel,
  };
}

function banc() {
  const docAssigne = ligneDocument();
  const docDejaVu = ligneDocument({ id: DOC_DEJA_VU, title: "Morphologie" });
  const docNonAssigne = ligneDocument({ id: DOC_NON_ASSIGNE, title: "Kit prise de poids" });
  const docGlobal = ligneDocument({ id: DOC_GLOBAL, title: "Charte", visibility: "global" });
  return {
    documents: [docAssigne, docDejaVu, docNonAssigne, docGlobal],
    document_assignments: [
      ligneAssignation({ document_id: DOC_ASSIGNE, student_id: ELEVE, viewed_at: null }),
      ligneAssignation({ document_id: DOC_DEJA_VU, student_id: ELEVE, viewed_at: "2026-09-20T08:00:00.000Z" }),
      // Une assignation d'un AUTRE élève sur le même document : contrôle du filtre.
      ligneAssignation({ document_id: DOC_ASSIGNE, student_id: AUTRE_ELEVE, viewed_at: null }),
      // Et une assignation de ce document à un autre élève, déjà consultée :
      // sert au décompte coach (viewedCount < assignedCount).
      ligneAssignation({ document_id: DOC_DEJA_VU, student_id: AUTRE_ELEVE, viewed_at: null }),
      ligneAssignation({ document_id: DOC_NON_ASSIGNE, student_id: AUTRE_ELEVE, viewed_at: null }),
    ],
    activity_events: [] as Ligne[],
  };
}

/** `document_assignments` enrichi de `documents(*)`, comme le fait PostgREST. */
function bancAvecJointure() {
  const b = banc();
  const parId = new Map(b.documents.map((d) => [d.id, d]));
  b.document_assignments = b.document_assignments.map((a) => ({
    ...a,
    documents: parId.get(a.document_id as string) ?? null,
  }));
  return b;
}

/* ══════════════════════════════════════════════════════════════════════════
   A — MARQUAGE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A-1. `markDocumentViewed` émet un update sur `document_assignments` portant `viewed_at`", async () => {
  const { client, ordres, tables } = fauxSupabase(banc(), { eleveCourant: ELEVE });
  const premiere = await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE });
  assert.equal(premiere, true, "première consultation");

  const update = ordres.find((o) => o.cible === "document_assignments" && o.action === "update");
  assert.ok(update, "un update doit être émis");
  assert.ok("viewed_at" in (update?.valeurs ?? {}), "et porter `viewed_at`");

  const ligne = tables.document_assignments.find(
    (l) => l.document_id === DOC_ASSIGNE && l.student_id === ELEVE,
  );
  assert.ok(ligne?.viewed_at, "la ligne doit être horodatée");

  // ⚠️ ET PAR LA RPC, PAS PAR UN `.update()` DEPUIS LE NAVIGATEUR (A0).
  assert.ok(
    ordres.some((o) => o.cible === "rpc" && o.action === "mark_document_viewed"),
    "le marquage doit passer par `mark_document_viewed`",
  );
  // ⚠️ L'ASSERTION PORTE SUR LE CORPS DE `markDocumentViewed`, PAS SUR LE
  // FICHIER. `setDocumentAssignment` et `unlockDocumentForStudent` font
  // légitimement des `.update()` sur cette table : ce sont des gestes de
  // COACH, couverts par la policy staff. Ce qui est interdit, c'est que le
  // chemin ÉLÈVE en fasse un.
  const iFonction = CODE_DOCUMENTS.indexOf("export async function markDocumentViewed");
  assert.ok(iFonction > 0, "markDocumentViewed doit exister");
  // La fenêtre s'arrête à la DÉCLARATION SUIVANTE, pas à un nombre de
  // caractères : un corps qui grandit ne doit pas faire déborder l'assertion
  // sur la fonction d'à côté (c'est ce qui vient d'arriver).
  const iSuivante = CODE_DOCUMENTS.indexOf("\nexport ", iFonction + 10);
  assert.ok(iSuivante > iFonction, "une déclaration doit suivre markDocumentViewed");
  const corpsMarquage = CODE_DOCUMENTS.slice(iFonction, iSuivante);
  assert.ok(
    corpsMarquage.includes('supabase.rpc("mark_document_viewed"'),
    "le marquage passe par la RPC",
  );
  assert.ok(
    !corpsMarquage.includes('from("document_assignments")'),
    "⚠️ le chemin élève ne touche JAMAIS la table directement",
  );
  assert.ok(!corpsMarquage.includes(".update("), "ni par un `.update()`");
  // Et les deux seuls `.update()` restants sur cette table sont bien les deux
  // fonctions de coach connues, pas une troisième apparue en route.
  const updatesTable = (
    CODE_DOCUMENTS.match(/from\("document_assignments"\)[\s\S]{0,200}?\.update\(/g) ?? []
  ).length;
  assert.equal(updatesTable, 2, "exactement deux `.update()` coach : assignation et déblocage");
});

await test("A-2. le filtre porte `document_id` ET `student_id`", async () => {
  const { client, ordres, tables } = fauxSupabase(banc(), { eleveCourant: ELEVE });
  await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE });
  const update = ordres.find((o) => o.cible === "document_assignments" && o.action === "update");
  assert.equal(update?.filtres["eq:document_id"], DOC_ASSIGNE);
  assert.equal(update?.filtres["eq:student_id"], ELEVE);
  assert.equal(update?.filtres["is:viewed_at"], null, "et la clause d'idempotence");

  // CONTRÔLE NÉGATIF : l'assignation de l'AUTRE élève sur le MÊME document
  // n'a pas bougé. Sans le filtre `student_id`, elle aurait été marquée.
  const autre = tables.document_assignments.find(
    (l) => l.document_id === DOC_ASSIGNE && l.student_id === AUTRE_ELEVE,
  );
  assert.equal(autre?.viewed_at, null, "⚠️ un autre élève ne doit JAMAIS être marqué");

  // Et aucune autre ligne de cet élève n'a bougé non plus.
  const autreDoc = tables.document_assignments.find(
    (l) => l.document_id === DOC_NON_ASSIGNE,
  );
  assert.equal(autreDoc?.viewed_at, null, "⚠️ un autre document ne doit JAMAIS être marqué");

  // La SQL dit la même chose, et c'est elle qui compte en production.
  assert.ok(SQL_A0.includes("where document_id = p_document_id"), "SQL : filtre document");
  assert.ok(SQL_A0.includes("and student_id = v_student_id"), "SQL : filtre élève");
  assert.ok(SQL_A0.includes("and viewed_at is null"), "SQL : idempotence");
});

await test("A-3. la date écrite est un ISO 8601 proche de maintenant", async () => {
  const avant = Date.now();
  const { client, tables } = fauxSupabase(banc(), { eleveCourant: ELEVE });
  await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE });
  const apres = Date.now();
  const ligne = tables.document_assignments.find(
    (l) => l.document_id === DOC_ASSIGNE && l.student_id === ELEVE,
  );
  const valeur = String(ligne?.viewed_at ?? "");
  assert.match(valeur, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "ISO 8601 complet");
  const t = new Date(valeur).getTime();
  assert.ok(t >= avant - 1000 && t <= apres + 1000, "et proche de l'instant courant");
  // En production la date vient de `now()` côté Postgres, jamais du client.
  assert.ok(SQL_A0.includes("set viewed_at = now()"), "SQL : la date vient du serveur");
});

await test("A-4. une seconde consultation ne réécrit PAS `viewed_at`", async () => {
  const b = banc();
  const { client, ordres, tables } = fauxSupabase(b, { eleveCourant: ELEVE });
  const premiere = await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE });
  const date1 = tables.document_assignments.find(
    (l) => l.document_id === DOC_ASSIGNE && l.student_id === ELEVE,
  )?.viewed_at;
  const seconde = await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE });
  const date2 = tables.document_assignments.find(
    (l) => l.document_id === DOC_ASSIGNE && l.student_id === ELEVE,
  )?.viewed_at;

  assert.equal(premiere, true, "la première gagne");
  assert.equal(seconde, false, "⚠️ la seconde ne marque rien");
  assert.equal(date2, date1, "⚠️ et n'écrase pas la date d'origine");
  assert.equal(
    ordres.filter((o) => o.cible === "document_assignments" && o.action === "update").length,
    1,
    "un seul update pour deux appels",
  );

  // Un document DÉJÀ consulté au départ se comporte pareil.
  const dejaVu = await markDocumentViewed(client, { documentId: DOC_DEJA_VU, studentId: ELEVE });
  assert.equal(dejaVu, false);
  assert.equal(
    tables.document_assignments.find((l) => l.document_id === DOC_DEJA_VU && l.student_id === ELEVE)
      ?.viewed_at,
    "2026-09-20T08:00:00.000Z",
    "la date d'origine est intacte",
  );
});

await test("A-5. `getStudentDocumentsWithAvailability` expose `viewedAt`", async () => {
  const { client } = fauxSupabase(bancAvecJointure(), { eleveCourant: ELEVE });
  const liste = await getStudentDocumentsWithAvailability(client, ELEVE, "2026-01-01");
  const assigne = liste.find((i) => i.document.id === DOC_ASSIGNE);
  const dejaVu = liste.find((i) => i.document.id === DOC_DEJA_VU);
  assert.ok(assigne, "le document assigné doit être présent");
  assert.equal(assigne?.viewedAt, null, "jamais consulté → null");
  assert.equal(dejaVu?.viewedAt, "2026-09-20T08:00:00.000Z", "consulté → la date de la base");
  // Le champ existe sur CHAQUE élément, jamais `undefined`.
  for (const item of liste) {
    assert.ok("viewedAt" in item, `viewedAt manquant sur ${item.document.id}`);
  }
});

await test("A-6. aucune requête supplémentaire pour obtenir `viewedAt`", async () => {
  const { client, ordres } = fauxSupabase(bancAvecJointure(), { eleveCourant: ELEVE });
  await getStudentDocumentsWithAvailability(client, ELEVE, "2026-01-01");
  const surAssignations = ordres.filter((o) => o.cible === "document_assignments");
  assert.equal(
    surAssignations.length,
    1,
    "`viewed_at` arrive dans le select existant : une seule lecture des assignations",
  );
  assert.equal(
    ordres.filter((o) => o.cible === "documents").length,
    1,
    "et une seule lecture des documents globaux",
  );
  // Le code ne doit PAS contenir une seconde lecture dédiée.
  const index = CODE_DOCUMENTS.indexOf("export async function getStudentDocumentsWithAvailability");
  const corps = CODE_DOCUMENTS.slice(index, index + 2200);
  assert.equal(
    (corps.match(/from\("document_assignments"\)/g) ?? []).length,
    1,
    "une seule requête sur document_assignments dans cette fonction",
  );
  assert.ok(!/select\([^)]*viewed_at[^)]*\)/.test(corps), "pas de select dédié à viewed_at");
});

await test("A-7. signature réussie ⇒ le marquage vient APRÈS", () => {
  const index = CODE_BIBLIO.indexOf("async function handleOpen()");
  assert.ok(index > 0, "handleOpen doit exister");
  const corps = CODE_BIBLIO.slice(index, index + 900);
  const iSigner = corps.indexOf("await signer()");
  const iGarde = corps.indexOf("if (!fraiche)");
  const iOuvre = corps.indexOf("setOuvert(true)");
  const iMarque = corps.indexOf("onConsulte?.()");
  assert.ok(iSigner > 0 && iGarde > 0 && iOuvre > 0 && iMarque > 0, "les quatre étapes doivent exister");
  assert.ok(iSigner < iGarde, "la signature précède sa garde");
  assert.ok(iGarde < iMarque, "⚠️ la garde d'échec précède le marquage");
  assert.ok(iOuvre < iMarque, "le document s'ouvre avant qu'on écrive quoi que ce soit");
});

await test("A-8. signature échouée ⇒ AUCUN marquage", () => {
  const index = CODE_BIBLIO.indexOf("async function handleOpen()");
  const corps = CODE_BIBLIO.slice(index, index + 900);
  const iGarde = corps.indexOf("if (!fraiche)");
  const iRetour = corps.indexOf("return", iGarde);
  const iMarque = corps.indexOf("onConsulte?.()");
  assert.ok(iGarde > 0 && iRetour > iGarde, "la garde doit sortir");
  assert.ok(
    iRetour < iMarque,
    "⚠️ le `return` de la garde doit précéder le marquage : un lien refusé n'est pas une consultation",
  );
  // La branche d'échec ne contient aucun marquage.
  const brancheEchec = corps.slice(iGarde, iRetour + 10);
  assert.ok(!brancheEchec.includes("onConsulte"), "aucun marquage dans la branche d'échec");
});

await test("A-9. `document_viewed` est produit UNE SEULE FOIS", async () => {
  const { client, tables } = fauxSupabase(banc(), { eleveCourant: ELEVE });
  await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE, documentTitle: "Guide nutrition" });
  await markDocumentViewed(client, { documentId: DOC_ASSIGNE, studentId: ELEVE, documentTitle: "Guide nutrition" });

  const evenements = tables.activity_events.filter((e) => e.event_type === "document_viewed");
  assert.equal(evenements.length, 1, "⚠️ un seul évènement pour deux ouvertures");
  // Contrat exact de la table (vérifié en base : pas de colonne document_id).
  assert.equal(evenements[0]?.student_id, ELEVE);
  assert.equal(evenements[0]?.actor_type, "student");
  assert.equal(evenements[0]?.event_type, "document_viewed");
  assert.ok(String(evenements[0]?.title ?? "").length > 0, "title est NOT NULL");
  assert.deepEqual(evenements[0]?.metadata, { link: `/admin/eleves/${ELEVE}` });
  assert.ok(
    !("document_id" in (evenements[0] ?? {})),
    "⚠️ `activity_events` n'a pas de colonne document_id — ne pas en inventer",
  );

  // Un document déjà consulté ne produit rien du tout.
  await markDocumentViewed(client, { documentId: DOC_DEJA_VU, studentId: ELEVE });
  assert.equal(
    tables.activity_events.filter((e) => e.event_type === "document_viewed").length,
    1,
    "toujours un seul",
  );
});

await test("A-10. document global sans assignation ⇒ AUCUN insert d'assignation", async () => {
  const { client, ordres, tables } = fauxSupabase(banc(), { eleveCourant: ELEVE });
  const marque = await markDocumentViewed(client, { documentId: DOC_GLOBAL, studentId: ELEVE });
  assert.equal(marque, false, "rien à marquer, et c'est le comportement voulu");
  assert.equal(
    ordres.filter((o) => o.cible === "document_assignments" && o.action === "insert").length,
    0,
    "⚠️ JAMAIS d'insert : ce serait exactement le vecteur fermé par A0",
  );
  assert.equal(
    tables.document_assignments.filter((l) => l.document_id === DOC_GLOBAL).length,
    0,
    "aucune ligne n'a été fabriquée",
  );
  assert.equal(
    tables.activity_events.filter((e) => e.event_type === "document_viewed").length,
    0,
    "et aucun évènement",
  );
  // La SQL ne contient aucun insert, ni upsert.
  assert.ok(!/insert\s+into/i.test(SQL_A0), "SQL : aucun `insert into`");
  assert.ok(!/on\s+conflict/i.test(SQL_A0), "SQL : aucun `on conflict`");

  // Et la couche d'accès ne fabrique pas de viewedAt pour un global.
  const avecJointure = fauxSupabase(bancAvecJointure(), { eleveCourant: ELEVE });
  const liste = await getStudentDocumentsWithAvailability(avecJointure.client, ELEVE, "2026-01-01");
  const global = liste.find((i) => i.document.id === DOC_GLOBAL);
  assert.ok(global, "le document global doit rester visible");
  assert.equal(global?.viewedAt, null, "non suivi, jamais inventé");
});

await test("A-11. le coach lit les VRAIS `viewed_at`", async () => {
  const { client, ordres } = fauxSupabase(banc(), { eleveCourant: null });
  const stats = await getDocumentViewStats(client, [DOC_ASSIGNE, DOC_DEJA_VU, DOC_NON_ASSIGNE]);

  // DOC_ASSIGNE : 2 assignations, 0 consultée.
  assert.equal(stats.get(DOC_ASSIGNE)?.assignedCount, 2);
  assert.equal(stats.get(DOC_ASSIGNE)?.viewedCount, 0);
  // DOC_DEJA_VU : 2 assignations, 1 consultée.
  assert.equal(stats.get(DOC_DEJA_VU)?.assignedCount, 2);
  assert.equal(stats.get(DOC_DEJA_VU)?.viewedCount, 1);
  assert.equal(stats.get(DOC_DEJA_VU)?.viewedByStudentId.get(ELEVE), "2026-09-20T08:00:00.000Z");
  assert.equal(stats.get(DOC_DEJA_VU)?.viewedByStudentId.get(AUTRE_ELEVE), null);

  // Une seule requête pour toute la liste.
  assert.equal(ordres.filter((o) => o.cible === "document_assignments").length, 1);
  const lecture = ordres.find((o) => o.cible === "document_assignments");
  assert.deepEqual(lecture?.filtres["in:document_id"], [DOC_ASSIGNE, DOC_DEJA_VU, DOC_NON_ASSIGNE]);

  // Et la lecture porte bien sur viewed_at, pas sur un compte d'assignations.
  assert.ok(
    CODE_DOCUMENTS.includes('.select("document_id, student_id, viewed_at")'),
    "la colonne lue est `viewed_at`",
  );
  assert.ok(!/localStorage/.test(CODE_HOOK_COACH), "le hook coach ne lit aucun localStorage");
  assert.ok(!/localStorage/.test(CODE_PAGE_COACH), "la page coach non plus");
});

await test("A-12. `RealDocumentLibrary` ne lit NI localStorage NI `useDocumentAccess`", () => {
  // ⚠️ RÈGLE D'ARCHITECTURE, VÉRIFIÉE SUR LE TEXTE. Le hook existe toujours
  // et sert la démonstration — il ne doit simplement jamais atteindre le
  // chemin Supabase. Les commentaires sont retirés avant la vérification :
  // le mot peut apparaître en prose pour expliquer pourquoi il est interdit.
  assert.ok(!/useDocumentAccess/.test(CODE_BIBLIO), "aucun import ni appel de useDocumentAccess");
  assert.ok(!/localStorage/.test(CODE_BIBLIO), "aucun localStorage");
  assert.ok(!/sessionStorage|indexedDB/i.test(CODE_BIBLIO), "aucun autre stockage navigateur");
  assert.ok(!/seth-document-access/.test(CODE_BIBLIO), "aucune clé de stockage");
  // Le statut vient de `viewedAt`, et de rien d'autre.
  assert.ok(CODE_BIBLIO.includes("viewedAt ?"), "le badge se décide sur viewedAt");
  assert.ok(CODE_BIBLIO.includes("DocumentStatusBadge"), "et utilise le composant existant");
  // Le hook de démonstration, lui, est INTACT : on ne l'a pas supprimé.
  const hookDemo = lire("../../hooks/useDocumentAccess.ts");
  assert.ok(hookDemo.includes("seth-document-access"), "useDocumentAccess reste en place (hors périmètre)");
  assert.ok(hookDemo.includes("export function useDocumentAccess"), "et toujours exporté");
  // La page élève passe le VRAI studentId, jamais celui de data/student.ts.
  assert.ok(
    CODE_PAGE_ELEVE.includes("studentId={supabaseDocuments.studentId}"),
    "le studentId vient du hook Supabase",
  );
  assert.ok(
    !/RealDocumentLibrary[\s\S]{0,400}student\.id/.test(CODE_PAGE_ELEVE),
    "jamais l'identifiant de démonstration",
  );
});

await test("A-13. la fiche élève coach affiche le vrai statut", () => {
  assert.ok(
    CODE_FICHE_COACH.includes("availableDocuments.map(({ document, viewedAt })"),
    "la fiche lit `viewedAt` sur chaque document disponible",
  );
  assert.ok(
    /DocumentStatusBadge status=\{viewedAt \? "consulté" : "nouveau"\}/.test(CODE_FICHE_COACH),
    "et en dérive le badge",
  );
  assert.ok(!/localStorage/.test(CODE_FICHE_COACH.slice(
    CODE_FICHE_COACH.indexOf("availableDocuments.map") - 2000,
    CODE_FICHE_COACH.indexOf("availableDocuments.map") + 2000,
  )), "sans aucun localStorage autour");
  // Le mécanisme de disponibilité/déblocage n'est pas touché.
  assert.ok(CODE_FICHE_COACH.includes("handleUnlockDocument"), "le déblocage existe toujours");
  assert.ok(CODE_FICHE_COACH.includes("computeDocumentAvailability"), "le calcul de disponibilité aussi");
  assert.ok(CODE_FICHE_COACH.includes("lockedDocuments"), "et la liste des verrouillés");
});

await test("A-14. le compteur coach distingue assignés et consultés", () => {
  // Les DEUX nombres doivent être affichés, et depuis DEUX sources distinctes.
  assert.ok(
    CODE_PAGE_COACH.includes("doc.assignedStudentIds.length"),
    "le compte d'assignations reste affiché",
  );
  assert.ok(
    CODE_PAGE_COACH.includes("viewStats.get(doc.id)?.viewedCount"),
    "⚠️ et le compte de CONSULTATIONS vient de viewStats, pas de assignedStudentIds",
  );
  assert.ok(
    CODE_PAGE_COACH.includes("viewStats.get(doc.id)?.assignedCount"),
    "le dénominateur vient de la même source que le numérateur",
  );
  assert.ok(
    !/Consulté[^\n]{0,80}assignedStudentIds\.length/.test(CODE_PAGE_COACH),
    "⚠️ `assignedStudentIds.length` ne doit JAMAIS servir de nombre de consultations",
  );
  // Et le hook expose bien les deux.
  assert.ok(CODE_HOOK_COACH.includes("getDocumentViewStats"), "le hook appelle les stats réelles");
  assert.ok(CODE_HOOK_COACH.includes("viewStats"), "et les expose");
});

/* ══════════════════════════════════════════════════════════════════════════
   A0 — CE QUE LA MIGRATION DOIT DIRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A0-1. la policy UPDATE élève est retirée, la fonction est fermée", () => {
  assert.ok(
    SQL_A0.includes('drop policy if exists "document_assignments_update_self_or_staff"'),
    "l'ancienne policy doit être retirée",
  );
  assert.ok(
    /create policy "document_assignments_update_staff"[\s\S]{0,200}using \(public\.is_coach_or_admin\(\)\)/.test(SQL_A0),
    "la nouvelle policy UPDATE est réservée au staff",
  );
  assert.ok(
    !/current_student_id\(\)[\s\S]{0,40}or public\.is_coach_or_admin\(\)\s*\)\s*\n\s*with check/.test(SQL_A0),
    "aucune policy UPDATE ne doit rouvrir la table à l'élève",
  );
  // La fonction : sécurisée, fermée, puis ouverte au seul rôle utile.
  assert.ok(SQL_A0.includes("security definer"), "security definer");
  assert.ok(SQL_A0.includes("set search_path = ''"), "search_path explicitement vide");
  assert.ok(SQL_A0.includes("v_student_id := public.current_student_id();"), "élève dérivé côté serveur");
  assert.ok(
    SQL_A0.includes("revoke all on function public.mark_document_viewed(uuid) from public;"),
    "fermée à public",
  );
  assert.ok(
    SQL_A0.includes("revoke all on function public.mark_document_viewed(uuid) from anon;"),
    "fermée à anon",
  );
  assert.ok(
    SQL_A0.includes("grant execute on function public.mark_document_viewed(uuid) to authenticated;"),
    "ouverte à authenticated",
  );
  assert.ok(
    !/grant execute on function public\.mark_document_viewed\(uuid\) to service_role/.test(SQL_A0),
    "et à personne d'autre",
  );
  // Aucune colonne sensible dans le `set`.
  const corpsSql = SQL_A0.slice(SQL_A0.indexOf("update public.document_assignments"), SQL_A0.indexOf("return found;"));
  for (const colonne of ["document_id =", "student_id =", "manually_unlocked", "unlock_at"]) {
    assert.ok(
      !corpsSql.split("where")[0].includes(colonne),
      `⚠️ \`${colonne}\` ne doit jamais apparaître dans le SET`,
    );
  }
});

await test("A0-2. la migration ne touche RIEN d'autre", () => {
  // Hors périmètre explicite du chantier : documents, document_levels, Storage.
  for (const interdit of [
    "alter table public.documents",
    "document_levels",
    "storage.objects",
    "storage.buckets",
    "file_size_limit",
    "allowed_mime_types",
    "drop function",
    "delete from",
    "truncate",
  ]) {
    assert.ok(!SQL_A0.includes(interdit), `⚠️ la migration ne doit pas contenir « ${interdit} »`);
  }
  // Aucune création ou modification de table.
  assert.ok(!/create table/i.test(SQL_A0), "aucune table créée");
  assert.ok(!/add column/i.test(SQL_A0), "aucune colonne ajoutée");
  // Et surtout : le grant UPDATE de `authenticated` n'est PAS révoqué, sinon
  // le coach tomberait sur « permission denied » avant la moindre policy.
  assert.ok(
    !/revoke update on public\.document_assignments from authenticated/.test(SQL_A0),
    "⚠️ révoquer le grant de authenticated casserait le coach",
  );
  assert.ok(
    SQL_A0.includes("revoke update on public.document_assignments from anon;"),
    "seul anon perd le privilège",
  );
});
