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
  collectionDuChoisi,
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
  /*
   * ⚠️ LA CRÉATION A QUITTÉ L'EFFET DES DONNÉES. Elle vit dans un effet qui ne
   * dépend que de `prete`, et sa garde est un RETOUR ANTICIPÉ : si la source
   * est là, il n'y a rien à faire. Elle n'enferme plus rien d'autre — c'est
   * précisément ce qui avait fait disparaître les écouteurs (voir `M-10`).
   */
  assert.match(
    CODE_CARTE,
    /if \(instance\.getSource\(SOURCE\) !== undefined\) return;/,
    "créée une seule fois, par retour anticipé",
  );
  assert.ok(
    !CODE_CARTE.includes("instance.getSource(SOURCE) === undefined"),
    "plus aucune branche de création qui enferme autre chose",
  );
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
  /*
   * Et il est PLUS GROS : une différence de teinte seule disparaît au
   * chevauchement.
   *
   * ⚠️ LES DEUX RAYONS ONT ÉTÉ RÉDUITS D'UN QUART (voir `M-05g`), mais le
   * RAPPORT entre eux est ce qui compte ici, et il est préservé.
   */
  assert.match(CODE_CARTE, /"circle-radius": 9\.5/, "le choisi");
  assert.match(CODE_CARTE, /"circle-radius": 6\.5/, "un commerce ordinaire");
  assert.ok(9.5 > 6.5, "le choisi reste le plus gros des deux");
});

test("M-05b — LE VERT SUIT LE COMMERCE ACTIF, QUEL QUE SOIT SON TYPE OSM", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA PANNE QUE CE TEST VERROUILLE
   * ════════════════════════════════════════════════════════════════════════
   * En Preview, Spar devenait vert ; Carrefour Market et Utile, jamais — alors
   * que leur fiche s'ouvrait bien. Le réflexe était d'accuser l'identité
   * (« WAY et RELATION ne seraient pas gérés »). C'était faux, et mesuré comme
   * tel dans un navigateur :
   *
   *   dans un amas (zoom 11,7)   NODE, WAY, RELATION → vert : 0, 0, 0
   *   hors amas  (zoom 14)       les mêmes           → vert : 1, 1, 1
   *
   * Le type OSM n'y était pour rien : la pastille verte était filtrée hors des
   * amas, et seul un commerce ISOLÉ pouvait donc l'obtenir. Spar l'était.
   *
   * ⚠️ CE QUI SE VÉRIFIE ICI : que la collection du choisi contienne toujours
   * exactement le commerce actif, pour les trois types, et qu'elle SUIVE les
   * sélections successives au lieu de rester sur la première.
   */
  const trois = [
    magasin({ osmType: "NODE", osmId: 1003, name: "Spar", lat: 43.141, lon: 6.002 }),
    magasin({ osmType: "WAY", osmId: 1001, name: "Carrefour Market", lat: 43.13, lon: 5.929 }),
    magasin({ osmType: "RELATION", osmId: 1002, name: "Utile", lat: 43.1312, lon: 5.931 }),
  ];

  // Spar, Carrefour Market, Utile, PUIS Spar de nouveau : le vert ne doit
  // jamais rester bloqué sur le premier choisi.
  for (const attendu of [trois[0]!, trois[1]!, trois[2]!, trois[0]!]) {
    const cle = cleIdentiteOsm(attendu);
    const collection = collectionDuChoisi(trois, cle);
    assert.equal(collection.features.length, 1, `${attendu.name} : exactement un point vert`);
    const entite = collection.features[0]!;
    assert.equal(entite.properties.cle, cle, `${attendu.name} : la bonne clé`);
    assert.deepEqual(entite.geometry.coordinates, [attendu.lon, attendu.lat], attendu.name);
    // ⚠️ ET UN SEUL : le vert désigne le commerce choisi, pas tous les commerces.
    assert.equal(collection.features.length, 1);
  }

  // Les trois types produisent bien trois clés distinctes, et le même numéro
  // sous deux types n'est pas le même commerce.
  const memeNumero = [
    magasin({ osmType: "NODE", osmId: 42, name: "Spar" }),
    magasin({ osmType: "WAY", osmId: 42, name: "Spar" }),
  ];
  assert.equal(collectionDuChoisi(memeNumero, "WAY/42").features[0]!.properties.cle, "WAY/42");
  assert.equal(collectionDuChoisi(memeNumero, "NODE/42").features[0]!.properties.cle, "NODE/42");
  // Le NOM ne sélectionne rien : deux commerces peuvent le porter.
  assert.equal(collectionDuChoisi(memeNumero, "Spar").features.length, 0);
  assert.equal(collectionDuChoisi(memeNumero, "42").features.length, 0);
});

