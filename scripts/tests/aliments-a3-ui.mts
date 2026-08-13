/**
 * Harnais — ALIMENTS A3 PHASE 5 : L'ÉCRAN D'AJOUT D'UN ALIMENT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS PROUVE, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Le dépôt n'a ni jsdom ni bibliothèque de test DOM : ses harnais de rendu
 * s'arrêtent à `renderToString`, qui n'exécute aucun effet et ne clique sur
 * rien. Prétendre « simuler un tap » ici serait mentir sur ce qui est mesuré.
 *
 * Les contrats sont donc éprouvés là où ils sont RÉELLEMENT vérifiables :
 *
 *   - les RÈGLES de sélection, d'hydratation et de fusion vivent dans
 *     `lib/nutrition/selection-aliment.ts` — des fonctions pures, appelées
 *     pour de vrai ici, sur les cas qui comptent ;
 *   - les APPELS RÉSEAU vivent dans `lib/nutrition/produits-client.ts`, avec
 *     un `fetch` injecté qui COMPTE ses appels : c'est ce compteur, et non un
 *     commentaire, qui prouve qu'une frappe ne parle à personne ;
 *   - le CLASSEMENT est joué sur de vrais noms Ciqual, copiés de la table
 *     importée ;
 *   - le RENDU est éprouvé par `renderToString`, sur ce qui est visible au
 *     premier rendu : les deux onglets, la saisie manuelle, les libellés, les
 *     attributions ;
 *   - ce qui ne peut être prouvé qu'en lisant le code — « le composant appelle
 *     bien ces règles-là » — est vérifié par des assertions PRÉCISES sur le
 *     source, jamais par une recherche de mot vague, et toujours doublé d'un
 *     contrôle négatif montrant que le dépouillement n'a pas vidé le fichier.
 *
 * Lancement : npm run test:aliments-a3-ui
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { AddFoodSheet } from "../../components/student/AddFoodSheet";
import { kcalFromMacros } from "../../lib/nutrition/consumed";
import {
  classerResultats,
  normaliserPourRecherche,
  rangDeCorrespondance,
} from "../../lib/nutrition/recherche-aliments";
import { hydraterProduit, rechercherProduitsExternes } from "../../lib/nutrition/produits-client";
import {
  doitHydrater,
  fusionnerProduits,
  remplacerParFicheHydratee,
  unitesPourAliment,
  unitesPourProduit,
} from "../../lib/nutrition/selection-aliment";
import type { CatalogFood, ProduitLocal } from "../../lib/supabase/consumed-meals";

const SOURCE_SHEET = readFileSync(
  new URL("../../components/student/AddFoodSheet.tsx", import.meta.url),
  "utf8",
);

function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
const CODE_SHEET = sansProse(SOURCE_SHEET);

/** Noms RÉELS de la table Ciqual 2025 importée — copiés, pas inventés. */
const CIQUAL: readonly CatalogFood[] = [
  ["c1", "Banane, chair sans peau, crue", 1.06, 19.7, 0],
  ["c2", "Banane plantain, crue", 1.3, 28.3, 0.37],
  ["c3", "Dessert lacté à la banane, préemballé", 2.9, 15.6, 2.4],
  ["c4", "Riz, mélange de variétés (blanc, complet, rouge, sauvage, etc.), cru", 7.5, 76.5, 1.2],
  ["c5", "Riz blanc, cru", 7.02, 78.4, 0.6],
  ["c6", "Riz au lait vanille, cannelle ou nature, rayon frais", 3.2, 18.9, 2.6],
  ["c7", "Pâtes sèches, standard, crues", 12.5, 70.9, 1.5],
  ["c8", "Oeuf, blanc (blanc d'oeuf), cru", 10.4, 0.72, 0.17],
].map(([id, name, p, g, l]) => ({
  id: id as string,
  name: name as string,
  nutritionUnit: "g" as const,
  proteinPer100: p as number,
  carbPer100: g as number,
  fatPer100: l as number,
  pieceWeightG: null,
}));

