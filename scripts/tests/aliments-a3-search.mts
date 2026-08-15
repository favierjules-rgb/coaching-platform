/**
 * Harnais — ALIMENTS A3 PHASE 4 : RECHERCHE TEXTE DE PRODUITS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUN APPEL RÉSEAU, ET LA RAISON EST PLUS FORTE QU'EN PHASE 3
 * ────────────────────────────────────────────────────────────────────────────
 * Open Food Facts limite les RECHERCHES à 10 par minute et par IP — deux fois
 * moins que les lectures produit — et sa documentation dit explicitement de ne
 * pas s'en servir pour une recherche au fil de la frappe, sous peine de
 * blocage rapide. Une CI qui rejouerait vingt cas de recherche à chaque commit
 * ferait bannir son IP en une matinée.
 *
 * Tout est donc joué sur fixtures, avec un transport injecté qui COMPTE ses
 * appels : c'est ce compteur, et non une intention écrite en commentaire, qui
 * prouve que le mode local ne parle à personne (A3-SEARCH19) et que le mode
 * externe ne parle qu'une fois (A3-SEARCH20).
 *
 * La mesure réelle du service vit hors CI, dans
 * `scripts/open-food-facts/sonder-recherche.mts`.
 *
 * Lancement : npm run test:aliments-a3-search
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  OffErreur,
  cacheEstFrais,
  detailEstFrais,
  estOffErreur,
  kcalPour100,
  versProduitSeth,
} from "../../lib/open-food-facts/contrat";
import {
  OFF_SEARCH_FIELDS,
  OFF_SEARCH_URL,
  RECHERCHE_Q_MAX,
  RECHERCHE_Q_MIN,
  RECHERCHE_RESULTATS_MAX,
  chercherProduitsParTexte,
  echapperLucene,
  hitVersFicheProduit,
  lireRequete,
  produitsDepuisReponse,
  urlRechercheProduits,
} from "../../lib/open-food-facts/recherche";
import {
  resoudreProduitParGtin,
  resoudreRechercheProduits,
} from "../../lib/open-food-facts/resolution";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures — forme RÉELLE d'un hit Search-a-licious, mesurée le 13/08/2026.
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ `brands` est un TABLEAU ici, et `nutrition_data_per`, `product_quantity`,
 * `ingredients_text` sont ABSENTS — l'index ne les porte pas, même demandés
 * dans `fields`. La fixture reproduit cette pauvreté à dessein : c'est elle
 * qui rend la fusion non destructive du cache nécessaire.
 */
function hit(
  code: string,
  nom: string | undefined,
  marques: string[] | null,
  nutriments: Record<string, number> | null,
): Record<string, unknown> {
  return {
    code,
    product_name: nom,
    brands: marques,
    nutriments,
    image_front_url: `https://images.openfoodfacts.org/${code}.jpg`,
    allergens_tags: ["en:milk"],
    _score: 1,
  };
}

const PGL = { proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 };

function reponseRecherche(hits: unknown[]): Record<string, unknown> {
  return {
    hits,
    count: hits.length,
    page: 1,
    page_size: 40,
    page_count: 1,
    took: 5,
    timed_out: false,
    is_count_exact: true,
    warnings: null,
  };
}

