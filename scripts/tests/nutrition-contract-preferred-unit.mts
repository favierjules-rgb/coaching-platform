/**
 * Harnais — CONTRACT : `preferred_unit` DISPARAÎT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER GARDE
 * ────────────────────────────────────────────────────────────────────────────
 * Une colonne ne se supprime pas parce qu'on CROIT que plus personne ne la lit.
 * `CONTRACT-01` rejoue la recherche exhaustive à chaque exécution : c'est la
 * preuve qui gardait le droit d'écrire cette migration, et elle doit rester
 * vraie après elle.
 *
 * Ce qui ne se prouve QUE dans PostgreSQL — la colonne réellement disparue, les
 * 63 valeurs de `quantity_unit` intactes sur des données de forme production —
 * vit dans `supabase/tests/nutrition_contract_preferred_unit_checklist.sql`.
 *
 * Lancement : npm run test:nutrition-contract
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

const MIGRATION = lire("../../supabase/migrations/20260911090000_contract_preferred_unit.sql");
const DDL = MIGRATION.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");

/** Tous les fichiers de RUNTIME — ni tests, ni migrations, ni docs. */
function fichiersRuntime(): readonly string[] {
  const fichiers: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.(ts|tsx)$/.test(chemin)) fichiers.push(chemin);
    }
  };
  for (const racine of ["lib", "components", "app", "hooks", "types"]) {
    parcourir(new URL(`../../${racine}`, import.meta.url).pathname);
  }
  return fichiers;
}

