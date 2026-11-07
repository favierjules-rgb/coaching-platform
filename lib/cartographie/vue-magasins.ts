import { cleIdentiteOsm, type MagasinOsm } from "@/lib/nutrition/magasins-osm";

/**
 * CARTOGRAPHIE — CE QUE LA CARTE DOIT MONTRER, CALCULÉ SANS AUCUNE CARTE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 * Le cadrage, les marqueurs et l'itinéraire sont des DÉCISIONS, et une décision
 * se teste. Tant qu'elles vivaient dans le composant, il fallait un navigateur
 * avec WebGL pour prouver qu'un marqueur correspond bien au commerce qu'il
 * désigne. Ici, tout est pur : ni MapLibre, ni MapTiler, ni DOM, ni réseau.
 *
 * ⚠️ AUCUNE RÉFÉRENCE À UN FOURNISSEUR DE CARTE. Ce module ne sait pas qui
 * dessine. Il dit seulement « voilà les points, voilà le cadre ».
 */

/** Un point géographique, dans l'ordre que les cartes attendent. */
export interface Point {
  readonly lon: number;
  readonly lat: number;
}

/** Un cadre géographique : sud-ouest, nord-est. */
export interface Cadre {
  readonly sudOuest: Point;
  readonly nordEst: Point;
}

/**
 * Un marqueur à poser.
 *
 * ⚠️ `cle` EST L'IDENTITÉ OSM DU COMMERCE, la MÊME que celle de la liste
 * (`cleIdentiteOsm`). C'est ce qui garantit qu'un marqueur et une ligne de
 * liste désignent le même commerce, et que la sélection circule dans les deux
 * sens sans table de correspondance à maintenir.
 */
export interface Marqueur {
  readonly cle: string;
  readonly lat: number;
  readonly lon: number;
  readonly nom: string;
  /** La marque, quand elle ajoute quelque chose au nom. Sinon `null`. */
  readonly marque: string | null;
  readonly selectionne: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
   1. LES MARQUEURS — EXACTEMENT LES COMMERCES RENDUS PAR LE MOTEUR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un marqueur par commerce, et rien d'autre.
 *
 * ⚠️ AUCUN COMMERCE N'EST AJOUTÉ, AUCUN N'EST ÉCARTÉ. Pas de regroupement par
 * proximité, pas de « cluster » qui masquerait trois magasins derrière un
 * chiffre, pas de filtre de zoom. L'énoncé demande que les marqueurs
 * correspondent EXACTEMENT aux commerces retournés par le moteur : la seule
 * façon de le garantir est de ne rien décider ici.
 *
 * ⚠️ ET AUCUNE COORDONNÉE N'EST INVENTÉE. `MagasinOsm` porte déjà `lat`/`lon` —
 * `normaliserElementOsm` écarte à la source tout élément qui n'en a pas. Il n'y
 * a donc rien à géocoder, et aucun appel à un service de géocodage : le
 * fournisseur de carte n'apprend jamais quels commerces nous affichons.
 */
export function marqueursDepuisMagasins(
  magasins: readonly MagasinOsm[],
  selectionnee: string | null,
): readonly Marqueur[] {
  return magasins.map((magasin) => {
    const cle = cleIdentiteOsm(magasin);
    return {
      cle,
      lat: magasin.lat,
      lon: magasin.lon,
      nom: magasin.name,
      marque: marqueDistincte(magasin.name, magasin.brand),
      selectionne: cle === selectionnee,
    };
  });
}

/** La marque, si elle n'est pas déjà dite par le nom. */
function marqueDistincte(nom: string, marque: string | null): string | null {
  if (marque === null) return null;
  const m = marque.trim();
  if (m === "") return null;
  return nom.toLowerCase().includes(m.toLowerCase()) ? null : m;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LE CADRAGE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ UNE MARGE EN DEGRÉS, PAS EN PIXELS, ET MINUSCULE. Elle sert au seul cas
 * d'un point unique, où le cadre serait de taille nulle et où la carte ne
 * saurait pas quel zoom choisir. Environ 350 m à la latitude de la France.
 */
const MARGE_POINT_UNIQUE = 0.003;

/**
 * La marge autour du centre d'une commune, quand il n'y a rien d'autre à
 * encadrer.
 *
 * ⚠️ BEAUCOUP PLUS LARGE QUE CELLE D'UN COMMERCE UNIQUE — environ 5 km. Cadrer
 * une commune à 350 m de son centre montrerait un carrefour, pas une ville, et
 * l'élève ne saurait pas où il regarde.
 */
export const MARGE_COMMUNE = 0.045;

/**
 * Le cadre qui contient tous les points donnés, ou `null` s'il n'y en a aucun.
 *
 * ⚠️ LE CADRAGE SE CALCULE SUR LES RÉSULTATS, PAS SUR UN CENTRE DE VILLE.
 *
 * C'est délibéré, et c'est plus honnête. Centrer sur « la ville recherchée »
 * supposerait de connaître le centre de la commune — donc un appel à un service
 * de géocodage, donc l'envoi de la ville saisie par l'élève à un tiers, et un
 * centre qui peut tomber à côté des commerces (une commune étendue, une
 * zone commerciale en périphérie). Encadrer les commerces TROUVÉS montre
 * exactement ce que le moteur a rendu, sans rien demander à personne.
 *
 * ⚠️ ET AUCUN REPLI SUR UN CENTRE ARBITRAIRE. Zéro résultat ne donne pas une
 * carte de la France : il ne donne pas de carte du tout, et un message.
 */
export function cadreDesPoints(points: readonly Point[]): Cadre | null {
  const valides = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180,
  );
  if (valides.length === 0) return null;

  let latMin = valides[0]!.lat;
  let latMax = valides[0]!.lat;
  let lonMin = valides[0]!.lon;
  let lonMax = valides[0]!.lon;
  for (const p of valides) {
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lon < lonMin) lonMin = p.lon;
    if (p.lon > lonMax) lonMax = p.lon;
  }

