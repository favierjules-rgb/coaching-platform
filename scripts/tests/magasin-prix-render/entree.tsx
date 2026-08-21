/**
 * HARNAIS REACT — « CHANGER DE MAGASIN RELIT LES PRIX OBSERVÉS ».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE HARNAIS EXISTE POUR EMPÊCHER DE REVENIR
 * ════════════════════════════════════════════════════════════════════════════
 * `ChoixMagasinProche` appelait déjà `onMagasinChoisi` après un `select`
 * réussi, mais PERSONNE ne branchait ce rappel : l'élève changeait de magasin
 * et continuait de lire les relevés de l'ancien. Un test de texte source
 * n'aurait rien prouvé — un rappel vide (`() => {}`) lui aurait paru correct.
 *
 * Ici, on CLIQUE. Le composant réel poste `/stores/select`, le vrai rappel
 * part, et l'on compte les lectures de `/observed-prices`. Un rappel qui ne
 * fait rien laisse ce compteur à un, et le test rougit.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { ListeDeCoursesPersistante } from "@/components/student/ListeDeCoursesPersistante";
import { construirePeriode } from "@/lib/nutrition/periode-courses";

interface Journal {
  readonly url: string;
  readonly methode: string;
}

const journal: Journal[] = [];

const MAGASINS = [
  {
    osmType: "NODE",
    osmId: 9928912836,
    name: "Naturalia",
    brand: "Naturalia",
    brandWikidata: "Q3336090",
    operatorWikidata: null,
    city: "Toulon",
    postcode: "83000",
    countryCode: "FR",
    lat: 43.1242,
    lon: 5.928,
    distanceKm: null,
  },
  {
    osmType: "NODE",
    osmId: 1232009359,
    name: "Lidl",
    brand: "Lidl",
    brandWikidata: null,
    operatorWikidata: null,
    city: "Toulon",
    postcode: "83000",
    countryCode: "FR",
    lat: 43.13,
    lon: 5.93,
    distanceKm: null,
  },
];

/**
 * ⚠️ LE RÉSEAU EST LA SEULE CHOSE REMPLACÉE ICI — et il l'est au niveau de
 * `fetch`, pas des composants. Les routes ne sont pas jouées : ce qu'on
 * mesure, c'est QUI appelle QUOI, et dans quel ordre.
 */
globalThis.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entree === "string" ? entree : entree.toString();
  journal.push({ url, methode: init?.method ?? "GET" });

  if (url.includes("/api/student/shopping-list/observed-prices")) {
    return new Response(
      JSON.stringify({
        budget: null,
        comparaison: null,
        couvertureMagasin: (globalThis as { __COUVERTURE?: string }).__COUVERTURE ?? "aucun_magasin",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.includes("/api/student/stores/search")) {
    return new Response(JSON.stringify({ magasins: MAGASINS, tronque: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/student/stores/select")) {
    // Le magasin devient ponté : c'est ce changement que la relecture doit voir.
    (globalThis as { __COUVERTURE?: string }).__COUVERTURE = "magasin_ponte";
    return new Response(
      JSON.stringify({
        magasin: { storeId: "store-1", name: "Lidl", brand: "Lidl", city: "Toulon" },
        couvertureMagasin: "magasin_ponte",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof globalThis.fetch;

/**
 * ⚠️ CONSTRUITE PAR LE CODE DE PRODUCTION, PAS À LA MAIN. Un littéral bricolé
 * (`jours: []`) casse `libellePeriode` — et l'aurait fait croire à une panne du
 * câblage alors que seule la fixture était fausse.
 */
const PERIODE = construirePeriode("2026-08-17", 7)!;

createRoot(document.getElementById("racine")!).render(
  createElement(ListeDeCoursesPersistante, {
    periode: PERIODE,
    lignesDuPlan: [],
    studentId: "eleve-1",
    restants: 0,
  }),
);

(globalThis as unknown as { __harnais: unknown }).__harnais = {
  lectures: (fragment: string) => journal.filter((a) => a.url.includes(fragment)).length,
  journal: () => journal.map((a) => `${a.methode} ${a.url}`),
  texte: () => document.body.innerText,
};