test("M-05c — AUCUNE SÉLECTION, AUCUN VERT ; AUCUNE COORDONNÉE, AUCUN VERT", () => {
  const trois = [
    magasin({ osmType: "NODE", osmId: 1, name: "A" }),
    magasin({ osmType: "WAY", osmId: 2, name: "B" }),
  ];
  for (const rien of [null, ""]) {
    assert.equal(collectionDuChoisi(trois, rien).features.length, 0, JSON.stringify(rien));
  }
  // Un commerce absent de la liste affichée ne colore rien.
  assert.equal(collectionDuChoisi(trois, "RELATION/9").features.length, 0);
  /*
   * ⚠️ ET UN COMMERCE SANS COORDONNÉES FIABLES NON PLUS. Le dessiner en `0,0`
   * le poserait au large du golfe de Guinée ; la liste, elle, le montre
   * toujours.
   */
  const sansPoint = [magasin({ osmType: "NODE", osmId: 3, name: "C", lat: 0, lon: 0 })];
  assert.equal(collectionDuChoisi(sansPoint, "NODE/3").features.length, 0);
});

test("M-05d — LE VERT SORT DU REGROUPEMENT : SA PROPRE SOURCE, SANS FILTRE D'AMAS", () => {
  /*
   * ⚠️ C'EST LE CORRECTIF LUI-MÊME. Tant que la couche verte lisait la source
   * REGROUPÉE, elle devait se filtrer par `["!", ["has", "point_count"]]` —
   * et un commerce dans un amas n'avait aucune entité à colorer.
   */
  assert.match(CODE_CARTE, /const SOURCE_CHOISI = "commerce-choisi"/);
  assert.match(
    CODE_CARTE,
    /instance\.addSource\(SOURCE_CHOISI, \{ type: "geojson", data: COLLECTION_VIDE as never \}\)/,
    "une source à part, et SANS `cluster`",
  );
  // La couche verte lit cette source-là, pas la source regroupée.
  const bloc = CODE_CARTE.slice(CODE_CARTE.indexOf("id: COUCHE_CHOISI"));
  const declaration = bloc.slice(0, 400);
  assert.match(declaration, /source: SOURCE_CHOISI/, "la couche verte lit sa propre source");
  assert.ok(!declaration.includes("point_count"), "plus aucun filtre d'amas sur le vert");
  assert.ok(!declaration.includes("filter:"), "plus aucun filtre du tout : la source ne contient que lui");
  // Et seule la source des commerces regroupe.
  const sourceCommerces = CODE_CARTE.slice(CODE_CARTE.indexOf("instance.addSource(SOURCE,"));
  assert.match(sourceCommerces.slice(0, 300), /cluster: true/);
  assert.equal((CODE_CARTE.match(/cluster: true/g) ?? []).length, 1, "une seule source regroupe");
  // La mise à jour passe par la fonction pure, pas par un filtre.
  assert.match(CODE_CARTE, /setData\(collectionDuChoisi\(magasins, selectionnee\)\)/);
  assert.ok(!CODE_CARTE.includes("setFilter(COUCHE_CHOISI"), "la couche verte ne se filtre plus");
});

