/**
 * `ensureSelfCoachRow` — QUI A LE DROIT DE SE PROVISIONNER (P13-B)
 *
 *   npm run test:provisioning-ligne-coach
 *
 * Tests COMPORTEMENTAUX : la vraie fonction est exécutée contre un double du
 * client Supabase qui ENREGISTRE chaque requête. On observe donc ce qui est
 * réellement tenté, et pas ce que le code a l'air de faire.
 *
 * Le défaut corrigé : depuis P13-B, `coaches` est en lecture ET en écriture
 * `is_admin()` (policies `coaches_manage_admin_*`, migration 20261011100000).
 * Pour un assistant ou un collaborateur, la fonction faisait donc un `select`
 * qui renvoyait zéro ligne — non parce qu'aucune fiche n'existe, mais parce
 * qu'il n'a pas le droit de la voir — puis, trompée par ce vide, un `insert`
 * refusé en 42501, journalisé en erreur à CHAQUE chargement de
 * /admin/parametres.
 *
 * Aucun contournement par service role : la fonction renonce quand elle n'a
 * pas les droits, elle ne les emprunte pas.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureSelfCoachRow } from "@/lib/supabase/coaches";

let passed = 0;
let failed = 0;
async function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${nom}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(error);
  }
}

interface Trace {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "upsert";
}

/**
 * Double du client. Il reproduit le point essentiel du comportement réel sous
 * RLS : pour un NON-ADMINISTRATEUR, `coaches` renvoie zéro ligne en lecture et
 * refuse l'écriture avec le code `42501` (insufficient_privilege) — exactement
 * ce qu'une base réelle fait, et ce qui avait trompé la version précédente.
 */
function faireClient(options: { profilRole: string | null; ligneCoachExiste: boolean }) {
  const traces: Trace[] = [];
  const estAdmin = options.profilRole === "admin";

  const requete = (table: string) => {
    const chainable: Record<string, unknown> = {};
    for (const methode of ["select", "eq", "ilike", "order", "limit"]) {
      chainable[methode] = (...args: unknown[]) => {
        if (methode === "select") traces.push({ table, operation: "select" });
        void args;
        return chainable;
      };
    }
    const lignePourTable = () => {
      if (table === "profiles") {
        return options.profilRole === null
          ? null
          : { first_name: "Test", last_name: "Utilisateur", email: "test@local", role: options.profilRole };
      }
      if (table === "coaches") {
        // RLS : un non-admin ne voit AUCUNE ligne, même la sienne.
        if (!estAdmin) return null;
        return options.ligneCoachExiste ? { id: "coach-1" } : null;
      }
      return null;
    };
    chainable.maybeSingle = async () => ({ data: lignePourTable(), error: null });
    chainable.single = async () => ({ data: lignePourTable(), error: null });
    chainable.insert = async (valeurs: unknown) => {
      traces.push({ table, operation: "insert" });
      insertions.push(valeurs);
      if (table === "coaches" && !estAdmin) {
        return { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
      }
      return { data: null, error: null };
    };
    for (const methode of ["update", "delete", "upsert"] as const) {
      chainable[methode] = async () => {
        traces.push({ table, operation: methode });
        return { data: null, error: null };
      };
    }
    return chainable;
  };

  const insertions: unknown[] = [];
  return {
    traces,
    insertions,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "test@local" } } }) },
      from: (table: string) => requete(table),
    },
  };
}

