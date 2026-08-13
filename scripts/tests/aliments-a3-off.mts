/**
 * Harnais — ALIMENTS A3 PHASE 3 : LA COUCHE SERVEUR OPEN FOOD FACTS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUN APPEL RÉSEAU, JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Cette suite ne joint PAS Open Food Facts. Pas une fois, pas « seulement pour
 * le test de bout en bout ». Trois raisons, toutes vérifiées sur le terrain :
 *
 *   - OFF limite à 15 requêtes/minute par IP et bannit les récidivistes. Une
 *     CI qui rejoue la suite à chaque commit finirait par faire bannir l'IP de
 *     la CI — puis, un jour, celle du serveur ;
 *   - un test qui dépend d'un tiers échoue quand le tiers tousse. Un rouge qui
 *     ne veut rien dire finit par être ignoré, y compris le jour où il veut
 *     dire quelque chose ;
 *   - les cas qui comptent le plus ne sont pas provocables à la demande :
 *     « fiche vieille de cinq semaines ET OFF en panne » ne s'obtient pas en
 *     attendant.
 *
 * Le transport est donc INJECTÉ, et les réponses sont des fixtures. La seule
 * mesure réelle de l'endpoint est faite à la main, hors CI, par
 * `scripts/open-food-facts/sonder-off.mts` — et elle est documentée, pas
 * automatisée.
 *
 * Lancement : npm run test:aliments-a3-off
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  OFF_API_VERSION,
  OFF_ATTRIBUTION,
  OFF_CACHE_TTL_JOURS,
  OFF_CACHE_TTL_MS,
  OFF_ERREURS,
  OFF_FIELDS,
  OFF_USER_AGENT_ENV,
  OffErreur,
  cacheEstFrais,
  erreurEstTemporaire,
  estOffErreur,
  exigerGtin,
  gtinEstValide,
  kcalPour100,
  lireNombre,
  lireNutriments,
  lireQuantiteNette,
  lireUniteNutritionnelle,
  normaliserGtin,
  urlLookupProduit,
  versProduitSeth,
} from "../../lib/open-food-facts/contrat";
import { chercherProduitParGtin, estOffNonConfigure, userAgentOff } from "../../lib/open-food-facts/client";
import { resoudreProduitParGtin } from "../../lib/open-food-facts/resolution";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures — copiées de réponses RÉELLES mesurées le 13/08/2026, puis figées.
// ────────────────────────────────────────────────────────────────────────────
/** Réponse de succès, forme v3.4 exacte (champs restreints). */
const REPONSE_SUCCES = {
  code: "3017620422003",
  status: "success",
  result: { id: "product_found", lc_name: "Product found", name: "Product found" },
  errors: [],
  warnings: [],
  product: {
    code: "3017620422003",
    product_name: "Nutella",
    brands: "Ferrero",
    quantity: "",
    nutrition_data_per: "100g",
    nutriments: {
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      // Présent chez OFF, et délibérément IGNORÉ : SETH dérive ses kcal.
      "energy-kcal_100g": 539,
    },
    // Bloc SÉPARÉ d'estimations. Le confondre avec `nutriments` remplirait la
    // base de valeurs calculées par un tiers.
    nutriments_estimated: { proteins_100g: 99, carbohydrates_100g: 99, fat_100g: 99 },
    image_front_url: "https://images.openfoodfacts.org/front_fr.jpg",
    ingredients_text: "Sucre, huile de palme, noisettes",
    allergens_tags: ["en:milk", "en:nuts", "en:soybeans"],
  },
};

/** Produit absent — v3 rend 404 avec ce corps (mesuré). */
const REPONSE_ABSENT = {
  code: "00000000",
  status: "failure",
  result: { id: "product_not_found", lc_name: "Product not found", name: "Product not found" },
  errors: [{ field: { id: "code" }, message: { id: "product_not_found" } }],
  warnings: [],
};