test("M-05e — LE CADRAGE NE SE REJOUE PAS POUR UNE SÉLECTION", () => {
  /*
   * ⚠️ LA SECONDE MOITIÉ DE LA PANNE. `fitBounds` vivait dans l'effet des
   * marqueurs, dont `selectionnee` est une dépendance, et cet effet est
   * ASYNCHRONE : son cadrage atterrissait après le `easeTo` de l'effet de
   * recentrage et l'annulait. Mesuré : le zoom restait à 11,7 au lieu de
   * monter à 14, donc les amas ne se défaisaient jamais — et la carte sautait
   * en arrière à chaque clic dans la liste.
   */
  assert.match(CODE_CARTE, /const cadreApplique = useRef<string \| null>\(null\)/);
  assert.match(CODE_CARTE, /signature === cadreApplique\.current/, "le cadre déjà appliqué est reconnu");
  assert.match(CODE_CARTE, /cadreApplique\.current = signature;/);
  const iGarde = CODE_CARTE.indexOf("signature === cadreApplique.current");
  const iCadrage = CODE_CARTE.indexOf("instance.fitBounds(");
  assert.ok(iGarde > 0 && iCadrage > iGarde, "la garde précède le cadrage");
  /*
   * ⚠️ ET `selectionnee` N'EST PLUS UNE DÉPENDANCE DU CADRAGE. La garde seule
   * suffisait à ne pas bouger, mais laisser la dépendance aurait gardé un
   * effet qui se rejoue pour rien à chaque clic.
   */
  assert.match(CODE_CARTE, /\}, \[prete, magasins, depart, centreCommune\]\);/, "cadrage : sans la sélection");
  // ⚠️ ET IL MEURT AVEC LA CARTE : sinon la suivante se croirait déjà cadrée.
  assert.match(CODE_CARTE, /cadreApplique\.current = null;/);
  // Le recentrage sur le choisi, lui, reste animé et ne dézoome pas.
  assert.match(CODE_CARTE, /zoom: Math\.max\(instance\.getZoom\(\), 14\)/);
});

test("M-05f — LA POSITION DE L'ÉLÈVE : PRÉSENTE AVEC LE GPS, ABSENTE SANS LUI", () => {
  /*
   * ⚠️ ELLE NE VIT DANS AUCUNE SOURCE GEOJSON, et c'est ce qui la rend
   * INGROUPABLE. Le regroupement ne s'applique qu'à `SOURCE` ; un marqueur DOM
   * est posé par-dessus la carte et ne peut donc ni entrer dans un amas, ni
   * être compté parmi les commerces, ni être cliqué à leur place.
   */
  assert.match(
    CODE_CARTE,
    /if \(!prete \|\| instance === null \|\| lonDepart === null \|\| latDepart === null\) return;/,
    "aucun marqueur sans position réelle",
  );
  assert.match(CODE_CARTE, /new Marker\(\{ element: elementDeDepart\(\), anchor: "center" \}\)/);
  assert.equal((CODE_CARTE.match(/new Marker\(/g) ?? []).length, 1, "un seul marqueur DOM");
  /*
   * ⚠️ ET IL NE DÉPEND QUE DE `depart`. Il était détruit et reconstruit à
   * chaque sélection, pour une position qui n'avait pas bougé.
   */
  /*
   * ⚠️ ET LES DÉPENDANCES SONT LES COORDONNÉES, PAS L'OBJET. React compare par
   * référence : dépendre de `depart` rendrait le marqueur otage de la façon
   * dont le parent construit cet objet. Mesuré sur un harnais qui le recrée à
   * chaque rendu — cinq poses pour une seule position.
   */
  assert.match(CODE_CARTE, /\}, \[prete, lonDepart, latDepart\]\);/, "les coordonnées seules le recréent");
  assert.match(CODE_CARTE, /const lonDepart = depart\?\.lon \?\? null;/);
  assert.match(CODE_CARTE, /const latDepart = depart\?\.lat \?\? null;/);
  /*
   * ⚠️ ET AUCUNE SECONDE DEMANDE DE GÉOLOCALISATION. Les coordonnées viennent
   * du parcours « autour de moi », par la propriété `depart`. Redemander
   * ferait réapparaître l'invite du navigateur au milieu d'une recherche.
   */
  assert.ok(!CODE_CARTE.includes("navigator.geolocation"), "la carte ne géolocalise jamais");
  /*
   * ⚠️ ET LE CENTRE DE COMMUNE N'EST PAS UNE POSITION. En recherche par ville,
   * il n'y a pas d'élève à placer : afficher un point bleu sur le centre de la
   * commune inventerait une position.
   */
  const iPose = CODE_CARTE.indexOf("new Marker({ element: elementDeDepart()");
  const poseDuMarqueur = CODE_CARTE.slice(iPose, iPose + 200);
  assert.ok(!poseDuMarqueur.includes("centreCommune"), "le centre de commune ne pose aucun marqueur");
  assert.match(poseDuMarqueur, /setLngLat\(\[lonDepart, latDepart\]\)/);
  // Le point est bleu, cerné, et distinct des deux autres apparences.
  assert.match(CODE_CARTE, /background = "var\(--info, #60a5fa\)"/);
  assert.match(CODE_CARTE, /border = "3px solid var\(--card\)"/);
  // ⚠️ LE HALO EST DÉCORATIF ET DOIT LE RESTER : le parcours ne transmet
  // aucune précision, un rayon « de précision » serait inventé.
  assert.match(CODE_CARTE, /opacity = "0\.18"/, "un halo discret");
  assert.ok(!/accuracy/i.test(CODE_CARTE), "aucune précision affichée : elle n'est pas connue");
});

