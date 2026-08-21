import { latitudeValide, longitudeValide } from "@/lib/nutrition/magasin-proche";

/**
 * COURSES C4.3c — OPENSTREETMAP DEVIENT L'ANNUAIRE DES MAGASINS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE FAIT MESURÉ QUI JUSTIFIE CE MODULE
 * ════════════════════════════════════════════════════════════════════════════
 * Toulon, ~180 000 habitants, mesuré le 19/08/2026 sur l'API de production
 * Open Prices : **2 lieux au total**, dont un marchand de journaux. Le seul
 * commerce alimentaire retenu — Naturalia — porte **un seul relevé de prix**.
 *
 * Open Prices est une excellente source de PRIX. Ce n'est pas un annuaire de
 * magasins, et l'utiliser comme tel enfermait l'élève toulonnais dans un choix
 * unique. La découverte passe donc à OpenStreetMap, dont Open Prices recopie
 * déjà les identifiants — le pont entre les deux est exact, et facultatif.
 *
 * ⚠️ CE MODULE NE PARLE À PERSONNE. Ni base, ni réseau, ni React. Il porte
 * deux règles et rien d'autre : ce qu'est un commerce alimentaire, et comment
 * un élément OSM brut devient un magasin exploitable.
 */

/* ── 1. CE QU'EST UN COMMERCE ALIMENTAIRE, SELON OSM ─────────────────────── */

/**
 * Les valeurs de `shop=*` acceptées.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CETTE LISTE N'EST PAS UNE RECOPIE DE CELLE DE C4.3a — L'AUDIT A CORRIGÉ
 * TROIS ERREURS ET COMBLÉ HUIT MANQUES
 * ════════════════════════════════════════════════════════════════════════════
 * Confrontée à la section « Food, beverages » du wiki `Key:shop`, l'ancienne
 * liste contenait trois valeurs qui ne capturent rien :
 *
 *   `organic`  — DÉPRÉCIÉE par OSM au profit de `organic=yes` posé EN PLUS d'un
 *                `shop=*` réel. Un magasin bio est donc un `supermarket` ou un
 *                `convenience` avec un attribut : il entre par sa catégorie
 *                principale, et n'a jamais eu besoin d'entrée propre ;
 *   `grocery`  — n'est pas une valeur documentée. L'usage réel est
 *                `convenience` ou `greengrocer` ;
 *   `rice`     — absente de la liste OSM.
 *
 * Et il manquait huit commerces alimentaires bien réels : `chocolate`,
 * `coffee`, `confectionery`, `ice_cream`, `pastry`, `tea`, `tortilla`, plus
 * `food` déjà présent.
 *
 * ⚠️ L'ALCOOL EST EXCLU, ET C'EST UN CHOIX PRODUIT, PAS UN OUBLI. `alcohol`,
 * `wine` et `brewing_supplies` désignent des commerces réels et correctement
 * étiquetés ; une plateforme de préparation physique n'a simplement pas à
 * proposer un caviste comme magasin de courses nutritionnelles. La règle est
 * ici, en clair, pour qu'on puisse la changer d'avis plutôt que la redécouvrir.
 *
 * ⚠️ ET AUCUNE ENSEIGNE N'APPARAÎT DANS CE FICHIER. Pas de « Lidl », pas de
 * « Carrefour » : la catégorie vient du TAG, jamais du nom. Un test de nom
 * marche sur les exemples qu'on a sous les yeux et échoue sur le reste du pays
 * — c'est la même doctrine qu'en C4.1 pour le rapprochement produit.
 */
export const SHOP_ALIMENTAIRES: ReadonlySet<string> = new Set([
  "supermarket",
  "convenience",
  "greengrocer",
  "butcher",
  "bakery",
  "deli",
  "cheese",
  "seafood",
  "frozen_food",
  "health_food",
  "farm",
  "dairy",
  "pasta",
  "spices",
  "nuts",
  "beverages",
  "water",
  "food",
  "chocolate",
  "coffee",
  "confectionery",
  "ice_cream",
  "pastry",
  "tea",
  "tortilla",
]);

/**
 * ⚠️ ÉNUMÉRÉES POUR ÊTRE TESTABLES, PAS POUR ÊTRE LUES PAR LE CODE. Ces
 * valeurs sont des commerces alimentaires au sens d'OSM, et notre doctrine
 * produit les écarte. Les nommer permet à un test de prouver que l'exclusion
 * est DÉLIBÉRÉE, et non le résultat d'un oubli de recopie.
 */