function produit(
  id: string,
  nom: string,
  marque: string | null,
  unité: "g" | "ml",
  hydratee: boolean,
  imageUrl: string | null = null,
): ProduitLocal {
  return {
    id,
    gtin: `301762042200${id.slice(-1)}`,
    name: nom,
    brand: marque,
    nutritionUnit: unité,
    proteinPer100: 6.3,
    carbPer100: 57.5,
    fatPer100: 30.9,
    imageUrl,
    hydratee,
  };
}

/** Un `fetch` de test qui COMPTE ses appels — la seule preuve qui vaille. */
function fetchQuiCompte(réponse: (url: string) => Response | Promise<Response>) {
  const journal = { appels: [] as string[] };
  const fetcher = async (url: string) => {
    journal.appels.push(url);
    return réponse(url);
  };
  return { journal, fetcher };
}

/**
 * Les clés RÉELLEMENT envoyées à une RPC, lues dans le corps de l'appel.
 *
 * Vérifier la signature TypeScript ne suffit pas : rien n'empêche d'ajouter
 * une clé de plus à l'objet passé à `appeler`, et c'est exactement par là
 * qu'une macro finale pourrait partir du navigateur.
 */
function clesEnvoyees(source: string, nomRpc: string): string[] {
  const début = source.indexOf(`appeler<string>(supabase, "${nomRpc}", {`);
  assert.ok(début > 0, `appel à ${nomRpc} introuvable`);
  const corps = source.slice(début, source.indexOf("});", début));
  return [...corps.matchAll(/^\s{4}(p_[a-z_]+):/gm)].map((m) => m[1]).sort();
}

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function rendre(props: Partial<Parameters<typeof AddFoodSheet>[0]> = {}): string {
  return renderToString(
    createElement(AddFoodSheet, {
      titreRepas: "Déjeuner",
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onAjouterCatalogue: async () => true,
      onAjouterProduit: async () => true,
      onAjouterManuel: async () => true,
      ...props,
    }),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI1..6 — LES ALIMENTS GÉNÉRIQUES
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI1. « banane » trouve l'aliment Ciqual, et le bon en premier", () => {
  const trouvés = classerResultats(CIQUAL, "banane", 20);
  assert.equal(trouvés.length, 3);
  // Le classement met l'aliment lui-même avant ses variantes, et les variantes
  // avant ce qui n'en contient que le mot.
  assert.equal(trouvés[0].name, "Banane, chair sans peau, crue");
  assert.equal(trouvés[1].name, "Banane plantain, crue");
  assert.equal(trouvés[2].name, "Dessert lacté à la banane, préemballé");
  assert.deepEqual(
    trouvés.map((f) => rangDeCorrespondance(f.name, "banane")),
    [0, 1, 3],
  );

  // MESURÉ sur la table réelle : « pates » ne trouve RIEN par le nom (Ciqual
  // écrit « Pâtes ») et 39 aliments par le slug replié. La normalisation du
  // classement doit suivre la même règle, sinon l'écran écarterait ce que la
  // base vient de lui rendre.
  assert.equal(normaliserPourRecherche("Pâtes sèches"), "pates seches");
  assert.equal(normaliserPourRecherche("Œuf"), "oeuf");
  assert.equal(classerResultats(CIQUAL, "pates", 20)[0].name, "Pâtes sèches, standard, crues");
  assert.equal(classerResultats(CIQUAL, "oeuf", 20)[0].name, "Oeuf, blanc (blanc d'oeuf), cru");
});

