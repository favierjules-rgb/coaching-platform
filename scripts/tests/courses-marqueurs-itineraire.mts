/**
 * Harnais — COURSES : MARQUEURS DE LA CARTE ET CHOIX DE L'ITINÉRAIRE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS MESURE
 * ────────────────────────────────────────────────────────────────────────────
 * Deux chantiers, et deux natures de preuve.
 *
 * Les MARQUEURS sont devenus une source GeoJSON à regroupement : ce qui se
 * décide — quelles entités, quelles identités, quelles coordonnées retenues —
 * est pur et s'exécute ici. Ce qui relève de MapLibre — le regroupement lui-
 * même, les couches, les écouteurs — se vérifie sur le code du composant, et
 * le rendu réel a été éprouvé dans un navigateur (voir le rapport).
 *
 * Les URL D'ITINÉRAIRE, elles, s'exécutent entièrement : ce sont trois
 * fonctions pures, et c'est là que les fautes se logent — une virgule mal
 * encodée, un paramètre oublié, une origine transmise sans le vouloir.
 *
 * ⚠️ UN REVIREMENT ASSUMÉ. `S-15` interdisait tout regroupement, et sa raison
 * était bonne : trois magasins derrière un chiffre, ce sont trois commerces
 * qu'on ne peut pas choisir. Le regroupement est maintenant DEMANDÉ, et ce
 * qu'il faut garantir a changé de forme : non plus « aucun amas », mais
 * « tout amas se déplie, et au zoom rapproché chacun redevient choisissable ».
 * C'est `M-08` qui porte cette garantie.
 *
 * Lancement : npm run test:courses-marqueurs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cadreDeLaRecherche,
  collectionDeMagasins,
  coordonneesFiables,
  magasinsSansPoint,
} from "../../lib/cartographie/vue-magasins";
import {
  FOURNISSEURS,
  fournisseursOrdonnes,
  urlDuFournisseur,
} from "../../lib/cartographie/itineraire";
import { cleIdentiteOsm, type MagasinOsm } from "../../lib/nutrition/magasins-osm";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_CARTE = sansProse(lire("../../components/student/CarteDesMagasins.tsx"));
const CODE_RECHERCHE = sansProse(lire("../../components/student/RechercheDeCommerces.tsx"));
const CODE_CHOIX = sansProse(lire("../../components/student/ChoixItineraire.tsx"));
const CODE_ITINERAIRE = sansProse(lire("../../lib/cartographie/itineraire.ts"));

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
   PHASE 1 — LES MARQUEURS
   ══════════════════════════════════════════════════════════════════════════ */

test("M-01 — UNE ENTITÉ PAR COMMERCE GÉOLOCALISÉ", () => {
  const trouves = [
    magasin({ osmId: 1, name: "A", lat: 43.10, lon: 5.90 }),
    magasin({ osmId: 2, name: "B", osmType: "WAY", lat: 43.20, lon: 6.00 }),
    magasin({ osmId: 3, name: "C", osmType: "RELATION", lat: 43.15, lon: 5.95 }),
  ];
  const collection = collectionDeMagasins(trouves);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features.length, 3);
  // ⚠️ L'ORDRE GeoJSON EST [lon, lat]. L'inverser placerait Toulon en Somalie,
  // et le défaut serait silencieux : les deux nombres sont plausibles.
  assert.deepEqual(collection.features[0]!.geometry.coordinates, [5.9, 43.1]);
  assert.deepEqual(
    collection.features.map((f) => f.properties.cle),
    trouves.map((m) => cleIdentiteOsm(m)),
    "la clé de l'entité EST l'identité OSM : c'est ce qui lie la carte à la liste",
  );
});

