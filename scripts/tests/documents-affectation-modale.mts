/**
 * Harnais — AFFECTATION D'UN DOCUMENT AUX ÉLÈVES (cases à cocher).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET CE QUI NE PEUT PAS L'ÊTRE ICI — SANS FAIRE SEMBLANT
 * ────────────────────────────────────────────────────────────────────────────
 * 1. L'ALLER-RETOUR COMPLET EST EXÉCUTÉ. `setDocumentAssignment` écrit dans une
 *    fausse base, puis `getDocuments` la relit : on vérifie que l'élève
 *    ressort bien dans `assignedStudentIds`, et que la case correspondante est
 *    RENDUE cochée. C'est « enregistrer puis recharger », joué, pas décrit.
 * 2. LE RENDU EST RÉEL (`renderToString`) : c'est le balisage produit par
 *    `StudentPickerList` qui est inspecté, `checked` compris.
 * 3. LES REFUS SONT EXÉCUTÉS : un `42501` doit LEVER
 *    `RefusAutorisationAffectation`, une panne doit rendre `false`. Les deux
 *    chemins sont appelés pour de vrai.
 *
 * ⚠️ CE QU'AUCUN TEST DE CE DÉPÔT NE PEUT FAIRE : un VRAI clic. Le dépôt n'a
 * ni jsdom ni moteur de navigateur (constat déjà écrit dans
 * `nutrition-n1-4-choix-eleve.mts`), donc `onChange` n'est jamais déclenché
 * par un évènement. Ce qui est mesuré à la place : la fonction appelée par
 * `onChange` (exécutée directement), l'état rendu (`checked`), et le câblage
 * de la modale (lu dans la source). Le clic lui-même reste une vérification
 * manuelle, et le rapport le dit.
 *
 * ⚠️ ET AUCUNE POLICY NE S'EXÉCUTE ICI. C'est précisément le trou qui a laissé
 * passer l'interblocage RLS : `student-content-assignment.mts` exerçait déjà
 * `setDocumentAssignment` contre un faux client, et passait au vert pendant
 * que la production refusait. Les DROITS sont mesurés par acteur réel dans
 * supabase/tests/documents_affectations_checklist.sql — ce fichier-ci ne les
 * remplace pas et ne prétend pas le faire.
 *
 * Lancement : npm run test:documents-affectation
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { StudentPickerList } from "../../components/admin/StudentPickerList";
import { matchesStudentSearch } from "../../lib/admin";
import {
  estRefusAutorisation,
  messageEchecAffectation,
} from "../../lib/assignment-refus";
import { getDocuments, setDocumentAssignment } from "../../lib/supabase/documents";
import type { AdminStudent } from "../../types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const CODE_MODALE = sansProse(lire("../../components/admin/DocumentModal.tsx"));
const CODE_LISTE = sansProse(lire("../../components/admin/StudentPickerList.tsx"));
const CODE_DOCUMENTS = sansProse(lire("../../lib/supabase/documents.ts"));
const SQL_CORRECTIF = lire(
  "../../supabase/migrations/20261025090000_document_assignments_portee_eleve.sql",
);

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — élèves, documents, et une fausse base qui LÈVE sur l'inconnu
   ══════════════════════════════════════════════════════════════════════════ */

const EA = "eleve-amandine";
const EB = "eleve-bastien";
const DOC_PDF = "doc-pdf-televerse";
const DOC_LIEN = "doc-lien-canva";

const amandine = {
  id: EA, firstName: "Amandine", lastName: "Roux",
  email: "amandine@example.test", status: "actif",
} as unknown as AdminStudent;
const bastien = {
  id: EB, firstName: "Bastien", lastName: "Noel",
  email: "bastien@example.test", status: "actif",
} as unknown as AdminStudent;

type Ligne = Record<string, unknown>;