/** Capture `console.error` : la fonction journalise ses échecs, on veut zéro ligne. */
async function sansJournal<T>(fn: () => Promise<T>): Promise<{ resultat: T; journal: string[] }> {
  const journal: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    journal.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    return { resultat: await fn(), journal };
  } finally {
    console.error = original;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const appeler = (client: unknown) => ensureSelfCoachRow(client as any);
/* eslint-enable @typescript-eslint/no-explicit-any */

await test("1. assistant : AUCUNE requête sur coaches, aucune erreur journalisée", async () => {
  // `profiles.role` vaut "coach" pour tout le staff non-admin : c'est le cas
  // d'un coach autonome comme d'un collaborateur.
  const { client, traces, insertions } = faireClient({ profilRole: "coach", ligneCoachExiste: false });
  const { journal } = await sansJournal(() => appeler(client));

  assert.deepEqual(
    traces.filter((t) => t.table === "coaches"),
    [],
    "aucune requête ne doit atteindre coaches : ni le select vide, ni l'insert refusé",
  );
  assert.deepEqual(insertions, [], "aucune écriture tentée");
  assert.deepEqual(journal, [], `aucune erreur ne doit être journalisée : ${journal.join(" | ")}`);
});

await test("2. collaborateur : même verdict, aucune tentative d'écriture", async () => {
  const { client, traces, insertions } = faireClient({ profilRole: "coach", ligneCoachExiste: false });
  const { journal } = await sansJournal(() => appeler(client));

  assert.deepEqual(traces.filter((t) => t.table === "coaches"), []);
  assert.deepEqual(insertions, []);
  assert.deepEqual(journal, []);
  // Le rôle est bien lu, et il l'est dans `profiles` — la seule table que
  // chacun peut lire pour SA propre ligne.
  assert.deepEqual(traces, [{ table: "profiles", operation: "select" }]);
});

await test("3. élève : rien non plus", async () => {
  const { client, traces, insertions } = faireClient({ profilRole: "student", ligneCoachExiste: false });
  const { journal } = await sansJournal(() => appeler(client));
  assert.deepEqual(traces.filter((t) => t.table === "coaches"), []);
  assert.deepEqual(insertions, []);
  assert.deepEqual(journal, []);
});

await test("4. compte sans profil : rien, et aucune erreur", async () => {
  const { client, traces, insertions } = faireClient({ profilRole: null, ligneCoachExiste: false });
  const { journal } = await sansJournal(() => appeler(client));
  assert.deepEqual(traces.filter((t) => t.table === "coaches"), []);
  assert.deepEqual(insertions, []);
  assert.deepEqual(journal, []);
});

await test("5. administrateur sans fiche : la ligne est créée, en rôle admin", async () => {
  const { client, traces, insertions } = faireClient({ profilRole: "admin", ligneCoachExiste: false });
  const { journal } = await sansJournal(() => appeler(client));

  assert.deepEqual(
    traces,
    [
      { table: "profiles", operation: "select" },
      { table: "coaches", operation: "select" },
      { table: "coaches", operation: "insert" },
    ],
    "le rôle doit être lu AVANT de toucher coaches",
  );
  assert.equal(insertions.length, 1, "une seule insertion");
  const ligne = insertions[0] as Record<string, unknown>;
  assert.equal(ligne.user_id, "user-1");
  assert.equal(ligne.role, "admin", "la fiche de l'administrateur porte le rôle admin");
  assert.equal(ligne.status, "actif");
  assert.deepEqual(journal, [], "aucune erreur attendue sur le chemin administrateur");
});

await test("6. administrateur ayant déjà sa fiche : aucune insertion", async () => {
  const { client, traces, insertions } = faireClient({ profilRole: "admin", ligneCoachExiste: true });
  const { journal } = await sansJournal(() => appeler(client));
  assert.deepEqual(traces, [
    { table: "profiles", operation: "select" },
    { table: "coaches", operation: "select" },
  ]);
  assert.deepEqual(insertions, [], "la fiche existante ne doit pas être dupliquée");
  assert.deepEqual(journal, []);
});

await test("7. aucun contournement : la fonction n'utilise jamais le service role", () => {
  // Contrôle statique, en complément : le correctif ne doit pas consister à
  // emprunter des droits qu'on n'a pas.
  const code = readFileSync(new URL("../../lib/supabase/coaches.ts", import.meta.url), "utf8");
  assert.ok(!/createSupabaseAdminClient|SERVICE_ROLE|service_role/.test(code),
    "lib/supabase/coaches.ts ne doit jamais passer par le service role");
  // Et le rôle est bien lu avant toute requête sur coaches.
  const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
  const corps = sansCommentaires.slice(sansCommentaires.indexOf("export async function ensureSelfCoachRow"));
  const posProfil = corps.indexOf('from("profiles")');
  const posCoaches = corps.indexOf('from("coaches")');
  assert.ok(posProfil > 0 && posCoaches > posProfil,
    "profiles doit être lue AVANT coaches, sinon le select vide revient");
  assert.ok(/profile\?\.role !== "admin"/.test(corps),
    "la garde doit être exactement `profiles.role === 'admin'`, c'est-à-dire is_admin()");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
