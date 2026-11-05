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
): Cadre | null {
  const points: Point[] = magasins.map((m) => ({ lat: m.lat, lon: m.lon }));
  if (depart !== null) points.push(depart);
  return cadreDesPoints(points);
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
