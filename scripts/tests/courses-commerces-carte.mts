/**
 * Harnais — COURSES : RECHERCHE DE COMMERCES ET CARTOGRAPHIE (phases 4 à 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS PROUVE, ET CE QU'IL NE PEUT PAS PROUVER
 * ────────────────────────────────────────────────────────────────────────────
 * Il prouve ce qui est DÉCIDÉ : la séparation du moteur de recherche et du
 * fournisseur de carte, l'impossibilité d'un chargement permanent, la
 * correspondance exacte marqueurs ↔ résultats, le cadrage, l'itinéraire, les
 * bornes du rayon, l'anti-rafale, et les états visuels distincts.
 *
 * ⚠️ IL NE DESSINE AUCUNE CARTE. MapLibre a besoin de WebGL, que cette machine
 * n'a pas. Le rendu réel se vérifie dans un navigateur ; ce qui se vérifie ici,
 * c'est que tout ce qui ENTOURE le dessin est juste — et c'est précisément là
 * que vivaient les défauts.
 *
 * ⚠️ AUCUNE MIGRATION DANS CE LOT. `S-01` le vérifie.
 *
 * Lancement : npm run test:courses-commerces
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cadreDeLaRecherche,
  cadreDesPoints,
  marqueursDepuisMagasins,
  urlItineraire,
} from "../../lib/cartographie/vue-magasins";
import {
  ATTRIBUTIONS_REQUISES,
  ORIGINE_FOND_DE_CARTE,
  STYLE_PAR_DEFAUT,
  classerErreurDeCarte,
  configurationCarte,
  messageCarteIndisponible,
} from "../../lib/cartographie/fond-de-carte";
import {
  ANTI_RAFALE_MS,
  SAISIE_MAX,
  SAISIE_MIN,
  SUGGESTIONS_MAX,
  codeInseeValide,
  departementDuCodeInsee,
} from "../../lib/communes/bornes";
import { cleIdentiteOsm, type MagasinOsm } from "../../lib/nutrition/magasins-osm";
import { RAYON_KM_MAX, RAYON_KM_MIN } from "../../lib/nutrition/magasin-proche";
import {
  MODES,
  RAYONS_PROPOSES,
  SITUATIONS_DE_CHARGEMENT,
  enChargement,
  issueDeGeolocalisation,
  messageDeSituation,
  rayonUtilisable,
  situationApres,
  type Issue,
  type Situation,
} from "../../lib/nutrition/recherche-commerces";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_CARTE = sansProse(lire("../../components/student/CarteDesMagasins.tsx"));
const CODE_RECHERCHE = sansProse(lire("../../components/student/RechercheDeCommerces.tsx"));
const CODE_FOND = sansProse(lire("../../lib/cartographie/fond-de-carte.ts"));
const CODE_VUE = sansProse(lire("../../lib/cartographie/vue-magasins.ts"));
const CODE_ANNUAIRE = sansProse(lire("../../lib/communes/annuaire.ts"));
const CODE_DECOUVERTE = sansProse(lire("../../lib/openstreetmap/decouverte.ts"));
const CODE_ROUTE_COMMUNES = sansProse(lire("../../app/api/student/stores/communes/route.ts"));
const CODE_ROUTE_SEARCH = sansProse(lire("../../app/api/student/stores/search/route.ts"));
const CODE_CHOIX = sansProse(lire("../../components/student/ChoixMagasinProche.tsx"));

function magasin(p: Partial<MagasinOsm>): MagasinOsm {
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
   16. LE MOTEUR DE RECHERCHE ET LE FOURNISSEUR DE CARTE SONT SÉPARÉS
   ══════════════════════════════════════════════════════════════════════════ */

test("S-01 — AUCUNE MIGRATION, AUCUNE TABLE NOUVELLE DANS CE LOT", () => {
  for (const code of [CODE_FOND, CODE_VUE, CODE_ANNUAIRE]) {
    for (const interdit of ["alter table", "create table", "insert into", ".upsert(", ".insert("]) {
      assert.ok(!code.toLowerCase().includes(interdit), `aucune écriture (${interdit})`);
    }
  }
});

test("S-02 — LA CARTE NE CHERCHE RIEN : aucun appel, aucune route, aucune commune", () => {
  /*
   * ⚠️ C'EST LA CONTRAINTE D'ARCHITECTURE, ET ELLE SE MESURE PAR L'ABSENCE.
   * Le composant de carte reçoit une liste déjà trouvée. S'il savait chercher,
   * il existerait deux chemins de recherche à maintenir d'accord, et une panne
   * du fournisseur de carte pourrait emporter la recherche.
   */
  for (const interdit of [
    "fetch(",
    "/api/student/stores",
    "overpass",
    "Overpass",
    "codeInsee",
    "commune",
    "navigator.geolocation",
  ]) {
    assert.ok(!CODE_CARTE.includes(interdit), `la carte ignore la recherche (${interdit})`);
  }
});

test("S-03 — LE MOTEUR DE RECHERCHE NE CONNAÎT PAS LE FOURNISSEUR DE CARTE", () => {
  /*
   * Réciproque du précédent : aucun module de recherche ne nomme le
   * fournisseur de fond ni MapLibre.
   *
   * ⚠️ CETTE SÉPARATION VIENT D'ÊTRE ÉPROUVÉE POUR DE BON. Passer de MapTiler
   * à OpenFreeMap n'a touché ni `lib/openstreetmap/`, ni `lib/communes/`, ni
   * les routes : un seul fichier de configuration a été réécrit. C'est
   * exactement ce que ce contrôle protège.
   */
  for (const [nom, code] of [
    ["découverte", CODE_DECOUVERTE],
    ["annuaire des communes", CODE_ANNUAIRE],
    ["route /communes", CODE_ROUTE_COMMUNES],
    ["route /search", CODE_ROUTE_SEARCH],
  ] as const) {
    for (const interdit of ["openfreemap", "OpenFreeMap", "maptiler", "maplibre", "MapLibre", "tuile"]) {
      assert.ok(!code.includes(interdit), `${nom} ignore la cartographie (${interdit})`);
    }
  }
});

test("S-04 — UN SEUL ENDROIT CONNAÎT L'ORIGINE DU FOURNISSEUR", () => {
  /*
   * ⚠️ LA MIGRATION A PROUVÉ L'INTÉRÊT DE CE CONTRÔLE. L'origine n'est citée
   * qu'à un seul endroit du code applicatif : changer de fournisseur, c'est
   * réécrire ce fichier-là, et rien d'autre.
   */
  assert.equal(
    (CODE_FOND.match(/tiles\.openfreemap\.org/g) ?? []).length,
    1,
    "une seule occurrence : la constante d'origine",
  );
  assert.equal(ORIGINE_FOND_DE_CARTE, "https://tiles.openfreemap.org");
  assert.ok(STYLE_PAR_DEFAUT.startsWith(ORIGINE_FOND_DE_CARTE), "le style en découle");
  assert.ok(!CODE_CARTE.includes("openfreemap"), "le composant ne compose aucune URL");
  assert.ok(!CODE_RECHERCHE.includes("openfreemap"));
  // Et l'ancien fournisseur a complètement disparu du code applicatif.
  for (const [nom, code] of [
    ["fond de carte", CODE_FOND],
    ["composant carte", CODE_CARTE],
    ["recherche", CODE_RECHERCHE],
  ] as const) {
    assert.ok(!/maptiler/i.test(code), `${nom} ne mentionne plus l'ancien fournisseur`);
  }
});

