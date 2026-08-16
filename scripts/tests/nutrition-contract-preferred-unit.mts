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

/** Les migrations présentes sur le disque, triées — l'ordre d'application. */
const MIGRATIONS = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * ⚠️ LA MIGRATION EST TROUVÉE PAR CE QU'ELLE EST, PAS PAR SA DATE. Coder son
 * horodatage ici rendrait TOUT ce harnais illisible en cas de réordonnancement
 * du rollout : le fichier ne se chargerait plus, et l'échec serait un `ENOENT`
 * au lieu du contrôle d'ordre qui doit parler (`CONTRACT-07`). C'est
 * exactement ce qui s'est produit quand le CONTRACT est passé de 20260911 à
 * 20260913.
 */
const NOM_CONTRAT = (() => {
  const trouves = MIGRATIONS.filter((f) => f.includes("contract_preferred_unit"));
  assert.equal(trouves.length, 1, `une seule migration CONTRACT attendue, trouvé : ${trouves.join(", ")}`);
  return trouves[0];
})();

const MIGRATION = lire(`../../supabase/migrations/${NOM_CONTRAT}`);
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

await test("CONTRACT-07. le CONTRACT s'applique en DERNIER — l'ordre de rollout est dans les noms", () => {
  // ⚠️ CE CONTRÔLE EXISTE PARCE QUE L'ORDRE A ÉTÉ FAUX UNE FOIS. Le CONTRACT
  // portait 20260911, donc il tombait ENTRE N1.6A et N1.6B : `supabase db
  // push` l'aurait appliqué avant que le runtime N1.6 ne soit déployé, et la
  // production — qui peut encore lire `preferred_unit` — se serait retrouvée
  // devant une colonne disparue.
  //
  // EXPAND → DEPLOY → CONTRACT n'est pas une intention, c'est un ORDRE. Et le
  // seul endroit où PostgreSQL le lit, c'est le timestamp du nom de fichier.
  // On l'y vérifie donc, sur le disque, pas dans un commentaire.
  const migrations = MIGRATIONS;

  const horodatage = (f: string) => f.slice(0, 14);
  const contrat = migrations.find((f) => f.includes("contract_preferred_unit"));
  const couleur = migrations.find((f) => f.includes("n1_6_a_couleurs"));
  const enregistrement = migrations.find((f) => f.includes("n1_6_b_enregistrer"));

  assert.ok(contrat && couleur && enregistrement, "une des trois migrations N1.6 a disparu");

  // PHASE 1 — les deux migrations applicables AVANT tout déploiement.
  assert.ok(horodatage(couleur) < horodatage(contrat),
    `N1.6A COLOR (${couleur}) doit précéder le CONTRACT (${contrat})`);
  assert.ok(horodatage(enregistrement) < horodatage(contrat),
    `N1.6B SAVE (${enregistrement}) doit précéder le CONTRACT (${contrat})`);

  // ⚠️ CE CONTRÔLE A CHANGÉ AVEC C0.1, ET LA RAISON COMPTE. Il exigeait que le
  // CONTRACT soit la DERNIÈRE migration du dépôt — une façon simple de garantir
  // qu'aucune migration ne s'applique sur un schéma dont `preferred_unit` a
  // disparu sans qu'on l'ait décidé. Mais « le CONTRACT est éternellement le
  // dernier » n'est pas tenable : le projet continue.
  //
  // La règle est donc devenue explicite plutôt que positionnelle : toute
  // migration POSTÉRIEURE au CONTRACT doit être NOMMÉE ici, et prouver qu'elle
  // ne dépend pas de la colonne supprimée. Ajouter une migration après le
  // CONTRACT sans l'inscrire fait toujours rougir — c'est ce qu'on voulait —
  // mais l'inscrire demande maintenant de MONTRER pourquoi c'est sûr, pas
  // seulement de déplacer un compteur.
  //
  // ⚠️ C2 EST INSCRITE ICI, ET C'EST LE MÉCANISME QUI JOUE — pas un contournement.
  // La liste de courses persistante ne connaît que `planned_meal_items.unit`,
  // qui est la colonne d'APRÈS le CONTRACT ; elle ne lit ni n'écrit
  // `preferred_unit`, et la boucle ci-dessous le PROUVE sur le fichier, code
  // dépouillé de sa prose. L'inscrire sans cette preuve ne suffirait pas.
  const posterieures = migrations.filter((f) => horodatage(f) > horodatage(contrat));
  assert.deepEqual(
    posterieures,
    [
      "20260914090000_c0_1_verrou_repas_consomme.sql",
      "20260915090000_c2_liste_de_courses_persistante.sql",
    ],
    "une migration postérieure au CONTRACT n'a pas été déclarée sûre",
  );

  for (const nom of posterieures) {
    const source = lire(`../../supabase/migrations/${nom}`);
    // ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Une migration a le droit
    // d'EXPLIQUER le CONTRACT en commentaire ; elle n'a pas le droit d'en
    // dépendre. Sans ce dépouillement, l'en-tête de C0.1 suffirait à rougir.
    const code = source.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");
    assert.ok(!code.includes("preferred_unit"),
      `${nom} nomme preferred_unit : elle dépend d'une colonne supprimée`);
  }

  // ⚠️ ET N1.6B NE DÉPEND PAS DU CONTRACT — c'est ce qui rend l'ordre
  // possible. Mesuré sur le fichier : SAVE ne nomme jamais la colonne legacy,
  // ne reproduit pas `save_nutrition_plan_v2`, et ne touche `meal_choice_options`
  // que par `slot_id` / `catalog_food_id` / `product_id`.
  const save = lire(`../../supabase/migrations/${enregistrement}`);
  assert.ok(!save.includes("preferred_unit"),
    "N1.6B nomme preferred_unit : il dépendrait alors de l'ordre du CONTRACT");
  assert.ok(!save.includes("save_nutrition_plan_v2"),
    "N1.6B reproduit la RPC de plan : COLOR et CONTRACT s'écraseraient entre eux");
});