function reponseHttp(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function transportQuiCompte(fabrique: () => Promise<Response>) {
  const état = { appels: 0, urls: [] as string[] };
  // Le second paramètre du transport (`init`) n'est pas relu ici : ce harnais
  // mesure QUE l'on appelle et COMBIEN de fois, pas avec quels en-têtes — le
  // User-Agent est déjà éprouvé par A3-OFF11. On l'omet plutôt que de le
  // nommer pour ne pas s'en servir.
  const transport = async (url: string) => {
    état.appels += 1;
    état.urls.push(url);
    return fabrique();
  };
  return { état, transport };
}

function avecUserAgent<T>(valeur: string | undefined, action: () => T): T {
  const avant = process.env.OPENFOODFACTS_USER_AGENT;
  if (valeur === undefined) delete process.env.OPENFOODFACTS_USER_AGENT;
  else process.env.OPENFOODFACTS_USER_AGENT = valeur;
  try {
    return action();
  } finally {
    if (avant === undefined) delete process.env.OPENFOODFACTS_USER_AGENT;
    else process.env.OPENFOODFACTS_USER_AGENT = avant;
  }
}

const UA = "SETH/1.0 (test@test.invalid)";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

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

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH1..3 — LES BORNES DE LA REQUÊTE
   ══════════════════════════════════════════════════════════════════════════ */

test("A3-SEARCH1 · une requête vide est refusée", () => {
  for (const vide of ["", "   ", "\t\n", null, undefined, 42]) {
    const lecture = lireRequete(vide);
    assert.equal(lecture.ok, false, `${JSON.stringify(vide)} doit être refusée`);
    if (!lecture.ok) assert.equal(lecture.raison, "vide");
  }

  // ⚠️ Ce contrôle n'est pas une politesse. MESURÉ le 13/08/2026 :
  // `GET /search?q=` rend HTTP 200 avec des produits ARBITRAIRES — le service
  // ne refuse rien. Sans ce garde, une frappe effacée déclencherait une
  // recherche dont les résultats n'auraient aucun rapport avec quoi que ce
  // soit, et l'élève n'aurait aucun moyen de comprendre pourquoi.
});

test("A3-SEARCH2 · une requête trop courte est refusée", () => {
  assert.equal(RECHERCHE_Q_MIN, 3);
  for (const courte of ["a", "ab", " a ", "a  "]) {
    const lecture = lireRequete(courte);
    assert.equal(lecture.ok, false, `« ${courte} » doit être refusée`);
    if (!lecture.ok) assert.ok(lecture.raison === "trop_courte" || lecture.raison === "vide");
  }
  // La borne est mesurée APRÈS nettoyage : « a » suivi d'espaces est court,
  // pas long.
  const limite = lireRequete("abc");
  assert.equal(limite.ok, true);
  if (limite.ok) assert.equal(limite.q, "abc");
});

test("A3-SEARCH3 · une requête trop longue est refusée", () => {
  assert.equal(RECHERCHE_Q_MAX, 80);
  const longue = "a".repeat(RECHERCHE_Q_MAX + 1);
  const lecture = lireRequete(longue);
  assert.equal(lecture.ok, false);
  if (!lecture.ok) assert.equal(lecture.raison, "trop_longue");

  assert.equal(lireRequete("a".repeat(RECHERCHE_Q_MAX)).ok, true, "la borne exacte passe");

  // Les espaces multiples sont réduits : deux frappes du même mot donnent la
  // même requête, et une chaîne d'espaces ne consomme pas la longueur.
  const lecture2 = lireRequete("  skyr   danone  ");
  assert.equal(lecture2.ok, true);
  if (lecture2.ok) assert.equal(lecture2.q, "skyr danone");
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH4..5 — LA RECHERCHE LOCALE
   ══════════════════════════════════════════════════════════════════════════ */

/** Un faux Supabase minimal : il enregistre ce qu'on lui demande, et rend. */
function fauxSupabase(lignes: Record<string, unknown>[]) {
  const vu = { filtres: "", limite: 0, table: "", colonnes: "" };
  const client = {
    from(table: string) {
      vu.table = table;
      return {
        select(colonnes: string) {
          vu.colonnes = colonnes;
          const chaine = {
            or(filtres: string) {
              vu.filtres = filtres;
              return chaine;
            },
            order() {
              return chaine;
            },
            limit(n: number) {
              vu.limite = n;
              return Promise.resolve({ data: lignes, error: null });
            },
            in() {
              return Promise.resolve({ data: lignes, error: null });
            },
          };
          return chaine;
        },
      };
    },
  };
  return { client, vu };
}

function ligne(gtin: string, nom: string, marque: string | null, jours = 0) {
  const date = new Date(Date.now() - jours * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: `id-${gtin}`,
    gtin,
    brand: marque,
    product_name: nom,
    net_quantity: null,
    net_unit: null,
    nutrition_unit: "g",
    protein_per_100: 6.3,
    carb_per_100: 57.5,
    fat_per_100: 30.9,
    image_url: null,
    ingredients_text: null,
    allergens_declared: null,
    source: "open_food_facts",
    source_version: "v3.4",
    source_fetched_at: date,
  };
}

test("A3-SEARCH4 · la recherche locale interroge product_name", async () => {
  const { rechercherProduitsLocaux } = await import("../../lib/supabase/food-products");
  const { client, vu } = fauxSupabase([ligne("3017620422003", "Pate a tartiner", "Ferrero")]);

  const trouves = await rechercherProduitsLocaux(
    client as never,
    "tartiner",
    RECHERCHE_RESULTATS_MAX,
    new Date(),
  );

  assert.equal(vu.table, "food_products");
  assert.ok(vu.filtres.includes("product_name.ilike.%tartiner%"), vu.filtres);
  assert.equal(vu.limite, RECHERCHE_RESULTATS_MAX);
  assert.equal(trouves.length, 1);
  assert.equal(trouves[0].productName, "Pate a tartiner");
  assert.equal(trouves[0].id, "id-3017620422003");
  // Les kcal sont DÉRIVÉES à la lecture, jamais lues d'une colonne.
  assert.equal(trouves[0].kcalPer100, kcalPour100(6.3, 57.5, 30.9));
});

test("A3-SEARCH5 · la recherche locale interroge aussi la marque, et le GTIN à bon escient", async () => {
  const { rechercherProduitsLocaux } = await import("../../lib/supabase/food-products");

  const a = fauxSupabase([ligne("3017620422003", "Pate a tartiner", "Ferrero")]);
  await rechercherProduitsLocaux(a.client as never, "ferrero", 20, new Date());
  assert.ok(a.vu.filtres.includes("brand.ilike.%ferrero%"), a.vu.filtres);
  assert.ok(!a.vu.filtres.includes("gtin"), "un mot n'a pas à être cherché dans les codes-barres");

  // Une suite de chiffres, elle, vise aussi le code-barres.
  const b = fauxSupabase([]);
  await rechercherProduitsLocaux(b.client as never, "3017620422003", 20, new Date());
  assert.ok(b.vu.filtres.includes("gtin.ilike.%3017620422003%"), b.vu.filtres);

  // « 400 » n'est pas un code-barres : c'est un nombre dans un nom de produit.
  const c = fauxSupabase([]);
  await rechercherProduitsLocaux(c.client as never, "400", 20, new Date());
  assert.ok(!c.vu.filtres.includes("gtin"), c.vu.filtres);

  // Les jokers de LIKE sont échappés : sans cela, « % » rendrait le catalogue
  // entier au lieu de rien.
  const d = fauxSupabase([]);
  await rechercherProduitsLocaux(d.client as never, "100%", 20, new Date());
  assert.ok(d.vu.filtres.includes("100\\%"), d.vu.filtres);
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH6..8 — NORMALISATION, PRODUITS INCOMPLETS, DOUBLONS
   ══════════════════════════════════════════════════════════════════════════ */

test("A3-SEARCH6 · un résultat externe passe par le normaliseur de la Phase 3", () => {
  const resultat = produitsDepuisReponse(
    reponseRecherche([hit("3017620422003", "Nutella", ["Ferrero"], PGL)]),
  );
  assert.equal(resultat.produits.length, 1);
  const p = resultat.produits[0];

  assert.equal(p.gtin, "3017620422003");
  assert.equal(p.productName, "Nutella");
  // `brands` est un TABLEAU dans l'index : l'adaptateur le ramène à la forme
  // que le normaliseur de la Phase 3 sait lire, sans réécrire sa logique.
  assert.equal(p.brand, "Ferrero");
  assert.equal(p.proteinPer100, 6.3);
  assert.equal(p.kcalPer100, kcalPour100(6.3, 57.5, 30.9));
  assert.equal(p.source, "open_food_facts");
  assert.deepEqual([...p.allergensDeclared], ["en:milk"]);
  // L'index ne porte pas la quantité nette : elle reste INCONNUE, pas zéro.
  assert.equal(p.netQuantity, null);

  // Le module de recherche ne réimplémente AUCUNE règle nutritionnelle : il
  // délègue à `versProduitSeth`. Le contrôle porte sur le CODE, pas la prose.
  const code = sansProse(lire("../../lib/open-food-facts/recherche.ts"));
  assert.ok(code.includes("versProduitSeth"), "le normaliseur Phase 3 doit être appelé");
  for (const interdit of ["proteins_100g", "carbohydrates_100g", "fat_100g", "no_nutrition_data"]) {
    assert.ok(
      !code.includes(interdit),
      `« ${interdit} » est relu dans recherche.ts : c'est une seconde implémentation`,
    );
  }
  // CONTRÔLE NÉGATIF du dépouillement : il n'a pas vidé le fichier.
  assert.ok(code.includes("chercherProduitsParTexte") && code.length > 1500);
});

test("A3-SEARCH7 · un produit incomplet est ignoré, il ne fait pas échouer la recherche", () => {
  const resultat = produitsDepuisReponse(
    reponseRecherche([
      hit("3017620422003", "Complet", ["Ferrero"], PGL),
      hit("5449000000996", "Sans lipides", ["Marque"], { proteins_100g: 1, carbohydrates_100g: 2 }),
      hit("3175680011480", "Sans nutriments", ["Marque"], null),
      hit("0000000000017", undefined, ["Marque"], PGL),
      hit("12345", "Code hors forme", ["Marque"], PGL),
      hit("20000015", "Complet aussi", null, PGL),
    ]),
  );

  // Deux exploitables sur six : la recherche RÉUSSIT quand même.
  assert.deepEqual(
    resultat.produits.map((p) => p.productName),
    ["Complet", "Complet aussi"],
  );
  assert.equal(resultat.ignoredIncompleteCount, 4);

  // Et le zéro reste une valeur : ce n'est pas « incomplet ».
  const zero = produitsDepuisReponse(
    reponseRecherche([
      hit("5449000000996", "Boisson", ["Marque"], {
        proteins_100g: 0,
        carbohydrates_100g: 10.6,
        fat_100g: 0,
      }),
    ]),
  );
  assert.equal(zero.produits.length, 1);
  assert.equal(zero.produits[0].proteinPer100, 0);
  assert.equal(zero.ignoredIncompleteCount, 0);
});

test("A3-SEARCH7 · aucun produit exploitable donne un résultat vide, pas une erreur", () => {
  const resultat = produitsDepuisReponse(
    reponseRecherche([hit("3017620422003", "Sans teneurs", ["M"], null)]),
  );
  assert.deepEqual([...resultat.produits], []);
  assert.equal(resultat.ignoredIncompleteCount, 1);
});

test("A3-SEARCH8 · les doublons de GTIN sont supprimés, le premier vu est gardé", () => {
  const resultat = produitsDepuisReponse(
    reponseRecherche([
      hit("3017620422003", "Nutella (premier)", ["Ferrero"], PGL),
      hit("3017620422003", "Nutella (doublon)", ["Ferrero"], PGL),
      hit("5449000000996", "Autre", ["Marque"], PGL),
      hit("3017620422003", "Nutella (encore)", ["Ferrero"], PGL),
    ]),
  );
  assert.equal(resultat.produits.length, 2);
  // Le PREMIER vu, donc le mieux classé par le fournisseur : aucun score maison.
  assert.equal(resultat.produits[0].productName, "Nutella (premier)");
  assert.equal(resultat.doublonsRetires, 2);
});

test("A3-SEARCH8 · l'ordre du fournisseur est conservé, et le nombre de résultats borné", () => {
  const nombreux = Array.from({ length: 40 }, (_, i) =>
    hit(String(30000000000000 + i), `Produit ${String(i).padStart(2, "0")}`, ["M"], PGL),
  );
  const resultat = produitsDepuisReponse(reponseRecherche(nombreux));
  assert.equal(resultat.produits.length, RECHERCHE_RESULTATS_MAX);
  assert.deepEqual(
    resultat.produits.slice(0, 3).map((p) => p.productName),
    ["Produit 00", "Produit 01", "Produit 02"],
  );

  // Aucun tri, aucun score : le code ne contient pas de comparateur.
  const code = sansProse(lire("../../lib/open-food-facts/recherche.ts"));
  for (const interdit of [".sort(", "score", "ranking", "pertinence"]) {
    assert.ok(!code.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » dans recherche.ts`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH9..11 — LE CACHE
   ══════════════════════════════════════════════════════════════════════════ */

/** Faux cache en mémoire, avec la même sémantique que la couche Supabase. */
function faussesDeps(
  locaux: { gtin: string; nom: string; id: string }[],
  externes: unknown[],
  options: { erreurExterne?: OffErreur; connuesFraiches?: string[] } = {},
) {
  const journal = { appelsExternes: 0, ecritures: [] as string[][], lecturesConnues: 0 };
  return {
    journal,
    deps: {
      chercherLocal: async () =>
        locaux.map((l) => ({
          id: l.id,
          gtin: l.gtin,
          productName: l.nom,
          brand: null,
          netQuantity: null,
          netUnit: null,
          nutritionUnit: "g" as const,
          proteinPer100: 1,
          carbPer100: 2,
          fatPer100: 3,
          kcalPer100: kcalPour100(1, 2, 3),
          imageUrl: null,
          ingredientsText: null,
          allergensDeclared: [] as string[],
          source: "open_food_facts" as const,
          sourceVersion: "v3.4",
          fetchedAt: new Date().toISOString(),
          detailFetchedAt: new Date().toISOString(),
          hydratee: true,
          stale: false,
        })),
      chercherExterne: async () => {
        journal.appelsExternes += 1;
        if (options.erreurExterne) throw options.erreurExterne;
        return produitsDepuisReponse(reponseRecherche(externes));
      },
      lireConnues: async (gtins: readonly string[]) => {
        journal.lecturesConnues += 1;
        const map = new Map<string, { produit: never; vuRecemment: boolean }>();
        for (const g of gtins) {
          if (options.connuesFraiches?.includes(g)) {
            map.set(g, {
              produit: {
                id: `cache-${g}`,
                gtin: g,
                productName: "Déjà en cache",
                brand: null,
                netQuantity: null,
                netUnit: null,
                nutritionUnit: "g",
                proteinPer100: 9,
                carbPer100: 9,
                fatPer100: 9,
                kcalPer100: kcalPour100(9, 9, 9),
                imageUrl: null,
                ingredientsText: null,
                allergensDeclared: [],
                source: "open_food_facts",
                sourceVersion: "v3.4",
                fetchedAt: new Date().toISOString(),
                detailFetchedAt: new Date().toISOString(),
                hydratee: true,
                stale: false,
              } as never,
              vuRecemment: true,
            });
          }
        }
        return map;
      },
      ecrireLot: async (
        produits: readonly { gtin: string; productName: string }[],
        connues: ReadonlyMap<string, { produit: unknown; vuRecemment: boolean }>,
      ) => {
        const aEcrire = produits.filter((p) => !connues.get(p.gtin)?.vuRecemment);
        journal.ecritures.push(aEcrire.map((p) => p.gtin));
        const conserves = produits
          .filter((p) => connues.get(p.gtin)?.vuRecemment)
          .map((p) => connues.get(p.gtin)!.produit as never);
        return {
          ecrits: [
            ...aEcrire.map((p) => ({
              id: `neuf-${p.gtin}`,
              gtin: p.gtin,
              productName: p.productName,
              brand: null,
              netQuantity: null,
              netUnit: null,
              nutritionUnit: "g" as const,
              proteinPer100: 6.3,
              carbPer100: 57.5,
              fatPer100: 30.9,
              kcalPer100: kcalPour100(6.3, 57.5, 30.9),
              imageUrl: null,
              ingredientsText: null,
              allergensDeclared: [] as string[],
              source: "open_food_facts" as const,
              sourceVersion: "v3.4",
              fetchedAt: new Date().toISOString(),
              detailFetchedAt: null,
              hydratee: false,
              stale: true,
            })),
            ...conserves,
          ] as never[],
        };
      },
    },
  };
}

test("A3-SEARCH9 · un résultat externe valide est mis en cache", async () => {
  const { journal, deps } = faussesDeps([], [hit("3017620422003", "Nutella", ["Ferrero"], PGL)]);
  const r = await resoudreRechercheProduits("nutella", true, deps as never);

  assert.deepEqual(journal.ecritures, [["3017620422003"]]);
  assert.equal(r.source, "local_and_external");
  assert.equal(r.produits.length, 1);
  // Le produit rendu porte l'identifiant du cache : sans lui, la RPC
  // `ajouter_aliment_produit` ne pourrait rien en faire.
  assert.equal(r.produits[0].id, "neuf-3017620422003");
});

test("A3-SEARCH10 · une deuxième recherche retrouve le produit en local, sans OFF", async () => {
  const { journal, deps } = faussesDeps(
    [{ gtin: "3017620422003", nom: "Nutella", id: "cache-3017620422003" }],
    [],
  );
  const r = await resoudreRechercheProduits("nutella", false, deps as never);

  assert.equal(journal.appelsExternes, 0, "le mode local ne parle à personne");
  assert.equal(r.source, "local");
  assert.equal(r.produits.length, 1);
  assert.equal(r.produits[0].id, "cache-3017620422003");
});

test("A3-SEARCH11 · un produit déjà FRAIS n'est pas réécrit", async () => {
  const { journal, deps } = faussesDeps([], [hit("3017620422003", "Nutella", ["Ferrero"], PGL)], {
    connuesFraiches: ["3017620422003"],
  });
  const r = await resoudreRechercheProduits("nutella", true, deps as never);

  assert.deepEqual(journal.ecritures, [[]], "rien à réécrire pour un produit frais");
  assert.equal(r.produits.length, 1);
  assert.equal(r.produits[0].id, "cache-3017620422003");

  // Et la couche Supabase applique bien la même règle, dans son code.
  const code = sansProse(lire("../../lib/supabase/food-products.ts"));
  assert.ok(code.includes("connue?.vuRecemment"), "la fraîcheur doit court-circuiter l'écriture");
});

test("A3-SEARCH11 · l'écriture de recherche n'écrase JAMAIS une valeur connue par une absence", async () => {
  const { enregistrerProduitsDeRecherche } = await import("../../lib/supabase/food-products");

  let ecrit: Record<string, unknown>[] = [];
  const admin = {
    from() {
      return {
        upsert(lignes: Record<string, unknown>[]) {
          ecrit = lignes;
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      };
    },
  };

  // La fiche EXISTANTE vient d'un lookup GTIN : elle sait des choses que
  // l'index de recherche ne porte pas.
  const ancienne = {
    id: "id-1",
    gtin: "3017620422003",
    productName: "Nutella",
    brand: "Ferrero",
    netQuantity: 400,
    netUnit: "g" as const,
    nutritionUnit: "ml" as const,
    proteinPer100: 6,
    carbPer100: 57,
    fatPer100: 30,
    kcalPer100: 0,
    imageUrl: "https://images.openfoodfacts.org/ancienne.jpg",
    ingredientsText: "Sucre, huile de palme",
    allergensDeclared: ["en:milk", "en:nuts"],
    source: "open_food_facts" as const,
    sourceVersion: "v3.4",
    fetchedAt: "2026-06-01T00:00:00.000Z",
    detailFetchedAt: "2026-06-01T00:00:00.000Z",
    hydratee: true,
    stale: true,
  };

  // Le résultat de RECHERCHE, structurellement plus pauvre.
  const trouve = produitsDepuisReponse(
    reponseRecherche([
      { code: "3017620422003", product_name: "Nutella 2027", brands: ["Ferrero"], nutriments: PGL },
    ]),
  ).produits[0];

  await enregistrerProduitsDeRecherche(
    admin as never,
    [trouve],
    new Map([["3017620422003", { produit: ancienne as never, vuRecemment: false }]]),
    new Date("2026-08-13T00:00:00.000Z"),
  );

  assert.equal(ecrit.length, 1);
  const l = ecrit[0];
  // Réécrits : ce sont des observations fraîches.
  assert.equal(l.product_name, "Nutella 2027");
  assert.equal(l.protein_per_100, 6.3);
  // CONSERVÉS : la recherche ne les connaît pas, elle ne peut pas les effacer.
  assert.equal(l.net_quantity, 400);
  assert.equal(l.net_unit, "g");
  assert.equal(l.ingredients_text, "Sucre, huile de palme");
  assert.equal(l.image_url, "https://images.openfoodfacts.org/ancienne.jpg");
  assert.deepEqual(l.allergens_declared, ["en:milk", "en:nuts"]);
  // ⚠️ CONSERVÉE AUSSI, et c'est le piège le plus vicieux : faute de
  // `nutrition_data_per` dans l'index, la recherche conclut « g » PAR DÉFAUT.
  // L'écrire écraserait un « ml » établi par code-barres, et 250 ml
  // deviendraient 250 g sans que rien ne le signale.
  assert.equal(l.nutrition_unit, "ml");

  // ⚠️ PHASE 4.1 — LE CONTRÔLE QUI PORTE SUR LE CODE DE PRODUCTION.
  //
  // `detail_fetched_at` doit être ABSENT de l'objet écrit. Une colonne non
  // fournie n'est ni insérée ni mise à jour par l'`on conflict` : c'est ce
  // qui fait qu'une recherche ne prétend jamais avoir chargé une fiche
  // complète, et qu'elle ne fait pas repartir pour trente jours le TTL d'une
  // fiche hydratée il y a vingt-neuf. L'y ajouter — même « pour faire
  // propre » — réintroduirait exactement le défaut de la phase 4.
  assert.ok(
    !("detail_fetched_at" in l),
    "l'écriture de recherche ne doit JAMAIS toucher detail_fetched_at",
  );
  assert.ok("source_fetched_at" in l, "elle actualise en revanche l'observation");
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH12..15 — LES PANNES D'OPEN FOOD FACTS
   ══════════════════════════════════════════════════════════════════════════ */

async function pannePreserveLeLocal(code: "OFF_RATE_LIMITED" | "OFF_UNAVAILABLE" | "OFF_INVALID_RESPONSE") {
  const { deps } = faussesDeps(
    [
      { gtin: "1", nom: "Local A", id: "a" },
      { gtin: "2", nom: "Local B", id: "b" },
      { gtin: "3", nom: "Local C", id: "c" },
      { gtin: "4", nom: "Local D", id: "d" },
    ],
    [],
    { erreurExterne: new OffErreur(code) },
  );
  const r = await resoudreRechercheProduits("skyr", true, deps as never);
  assert.equal(r.produits.length, 4, `${code} ne doit pas faire perdre les résultats locaux`);
  assert.equal(r.externalUnavailable, true);
  assert.equal(r.source, "local");
  return r;
}

test("A3-SEARCH12 · 429 : les résultats locaux sont conservés", async () => {
  await pannePreserveLeLocal("OFF_RATE_LIMITED");
});

test("A3-SEARCH13 · 503 : les résultats locaux sont conservés", async () => {
  await pannePreserveLeLocal("OFF_UNAVAILABLE");
});

test("A3-SEARCH14 · délai dépassé : les résultats locaux sont conservés", async () => {
  // Le transport traduit un abandon en OFF_UNAVAILABLE — vérifié ici de bout
  // en bout plutôt que supposé.
  const { transport } = transportQuiCompte(async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  await avecUserAgent(UA, async () => {
    await assert.rejects(
      () => chercherProduitsParTexte("skyr", { transport, timeoutMs: 5 }),
      (e: unknown) => estOffErreur(e) && e.code === "OFF_UNAVAILABLE",
    );
  });
  await pannePreserveLeLocal("OFF_UNAVAILABLE");
});

test("A3-SEARCH15 · aucun résultat local + OFF en panne : réponse métier propre", async () => {
  const { deps } = faussesDeps([], [], { erreurExterne: new OffErreur("OFF_UNAVAILABLE") });
  const r = await resoudreRechercheProduits("skyr", true, deps as never);

  // Pas d'exception, pas de 500 : une réponse vide et honnête.
  assert.deepEqual([...r.produits], []);
  assert.equal(r.externalUnavailable, true);
  assert.equal(r.source, "local");
});

test("A3-SEARCH12..15 · chaque code HTTP du service est traduit une fois pour toutes", async () => {
  const cas = [
    { statut: 429, code: "OFF_RATE_LIMITED" },
    { statut: 503, code: "OFF_UNAVAILABLE" },
    { statut: 500, code: "OFF_UNAVAILABLE" },
    { statut: 422, code: "OFF_INVALID_RESPONSE" },
  ] as const;
  for (const c of cas) {
    const { transport } = transportQuiCompte(async () => reponseHttp({}, c.statut));
    await avecUserAgent(UA, async () => {
      await assert.rejects(
        () => chercherProduitsParTexte("skyr", { transport }),
        (e: unknown) => estOffErreur(e) && e.code === c.code,
        `HTTP ${c.statut} doit donner ${c.code}`,
      );
    });
  }

  // Une réponse 200 mais illisible, ou sans liste de résultats.
  for (const corps of ["<html>", JSON.stringify({ count: 0 })]) {
    const { transport } = transportQuiCompte(async () =>
      new Response(corps, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await avecUserAgent(UA, async () => {
      await assert.rejects(
        () => chercherProduitsParTexte("skyr", { transport }),
        (e: unknown) => estOffErreur(e) && e.code === "OFF_INVALID_RESPONSE",
      );
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH16..18 — LA ROUTE : FUITES, AUTHENTIFICATION, PROXY
   ══════════════════════════════════════════════════════════════════════════ */

const ROUTE = lire("../../app/api/food-products/search/route.ts");

test("A3-SEARCH16 · source_payload n'est jamais exposé", () => {
  const code = sansProse(ROUTE);
  assert.ok(!code.includes("source_payload"), "la route ne doit pas nommer source_payload");
  assert.ok(!code.includes("sourcePayload"));

  // Le DTO est construit CHAMP PAR CHAMP : aucun `...produit` ne peut laisser
  // passer une colonne ajoutée demain.
  assert.ok(!/\.\.\.\s*p\b/.test(code), "aucune diffusion d'objet dans le DTO");
  assert.ok(!/\.\.\.\s*produit/.test(code));
  for (const champ of ["id:", "gtin:", "name:", "kcalPer100:", "stale:", "nutritionUnit:"]) {
    assert.ok(code.includes(champ), `le DTO doit nommer ${champ}`);
  }

  // Et la couche de recherche ne demande même pas la colonne au fournisseur.
  assert.ok(!OFF_SEARCH_FIELDS.includes("source_payload" as never));

  // CONTRÔLE NÉGATIF : le dépouillement n'a pas vidé le fichier.
  assert.ok(code.includes("resoudreRechercheProduits") && code.length > 1500);
});

test("A3-SEARCH17 · la route exige une authentification avant tout appel", () => {
  const code = sansProse(ROUTE);
  assert.ok(code.includes("supabase.auth.getUser()"), "l'utilisateur doit être vérifié");
  assert.ok(code.includes('status: 401'), "un anonyme doit recevoir 401");

  // L'ORDRE compte : l'authentification précède la résolution, sinon un
  // anonyme ferait consommer le quota OFF du serveur avant d'être refusé.
  //
  // On mesure l'ordre dans le CORPS de la fonction, pas dans le fichier : les
  // `import` du haut nomment `resoudreRechercheProduits` bien avant tout
  // appel, et un indexOf naïf conclurait l'inverse de la vérité.
  const corps = code.slice(code.indexOf("export async function GET"));
  const posAuth = corps.indexOf("supabase.auth.getUser()");
  const posRecherche = corps.indexOf("await resoudreRechercheProduits");
  assert.ok(posAuth > 0, "l'utilisateur doit être vérifié dans le corps de la route");
  assert.ok(posRecherche > posAuth, "l'authentification doit précéder la recherche");

  // Et la limitation de fréquence aussi, avec le limiteur DÉJÀ présent dans
  // le dépôt — aucun Redis ajouté pour cette phase.
  assert.ok(code.includes("consumeRateLimit"), "le limiteur existant doit être réutilisé");
  const posQuota = corps.indexOf("await consumeRateLimit");
  assert.ok(posQuota > posAuth && posQuota < posRecherche, "le quota se consomme entre les deux");
});

test("A3-SEARCH18 · impossible de faire proxyfier une requête OFF arbitraire", () => {
  const code = sansProse(ROUTE);

  // Le client n'envoie que deux choses, et la route ne lit que celles-là.
  const parametresLus = [...code.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(parametresLus.sort(), ["external", "q"]);

  // Aucune URL OFF n'est construite dans la route : elles vivent toutes dans
  // l'adaptateur, à partir de constantes.
  assert.ok(!code.includes("openfoodfacts"), "la route ne connaît pas l'adresse d'OFF");

  // Les paramètres du fournisseur sont des CONSTANTES, pas des entrées.
  const url = urlRechercheProduits("skyr danone");
  assert.ok(url.startsWith(`${OFF_SEARCH_URL}?`), url);
  assert.ok(url.includes("page_size=40") && url.includes("page=1"), url);

  // Une tentative d'injection de paramètre par la requête n'en est pas une :
  // `URLSearchParams` encode `&` et `=`, et l'échappement Lucene neutralise
  // les métacaractères. La saisie reste une VALEUR.
  //
  // Le contrôle se fait en RELISANT l'URL comme le ferait le serveur, pas en
  // cherchant une sous-chaîne : « index_id » apparaît bel et bien dans l'URL,
  // encodé à l'intérieur de `q`, et c'est précisément ce qu'on veut — une
  // donnée, pas un paramètre. Une assertion sur le texte brut aurait crié à
  // l'injection là où il n'y en a pas, et serait passée à côté d'une vraie.
  const hostile = new URL(urlRechercheProduits("skyr&page_size=9999&index_id=autre"));
  assert.deepEqual(hostile.searchParams.getAll("page_size"), ["40"]);
  assert.equal(hostile.searchParams.get("index_id"), null);
  assert.deepEqual([...hostile.searchParams.keys()].sort(), ["fields", "page", "page_size", "q"]);
  assert.ok(hostile.searchParams.get("q")?.includes("page_size=9999"), "la tentative reste du texte");

  // Échappement Lucene : le texte de l'élève reste du texte.
  assert.equal(echapperLucene("yaourt: nature"), "yaourt\\: nature");
  assert.equal(echapperLucene("lait 1/2 écrémé"), "lait 1\\/2 écrémé");
  assert.equal(echapperLucene("pizza AND NOT jambon"), "pizza AND NOT jambon");
  assert.equal(echapperLucene("[a TO z]"), "\\[a TO z\\]");
  assert.equal(echapperLucene("<script>"), " script ");
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH19..20 — LE COMPTEUR D'APPELS, QUI EST LA VRAIE PREUVE
   ══════════════════════════════════════════════════════════════════════════ */

test("A3-SEARCH19 · mode local : ZÉRO appel externe", async () => {
  const { journal, deps } = faussesDeps(
    [{ gtin: "1", nom: "Local", id: "a" }],
    [hit("3017620422003", "Nutella", ["Ferrero"], PGL)],
  );
  const r = await resoudreRechercheProduits("nutella", false, deps as never);

  assert.equal(journal.appelsExternes, 0);
  assert.equal(journal.lecturesConnues, 0, "même pas une lecture préparatoire");
  assert.deepEqual(journal.ecritures, [], "et aucune écriture");
  assert.equal(r.source, "local");

  // La route n'active l'externe que sur `external=true` littéral : ni « 1 »,
  // ni « oui », ni « TRUE » ne doivent suffire.
  const code = sansProse(ROUTE);
  assert.ok(code.includes('searchParams.get("external") === "true"'), code.slice(0, 0));
});

test("A3-SEARCH20 · mode externe : au plus UN appel externe", async () => {
  const { journal, deps } = faussesDeps(
    [{ gtin: "1", nom: "Local", id: "a" }],
    Array.from({ length: 30 }, (_, i) =>
      hit(String(30000000000000 + i), `Produit ${i}`, ["M"], PGL),
    ),
  );
  const r = await resoudreRechercheProduits("nutella", true, deps as never);

  // UN appel, quel que soit le nombre de résultats. Pas de pagination, pas de
  // seconde passe pour « compléter » les fiches pauvres par des lookups GTIN :
  // ce serait trente appels au lieu d'un, sur un quota de dix par minute.
  assert.equal(journal.appelsExternes, 1);
  assert.equal(journal.ecritures.length, 1, "une seule écriture en LOT, pas une par produit");
  assert.equal(r.source, "local_and_external");
  // Le local d'abord, puis l'ordre du fournisseur.
  assert.equal(r.produits[0].gtin, "1");

  const { transport, état } = transportQuiCompte(async () =>
    reponseHttp(reponseRecherche([hit("3017620422003", "Nutella", ["Ferrero"], PGL)])),
  );
  await avecUserAgent(UA, () => chercherProduitsParTexte("nutella", { transport }));
  assert.equal(état.appels, 1, "le transport lui-même n'appelle qu'une fois");
});

/* ══════════════════════════════════════════════════════════════════════════
   Contrôles complémentaires — isolement de l'adaptateur, périmètre
   ══════════════════════════════════════════════════════════════════════════ */

test("A3-SEARCH-SUP · Search-a-licious est confiné à un seul module", () => {
  const fautifs: string[] = [];
  for (const dossier of ["../../lib", "../../app", "../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      if (chemin.endsWith("lib/open-food-facts/recherche.ts")) continue;
      const source = sansProse(readFileSync(chemin, "utf8"));
      if (/search\.openfoodfacts|search-a-licious|page_size|lucene/i.test(source)) {
        fautifs.push(chemin);
      }
    }
  }
  assert.deepEqual(fautifs, [], `Search-a-licious déborde de son module : ${fautifs.join(", ")}`);

  // CONTRÔLE NÉGATIF du balayage : il voit bien les fichiers qu'il prétend lire.
  const balayés = fichiersTs(new URL("../../lib/", import.meta.url));
  assert.ok(balayés.some((c) => c.endsWith("lib/open-food-facts/recherche.ts")));
  assert.ok(balayés.length > 20, `balayage trop pauvre (${balayés.length})`);

  // Aucun composant client ne connaît la recherche externe.
  const clients: string[] = [];
  for (const dossier of ["../../components", "../../hooks"]) {
    for (const chemin of fichiersTs(new URL(dossier + "/", import.meta.url))) {
      const source = sansProse(readFileSync(chemin, "utf8"));
      // Même affinage qu'en A3-OFF2 : le lien d'attribution est légitime, les
      // adresses d'API ne le sont pas. L'UI appelle NOS routes — et le fait
      // qu'elle nomme `/api/food-products/...` est justement la preuve
      // qu'elle passe par nous, pas par eux.
      if (/world\.openfoodfacts\.org|search\.openfoodfacts|search-a-licious|\/api\/v\d/i.test(source)) {
        clients.push(chemin);
      }
    }
  }
  assert.deepEqual(clients, [], `l'UI connaît Open Food Facts : ${clients.join(", ")}`);
});

test("A3-SEARCH-SUP · le module de recherche est server-only, et la phase 4 n'a créé aucune migration", () => {
  assert.ok(/^import "server-only";/m.test(lire("../../lib/open-food-facts/recherche.ts")));

  // §17 : food_products existe déjà, la fusion non destructive est du
  // TypeScript. Aucune migration ne doit être apparue après la phase 3.
  const migrations = readdirSync(
    new URL("../../supabase/migrations", import.meta.url).pathname,
  ).filter((f) => f.endsWith(".sql"));
  // 69 après la phase 3 ; 70 après la phase 4.1, qui a ajouté la SEULE
  // migration de ce lot : `detail_fetched_at`. La phase 4 elle-même n'en a
  // créé aucune — c'est la 4.1 qui a dû, faute de pouvoir représenter
  // « hydratée » dans le schéma existant sans mentir.
  // 70 après A3 phase 4.1, 72 depuis ALIMENTS A5 (+2). Ce compteur vit dans
  // NEUF fichiers : les oublier rend rouges des suites qui n'ont rien à voir
  // avec le chantier en cours — c'est arrivé, et c'est pour cela qu'ils sont
  // croisés.
  assert.equal(migrations.length, 76, "76 migrations : 72 avant N1, +1 en N1.1, +1 en N1.3, +1 en N1.5.1");
  // ⚠️ RÉÉCRIT EN A5 — CINQUIÈME OCCURRENCE DU MÊME MOTIF DANS CE PROJET.
  //
  // Ce contrôle exigeait qu'AUCUNE migration ne soit postérieure à la phase 4.1.
  // C'était vrai tant qu'aucun chantier ne suivait ; A5 en a ajouté deux, avec
  // validation explicite. Le rouge ne disait donc pas que la phase 4 avait
  // débordé : il disait, une fois de plus, qu'un contrôle décrivait le
  // périmètre d'UNE phase en parlant de TOUT le dossier.
  //
  // Ce qui reste vrai — et qui est maintenant mesuré — est plus précis et plus
  // utile : AUCUNE migration, de quelque chantier que ce soit, ne touche à la
  // recherche texte. Search-a-licious est du TypeScript, confiné à son module.
  //
  // ⚠️ ET LE PIÈGE HABITUEL, DIXIÈME OCCURRENCE : `sansProse` ne retire que les
  // commentaires JavaScript. La migration d'hydratation NOMME Search-a-licious
  // dans un commentaire SQL `--`, pour expliquer ce que la recherche texte ne
  // rapporte pas. Sans ce second dépouillement, ce contrôle serait rouge sur
  // son propre exposé des motifs.
  const sansCommentairesSql = (sql: string) => sql.replace(/^\s*--.*$/gm, " ");
  const lireMigration = (f: string) =>
    readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8");
  const motifRecherche = /search-a-licious|search\.openfoodfacts|cgi\/search\.pl/i;

  const migrationsQuiParlentDeRecherche = migrations.filter((f) =>
    motifRecherche.test(sansCommentairesSql(lireMigration(f))),
  );
  assert.deepEqual(
    migrationsQuiParlentDeRecherche,
    [],
    "la recherche texte ne doit vivre dans aucune migration",
  );
  // CONTRÔLE NÉGATIF DU DÉPOUILLEMENT : la prose, elle, en parle bien — et le
  // décapage n'a pas vidé le fichier pour autant.
  assert.ok(motifRecherche.test(lireMigration("20260904090000_food_products_hydratation.sql")));
  assert.ok(
    sansCommentairesSql(lireMigration("20260904090000_food_products_hydratation.sql")).includes(
      "detail_fetched_at",
    ),
  );

  // Et la phase 4 elle-même n'en a créé aucune : rien entre la dernière
  // migration de la phase 3 et celle de la phase 4.1.
  const horodatages = migrations.map((f) => f.slice(0, 14)).sort();
  const entreLesDeux = horodatages.filter((h) => h > "20260903090100" && h < "20260904090000");
  assert.deepEqual(entreLesDeux, [], "la phase 4 n'a créé aucune migration");
  assert.ok(
    migrations.includes("20260904090000_food_products_hydratation.sql"),
    "la migration d'hydratation doit être là",
  );

  // Et aucune extension n'a été ajoutée pour la recherche locale : `ilike`
  // suffit à une table qui n'a pas encore de lignes, et l'installer « au cas
  // où » serait optimiser une mesure qu'on n'a pas faite.
  const codeCache = sansProse(lire("../../lib/supabase/food-products.ts"));
  for (const extension of ["pg_trgm", "unaccent", "citext"]) {
    assert.ok(!codeCache.includes(extension), `${extension} apparaît sans mesure qui le justifie`);
  }
  assert.ok(codeCache.includes("ilike"), "la recherche locale doit rester insensible à la casse");
});

test("A3-SEARCH-SUP · une réponse hors forme ne devient jamais un produit", () => {
  for (const corps of [null, 42, "texte", {}, { hits: null }, { hits: "pas un tableau" }]) {
    assert.throws(
      () => produitsDepuisReponse(corps),
      (e: unknown) => estOffErreur(e) && e.code === "OFF_INVALID_RESPONSE",
      `${JSON.stringify(corps)} doit être refusé`,
    );
  }
  // Un hit hors forme, lui, est simplement ignoré : un mauvais résultat ne
  // condamne pas les autres.
  const r = produitsDepuisReponse(reponseRecherche([null, 42, "texte", { code: "" }]));
  assert.deepEqual([...r.produits], []);
  assert.equal(r.ignoredIncompleteCount, 4);
  assert.equal(hitVersFicheProduit(null), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   A3-SEARCH-HYDRATE1..9 (PHASE 4.1) — « VU » N'EST PAS « CONNU »
   ══════════════════════════════════════════════════════════════════════════

   Le défaut corrigé ici, MESURÉ sur le code de la phase 4 avant correction :

     1. une recherche « boisson » trouve le GTIN 5449000000996 ;
     2. le hit n'a pas de `nutrition_data_per` — l'index ne le porte pas —,
        donc l'unité conclut « g » PAR DÉFAUT : un repli, pas une observation ;
     3. la ligne est écrite avec `source_fetched_at = maintenant` ;
     4. un lookup GTIN immédiat jugeait la ligne FRAÎCHE et ne partait pas :
        zéro appel à /api/v3.4/product/5449000000996 ;
     5. l'élève voyait « pour 100 g » là où la fiche dit « pour 100 ml »,
        et il aurait fallu attendre TRENTE JOURS que ça se corrige.

   Et symétriquement, une fiche complète de 29 jours voyait son TTL repartir
   pour trente jours parce que quelqu'un avait tapé son nom dans une barre de
   recherche.

   La correction tient en une distinction : `source_fetched_at` dit quand on a
   VU le produit, `detail_fetched_at` dit quand on a CHARGÉ sa fiche complète.
   Le TTL du lookup mesure la seconde. */

const GTIN_BOISSON = "5449000000996";

/** Le hit de recherche : P/G/L, un nom, une image. Rien de plus. */
const HIT_PAUVRE = {
  code: GTIN_BOISSON,
  product_name: "Boisson gazeuse",
  brands: ["Marque L"],
  nutriments: { proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
  image_front_url: `https://images.openfoodfacts.org/${GTIN_BOISSON}.jpg`,
};

/** La fiche complète du MÊME produit : elle sait, elle, que c'est du liquide. */
const FICHE_COMPLETE = {
  status: "success",
  result: { id: "product_found" },
  product: {
    code: GTIN_BOISSON,
    product_name: "Boisson gazeuse",
    brands: "Marque L",
    nutrition_data_per: "100ml",
    product_quantity: "1000",
    product_quantity_unit: "ml",
    nutriments: { proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
    ingredients_text: "Eau gazéifiée, sucre, colorant",
    allergens_tags: ["en:none"],
    image_front_url: `https://images.openfoodfacts.org/${GTIN_BOISSON}.jpg`,
  },
};

const MAINTENANT = new Date("2026-08-13T12:00:00.000Z");
const jours = (n: number) => new Date(MAINTENANT.getTime() - n * 24 * 3600 * 1000).toISOString();

/**
 * Un cache en mémoire qui se comporte comme la vraie couche : une ligne, un
 * identifiant stable, et les DEUX dates séparées. C'est la seule façon de
 * jouer « recherche puis lookup » sans monter une base.
 */
function cacheEnMemoire() {
  const lignes = new Map<string, Record<string, unknown>>();
  let compteurId = 0;
  const journal = { lookups: 0, ecrituresDetail: 0, ecrituresRecherche: 0 };

  const versProduit = (l: Record<string, unknown>) => ({
    id: l.id as string,
    gtin: l.gtin as string,
    productName: l.product_name as string,
    brand: (l.brand as string | null) ?? null,
    netQuantity: (l.net_quantity as number | null) ?? null,
    netUnit: (l.net_unit as "g" | "ml" | null) ?? null,
    nutritionUnit: l.nutrition_unit as "g" | "ml",
    proteinPer100: l.protein_per_100 as number,
    carbPer100: l.carb_per_100 as number,
    fatPer100: l.fat_per_100 as number,
    kcalPer100: kcalPour100(
      l.protein_per_100 as number,
      l.carb_per_100 as number,
      l.fat_per_100 as number,
    ),
    imageUrl: (l.image_url as string | null) ?? null,
    ingredientsText: (l.ingredients_text as string | null) ?? null,
    allergensDeclared: (l.allergens_declared as string[] | null) ?? [],
    source: "open_food_facts" as const,
    sourceVersion: "v3.4",
    fetchedAt: l.source_fetched_at as string,
    detailFetchedAt: (l.detail_fetched_at as string | null) ?? null,
    hydratee: l.detail_fetched_at !== null && l.detail_fetched_at !== undefined,
    stale: !detailEstFrais((l.detail_fetched_at as string | null) ?? null, MAINTENANT),
  });

  return {
    lignes,
    journal,
    versProduit,
    /** Écriture du chemin RECHERCHE : ne touche jamais `detail_fetched_at`. */
    ecrireRecherche(produit: { gtin: string; productName: string; brand: string | null;
      nutritionUnit: "g" | "ml"; proteinPer100: number; carbPer100: number; fatPer100: number;
      imageUrl: string | null; ingredientsText: string | null; allergensDeclared: readonly string[];
      netQuantity: number | null; netUnit: "g" | "ml" | null }) {
      journal.ecrituresRecherche += 1;
      const ancienne = lignes.get(produit.gtin);
      compteurId += ancienne ? 0 : 1;
      lignes.set(produit.gtin, {
        ...(ancienne ?? {}),
        id: ancienne?.id ?? `fp-${compteurId}`,
        gtin: produit.gtin,
        product_name: produit.productName,
        brand: produit.brand ?? ancienne?.brand ?? null,
        net_quantity: produit.netQuantity ?? ancienne?.net_quantity ?? null,
        net_unit: produit.netUnit ?? ancienne?.net_unit ?? null,
        // L'unité établie l'emporte sur le repli d'une recherche.
        nutrition_unit: ancienne?.nutrition_unit ?? produit.nutritionUnit,
        protein_per_100: produit.proteinPer100,
        carb_per_100: produit.carbPer100,
        fat_per_100: produit.fatPer100,
        image_url: produit.imageUrl ?? ancienne?.image_url ?? null,
        ingredients_text: produit.ingredientsText ?? ancienne?.ingredients_text ?? null,
        allergens_declared:
          produit.allergensDeclared.length > 0
            ? [...produit.allergensDeclared]
            : (ancienne?.allergens_declared ?? []),
        source_fetched_at: MAINTENANT.toISOString(),
        // `detail_fetched_at` n'est PAS touché : il vient de `...ancienne`.
      });
      return versProduit(lignes.get(produit.gtin)!);
    },
    /** Écriture du chemin GTIN : c'est elle, et elle seule, qui hydrate. */
    ecrireDetail(produit: {
      gtin: string; productName: string; brand: string | null; netQuantity: number | null;
      netUnit: "g" | "ml" | null; nutritionUnit: "g" | "ml"; proteinPer100: number;
      carbPer100: number; fatPer100: number; imageUrl: string | null;
      ingredientsText: string | null; allergensDeclared: readonly string[];
    }) {
      journal.ecrituresDetail += 1;
      const ancienne = lignes.get(produit.gtin);
      compteurId += ancienne ? 0 : 1;
      lignes.set(produit.gtin, {
        id: ancienne?.id ?? `fp-${compteurId}`,
        gtin: produit.gtin,
        product_name: produit.productName,
        brand: produit.brand,
        net_quantity: produit.netQuantity,
        net_unit: produit.netUnit,
        nutrition_unit: produit.nutritionUnit,
        protein_per_100: produit.proteinPer100,
        carb_per_100: produit.carbPer100,
        fat_per_100: produit.fatPer100,
        image_url: produit.imageUrl,
        ingredients_text: produit.ingredientsText,
        allergens_declared: [...produit.allergensDeclared],
        source_fetched_at: MAINTENANT.toISOString(),
        detail_fetched_at: MAINTENANT.toISOString(),
      });
      return versProduit(lignes.get(produit.gtin)!);
    },
  };
}

/** Le lookup GTIN de la phase 3, branché sur ce cache. */
async function lookup(cache: ReturnType<typeof cacheEnMemoire>, reponseOff: unknown) {
  return resoudreProduitParGtin(GTIN_BOISSON, {
    lireCache: async (gtin) => {
      const l = cache.lignes.get(gtin);
      if (!l) return null;
      return {
        produit: cache.versProduit(l) as never,
        detailFrais: detailEstFrais((l.detail_fetched_at as string | null) ?? null, MAINTENANT),
      };
    },
    interrogerOff: async (gtin) => {
      cache.journal.lookups += 1;
      return { produit: versProduitSeth(gtin, reponseOff as never), brut: null };
    },
    ecrireCache: async (produit) => cache.ecrireDetail(produit) as never,
  });
}

/** La recherche texte de la phase 4, branchée sur le même cache. */
async function recherche(cache: ReturnType<typeof cacheEnMemoire>) {
  return resoudreRechercheProduits("boisson", true, {
    chercherLocal: async () => [...cache.lignes.values()].map((l) => cache.versProduit(l)) as never,
    chercherExterne: async () => produitsDepuisReponse(reponseRecherche([HIT_PAUVRE])),
    lireConnues: async (gtins: readonly string[]) => {
      const m = new Map<string, { produit: never; vuRecemment: boolean }>();
      for (const g of gtins) {
        const l = cache.lignes.get(g);
        if (l) m.set(g, { produit: cache.versProduit(l) as never, vuRecemment: false });
      }
      return m;
    },
    ecrireLot: async (produits: readonly Parameters<
      ReturnType<typeof cacheEnMemoire>["ecrireRecherche"]
    >[0][]) => ({
      ecrits: produits.map((p) => cache.ecrireRecherche(p)) as never,
    }),
  } as never);
}

test("A3-SEARCH-HYDRATE1 · un hit de recherche est mis en cache et retrouvable localement", async () => {
  const cache = cacheEnMemoire();
  const r = await recherche(cache);

  assert.equal(r.produits.length, 1);
  assert.equal(r.produits[0].gtin, GTIN_BOISSON);
  assert.equal(cache.lignes.size, 1, "la ligne est bien en cache");

  // Et une recherche LOCALE ultérieure la retrouve, sans réseau.
  const local = await resoudreRechercheProduits("boisson", false, {
    chercherLocal: async () => [...cache.lignes.values()].map((l) => cache.versProduit(l)) as never,
    chercherExterne: async () => {
      throw new Error("le mode local ne doit appeler personne");
    },
    lireConnues: async () => new Map(),
    ecrireLot: async () => ({ ecrits: [] }),
  } as never);
  assert.equal(local.produits.length, 1);
  assert.equal(local.source, "local");
});

test("A3-SEARCH-HYDRATE2 · un hit de recherche n'est PAS une fiche GTIN fraîche", async () => {
  const cache = cacheEnMemoire();
  await recherche(cache);
  const ligne = cache.lignes.get(GTIN_BOISSON)!;

  // Vu à l'instant…
  assert.equal(ligne.source_fetched_at, MAINTENANT.toISOString());
  // …mais JAMAIS hydraté.
  assert.equal(ligne.detail_fetched_at ?? null, null);
  assert.equal(detailEstFrais(null, MAINTENANT), false);
  assert.equal(cache.versProduit(ligne).hydratee, false);
  assert.equal(cache.versProduit(ligne).stale, true);
});

test("A3-SEARCH-HYDRATE3 · le lookup GTIN juste après la recherche appelle bien l'endpoint produit", async () => {
  const cache = cacheEnMemoire();
  await recherche(cache);
  assert.equal(cache.journal.lookups, 0);

  await lookup(cache, FICHE_COMPLETE);

  // LE contrôle de la phase 4.1. Avant correction : 0.
  assert.equal(cache.journal.lookups, 1, "la fiche partielle ne doit pas bloquer l'hydratation");
});

test("A3-SEARCH-HYDRATE4 · la fiche complète ENRICHIT la ligne existante, sans doublon", async () => {
  const cache = cacheEnMemoire();
  await recherche(cache);
  const apres = await lookup(cache, FICHE_COMPLETE);

  assert.equal(cache.lignes.size, 1, "une seule ligne pour un seul GTIN");
  // Ce que la recherche ne pouvait pas connaître est arrivé.
  assert.equal(apres.ingredientsText, "Eau gazéifiée, sucre, colorant");
  assert.equal(apres.netQuantity, 1000);
  assert.equal(apres.netUnit, "ml");
  assert.equal(apres.hydratee, true);
  assert.equal(apres.stale, false);
});

test("A3-SEARCH-HYDRATE5 · le food_products.id est le MÊME avant et après hydratation", async () => {
  const cache = cacheEnMemoire();
  const avant = (await recherche(cache)).produits[0].id;
  const apres = (await lookup(cache, FICHE_COMPLETE)).id;

  assert.equal(apres, avant, "changer d'identifiant orphelinerait les meal_entries");
  assert.ok(avant.length > 0);
});

test("A3-SEARCH-HYDRATE6 · l'unité provisoire « g » ne bloque pas la vraie unité « ml »", async () => {
  const cache = cacheEnMemoire();

  // Après la recherche seule : « g », faute de `nutrition_data_per` dans
  // l'index. C'est un REPLI, et le système ne doit pas le prendre pour une
  // observation.
  const parRecherche = (await recherche(cache)).produits[0];
  assert.equal(parRecherche.nutritionUnit, "g");
  assert.equal(parRecherche.hydratee, false, "il ne prétend pas posséder une fiche complète");

  // Après hydratation : « ml », établi par la fiche.
  const parLookup = await lookup(cache, FICHE_COMPLETE);
  assert.equal(parLookup.nutritionUnit, "ml");
  assert.equal(cache.lignes.get(GTIN_BOISSON)!.nutrition_unit, "ml");

  // 250 unités de ce produit valent 26,5 g de glucides — et la question
  // « 250 g ou 250 ml ? » n'a plus de réponse ambiguë.
  assert.equal(parLookup.carbPer100, 10.6);
});

test("A3-SEARCH-HYDRATE7 · le lookup suivant, après hydratation, ne fait AUCUN appel", async () => {
  const cache = cacheEnMemoire();
  await recherche(cache);
  await lookup(cache, FICHE_COMPLETE);
  assert.equal(cache.journal.lookups, 1);

  await lookup(cache, FICHE_COMPLETE);
  await lookup(cache, FICHE_COMPLETE);

  assert.equal(cache.journal.lookups, 1, "une fiche hydratée et fraîche sert le cache, pas le réseau");
});

test("A3-SEARCH-HYDRATE8 · une recherche pauvre ultérieure ne dégrade JAMAIS la fiche complète", async () => {
  const cache = cacheEnMemoire();
  await lookup(cache, FICHE_COMPLETE);
  const avant = { ...cache.lignes.get(GTIN_BOISSON)! };

  await recherche(cache);
  const apres = cache.lignes.get(GTIN_BOISSON)!;

  assert.equal(apres.id, avant.id);
  assert.equal(apres.nutrition_unit, "ml", "le repli « g » ne doit pas remplacer un « ml » établi");
  assert.equal(apres.ingredients_text, "Eau gazéifiée, sucre, colorant");
  assert.equal(apres.net_quantity, 1000);
  assert.equal(apres.net_unit, "ml");
  assert.deepEqual(apres.allergens_declared, ["en:none"]);
  assert.equal(apres.detail_fetched_at, avant.detail_fetched_at, "l'hydratation n'est pas retouchée");
});

test("A3-SEARCH-HYDRATE9 · une recherche ne renouvelle pas le TTL d'une fiche hydratée il y a 29 jours", async () => {
  const cache = cacheEnMemoire();
  await lookup(cache, FICHE_COMPLETE);

  // On vieillit artificiellement l'hydratation : 29 jours.
  const ligne = cache.lignes.get(GTIN_BOISSON)!;
  ligne.detail_fetched_at = jours(29);
  ligne.source_fetched_at = jours(29);

  await recherche(cache);
  const apres = cache.lignes.get(GTIN_BOISSON)!;

  // La recherche a bien actualisé l'OBSERVATION…
  assert.equal(apres.source_fetched_at, MAINTENANT.toISOString());
  // …mais PAS l'hydratation. Sans cela, la fiche serait repartie pour trente
  // jours sans avoir été rechargée une seule fois.
  assert.equal(apres.detail_fetched_at, jours(29));

  // Deux jours plus tard, le détail a 31 jours : le lookup doit repartir.
  const dansDeuxJours = new Date(MAINTENANT.getTime() + 2 * 24 * 3600 * 1000);
  assert.equal(detailEstFrais(apres.detail_fetched_at as string, dansDeuxJours), false);
  // Alors que l'observation, elle, est encore récente — c'est bien la
  // confusion des deux qui était le défaut.
  assert.equal(cacheEstFrais(apres.source_fetched_at as string, dansDeuxJours), true);
});
