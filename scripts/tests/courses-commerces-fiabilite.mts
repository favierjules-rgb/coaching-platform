/**
 * Harnais — COURSES : FIABILITÉ DE LA RECHERCHE, DE LA CARTE ET DU CHARGEMENT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS MESURE, ET POURQUOI IL EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * La Preview a montré trois défauts : la recherche par ville échouait une fois
 * sur deux, la carte annonçait « non configurée », et deux messages de
 * chargement se superposaient. Les deux premiers avaient une cause mesurable,
 * et c'est elle que ce fichier verrouille.
 *
 * ⚠️ LA CAUSE, MESURÉE LE 05/11/2026 SUR `overpass-api.de` :
 *   · `/api/status` annonce « Rate limit: 2 » — DEUX créneaux par adresse IP ;
 *   · une requête TRIVIALE (`node(1); out ids;`) a mis **20,4 s**, en pure
 *     attente de créneau ;
 *   · le chemin « par ville » enchaînait DEUX requêtes, donc deux attentes,
 *     contre une borne de 30 s. Le chemin GPS n'en fait qu'UNE.
 * D'où exactement : « le GPS marche, la ville échoue une fois sur deux ».
 *
 * ⚠️ AUCUN RÉSEAU DANS CE FICHIER. Les transports sont injectés : c'est ce qui
 * permet d'éprouver un 502, un 429, un timeout et une réponse illisible sans
 * dépendre de l'humeur d'un service bénévole.
 *
 * Lancement : npm run test:courses-fiabilite
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * ⚠️ L'AGENT EST POSÉ AVANT TOUT IMPORT D'OVERPASS, ET C'EST VOULU.
 * `userAgentOff()` LÈVE quand il manque — c'est une doctrine du dépôt : OSM et
 * Open Food Facts exigent un agent identifiant, et aucun repli générique n'est
 * fabriqué pour que l'oubli se voie au lieu de préparer un blocage. Le poser
 * ici est donc la condition pour éprouver l'adaptateur, pas un contournement :
 * la règle reste mesurée par les suites qui la vérifient.
 */
process.env.OPENFOODFACTS_USER_AGENT ??= "coaching-platform-tests/1.0 (contact: tests@local)";

import {
  OVERPASS_DELAI_TOTAL_MS,
  OVERPASS_REESSAIS_MAX,
  OVERPASS_TIMEOUT_MS,
  RAISONS_TEMPORAIRES,
  interrogerOverpass,
  pointsDEntreeOverpass,
  requeteCommercesDansCommune,
} from "../../lib/openstreetmap/overpass";
import { cadreDeLaRecherche } from "../../lib/cartographie/vue-magasins";
import { configurationCarte, messageCarteIndisponible } from "../../lib/cartographie/maptiler";
import {
  SITUATIONS_DE_CHARGEMENT,
  enChargement,
  libelleDuBouton,
  messageDeSituation,
  messageHorsBouton,
  resumeDeLaRecherche,
  situationApres,
} from "../../lib/nutrition/recherche-commerces";
import type { MagasinOsm } from "../../lib/nutrition/magasins-osm";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_RECHERCHE = sansProse(lire("../../components/student/RechercheDeCommerces.tsx"));
const CODE_CARTE = sansProse(lire("../../components/student/CarteDesMagasins.tsx"));
const CODE_DECOUVERTE = sansProse(lire("../../lib/openstreetmap/decouverte.ts"));
const CODE_ANNUAIRE = sansProse(lire("../../lib/communes/annuaire.ts"));
const ROUTE_SEARCH = sansProse(lire("../../app/api/student/stores/search/route.ts"));
const ROUTE_NEARBY = sansProse(lire("../../app/api/student/stores/nearby/route.ts"));