test("M-02 — UN COMMERCE SANS COORDONNÉES FIABLES RESTE DANS LA LISTE, SANS MARQUEUR", () => {
  /*
   * ⚠️ IL A UN NOM ET UNE ADRESSE : l'écarter de la liste retirerait à l'élève
   * un commerce qui existe. Mais le poser sur la carte demanderait d'inventer
   * un point, et un marqueur faux envoie quelqu'un au mauvais endroit.
   */
  const douteux = [
    magasin({ osmId: 10, name: "NaN", lat: Number.NaN, lon: 5.9 }),
    magasin({ osmId: 11, name: "Hors bornes", lat: 999, lon: 5.9 }),
    magasin({ osmId: 12, name: "Longitude folle", lat: 43.1, lon: 1000 }),
    // ⚠️ L'ÎLE NULLE : `0,0` est au large du golfe de Guinée. C'est la valeur
    // de deux champs vides additionnés, jamais celle d'une épicerie française.
    magasin({ osmId: 13, name: "Île nulle", lat: 0, lon: 0 }),
  ];
  const bons = [magasin({ osmId: 1, name: "Vrai", lat: 43.1, lon: 5.9 })];

  for (const m of douteux) assert.equal(coordonneesFiables(m), false, m.name);
  assert.equal(coordonneesFiables(bons[0]!), true);

  const collection = collectionDeMagasins([...douteux, ...bons]);
  assert.equal(collection.features.length, 1, "un seul point : celui qui en a");
  assert.equal(collection.features[0]!.properties.nom, "Vrai");

  // Et l'écran peut DIRE lesquels n'ont pas pu être placés.
  assert.equal(magasinsSansPoint([...douteux, ...bons]).length, 4);
});

test("M-03 — AUCUN DOUBLON D'ENTITÉ, MÊME SI LA LISTE EN PORTE UN", () => {
  const deuxFois = [
    magasin({ osmId: 7, name: "Lidl" }),
    magasin({ osmId: 7, name: "Lidl" }),
    magasin({ osmId: 7, name: "Lidl", osmType: "WAY" }),
  ];
  const collection = collectionDeMagasins(deuxFois);
  assert.equal(collection.features.length, 2, "NODE 7 et WAY 7 sont deux commerces, pas trois");
  const cles = collection.features.map((f) => f.properties.cle);
  assert.equal(new Set(cles).size, cles.length, "aucune clé en double");
});