function reponse(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

/** Un transport de test qui COMPTE ses appels : c'est ce qui prouve le local-first. */
function transportQuiCompte(fabrique: () => Promise<Response>) {
  const état = { appels: 0, dernierUrl: "", dernierUserAgent: "" };
  const transport = async (url: string, init: RequestInit) => {
    état.appels += 1;
    état.dernierUrl = url;
    const entetes = init.headers as Record<string, string>;
    état.dernierUserAgent = entetes["User-Agent"] ?? "";
    return fabrique();
  };
  return { état, transport };
}

function avecUserAgent<T>(valeur: string | undefined, action: () => T): T {
  const avant = process.env[OFF_USER_AGENT_ENV];
  if (valeur === undefined) delete process.env[OFF_USER_AGENT_ENV];
  else process.env[OFF_USER_AGENT_ENV] = valeur;
  try {
    return action();
  } finally {
    if (avant === undefined) delete process.env[OFF_USER_AGENT_ENV];
    else process.env[OFF_USER_AGENT_ENV] = avant;
  }
}

function lireFichier(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * Retire la PROSE avant d'y chercher un mot interdit.
 *
 * Le piège a été rencontré trois fois sur A2 et A3 : une assertion « le mot X
 * n'apparaît pas » échoue à cause de la PHRASE MÊME qui énonce la règle. Ici,
 * `client.ts` explique qu'il ne fabrique aucun repli de User-Agent — et
 * contient donc le mot « repli ». Les commentaires partent ; le code reste.
 */
function sansProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF1 — LA VERSION D'API EST ÉPINGLÉE, EN UN SEUL ENDROIT
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF1 · la version d'API est épinglée à v3.4 et vit dans une constante unique", () => {
  assert.equal(OFF_API_VERSION, "v3.4");

  const url = urlLookupProduit("3017620422003");
  assert.ok(url.includes("/api/v3.4/product/3017620422003"), url);
  assert.ok(url.startsWith("https://world.openfoodfacts.org/"), url);

  // Aucun autre fichier du dépôt ne doit écrire une version d'API OFF en dur :
  // deux endroits, c'est deux versions le jour où l'une change.
  const enDur: string[] = [];
  for (const dossier of ["../../lib", "../../app", "../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      if (chemin.endsWith("lib/open-food-facts/contrat.ts")) continue;
      const source = sansProse(readFileSync(chemin, "utf8"));
      if (/\/api\/v\d(\.\d+)?\//.test(source)) enDur.push(chemin);
    }
  }
  assert.deepEqual(enDur, [], `version d'API OFF écrite en dur hors de contrat.ts : ${enDur.join(", ")}`);
});

function fichiersTs(racine: URL): string[] {
  const sortie: string[] = [];
  let entrées: import("node:fs").Dirent<string>[];
  try {
    entrées = readdirSync(racine, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return sortie;
  }
  for (const entrée of entrées) {
    if (entrée.name === "node_modules" || entrée.name.startsWith(".")) continue;
    const enfant = new URL(entrée.name + (entrée.isDirectory() ? "/" : ""), racine);
    if (entrée.isDirectory()) sortie.push(...fichiersTs(enfant));
    else if (/\.(ts|tsx|mts)$/.test(entrée.name)) sortie.push(enfant.pathname);
  }
  return sortie;
}

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF2 — LE NAVIGATEUR NE PARLE JAMAIS À OPEN FOOD FACTS
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF2 · tout ce qui touche au réseau OFF est marqué server-only", () => {
  for (const fichier of [
    "../../lib/open-food-facts/client.ts",
    "../../lib/open-food-facts/resolution.ts",
    "../../lib/supabase/food-products.ts",
  ]) {
    const source = lireFichier(fichier);
    assert.ok(
      /^import "server-only";/m.test(source),
      `${fichier} doit commencer par import "server-only"`,
    );
  }

  // Le module de CONTRAT, lui, ne doit PAS l'être : il est pur, et c'est ce
  // qui permet de l'éprouver ici sans monter un serveur.
  const contrat = lireFichier("../../lib/open-food-facts/contrat.ts");
  assert.ok(!contrat.includes('"server-only"'), "contrat.ts doit rester importable partout");
  assert.ok(!/\bfetch\s*\(/.test(sansProse(contrat)), "contrat.ts ne doit contenir aucun appel réseau");

  // Aucun composant client ne doit connaître l'adresse d'OFF.
  const fautifs: string[] = [];
  for (const dossier of ["../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      const source = sansProse(readFileSync(chemin, "utf8"));
      // ⚠️ AFFINÉ EN PHASE 5. L'écran d'ajout porte désormais l'attribution
      // ODbL, qui EXIGE un lien vers openfoodfacts.org : l'interdire
      // reviendrait à interdire de respecter la licence. Ce qui reste
      // interdit est ce que l'UI ne doit pas connaître — les adresses d'API.
      if (/world\.openfoodfacts\.org|search\.openfoodfacts|\/api\/v\d/.test(source)) {
        fautifs.push(chemin);
      }
    }
  }
  assert.deepEqual(fautifs, [], `un composant client cite Open Food Facts : ${fautifs.join(", ")}`);

  // CONTRÔLE NÉGATIF du dépouillement : si `sansProse` vidait les fichiers,
  // les deux assertions ci-dessus passeraient sans rien prouver.
  const témoin = sansProse(lireFichier("../../lib/open-food-facts/client.ts"));
  assert.ok(témoin.includes("chercherProduitParGtin"), "sansProse a vidé le fichier : le contrôle ne prouve rien");
  assert.ok(témoin.length > 800, `sansProse a trop retiré (${témoin.length} caractères restants)`);
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF3 — LES CHAMPS SONT RESTREINTS, ET `nutriments_estimated` IGNORÉ
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF3 · la requête restreint les champs, et les estimations ne sont jamais lues", () => {
  const url = urlLookupProduit("3017620422003");
  assert.ok(url.includes("fields="), url);
  for (const champ of ["nutriments", "product_name", "allergens_tags"]) {
    assert.ok(OFF_FIELDS.includes(champ as never), `${champ} doit être demandé`);
  }
  assert.ok(!OFF_FIELDS.includes("nutriments_estimated" as never), "les estimations ne se demandent pas");

  // OFF renvoie quand même `nutriments_estimated` (sélection par préfixe). La
  // fixture en contient un à 99 partout : si la lecture le confondait avec
  // `nutriments`, les macros vaudraient 99 au lieu de 6,3 / 57,5 / 30,9.
  const produit = versProduitSeth("3017620422003", REPONSE_SUCCES);
  assert.equal(produit.proteinPer100, 6.3);
  assert.equal(produit.carbPer100, 57.5);
  assert.equal(produit.fatPer100, 30.9);

  const source = sansProse(lireFichier("../../lib/open-food-facts/contrat.ts"));
  assert.ok(!source.includes("nutriments_estimated"), "aucune lecture de nutriments_estimated dans le code");
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF4 — LE CODE-BARRES EST VALIDÉ, JAMAIS RÉPARÉ
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF4 · un GTIN hors forme est refusé sans être corrigé", () => {
  for (const valide of ["20000015", "012345678905", "3017620422003", "10012345678902"]) {
    assert.ok(gtinEstValide(valide), valide);
  }
  for (const invalide of ["12345", "123456789", "12345678901", "301762042200X", "", "  "]) {
    assert.ok(!gtinEstValide(invalide.trim()), invalide);
  }

  // Les zéros de tête sont préservés, et le code n'est ni complété ni tronqué.
  assert.equal(normaliserGtin("  0000000000017  "), "0000000000017");
  assert.equal(exigerGtin("0000000000017"), "0000000000017");
  assert.notEqual(exigerGtin("0000000000017"), "17");

  const erreur = (() => {
    try {
      exigerGtin("12345");
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(estOffErreur(erreur));
  assert.equal((erreur as OffErreur).code, "INVALID_GTIN");
});

test("A3-OFF4 · un GTIN hors forme ne consomme AUCUN appel réseau", async () => {
  const { état, transport } = transportQuiCompte(async () => reponse(REPONSE_SUCCES));
  await avecUserAgent("SETH/1.0 (test@test.invalid)", async () => {
    await assert.rejects(
      () => chercherProduitParGtin("12345", { transport }),
      (e: unknown) => estOffErreur(e) && e.code === "INVALID_GTIN",
    );
  });
  assert.equal(état.appels, 0, "le refus doit précéder l'appel, pour ne pas brûler le quota OFF");
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF5 — UN PRODUIT TROUVÉ DEVIENT UN DTO SETH
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF5 · une réponse v3.4 de succès devient un DTO SETH complet", () => {
  const produit = versProduitSeth("3017620422003", REPONSE_SUCCES);
  assert.equal(produit.gtin, "3017620422003");
  assert.equal(produit.productName, "Nutella");
  assert.equal(produit.brand, "Ferrero");
  assert.equal(produit.nutritionUnit, "g");
  assert.equal(produit.source, "open_food_facts");
  assert.equal(produit.sourceVersion, "v3.4");
  assert.deepEqual([...produit.allergensDeclared], ["en:milk", "en:nuts", "en:soybeans"]);
  assert.equal(produit.ingredientsText, "Sucre, huile de palme, noisettes");

  // `quantity: ""` — mesuré sur le produit réel. Une chaîne vide n'est PAS une
  // quantité nette : elle reste inconnue, elle ne devient pas zéro.
  assert.equal(produit.netQuantity, null);
  assert.equal(produit.netUnit, null);

  // L'image reste une URL. Aucune copie n'est faite : elle est sous CC BY-SA.
  assert.equal(produit.imageUrl, "https://images.openfoodfacts.org/front_fr.jpg");
  const source = sansProse(lireFichier("../../lib/supabase/food-products.ts"));
  assert.ok(!/storage|upload|from\("objects"\)/i.test(source), "aucune copie d'image dans Storage");
});

test("A3-OFF5 · une image en clair est écartée, jamais servie telle quelle", () => {
  const produit = versProduitSeth("3017620422003", {
    ...REPONSE_SUCCES,
    product: { ...REPONSE_SUCCES.product, image_front_url: "http://images.openfoodfacts.org/x.jpg" },
  });
  assert.equal(produit.imageUrl, null);
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF6 — LES KCAL SONT DÉRIVÉES 4/4/9, JAMAIS REPRISES
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF6 · kcalPer100 est calculé par SETH et ignore energy-kcal_100g", () => {
  const produit = versProduitSeth("3017620422003", REPONSE_SUCCES);
  const attendu = 6.3 * 4 + 57.5 * 4 + 30.9 * 9;
  assert.equal(produit.kcalPer100, attendu);

  // La fixture publie 539 kcal — la valeur d'OFF. SETH en trouve ~533,3 : les
  // deux conventions diffèrent, et c'est justement pourquoi il ne faut en
  // garder qu'une. Le contrôle serait vide si les deux tombaient d'accord.
  assert.notEqual(produit.kcalPer100, 539);
  assert.equal(kcalPour100(0, 0, 0), 0);
  assert.equal(kcalPour100(10, 20, 5), 10 * 4 + 20 * 4 + 5 * 9);

  // Et aucune colonne d'énergie n'est écrite en base.
  const migration = lireFichier("../../supabase/migrations/20260903090000_food_products.sql");
  const sansCommentaires = migration
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/comment on [\s\S]*?';/g, " ");
  assert.ok(!/kcal|energy|calor/i.test(sansCommentaires), "aucune colonne d'énergie dans la migration");
  // CONTRÔLE NÉGATIF : le dépouillement n'a pas vidé la migration.
  assert.ok(sansCommentaires.includes("create table if not exists public.food_products"));
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF7 / A3-OFF8 — ABSENT ≠ ZÉRO, ET ZÉRO EST UNE VALEUR
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF7 · une macro manquante refuse le produit, elle ne devient pas zéro", () => {
  for (const manquante of ["proteins_100g", "carbohydrates_100g", "fat_100g"]) {
    const nutriments: Record<string, unknown> = {
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
    };
    delete nutriments[manquante];
    assert.equal(lireNutriments(nutriments), null, `${manquante} manquante doit refuser`);

    assert.throws(
      () => versProduitSeth("3017620422003", {
        ...REPONSE_SUCCES,
        product: { ...REPONSE_SUCCES.product, nutriments },
      }),
      (e: unknown) => estOffErreur(e) && e.code === "PRODUCT_NUTRITION_INCOMPLETE",
    );
  }

  // Chaîne vide, null, NaN : autant de formes de « je ne sais pas ».
  assert.equal(lireNombre(""), null);
  assert.equal(lireNombre("   "), null);
  assert.equal(lireNombre(null), null);
  assert.equal(lireNombre(undefined), null);
  assert.equal(lireNombre("abc"), null);
  assert.equal(lireNombre(Number.NaN), null);
  assert.equal(lireNombre(Number.POSITIVE_INFINITY), null);
});

test("A3-OFF8 · un 0 explicite est une valeur, et il est conservé", () => {
  assert.equal(lireNombre(0), 0);
  assert.equal(lireNombre("0"), 0);

  const produit = versProduitSeth("5449000000996", {
    ...REPONSE_SUCCES,
    product: {
      ...REPONSE_SUCCES.product,
      product_name: "Boisson",
      nutriments: { proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
    },
  });
  assert.equal(produit.proteinPer100, 0);
  assert.equal(produit.fatPer100, 0);
  assert.equal(produit.carbPer100, 10.6);

  // Une macro NÉGATIVE, elle, n'est pas une valeur : c'est une donnée fausse.
  assert.equal(lireNutriments({ proteins_100g: -1, carbohydrates_100g: 1, fat_100g: 1 }), null);
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF9 — LE PRODUIT SANS NUTRITION EST REFUSÉ PROPREMENT
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF9 · no_nutrition_data et le nom manquant refusent proprement", () => {
  assert.throws(
    () => versProduitSeth("3017620422003", {
      ...REPONSE_SUCCES,
      product: { ...REPONSE_SUCCES.product, no_nutrition_data: "on" },
    }),
    (e: unknown) => estOffErreur(e) && e.code === "PRODUCT_NUTRITION_INCOMPLETE",
  );

  assert.throws(
    () => versProduitSeth("3017620422003", {
      ...REPONSE_SUCCES,
      product: { ...REPONSE_SUCCES.product, product_name: "  " },
    }),
    (e: unknown) => estOffErreur(e) && e.code === "PRODUCT_NUTRITION_INCOMPLETE",
  );

  // Le vocabulaire d'erreurs est FERMÉ : six codes, pas un de plus.
  assert.deepEqual([...OFF_ERREURS], [
    "INVALID_GTIN",
    "PRODUCT_NOT_FOUND",
    "PRODUCT_NUTRITION_INCOMPLETE",
    "OFF_RATE_LIMITED",
    "OFF_UNAVAILABLE",
    "OFF_INVALID_RESPONSE",
  ]);

  // Et la distinction qui gouverne le repli sur le cache périmé.
  assert.equal(erreurEstTemporaire("OFF_UNAVAILABLE"), true);
  assert.equal(erreurEstTemporaire("OFF_RATE_LIMITED"), true);
  assert.equal(erreurEstTemporaire("OFF_INVALID_RESPONSE"), true);
  assert.equal(erreurEstTemporaire("PRODUCT_NOT_FOUND"), false);
  assert.equal(erreurEstTemporaire("PRODUCT_NUTRITION_INCOMPLETE"), false);
  assert.equal(erreurEstTemporaire("INVALID_GTIN"), false);
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF10 — LES PANNES D'OFF DEVIENNENT DES ERREURS SETH
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF10 · chaque panne OFF est traduite dans le vocabulaire SETH", async () => {
  const cas: ReadonlyArray<{ nom: string; fabrique: () => Promise<Response>; code: string }> = [
    { nom: "404", fabrique: async () => reponse(REPONSE_ABSENT, 404), code: "PRODUCT_NOT_FOUND" },
    { nom: "429", fabrique: async () => reponse({}, 429), code: "OFF_RATE_LIMITED" },
    { nom: "503", fabrique: async () => reponse({}, 503), code: "OFF_UNAVAILABLE" },
    { nom: "500", fabrique: async () => reponse({}, 500), code: "OFF_UNAVAILABLE" },
    {
      nom: "JSON illisible",
      fabrique: async () => new Response("<html>maintenance</html>", { status: 200 }),
      code: "OFF_INVALID_RESPONSE",
    },
    {
      nom: "réseau coupé",
      fabrique: async () => {
        throw new Error("ECONNRESET");
      },
      code: "OFF_UNAVAILABLE",
    },
    {
      nom: "statut inconnu",
      fabrique: async () => reponse({ status: "quelque_chose_de_neuf", product: {} }),
      code: "OFF_INVALID_RESPONSE",
    },
  ];

  for (const c of cas) {
    const { transport } = transportQuiCompte(c.fabrique);
    await avecUserAgent("SETH/1.0 (test@test.invalid)", async () => {
      await assert.rejects(
        () => chercherProduitParGtin("3017620422003", { transport }),
        (e: unknown) => estOffErreur(e) && e.code === c.code,
        `${c.nom} doit donner ${c.code}`,
      );
    });
  }
});

test("A3-OFF10 · un succès traverse le transport et rend le DTO", async () => {
  const { état, transport } = transportQuiCompte(async () => reponse(REPONSE_SUCCES));
  const produit = await avecUserAgent("SETH/1.0 (test@test.invalid)", () =>
    chercherProduitParGtin("3017620422003", { transport }),
  );
  assert.equal(produit.productName, "Nutella");
  assert.equal(état.appels, 1);
  assert.ok(état.dernierUrl.includes("/api/v3.4/product/3017620422003"));
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF11 — LE USER-AGENT EST EXIGÉ, SANS REPLI SILENCIEUX
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF11 · sans OPENFOODFACTS_USER_AGENT, l'appel échoue au lieu de se déguiser", async () => {
  const { état, transport } = transportQuiCompte(async () => reponse(REPONSE_SUCCES));

  await avecUserAgent(undefined, async () => {
    await assert.rejects(
      () => chercherProduitParGtin("3017620422003", { transport }),
      (e: unknown) => estOffNonConfigure(e),
    );
  });
  assert.equal(état.appels, 0, "aucun appel ne doit partir sans User-Agent");

  // Une variable présente mais vide, ou pleine d'espaces, n'est pas une valeur.
  await avecUserAgent("   ", async () => {
    await assert.rejects(
      () => chercherProduitParGtin("3017620422003", { transport }),
      (e: unknown) => estOffNonConfigure(e),
    );
  });

  // Quand elle est là, elle part telle quelle dans l'en-tête.
  const { état: état2, transport: transport2 } = transportQuiCompte(async () => reponse(REPONSE_SUCCES));
  await avecUserAgent("SETH/1.0 (contact@example.invalid)", () =>
    chercherProduitParGtin("3017620422003", { transport: transport2 }),
  );
  assert.equal(état2.dernierUserAgent, "SETH/1.0 (contact@example.invalid)");

  // CONTRÔLE NÉGATIF : aucun User-Agent de repli n'est écrit dans le code.
  const source = sansProse(lireFichier("../../lib/open-food-facts/client.ts"));
  assert.ok(!/SETH\/\d/.test(source), "un User-Agent de repli est écrit en dur dans client.ts");
  assert.ok(source.includes("OffNonConfigure"), "sansProse a vidé le fichier : le contrôle ne prouve rien");

  // Et le secret n'est pas dans le dépôt : seul le NOM de la variable y est.
  avecUserAgent(undefined, () => {
    assert.throws(() => userAgentOff(), (e: unknown) => estOffNonConfigure(e));
  });
  assert.equal(OFF_USER_AGENT_ENV, "OPENFOODFACTS_USER_AGENT");
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF12 — LE TTL EST DE 30 JOURS, DÉFINI UNE SEULE FOIS
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF12 · le TTL vaut 30 jours et n'est écrit qu'à un seul endroit", () => {
  assert.equal(OFF_CACHE_TTL_JOURS, 30);
  assert.equal(OFF_CACHE_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  const maintenant = new Date("2026-08-13T12:00:00.000Z");
  const jours = (n: number) => new Date(maintenant.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(cacheEstFrais(jours(0), maintenant), true);
  assert.equal(cacheEstFrais(jours(29), maintenant), true);
  // La frontière exacte : 30 jours pile n'est plus frais.
  assert.equal(cacheEstFrais(jours(30), maintenant), false);
  assert.equal(cacheEstFrais(jours(45), maintenant), false);
  // Une date FUTURE est une anomalie, pas une fraîcheur éternelle.
  assert.equal(cacheEstFrais(new Date(maintenant.getTime() + 60_000), maintenant), false);
  assert.equal(cacheEstFrais("pas une date", maintenant), false);

  // Le délai n'est pas redéfini ailleurs — ni dans la route, ni dans le cache.
  //
  // Le balayage vise les fichiers qui PARLENT de produits ou d'Open Food Facts,
  // et pas tout le dépôt : `lib/newsletter/tokens.ts` a sa propre durée de
  // trente jours, sans le moindre rapport avec ce cache. Une assertion qui
  // l'aurait attrapée n'aurait pas signalé un défaut — elle aurait signalé que
  // deux nombres se ressemblent.
  const fautifs: string[] = [];
  for (const dossier of ["../../lib", "../../app", "../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      if (chemin.endsWith("lib/open-food-facts/contrat.ts")) continue;
      const brut = readFileSync(chemin, "utf8");
      if (!/open-food-facts|food_products|openfoodfacts/i.test(brut)) continue;
      const source = sansProse(brut);
      if (/30\s*\*\s*24\s*\*\s*60/.test(source) || /\b2592000\b/.test(source)) fautifs.push(chemin);
    }
  }
  assert.deepEqual(fautifs, [], `le TTL est redéfini hors de contrat.ts : ${fautifs.join(", ")}`);

  // CONTRÔLE NÉGATIF du balayage : il doit bien voir les fichiers concernés,
  // sinon la liste vide ci-dessus ne prouverait que sa propre cécité.
  const concernés = ["../../lib", "../../app"]
    .flatMap((d) => fichiersTs(new URL(d + "/", import.meta.url)))
    .filter((c) => /open-food-facts|food_products|openfoodfacts/i.test(readFileSync(c, "utf8")));
  assert.ok(
    concernés.some((c) => c.endsWith("lib/supabase/food-products.ts")) &&
      concernés.some((c) => c.includes("api/food-products/")),
    `le balayage ne voit pas les fichiers concernés : ${concernés.join(", ")}`,
  );

  const migration = lireFichier("../../supabase/migrations/20260903090000_food_products.sql")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/comment on [\s\S]*?';/g, " ");
  assert.ok(!/interval\s*'30/i.test(migration), "le TTL ne doit pas être redéfini en SQL");
  assert.ok(migration.includes("source_fetched_at"), "la migration stocke bien la date");
});

// ────────────────────────────────────────────────────────────────────────────
// A3-OFF13..16 — LA RÉSOLUTION : LOCAL D'ABORD, ET LE CONTRAT « PÉRIMÉ »
// ────────────────────────────────────────────────────────────────────────────
const PRODUIT_SETH = versProduitSeth("3017620422003", REPONSE_SUCCES);

function fausseFiche(stale: boolean, proteine = 6.3) {
  return {
    ...PRODUIT_SETH,
    proteinPer100: proteine,
    id: "70000000-0000-4000-8000-000000000001",
    fetchedAt: "2026-07-01T00:00:00.000Z",
    // Phase 4.1 : une fiche « fraîche » est une fiche HYDRATÉE récemment.
    detailFetchedAt: stale ? "2026-06-01T00:00:00.000Z" : "2026-08-13T00:00:00.000Z",
    hydratee: true,
    stale,
  };
}

test("A3-OFF13 · une fiche fraîche est servie SANS aucun appel réseau", async () => {
  let appelsOff = 0;
  let écritures = 0;
  const produit = await resoudreProduitParGtin("3017620422003", {
    lireCache: async () => ({ produit: fausseFiche(false), detailFrais: true }),
    interrogerOff: async () => {
      appelsOff += 1;
      return { produit: PRODUIT_SETH, brut: PRODUIT_SETH };
    },
    ecrireCache: async () => {
      écritures += 1;
      return fausseFiche(false);
    },
  });

  assert.equal(appelsOff, 0, "le cache frais doit court-circuiter le réseau");
  assert.equal(écritures, 0, "et ne rien réécrire");
  assert.equal(produit.stale, false);
  assert.equal(produit.id, "70000000-0000-4000-8000-000000000001");
});

test("A3-OFF14 · fiche PÉRIMÉE + OFF en panne : la copie est servie, marquée stale", async () => {
  for (const code of ["OFF_UNAVAILABLE", "OFF_RATE_LIMITED", "OFF_INVALID_RESPONSE"] as const) {
    const produit = await resoudreProduitParGtin("3017620422003", {
      lireCache: async () => ({ produit: fausseFiche(true, 5.5), detailFrais: false }),
      interrogerOff: async () => {
        throw new OffErreur(code);
      },
      ecrireCache: async () => null,
    });
    assert.equal(produit.stale, true, `${code} doit servir la copie datée`);
    assert.equal(produit.proteinPer100, 5.5, "et rendre les valeurs de la copie, pas des valeurs neuves");
    assert.equal(produit.fetchedAt, "2026-07-01T00:00:00.000Z");
  }
});

test("A3-OFF14 · fiche périmée + OFF disponible : elle est rafraîchie et n'est plus stale", async () => {
  let écritures = 0;
  const produit = await resoudreProduitParGtin("3017620422003", {
    lireCache: async () => ({ produit: fausseFiche(true, 5.5), detailFrais: false }),
    interrogerOff: async () => ({ produit: PRODUIT_SETH, brut: PRODUIT_SETH }),
    ecrireCache: async () => {
      écritures += 1;
      return fausseFiche(false, 6.3);
    },
  });
  assert.equal(écritures, 1);
  assert.equal(produit.stale, false);
  assert.equal(produit.proteinPer100, 6.3);
});

test("A3-OFF15 · produit inconnu + OFF en panne : erreur franche, rien d'inventé", async () => {
  await assert.rejects(
    () =>
      resoudreProduitParGtin("3017620422003", {
        lireCache: async () => null,
        interrogerOff: async () => {
          throw new OffErreur("OFF_UNAVAILABLE");
        },
        ecrireCache: async () => null,
      }),
    (e: unknown) => estOffErreur(e) && e.code === "OFF_UNAVAILABLE",
  );

  await assert.rejects(
    () =>
      resoudreProduitParGtin("3017620422003", {
        lireCache: async () => null,
        interrogerOff: async () => {
          throw new OffErreur("PRODUCT_NOT_FOUND");
        },
        ecrireCache: async () => null,
      }),
    (e: unknown) => estOffErreur(e) && e.code === "PRODUCT_NOT_FOUND",
  );
});

test("A3-OFF16 · produit démenti par la source : PAS de repli sur la copie périmée", async () => {
  // La distinction qui compte. OFF ne « tousse » pas : il RÉPOND que le
  // produit n'existe plus, ou que sa fiche est devenue inexploitable. Servir
  // une copie que la source vient de démentir serait pire que de ne rien
  // servir — et l'élève ajouterait un aliment sur la foi d'une fiche morte.
  for (const code of ["PRODUCT_NOT_FOUND", "PRODUCT_NUTRITION_INCOMPLETE"] as const) {
    await assert.rejects(
      () =>
        resoudreProduitParGtin("3017620422003", {
          lireCache: async () => ({ produit: fausseFiche(true), detailFrais: false }),
          interrogerOff: async () => {
            throw new OffErreur(code);
          },
          ecrireCache: async () => null,
        }),
      (e: unknown) => estOffErreur(e) && e.code === code,
      `${code} ne doit PAS se replier sur la copie périmée`,
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Contrôles complémentaires — unités, densité, allergènes, périmètre
// ────────────────────────────────────────────────────────────────────────────
test("A3-OFF-SUP · l'unité nutritionnelle est lue, jamais convertie", () => {
  assert.equal(lireUniteNutritionnelle({ nutrition_data_per: "100g" }), "g");
  assert.equal(lireUniteNutritionnelle({ nutrition_data_per: "100ml" }), "ml");
  assert.equal(lireUniteNutritionnelle({ product_quantity_unit: "ml" }), "ml");
  assert.equal(lireUniteNutritionnelle({ product_quantity_unit: "l" }), "ml");
  assert.equal(lireUniteNutritionnelle({}), "g");

  // La quantité nette : seules g et ml sont reprises. Les litres et les kilos
  // ne sont PAS convertis — cette conversion-là n'a jamais été mesurée sur des
  // données réelles, et une conversion non mesurée est une invention.
  assert.deepEqual(lireQuantiteNette({ product_quantity: "400", product_quantity_unit: "g" }), {
    valeur: 400,
    unite: "g",
  });
  assert.equal(lireQuantiteNette({ product_quantity: "1", product_quantity_unit: "l" }), null);
  assert.equal(lireQuantiteNette({ product_quantity: "0", product_quantity_unit: "g" }), null);
  assert.equal(lireQuantiteNette({ product_quantity_unit: "g" }), null);

  // Aucune densité nulle part.
  const sources = [
    "../../lib/open-food-facts/contrat.ts",
    "../../lib/open-food-facts/client.ts",
    "../../lib/supabase/food-products.ts",
  ].map((f) => sansProse(lireFichier(f)));
  for (const source of sources) {
    assert.ok(!/densit|density|0\.9\d*\s*\*|\*\s*1\.0[0-9]/i.test(source), "une densité s'est glissée dans le code");
  }
});

test("A3-OFF-SUP · les allergènes sont déclaratifs, sans aucun jugement", () => {
  const produit = versProduitSeth("3017620422003", REPONSE_SUCCES);
  assert.deepEqual([...produit.allergensDeclared], ["en:milk", "en:nuts", "en:soybeans"]);
  assert.deepEqual([...versProduitSeth("3017620422003", {
    ...REPONSE_SUCCES,
    product: { ...REPONSE_SUCCES.product, allergens_tags: undefined },
  }).allergensDeclared], []);

  const fautifs: string[] = [];
  for (const fichier of [
    "../../lib/open-food-facts/contrat.ts",
    "../../lib/open-food-facts/client.ts",
    "../../lib/open-food-facts/resolution.ts",
    "../../lib/supabase/food-products.ts",
    "../../app/api/food-products/[gtin]/route.ts",
  ]) {
    const source = sansProse(lireFichier(fichier));
    if (/\b(safe|compatible|dangereux|deconseille|allergique|intolerant)\b/i.test(source)) {
      fautifs.push(fichier);
    }
  }
  assert.deepEqual(fautifs, [], `un jugement sur les allergènes est apparu : ${fautifs.join(", ")}`);

  assert.equal(OFF_ATTRIBUTION.source, "Open Food Facts");
  assert.equal(OFF_ATTRIBUTION.lien, "https://openfoodfacts.org");
  assert.equal(OFF_ATTRIBUTION.licenceBase, "ODbL 1.0");
});

test("A3-OFF-SUP · le périmètre de la phase est tenu : rien de plus n'a été branché", () => {
  // ⚠️ RÉÉCRIT LE 13/08/2026, ET C'EST LA TROISIÈME FOIS QUE CE MOTIF SE
  // PRÉSENTE — après les deux contrôles jumeaux d'A2 et d'A3 phase 2.
  //
  // Ce contrôle interdisait « search.openfoodfacts » PARTOUT dans l'arbre.
  // C'était juste tant que la recherche texte n'existait pas ; la phase 4 l'a
  // branchée, avec autorisation explicite. Le rouge ne disait donc pas que la
  // phase 3 avait débordé : il disait que le contrôle parlait de L'ARBRE
  // ENTIER pour décrire le périmètre D'UNE PHASE.
  //
  // La garantie n'est pas abandonnée. Elle est déplacée là où elle reste
  // vraie : la phase 3 n'a rien branché de la recherche — ses PROPRES
  // fichiers ne la nomment pas —, et Search-a-licious reste confiné à
  // l'unique module de la phase 4 (éprouvé par A3-SEARCH-SUP).
  const MODULE_RECHERCHE = "lib/open-food-facts/recherche.ts";

  // 1. Ce qui reste interdit PARTOUT — et ce qui ne l'est plus.
  //
  //    ⚠️ RÉÉCRIT LE 13/08/2026 (QUATRIÈME OCCURRENCE DU MÊME MOTIF). Ce
  //    contrôle interdisait « ZXing » dans TOUT l'arbre. C'était juste tant que
  //    le scanner n'existait pas ; A4 phase 2 l'a construit, avec autorisation
  //    explicite. Le rouge ne disait donc pas que la phase 3 avait débordé : il
  //    disait, une fois de plus, que le contrôle parlait de L'ARBRE ENTIER pour
  //    décrire le périmètre D'UNE PHASE.
  //
  //    La garantie n'est pas abandonnée, elle est resserrée là où elle reste
  //    vraie : un DÉCODEUR n'a le droit d'exister que dans la couche de scan
  //    d'A4 et dans son banc d'essai temporaire. Qu'il apparaisse dans un
  //    module d'A3, dans une route d'API ou dans un écran d'élève resterait un
  //    débordement — et c'est cela que le contrôle doit continuer à voir.
  //
  //    `BarcodeDetector` et `cgi/search.pl`, eux, restent interdits PARTOUT,
  //    banc d'essai compris : le premier parce qu'A4 a décidé qu'il ne serait
  //    jamais le moteur critique, le second parce que c'est l'endpoint legacy
  //    d'Open Food Facts, que rien ne doit rappeler.
  const COUCHE_SCAN = /(^|\/)(lib\/scan\/[^/]+\.ts|components\/dev\/BancDEssaiScan\.tsx)$/;
  const anticipes: string[] = [];
  // 2. Search-a-licious n'a le droit d'exister que dans SON module.
  const deborde: string[] = [];
  for (const dossier of ["../../lib", "../../app", "../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      const source = sansProse(readFileSync(chemin, "utf8"));
      // `getUserMedia` n'est PAS dans cette liste, et l'y avoir mis un instant
      // a rendu le contrôle rouge sur `lib/feedback-video-capture.ts` : la
      // capture vidéo des retours de séance s'en sert depuis des mois, sans le
      // moindre rapport avec un code-barres. Un mot n'est pas une intention —
      // ce qui trahirait un scanner, c'est un décodeur.
      const cheminRelatif = chemin.replace(/^.*?(?=lib\/|app\/|components\/|hooks\/)/, "");
      if (/BarcodeDetector|cgi\/search\.pl/i.test(source)) anticipes.push(chemin);
      else if (/ZXing/i.test(source) && !COUCHE_SCAN.test(cheminRelatif)) anticipes.push(chemin);
      if (
        /search\.openfoodfacts|search-a-licious/i.test(source) &&
        !chemin.endsWith(MODULE_RECHERCHE)
      ) {
        deborde.push(chemin);
      }
    }
  }
  assert.deepEqual(anticipes, [], `scanner ou endpoint legacy anticipé : ${anticipes.join(", ")}`);
  assert.deepEqual(deborde, [], `Search-a-licious hors de son module : ${deborde.join(", ")}`);

  // 3. Et les fichiers DE LA PHASE 3, eux, n'en parlent toujours pas — c'est
  //    la formulation durable de la garantie d'origine.
  const fautifs: string[] = [];
  for (const fichier of [
    "../../lib/open-food-facts/contrat.ts",
    "../../lib/open-food-facts/client.ts",
    "../../app/api/food-products/[gtin]/route.ts",
    "../../supabase/migrations/20260903090000_food_products.sql",
    "../../supabase/migrations/20260903090100_ajouter_aliment_produit.sql",
  ]) {
    const source = sansProse(lireFichier(fichier));
    if (/search\.openfoodfacts|search-a-licious|BarcodeDetector|ZXing/i.test(source)) {
      fautifs.push(fichier);
    }
  }
  assert.deepEqual(fautifs, [], `hors périmètre de la phase 3 : ${fautifs.join(", ")}`);

  // CONTRÔLE NÉGATIF du balayage : il voit bien les fichiers qu'il prétend lire.
  const balayés = fichiersTs(new URL("../../lib/", import.meta.url));
  assert.ok(
    balayés.some((c) => c.endsWith("lib/open-food-facts/client.ts")),
    "le balayage ne voit pas client.ts : les assertions ci-dessus ne prouvent rien",
  );
  assert.ok(balayés.length > 20, `balayage trop pauvre (${balayés.length} fichiers)`);
});