export const SHOP_ALCOOL_EXCLUS: ReadonlySet<string> = new Set([
  "alcohol",
  "wine",
  "brewing_supplies",
]);

/**
 * Ce lieu est-il un commerce alimentaire ?
 *
 * ⚠️ UNE ÉTIQUETTE MANQUANTE EST UN REFUS — la règle de C4.3a, conservée. Sans
 * `shop=*`, nous ne savons pas ce qu'est ce lieu, et « je ne sais pas » ne se
 * propose pas à un élève comme un magasin.
 *
 * ⚠️ `organic=yes` N'EST PAS UNE CATÉGORIE. Un magasin bio entre par son
 * `shop=*` réel. Ce paramètre n'est même pas lu ici : le mentionner suffirait
 * à faire croire qu'il pourrait, un jour, servir de porte d'entrée.
 */
export function estCommerceAlimentaireOsm(tags: Readonly<Record<string, unknown>>): boolean {
  const shop = typeof tags["shop"] === "string" ? tags["shop"].trim().toLowerCase() : "";
  return SHOP_ALIMENTAIRES.has(shop);
}

/* ── 2. L'IDENTIFIANT WIKIDATA D'UNE ENSEIGNE ────────────────────────────── */

/**
 * `Q` suivi d'un entier sans zéro de tête — la forme documentée d'un item
 * Wikidata (`Q42`, `Q151954`).
 *
 * ⚠️ FORME, PAS EXISTENCE. Vérifier que l'item existe demanderait un appel
 * réseau ; nous validons ce que nous pouvons valider, et nous refusons le
 * reste plutôt que de le stocker « au cas où ». La même règle est posée en
 * base par `stores_brand_wikidata_forme` : deux barrières, une seule règle.
 */
export function identifiantWikidataValide(valeur: unknown): boolean {
  return typeof valeur === "string" && /^Q[1-9][0-9]*$/.test(valeur.trim());
}

function wikidataOuNull(valeur: unknown): string | null {
  return identifiantWikidataValide(valeur) ? (valeur as string).trim() : null;
}

/* ── 3. UN ÉLÉMENT OVERPASS DEVIENT UN MAGASIN ───────────────────────────── */

export type TypeOsm = "NODE" | "WAY" | "RELATION";

/**
 * Un magasin découvert dans OpenStreetMap.
 *
 * ⚠️ `opLocationId` N'Y FIGURE PAS, ET C'EST TOUT LE LOT. La découverte ne
 * connaît pas Open Prices : le pont est établi plus tard, à la SÉLECTION, par
 * un appel exact. Mêler les deux ici obligerait à interroger Open Prices une
 * fois par résultat de recherche — cinquante appels pour afficher une liste.
 */
export interface MagasinOsm {
  readonly osmType: TypeOsm;
  readonly osmId: number;
  readonly name: string;
  readonly brand: string | null;
  readonly brandWikidata: string | null;
  readonly operatorWikidata: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly countryCode: string | null;
  readonly lat: number;
  readonly lon: number;
  /** `null` hors recherche géographique — il n'existe alors aucun point de départ. */
  readonly distanceKm: number | null;
}

/** Un élément brut d'Overpass, tel que `out center tags;` le rend. */
export interface ElementOverpass {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly center?: { readonly lat?: unknown; readonly lon?: unknown } | null;
  readonly tags?: Readonly<Record<string, unknown>> | null;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;
}

/**
 * Normalise le type OSM.
 *
 * ⚠️ OVERPASS ÉCRIT EN MINUSCULES, `stores` EXIGE DES MAJUSCULES
 * (`stores_osm_type_check`), et Open Prices attend le type dans son URL de
 * pont. Une seule traduction, ici, plutôt que trois `toUpperCase()` disséminés
 * qui finiraient par diverger.
 */
export function typeOsmDepuis(valeur: unknown): TypeOsm | null {
  if (typeof valeur !== "string") return null;
  const t = valeur.trim().toUpperCase();
  return t === "NODE" || t === "WAY" || t === "RELATION" ? t : null;
}