test("M-05g — LES MARQUEURS ONT ÉTÉ RÉDUITS, ET LE CHIFFRE RESTE LISIBLE", () => {
  // Commerce ordinaire : 9 → 6,5 (−28 %). Choisi : 13 → 9,5 (−27 %).
  assert.match(CODE_CARTE, /"circle-radius": 6\.5/, "commerce ordinaire réduit");
  assert.match(CODE_CARTE, /"circle-radius": 9\.5/, "commerce choisi réduit");
  assert.ok(!/"circle-radius": 9,/.test(CODE_CARTE), "l'ancien rayon a disparu");
  assert.ok(!/"circle-radius": 13,/.test(CODE_CARTE), "l'ancien rayon du choisi a disparu");
  // Amas : 16/20/26 → 12/15/19, soit un quart de moins.
  assert.match(
    CODE_CARTE,
    /"circle-radius": \["step", \["get", "point_count"\], 12, 5, 15, 15, 19\]/,
    "les trois paliers sont conservés, et réduits",
  );
  // Contours légèrement affinés.
  assert.match(CODE_CARTE, /"circle-stroke-width": 1\.5/, "contour des amas");
  assert.match(CODE_CARTE, /"circle-stroke-width": 2,/, "contour des points");
  assert.match(CODE_CARTE, /"circle-stroke-width": 2\.5/, "contour du choisi");
  assert.ok(!/"circle-stroke-width": 3,/.test(CODE_CARTE), "aucun contour épais ne subsiste");
  // ⚠️ LE CHIFFRE RESTE LISIBLE : 11 px dans une pastille de 24 px de diamètre.
  assert.match(CODE_CARTE, /"text-size": 11,/);
  /*
   * ⚠️ ET LA HIÉRARCHIE EST PRÉSERVÉE : choisi > ordinaire, et le plus petit
   * amas reste plus gros que le commerce choisi.
   */
  assert.ok(9.5 > 6.5, "le choisi reste plus gros qu'un commerce ordinaire");
  assert.ok(12 > 9.5, "le plus petit amas reste plus gros que le choisi");
  /*
   * ⚠️ ET LA FICHE N'EST PAS CONCERNÉE, PAR CONSTRUCTION. Elle n'est pas
   * dessinée ici : le parent la fournit en `ficheDuSelectionne`, et la carte
   * se contente de la POSITIONNER. Réduire les marqueurs ne pouvait donc pas
   * toucher ses boutons — et ce contrôle dit pourquoi, au lieu de prétendre
   * le vérifier.
   */
  assert.match(CODE_CARTE, /readonly ficheDuSelectionne\?: React\.ReactNode;/, "la fiche vient du parent");
  assert.match(CODE_CARTE, /\{ficheDuSelectionne\}/, "la carte ne fait que la placer");
  for (const dessin of ["<button", "CHOISIR CE COMMERCE", "ITINÉRAIRE"]) {
    assert.ok(!CODE_CARTE.includes(dessin), `la carte ne dessine pas la fiche (${dessin})`);
  }
});