/** Les options d'un appel sans attente réelle ni horloge réelle. */
function sansAttente(reponses: readonly (number | "reseau" | "abandon")[]) {
  const appels: string[] = [];
  const pauses: number[] = [];
  let horloge = 0;
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    const n = appels.length;
    appels.push(url);
    // Chaque aller-retour consomme du temps : c'est ce qui épuise le délai total.
    horloge += 1_000;
    const consigne = reponses[Math.min(n, reponses.length - 1)]!;
    if (consigne === "reseau") throw new TypeError("Failed to fetch");
    if (consigne === "abandon") {
      const erreur = new Error("aborted");
      erreur.name = "AbortError";
      throw erreur;
    }
    const corps =
      consigne === 200
        ? JSON.stringify({
            elements: [
              { type: "node", id: 1, lat: 43.1, lon: 5.9, tags: { shop: "supermarket", name: "A" } },
            ],
          })
        : "# 502 Gateway Timeout\n\nThis Overpass API server is currently at capacity.";
    void init;
    return new Response(corps, { status: consigne });
  };
  return {
    appels,
    pauses,
    options: {
      transport: transport as never,
      attendre: async (ms: number) => {
        pauses.push(ms);
        horloge += ms;
      },
      maintenant: () => horloge,
    },
  };
}