/**
 * `null` = cet élément n'est pas exploitable, et on l'écarte ENTIÈREMENT.
 *
 * ⚠️ JAMAIS DE DEMI-MAGASIN — la règle de C4.3a, conservée mot pour mot dans
 * son esprit. Les colonnes de `stores` sont NOT NULL sur le nom et les
 * coordonnées : une fiche à trous obligerait l'écran, puis la route de
 * sélection, puis la base, à décider chacun à sa façon quoi faire du trou.
 *
 * ⚠️ UN MAGASIN SANS NOM EST ÉCARTÉ, ET C'EST UNE DOCTRINE, PAS UN EFFET DE
 * BORD. OSM contient beaucoup de commerces sans `name` — souvent des saisies
 * partielles. Fabriquer « Magasin #123456 » donnerait à l'élève une ligne
 * qu'il ne peut ni reconnaître ni choisir en confiance, et ferait entrer dans
 * un référentiel PARTAGÉ un libellé que personne n'a écrit. On préfère un
 * résultat de moins à un résultat inventé.
 *
 * ⚠️ NODE PORTE `lat`/`lon` ; WAY ET RELATION PORTENT `center`. Un élément sans
 * l'un ni l'autre est refusé — et surtout pas ramené à 0/0, qui placerait un
 * supermarché toulonnais au large du golfe de Guinée.
 */
export function normaliserElementOsm(element: ElementOverpass): MagasinOsm | null {
  const tags = (element.tags ?? {}) as Readonly<Record<string, unknown>>;
  if (!estCommerceAlimentaireOsm(tags)) return null;

  const osmType = typeOsmDepuis(element.type);
  if (osmType === null) return null;

  // ⚠️ `Number.isSafeInteger`, jamais `Number.isInteger` — même raison qu'en
  // C4.3a : au-delà de 2⁵³−1, `JSON.parse` arrondit en silence et l'on
  // écrirait dans `stores` l'identifiant de personne.
  const osmId =
    typeof element.id === "number" && Number.isSafeInteger(element.id) && element.id > 0
      ? element.id
      : null;
  if (osmId === null) return null;

  const name = texteOuNull(tags["name"]);
  if (name === null) return null;

  const lat = typeof element.lat === "number" ? element.lat : coordonneeCentre(element, "lat");
  const lon = typeof element.lon === "number" ? element.lon : coordonneeCentre(element, "lon");
  if (lat === null || lon === null) return null;
  if (!latitudeValide(lat) || !longitudeValide(lon)) return null;

  return {
    osmType,
    osmId,
    name,
    brand: texteOuNull(tags["brand"]),
    brandWikidata: wikidataOuNull(tags["brand:wikidata"]),
    operatorWikidata: wikidataOuNull(tags["operator:wikidata"]),
    city: texteOuNull(tags["addr:city"]),
    postcode: texteOuNull(tags["addr:postcode"]),
    countryCode: codePaysOuNull(tags["addr:country"]),
    lat,
    lon,
    distanceKm: null,
  };
}

function coordonneeCentre(element: ElementOverpass, axe: "lat" | "lon"): number | null {
  const centre = element.center;
  if (centre === null || typeof centre !== "object") return null;
  const valeur = centre[axe];
  return typeof valeur === "number" ? valeur : null;
}