await test("CONTRACT-01. AUCUN runtime TypeScript ne lit preferred_unit", () => {
  // ⚠️ RECHERCHE EXHAUSTIVE SUR LE RUNTIME, PAS UN ÉCHANTILLON. `lib/`,
  // `components/`, `app/`, `hooks/`, `types/` — tout ce qui part au navigateur
  // ou au serveur Next. Les tests, les migrations et les docs peuvent
  // évidemment continuer de la NOMMER : ils la décrivent, ils ne s'en servent
  // pas.
  //
  // ⚠️ ON CHERCHE UN USAGE, PAS UN MOT. Un commentaire qui EXPLIQUE le
  // renommage est légitime — c'est même de la bonne documentation. On dépouille
  // donc la prose avant de chercher, exactement comme partout ailleurs dans ce
  // dépôt.
  const coupables: string[] = [];
  for (const fichier of fichiersRuntime()) {
    const source = readFileSync(fichier, "utf8")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    if (/preferred_unit|preferredUnit/.test(source)) {
      coupables.push(fichier.replace(/^.*\/miroir\//, ""));
    }
  }
  assert.deepEqual(coupables, [], `du runtime dépend encore de preferred_unit : ${coupables.join(", ")}`);
});

await test("CONTRACT-03. la RPC n'ÉCRIT plus preferred_unit — mais l'accepte encore en ENTRÉE", () => {
  // ⚠️ LA DOUBLE ÉCRITURE DISPARAÎT. C'était la moitié EXPAND du chantier ;
  // elle n'a plus de colonne où écrire.
  assert.ok(!/preferred_unit\s*=/.test(DDL), "la RPC écrit encore preferred_unit");
  assert.ok(!/quantity_unit,\s*preferred_unit\)/.test(DDL), "l'insert nomme encore la colonne");

  // ⚠️ MAIS LA CLÉ D'ENTRÉE SURVIT, ET C'EST DÉLIBÉRÉ. Un onglet ouvert avant
  // le déploiement peut encore poster l'ancienne clé ; la comprendre ne coûte
  // rien. Le CONTRACT retire une dépendance de STOCKAGE, pas une politesse.
  assert.ok(DDL.includes("nullif(v_option->>'preferred_unit', '')"),
    "l'alias d'entrée a été retiré : une charge utile ancienne serait refusée");
  assert.ok(/coalesce\(\s*nullif\(v_option->>'quantity_unit', ''\),/.test(DDL),
    "le nom neuf doit rester prioritaire");
});

await test("CONTRACT-04. la colonne et ses contraintes legacy sont supprimées, dans le BON ordre", () => {
  assert.ok(/drop column if exists preferred_unit/i.test(DDL), "la colonne n'est pas supprimée");

  for (const contrainte of [
    "meal_choice_options_preferred_paire",
    "meal_choice_options_preferred_unit_check",
    "meal_choice_options_unite_legacy_coherente",
  ]) {
    assert.ok(new RegExp(`drop constraint if exists ${contrainte}`).test(DDL),
      `${contrainte} n'est pas supprimée`);
  }

  // ⚠️ L'ORDRE N'EST PAS UN DÉTAIL. La RPC doit cesser d'écrire AVANT que la
  // colonne parte, sinon le fichier laisserait une fonction cassée entre deux
  // de ses propres instructions.
  const posRpc = DDL.indexOf("CREATE OR REPLACE FUNCTION public.save_nutrition_plan_v2");
  const posContraintes = DDL.search(/drop constraint if exists meal_choice_options_preferred_paire/);
  const posColonne = DDL.search(/drop column if exists preferred_unit/);
  assert.ok(posRpc >= 0 && posRpc < posContraintes, "la RPC doit être remplacée AVANT les contraintes");
  assert.ok(posContraintes < posColonne, "les contraintes doivent tomber AVANT la colonne");
});

await test("CONTRACT-05. la vérité métier de N1.5.2 est CONSERVÉE, pas emportée", () => {
  // ⚠️ CE QUI TOMBE EST LEGACY, ET RIEN D'AUTRE. Les deux contraintes qui
  // disent la règle de N1.5.2 — « unité ⟺ (portion OU minimum) » et le
  // vocabulaire (g, ml) — ne sont pas touchées.
  for (const gardee of ["meal_choice_options_quantites_unite", "meal_choice_options_quantity_unit_check"]) {
    assert.ok(!new RegExp(`drop constraint if exists ${gardee}`).test(DDL),
      `${gardee} est supprimée alors qu'elle porte la vérité métier`);
  }
  // Et le refus de N1.5.1 survit lui aussi.
  assert.ok(DDL.includes("PORTION_SANS_UNITE"));
  assert.ok(DDL.includes("MINIMUM_SANS_UNITE"));

  // ⚠️ ET LA MIGRATION ELLE-MÊME NE TOUCHE À AUCUNE VALEUR. Aucun `update`,
  // aucun backfill : supprimer une colonne ne doit pas être l'occasion d'en
  // réécrire une autre.
  //
  // ⚠️ ON REGARDE LE DDL DE LA MIGRATION, PAS LE CORPS DE LA RPC. La fonction
  // reproduite contient évidemment des `update public.meal_choice_options` —
  // c'est son travail. Les confondre ferait rougir ce contrôle pour le code
  // qu'il est censé préserver.
  const corpsRpc = DDL.slice(DDL.indexOf("AS $function$"), DDL.lastIndexOf("$function$") + 11);
  const ddlSeul = DDL.replace(corpsRpc, " ");
  assert.ok(!/update\s+public\./i.test(ddlSeul), "la migration réécrit des valeurs");
  assert.ok(!/insert\s+into\s+public\./i.test(ddlSeul), "la migration insère des lignes");
});

await test("CONTRACT-06. le lot N1.6A reste intact dans la fonction reproduite", () => {
  // ⚠️ LA FONCTION EST REPRODUITE, DONC ELLE PEUT PERDRE QUELQUE CHOSE EN
  // ROUTE. Le CONTRACT est écrit APRÈS N1.6A : la couleur doit y survivre,
  // comme le minimum et la portion.
  assert.ok(DDL.includes("v_occ->>'color_key'"), "la couleur N1.6A a disparu de la RPC");
  assert.ok(DDL.includes("minimum_quantity"), "le minimum N1.5.2 a disparu");
  assert.ok(DDL.includes("preferred_quantity"), "la portion N1.5.1 a disparu");
  assert.ok(DDL.includes("quantity_unit"));
});