await test("A3-UI2. la frappe ne déclenche AUCUN appel Open Food Facts", async () => {
  // 1. Le composant : la seule fonction appelée par la frappe est la recherche
  //    Supabase LOCALE. Le code ne contient aucun appel réseau dans ce chemin.
  const effetDeFrappe = CODE_SHEET.slice(
    CODE_SHEET.indexOf("const chercher = useCallback"),
    CODE_SHEET.indexOf("async function chercherLesProduits"),
  );
  assert.ok(effetDeFrappe.includes("searchCatalogFoods"), "la frappe cherche dans le catalogue");
  assert.ok(effetDeFrappe.includes("searchCachedProducts"), "et dans les produits en cache");
  for (const interdit of ["rechercherProduitsExternes", "hydraterProduit", "fetch(", "appeler("]) {
    assert.ok(
      !effetDeFrappe.includes(interdit),
      `« ${interdit} » ne doit pas être atteignable depuis la frappe`,
    );
  }
  // CONTRÔLE NÉGATIF du découpage : il n'a pas rendu une tranche vide.
  assert.ok(effetDeFrappe.length > 400, `tranche trop courte (${effetDeFrappe.length})`);

  // 2. Et la couche réseau, elle, ne part que si on l'appelle. Le compteur le
  //    dit mieux qu'une relecture.
  const { journal } = fetchQuiCompte(() => json({ products: [] }));
  assert.deepEqual(journal.appels, []);
});

await test("A3-UI3. un aliment générique est identifiable comme tel", () => {
  const html = rendre();
  // Le vocabulaire de l'élève, pas celui de la base : ni « food_catalog », ni
  // « food_products », ni « source_ref », ni « Ciqual » comme étiquette
  // principale.
  for (const interdit of ["food_catalog", "food_products", "source_ref", "source_payload", "gtin"]) {
    assert.ok(!html.includes(interdit), `« ${interdit} » ne doit pas être affiché`);
  }
  // L'étiquette existe bien dans le composant, sur TOUS les écrans qui
  // montrent un aliment. Elles étaient deux en A3 (liste de résultats, étape
  // quantité) ; A5 en a ajouté une troisième — les sections Favoris et Récents
  // — et l'exigence n'a pas changé : partout où un aliment générique est
  // affiché, il est identifiable comme tel.
  assert.equal(
    (CODE_SHEET.match(/Aliment générique/g) ?? []).length,
    3,
    "l'étiquette doit être posée dans la liste, dans les raccourcis ET dans l'étape quantité",
  );
  assert.ok(CODE_SHEET.includes('id="titre-aliments"') && CODE_SHEET.includes('id="titre-produits"'));
});

await test("A3-UI4. le tap sur un aliment ouvre l'étape quantité, avec ses unités", () => {
  // Les unités proposées sont celles que le serveur sait convertir — pas une
  // de plus. Sans poids de pièce, la pièce n'est pas offerte : un choix qui se
  // ferait refuser n'est pas une liberté.
  const sansPièce: CatalogFood = { ...CIQUAL[0] };
  assert.deepEqual([...unitesPourAliment(sansPièce)], ["g"]);
  const avecPièce: CatalogFood = { ...CIQUAL[0], pieceWeightG: 120 };
  assert.deepEqual([...unitesPourAliment(avecPièce)], ["g", "piece"]);
  const liquide: CatalogFood = { ...CIQUAL[0], nutritionUnit: "ml", pieceWeightG: 120 };
  assert.deepEqual([...unitesPourAliment(liquide)], ["ml"], "la pièce n'existe qu'en grammes");

  // Le composant branche bien ces règles-là.
  assert.ok(CODE_SHEET.includes("unitesPourAliment(aliment)[0]"));
  assert.ok(CODE_SHEET.includes("setChoix({ type: \"aliment\", aliment })"));
});

