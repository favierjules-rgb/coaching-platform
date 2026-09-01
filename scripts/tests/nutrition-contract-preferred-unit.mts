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
      // ⚠️ C3 INSCRITE ICI, ET LA BOUCLE CI-DESSOUS LE PROUVE. Le budget et les
      // prix ne connaissent que `shopping_list_items.unit` et leur propre
      // colonne `unit` — la colonne d'APRÈS le CONTRACT. `preferred_unit`
      // n'apparaît nulle part dans la migration C3.
      "20260916090000_c3_budget_et_prix_estimatifs.sql",
      // ⚠️ C4.1 INSCRITE ICI, ET C'EST LE MÉCANISME QUI JOUE — pas un
      // contournement. Le pont aliment → produit crée UNE table,
      // `food_catalog_retail_review`, dont les cinq colonnes sont
      // `catalog_food_id`, `status`, `note`, `reviewed_by`, `reviewed_at`.
      //
      // Elle ne porte AUCUNE unité, et c'est ce qui la met hors de portée du
      // CONTRACT : le pont dit « quel produit réel correspond à cet aliment »,
      // jamais « en quelle unité ». Mesuré sur le fichier, code dépouillé :
      //   · `preferred_unit` : ZÉRO occurrence — pas même en commentaire ;
      //   · seule table créée ou altérée : `food_catalog_retail_review` ;
      //   · aucun `rename`, aucun `alter column`, aucune contrainte ajoutée
      //     ou retirée en dehors de cette table neuve ;
      //   · `meal_choice_options`, `planned_meal_items`, `quantity_unit` et
      //     même le mot `unit` : ABSENTS ;
      //   · les seules références externes sont la clé étrangère vers
      //     `public.food_catalog(id)` et l'appel à `public.is_admin()`.
      //
      // La boucle ci-dessous rejoue la dernière de ces preuves à chaque
      // exécution : l'inscrire ne suffit pas, il faut que le fichier tienne.
      "20260917090000_c4_1_pont_retail.sql",
      // ⚠️ C4.2 INSCRITE ICI, PAR LE MÊME MÉCANISME — une entrée NOMMÉE, jamais
      // une règle du genre « tout ce qui suit cette date est sûr ».
      //
      // Le modèle du magasin crée DEUX tables : `stores` (id, op_location_id,
      // osm_type, osm_id, name, brand, city, postcode, country_code, lat, lon,
      // created_at) et `student_selected_store` (student_id, store_id,
      // updated_at). Aucune des quinze colonnes n'est une unité, et c'est ce
      // qui met ce lot hors de portée du CONTRACT : il dit « OÙ l'élève fait
      // ses courses », jamais « en quelle unité ». Mesuré sur le fichier, code
      // dépouillé de sa prose :
      //   · `preferred_unit` : ZÉRO occurrence — pas même en commentaire ;
      //   · seules tables créées ou altérées : les deux ci-dessus ;
      //   · aucun `rename`, aucun `alter column`, aucun `drop` autre que les
      //     `drop policy if exists` du gabarit, immédiatement suivis de leur
      //     recréation ;
      //   · `meal_choice_options`, `planned_meal_items`, `quantity_unit` et
      //     même le mot `unit` : ABSENTS ;
      //   · les seules références externes sont les clés étrangères vers
      //     `public.students(id)` et `public.stores(id)`, et les appels à
      //     `public.current_student_id()` et `public.is_admin()`.
      //
      // La boucle ci-dessous rejoue cette dernière preuve à chaque exécution :
      // l'inscrire ne suffit pas, il faut que le fichier tienne.
      "20260918090000_c4_2_magasins.sql",
      // ⚠️ C4.3c INSCRITE ICI, PAR LE MÊME MÉCANISME — et c'est la migration la
      // plus étroite du chantier COURSES : elle ne crée AUCUNE table.
      //
      // Elle fait trois choses. Elle rend `stores.op_location_id` NULLABLE, ce
      // qui est le seul `alter column` de tout le lot : OpenStreetMap devient
      // l'annuaire des magasins, et un magasin réel peut donc exister sans que
      // Open Prices le connaisse. Elle ajoute deux colonnes `text null`,
      // `brand_wikidata` et `operator_wikidata`, qui identifient une ENSEIGNE.
      // Elle pose la forme de ces deux identifiants (`^Q[1-9][0-9]*$`).
      //
      // Rien de tout cela n'est une unité, et c'est ce qui la met hors de
      // portée du CONTRACT : elle dit « QUEL magasin, et de quelle enseigne »,
      // jamais « en quelle quantité ». Mesuré sur le fichier, code dépouillé
      // de sa prose :
      //   · `preferred_unit` : ZÉRO occurrence — pas même en commentaire ;
      //   · aucune table créée : seule `public.stores` est altérée ;
      //   · le seul `alter column` est le `drop not null` ci-dessus ; aucun
      //     `rename`, aucun `drop column`, aucun `drop constraint` ;
      //   · `meal_choice_options`, `planned_meal_items`, `quantity_unit` et
      //     même le mot `unit` : ABSENTS ;
      //   · aucune référence externe, aucune policy, aucune fonction.
      //
      // La boucle ci-dessous rejoue cette dernière preuve à chaque exécution :
      // l'inscrire ne suffit pas, il faut que le fichier tienne.
      "20260919090000_c4_3c_magasins_osm.sql",
      // ⚠️ N1.7 INSCRITE ICI, ET C'EST LE CAS LE PLUS DÉLICAT DE LA LISTE —
      // parce que c'est la SEULE qui reproduise `save_nutrition_plan_v2`.
      //
      // Les listes ignorables ajoutent `peut_etre_ignoree` au snapshot d'une
      // occurrence. Cette colonne voyage dans la RPC de plan, qui doit donc
      // être redonnée en entier : PostgreSQL n'a pas de « patch de fonction ».
      // Le corps recopié est celui du CONTRACT lui-même (20260913), vérifié
      // identique à l'octet près contre la base distante avant recopie — il ne
      // peut donc pas ramener une version antérieure et « défaire » le
      // CONTRACT par écrasement. L'ordre est également garanti : 20260920 est
      // postérieure à 20260913.
      //
      // ⚠️ ET ELLE CONTIENT LA CHAÎNE `preferred_unit`, UNE FOIS, DANS DU CODE.
      // C'est `nullif(v_option->>'preferred_unit', '')` — la CLÉ D'ENTRÉE JSON
      // que le CONTRACT a délibérément conservée quand il a supprimé la
      // COLONNE (« la clé d'entrée survit à la colonne »). La recopier est la
      // seule façon de ne pas casser la compatibilité de charge utile que le
      // CONTRACT a voulue ; la retirer serait la régression.
      //
      // La boucle ci-dessous ne cherche donc plus la chaîne, mais la
      // DÉPENDANCE À LA COLONNE — voir son commentaire.
      "20260920090000_n1_7_listes_ignorables.sql",
    ],
    "une migration postérieure au CONTRACT n'a pas été déclarée sûre",
  );

  for (const nom of posterieures) {
    const source = lire(`../../supabase/migrations/${nom}`);
    // ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Une migration a le droit
    // d'EXPLIQUER le CONTRACT en commentaire ; elle n'a pas le droit d'en
    // dépendre. Sans ce dépouillement, l'en-tête de C0.1 suffirait à rougir.
    const code = source.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");

    /*
     * ⚠️ RESSERRÉ (N1.7) — ON CHERCHE LA DÉPENDANCE À LA COLONNE, PLUS LA
     * SIMPLE CHAÎNE.
     *
     * L'interdiction portait sur le TEXTE `preferred_unit`. Elle a rougi sur
     * N1.7, qui recopie `save_nutrition_plan_v2` — et donc le
     * `nullif(v_option->>'preferred_unit', '')` que le CONTRACT lui-même y a
     * laissé, EXPRÈS, pour que les charges utiles d'avant continuent d'être
     * acceptées (« la clé d'entrée survit à la colonne »). Interdire cette
     * occurrence-là reviendrait à interdire la compatibilité que le CONTRACT a
     * construite — et à pousser un lot futur à la supprimer pour passer au
     * vert. C'est le test qui aurait causé la régression.
     *
     * Ce qui doit rester interdit, c'est de DÉPENDRE DE LA COLONNE supprimée :
     * la lire (`o.preferred_unit`), l'écrire (`set preferred_unit = …`), la
     * recréer (`add column preferred_unit`), ou la nommer dans une contrainte.
     *
     * ⚠️ ON RETIRE DONC LA CLÉ JSON — ET ELLE SEULE. `'preferred_unit'` entre
     * apostrophes est du TEXTE dans une charge utile ; la colonne peut être
     * partie depuis des mois, la clé reste lisible. Tout ce qui subsiste après
     * ce retrait est un IDENTIFIANT SQL, et un identifiant `preferred_unit` ne
     * peut désigner que la colonne.
     *
     * ⚠️ ET C'EST UN RETRAIT LITTÉRAL, PAS UN ANALYSEUR DE CHAÎNES SQL. Une
     * première version neutralisait TOUTES les chaînes par expression
     * régulière : sur 1 300 lignes de plpgsql où les apostrophes françaises
     * sont doublées (`l''occurrence`), l'appariement se décalait d'un quote et
     * laissait passer exactement ce qu'il devait attraper. On mesure ce qu'on
     * croit mesurer.
     */
    const sansCleJson = code.split("'preferred_unit'").join(" ");
    assert.ok(!sansCleJson.includes("preferred_unit"),
      `${nom} nomme preferred_unit hors d'une clé JSON : elle dépend de la colonne supprimée`);
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