test("M-06 — LA LISTE ET LA CARTE SE SUIVENT, SANS RIEN RECRÉER", () => {
  /*
   * ⚠️ LA MISE EN ÉVIDENCE A CHANGÉ DE MÉCANISME, ET LA RAISON EST UNE PANNE.
   * Elle passait par un FILTRE sur la couche, filtre qui devait exclure les
   * amas — et excluait donc tout commerce groupé. Elle passe désormais par les
   * DONNÉES d'une source qui ne contient que le choisi : aucun filtre à tenir,
   * et aucun marqueur détruit ni reconstruit à chaque clic.
   */
  assert.match(CODE_CARTE, /setData\(collectionDuChoisi\(magasins, selectionnee\)\)/);
  assert.ok(!CODE_CARTE.includes("setFilter(COUCHE_CHOISI"), "plus de filtre sur la couche verte");

  // ── Liste → carte ────────────────────────────────────────────────────────
  // `selectionnee` est une dépendance de l'effet : tout choix dans la liste
  // réalimente la source, donc déplace le vert.
  assert.match(CODE_CARTE, /\}, \[prete, magasins, selectionnee\]\);/, "l'effet du choisi suit la sélection");

  // ── Carte → liste ────────────────────────────────────────────────────────
  // Un clic sur un point rend la CLÉ au parent, qui tient la sélection.
  assert.match(CODE_CARTE, /const cle = evenement\.features\?\.\[0\]\?\.properties\?\.cle;/);
  assert.match(CODE_CARTE, /selection\.current\(cle\)/);
  // Et la couche verte est elle-même cliquable : re-cliquer le commerce actif
  // ne doit pas tomber dans le vide.
  assert.match(CODE_CARTE, /\[COUCHE_CHOISI, "click", surPoint\]/);
  /*
   * ⚠️ ET LA CLÉ VOYAGE DANS LES DEUX SENS, IDENTIQUE — vérifié sur les
   * données, pas sur le texte du composant. Ce que la carte rend au parent au
   * clic est exactement ce que le parent lui redonne comme sélection.
   */
  const aller = magasin({ osmType: "WAY", osmId: 77, name: "Carrefour Market" });
  const cleRendue = collectionDeMagasins([aller]).features[0]!.properties.cle;
  assert.equal(cleRendue, cleIdentiteOsm(aller), "la carte rend la clé d'identité");
  const retour = collectionDuChoisi([aller], cleRendue);
  assert.equal(retour.features.length, 1, "et la même clé rallume le vert");
  assert.equal(retour.features[0]!.properties.cle, cleRendue);
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

/**
 * Le corps de l'effet qui pose les écouteurs, isolé du reste du composant.
 *
 * ⚠️ C'EST LE DÉCOUPAGE LUI-MÊME QUI SE VÉRIFIE ICI, et il n'y a pas d'autre
 * moyen que de lire le source : cette machine n'a pas de WebGL, et la panne
 * qu'on verrouille est une panne de CYCLE DE VIE, pas de calcul.
 */
function effetDesEcouteurs(): string {
  const ancre = CODE_CARTE.indexOf("instance.on(type as never, couche, f as never);");
  assert.ok(ancre > 0, "la pose des écouteurs doit exister");
  const debut = CODE_CARTE.lastIndexOf("useEffect(() => {", ancre);
  const fin = CODE_CARTE.indexOf("}, [", ancre);
  assert.ok(debut > 0 && fin > ancre, "l'effet doit être délimité");
  return CODE_CARTE.slice(debut, CODE_CARTE.indexOf(");", fin) + 2);
}