function ligneDocument(id: string, surcharge: Ligne = {}): Ligne {
  return {
    id, coach_id: "coach-a", title: id, description: "", full_description: "",
    type: "pdf", category: "entrainement", level: 1, difficulty: "facile",
    distribution_mode: "immediat", unlock_after_weeks: 0, unlock_at: null,
    file_url: null, video_url: null, external_url: null,
    storage_path: null, file_name: null, file_size_bytes: null, file_mime_type: null,
    cover_storage_path: null, content_text: "", visibility: "assigned",
    tags: [], status: "publié", important: false,
    created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z",
    ...surcharge,
  };
}

interface OptionsBase {
  /** Erreur rendue par l'INSERT dans `document_assignments`. */
  erreurInsert?: { code?: string; message: string };
}

/**
 * Fausse base minimale, suffisante pour `setDocumentAssignment` + `getDocuments`.
 *
 * ⚠️ TOUTE TABLE OU OPÉRATION NON IMPLÉMENTÉE LÈVE. Un faux permissif qui
 * laisse passer un appel inconnu ne prouve rien.
 */
function fausseBase(initial: { documents: Ligne[]; affectations: Ligne[] }, options: OptionsBase = {}) {
  const tables: Record<string, Ligne[]> = {
    documents: initial.documents.map((d) => ({ ...d })),
    document_assignments: initial.affectations.map((a) => ({ ...a })),
    activity_events: [],
  };
  const ordres: string[] = [];

  function requete(table: string) {
    if (!(table in tables)) {
      throw new Error(`fausseBase.from(${table}) : table non implémentée dans ce lot`);
    }
    const filtres: ((l: Ligne) => boolean)[] = [];
    const retenues = () => tables[table].filter((l) => filtres.every((f) => f(l)));

    type Constructeur = {
      select: (colonnes?: string) => Constructeur;
      eq: (colonne: string, valeur: unknown) => Constructeur;
      in: (colonne: string, valeurs: unknown[]) => Constructeur;
      order: () => Constructeur;
      maybeSingle: () => Promise<{ data: Ligne | null; error: null }>;
      single: () => Promise<{ data: Ligne | null; error: null }>;
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise<unknown>;
    };

    const api: Constructeur = {
      select: () => api,
      eq: (colonne, valeur) => {
        filtres.push((l) => l[colonne] === valeur);
        return api;
      },
      in: (colonne, valeurs) => {
        filtres.push((l) => valeurs.includes(l[colonne]));
        return api;
      },
      order: () => api,
      maybeSingle: () => Promise.resolve({ data: retenues()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: retenues()[0] ?? null, error: null }),
      then: (ok, ko) => Promise.resolve({ data: retenues(), error: null }).then(ok, ko),
    };
    return api;
  }

  const client = {
    from(table: string) {
      const lecture = () => requete(table);
      return {
        select: (colonnes?: string) => {
          ordres.push(`select:${table}`);
          return lecture().select(colonnes);
        },
        insert: (valeurs: Ligne) => {
          ordres.push(`insert:${table}`);
          if (table === "document_assignments" && options.erreurInsert) {
            return Promise.resolve({ error: options.erreurInsert });
          }
          const ligne = { id: `${table}-${tables[table].length + 1}`, ...valeurs };
          tables[table].push(ligne);
          return Promise.resolve({ error: null });
        },
        update: (champs: Ligne) => {
          ordres.push(`update:${table}`);
          const filtres: ((l: Ligne) => boolean)[] = [];
          const api = {
            eq(colonne: string, valeur: unknown) {
              filtres.push((l) => l[colonne] === valeur);
              return api;
            },
            then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
              for (const l of tables[table].filter((x) => filtres.every((f) => f(x)))) {
                Object.assign(l, champs);
              }
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return api;
        },
        delete: () => {
          ordres.push(`delete:${table}`);
          const filtres: ((l: Ligne) => boolean)[] = [];
          const api = {
            eq(colonne: string, valeur: unknown) {
              filtres.push((l) => l[colonne] === valeur);
              return api;
            },
            then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
              tables[table] = tables[table].filter((l) => !filtres.every((f) => f(l)));
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return api;
        },
      };
    },
    rpc(nom: string) {
      throw new Error(`fausseBase.rpc(${nom}) : non implémentée dans ce lot`);
    },
    storage: {
      from() {
        throw new Error("fausseBase.storage : non implémentée dans ce lot");
      },
    },
  } as never;

  return { client, tables, ordres };
}

function baseDeuxDocuments(options: OptionsBase = {}) {
  return fausseBase(
    {
      documents: [
        // Un PDF réellement téléversé…
        ligneDocument(DOC_PDF, {
          storage_path: "coach-a/doc-pdf-televerse/1-guide.pdf",
          file_name: "guide.pdf",
        }),
        // …et un document dont le contenu est un LIEN EXTERNE (type Canva).
        ligneDocument(DOC_LIEN, {
          external_url: "https://www.canva.com/design/XYZ/view",
        }),
      ],
      affectations: [],
    },
    options,
  );
}

/**
 * Rend la liste d'élèves telle que la modale la monte.
 *
 * ⚠️ LES COMMENTAIRES DE SÉPARATION SONT RETIRÉS. `renderToString` intercale
 * un `<!-- -->` entre deux nœuds texte voisins : le compteur sort en
 * `1<!-- --> élève<!-- --> sélectionné`. On mesure le TEXTE réellement affiché,
 * pas la façon dont React le segmente.
 */
function rendreListe(students: AdminStudent[], selectedIds: string[]): string {
  return renderToString(
    createElement(StudentPickerList, { students, selectedIds, onToggle: () => {} }),
  ).replace(/<!-- -->/g, "");
}

/** Le balisage de la ligne d'un élève donné, pour y lire `checked`. */
function ligneRendue(html: string, student: AdminStudent): string {
  const i = html.indexOf(student.firstName);
  assert.ok(i > 0, `l'élève ${student.firstName} doit être rendu`);
  const debut = html.lastIndexOf("<label", i);
  return html.slice(debut, i);
}

/* ══════════════════════════════════════════════════════════════════════════
   A — L'ÉCRITURE : SUCCÈS, PANNE, ET REFUS DE DROITS
   ══════════════════════════════════════════════════════════════════════════ */

await test("A-1. une affectation acceptée rend `true` et crée la ligne", async () => {
  const { client, tables } = baseDeuxDocuments();
  const ok = await setDocumentAssignment(client, EA, DOC_PDF, true);
  assert.equal(ok, true);
  assert.equal(tables.document_assignments.length, 1);
  assert.equal(tables.document_assignments[0].student_id, EA);
  assert.equal(tables.document_assignments[0].document_id, DOC_PDF);
});

await test("A-2. ⚠️ UN REFUS DE DROITS (42501) LÈVE, il ne rend pas `false`", async () => {
  const { client, tables } = baseDeuxDocuments({
    erreurInsert: { code: "42501", message: "new row violates row-level security policy" },
  });
  let capturee: unknown = null;
  try {
    await setDocumentAssignment(client, EA, DOC_PDF, true);
  } catch (erreur) {
    capturee = erreur;
  }
  assert.ok(capturee !== null, "le refus doit remonter, pas être avalé en un `false` muet");
  assert.ok(estRefusAutorisation(capturee), "…et être reconnu comme un refus de droits");
  assert.equal(tables.document_assignments.length, 0, "et rien n'est créé");

  // ⚠️ AUCUN DÉTAIL NE SORT : ni code SQL, ni message de la base, ni identifiant.
  const texte = `${(capturee as Error).name} ${(capturee as Error).message}`;
  for (const interdit of ["42501", "row-level security", EA, DOC_PDF]) {
    assert.ok(!texte.includes(interdit), `l'exception ne doit pas contenir « ${interdit} »`);
  }
});

await test("A-3. une panne serveur garde le chemin d'avant : `false`, sans exception", async () => {
  const { client, tables } = baseDeuxDocuments({
    erreurInsert: { code: "XX000", message: "internal error" },
  });
  const ok = await setDocumentAssignment(client, EA, DOC_PDF, true);
  assert.equal(ok, false, "une panne reste un échec rendu, pas levé");
  assert.equal(tables.document_assignments.length, 0);
});

await test("A-4. le retrait supprime la ligne CIBLÉE, et seulement elle", async () => {
  const { client, tables } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  await setDocumentAssignment(client, EB, DOC_PDF, true);
  assert.equal(tables.document_assignments.length, 2);
  const ok = await setDocumentAssignment(client, EA, DOC_PDF, false);
  assert.equal(ok, true);
  assert.deepEqual(
    tables.document_assignments.map((l) => l.student_id),
    [EB],
    "seule l'affectation d'Amandine disparaît",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   B — ALLER-RETOUR : ENREGISTRER, RECHARGER, RETROUVER LA CASE COCHÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-1. PDF TÉLÉVERSÉ : affecter → recharger → l'élève est dans `assignedStudentIds`", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  const documents = await getDocuments(client);
  const doc = documents.find((d) => d.id === DOC_PDF);
  assert.ok(doc, "le document est relu");
  assert.deepEqual(doc.assignedStudentIds, [EA], "l'affectation survit au rechargement");
  assert.ok(doc.storagePath, "…et c'est bien le document au fichier téléversé");
});

await test("B-2. LIEN EXTERNE (Canva) : exactement le même aller-retour", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_LIEN, true);
  const documents = await getDocuments(client);
  const doc = documents.find((d) => d.id === DOC_LIEN);
  assert.ok(doc, "le document est relu");
  assert.deepEqual(doc.assignedStudentIds, [EA]);
  assert.equal(doc.storagePath, null, "aucun fichier téléversé…");
  assert.match(doc.externalUrl, /canva\.com/, "…seulement un lien externe");
});

await test("B-3. le support ne change RIEN : PDF et lien externe donnent le même résultat", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  await setDocumentAssignment(client, EA, DOC_LIEN, true);
  const documents = await getDocuments(client);
  const pdf = documents.find((d) => d.id === DOC_PDF);
  const lien = documents.find((d) => d.id === DOC_LIEN);
  assert.deepEqual(pdf?.assignedStudentIds, lien?.assignedStudentIds);
  assert.deepEqual(pdf?.assignedStudentIds, [EA]);
});