test("M-04 — LES MARQUEURS NE S'ACCUMULENT PAS D'UNE RECHERCHE À L'AUTRE", () => {
  /*
   * ⚠️ C'EST LA RAISON D'ÊTRE DE LA SOURCE. Soixante marqueurs du DOM recréés
   * à chaque sélection, c'était soixante occasions d'en oublier un. Une source
   * se REMPLACE : il n'y a pas d'accumulation possible.
   */
  assert.match(CODE_CARTE, /source\.setData\(collectionDeMagasins\(magasins\)\)/);
  assert.match(CODE_CARTE, /instance\.getSource\(SOURCE\) === undefined/, "créée une seule fois");
  assert.ok(
    !CODE_CARTE.includes("marqueursDepuisMagasins"),
    "plus aucun marqueur DOM par commerce",
  );
  // Le seul marqueur DOM restant est celui de l'élève — il n'y en a qu'un.
  assert.equal((CODE_CARTE.match(/new Marker\(/g) ?? []).length, 1);
  assert.match(CODE_CARTE, /elementDeDepart\(\)/);
});

test("M-05 — LE COMMERCE CHOISI A SA PROPRE COUCHE, AU-DESSUS DES AUTRES", () => {
  // Le teinter dans la couche commune suffirait à le colorer, pas à le faire
  // passer devant : deux pastilles qui se chevauchent cacheraient justement
  // celle qu'on vient de choisir.
  assert.match(CODE_CARTE, /const COUCHE_CHOISI = "commerces-choisi"/);
  const iPoint = CODE_CARTE.indexOf("id: COUCHE_POINT");
  const iChoisi = CODE_CARTE.indexOf("id: COUCHE_CHOISI");
  assert.ok(iPoint > 0 && iChoisi > iPoint, "la couche du choisi est ajoutée APRÈS, donc au-dessus");
  /*
   * Vert pour le choisi, neutre pour les autres — et les deux viennent du
   * thème.
   *
   * ⚠️ CE TEST VERROUILLAIT UN DÉFAUT, ET IL A ÉTÉ CORRIGÉ AVEC LUI. Il
   * exigeait littéralement `const CHOISI = "var(--success)"`. Or MapLibre
   * analyse les couleurs lui-même, hors du moteur de style du navigateur : il
   * refuse `var(--…)` et REJETTE LA COUCHE ENTIÈRE. Mesuré dans Chromium —
   * sept erreurs de validation, aucune couche ajoutée, aucun marqueur, aucun
   * amas. L'intention du test était juste (la couleur vient du thème), le
   * mécanisme exigé ne l'était pas.
   *
   * CE QUI EST EXIGÉ DÉSORMAIS : le jeton reste la source, et il est RÉSOLU à
   * l'exécution sur le conteneur de la carte.
   */
  assert.match(CODE_CARTE, /const JETON_CHOISI = "--success"/);
  assert.match(CODE_CARTE, /const JETON_NEUTRE = "--primary"/);
  assert.match(CODE_CARTE, /const CHOISI = couleurDuJeton\(racine, JETON_CHOISI, REPLI_CHOISI\)/);
  assert.match(CODE_CARTE, /const NEUTRE = couleurDuJeton\(racine, JETON_NEUTRE, REPLI_NEUTRE\)/);
  assert.match(CODE_CARTE, /getComputedStyle\(element\)\.getPropertyValue\(jeton\)/);
  /*
   * ⚠️ LES SEULES COULEURS LITTÉRALES SONT LES REPLIS, ET ELLES SONT NOMMÉES.
   * Un hexadécimal posé directement dans une couche contournerait le thème ;
   * un repli nommé ne sert que si la feuille de style n'est pas appliquée.
   */
  const avantLeMarqueur = CODE_CARTE.split("elementDeDepart")[0] ?? "";
  for (const ligne of avantLeMarqueur.split("\n").filter((l) => /#[0-9a-fA-F]{6}/.test(l))) {
    assert.match(ligne, /^const REPLI_[A-Z]+ = "#[0-9a-fA-F]{6}";$/, `couleur en dur : ${ligne.trim()}`);
  }
  assert.equal(
    (avantLeMarqueur.match(/#[0-9a-fA-F]{6}/g) ?? []).length,
    3,
    "trois replis, un par jeton, et rien d'autre",
  );
  // Et il est PLUS GROS : une différence de teinte seule disparaît au
  // chevauchement.
  assert.match(CODE_CARTE, /"circle-radius": 13/);
  assert.match(CODE_CARTE, /"circle-radius": 9/);
});

test("M-06 — SÉLECTIONNER DANS LA LISTE MET EN ÉVIDENCE SUR LA CARTE, SANS RIEN RECRÉER", () => {
  // La mise en évidence passe par un FILTRE sur la couche : aucun marqueur
  // détruit ni reconstruit à chaque clic.
  assert.match(CODE_CARTE, /instance\.setFilter\(COUCHE_CHOISI/);
  assert.match(CODE_CARTE, /\["==", \["get", "cle"\], selectionnee \?\? ""\]/);
});

test("M-07 — SÉLECTIONNER RECENTRE PROGRESSIVEMENT, SANS DÉZOOMER", () => {
  assert.match(CODE_CARTE, /instance\.easeTo\(\{\s*center: \[choisi\.lon, choisi\.lat\]/);
  // ⚠️ `Math.max` : garder le zoom courant s'il est déjà plus rapproché, pour
  // ne pas reculer sous les pieds de quelqu'un qui venait d'aller voir de près.
  assert.match(CODE_CARTE, /zoom: Math\.max\(instance\.getZoom\(\), 14\)/);
  assert.match(CODE_CARTE, /duration: 520/, "« progressivement », donc animé");
  // Et pas de recentrage sur un commerce sans coordonnées.
  assert.match(CODE_CARTE, /!coordonneesFiables\(choisi\)\) return/);
});

test("M-08 — UN AMAS SE DÉPLIE, ET AU ZOOM RAPPROCHÉ CHAQUE COMMERCE REDEVIENT CHOISISSABLE", () => {
  /*
   * ⚠️ C'EST CE QUI REMPLACE L'ANCIENNE INTERDICTION DE REGROUPER. Le risque
   * qu'elle évitait — un commerce caché derrière un chiffre, impossible à
   * choisir — est écarté autrement : tout amas mène quelque part, et au-delà
   * d'un certain zoom il n'y en a plus du tout.
   */
  assert.match(CODE_CARTE, /cluster: true/);
  assert.match(CODE_CARTE, /clusterMaxZoom: 13/, "au-delà, plus aucun amas");
  assert.match(CODE_CARTE, /clusterRadius: 44/);
  // Le clic sur un amas demande à la source le zoom où il éclate : un zoom
  // fixe laisserait parfois l'amas intact, et le geste ne mènerait nulle part.
  assert.match(CODE_CARTE, /getClusterExpansionZoom/);
  assert.match(CODE_CARTE, /instance\.easeTo\(\{ center: centre, zoom, duration: 420 \}\)/);
  // Et un repli si la source refuse de répondre : on s'approche quand même.
  assert.match(CODE_CARTE, /zoom: instance\.getZoom\(\) \+ 2/);
});

test("M-09 — TOUCHER UN MARQUEUR SÉLECTIONNE LE COMMERCE, ET LA LISTE SUIT", () => {
  // Le clic lit la clé de l'entité — la MÊME que celle de la liste — et la
  // remonte au parent, qui tient la sélection pour les deux vues.
  assert.match(CODE_CARTE, /selection\.current\(cle\)/);
  assert.match(CODE_CARTE, /evenement\.features\?\.\[0\]\?\.properties\?\.cle/);
  assert.match(CODE_RECHERCHE, /onSelectionner=\{\(cle\) => \{/);
  assert.match(CODE_RECHERCHE, /ficheDuSelectionne=/, "et la fiche s'ouvre sur la carte");
  // Le pointeur change de forme : sans cela, rien ne dit qu'une pastille se clique.
  assert.match(CODE_CARTE, /style\.cursor = "pointer"/);
});

test("M-10 — LES ÉCOUTEURS SONT RETIRÉS, PAS SEULEMENT LA CARTE DÉTRUITE", () => {
  /*
   * ⚠️ LE NETTOYAGE TOURNE AUSSI QUAND SEULE LA LISTE CHANGE. Sans lui, chaque
   * recherche ajouterait une paire d'écouteurs sur les mêmes couches, et un
   * clic finirait par sélectionner sept fois.
   */
  assert.match(CODE_CARTE, /ecouteurs\.push\(\{ couche, type, f/);
  assert.match(CODE_CARTE, /instance\.off\(type as never, couche, f as never\)/);
  assert.match(CODE_CARTE, /marqueurDepart\?\.remove\(\)/);
  // Et le démontage de la carte elle-même reste en place.
  assert.match(CODE_CARTE, /instance\?\.remove\(\)/);
});

test("M-11 — LE CADRAGE N'A PAS CHANGÉ DE RÈGLE", () => {
  // Les commerces d'abord, la position ensuite, le centre de commune en
  // dernier recours — la correction précédente est intacte.
  const cadre = cadreDeLaRecherche([magasin({ lat: 43.2, lon: 6.0 })], { lat: 43.0, lon: 5.8 }, null);
  assert.deepEqual(cadre, { sudOuest: { lat: 43.0, lon: 5.8 }, nordEst: { lat: 43.2, lon: 6.0 } });
  assert.match(CODE_CARTE, /cadreDeLaRecherche\(magasins, depart, centreCommune\)/);
});

/* ══════════════════════════════════════════════════════════════════════════
   PHASE 2 — LES TROIS ITINÉRAIRES
   ══════════════════════════════════════════════════════════════════════════ */

const TOULON = { lat: 43.1364, lon: 5.9334 };

test("I-01 — LES TROIS URL SONT CELLES DES LIENS UNIVERSELS OFFICIELS", () => {
  const google = new URL(urlDuFournisseur("google", TOULON)!);
  assert.equal(google.origin + google.pathname, "https://www.google.com/maps/dir/");
  assert.equal(google.searchParams.get("api"), "1");
  assert.equal(google.searchParams.get("destination"), "43.136400,5.933400");
  assert.equal(google.searchParams.get("travelmode"), "driving");

  const waze = new URL(urlDuFournisseur("waze", TOULON)!);
  assert.equal(waze.origin + waze.pathname, "https://waze.com/ul");
  assert.equal(waze.searchParams.get("ll"), "43.136400,5.933400");
  assert.equal(waze.searchParams.get("navigate"), "yes");
  assert.equal(waze.searchParams.get("zoom"), "17");

  const apple = new URL(urlDuFournisseur("apple", TOULON)!);
  assert.equal(apple.origin + apple.pathname, "https://maps.apple.com/");
  assert.equal(apple.searchParams.get("daddr"), "43.136400,5.933400");
  assert.equal(apple.searchParams.get("dirflg"), "d");
});

test("I-02 — LES COORDONNÉES SONT ENCODÉES, ET RELUES À L'IDENTIQUE", () => {
  /*
   * ⚠️ LA VIRGULE RESSORT EN `%2C`, ET C'EST CORRECT. `URLSearchParams`
   * encode ce qui doit l'être ; les trois services décodent. On vérifie donc
   * la valeur RELUE, pas la chaîne brute — un test sur la chaîne brute
   * casserait au premier changement d'encodage sans qu'aucun lien soit cassé.
   */
  for (const id of ["google", "waze", "apple"] as const) {
    const href = urlDuFournisseur(id, TOULON)!;
    assert.ok(href.includes("%2C"), `${id} : la virgule est encodée`);
    const url = new URL(href);
    const valeur = url.searchParams.get("destination") ?? url.searchParams.get("ll") ?? url.searchParams.get("daddr");
    assert.equal(valeur, "43.136400,5.933400", `${id} : relue à l'identique`);
  }
  // Une coordonnée négative, et une à l'autre bout du monde.
  const sud = urlDuFournisseur("google", { lat: -33.8688, lon: 151.2093 })!;
  assert.equal(new URL(sud).searchParams.get("destination"), "-33.868800,151.209300");
});

test("I-03 — AUCUN POINT DE DÉPART N'EST TRANSMIS", () => {
  /*
   * ⚠️ C'EST UN GAIN DE CONFIDENTIALITÉ, PAS UN OUBLI. Les trois applications
   * déterminent la position de l'appareil elles-mêmes, mieux que nous. Ne rien
   * envoyer veut dire qu'aucune n'apprend d'où part cet élève.
   */
  for (const id of ["google", "waze", "apple"] as const) {
    const url = new URL(urlDuFournisseur(id, TOULON)!);
    for (const parametre of ["saddr", "origin", "from", "sll", "start"]) {
      assert.equal(url.searchParams.get(parametre), null, `${id} ne doit pas porter ${parametre}`);
    }
  }
  // Et ouvrir un itinéraire ne dépend d'aucune géolocalisation.
  for (const interdit of ["geolocation", "getCurrentPosition", "depart"]) {
    assert.ok(!CODE_CHOIX.includes(interdit), `le sélecteur ignore la position (${interdit})`);
    assert.ok(!CODE_ITINERAIRE.includes(interdit), `le module ignore la position (${interdit})`);
  }
});

test("I-04 — AUCUN SCHÉMA PRIVÉ : le bouton ne mène jamais dans le vide", () => {
  // `waze://` ou `comgooglemaps://` n'ouvrent rien quand l'application est
  // absente : l'onglet reste blanc, sans message, et le bouton paraît cassé.
  for (const id of ["google", "waze", "apple"] as const) {
    assert.match(urlDuFournisseur(id, TOULON)!, /^https:\/\//, `${id} doit être en https`);
  }
  for (const schema of ["waze://", "comgooglemaps://", "maps://", "geo:"]) {
    assert.ok(!CODE_ITINERAIRE.includes(schema), `aucun schéma privé (${schema})`);
    assert.ok(!CODE_CHOIX.includes(schema));
  }
});

test("I-05 — UNE COORDONNÉE ABERRANTE NE PRODUIT PAS D'URL", () => {
  for (const point of [
    { lat: Number.NaN, lon: 5.9 },
    { lat: 43.1, lon: Number.POSITIVE_INFINITY },
    { lat: 91, lon: 5.9 },
    { lat: 43.1, lon: 181 },
  ]) {
    for (const id of ["google", "waze", "apple"] as const) {
      assert.equal(urlDuFournisseur(id, point), null, `${id} ne doit rien produire`);
    }
  }
  // Et l'écran n'affiche alors aucune ligne pour ce fournisseur.
  assert.match(CODE_CHOIX, /if \(href === null\) return null;/);
});

test("I-06 — UN SEUL FOURNISSEUR REÇOIT LES COORDONNÉES", () => {
  // Les deux autres liens existent dans le DOM mais ne sont jamais ouverts, et
  // rien n'est préchargé : aucun `fetch`, aucune image, aucun `prefetch`.
  for (const interdit of ["fetch(", "prefetch", "<img", "new Image("]) {
    assert.ok(!CODE_CHOIX.includes(interdit), `le sélecteur ne contacte personne (${interdit})`);
  }
  assert.match(CODE_CHOIX, /rel="noopener noreferrer"/, "et l'URL de la page ne fuit pas");
  assert.match(CODE_CHOIX, /target="_blank"/);
});

test("I-07 — LA PLATEFORME CHANGE L'ORDRE, JAMAIS LE CHOIX", () => {
  const surIphone = fournisseursOrdonnes(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  );
  assert.equal(surIphone[0]!.id, "apple", "Plans en premier sur iPhone");
  const surAndroid = fournisseursOrdonnes("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36");
  assert.equal(surAndroid[0]!.id, "google", "Google Maps en premier sur Android");
  const surMac = fournisseursOrdonnes("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  assert.equal(surMac[0]!.id, "apple");

  // ⚠️ LES TROIS RESTENT OFFERTES, PARTOUT. Beaucoup de gens préfèrent Waze
  // quel que soit leur téléphone : l'ordre ne doit rien retirer.
  for (const agent of [undefined, "iPhone", "Android", "Windows NT 10.0"]) {
    const liste = fournisseursOrdonnes(agent);
    assert.equal(liste.length, 3, `${agent} : les trois applications`);
    assert.deepEqual(
      [...liste].map((f) => f.id).sort(),
      ["apple", "google", "waze"],
      "aucune n'est retirée",
    );
  }
  assert.equal(FOURNISSEURS.length, 3);
});

/* ══════════════════════════════════════════════════════════════════════════
   PHASE 3 — ERGONOMIE ET ACCESSIBILITÉ
   ══════════════════════════════════════════════════════════════════════════ */

test("I-08 — LE SÉLECTEUR EST UNE VRAIE BOÎTE DE DIALOGUE, UTILISABLE AU CLAVIER", () => {
  assert.match(CODE_CHOIX, /role="dialog"/);
  assert.match(CODE_CHOIX, /aria-modal="true"/);
  assert.match(CODE_CHOIX, /aria-labelledby=\{titreId\}/, "la boîte porte un nom");
  assert.match(CODE_CHOIX, /aria-haspopup="dialog"/);
  assert.match(CODE_CHOIX, /aria-expanded=\{ouvert\}/);
  // Échap ferme, et le focus REVIENT d'où il venait : sans ce retour, la
  // tabulation repart du début du document.
  assert.match(CODE_CHOIX, /evenement\.key === "Escape"/);
  assert.match(CODE_CHOIX, /declencheur\.current\?\.focus\(\)/);
  // Et le premier choix reçoit le focus à l'ouverture.
  assert.match(CODE_CHOIX, /querySelector<HTMLElement>\("a\[href\]"\)/);
});

test("I-09 — LE SÉLECTEUR SE FERME APRÈS LE CHOIX, ET AU CLIC HORS DU PANNEAU", () => {
  assert.match(CODE_CHOIX, /onClick=\{\(\) => setOuvert\(false\)\}/, "fermé après le choix");
  assert.match(CODE_CHOIX, /evenement\.target === evenement\.currentTarget\) setOuvert\(false\)/);
});

test("I-10 — IL EST UTILISABLE AU POUCE, ET NE PASSE PAS SOUS LA BARRE D'ACCUEIL", () => {
  // Feuille en bas sur téléphone, boîte centrée au-dessus : en bas, elle tombe
  // sous le pouce ; centrée sur grand écran, elle ne traverse pas tout l'écran.
  assert.match(CODE_CHOIX, /items-end justify-center sm:items-center/);
  assert.match(CODE_CHOIX, /env\(safe-area-inset-bottom\)/, "la barre d'accueil de l'iPhone");
  assert.match(CODE_CHOIX, /min-h-\[52px\]/, "des cibles confortables");
  assert.match(CODE_CHOIX, /min-h-\[44px\]/, "le déclencheur reste au gabarit du dépôt");
});

test("I-11 — AUCUN LOGO DE MARQUE N'EST REDESSINÉ", () => {
  /*
   * ⚠️ RETRACER À LA MAIN LE REPÈRE DE GOOGLE MAPS OU L'ICÔNE DE WAZE DONNERAIT
   * UNE APPROXIMATION — c'est-à-dire exactement le logo déformé qu'il faut
   * éviter. La couleur de la marque et son nom écrit en toutes lettres
   * suffisent à reconnaître l'application.
   */
  assert.ok(!/<path[^>]*d="/.test(CODE_CHOIX), "aucun tracé de marque");
  assert.ok(!CODE_CHOIX.includes("googlelogo"), "aucune image de marque chargée");
  for (const f of FOURNISSEURS) {
    assert.match(f.couleur, /^#[0-9a-f]{6}$/i, `${f.nom} : une couleur de marque`);
    assert.ok(f.nom.length > 0);
  }
  assert.match(CODE_CHOIX, /style=\{\{ background: fournisseur\.couleur \}\}/);
});

test("I-12 — LE BOUTON EXISTE DANS LA LISTE ET DANS LA FICHE", () => {
  assert.equal(
    (CODE_RECHERCHE.match(/<ChoixItineraire/g) ?? []).length,
    2,
    "un dans la liste, un dans la fiche posée sur la carte",
  );
  // ⚠️ PAS DE BOUTON SANS COORDONNÉES : un itinéraire vers un point inconnu
  // n'existe pas. La ligne reste, le bouton disparaît.
  assert.equal(
    (CODE_RECHERCHE.match(/coordonneesFiables\(magasin\) && \(/g) ?? []).length,
    2,
    "les deux sont gardés par la fiabilité des coordonnées",
  );
  // L'ancien lien direct vers OpenStreetMap a disparu.
  assert.ok(!CODE_RECHERCHE.includes("urlItineraire"), "plus de lien direct");
  assert.ok(!CODE_RECHERCHE.includes("openstreetmap.org/directions"));
});