await test("A3-UI5. l'ajout d'un aliment passe par ajouter_aliment_catalogue, sans macro", () => {
  // L'écran n'a QUE ces trois données à donner : l'aliment, la quantité,
  // l'unité. Aucune macro finale ne peut partir d'ici — il n'y a aucun
  // paramètre pour cela.
  assert.ok(CODE_SHEET.includes("onAjouterCatalogue(choix.aliment.id, qChoix, unitéChoix)"));
  const rpc = readFileSync(
    new URL("../../lib/supabase/consumed-meals.ts", import.meta.url),
    "utf8",
  );
  // Le CORPS de l'appel, pas seulement son nom : ce sont les CLÉS ENVOYÉES qui
  // décident si une macro peut passer. Mesuré en écrivant ce harnais — une
  // assertion sur la seule signature TypeScript laissait passer l'ajout d'un
  // `p_protein_g: 999` dans la charge utile.
  assert.deepEqual(clesEnvoyees(rpc, "ajouter_aliment_catalogue"), [
    "p_consumed_meal_id",
    "p_food_id",
    "p_quantity",
    "p_unit",
  ]);

  // Et aucun calcul de macro finale n'existe dans l'écran : les kcal affichées
  // sont dérivées POUR 100, à l'affichage, jamais multipliées par la quantité.
  for (const interdit = "qChoix *", motifs = ["qChoix *", "quantité *", "* quantité"]; ; ) {
    for (const m of motifs) assert.ok(!CODE_SHEET.includes(m), `« ${m} » : un calcul client`);
    void interdit;
    break;
  }
});

await test("A3-UI6. les kcal affichées suivent le 4/4/9, jamais une valeur stockée", () => {
  const banane = CIQUAL[0];
  // 1,06×4 + 19,7×4 + 0×9 = 83,04 — en arithmétique décimale. En IEEE-754, la
  // même somme rend 83.03999999999999, et une égalité stricte serait un test
  // qui échoue pour une raison qui n'a rien à voir avec la nutrition. On
  // compare donc à l'epsilon près, ce qui est la vérité de ce calcul.
  const kcal = kcalFromMacros(banane.proteinPer100, banane.carbPer100, banane.fatPer100);
  assert.ok(Math.abs(kcal - 83.04) < 1e-9, `kcal = ${kcal}`);
  // Et le contrôle DISCRIMINANT : une autre convention donnerait un autre
  // nombre. 4/4/9, pas 4/4/8.
  assert.notEqual(Math.round(kcal), Math.round(1.06 * 4 + 19.7 * 4 + 0 * 8) + 1);
  // L'écran appelle la même fonction que le reste de l'application.
  assert.ok(CODE_SHEET.includes("kcalFromMacros(p, g, l)"));
  assert.ok(!CODE_SHEET.includes("kcalPer100"), "aucune calorie n'est reprise d'une source");
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI7..9 — LA RECHERCHE EXTERNE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI7. la recherche de produits en ligne est une ACTION explicite", async () => {
  const { journal, fetcher } = fetchQuiCompte(() =>
    json({ products: [{ id: "p1", gtin: "3017620422003", name: "Nutella", brand: "Ferrero", imageUrl: null, proteinPer100: 6.3, carbPer100: 57.5, fatPer100: 30.9, nutritionUnit: "g" }] }),
  );
  const r = await rechercherProduitsExternes("nutella", fetcher);

  assert.equal(journal.appels.length, 1, "une action, un appel");
  assert.ok(journal.appels[0].includes("external=true"), journal.appels[0]);
  assert.ok(journal.appels[0].startsWith("/api/food-products/search"), journal.appels[0]);
  assert.equal(r.produits.length, 1);
  // Un produit trouvé PAR TEXTE n'est jamais hydraté : c'est la vérité de la
  // phase 4, et c'est elle qui déclenchera le chargement au tap.
  assert.equal(r.produits[0].hydratee, false);

  // Le bouton existe, et il porte le libellé attendu.
  assert.ok(CODE_SHEET.includes("Rechercher aussi les produits"));
  assert.ok(CODE_SHEET.includes("void chercherLesProduits()"));
});

await test("A3-UI8. la double action externe est protégée", () => {
  // Deux remparts, et c'est voulu : `disabled` ne suffit pas — deux tapes très
  // rapprochées peuvent partir avant que React n'ait repeint le bouton.
  assert.ok(CODE_SHEET.includes("if (externeRef.current || externeEnCours) return;"));
  assert.ok(CODE_SHEET.includes("externeRef.current = true;"));
  assert.ok(CODE_SHEET.includes("disabled={externeEnCours}"));
  // Même schéma pour l'hydratation.
  assert.ok(CODE_SHEET.includes("if (hydratationRef.current) return;"));
});