await test("B-4. SÉLECTION MULTIPLE : deux élèves, retrouvés tous les deux après rechargement", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  await setDocumentAssignment(client, EB, DOC_PDF, true);
  const doc = (await getDocuments(client)).find((d) => d.id === DOC_PDF);
  assert.deepEqual([...(doc?.assignedStudentIds ?? [])].sort(), [EA, EB].sort());
});

await test("B-5. un retrait survit aussi au rechargement", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  await setDocumentAssignment(client, EB, DOC_PDF, true);
  await setDocumentAssignment(client, EA, DOC_PDF, false);
  const doc = (await getDocuments(client)).find((d) => d.id === DOC_PDF);
  assert.deepEqual(doc?.assignedStudentIds, [EB]);
});

/* ══════════════════════════════════════════════════════════════════════════
   C — LE RENDU DES CASES, ET L'IDENTIFIANT QUI LES DÉCIDE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C-1. un élève dans la sélection est RENDU coché, l'autre non", () => {
  const html = rendreListe([amandine, bastien], [EA]);
  assert.match(ligneRendue(html, amandine), /checked/, "Amandine est cochée");
  assert.ok(!/checked/.test(ligneRendue(html, bastien)), "Bastien ne l'est pas");
});

await test("C-2. aucune case n'est `disabled` ni rendue inerte", () => {
  const html = rendreListe([amandine, bastien], []);
  assert.ok(!/disabled/.test(html), "⚠️ aucune case désactivée");
  assert.ok(!/readonly/i.test(html), "aucune case en lecture seule");
  assert.ok(!/pointer-events-none[^"]*"\s*\/>/.test(html), "aucune case rendue inerte par le CSS");
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2, "deux cases rendues");
});

await test("C-3. le compteur affiche le nombre RÉEL de sélectionnés", () => {
  assert.match(rendreListe([amandine, bastien], []), /0 élève sélectionné/);
  assert.match(rendreListe([amandine, bastien], [EA]), /1 élève sélectionné/);
  assert.match(rendreListe([amandine, bastien], [EA, EB]), /2 élèves sélectionnés/);
});

await test("C-4. CHAÎNAGE RÉEL : après l'aller-retour en base, la case sort cochée", async () => {
  const { client } = baseDeuxDocuments();
  await setDocumentAssignment(client, EA, DOC_PDF, true);
  const doc = (await getDocuments(client)).find((d) => d.id === DOC_PDF);
  // ⚠️ C'EST EXACTEMENT CE QUE FAIT LA MODALE : `selectedIds` vient de
  // `document.assignedStudentIds`, relu en base. Rien d'autre ne décide.
  const html = rendreListe([amandine, bastien], doc?.assignedStudentIds ?? []);
  assert.match(ligneRendue(html, amandine), /checked/, "la case suit la base");
  assert.ok(!/checked/.test(ligneRendue(html, bastien)));
  assert.match(html, /1 élève sélectionné/, "et le compteur aussi");
});

await test("C-5. la sélection SURVIT au filtrage : mêmes identifiants des deux côtés", () => {
  // Le filtre est exécuté pour de vrai (`matchesStudentSearch`, la fonction
  // utilisée par la liste), puis la liste est rendue avec le résultat.
  const tous = [amandine, bastien];
  const filtres = tous.filter((e) => matchesStudentSearch(e, "bastien"));
  assert.deepEqual(filtres.map((e) => e.id), [EB], "la recherche ne garde que Bastien");

  // Amandine est sélectionnée mais filtrée hors de l'affichage : sa sélection
  // ne doit PAS être perdue, parce qu'elle vit dans les données du parent.
  const selection = [EA, EB];
  const htmlFiltre = rendreListe(filtres, selection);
  assert.match(ligneRendue(htmlFiltre, bastien), /checked/, "Bastien reste coché");
  assert.ok(!htmlFiltre.includes("Amandine"), "Amandine n'est plus affichée…");
  assert.match(htmlFiltre, /2 élèves sélectionnés/, "…mais elle compte toujours comme sélectionnée");

  // Et le filtre ne touche jamais la sélection, par construction.
  assert.ok(
    /const filtered = students\.filter\(/.test(CODE_LISTE),
    "le filtrage porte sur `students`…",
  );
  assert.ok(
    /checked=\{selectedIds\.includes\(student\.id\)\}/.test(CODE_LISTE),
    "…et `checked` lit `selectedIds`, jamais la liste filtrée",
  );
});

await test("C-6. une liste vide ne casse pas, et ne prétend pas qu'il y a une sélection", () => {
  const html = rendreListe([], []);
  assert.match(html, /Aucun élève trouvé\./);
  assert.match(html, /0 élève sélectionné/);
  assert.ok(!/type="checkbox"/.test(html));
});

/* ══════════════════════════════════════════════════════════════════════════
   D — L'ÉCHEC REMONTE JUSQU'À L'ÉCRAN
   ══════════════════════════════════════════════════════════════════════════ */