function magasin(p: Partial<MagasinOsm> = {}): MagasinOsm {
  return {
    osmType: "NODE",
    osmId: 1,
    name: "Marché",
    brand: null,
    brandWikidata: null,
    operatorWikidata: null,
    city: "Toulon",
    postcode: "83000",
    countryCode: "FR",
    lat: 43.1364,
    lon: 5.9334,
    distanceKm: null,
    ...p,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1 à 4. LA RECHERCHE PAR VILLE — LA CAUSE DE L'INTERMITTENCE
   ══════════════════════════════════════════════════════════════════════════ */

test("F-01 — UNE SEULE REQUÊTE OVERPASS PAR RECHERCHE DE COMMUNE", async () => {
  /*
   * ⚠️ C'EST LE CORRECTIF PRINCIPAL. Deux requêtes, c'est deux attentes de
   * créneau — 40 à 60 s là où le chemin GPS en demande une. Le premier temps
   * servait à détecter l'ambiguïté des homonymes ; un code INSEE ne peut pas
   * être ambigu, donc il n'attendait que pour rien.
   */
  const { appels, options } = sansAttente([200]);
  const { decouvrirParCodeInsee } = await import("../../lib/openstreetmap/decouverte");
  const resultat = await decouvrirParCodeInsee("83137", options);
  assert.equal(appels.length, 1, "une requête, pas deux");
  assert.equal(resultat.statut, "ok");
});

test("F-02 — LA REQUÊTE VISE LA COMMUNE PAR SON CODE, ET FILTRE CE QUI Y ENTRE", () => {
  const requete = requeteCommercesDansCommune("83137");
  assert.match(requete, /area\["boundary"="administrative"\]\["admin_level"="8"\]\["ref:INSEE"="83137"\]/);
  assert.match(requete, /nwr\(area\.commune\)\["shop"~/, "les commerces sont cherchés DANS la zone");
  assert.match(requete, /out center tags/, "avec leurs coordonnées");
  // La Corse, et rien d'autre que des codes INSEE.
  assert.match(requeteCommercesDansCommune("2a004"), /"ref:INSEE"="2A004"/);
  for (const invalide of ["83", "8313X", '83137"]["x"="y', "", "831370"]) {
    assert.throws(() => requeteCommercesDansCommune(invalide), RangeError, invalide);
  }
});

test("F-03 — « AUCUN COMMERCE » N'EST PLUS CONFONDU AVEC « COMMUNE INTROUVABLE »", async () => {
  /*
   * ⚠️ EN UNE REQUÊTE, OVERPASS REND ZÉRO DANS LES DEUX CAS — et c'est
   * volontairement tranché en faveur de « aucun commerce ». Le code INSEE vient
   * d'être choisi dans l'annuaire officiel de l'État : la commune existe. Dire
   * « commune introuvable » enverrait l'élève corriger une saisie correcte.
   */
  const vide = async () => new Response(JSON.stringify({ elements: [] }), { status: 200 });
  const { decouvrirParCodeInsee } = await import("../../lib/openstreetmap/decouverte");
  const resultat = await decouvrirParCodeInsee("83137", { transport: vide as never });
  assert.equal(resultat.statut, "ok");
  if (resultat.statut === "ok") {
    assert.deepEqual(resultat.magasins, []);
    assert.equal(resultat.tronque, false);
  }
});

test("F-04 — LA BORNE LOCALE DÉPASSE L'ATTENTE DE CRÉNEAU MESURÉE", () => {
  // Mesuré : 20,4 s d'attente pour une requête triviale, 28 à 32 s pour une
  // vraie. Une borne à 30 s tombait pile dans cette zone — d'où l'intermittence.
  assert.ok(OVERPASS_TIMEOUT_MS >= 40_000, `${OVERPASS_TIMEOUT_MS} ms : sous l'attente observée`);
  assert.ok(OVERPASS_DELAI_TOTAL_MS >= OVERPASS_TIMEOUT_MS, "le délai total couvre au moins une tentative");
  // ⚠️ ET LA FONCTION SERVERLESS DOIT POUVOIR ATTENDRE AUTANT. Sans cela,
  // l'hébergeur coupe avant nous et aucun de nos messages n'a la parole.
  for (const [nom, route] of [["search", ROUTE_SEARCH], ["nearby", ROUTE_NEARBY]] as const) {
    assert.match(route, /export const maxDuration = 60;/, `${nom} doit pouvoir attendre`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   5 à 8. LES ERREURS TEMPORAIRES, LES RÉESSAIS, ET LEURS BORNES
   ══════════════════════════════════════════════════════════════════════════ */

test("F-05 — UN 502 « AT CAPACITY » EST RÉESSAYÉ, AVEC UNE PAUSE QUI DOUBLE", async () => {
  /*
   * Le corps du 502 d'`overpass-api.de` dit, textuellement : « Retry your
   * request using exponential backoff ». C'est l'amont qui le prescrit.
   */
  const { appels, pauses, options } = sansAttente([502, 502, 200]);
  const reponse = await interrogerOverpass("[out:json];node(1);out;", options);
  assert.equal(reponse.statut, "success");
  assert.equal(appels.length, 3, "deux réessais, puis le succès");
  assert.equal(pauses.length, 2);
  assert.ok(pauses[1]! > pauses[0]!, "la pause double");
});

test("F-06 — UN 429 N'EST JAMAIS RÉESSAYÉ : la politique demande une PAUSE", () => {
  assert.ok(!RAISONS_TEMPORAIRES.has("rate_limited"), "429 hors des raisons temporaires");
  // Et les réponses illisibles non plus : les rejouer ne les répare pas.
  assert.ok(!RAISONS_TEMPORAIRES.has("invalid_json"));
  assert.ok(!RAISONS_TEMPORAIRES.has("invalid_envelope"));
  assert.deepEqual([...RAISONS_TEMPORAIRES].sort(), ["at_capacity", "timeout", "unavailable"]);
});

test("F-07 — UN 429 S'ARRÊTE AU PREMIER APPEL", async () => {
  const { appels, options } = sansAttente([429, 200]);
  const reponse = await interrogerOverpass("[out:json];node(1);out;", options);
  assert.equal(reponse.statut, "echec");
  if (reponse.statut === "echec") assert.equal(reponse.raison, "rate_limited");
  assert.equal(appels.length, 1, "aucun réessai : réessayer tout de suite fait bannir");
});

test("F-08 — LES RÉESSAIS SONT BORNÉS, ET NE SATURENT PAS L'AMONT", async () => {
  const { appels, options } = sansAttente([502]);
  const reponse = await interrogerOverpass("[out:json];node(1);out;", options);
  assert.equal(reponse.statut, "echec");
  if (reponse.statut === "echec") assert.equal(reponse.raison, "at_capacity");
  assert.equal(
    appels.length,
    OVERPASS_REESSAIS_MAX + 1,
    "au plus deux tentatives supplémentaires, jamais une boucle",
  );
});

test("F-09 — UN RÉESSAI QU'ON NE PEUT PAS FINIR N'EST PAS LANCÉ", async () => {
  /*
   * ⚠️ LE DÉLAI TOTAL DÉCIDE, PAS LE COMPTEUR. Une tentative lancée alors que la
   * fonction va être coupée prend un créneau Overpass à quelqu'un d'autre pour
   * un résultat que personne ne lira.
   */
  const { appels, options } = sansAttente([502]);
  const reponse = await interrogerOverpass("[out:json];node(1);out;", {
    ...options,
    delaiTotalMs: 1_500,
  });
  assert.equal(reponse.statut, "echec");
  assert.equal(appels.length, 1, "le délai total ne permettait pas un second aller-retour");
});

test("F-10 — UNE PANNE RÉSEAU ET UN ABANDON SONT CLASSÉS, PAS CONFONDUS", async () => {
  const reseau = await interrogerOverpass("[out:json];node(1);out;", {
    ...sansAttente(["reseau"]).options,
    delaiTotalMs: 1_000,
  });
  assert.equal(reseau.statut, "echec");
  if (reseau.statut === "echec") assert.equal(reseau.raison, "unavailable");

  const abandon = await interrogerOverpass("[out:json];node(1);out;", {
    ...sansAttente(["abandon"]).options,
    delaiTotalMs: 1_000,
  });
  assert.equal(abandon.statut, "echec");
  if (abandon.statut === "echec") assert.equal(abandon.raison, "timeout");
});

test("F-11 — UNE RÉPONSE ILLISIBLE N'EST NI RÉESSAYÉE NI PRISE POUR UN VIDE", async () => {
  const illisible = async () => new Response("<html>oups</html>", { status: 200 });
  const { appels, options } = sansAttente([200]);
  void appels;
  const reponse = await interrogerOverpass("[out:json];node(1);out;", {
    ...options,
    transport: illisible as never,
  });
  assert.equal(reponse.statut, "echec");
  if (reponse.statut === "echec") assert.equal(reponse.raison, "invalid_json");
});

test("F-12 — UN SEUL POINT D'ENTRÉE PAR DÉFAUT : aucun tiers ajouté en douce", () => {
  const points = pointsDEntreeOverpass();
  assert.equal(points.length, 1);
  assert.match(points[0]!, /^https:\/\/overpass-api\.de\//);
  // Et la variable qui permettrait d'en déclarer d'autres n'est pas publique :
  // c'est le serveur qui parle à Overpass, pour que la position n'en sorte pas.
  const code = sansProse(lire("../../lib/openstreetmap/overpass.ts"));
  assert.ok(code.includes("process.env.OVERPASS_ENDPOINTS"));
  assert.ok(!code.includes("NEXT_PUBLIC_OVERPASS"), "jamais exposée au navigateur");
});

/* ══════════════════════════════════════════════════════════════════════════
   9 à 11. LES MESSAGES : CHAQUE PANNE A LE SIEN
   ══════════════════════════════════════════════════════════════════════════ */

test("F-13 — UNE SATURATION NE SE DIT PAS COMME UNE PANNE", async () => {
  const { httpDecouverte } = await import("../../lib/openstreetmap/decouverte");
  assert.deepEqual(httpDecouverte("at_capacity"), { status: 503, code: "ANNUAIRE_SATURE" });
  assert.deepEqual(httpDecouverte("unavailable"), { status: 503, code: "ANNUAIRE_INDISPONIBLE" });
  assert.notEqual(
    httpDecouverte("at_capacity").code,
    httpDecouverte("unavailable").code,
    "deux causes, deux codes : les journaux doivent pouvoir les distinguer",
  );
  // Et les deux routes le disent à l'élève, avec les mêmes mots.
  for (const [nom, route] of [["search", ROUTE_SEARCH], ["nearby", ROUTE_NEARBY]] as const) {
    assert.match(route, /case "at_capacity":/, `${nom} distingue la saturation`);
    assert.match(route, /saturé en ce moment/, `${nom} le dit à l'élève`);
  }
});

test("F-14 — UNE ERREUR RÉSEAU N'EST JAMAIS PRÉSENTÉE COMME UNE ABSENCE", () => {
  const panne = messageDeSituation("erreur", { mode: "ville", tronque: false })!;
  const vide = messageDeSituation("aucun_resultat", { mode: "ville", tronque: false })!;
  assert.notEqual(panne.texte, vide.texte);
  assert.ok(!/aucun commerce/i.test(panne.texte), "une panne ne dit pas « aucun commerce »");
  assert.equal(panne.role, "alert");
  assert.equal(vide.role, "status", "une absence constatée n'est pas une alerte");
});

test("F-15 — LES JOURNAUX SERVEUR SONT EXPLOITABLES, ET SANS DONNÉE PERSONNELLE", () => {
  /*
   * ⚠️ CE QU'ON JOURNALISE : la raison, le mode, la durée, le département.
   * CE QU'ON NE JOURNALISE PAS : le nom de la commune, le code INSEE complet,
   * l'identité de l'élève, et surtout aucune coordonnée.
   */
  assert.match(ROUTE_SEARCH, /console\.warn\(/, "une trace existe");
  assert.match(ROUTE_SEARCH, /raison=\$\{resultat\.raison\}/);
  assert.match(ROUTE_SEARCH, /duree_ms=/);
  assert.match(ROUTE_SEARCH, /dept=/, "le département suffit, et ne désigne personne");
  /*
   * ⚠️ ON ISOLE LES LIGNES DE JOURNAL, ON NE BALAIE PAS LE FICHIER. `lat=` et
   * `ville` apparaissent légitimement ailleurs dans la route : un balayage
   * global accuserait la recherche elle-même de divulguer, et pousserait, pour
   * obtenir du vert, à casser ce qui marche.
   */
  const journaux = [...ROUTE_SEARCH.matchAll(/console\.(warn|error|log)\([\s\S]{0,400}?\);/g)].map(
    (m) => m[0],
  );
  assert.ok(journaux.length >= 1, "au moins une trace");
  for (const ligne of journaux) {
    for (const interdit of ["${ville", "${villeSaisie", "user.id", "eleve.id", "parsed.data.lat"]) {
      assert.ok(!ligne.includes(interdit), `donnée personnelle journalisée : ${interdit}`);
    }
    assert.ok(
      !/codeInsee\}/.test(ligne) || ligne.includes("slice(0, 2)"),
      "le code INSEE complet ne sort pas : seul le département",
    );
  }
  assert.match(ROUTE_NEARBY, /console\.warn\(/);
  assert.ok(!/console\.warn[\s\S]{0,300}parsed\.data\.lat/.test(ROUTE_NEARBY), "aucune position journalisée");
});

/* ══════════════════════════════════════════════════════════════════════════
   12 à 14. LA CARTE SANS GPS
   ══════════════════════════════════════════════════════════════════════════ */

test("F-16 — EN MODE VILLE, LA CARTE SE CENTRE SUR LA COMMUNE, SANS AUCUN GPS", () => {
  const centre = { lat: 43.1364, lon: 5.9334 };
  const cadre = cadreDeLaRecherche([], null, centre);
  assert.ok(cadre !== null, "un centre de commune suffit à cadrer");
  assert.ok(cadre!.sudOuest.lat < centre.lat && cadre!.nordEst.lat > centre.lat);
  assert.ok(cadre!.sudOuest.lon < centre.lon && cadre!.nordEst.lon > centre.lon);
  // Assez large pour montrer une ville, pas un carrefour.
  assert.ok(cadre!.nordEst.lat - cadre!.sudOuest.lat > 0.05);
});

test("F-17 — LES COMMERCES PASSENT DEVANT LE CENTRE DE COMMUNE", () => {
  /*
   * Le centre administratif peut tomber loin des commerces dans une commune
   * étendue. Tant qu'il y a des résultats, ce sont eux que l'élève est venu
   * voir : le centre n'est qu'un dernier recours.
   */
  const centre = { lat: 48.8566, lon: 2.3522 };
  const cadre = cadreDeLaRecherche([magasin({ lat: 43.1, lon: 5.9 })], null, centre);
  assert.ok(cadre!.sudOuest.lat < 43.2 && cadre!.nordEst.lat > 43.0, "cadré sur le commerce");
  assert.ok(cadre!.nordEst.lat < 44, "et pas sur Paris");
});

test("F-18 — LE MODE GPS N'EMPRUNTE PAS LE CENTRE DE COMMUNE, ET RÉCIPROQUEMENT", () => {
  // Chaque mode a sa source de centrage. Utiliser la position de l'élève pour
  // centrer une recherche « par ville » montrerait où il EST, pas où il cherche.
  assert.match(CODE_RECHERCHE, /setCentreCommune\(commune\?\.centre \?\? null\)/);
  assert.match(CODE_RECHERCHE, /setCentreCommune\(null\)/, "effacé en mode autour");
  assert.ok(
    !/depart=\{centreCommune\}|centreCommune=\{depart\}/.test(CODE_RECHERCHE),
    "aucun des deux ne sert de repli à l'autre",
  );
});

test("F-19 — « PAS DE CLÉ » ET « PAS DE COORDONNÉES » SONT DEUX MESSAGES", () => {
  /*
   * ⚠️ LES CONFONDRE ENVOIE CHERCHER LE PROBLÈME AU MAUVAIS ENDROIT : on irait
   * vérifier une variable d'environnement alors que c'est la recherche qui n'a
   * rien rendu, ou l'inverse. C'est exactement ce qui s'est passé en Preview.
   */
  const sansCle = messageCarteIndisponible("cle_absente");
  assert.match(sansCle, /n'est pas configurée/i);
  assert.match(CODE_CARTE, /Rien à afficher sur la carte/, "le cas « aucun point » a son message");
  assert.ok(
    !new RegExp("Rien à afficher[^\"]*configur", "i").test(CODE_CARTE),
    "et il ne parle pas de configuration",
  );
  // L'ordre compte : sans clé, la question des coordonnées ne se pose pas.
  const iCle = CODE_CARTE.indexOf('config.statut === "indisponible"');
  const iPoints = CODE_CARTE.indexOf("cadreDeLaRecherche(magasins, depart, centreCommune) === null");
  assert.ok(iCle > 0 && iPoints > iCle, "la clé est jugée avant les coordonnées");
});

test("F-20 — SANS CLÉ, LA LISTE RESTE UTILISABLE ET LA CARTE LE DIT", () => {
  for (const raison of ["cle_absente", "cle_par_defaut", "style_interdit"] as const) {
    assert.match(messageCarteIndisponible(raison), /liste des commerces reste utilisable/i);
  }
  // Une clé invalide côté fournisseur (restriction d'origine, quota) se voit à
  // l'exécution : MapLibre émet `error`, et l'écran bascule sur un message.
  assert.match(CODE_CARTE, /instance\.on\("error"/);
  assert.match(CODE_CARTE, /momentanément indisponible/);
  // Et la configuration distingue bien une clé absente d'une clé de démo.
  assert.equal(configurationCarte({ cle: "" }).statut, "indisponible");
  assert.equal(configurationCarte({ cle: "une-vraie-cle" }).statut, "prete");
});

/* ══════════════════════════════════════════════════════════════════════════
   15 à 17. LE CHARGEMENT : IL SE TERMINE, ET IL NE PARLE QU'UNE FOIS
   ══════════════════════════════════════════════════════════════════════════ */

const TOUTES_LES_ISSUES = [
  { type: "trouves", nombre: 3 },
  { type: "trouves", nombre: 0 },
  { type: "echec" },
  { type: "permission_refusee" },
  { type: "position_indisponible" },
  { type: "position_expiree" },
] as const;

test("F-21 — AUCUNE ISSUE NE LAISSE UN INDICATEUR TOURNER", () => {
  for (const issue of TOUTES_LES_ISSUES) {
    assert.ok(!enChargement(situationApres(issue)), `${issue.type}`);
  }
  // Et la recherche de commune, qui est une quatrième situation de chargement,
  // se termine dans un `finally` — succès, 503, abandon ou exception.
  assert.ok(SITUATIONS_DE_CHARGEMENT.has("chargement_commune"));
  assert.match(CODE_RECHERCHE, /\.finally\(\(\) => \{/, "un finally sur les suggestions");
  assert.match(CODE_RECHERCHE, /actuelle === "chargement_commune" \? "repos" : actuelle/);
  assert.equal(
    (CODE_RECHERCHE.match(/finally \{/g) ?? []).length,
    2,
    "un finally par recherche, et le verrou y est rendu",
  );
});

test("F-22 — UN SEUL MESSAGE DE CHARGEMENT, ET C'EST LE BOUTON QUI LE PORTE", () => {
  /*
   * ⚠️ LE DOUBLON CONSTATÉ EN PREVIEW : le bouton disait « RECHERCHE EN
   * COURS… » pendant qu'un encadré juste en dessous disait « Recherche des
   * commerces autour de toi… ». Deux fois la même information, et deux fois
   * annoncée pour un lecteur d'écran.
   */
  for (const situation of ["chargement_commune", "permission", "chargement_autour", "chargement_ville"] as const) {
    assert.equal(
      messageHorsBouton(situation, { mode: "autour", tronque: false }),
      null,
      `${situation} : rien hors du bouton`,
    );
    assert.notEqual(libelleDuBouton(situation, "autour"), "", `${situation} : le bouton parle`);
  }
  // Hors chargement, le message reprend sa place.
  assert.notEqual(messageHorsBouton("erreur", { mode: "autour", tronque: false }), null);
});

test("F-23 — LE BOUTON NOMME L'ÉTAPE, PAS « EN COURS »", () => {
  assert.match(libelleDuBouton("chargement_commune", "ville"), /commune/i);
  assert.match(libelleDuBouton("permission", "autour"), /localisation/i);
  assert.match(libelleDuBouton("chargement_autour", "autour"), /commerces/i);
  assert.match(libelleDuBouton("chargement_ville", "ville"), /commerces/i);
  // Au repos, il redit ce qu'il fait.
  assert.equal(libelleDuBouton("repos", "autour"), "Chercher autour de moi");
  assert.equal(libelleDuBouton("repos", "ville"), "Rechercher");
  // Les quatre étapes de chargement sont distinctes de l'état de repos.
  const etapes = new Set(
    (["chargement_commune", "permission", "chargement_autour"] as const).map((s) =>
      libelleDuBouton(s, "autour"),
    ),
  );
  assert.equal(etapes.size, 3, "trois étapes, trois libellés");
});

test("F-24 — L'INDICATEUR EST CELUI DU DÉPÔT, ET IL S'ANNONCE", () => {
  // ⚠️ PAS UN CERCLE ÉCRIT POUR L'OCCASION : `components/ui/Loader.tsx` porte
  // une doctrine explicite, et gère déjà role/aria/mouvement réduit.
  assert.match(CODE_RECHERCHE, /import \{ Loader \} from "@\/components\/ui\/Loader"/);
  assert.match(CODE_RECHERCHE, /<Loader variante="inline"/);
  assert.match(CODE_RECHERCHE, /aria-busy=\{occupe\}/, "le bouton se déclare occupé");
  assert.match(CODE_RECHERCHE, /aria-live="polite"/, "une région annonçable");
  assert.match(CODE_RECHERCHE, /disabled=\{occupe/, "et il ne se reclique pas");
  const loader = lire("../../components/ui/Loader.tsx");
  assert.match(loader, /role="status"/);
  assert.match(loader, /sr-only/);
});

test("F-25 — UNE RECHERCHE REMPLACÉE EST ANNULÉE, PAS LAISSÉE EN COURSE", () => {
  /*
   * ⚠️ LE VERROU NE SUFFIT PAS. Il empêche deux départs simultanés ; il
   * n'empêche pas la réponse d'une recherche abandonnée d'arriver APRÈS la
   * nouvelle et d'écraser ses résultats — l'élève verrait les commerces d'une
   * autre commune.
   */
  assert.match(CODE_RECHERCHE, /recherche\.current\?\.abort\(\)/);
  assert.match(CODE_RECHERCHE, /signal: controleur\.signal/);
  assert.equal(
    (CODE_RECHERCHE.match(/signal: controleur\.signal/g) ?? []).length,
    3,
    "les trois appels sont annulables : suggestions, autour, commune",
  );
  assert.match(CODE_RECHERCHE, /if \(controleur\.signal\.aborted\) return;/, "un abandon n'est pas une panne");
  assert.match(CODE_RECHERCHE, /return \(\) => \{\s*recherche\.current\?\.abort\(\);/, "ni au démontage");
});

test("F-26 — LES CLICS MULTIPLES NE LANCENT QU'UNE RECHERCHE", () => {
  // Le verrou est synchrone, comme celui de la validation des repas : un état
  // React ne serait effectif qu'au rendu suivant, trop tard pour un double tap.
  assert.match(CODE_RECHERCHE, /if \(enVol\.current\) return;/);
  assert.equal(
    (CODE_RECHERCHE.match(/if \(enVol\.current\) return;/g) ?? []).length,
    2,
    "les deux recherches sont gardées",
  );
  assert.equal((CODE_RECHERCHE.match(/enVol\.current = false/g) ?? []).length, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   ERGONOMIE
   ══════════════════════════════════════════════════════════════════════════ */

test("F-27 — L'ÉCRAN DIT CE QUI A ÉTÉ CHERCHÉ, ET COMBIEN A ÉTÉ TROUVÉ", () => {
  assert.equal(resumeDeLaRecherche(12, { mode: "autour", rayonKm: 5 }), "12 commerces à moins de 5 km");
  assert.equal(resumeDeLaRecherche(1, { mode: "ville", commune: "Toulon" }), "1 commerce à Toulon");
  assert.equal(resumeDeLaRecherche(0, { mode: "ville", commune: "Toulon" }), "0 commerce à Toulon");
  assert.match(CODE_RECHERCHE, /resumeDeLaRecherche\(magasins\.length/);
});

test("F-28 — L'ANNUAIRE REND LE CENTRE DE LA COMMUNE, ET NE L'INVENTE PAS", () => {
  assert.match(CODE_ANNUAIRE, /fields=nom,code,codesPostaux,centre/, "le centre est demandé");
  assert.match(CODE_ANNUAIRE, /function centreValide/);
  // Les coordonnées GeoJSON sont [lon, lat] : inverser placerait Toulon ailleurs.
  const brut = lire("../../lib/communes/annuaire.ts");
  assert.match(brut, /const \[lon, lat\] = coords;/, "l'ordre GeoJSON est respecté");
  assert.match(brut, /Math\.abs\(lat\) > 90 \|\| Math\.abs\(lon\) > 180/, "et borné");
});

test("F-29 — LA RECHERCHE PAR NOM RESTE DISPONIBLE, ET ELLE SEULE PEUT ÊTRE AMBIGUË", () => {
  // Le repli existe pour le jour où l'annuaire des communes est muet ; c'est
  // lui, et lui seul, qui peut encore répondre « plusieurs communes ».
  assert.match(CODE_DECOUVERTE, /export async function decouvrirParVille/);
  assert.match(CODE_DECOUVERTE, /ville_ambigue/);
  const parInsee = CODE_DECOUVERTE.slice(
    CODE_DECOUVERTE.indexOf("export async function decouvrirParCodeInsee"),
  ).slice(0, 1200);
  assert.ok(!parInsee.includes("ville_ambigue"), "un code INSEE ne peut pas être ambigu");
  assert.ok(!parInsee.includes("ville_introuvable"), "ni introuvable : il vient de l'annuaire");
});

test("F-30 — LES TROIS REFUS DE GÉOLOCALISATION RESTENT DISTINCTS", async () => {
  /*
   * ⚠️ LA CORRECTION DE LA RECHERCHE PAR VILLE NE DOIT RIEN CASSER DU CHEMIN
   * GPS, QUI MARCHE. Ce contrôle est là pour ça : il échouerait si la refonte
   * des états avait aplati les trois refus en une seule panne.
   */
  const { issueDeGeolocalisation: issue } = await import(
    "../../lib/nutrition/recherche-commerces"
  );
  assert.deepEqual(issue(1), { type: "permission_refusee" });
  assert.deepEqual(issue(2), { type: "position_indisponible" });
  assert.deepEqual(issue(3), { type: "position_expiree" });
  for (const code of [1, 2, 3]) {
    const message = messageDeSituation(situationApres(issue(code)), {
      mode: "autour",
      tronque: false,
    })!;
    assert.equal(message.role, "status", `code ${code} : un refus n'est pas une panne`);
  }
  // Et le chemin GPS fait toujours UNE seule requête Overpass : la correction
  // n'a pas ajouté de tour à ce qui fonctionnait.
  const { appels, options } = sansAttente([200]);
  const { decouvrirAutour } = await import("../../lib/openstreetmap/decouverte");
  await decouvrirAutour({ lat: 43.1, lon: 5.9, rayonKm: 5 }, options);
  assert.equal(appels.length, 1);
});