test("S-05 — AUCUN GÉOCODAGE CHEZ LE FOURNISSEUR DE CARTE", () => {
  // Les coordonnées viennent d'OSM, déjà présentes dans `MagasinOsm`. Un
  // géocodage chez le fournisseur de fond lui ferait connaître chaque
  // commerce affiché et chaque ville tapée — exactement le mélange que
  // l'architecture refuse.
  for (const interdit of ["geocoding", "geocode", "/geocoding/"]) {
    assert.ok(!CODE_FOND.includes(interdit) && !CODE_CARTE.includes(interdit), interdit);
  }
  // ⚠️ LUE DANS LA SOURCE BRUTE : cette garantie est écrite en commentaire, et
  // `sansProse` retire précisément les commentaires.
  assert.ok(
    lire("../../lib/cartographie/vue-magasins.ts").includes("aucun appel à un service de géocodage"),
    "la garantie est écrite là où elle s'applique",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   17 à 19. UN FOURNISSEUR SANS CLÉ, SES SEULES PANNES, ET L'ATTRIBUTION

   ⚠️ CETTE SECTION A CHANGÉ DE NATURE AVEC LA MIGRATION. Elle vérifiait une
   clé : sa présence, sa validité, son encodage, sa restriction d'origine, son
   plafond de dépense. Il n'y a plus de clé. Ce qui se vérifie désormais, c'est
   que l'absence de clé est RÉELLE — rien à renseigner pour que la carte
   marche — et que la seule porte restée ouverte, la surcharge de style, ne
   laisse pas sortir de l'origine déclarée dans la CSP.
   ══════════════════════════════════════════════════════════════════════════ */

test("S-06 — SANS AUCUNE VARIABLE, LA CARTE EST PRÊTE", () => {
  /*
   * ⚠️ C'EST LE TEST DE NON-RÉGRESSION DE LA PANNE LA PLUS LONGUE DE CE
   * CHANTIER. L'ancien fournisseur rendait « indisponible » dès que sa clé
   * manquait, et elle manquait en Preview. Cet état n'existe plus : il n'y a
   * rien à renseigner. Si un jour quelqu'un réintroduit une variable
   * obligatoire, ce test tombe.
   */
  for (const styleUrl of [undefined, "", "   "]) {
    const config = configurationCarte({ styleUrl });
    assert.equal(config.statut, "prete", `sans surcharge (${JSON.stringify(styleUrl)})`);
    if (config.statut !== "prete") continue;
    assert.equal(config.urlDuStyle, STYLE_PAR_DEFAUT);
    assert.equal(config.urlDuStyle, "https://tiles.openfreemap.org/styles/liberty");
  }
  // Et la lecture d'environnement n'exige pas davantage : la variable est
  // facultative, ce que `configurationDepuisEnv` doit refléter sans détour.
  assert.ok(
    CODE_FOND.includes("process.env.NEXT_PUBLIC_CARTE_STYLE_URL"),
    "la variable est lue littéralement, sinon Next ne la remplace pas",
  );
  assert.ok(!/process\.env\.NEXT_PUBLIC_[A-Z_]*(KEY|CLE|TOKEN)/.test(CODE_FOND), "aucune clé lue");
});

test("S-07 — UNE SURCHARGE ILLISIBLE OU NON CHIFFRÉE EST REFUSÉE", () => {
  // Une variable publique est modifiable par qui déploie, pas seulement par
  // qui écrit le code. Elle doit être validée comme une entrée.
  for (const styleUrl of [
    "pas une url",
    "/styles/liberty",
    "http://tiles.openfreemap.org/styles/liberty",
    "javascript:alert(1)",
  ]) {
    const config = configurationCarte({ styleUrl });
    assert.equal(config.statut, "indisponible", styleUrl);
    if (config.statut === "indisponible") assert.equal(config.raison, "style_invalide", styleUrl);
  }
});

test("S-08 — UNE SURCHARGE HORS DE L'ORIGINE DÉCLARÉE EST REFUSÉE, ET LE DIT", () => {
  /*
   * ⚠️ POURQUOI REFUSER PLUTÔT QUE LAISSER PASSER : la CSP n'ouvre qu'un
   * hôte. Une URL ailleurs partirait, la politique la bloquerait, et il ne
   * resterait qu'un cadre gris à déboguer. Le code préfère le dire.
   */
  for (const styleUrl of [
    "https://api.maptiler.com/maps/streets/style.json",
    "https://tiles.openfreemap.org.exemple.fr/styles/liberty",
    "https://exemple.fr/styles/liberty",
  ]) {
    const config = configurationCarte({ styleUrl });
    assert.equal(config.statut, "indisponible", styleUrl);
    if (config.statut === "indisponible") assert.equal(config.raison, "origine_interdite", styleUrl);
  }
  // Un autre style SUR la bonne origine, lui, est accepté : la restriction
  // porte sur l'hôte, pas sur le chemin.
  const autre = configurationCarte({ styleUrl: `${ORIGINE_FOND_DE_CARTE}/styles/bright` });
  assert.equal(autre.statut, "prete");
});

test("S-09 — CHAQUE INDISPONIBILITÉ GARDE LA LISTE UTILISABLE, SANS NOMMER PERSONNE", () => {
  const raisons = ["style_invalide", "origine_interdite"] as const;
  for (const raison of raisons) {
    const message = messageCarteIndisponible(raison);
    assert.match(message, /liste des commerces reste utilisable/i, raison);
    // L'élève n'a que faire du nom du fournisseur : ce n'est pas son problème.
    assert.ok(!/openfreemap/i.test(message), raison);
    assert.ok(!/maptiler/i.test(message), raison);
    assert.ok(!message.includes("http"), `aucune URL affichée (${raison})`);
  }
  // ⚠️ ET LA LISTE DES RAISONS EST EXHAUSTIVE : le type les énumère, et aucune
  // n'est traitée par un joker.
  assert.ok(
    CODE_FOND.includes('export type RaisonFondIndisponible = "style_invalide" | "origine_interdite"'),
    "les raisons sont nommées une par une",
  );
  assert.ok(!/default\s*:/.test(CODE_FOND), "aucun joker : ajouter une raison casse la compilation");
});

test("S-10 — LES ATTRIBUTIONS EXIGÉES SONT PRÉSENTES, CLIQUABLES, ET NON REPLIÉES", () => {
  /*
   * Le TileJSON d'OpenFreeMap porte « OpenFreeMap © OpenMapTiles Data from
   * OpenStreetMap », et MapLibre l'affiche de lui-même. Cette liste est le
   * filet : elle vérifie que les trois crédits sont exigés côté code, et
   * qu'aucun n'est un texte mort.
   */
  const libelles = ATTRIBUTIONS_REQUISES.map((a) => a.libelle);
  for (const credit of ["OpenFreeMap", "OpenMapTiles", "OpenStreetMap"]) {
    assert.ok(libelles.some((l) => l.includes(credit)), `crédit ${credit}`);
  }
  assert.equal(ATTRIBUTIONS_REQUISES.length, 3, "trois crédits, pas deux");
  for (const attribution of ATTRIBUTIONS_REQUISES) {
    assert.match(attribution.href, /^https:\/\//, `un lien, pas un texte mort (${attribution.libelle})`);
  }
  // Et l'attribution n'est pas repliée derrière un bouton.
  assert.ok(CODE_CARTE.includes("compact: false"), "attribution non repliée");
});

test("S-11 — L'ABSENCE DE CLÉ EST DOCUMENTÉE, ET LE MARCHÉ CONCLU AVEC ELLE", () => {
  /*
   * ⚠️ UN SERVICE GRATUIT SANS SLA N'EST PAS UNE BONNE NOUVELLE SANS RÉSERVE.
   * La documentation doit porter les deux faces : rien à renseigner, et aucune
   * garantie de disponibilité. Celui qui déploiera dans six mois a le droit de
   * savoir ce qui a été accepté.
   */
  const exemple = lire("../../.env.example");
  // ⚠️ LE TEXTE EST UN COMMENTAIRE SUR PLUSIEURS LIGNES : « sans » et
  // « garantie » peuvent être séparés par un retour à la ligne ET un `#`.
  const prose = exemple.replace(/\n\s*#\s?/g, " ");
  assert.ok(!exemple.includes("NEXT_PUBLIC_MAPTILER_KEY"), "l'ancienne clé a disparu");
  assert.ok(!exemple.includes("NEXT_PUBLIC_MAPTILER_STYLE"), "l'ancien style a disparu");
  assert.match(prose, /AUCUNE VARIABLE N'EST REQUISE/i, "l'absence d'obligation est écrite");
  assert.match(prose, /sans\s+garantie/i, "l'absence de garantie est écrite");
  assert.match(prose, /pr[eé]avis/i, "l'arrêt possible sans préavis est écrit");
  assert.match(prose, /auto-h[eé]bergement/i, "la sortie de secours est écrite");
  assert.ok(exemple.includes("NEXT_PUBLIC_CARTE_STYLE_URL"), "la surcharge facultative est nommée");
});

test("S-12 — AUCUNE CLÉ NI JETON, NULLE PART", () => {
  for (const [nom, code] of [
    ["fond de carte", CODE_FOND],
    ["carte", CODE_CARTE],
    ["recherche", CODE_RECHERCHE],
  ] as const) {
    assert.ok(!/key=[A-Za-z0-9]{8,}/.test(code), `aucune clé littérale (${nom})`);
    assert.ok(!/[?&](key|apikey|api_key|access_token)=/i.test(code), `aucun paramètre de clé (${nom})`);
    assert.ok(!/MAPTILER/.test(code), `aucune variable de l'ancien fournisseur (${nom})`);
  }
  /*
   * ⚠️ ET C'EST STRUCTUREL, PAS UNE HYGIÈNE : il n'y a aucune clé à cacher.
   * Ce test ne vérifie donc plus « la clé n'est pas en dur » mais « il n'y a
   * pas de clé du tout » — ce qui est une garantie plus forte, et la raison
   * pour laquelle l'URL du style peut être journalisée sans précaution.
   */
  assert.ok(!/\bcle\b/i.test(CODE_FOND), "le module ne parle plus de clé");
});

test("S-13 — CHAQUE PANNE A UN ÉTAT, ET CHAQUE ÉTAT EST JOURNALISÉ AVEC SON ÉTAPE", () => {
  /*
   * Trois endroits peuvent échouer, et ils échouent différemment :
   *   · le module MapLibre ne se télécharge pas         → "chargement" ;
   *   · le constructeur jette (WebGL absent)            → "webgl" ;
   *   · le style ou une tuile échoue (`error`)          → "style" ;
   *   · … et si l'amont REFUSE (401/403/404)            → "refus_amont".
   *
   * ⚠️ LE QUATRIÈME ÉTAT EST NÉ D'UNE PANNE RÉELLE. Un 403 du fournisseur
   * s'affichait comme « momentanément indisponible » : un message qui invitait
   * à attendre alors qu'attendre ne servait à rien. Un refus n'est pas une
   * indisponibilité passagère, et il ne doit pas se lire comme telle.
   */
  for (const etat of ['"webgl"', '"chargement"', '"style"', '"refus_amont"']) {
    assert.ok(CODE_CARTE.includes(etat), etat);
  }
  assert.ok(
    CODE_CARTE.includes('type EchecCarte = "webgl" | "chargement" | "style" | "refus_amont"'),
    "les états sont énumérés, pas devinés",
  );
  assert.ok(CODE_CARTE.includes('instance.on("error"'), "les erreurs du fournisseur sont écoutées");
  assert.ok(CODE_CARTE.includes("catch {"), "WebGL absent est rattrapé");

  /*
   * ⚠️ ET L'ERREUR D'ORIGINE N'EST PAS MASQUÉE. Le repli explique la panne à
   * l'élève ; la console, elle, doit dire à quelle ÉTAPE on a échoué, avec le
   * statut et l'URL. Sans cela, diagnostiquer une carte grise en production
   * revient à deviner — ce qui a déjà coûté deux tours de ce chantier.
   */
  for (const etape of ['etape: "import"', 'etape: "new Map"', 'etape: fatal ? "style" : "ressource"']) {
    assert.ok(CODE_CARTE.includes(etape), `l'étape est journalisée (${etape})`);
  }
  assert.ok(CODE_CARTE.includes("fatal,"), "la trace dit si l'échec est fatal");
  assert.ok(CODE_CARTE.includes("sourceId: analyse.sourceId"), "et la source, quand il y en a une");
  assert.equal(
    (CODE_CARTE.match(/console\.error\(/g) ?? []).length,
    3,
    "une trace par étape faillible, et pas une de plus",
  );
  assert.ok(CODE_CARTE.includes("statut:"), "le statut HTTP est journalisé");
  assert.ok(CODE_CARTE.includes("url:"), "l'URL fautive est journalisée");
  // Journaliser l'URL n'est possible QUE parce qu'elle ne porte aucune clé.
  assert.ok(!/key=/.test(CODE_FOND), "aucune clé ne peut fuir dans une trace");
});

const STYLE = STYLE_PAR_DEFAUT;

/**
 * Les formes EXACTES relevées dans Chromium sur MapLibre 6.16.0, une panne à la
 * fois. Les clés sont celles que l'événement portait réellement.
 */
function evenementAjax(url: string, statut: number, extra: Record<string, unknown> = {}) {
  const erreur = Object.assign(new Error(`AJAXError: (${statut}): ${url}`), {
    status: statut,
    statusText: "Erreur",
    url,
    body: null,
  });
  return { error: erreur, type: "error", target: {}, style: {}, ...extra };
}

test("S-13b — UNE ERREUR DU STYLE EST FATALE, ET ELLE SEULE", () => {
  /*
   * ⚠️ MESURÉ, PAS SUPPOSÉ. Chaque panne a été provoquée séparément dans un
   * navigateur, et les clés de l'événement énumérées à l'exécution :
   *
   *   style 404 / 403   load NON émis   error, type, target, style        url = style
   *   style illisible   load NON émis   error, type, target, style        pas d'url
   *
   * Un échec du document de style est le seul cas où il n'y a rien à montrer.
   */
  for (const statut of [401, 403, 404]) {
    const a = classerErreurDeCarte({ evenement: evenementAjax(STYLE, statut), urlDuStyle: STYLE, chargee: false });
    assert.equal(a.issue, "refus_amont", `${statut} sur le style est un refus`);
    assert.equal(a.statut, statut, "le statut HTTP est conservé");
    assert.equal(a.url, STYLE, "l'URL fautive est conservée");
  }
  // Un 500 ou un 503 sur le style est une panne, pas un refus : attendre a un sens.
  for (const statut of [500, 502, 503]) {
    const a = classerErreurDeCarte({ evenement: evenementAjax(STYLE, statut), urlDuStyle: STYLE, chargee: false });
    assert.equal(a.issue, "style", `${statut} sur le style est une panne`);
  }
  // Un style illisible : ni source, ni URL, et `load` n'arrivera jamais.
  const illisible = classerErreurDeCarte({
    evenement: { error: new SyntaxError("Expected property name"), type: "error", target: {}, style: {} },
    urlDuStyle: STYLE,
    chargee: false,
  });
  assert.equal(illisible.issue, "style");
  assert.equal(illisible.statut, null);
  assert.equal(illisible.url, null);
  assert.match(illisible.message, /Expected property name/, "le message d'origine n'est pas masqué");
});

test("S-13b2 — UNE RESSOURCE SECONDAIRE NE DÉTRUIT RIEN, MÊME AVANT LE PREMIER load", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE DÉFAUT QUE CE TEST VERROUILLE
   * ════════════════════════════════════════════════════════════════════════
   * La règle précédente était `const fatal = !charge` : TOUT ce qui précédait
   * le premier `load` était fatal. C'est faux, et mesuré comme tel —
   *
   *   sprite 404 / 500   erreur émise AVANT `load`… et `load` émis ensuite
   *
   * Une planche de symboles absente détruisait donc une carte en train de se
   * charger normalement. `chargee: false` ci-dessous reproduit exactement ce
   * moment-là.
   */
  const avantEtApres = [false, true];

  // Sprite : pas de `sourceId`, une URL qui n'est pas celle du style.
  for (const chargee of avantEtApres) {
    for (const statut of [404, 500]) {
      const a = classerErreurDeCarte({
        evenement: evenementAjax("https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json", statut),
        urlDuStyle: STYLE,
        chargee,
      });
      assert.equal(a.issue, "ressource", `sprite ${statut} (chargee=${chargee})`);
    }
  }

  // Polices : même forme, autre chemin.
  for (const chargee of avantEtApres) {
    const a = classerErreurDeCarte({
      evenement: evenementAjax("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf", 404),
      urlDuStyle: STYLE,
      chargee,
    });
    assert.equal(a.issue, "ressource", `glyphes (chargee=${chargee})`);
  }

  /*
   * Tuiles et TileJSON : MapLibre y ajoute `sourceId`, `source` et
   * `isSourceLoaded`, et pour une tuile un `tile`. Relevé tel quel.
   */
  for (const chargee of avantEtApres) {
    const tuile = classerErreurDeCarte({
      evenement: evenementAjax("https://tiles.openfreemap.org/planet/12/2115/1503.pbf", 500, {
        sourceId: "openmaptiles",
        source: {},
        isSourceLoaded: false,
        tile: {},
      }),
      urlDuStyle: STYLE,
      chargee,
    });
    assert.equal(tuile.issue, "ressource", `tuile 500 (chargee=${chargee})`);
    assert.equal(tuile.sourceId, "openmaptiles", "la source est journalisée");

    const tilejson = classerErreurDeCarte({
      evenement: evenementAjax("https://tiles.openfreemap.org/planet", 404, {
        sourceId: "openmaptiles",
        source: {},
        isSourceLoaded: false,
      }),
      urlDuStyle: STYLE,
      chargee,
    });
    /*
     * ⚠️ UN 404 QUI N'EST PAS UN REFUS. C'est l'autre moitié du défaut : la
     * règle « 401/403/404 ⟹ refus de l'amont » s'appliquait à n'importe
     * quelle requête. Un TileJSON absent affichait « le fond de carte a été
     * refusé », qui envoie vérifier une configuration sans faute.
     */
    assert.equal(tilejson.issue, "ressource", `TileJSON 404 (chargee=${chargee})`);
    assert.notEqual(tilejson.issue, "refus_amont");
  }

  // Et une erreur sans source ni URL APRÈS `load` : le style est acquis.
  const apres = classerErreurDeCarte({
    evenement: { error: new Error("circle-color: color expected"), type: "error", target: {}, style: {} },
    urlDuStyle: STYLE,
    chargee: true,
  });
  assert.equal(apres.issue, "ressource", "après `load`, ce n'est plus le style");
});

test("S-13b3 — LE CLASSEMENT NE SUPPOSE RIEN QUE L'ÉVÉNEMENT N'EXPOSE", () => {
  /*
   * ⚠️ `error.name` VAUT « Error » ET LE CONSTRUCTEUR EST MINIFIÉ (`Pn` dans
   * le lot publié). Relevé à l'exécution : rien ne doit reposer sur le nom de
   * la classe. Les seules propriétés lues sont celles que les typages du
   * paquet déclarent — `status`, `statusText`, `url`, `body` — plus `sourceId`
   * sur l'événement.
   */
  for (const interdit of ["AJAXError", "instanceof AJAXError", ".name ===", "constructor.name"]) {
    assert.ok(!CODE_FOND.includes(interdit), `le classement ne lit pas ${interdit}`);
  }
  // Un événement vide, nul, ou d'une forme inattendue ne doit pas lever.
  for (const evenement of [null, undefined, {}, { error: null }, { error: "texte" }, { error: { status: "404" } }]) {
    const a = classerErreurDeCarte({ evenement, urlDuStyle: STYLE, chargee: true });
    assert.equal(a.issue, "ressource", JSON.stringify(evenement) + " : bénin par défaut");
    assert.equal(a.statut, null, "un statut non numérique n'est pas un statut");
  }
  // ⚠️ ET LE DÉFAUT EST LE MOINS DESTRUCTEUR : face à l'inconnu, on garde la
  // carte et on journalise, plutôt que de détruire ce qui marche peut-être.
  const inconnu = classerErreurDeCarte({ evenement: { error: new Error("?") }, urlDuStyle: STYLE, chargee: true });
  assert.equal(inconnu.issue, "ressource");
  // L'URL du style est reconnue même écrite autrement (barre finale, casse de l'hôte).
  const variante = classerErreurDeCarte({
    evenement: evenementAjax("https://TILES.openfreemap.org/styles/liberty", 403),
    urlDuStyle: STYLE,
    chargee: false,
  });
  assert.equal(variante.issue, "refus_amont", "l'hôte se compare sans tenir compte de la casse");
});

test("S-13c — UN REPLI FATAL NE LAISSE AUCUNE INSTANCE ORPHELINE", () => {
  /*
   * ⚠️ UN CONTEXTE WEBGL ET UN WORKER ABANDONNÉS NE SE RÉCUPÈRENT PAS. Le
   * conteneur quitte le DOM avec le repli ; l'instance doit partir avec lui,
   * sinon elle continue de tourner sans surface et sans propriétaire.
   */
  assert.ok(CODE_CARTE.includes("const aDetruire = instance;"), "l'instance est saisie");
  assert.ok(CODE_CARTE.includes("aDetruire?.remove()"), "puis détruite");
  const iDestruction = CODE_CARTE.indexOf("aDetruire?.remove()");
  const iBascule = CODE_CARTE.indexOf("setEchec((actuel) => actuel ?? echecFatal)");
  assert.ok(iDestruction > 0 && iBascule > iDestruction, "détruite AVANT de basculer l'écran");
  // Et les deux références sont remises à zéro, pour que le démontage ne
  // retombe pas sur une carte déjà détruite.
  assert.ok(CODE_CARTE.includes("instance = null;"));
  assert.ok(CODE_CARTE.includes("carte.current = null;"));
  // ⚠️ LE DÉMONTAGE EST DONC DEVENU FAILLIBLE, et il est protégé.
  const demontage = CODE_CARTE.slice(CODE_CARTE.indexOf("vivant = false;"));
  assert.match(demontage.slice(0, 300), /try \{\s*instance\?\.remove\(\);/, "le démontage est protégé");
});

/* ══════════════════════════════════════════════════════════════════════════
   20 à 22. LES MARQUEURS CORRESPONDENT EXACTEMENT AUX RÉSULTATS
   ══════════════════════════════════════════════════════════════════════════ */

test("S-14 — UN MARQUEUR PAR COMMERCE, NI PLUS NI MOINS", () => {
  const trouves = [
    magasin({ osmId: 1, name: "A" }),
    magasin({ osmId: 2, name: "B", osmType: "WAY" }),
    magasin({ osmId: 3, name: "C", osmType: "RELATION" }),
  ];
  const marqueurs = marqueursDepuisMagasins(trouves, null);
  assert.equal(marqueurs.length, trouves.length);
  assert.deepEqual(
    marqueurs.map((m) => m.cle),
    trouves.map((m) => cleIdentiteOsm(m)),
    "la clé du marqueur EST l'identité OSM du commerce",
  );
});

test("S-15 — LE REGROUPEMENT NE CACHE AUCUN COMMERCE POUR DE BON", async () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ CE CONTRÔLE A ÉTÉ RETOURNÉ, ET LE REVIREMENT EST ASSUMÉ
   * ════════════════════════════════════════════════════════════════════════
   * Il interdisait tout regroupement, et sa raison était bonne : trois
   * magasins masqués derrière un chiffre, ce sont trois commerces que l'élève
   * ne peut pas choisir. Le regroupement est désormais DEMANDÉ — parce que
   * dans une ville dense, soixante pastilles superposées ne se choisissent pas
   * davantage.
   *
   * Le risque n'a pas disparu, il est écarté autrement. Ce qu'il faut
   * garantir n'est plus « aucun amas » mais : TOUT AMAS SE DÉPLIE, et au zoom
   * rapproché il n'y en a plus du tout. C'est ce que ce contrôle mesure
   * maintenant, et `M-08` le mesure dans le détail.
   */
  const colles = Array.from({ length: 12 }, (_, i) =>
    magasin({ osmId: i + 1, name: `M${i}`, lat: 43.1364 + i * 0.00001, lon: 5.9334 }),
  );
  // ⚠️ LES DOUZE SONT DANS LA SOURCE. Le regroupement est une affaire
  // d'AFFICHAGE : il ne retire aucune entité, il les dessine ensemble.
  const { collectionDeMagasins } = await import("../../lib/cartographie/vue-magasins");
  assert.equal(collectionDeMagasins(colles).features.length, 12);

  // Un amas mène toujours quelque part : on demande à la source le zoom où il
  // éclate, plutôt qu'un zoom fixe qui le laisserait parfois intact.
  assert.match(CODE_CARTE, /getClusterExpansionZoom/);
  // Et au-delà de ce zoom, plus aucun amas : chaque commerce redevient une
  // pastille qu'on peut toucher.
  assert.match(CODE_CARTE, /clusterMaxZoom: 13/);
  // La liste, elle, n'a jamais regroupé quoi que ce soit : les douze y sont.
  assert.ok(!CODE_RECHERCHE.includes("cluster"), "la liste ne regroupe rien");
});

test("S-15b — AUCUNE COULEUR DE COUCHE N'EST UNE VARIABLE CSS", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ MAPLIBRE N'EST PAS DU CSS, ET CE TEST EXISTE PARCE QUE ÇA A COÛTÉ CHER
   * ════════════════════════════════════════════════════════════════════════
   * Les couches passaient les jetons sémantiques tels quels :
   * `"circle-color": "var(--primary)"`. MapLibre analyse les couleurs
   * lui-même, hors du moteur de style du navigateur. Il refuse la chaîne et
   * REJETTE LA COUCHE ENTIÈRE.
   *
   * Mesuré dans Chromium sur cette configuration exacte — sept erreurs, puis
   * `couchesAjoutees = []`, `amasRendus = 0`, `pointsRendus = 0`. Autrement
   * dit : aucun marqueur n'avait jamais été dessiné. Et chacune de ces sept
   * erreurs émettait `error`, ce qui faisait basculer l'écran sur « le fond de
   * carte est momentanément indisponible » — le symptôme rapporté.
   *
   * ⚠️ AUCUN HARNAIS NODE NE POUVAIT LE VOIR : il n'y a pas de WebGL ici, et
   * un jeton mal placé ressemble à une chaîne comme une autre. Ce contrôle est
   * textuel, et c'est assumé : il interdit la forme qui a échoué.
   */
  for (const propriete of [
    "circle-color",
    "circle-stroke-color",
    "text-color",
    "fill-color",
    "line-color",
  ]) {
    const motif = new RegExp(`"${propriete}":\\\\s*(NEUTRE|CHOISI|CONTOUR|[A-Z_]+|"[^"]*")`, "g");
    for (const trouve of CODE_CARTE.match(motif) ?? []) {
      assert.ok(!trouve.includes("var(--"), `jeton CSS non résolu : ${trouve}`);
    }
  }
  /*
   * ⚠️ ET LA DISTINCTION EST LE POINT : `var(--…)` reste LÉGITIME dans le DOM.
   * Le marqueur de la position de l'élève est un élément HTML ordinaire, posé
   * par-dessus la carte : son style passe par le navigateur, qui résout les
   * jetons. Ce qui est interdit, c'est de les donner à MapLibre.
   */
  assert.match(CODE_CARTE, /point\.style\.background = "var\(--/, "le marqueur DOM garde ses jetons");
  const objetsDeCouche = CODE_CARTE.match(/paint:\s*\{[^}]*\}/g) ?? [];
  assert.ok(objetsDeCouche.length >= 4, "les quatre couches ont un bloc `paint`");
  for (const bloc of objetsDeCouche) {
    assert.ok(!bloc.includes("var(--"), `jeton CSS donné à MapLibre : ${bloc.slice(0, 80)}`);
  }

  // ⚠️ ET LE JETON RESTE LA SOURCE DE VÉRITÉ : il est RÉSOLU, pas remplacé par
  // une couleur écrite en dur — sans quoi le thème sombre serait perdu.
  assert.ok(CODE_CARTE.includes("function couleurDuJeton("), "la résolution existe");
  assert.ok(CODE_CARTE.includes("getComputedStyle("), "elle lit le style calculé");
  for (const jeton of ['JETON_NEUTRE = "--primary"', 'JETON_CHOISI = "--success"', 'JETON_CONTOUR = "--card"']) {
    assert.ok(CODE_CARTE.includes(jeton), jeton);
  }
  // Un repli existe pour chaque jeton : un style pas encore appliqué rendrait
  // une chaîne vide, que MapLibre refuserait tout autant.
  for (const repli of ["REPLI_NEUTRE", "REPLI_CHOISI", "REPLI_CONTOUR"]) {
    assert.ok(CODE_CARTE.includes(`${repli} = "#`), `${repli} est une couleur littérale`);
  }
  // Et les couleurs sont relues à chaque passage, pour suivre un changement de
  // thème plutôt que de figer la palette du premier rendu.
  assert.ok(CODE_CARTE.includes("setPaintProperty("), "les couches existantes sont repeintes");
});

test("S-15c — LA PILE DE POLICES EST CELLE QUE LE FOURNISSEUR SERT", () => {
  /*
   * ⚠️ MAPLIBRE NE DEMANDE PAS LES POLICES UNE PAR UNE. Il assemble la liste
   * en un seul nom de pile séparé par des virgules :
   *
   *     …/fonts/Noto Sans Regular,Open Sans Regular/0-255.pbf
   *
   * Et le serveur de polices ne sert que les piles simples. Mesuré :
   *
   *     Noto Sans Regular                     → 200, 76 580 o
   *     Noto Sans Regular,Open Sans Regular   → 404
   *
   * Une seconde police « de secours » ne secourt donc rien : elle casse la
   * requête. Avec deux noms, 404 à chaque plage et des chiffres rendus
   * localement, en approximation.
   */
  const texte = CODE_CARTE.match(/"text-font":\s*\[[^\]]*\]/g) ?? [];
  assert.equal(texte.length, 1, "une seule couche de texte");
  assert.equal(texte[0], '"text-font": ["Noto Sans Regular"]', "une pile simple, et celle qui existe");
  assert.ok(!texte[0]!.includes(","), "aucune pile composite : elle rendrait 404");
});

test("S-16 — LA SÉLECTION CIRCULE DANS LES DEUX SENS, SUR LA MÊME CLÉ", async () => {
  const { collectionDeMagasins } = await import("../../lib/cartographie/vue-magasins");
  const trouves = [magasin({ osmId: 7, name: "Choisi" }), magasin({ osmId: 8, name: "Autre" })];
  const cible = cleIdentiteOsm(trouves[0]!);
  /*
   * ⚠️ LA CLÉ DE L'ENTITÉ EST L'IDENTITÉ OSM, comme celle de la ligne de
   * liste. C'est ce qui fait circuler la sélection dans les deux sens sans
   * table de correspondance à maintenir — et cela n'a pas changé en passant
   * des marqueurs du DOM à une source GeoJSON.
   */
  const collection = collectionDeMagasins(trouves);
  assert.deepEqual(
    collection.features.map((f) => f.properties.cle),
    trouves.map((m) => cleIdentiteOsm(m)),
  );
  assert.equal(collection.features[0]!.properties.cle, cible);

  // Carte → liste : le clic lit la clé de l'entité et la remonte au parent.
  assert.ok(CODE_CARTE.includes("selection.current(cle)"));
  assert.ok(CODE_CARTE.includes("properties?.cle"));
  /*
   * Liste → carte : la mise en évidence passe par les DONNÉES d'une source qui
   * ne contient que le choisi.
   *
   * ⚠️ ELLE PASSAIT PAR UN FILTRE, ET C'ÉTAIT LA PANNE : le filtre devait
   * exclure les amas, donc excluait tout commerce groupé. La clé, elle, n'a
   * pas changé — c'est toujours l'identité OSM.
   */
  const { collectionDuChoisi } = await import("../../lib/cartographie/vue-magasins");
  assert.ok(CODE_CARTE.includes("setData(collectionDuChoisi(magasins, selectionnee))"));
  const vert = collectionDuChoisi(trouves, cible);
  assert.equal(vert.features.length, 1, "exactement le commerce choisi");
  assert.equal(vert.features[0]!.properties.cle, cible, "et sur la même clé qu'à l'aller");
  assert.ok(CODE_RECHERCHE.includes("onSelectionner={(cle) => {"));
});

test("S-17 — LE COMMERCE CHOISI EST DISTINCT, ET PAS SEULEMENT PAR LA COULEUR", () => {
  /*
   * ⚠️ MESURÉ SUR LES COUCHES, PLUS SUR DES ÉLÉMENTS DU DOM. La propriété n'a
   * pas changé : une simple différence de teinte disparaît quand deux
   * pastilles se chevauchent. Le choisi est donc PLUS GROS, et sa couche est
   * ajoutée APRÈS les autres — donc dessinée au-dessus.
   */
  // ⚠️ LES DEUX RAYONS ONT ÉTÉ RÉDUITS D'UN QUART, le rapport est préservé.
  assert.match(CODE_CARTE, /"circle-radius": 9\.5/, "le choisi est plus grand");
  assert.match(CODE_CARTE, /"circle-radius": 6\.5/, "les autres sont plus petits");
  const iPoint = CODE_CARTE.indexOf("id: COUCHE_POINT");
  const iChoisi = CODE_CARTE.indexOf("id: COUCHE_CHOISI");
  assert.ok(iPoint > 0 && iChoisi > iPoint, "le choisi est dessiné par-dessus");
  // Et la position de l'élève reste une forme différente, pas une autre
  // couleur : un disque du DOM, jamais une pastille de la source.
  assert.match(CODE_CARTE, /borderRadius/);
  assert.match(CODE_CARTE, /elementDeDepart/);
});

test("S-18 — LA MARQUE N'EST PAS RÉPÉTÉE QUAND LE NOM LA DIT DÉJÀ", () => {
  // Le défaut « LidlLidl », corrigé dans la liste, ne doit pas revenir sur la
  // carte : même règle, appliquée aux deux.
  const [lidl] = marqueursDepuisMagasins([magasin({ name: "Lidl", brand: "Lidl" })], null);
  assert.equal(lidl!.marque, null);
  const [market] = marqueursDepuisMagasins(
    [magasin({ name: "Carrefour Market", brand: "Carrefour" })],
    null,
  );
  assert.equal(market!.marque, null, "la marque est déjà dans le nom");
  const [autre] = marqueursDepuisMagasins([magasin({ name: "Chez Paul", brand: "Spar" })], null);
  assert.equal(autre!.marque, "Spar", "elle est gardée quand elle dit autre chose");
});

/* ══════════════════════════════════════════════════════════════════════════
   23 à 25. LE CADRAGE
   ══════════════════════════════════════════════════════════════════════════ */

test("S-19 — LE CADRE CONTIENT TOUS LES COMMERCES TROUVÉS", () => {
  const cadre = cadreDesPoints([
    { lat: 43.1, lon: 5.9 },
    { lat: 43.2, lon: 6.0 },
    { lat: 43.15, lon: 5.95 },
  ]);
  assert.deepEqual(cadre, {
    sudOuest: { lat: 43.1, lon: 5.9 },
    nordEst: { lat: 43.2, lon: 6.0 },
  });
});

test("S-20 — UN COMMERCE UNIQUE REÇOIT UNE MARGE, SINON LE ZOOM EST INDÉFINI", () => {
  const cadre = cadreDesPoints([{ lat: 43.1364, lon: 5.9334 }]);
  assert.ok(cadre !== null);
  assert.ok(cadre!.sudOuest.lat < 43.1364 && cadre!.nordEst.lat > 43.1364);
  assert.ok(cadre!.sudOuest.lon < 5.9334 && cadre!.nordEst.lon > 5.9334);
});

test("S-21 — ZÉRO RÉSULTAT NE DONNE PAS UNE CARTE DE LA FRANCE", () => {
  // Aucun repli sur un centre arbitraire : pas de cadre, donc pas de cadrage,
  // et l'écran n'affiche pas de carte du tout — il affiche un message.
  assert.equal(cadreDesPoints([]), null);
  assert.equal(cadreDeLaRecherche([], null), null);
});

test("S-22 — « AUTOUR DE MOI » CADRE AUSSI SUR L'ÉLÈVE", () => {
  // Sans sa position dans le cadre, l'élève ne voit pas quels commerces sont
  // de son côté.
  const cadre = cadreDeLaRecherche([magasin({ lat: 43.2, lon: 6.0 })], { lat: 43.0, lon: 5.8 });
  assert.deepEqual(cadre, {
    sudOuest: { lat: 43.0, lon: 5.8 },
    nordEst: { lat: 43.2, lon: 6.0 },
  });
  /*
   * En mode ville, il n'y a aucun point de départ : le cadre est celui des
   * commerces seuls. Un commerce unique reçoit alors la MARGE du point
   * unique — sans elle, le cadre serait de taille nulle et la carte ne saurait
   * pas quel zoom choisir. C'est pour cela que l'encadrement n'est pas
   * exactement 43.2.
   */
  const parVille = cadreDeLaRecherche([magasin({ lat: 43.2, lon: 6.0 })], null);
  assert.ok(parVille!.sudOuest.lat < 43.2 && parVille!.nordEst.lat > 43.2);
  assert.ok(
    parVille!.nordEst.lat - parVille!.sudOuest.lat < 0.01,
    "une marge de l'ordre de quelques centaines de mètres, pas un cadre régional",
  );
  // Et surtout : la position de l'élève n'y est pas, puisqu'il n'y en a pas.
  assert.ok(parVille!.sudOuest.lon > 5.9, "aucun point de départ n'a élargi le cadre");
});

test("S-23 — DES COORDONNÉES ABERRANTES SONT ÉCARTÉES, PAS CORRIGÉES", () => {
  /*
   * ⚠️ ÉCARTÉES, PAS RAMENÉES DANS LES BORNES. Une latitude de 999 ramenée à 90
   * placerait un commerce au pôle Nord et ferait un cadre de la moitié du
   * globe — l'élève verrait une carte vide et conclurait à un bogue.
   */
  const cadre = cadreDesPoints([
    { lat: 43.1, lon: 5.9 },
    { lat: 999, lon: 5.9 },
    { lat: Number.NaN, lon: 5.9 },
    { lat: 43.2, lon: 1000 },
  ]);
  assert.ok(cadre !== null, "le point valide subsiste");
  // Il n'en reste qu'un : la marge du point unique s'applique, et elle est
  // petite — ce qui prouve qu'aucun point aberrant n'a élargi le cadre.
  assert.ok(cadre!.nordEst.lat - cadre!.sudOuest.lat < 0.01, "aucune latitude polaire retenue");
  assert.ok(cadre!.nordEst.lon - cadre!.sudOuest.lon < 0.01, "aucune longitude aberrante retenue");
  assert.ok(cadre!.sudOuest.lat < 43.1 && cadre!.nordEst.lat > 43.1, "centré sur le point valide");

  // Et trois points valides ne reçoivent AUCUNE marge : elle n'existe que pour
  // le cas du point unique.
  const trois = cadreDesPoints([
    { lat: 43.1, lon: 5.9 },
    { lat: 43.2, lon: 6.0 },
    { lat: 999, lon: 7.0 },
  ]);
  assert.deepEqual(trois, { sudOuest: { lat: 43.1, lon: 5.9 }, nordEst: { lat: 43.2, lon: 6.0 } });
});

/* ══════════════════════════════════════════════════════════════════════════
   26. L'ITINÉRAIRE
   ══════════════════════════════════════════════════════════════════════════ */

test("S-24 — L'ITINÉRAIRE PART D'OPENSTREETMAP, PAS DE GOOGLE", () => {
  /*
   * Le projet interroge déjà OSM pour trouver les commerces : lui demander
   * l'itinéraire n'ajoute aucun tiers. Envoyer la position de l'élève à Google
   * en ajouterait un, pour un service que nous n'avons pas choisi.
   */
  const url = urlItineraire({ lat: 43.1364, lon: 5.9334 }, { lat: 43.1, lon: 5.9 });
  assert.match(url, /^https:\/\/www\.openstreetmap\.org\/directions\?/);
  assert.ok(!url.includes("google"), "aucun tiers ajouté");
  assert.ok(url.includes("43.136400") && url.includes("43.100000"), "les deux points y sont");
});

test("S-25 — SANS POSITION PARTAGÉE, L'ITINÉRAIRE NE DIVULGUE RIEN", () => {
  // On ouvre le commerce, marqué et centré : utile, et sans point de départ.
  const url = urlItineraire({ lat: 43.1364, lon: 5.9334 }, null);
  assert.match(url, /^https:\/\/www\.openstreetmap\.org\/\?mlat=43\.136400/);
  assert.ok(!url.includes("directions"), "aucun itinéraire sans origine");
  assert.ok(!url.includes("route="));
});

test("S-26 — LE LIEN D'ITINÉRAIRE NE FUIT PAS L'URL DE LA PAGE", () => {
  // ⚠️ LE LIEN A CHANGÉ DE FICHIER : il vit dans le sélecteur d'application
  // (`ChoixItineraire`) depuis que l'élève choisit entre Google Maps, Waze et
  // Plans. La garantie, elle, est la même — sans `noreferrer`, l'URL de la
  // page de courses partirait dans le `Referer` du service de navigation, et
  // cette URL dit que l'élève fait ses courses.
  const choix = sansProse(lire("../../components/student/ChoixItineraire.tsx"));
  assert.ok(choix.includes('rel="noopener noreferrer"'));
  assert.ok(choix.includes('target="_blank"'));
  assert.ok(CODE_RECHERCHE.includes("<ChoixItineraire"), "et il est bien monté par l'écran");
});

/* ══════════════════════════════════════════════════════════════════════════
   27 à 29. LES DEUX MODES, LE RAYON, L'ANTI-RAFALE
   ══════════════════════════════════════════════════════════════════════════ */

test("S-27 — DEUX MODES, NOMMÉS, ET AUCUN N'EST LE REPLI DE L'AUTRE", () => {
  assert.deepEqual(
    MODES.map((m) => m.id),
    ["autour", "ville"],
  );
  assert.deepEqual(
    MODES.map((m) => m.libelle),
    ["Autour de moi", "Par ville"],
  );
  // La recherche par ville est offerte d'emblée, pas après un échec.
  assert.ok(CODE_RECHERCHE.includes('role="tablist"'), "les deux modes sont des onglets");
  assert.ok(CODE_RECHERCHE.includes('aria-label="Mode de recherche"'));
});

test("S-28 — LES PALIERS DE RAYON RESTENT DANS LES BORNES SERVEUR", () => {
  /*
   * ⚠️ UN PALIER HORS BORNES PRODUIRAIT UN 400 AU CLIC. Le schéma d'entrée et
   * la route bornent déjà ; ce test empêche l'écran de proposer un réglage que
   * le serveur refusera.
   */
  for (const km of RAYONS_PROPOSES) {
    assert.ok(km >= RAYON_KM_MIN, `${km} km ≥ ${RAYON_KM_MIN}`);
    assert.ok(km <= RAYON_KM_MAX, `${km} km ≤ ${RAYON_KM_MAX}`);
  }
  assert.ok(RAYONS_PROPOSES.length >= 3, "un rayon réglable, pas une constante déguisée");
  // Et la borne est appliquée avant l'envoi.
  assert.equal(rayonUtilisable(0), RAYON_KM_MIN);
  assert.equal(rayonUtilisable(9999), RAYON_KM_MAX);
  assert.equal(rayonUtilisable(Number.NaN), 10);
  assert.ok(CODE_RECHERCHE.includes("rayonUtilisable(rayonKm)"));
});

test("S-29 — AUCUNE REQUÊTE À CHAQUE CARACTÈRE", () => {
  /*
   * ⚠️ L'ANTI-RAFALE EST UN MINUTEUR ANNULÉ À CHAQUE FRAPPE. Taper
   * « Marseille » déclenche UN appel, pas neuf — l'énoncé le demande, et c'est
   * aussi ce qui garde l'annuaire sous sa limite de débit.
   */
  assert.ok(ANTI_RAFALE_MS >= 200, `${ANTI_RAFALE_MS} ms : trop court pour grouper des frappes`);
  assert.ok(ANTI_RAFALE_MS <= 600, `${ANTI_RAFALE_MS} ms : trop long, la liste traîne`);
  assert.ok(CODE_RECHERCHE.includes("setTimeout("), "un minuteur");
  assert.ok(CODE_RECHERCHE.includes("clearTimeout(minuteur)"), "annulé à chaque frappe");
  assert.ok(CODE_RECHERCHE.includes("controleur.abort()"), "et l'appel en vol est abandonné");
  // Et rien ne part sous deux lettres.
  assert.equal(SAISIE_MIN, 2);
  assert.ok(CODE_RECHERCHE.includes("texte.length < SAISIE_MIN"));
});

test("S-30 — UNE VILLE BRUTE N'ARRIVE AU MOTEUR QUE SI L'ANNUAIRE EST MUET", () => {
  /*
   * ⚠️ C'EST L'ÉTAPE DE GÉOCODAGE QUE L'ÉNONCÉ EXIGE. « Saint-Martin » désigne
   * une trentaine de communes : l'élève CHOISIT la sienne, et c'est son code
   * INSEE qui part chercher les commerces.
   */
  assert.ok(CODE_RECHERCHE.includes("{ codeInsee: commune.code }"));
  assert.ok(CODE_RECHERCHE.includes("{ ville: villeLibre.trim() }"), "le repli existe");
  assert.ok(CODE_ROUTE_SEARCH.includes("decouvrirParCodeInsee"));
  assert.ok(CODE_ROUTE_SEARCH.includes("codeInseeValide(codeInsee)"), "revérifié côté serveur");
  /*
   * ⚠️ LE CODE INSEE EST FILTRÉ, ET LE FILTRE EST EXÉCUTÉ ICI. Il vit dans un
   * module FEUILLE (`lib/communes/bornes.ts`) précisément pour pouvoir
   * l'éprouver : `annuaire.ts` et `overpass.ts` sont `server-only` et ne
   * s'importent pas depuis un harnais Node, ce qui aurait réduit la règle la
   * plus importante du chantier à une affirmation.
   */
  assert.ok(codeInseeValide("83137"), "Toulon");
  assert.ok(codeInseeValide("2a004"), "la Corse, en minuscules");
  assert.ok(codeInseeValide("2B033"), "la Corse, en majuscules");
  assert.ok(!codeInseeValide("83"), "un département n'est pas une commune");
  assert.ok(!codeInseeValide("8313X"), "une lettre en dernière position");
  assert.ok(!codeInseeValide('83137"]["x"="y'), "aucune injection possible");
  assert.ok(!codeInseeValide("831370"), "six chiffres");
  assert.ok(!codeInseeValide(""), "rien du tout");
  assert.equal(departementDuCodeInsee("83137"), "83");
  assert.equal(departementDuCodeInsee("2a004"), "2A");

  // Et la requête Overpass interroge bien l'étiquette `ref:INSEE`, avec son
  // propre filtre — deux barrières, une seule règle.
  const overpass = sansProse(lire("../../lib/openstreetmap/overpass.ts"));
  assert.ok(overpass.includes('"ref:INSEE"="${code}"'), "la requête vise ref:INSEE");
  assert.ok(
    overpass.includes("/^[0-9][0-9AB][0-9]{3}$/.test(code)"),
    "et refuse tout ce qui n'est pas un code INSEE",
  );
  assert.ok(overpass.includes('throw new RangeError("code INSEE invalide")'));
});

test("S-31 — LA SAISIE DE L'ÉLÈVE NE PART PAS DIRECTEMENT CHEZ UN TIERS", () => {
  // L'annuaire est `server-only`, et l'écran passe par NOTRE route : un appel
  // direct depuis le navigateur enverrait la saisie ET l'adresse IP de l'élève
  // à un tiers, à chaque frappe, hors de toute limite de débit.
  assert.ok(CODE_ANNUAIRE.includes('import "server-only"'));
  assert.ok(!CODE_RECHERCHE.includes("geo.api.gouv.fr"), "l'écran ne connaît pas l'amont");
  assert.ok(CODE_RECHERCHE.includes('"/api/student/stores/communes"'));
  // Et la route porte authentification, profil élève et limite de débit.
  for (const garde of ["auth.getUser()", '.from("students")', "consumeRateLimit("]) {
    assert.ok(CODE_ROUTE_COMMUNES.includes(garde), garde);
  }
  assert.ok(CODE_ROUTE_COMMUNES.includes("POST"), "un POST, pas une chaîne de requête");
});

test("S-32 — LES BORNES DE SAISIE SONT PARTAGÉES, PAS RECOPIÉES", () => {
  // Deux jeux de bornes divergeraient, et le formulaire accepterait alors ce
  // que le serveur refuse.
  const schemas = sansProse(lire("../../lib/api/schemas/magasins.ts"));
  assert.ok(schemas.includes('from "@/lib/communes/bornes"'));
  assert.ok(SAISIE_MIN < SAISIE_MAX);
  assert.equal(SUGGESTIONS_MAX, 5);
});

/* ══════════════════════════════════════════════════════════════════════════
   30. LES ÉTATS VISUELS, ET LE CHARGEMENT QUI SE TERMINE TOUJOURS
   ══════════════════════════════════════════════════════════════════════════ */

const TOUTES_LES_ISSUES: readonly Issue[] = [
  { type: "trouves", nombre: 3 },
  { type: "trouves", nombre: 0 },
  { type: "echec" },
  { type: "permission_refusee" },
  { type: "position_indisponible" },
  { type: "position_expiree" },
];

test("S-33 — AUCUNE ISSUE NE LAISSE UN CHARGEMENT EN COURS", () => {
  /*
   * ⚠️ C'EST L'INVARIANT QUE L'ÉNONCÉ DEMANDE — « toujours terminer l'état de
   * chargement, même en cas d'erreur » — ET IL EST ICI VRAI PAR CONSTRUCTION.
   * Tant que chaque chemin posait son état lui-même, il suffisait d'un `return`
   * oublié pour laisser l'écran tourner indéfiniment.
   */
  for (const issue of TOUTES_LES_ISSUES) {
    const suite = situationApres(issue);
    assert.ok(!enChargement(suite), `${issue.type} → ${suite} ne doit pas charger`);
  }
});

test("S-34 — SIX SITUATIONS DISTINCTES, ET AUCUNE NE SE CONFOND", () => {
  const attendues: readonly Situation[] = [
    "repos",
    "permission",
    "chargement_autour",
    "chargement_ville",
    "resultats",
    "aucun_resultat",
    "erreur",
  ];
  const vues = new Set<Situation>();
  for (const issue of TOUTES_LES_ISSUES) vues.add(situationApres(issue));
  assert.ok(vues.has("resultats") && vues.has("aucun_resultat") && vues.has("erreur"));
  for (const situation of attendues) {
    // Chaque situation a soit un message, soit une raison explicite de n'en
    // pas avoir (« repos » et « resultats » montrent du contenu, pas un texte).
    const message = messageDeSituation(situation, { mode: "autour", tronque: false });
    if (situation === "repos" || situation === "resultats") {
      assert.equal(message, null, situation);
    } else {
      assert.ok(message !== null && message.texte.trim() !== "", situation);
    }
  }
  /*
   * ⚠️ QUATRE DEPUIS LA CORRECTION, ET LA QUATRIÈME EST UN AJOUT DÉLIBÉRÉ.
   * `chargement_commune` manquait : la résolution d'une saisie en communes
   * n'avait aucun état, donc aucun indicateur, et rien ne garantissait qu'elle
   * se termine. L'élève voyait les suggestions apparaître sans savoir qu'on
   * cherchait, et appuyait sur « Rechercher » sans avoir choisi sa commune.
   */
  assert.equal(SITUATIONS_DE_CHARGEMENT.size, 4);
  assert.ok(SITUATIONS_DE_CHARGEMENT.has("chargement_commune"));
});

test("S-35 — UN REFUS DE LOCALISATION N'EST PAS UNE PANNE", () => {
  // Trois refus, trois conduites : passer par la ville, réessayer plus tard,
  // réessayer tout de suite. Et aucun n'est affiché en rouge.
  assert.deepEqual(issueDeGeolocalisation(1), { type: "permission_refusee" });
  assert.deepEqual(issueDeGeolocalisation(2), { type: "position_indisponible" });
  assert.deepEqual(issueDeGeolocalisation(3), { type: "position_expiree" });
  assert.deepEqual(issueDeGeolocalisation(undefined), { type: "echec" });

  for (const situation of ["permission_refusee", "position_indisponible", "position_expiree"] as const) {
    const message = messageDeSituation(situation, { mode: "autour", tronque: false });
    assert.equal(message!.role, "status", `${situation} n'est pas une alerte`);
  }
  const panne = messageDeSituation("erreur", { mode: "autour", tronque: false });
  assert.equal(panne!.role, "alert", "une panne, elle, est une alerte");
  assert.match(
    messageDeSituation("permission_refusee", { mode: "autour", tronque: false })!.texte,
    /rien n'est enregistré/i,
    "et le refus rassure sur ce qui n'a pas été gardé",
  );
});

test("S-36 — « AUCUN RÉSULTAT » NE MENT PAS QUAND LA RECHERCHE A ÉTÉ ÉCOURTÉE", () => {
  /*
   * ⚠️ AFFIRMER L'ABSENCE SERAIT AFFIRMER CE QU'ON N'A PAS MESURÉ. Quand
   * `tronque` est vrai, nous n'avons consulté qu'une portion : l'élève
   * renoncerait à un magasin qui existe.
   */
  const complet = messageDeSituation("aucun_resultat", { mode: "ville", tronque: false });
  assert.match(complet!.texte, /aucun commerce cartographié/i);

  const ecourte = messageDeSituation("aucun_resultat", { mode: "ville", tronque: true });
  assert.match(ecourte!.texte, /écourtée/i);
  assert.match(ecourte!.texte, /peut-être d'autres/i);
  assert.notEqual(complet!.texte, ecourte!.texte, "deux situations, deux phrases");
});

test("S-37 — LES DEUX MODES N'ONT PAS LE MÊME MESSAGE D'ABSENCE", () => {
  const autour = messageDeSituation("aucun_resultat", { mode: "autour", tronque: false });
  const ville = messageDeSituation("aucun_resultat", { mode: "ville", tronque: false });
  assert.match(autour!.texte, /autour de toi/i);
  assert.match(ville!.texte, /cette commune/i);
});

test("S-38 — AUCUN CHARGEMENT PERMANENT DANS L'ÉCRAN : une seule porte de sortie", () => {
  // Toutes les fins passent par `conclure`, qui appelle `situationApres`.
  assert.ok(CODE_RECHERCHE.includes("setSituation(situationApres(issue))"));
  assert.equal(
    (CODE_RECHERCHE.match(/setSituation\(situationApres/g) ?? []).length,
    1,
    "une seule porte de sortie",
  );
  // Et le verrou anti-double-tap est rendu dans tous les cas.
  assert.equal((CODE_RECHERCHE.match(/finally \{/g) ?? []).length, 2, "un par recherche");
  assert.equal((CODE_RECHERCHE.match(/enVol\.current = false/g) ?? []).length, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   LA MISE EN PAGE, ET CE QUI RESTE À SA PLACE
   ══════════════════════════════════════════════════════════════════════════ */

test("S-39 — ORDINATEUR : LISTE ET CARTE ENSEMBLE ; TÉLÉPHONE : DEUX ONGLETS", () => {
  /*
   * ⚠️ CÔTE À CÔTE SUR 375 px DONNERAIT DEUX COLONNES DE 180 px — donc un
   * débordement horizontal, ou une carte illisible. Les onglets ne sont donc
   * pas un repli : c'est la bonne réponse à cette largeur.
   */
  assert.ok(CODE_RECHERCHE.includes("lg:grid-cols-["), "deux colonnes sur grand écran");
  assert.ok(CODE_RECHERCHE.includes("lg:hidden"), "les onglets disparaissent sur grand écran");
  assert.ok(CODE_RECHERCHE.includes("hidden min-w-0 lg:block"), "et les deux volets réapparaissent");
  // `min-w-0` partout où une grille pourrait pousser : c'est ce qui empêche le
  // débordement horizontal quand un nom de commerce est long.
  assert.ok(CODE_RECHERCHE.includes("minmax(0,"), "des colonnes qui peuvent rétrécir");
  assert.ok(CODE_RECHERCHE.includes("truncate"), "un nom long est coupé, pas poussé");
});

test("S-40 — LA CARTE NE REMPLACE JAMAIS LA LISTE", () => {
  // Une carte en WebGL n'est pas lisible par un lecteur d'écran : la liste est
  // le chemin accessible, et elle existe toujours.
  assert.ok(CODE_CARTE.includes('aria-hidden="true"'), "le canevas est masqué aux lecteurs");
  assert.ok(CODE_RECHERCHE.includes("<ListeDesCommerces"), "la liste est toujours montée");
  // Et chaque message d'indisponibilité le dit à l'élève — y compris les
  // échecs d'exécution, qui ne passent pas par `messageCarteIndisponible`.
  for (const raison of ["style_invalide", "origine_interdite"] as const) {
    assert.match(messageCarteIndisponible(raison), /liste des commerces reste utilisable/i);
  }
  assert.equal(
    (CODE_CARTE.match(/liste des commerces reste utilisable/g) ?? []).length,
    4,
    "les quatre échecs d'exécution le disent aussi",
  );
});

test("S-41 — CHERCHER N'EST PAS CHOISIR : l'écriture reste où elle était", () => {
  /*
   * ⚠️ LA RECHERCHE NE FAIT AUCUNE ÉCRITURE. Le magasin choisi passe par
   * `/select`, qui relit la fiche chez la source : c'est la doctrine C4.3a, et
   * la refonte visuelle ne l'a pas déplacée.
   */
  assert.ok(!CODE_RECHERCHE.includes("/api/student/stores/select"));
  assert.ok(CODE_CHOIX.includes("/api/student/stores/select"));
  assert.ok(CODE_RECHERCHE.includes("onChoisir"), "elle propose, le parent écrit");
  // Et l'identité, rien de plus, voyage au moment du choix.
  assert.ok(CODE_CHOIX.includes("osmType: magasin.osmType, osmId: magasin.osmId"));
  for (const interdit of ["name: magasin.name", "lat: magasin.lat", "opLocationId"]) {
    assert.ok(!CODE_CHOIX.includes(interdit), `aucune description envoyée (${interdit})`);
  }
});

test("S-42 — L'ÉCHEC D'ENREGISTREMENT SE VOIT", () => {
  // Le taire laisserait l'élève croire que son magasin est enregistré.
  assert.ok(CODE_CHOIX.includes("setEchecDEcriture(true)"));
  assert.ok(CODE_CHOIX.includes('role="alert"'));
});

test("S-43 — LA POSITION DE L'ÉLÈVE N'EST PERSISTÉE NULLE PART", () => {
  /*
   * La carte oblige à la GARDER le temps de l'afficher, mais pas à l'écrire.
   * Elle vit dans un état React, et disparaît au démontage comme au changement
   * de mode.
   */
  for (const interdit of ["localStorage", "sessionStorage", "document.cookie", "searchParams"]) {
    assert.ok(!CODE_RECHERCHE.includes(interdit), `aucune persistance (${interdit})`);
    assert.ok(!CODE_CARTE.includes(interdit), `aucune persistance dans la carte (${interdit})`);
  }
  assert.ok(CODE_RECHERCHE.includes("setDepart(null)"), "effacée au changement de mode");
  // Et elle part dans un CORPS de requête, jamais dans une URL.
  assert.ok(CODE_RECHERCHE.includes('method: "POST"'));
  assert.ok(!/nearby\?/.test(CODE_RECHERCHE), "aucune position en chaîne de requête");
});

test("S-44 — LES TYPES DE COMMERCES ANNONCÉS SONT CEUX QUE LE MOTEUR CHERCHE", async () => {
  /*
   * ⚠️ NE PAS PROMETTRE CE QU'ON NE CHERCHE PAS. L'écran annonce des familles
   * de commerces : chacune doit correspondre à une étiquette OSM réellement
   * interrogée, sinon l'élève cherche en vain.
   */
  const { SHOP_ALIMENTAIRES } = await import("../../lib/nutrition/magasins-osm");
  for (const attendu of [
    "supermarket",
    "greengrocer",
    "butcher",
    "bakery",
    "cheese",
    "seafood",
    "health_food",
    "convenience",
  ]) {
    assert.ok(SHOP_ALIMENTAIRES.has(attendu), `l'écran annonce ${attendu}`);
  }
  assert.match(CODE_RECHERCHE, /Supermarchés/);
  assert.match(CODE_RECHERCHE, /bio/);
  assert.match(CODE_RECHERCHE, /épiceries/);
});