await test("D-1. ⚠️ `onSetAssignment` N'EST PLUS TYPÉE `=> void` : la promesse est attendue", () => {
  assert.ok(
    /onSetAssignment: \(\s*studentId: string,\s*contentType: "document",\s*contentId: string,\s*assigned: boolean,\s*\) => Promise<boolean>;/.test(
      CODE_MODALE,
    ),
    "la prop doit rendre une promesse de booléen",
  );
  assert.ok(
    !/onSetAssignment:[^;]*=> void;/.test(CODE_MODALE),
    "⚠️ l'ancien type jetait le résultat : c'est lui qui rendait l'échec invisible",
  );
  const i = CODE_MODALE.indexOf("async function basculerAffectation");
  assert.ok(i > 0, "le clic passe par une fonction dédiée");
  const corps = CODE_MODALE.slice(i, CODE_MODALE.indexOf("\n  }", i));
  assert.ok(/await onSetAssignment\(/.test(corps), "…qui ATTEND l'écriture");
  assert.ok(/if \(!ok\)/.test(corps), "…lit le booléen");
  assert.ok(/catch \(erreur\)/.test(corps), "…et attrape le rejet");
  assert.ok(
    /estRefusAutorisation\(erreur\) \? "autorisation" : "technique"/.test(corps),
    "⚠️ un refus de droits est classé comme tel, pas en « réessaie »",
  );
});

await test("D-2. la liste branche le clic sur cette fonction, et le rejet ne fuit pas", () => {
  assert.ok(
    /onToggle=\{\(studentId, checked\) => void basculerAffectation\(studentId, checked\)\}/.test(
      CODE_MODALE,
    ),
    "le clic appelle la fonction attendue",
  );
  // ⚠️ `selectAllResults` appelle `onToggle` dans un `forEach` sans attendre :
  // c'est la modale qui doit attraper, pas la liste partagée.
  assert.ok(
    /filtered\.forEach\(/.test(CODE_LISTE),
    "la liste émet bien en lot (« Tout sélectionner les résultats »)",
  );
  assert.ok(
    !/try \{/.test(CODE_LISTE),
    "…et elle reste SANS gestion d'erreur : partagée avec les programmes et la nutrition, on ne la touche pas",
  );
});

await test("D-3. les deux messages d'échec sont distincts, et le refus ne conseille pas de réessayer", () => {
  const refus = messageEchecAffectation("autorisation");
  const panne = messageEchecAffectation("technique");
  assert.notEqual(refus, panne, "un refus de droits ne se dit pas comme une panne");
  assert.ok(!/réessaie/i.test(refus), "⚠️ réessayer ne changera rien sur un refus de droits");
  assert.ok(/réessaie/i.test(panne), "…alors qu'une panne, oui");
  assert.ok(/messageEchecAffectation\(echecAffectation\)/.test(CODE_MODALE), "et la modale l'affiche");
  assert.ok(/role="alert"/.test(CODE_MODALE), "…dans une zone annoncée aux lecteurs d'écran");
});

await test("D-4. un état de chargement existe, et il compte les écritures en vol", () => {
  assert.ok(/const \[ecrituresEnVol, setEcrituresEnVol\] = useState\(0\)/.test(CODE_MODALE),
    "⚠️ un compteur, pas un booléen : « Tout sélectionner » lance N écritures en parallèle");
  assert.ok(/setEcrituresEnVol\(\(n\) => n \+ 1\)/.test(CODE_MODALE));
  assert.ok(/setEcrituresEnVol\(\(n\) => n - 1\)/.test(CODE_MODALE));
  assert.ok(/finally/.test(CODE_MODALE), "…et il redescend même sur un échec");
});

await test("D-5. un booléen nu reste « technique » : la cause vient de la LEVÉE", () => {
  // Contrôle de cohérence avec `affectation-refus-autorisation` (contrôle 8) :
  // on ne devine pas une cause à partir d'un `false`.
  const i = CODE_DOCUMENTS.indexOf("function refuserSiAutorisation");
  assert.ok(i > 0, "la garde existe");
  const corps = CODE_DOCUMENTS.slice(i, CODE_DOCUMENTS.indexOf("\n}", i));
  assert.ok(/classerErreur\(error\) === "autorisation"/.test(corps),
    "⚠️ le classificateur déjà en place est réemployé, aucun second n'est écrit");
  assert.ok(/throw new RefusAutorisationAffectation/.test(corps));
  // Les trois écritures de `setDocumentAssignment` passent par la garde.
  assert.equal(
    (CODE_DOCUMENTS.match(/refuserSiAutorisation\(/g) ?? []).length,
    4,
    "une définition + les trois écritures (delete, update unlock_at, insert)",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   E — MIROIR DU CORRECTIF SQL (le vrai filet est la checklist par acteur)
   ══════════════════════════════════════════════════════════════════════════ */

await test("E-1. les quatre policies vérifient le COUPLE (document, élève)", () => {
  assert.equal(
    (SQL_CORRECTIF.match(/affectation_document_\w+\(document_id, student_id\)/g) ?? []).length,
    5,
    "select + insert + update(using & with check) + delete",
  );
  for (const nom of [
    "document_assignments_select_self_or_staff",
    "document_assignments_manage_staff",
    "document_assignments_update_staff",
    "document_assignments_delete_staff",
  ]) {
    assert.ok(SQL_CORRECTIF.includes(`create policy ${nom}`), `policy manquante : ${nom}`);
  }
});

await test("E-2. ⚠️ AUCUNE policy ne teste plus `document_id` SEUL — c'était l'interblocage", () => {
  const iPolicies = SQL_CORRECTIF.indexOf("-- 2. LES QUATRE POLICIES");
  const iFin = SQL_CORRECTIF.indexOf("-- 3. VÉRIFICATION");
  const policies = SQL_CORRECTIF.slice(iPolicies, iFin);
  assert.ok(iPolicies > 0 && iFin > iPolicies, "la section des policies est repérable");
  assert.ok(
    !/document_id in \(select public\.document_ids_/.test(policies),
    "⚠️ la forme auto-référentielle ne doit plus apparaître dans les policies",
  );
  // La branche de l'élève, elle, est conservée telle quelle.
  assert.ok(
    /student_id = \(select public\.current_student_id\(\)\)/.test(policies),
    "l'élève lit toujours sa propre affectation",
  );
});

await test("E-3. le correctif ne touche NI les fonctions de portée, NI les policies des documents", () => {
  // ⚠️ ON INTERDIT DE TOUCHER, PAS D'EN PARLER. Le correctif NOMME les policies
  // Storage dans ses commentaires, pour expliquer pourquoi il n'y touche pas :
  // chercher la simple chaîne ferait rougir le contrôle sur sa propre garde.
  for (const interdit of [
    "create or replace function public.document_ids_",
    "drop policy if exists documents_",
    "create policy documents_",
    "drop policy if exists \"documents_bucket",
    "create policy \"documents_bucket",
    "drop policy if exists \"document_covers",
    "create policy \"document_covers",
    "insert into storage.buckets",
  ]) {
    assert.ok(
      !SQL_CORRECTIF.includes(interdit),
      `le correctif ne doit pas contenir « ${interdit} » : hors périmètre`,
    );
  }
  assert.ok(
    /alter table|add column|drop column/.test(SQL_CORRECTIF) === false,
    "aucun changement de schéma : seules des policies et deux fonctions",
  );
  assert.ok(!/\bupdate public\./i.test(SQL_CORRECTIF), "aucune reprise de données");
  assert.ok(!/\bdelete from\b/i.test(SQL_CORRECTIF), "aucune suppression de données");
  for (const interdit of ["set role", "reset role", "set_config('role'"]) {
    assert.ok(!SQL_CORRECTIF.toLowerCase().includes(interdit), `le correctif contient « ${interdit} »`);
  }
});

await test("E-4. les deux prédicats ne lisent JAMAIS la table qu'ils protègent", () => {
  const iFn = SQL_CORRECTIF.indexOf("-- 1. LES DEUX PRÉDICATS");
  const iPol = SQL_CORRECTIF.indexOf("-- 2. LES QUATRE POLICIES");
  const fonctions = SQL_CORRECTIF.slice(iFn, iPol);
  assert.ok(
    !/from\s+public\.document_assignments/.test(fonctions),
    "⚠️ c'est l'auto-référence qui a causé le défaut : elle ne doit pas revenir",
  );
  assert.ok(/security definer/.test(fonctions), "les prédicats sont SECURITY DEFINER");
  assert.ok(/public\.coach_ids_portee/.test(fonctions), "ils bornent le propriétaire…");
  assert.ok(/student_ids_nutrition_/.test(fonctions), "…et l'élève, par catégorie");
  assert.ok(/student_ids_entrainement_/.test(fonctions));
  assert.ok(/student_ids_suivi_eleve_/.test(fonctions));
  assert.ok(/public\.is_admin/.test(fonctions), "…et l'administrateur garde ses droits");
  assert.ok(/revoke all on function public\.%I\(uuid, uuid\) from anon/.test(SQL_CORRECTIF),
    "`anon` n'a l'EXECUTE d'aucun des deux");
});