test("M-10 — LES ÉCOUTEURS SURVIVENT À N'IMPORTE QUEL NOMBRE DE SÉLECTIONS", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA PANNE QUE CE TEST VERROUILLE — ELLE ÉTAIT SILENCIEUSE
   * ════════════════════════════════════════════════════════════════════════
   * Un seul effet faisait tout. Il dépendait de
   * `[prete, magasins, selectionnee, depart, centreCommune]`, son nettoyage
   * retirait les écouteurs À CHAQUE PASSAGE, mais leur POSE était enfermée
   * dans `if (instance.getSource(SOURCE) === undefined)`.
   *
   * Au deuxième passage — donc dès la première sélection — la source existait,
   * la branche était sautée, et les écouteurs retirés n'étaient jamais
   * reposés. Cliquer un commerce SUR la carte ne sélectionnait plus rien.
   * Un clic marchait, puis plus aucun. Mesuré dans Chromium :
   *
   *   avant  clic 1 → 1 sélection ; clics 2 à 6 → 0 sélection
   *   après  clics 1 à 6 → 1 sélection chacun, ni zéro ni deux
   *
   * ⚠️ AUCUN TEST NE POUVAIT LE VOIR : ils vérifiaient que `instance.on(…)` et
   * `instance.off(…)` existaient. Les deux existaient. C'est leur CYCLE qui
   * était faux.
   */
  const effet = effetDesEcouteurs();

  // 1. Pose et retrait vivent dans le MÊME effet.
  assert.match(effet, /instance\.on\(type as never, couche, f as never\);/, "la pose");
  assert.match(effet, /vivante\.off\(type as never, couche, f as never\);/, "le retrait");

  /*
   * 2. ⚠️ ET CET EFFET NE DÉPEND QUE DE `prete`. C'est ce qui garantit qu'il
   * ne se rejoue pas : les écouteurs sont posés une fois et retirés une fois.
   * Une dépendance de plus ici, et la panne revient.
   */
  assert.ok(effet.trimEnd().endsWith("}, [prete]);"), "les écouteurs ne dépendent que de `prete`");

  /*
   * 3. ⚠️ ET LA POSE N'EST ENFERMÉE DANS AUCUNE BRANCHE DE CRÉATION. C'était
   * la cause exacte : une condition sur l'existence de la source.
   */
  assert.ok(!effet.includes("getSource(SOURCE) !== undefined"), "aucune garde de création");
  assert.ok(!effet.includes("getSource(SOURCE) === undefined"), "aucune garde de création");
  assert.ok(!effet.includes("addSource("), "cet effet ne crée rien");
  assert.ok(!effet.includes("addLayer("), "cet effet ne crée rien");

  /*
   * 4. ⚠️ ET IL NE CAPTURE NI `magasins` NI `selectionnee`. S'il le faisait,
   * il DEVRAIT les déclarer en dépendances — donc se rejouer — et l'on
   * retomberait sur un cycle fragile. La sélection remonte par une référence.
   */
  for (const capture of ["magasins", "selectionnee", "collectionDeMagasins", "collectionDuChoisi", "fitBounds"]) {
    assert.ok(!effet.includes(capture), `l'effet des écouteurs ne touche pas à ${capture}`);
  }
  assert.match(effet, /selection\.current\(cle\)/, "la sélection remonte par la référence");

  // 5. Un seul enregistrement dans tout le composant : rien ne peut s'empiler.
  assert.equal(
    (CODE_CARTE.match(/instance\.on\(type as never/g) ?? []).length,
    1,
    "une seule boucle d'enregistrement",
  );
  assert.equal((CODE_CARTE.match(/ecouteurs\.push\(/g) ?? []).length, 1);

  // 6. Le démontage de la carte elle-même reste en place.
  assert.match(CODE_CARTE, /instance\?\.remove\(\)/);
});

test("M-10b — CHAQUE RESPONSABILITÉ A SON EFFET, ET SES DÉPENDANCES", () => {
  /*
   * ⚠️ LE DÉCOUPAGE EST LA CORRECTION, pas un rangement. Tant qu'un seul effet
   * créait les couches, posait les écouteurs, mettait à jour deux sources,
   * plaçait un marqueur DOM et cadrait la carte, ses dépendances étaient
   * forcément l'union de tout cela — et chaque passage défaisait ce que la
   * branche de création ne refaisait pas.
   *
   * Les listes ci-dessous sont celles que chaque responsabilité exige. Ni
   * plus — ce serait rejouer pour rien — ni moins — ce serait rester en
   * retard.
   */
  const attendues = [
    "}, [prete]);", // A. sources et couches, E. écouteurs
    "}, [prete, magasins]);", // B. données des commerces
    "}, [prete, magasins, selectionnee]);", // C. commerce choisi
    "}, [prete, lonDepart, latDepart]);", // D. position de l'élève
    "}, [prete, magasins, depart, centreCommune]);", // F. cadrage
    "}, [prete, selectionnee, magasins]);", // recentrage sur le choisi
  ];
  for (const deps of attendues) {
    assert.ok(CODE_CARTE.includes(deps), `aucun effet ne déclare ${deps}`);
  }
  // `[prete]` deux fois : les couches, et les écouteurs.
  assert.equal((CODE_CARTE.match(/\}, \[prete\]\);/g) ?? []).length, 2, "A et E");
  /*
   * ⚠️ ET L'EFFET FOURRE-TOUT A DISPARU. Sa signature était cette liste-là ;
   * la revoir voudrait dire qu'on a tout refusionné.
   */
  assert.ok(
    !CODE_CARTE.includes("}, [prete, magasins, selectionnee, depart, centreCommune]);"),
    "l'effet unique ne doit pas revenir",
  );
  /*
   * ⚠️ ET UN SEUL EFFET EST ASYNCHRONE : celui du marqueur, qui a besoin de la
   * classe `Marker`. Les autres agissent sur l'instance qu'on tient déjà, donc
   * dans l'ordre de déclaration — c'est ce qui empêche le cadrage d'atterrir
   * après le recentrage et de l'annuler.
   */
  const imports = CODE_CARTE.match(/void import\("maplibre-gl"\)/g) ?? [];
  assert.equal(imports.length, 2, "le chargement de la carte, et le marqueur — rien d'autre");
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