  if (latMin === latMax && lonMin === lonMax) {
    return {
      sudOuest: { lat: latMin - MARGE_POINT_UNIQUE, lon: lonMin - MARGE_POINT_UNIQUE },
      nordEst: { lat: latMax + MARGE_POINT_UNIQUE, lon: lonMax + MARGE_POINT_UNIQUE },
    };
  }
  return {
    sudOuest: { lat: latMin, lon: lonMin },
    nordEst: { lat: latMax, lon: lonMax },
  };
}

/**
 * Le cadre à afficher pour une recherche.
 *
 * ⚠️ LA POSITION DE L'ÉLÈVE ENTRE DANS LE CADRE QUAND ELLE EXISTE, et c'est ce
 * qui distingue les deux modes. « Autour de moi » doit montrer l'élève ET les
 * commerces, sinon il ne voit pas lesquels sont de son côté. Une recherche par
 * ville n'a aucune position de départ : le cadre est celui des commerces seuls.
 */
export function cadreDeLaRecherche(
  magasins: readonly MagasinOsm[],
  depart: Point | null,
  /**
   * Le centre de la commune cherchée, quand il est connu.
   *
   * ⚠️ IL N'EST PAS UNE TROISIÈME SOURCE DE CADRAGE, IL EST LE DERNIER RECOURS.
   * Tant qu'il y a des commerces, ce sont eux qui décident : ils sont ce que
   * l'élève est venu voir, et un centre administratif peut tomber loin d'eux
   * dans une commune étendue. Le centre ne sert QUE lorsqu'il n'y a encore —
   * ou plus — rien à encadrer.
   */
  centreCommune: Point | null = null,
): Cadre | null {
  const points: Point[] = magasins.map((m) => ({ lat: m.lat, lon: m.lon }));
  if (depart !== null) points.push(depart);
  const surLesResultats = cadreDesPoints(points);
  if (surLesResultats !== null) return surLesResultats;
  /*
   * ⚠️ C'EST CE REPLI QUI REND LA CARTE UTILISABLE SANS GPS. Une recherche par
   * ville n'a aucune position de départ ; sans ce point, la carte n'aurait
   * rien à montrer tant qu'aucun commerce n'est revenu — et rien du tout si la
   * commune n'en a aucun de cartographié.
   *
   * ⚠️ ET IL NE REMPLACE JAMAIS UNE POSITION GPS. Le mode « autour de moi »
   * n'a pas de centre de commune à lui donner : les deux modes gardent leur
   * propre source de centrage, et aucun n'emprunte celle de l'autre.
   */
  if (centreCommune === null) return null;
  return {
    sudOuest: { lat: centreCommune.lat - MARGE_COMMUNE, lon: centreCommune.lon - MARGE_COMMUNE },
    nordEst: { lat: centreCommune.lat + MARGE_COMMUNE, lon: centreCommune.lon + MARGE_COMMUNE },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3. L'ITINÉRAIRE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L'URL d'itinéraire vers un commerce.
 *
 * ⚠️ OPENSTREETMAP, ET PAS GOOGLE MAPS. Le projet interroge déjà OSM pour
 * trouver les commerces ; lui demander l'itinéraire n'ajoute aucun tiers.
 * Envoyer la position de l'élève à Google en ajouterait un, pour un service que
 * nous n'avons pas choisi et dont nous ne contrôlons pas les conditions.
 *
 * ⚠️ ET LA POSITION DE L'ÉLÈVE N'ENTRE DANS L'URL QUE S'IL L'A DÉJÀ PARTAGÉE
 * avec nous pour cette recherche. Sans position, on ouvre le commerce sur la
 * carte, sans point de départ — ce qui reste utile, et ne divulgue rien.
 */
export function urlItineraire(vers: Point, depuis: Point | null): string {
  const n = (v: number) => v.toFixed(6);
  if (depuis === null) {
    // Le commerce seul, marqué et centré.
    return `https://www.openstreetmap.org/?mlat=${n(vers.lat)}&mlon=${n(vers.lon)}#map=17/${n(vers.lat)}/${n(vers.lon)}`;
  }
  const route = `${n(depuis.lat)},${n(depuis.lon)};${n(vers.lat)},${n(vers.lon)}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LES COMMERCES, EN GeoJSON — POUR LE REGROUPEMENT
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Des coordonnées EXPLOITABLES, ou rien.
 *
 * ⚠️ UN COMMERCE SANS COORDONNÉES FIABLES RESTE DANS LA LISTE, SANS MARQUEUR.
 * Il a un nom, une adresse, et l'élève peut le choisir : l'écarter de la liste
 * lui retirerait un commerce qui existe. Mais le poser sur la carte
 * demanderait d'inventer un point, et un marqueur faux est pire qu'un marqueur
 * absent — il envoie quelqu'un au mauvais endroit.
 *
 * ⚠️ EN PRATIQUE, AUCUN N'ARRIVE JUSQU'ICI : `normaliserElementOsm` écarte dès
 * la lecture tout élément sans latitude ni longitude valides. Ce filtre est
 * donc une SECONDE BARRIÈRE, pas le garde-fou principal — et c'est délibéré :
 * le jour où la source changera, la carte ne doit pas se mettre à inventer.
 */
export function coordonneesFiables(magasin: {
  readonly lat: number;
  readonly lon: number;
}): boolean {
  return (
    Number.isFinite(magasin.lat) &&
    Number.isFinite(magasin.lon) &&
    Math.abs(magasin.lat) <= 90 &&
    Math.abs(magasin.lon) <= 180 &&
    // ⚠️ L'ÎLE NULLE. `0,0` est au large du golfe de Guinée : c'est la valeur
    // qu'on obtient quand deux champs vides ont été additionnés quelque part,
    // jamais celle d'une épicerie française.
    !(magasin.lat === 0 && magasin.lon === 0)
  );
}

/** Ce qu'une entité GeoJSON porte, et que les couches savent lire. */
export interface ProprietesDeCommerce {
  readonly cle: string;
  readonly nom: string;
  readonly marque: string | null;
}

export interface EntiteDeCommerce {
  readonly type: "Feature";
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
  readonly properties: ProprietesDeCommerce;
}

export interface CollectionDeCommerces {
  readonly type: "FeatureCollection";
  readonly features: readonly EntiteDeCommerce[];
}

/**
 * Les commerces en GeoJSON, prêts pour une source à regroupement.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UNE SOURCE ET NON PLUS UN MARQUEUR PAR COMMERCE
 * ════════════════════════════════════════════════════════════════════════════
 * Chaque marqueur était un élément du DOM, créé, posé, puis retiré à chaque
 * changement de sélection. Soixante commerces, soixante éléments recréés au
 * moindre clic — et un oubli de nettoyage suffisait à les empiler en double.
 *
 * Une source GeoJSON renverse le problème : on lui DONNE la liste, elle
 * s'occupe du reste. Il ne peut pas y avoir de doublon, parce qu'il n'y a pas
 * d'accumulation : `setData` remplace. Et c'est elle qui sait regrouper les
 * points qui se chevauchent, ce qu'aucun marqueur DOM ne sait faire.
 *
 * ⚠️ `cle` EST L'IDENTITÉ OSM, la MÊME que celle de la liste. C'est ce qui
 * fait circuler la sélection dans les deux sens sans table de correspondance.
 */
export function collectionDeMagasins(magasins: readonly MagasinOsm[]): CollectionDeCommerces {
  const vues = new Set<string>();
  const features: EntiteDeCommerce[] = [];
  for (const magasin of magasins) {
    if (!coordonneesFiables(magasin)) continue;
    const cle = cleIdentiteOsm(magasin);
    // ⚠️ UNE ENTITÉ PAR IDENTITÉ. La déduplication a déjà eu lieu en amont ;
    // celle-ci garantit qu'un doublon qui passerait ne devienne pas deux
    // points superposés, impossibles à distinguer et à choisir.
    if (vues.has(cle)) continue;
    vues.add(cle);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [magasin.lon, magasin.lat] },
      properties: { cle, nom: magasin.name, marque: marqueDistincte(magasin.name, magasin.brand) },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Les commerces que la carte ne peut pas montrer — pour pouvoir le DIRE. */
export function magasinsSansPoint(magasins: readonly MagasinOsm[]): readonly MagasinOsm[] {
  return magasins.filter((m) => !coordonneesFiables(m));
}