/** ISO-3166-1 alpha-2, comme `stores_country_code_iso` l'exige. */
function codePaysOuNull(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const code = valeur.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Déduplique par IDENTITÉ — `(osmType, osmId)`, jamais l'identifiant seul.
 *
 * ⚠️ UN `osm_id` N'EST PAS GLOBALEMENT UNIQUE. OpenStreetMap numérote les
 * nœuds, les chemins et les relations dans TROIS espaces séparés : le nœud 123
 * et le chemin 123 sont deux objets sans rapport. Dédupliquer sur l'identifiant
 * seul fusionnerait un jour deux commerces distincts — et `stores` porte
 * précisément `unique (osm_type, osm_id)` pour la même raison.
 *
 * L'ordre de première apparition est conservé : déterministe, et sans autorité.
 */
export function dedupliquerParIdentiteOsm(
  magasins: readonly MagasinOsm[],
): readonly MagasinOsm[] {
  const vus = new Set<string>();
  const retenus: MagasinOsm[] = [];
  for (const m of magasins) {
    const cle = `${m.osmType}/${m.osmId}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    retenus.push(m);
  }
  return retenus;
}

/** La clé d'identité d'un magasin OSM — une seule écriture dans le dépôt. */
export function cleIdentiteOsm(magasin: { osmType: TypeOsm; osmId: number }): string {
  return `${magasin.osmType}/${magasin.osmId}`;
}

/**
 * La marque à AFFICHER à côté d'un nom de magasin — ou rien.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE DÉFAUT QU'ELLE CORRIGE : « LidlLidl », « CarrefourCarrefour »
 * ════════════════════════════════════════════════════════════════════════════
 * OpenStreetMap porte très souvent `name` ET `brand` avec la MÊME valeur — un
 * Lidl s'appelle Lidl, et sa marque est Lidl. L'écran affichait les deux à la
 * suite, sans séparateur, et l'élève lisait « LidlLidl ». Ce n'est pas un
 * problème de mise en page : c'est une information redondante qu'il ne fallait
 * pas afficher deux fois.
 *
 * ⚠️ ET LA MARQUE N'EST PAS SUPPRIMÉE POUR AUTANT. « Carrefour Market » de
 * marque « Carrefour » dit deux choses différentes — l'enseigne du groupe, et
 * le format du magasin. Effacer la seconde parce qu'elle ressemble à la
 * première ferait disparaître une information vraie.
 *
 * La règle tient donc en trois lignes, et elle est PURE : comparaison sur les
 * valeurs nettoyées, insensible à la casse. Pas de comparaison approchante, pas
 * de préfixe, pas de distance d'édition — « Carrefour » et « Carrefour Market »
 * doivent rester distincts, et une règle plus maligne les confondrait.
 */
export function marqueAAfficher(name: string, brand: string | null | undefined): string | null {
  if (typeof brand !== "string") return null;
  const marque = brand.trim();
  if (marque === "") return null;
  // ⚠️ `toLowerCase()` SEUL, SANS DÉPOUILLEMENT DES ACCENTS. « Casino » et
  // « Cásino » ne sont pas le même mot, et les rapprocher masquerait une vraie
  // différence de saisie chez la source.
  if (marque.toLowerCase() === name.trim().toLowerCase()) return null;
  return marque;
}

/* ── 4. LA DISTANCE, CALCULÉE CHEZ NOUS ──────────────────────────────────── */

/**
 * La distance orthodromique entre deux points, en kilomètres.
 *
 * ⚠️ ELLE EST CALCULÉE ICI PARCE QU'OPENSTREETMAP NE LA DONNE PAS. Open Prices
 * rendait `distance_km` tout fait ; Overpass rend des coordonnées, et rien
 * d'autre. C'est un changement de source, pas un changement de doctrine : la
 * position de l'élève sert à calculer, puis disparaît — elle n'est ni
 * persistée, ni journalisée, ni renvoyée au client.
 *
 * ⚠️ HAVERSINE, PAS PYTHAGORE SUR DES DEGRÉS. Un degré de longitude vaut 111 km
 * à l'équateur et 81 km à Toulon ; l'approximation plate classerait les
 * magasins dans le mauvais ordre dès qu'ils sont à l'est ou à l'ouest.
 *
 * ⚠️ RAYON MOYEN, ET C'EST UNE APPROXIMATION ASSUMÉE. La Terre est un ellipsoïde ;
 * l'écart est de l'ordre de 0,3 %, soit 30 mètres sur 10 km. Aucune décision de
 * ce lot ne dépend de cette précision-là — on affiche « à 2,3 km », on ne guide
 * personne.
 */
export const RAYON_TERRE_KM = 6371;

export function distanceKmHaversine(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Attache sa distance à chaque magasin, et les trie du plus proche au plus loin.
 *
 * ⚠️ L'ORDRE EST TOTAL, ET LE DÉPARTAGE EST L'IDENTITÉ. Deux magasins à égale
 * distance — un centre commercial et sa supérette — se rangeraient sinon dans
 * un ordre dépendant de l'implémentation du tri, et la liste changerait d'un
 * chargement à l'autre sans raison visible.
 */
export function classerParDistance(
  magasins: readonly MagasinOsm[],
  origine: { readonly lat: number; readonly lon: number },
): readonly MagasinOsm[] {
  return magasins
    .map((m) => ({ ...m, distanceKm: distanceKmHaversine(origine, m) }))
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return cleIdentiteOsm(a) < cleIdentiteOsm(b) ? -1 : 1;
    });
}