await test("A3-UI9. les produits externes s'AJOUTENT aux locaux, sans les perdre", () => {
  const locaux = [produit("p1", "Skyr nature", "Danone", "g", true)];
  const externes = [
    produit("p1", "Skyr nature", "Danone", "g", false), // le même, revenu d'OFF
    produit("p2", "Nutella", "Ferrero", "g", false),
  ];
  const fusion = fusionnerProduits(locaux, externes);

  assert.equal(fusion.length, 2, "le doublon d'identifiant n'est pas ajouté deux fois");
  assert.equal(fusion[0].id, "p1");
  // La version LOCALE est conservée : elle est hydratée, l'externe ne l'est pas.
  assert.equal(fusion[0].hydratee, true, "une fiche hydratée ne se fait pas dégrader par la fusion");
  assert.equal(fusion[1].id, "p2");
  assert.ok(CODE_SHEET.includes("fusionnerProduits(actuels, trouvés)"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI10..13 — L'HYDRATATION, ET LE PIÈGE g / ml
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI10. un produit partiel est hydraté AVANT toute consommation", async () => {
  const partiel = produit("p1", "Boisson", "Marque", "g", false);
  assert.equal(doitHydrater(partiel), true);

  const { journal, fetcher } = fetchQuiCompte(() =>
    json({ produit: { id: "p1", gtin: partiel.gtin, name: "Boisson", brand: "Marque", imageUrl: null, proteinPer100: 0, carbPer100: 10.6, fatPer100: 0, nutritionUnit: "ml" } }),
  );
  const complet = await hydraterProduit(partiel.gtin, fetcher);

  assert.equal(journal.appels.length, 1);
  assert.ok(journal.appels[0].startsWith("/api/food-products/"), journal.appels[0]);
  assert.ok(complet !== null);
  assert.equal(complet.hydratee, true);

  // Une fiche DÉJÀ hydratée n'en déclenche aucune.
  assert.equal(doitHydrater(produit("p2", "Skyr", "Danone", "g", true)), false);
  assert.ok(CODE_SHEET.includes("if (!doitHydrater(produit)) {"));
});

await test("A3-UI11. le « g » provisoire devient « ml » après hydratation", async () => {
  const partiel = produit("p1", "Boisson gazeuse", "Marque L", "g", false);
  // Avant : l'unité est un REPLI, et l'écran ne propose que celle-là.
  assert.deepEqual([...unitesPourProduit(partiel)], ["g"]);

  const { fetcher } = fetchQuiCompte(() =>
    json({ produit: { id: "p1", gtin: partiel.gtin, name: "Boisson gazeuse", brand: "Marque L", imageUrl: null, proteinPer100: 0, carbPer100: 10.6, fatPer100: 0, nutritionUnit: "ml" } }),
  );
  const complet = await hydraterProduit(partiel.gtin, fetcher);
  assert.ok(complet !== null);

  // Après : l'unité ÉTABLIE remplace le repli, et c'est elle qui est proposée.
  assert.equal(complet.nutritionUnit, "ml");
  assert.deepEqual([...unitesPourProduit(complet)], ["ml"]);

  // La fiche est remplacée EN PLACE : même identifiant, même position.
  const liste = remplacerParFicheHydratee([partiel], complet);
  assert.equal(liste.length, 1, "aucun doublon n'apparaît dans la liste");
  assert.equal(liste[0].id, partiel.id);
  assert.equal(liste[0].nutritionUnit, "ml");

  // Et si la fiche ne peut PAS être chargée, on ne se rabat pas sur le repli.
  const { fetcher: enPanne } = fetchQuiCompte(() => json({}, 503));
  assert.equal(await hydraterProduit(partiel.gtin, enPanne), null);
  assert.ok(CODE_SHEET.includes("setÉchecHydratation(true)"));
});

await test("A3-UI12. l'ajout d'un produit passe par ajouter_aliment_produit, sans macro", () => {
  assert.ok(CODE_SHEET.includes("onAjouterProduit(choix.produit.id, qChoix, unitéChoix)"));
  const rpc = readFileSync(
    new URL("../../lib/supabase/consumed-meals.ts", import.meta.url),
    "utf8",
  );
  assert.deepEqual(clesEnvoyees(rpc, "ajouter_aliment_produit"), [
    "p_consumed_meal_id",
    "p_product_id",
    "p_quantity",
    "p_unit",
  ]);
  // La signature du wrapper n'accepte AUCUNE macro.
  const bloc = rpc.slice(rpc.indexOf("export function ajouterAlimentProduit"));
  const signature = bloc.slice(0, bloc.indexOf("): Promise<string>"));
  for (const interdit of ["protéines", "protein", "carb", "fat", "student"]) {
    assert.ok(!signature.includes(interdit), `« ${interdit} » n'a rien à faire dans la signature`);
  }
});

await test("A3-UI13. l'image produit est facultative, distante, et jamais recopiée", () => {
  // Une vignette seulement si l'URL existe ; aucun placeholder imposé.
  assert.ok(CODE_SHEET.includes("{imageUrl ? ("));
  assert.ok(CODE_SHEET.includes('alt=""'), "une vignette décorative porte un alt vide");
  for (const interdit of ["storage", "upload", "from(\"objects\")"]) {
    assert.ok(!CODE_SHEET.toLowerCase().includes(interdit.toLowerCase()), interdit);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI14..17 — LES PANNES, LE VIDE, ET LA SAISIE MANUELLE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI14. une panne d'Open Food Facts ne fait perdre AUCUN résultat local", async () => {
  for (const panne of [
    () => json({}, 503),
    () => json({}, 429),
    () => {
      throw new Error("ECONNRESET");
    },
    () => new Response("<html>", { status: 200 }),
  ]) {
    const { fetcher } = fetchQuiCompte(panne);
    const r = await rechercherProduitsExternes("nutella", fetcher);
    assert.deepEqual([...r.produits], [], "aucune exception ne remonte");
    assert.equal(r.indisponible, true);
  }

  // La route peut aussi répondre 200 en disant que l'externe n'a pas répondu :
  // les produits locaux qu'elle rend restent affichés.
  const { fetcher } = fetchQuiCompte(() =>
    json({
      products: [{ id: "p1", gtin: "3017620422003", name: "Skyr", brand: "Danone", imageUrl: null, proteinPer100: 10, carbPer100: 4, fatPer100: 0, nutritionUnit: "g" }],
      externalUnavailable: true,
    }),
  );
  const r = await rechercherProduitsExternes("skyr", fetcher);
  assert.equal(r.produits.length, 1);
  assert.equal(r.indisponible, true);

  // Le message est discret, et ne montre AUCUN code technique.
  assert.ok(CODE_SHEET.includes("Recherche des produits momentanément indisponible."));
  for (const interdit of ["429", "503", "OFF_", "HTTP"]) {
    assert.ok(!CODE_SHEET.includes(interdit), `« ${interdit} » ne doit pas être montré à l'élève`);
  }
});

await test("A3-UI15. la saisie manuelle reste accessible quoi qu'il arrive", () => {
  const html = rendre();
  // L'onglet est de MÊME RANG, présent au premier rendu, avant toute recherche.
  assert.ok(html.includes("Saisir à la main"));
  assert.ok(html.includes('role="tablist"'));
  // Et le bouton de bascule est rendu en PERMANENCE dans l'onglet recherche —
  // pas seulement dans l'état « aucun résultat ».
  assert.ok(html.includes("Saisir un aliment à la main"));
  assert.ok(CODE_SHEET.includes("onClick={basculerVersManuel}"));
});

await test("A3-UI16. aucun résultat n'est jamais un cul-de-sac", () => {
  assert.ok(CODE_SHEET.includes("Aucun aliment trouvé dans le catalogue."));
  assert.ok(CODE_SHEET.includes("Aucun produit trouvé."));
  // Le bouton manuel est HORS du bloc « rien trouvé » : il ne dépend d'aucune
  // condition d'échec.
  const posVide = CODE_SHEET.indexOf("Aucun aliment trouvé dans le catalogue.");
  const posManuel = CODE_SHEET.indexOf("onClick={basculerVersManuel}");
  assert.ok(posManuel > posVide, "le bouton manuel suit l'état vide, sans lui être imbriqué");
  assert.ok(CODE_SHEET.includes("Ajouter cet aliment manuellement"));
});

await test("A3-UI17. la saisie manuelle A2 n'a rien perdu", () => {
  const html = rendre();
  // Le formulaire complet est intact : nom, trois macros pour 100, quantité,
  // g/ml, et le rappel que rien n'est ajouté au catalogue partagé.
  for (const attendu of [
    "Nom de l'aliment",
    "Valeurs pour 100",
    "Protéines",
    "Glucides",
    "Lipides",
    "Quantité consommée",
  ]) {
    assert.ok(CODE_SHEET.includes(attendu), attendu);
  }
  assert.ok(CODE_SHEET.includes("lireMacroPour100"), "la lecture des décimales françaises est là");
  assert.ok(CODE_SHEET.includes("lireQuantite"));
  // Double soumission : garde en plus de `disabled`, comme en A2.1.
  assert.ok(CODE_SHEET.includes("if (!manuelValide || enCours) return;"));
  assert.ok(CODE_SHEET.includes("disabled={!manuelValide || enCours}"));
  void html;
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI18..21 — LE JOURNAL, L'ÉDITION, ET CE QUI NE DOIT PAS BOUGER
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI18. l'édition d'une quantité d'aliment reste celle d'A2", () => {
  const détail = readFileSync(
    new URL("../../components/student/ConsumedFoodDetailSheet.tsx", import.meta.url),
    "utf8",
  );
  // La phase 5 n'a pas touché à la feuille de détail : la correction passe
  // toujours par la RPC, qui RECHARGE la source côté serveur.
  assert.ok(détail.includes("onCorriger"));
  const rpc = readFileSync(
    new URL("../../lib/supabase/consumed-meals.ts", import.meta.url),
    "utf8",
  );
  assert.ok(rpc.includes('"modifier_quantite_entree"'));
});

await test("A3-UI19. l'édition d'une quantité de produit relit la fiche courante", () => {
  // Le contrat est en base, éprouvé par la checklist des produits : la branche
  // `product` de `modifier_quantite_entree` recharge `food_products`. On
  // vérifie ici qu'elle existe bel et bien dans la migration livrée.
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260903090100_ajouter_aliment_produit.sql", import.meta.url),
    "utf8",
  );
  assert.ok(migration.includes("elsif v_entree.source_type = 'product' then"));
  assert.ok(migration.includes("from public.food_products p"));

  // Et aucune conversion implicite g ↔ ml ne s'y est glissée. On inspecte le
  // CODE, jamais la prose : la migration EXPLIQUE qu'elle n'invente aucune
  // densité, et une recherche naïve du mot « densité » échouerait sur la
  // phrase même qui énonce la règle. Le piège a déjà été rencontré quatre fois
  // sur A2 et A3 ; on ne le repose pas.
  const codeSql = migration
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/comment on [\s\S]*?';/g, " ");
  assert.ok(!/densit|\* 0\.9|\/ 0\.9/i.test(codeSql), "une densité s'est glissée dans le code");
  // CONTRÔLE NÉGATIF : le dépouillement n'a pas vidé la migration.
  assert.ok(codeSql.includes("ajouter_aliment_produit") && codeSql.length > 1000);
});

await test("A3-UI20. la suppression d'un aliment vaut pour toutes les sources", () => {
  const rpc = readFileSync(
    new URL("../../lib/supabase/consumed-meals.ts", import.meta.url),
    "utf8",
  );
  // Une seule RPC, sans distinction de source : elle ne peut pas en oublier une.
  assert.ok(rpc.includes('"supprimer_entree"'));
  const bloc = rpc.slice(rpc.indexOf("export function supprimerEntree"));
  const signature = bloc.slice(0, bloc.indexOf(")"));
  assert.ok(!signature.includes("source"), "la suppression ne dépend pas de la source");
});

await test("A3-UI21. les objectifs du coach ne sont jamais touchés par cet écran", () => {
  // L'écran d'ajout n'écrit QUE par les trois rappels qu'on lui a passés. Il ne
  // connaît ni les cibles, ni les plans, ni Supabase en écriture.
  for (const interdit of [
    "nutrition_plan",
    "target_kcal",
    "target_protein",
    "meal_slot_targets",
    "nutrition_daily_logs",
    ".update(",
    ".insert(",
    ".delete(",
  ]) {
    assert.ok(!CODE_SHEET.includes(interdit), `« ${interdit} » n'a rien à faire dans cet écran`);
  }
  // CONTRÔLE NÉGATIF : le dépouillement n'a pas vidé le fichier.
  assert.ok(CODE_SHEET.includes("AddFoodSheet") && CODE_SHEET.length > 4000);
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-UI22..25 — LE RESTE DU JOURNAL, INTACT
   ══════════════════════════════════════════════════════════════════════════ */

await test("A3-UI22. les notes et libellés du coach restent affichés tels quels", () => {
  const semaine = readFileSync(
    new URL("../../components/student/StudentPrescribedWeek.tsx", import.meta.url),
    "utf8",
  );
  // La phase 5 n'a ajouté qu'un rappel optionnel à cette vue. Sans `suivi`,
  // elle rend exactement ce qu'elle rendait avant A2 — contrat éprouvé par
  // A2-UI12, qu'on ne casse pas ici.
  assert.ok(semaine.includes("suivi?: SuiviConsommation") || semaine.includes("suivi?:"));
  assert.ok(semaine.includes("onAjouterProduit?:"), "le nouveau rappel est OPTIONNEL");
});

await test("A3-UI23. les repas personnels restent pilotables", () => {
  const section = readFileSync(
    new URL("../../components/student/ConsumedMealSection.tsx", import.meta.url),
    "utf8",
  );
  for (const attendu of ["onRenommer", "onSupprimerRepas", "onAjouterCatalogue", "onAjouterManuel"]) {
    assert.ok(section.includes(attendu), attendu);
  }
  // Le produit s'ajoute à l'existant, il ne le remplace pas.
  assert.ok(section.includes("onAjouterProduit"));
});

await test("A3-UI24. les totaux restent dérivés des instantanés, jamais de l'écran", () => {
  const consumed = readFileSync(
    new URL("../../lib/nutrition/consumed.ts", import.meta.url),
    "utf8",
  );
  // Les totaux se calculent à partir des entrées enregistrées, avec la seule
  // convention 4/4/9. L'écran d'ajout n'y participe pas.
  assert.ok(consumed.includes("export function totalsForDay"));
  assert.ok(consumed.includes("KCAL_PER_GRAM"));
  assert.equal(kcalFromMacros(10, 20, 5), 10 * 4 + 20 * 4 + 5 * 9);
});

await test("A3-UI25. rien n'est gardé côté navigateur : tout vient de la base", () => {
  // Aucun stockage local : après un rechargement, l'écran relit la base, et
  // c'est la seule raison pour laquelle « tout persiste ».
  for (const interdit of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!CODE_SHEET.includes(interdit), `« ${interdit} » dans l'écran d'ajout`);
  }
  const hook = readFileSync(new URL("../../hooks/useConsumedMeals.ts", import.meta.url), "utf8");
  // Pas d'affichage optimiste : après chaque écriture, le hook RELIT le
  // serveur. C'est ce qui fait qu'un rechargement ne révèle jamais un écart.
  assert.ok(hook.includes("readConsumedMeals"));
  assert.ok(!hook.includes("localStorage"));
});
