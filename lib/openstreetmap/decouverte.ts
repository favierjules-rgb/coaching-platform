import "server-only";

import { RAYON_KM_MAX, RAYON_KM_MIN, normaliserVille } from "@/lib/nutrition/magasin-proche";
import {
  type MagasinOsm,
  type TypeOsm,
  classerParDistance,
  dedupliquerParIdentiteOsm,
  normaliserElementOsm,
} from "@/lib/nutrition/magasins-osm";
import {
  type OptionsOverpass,
  type RaisonEchecOverpass,
  type ReponseOverpass,
  idZoneDepuisRelation,
  interrogerOverpass,
  requeteMagasinsAutour,
  requeteElement,
  requeteMagasinsDansZone,
  requeteZoneCommune,
} from "@/lib/openstreetmap/overpass";

/**
 * COURSES C4.3c — LA DÉCOUVERTE DES MAGASINS, ORCHESTRÉE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CHERCHER N'APPELLE JAMAIS OPEN PRICES — C'EST LA DÉCISION DU LOT
 * ════════════════════════════════════════════════════════════════════════════
 * Une recherche qui rendrait trente magasins déclencherait trente appels au
 * pont Open Prices : trente allers-retours pour afficher une liste, et
 * l'obligation de décider quoi faire des vingt-neuf lieux qu'Open Prices ne
 * connaît pas. Le pont se fait à la SÉLECTION, sur UN magasin.
 *
 * Ce module ne peut pas y déroger : il n'importe rien d'Open Prices.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ DEUX BARRIÈRES, UNE SEULE RÈGLE
 * ════════════════════════════════════════════════════════════════════════════
 * La requête Overpass est déjà bornée aux `shop=*` alimentaires. On refiltre
 * pourtant chaque élément avec `normaliserElementOsm`. Ce n'est pas de la
 * défiance décorative : c'est la doctrine appliquée à Open Prices depuis C4.1,
 * et elle a déjà servi — l'amont peut changer, se tromper, ou rendre autre
 * chose que ce qu'on a demandé, et c'est le filtre local qui tient alors.
 */

/**
 * Le nombre maximal de magasins rendus à l'écran.
 *
 * ⚠️ IL EST PLUS PETIT QUE LA BORNE OVERPASS, ET C'EST VOULU. Overpass borne
 * ce qu'on télécharge ; celle-ci borne ce qu'on demande à un humain de lire.
 * Une liste de quatre cents lignes n'est pas un choix, c'est un abandon.
 *
 * ⚠️ ET ELLE NE COUPE PAS EN SILENCE : `tronque` le dit.
 */
export const MAGASINS_MAX_UI = 60;

/** Le nombre maximal de zones lues avant de conclure à une ambiguïté. */
const ZONES_MAX = 20;

export type EchecDecouverte = RaisonEchecOverpass | "ville_introuvable" | "ville_ambigue";

export type ResultatDecouverte =
  | { readonly statut: "ok"; readonly magasins: readonly MagasinOsm[]; readonly tronque: boolean }
  | { readonly statut: "echec"; readonly raison: EchecDecouverte };

/* ── 1. DES ÉLÉMENTS BRUTS AUX MAGASINS ──────────────────────────────────── */

function magasinsDepuis(reponse: Extract<ReponseOverpass, { statut: "success" }>): {
  magasins: readonly MagasinOsm[];
  tronque: boolean;
} {
  const retenus = dedupliquerParIdentiteOsm(
    reponse.elements
      .map(normaliserElementOsm)
      .filter((m): m is MagasinOsm => m !== null),
  );
  return {
    magasins: retenus.slice(0, MAGASINS_MAX_UI),
    // ⚠️ DEUX CAUSES DE TRONCATURE, ET LES DEUX COMPTENT. L'amont s'est arrêté
    // sur SA borne, ou nous sur la nôtre : dans les deux cas la liste est
    // incomplète, et la taire la présenterait comme exhaustive.
    tronque: reponse.tronque || retenus.length > MAGASINS_MAX_UI,
  };
}

/* ── 2. LA RECHERCHE PAR VILLE ───────────────────────────────────────────── */

/**
 * Les commerces alimentaires d'une commune française, en DEUX temps.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI DEUX REQUÊTES PLUTÔT QU'UNE
 * ════════════════════════════════════════════════════════════════════════════
 * Une requête unique — résoudre la zone et chercher dedans d'un seul coup —
 * serait plus rapide, et rendrait « aucun magasin » aussi bien quand la ville
 * n'existe pas que quand elle n'a rien de cartographié. Or ce sont deux
 * situations qui appellent deux conduites : corriger sa saisie, ou essayer une
 * commune voisine.
 *
 * Surtout, elle rendrait l'AMBIGUÏTÉ invisible. La France compte des dizaines
 * de communes homonymes ; en une requête, Overpass chercherait dans toutes à la
 * fois et l'élève verrait une liste mélangée sans savoir d'où viennent les
 * lignes. En deux temps, on peut dire « précise, il y en a plusieurs ».
 *
 * ⚠️ ET ON NE PREND JAMAIS LA PREMIÈRE ZONE. C'est un choix arbitraire,
 * invisible, et faux une fois sur deux.
 */
export async function decouvrirParVille(
  ville: string,
  options: OptionsOverpass = {},
): Promise<ResultatDecouverte> {
  const zones = await interrogerOverpass(requeteZoneCommune(ville), options);
  if (zones.statut === "echec") return { statut: "echec", raison: zones.raison };
  if (zones.statut === "zero_results") return { statut: "echec", raison: "ville_introuvable" };

  // ⚠️ SECONDE BARRIÈRE SUR LE NOM. La comparaison amont est régulière et
  // insensible à la casse ; celle-ci est insensible AUX ACCENTS, ce qu'Overpass
  // ne sait pas faire. Elle écarte aussi les zones parasites qu'un `~` trop
  // permissif laisserait passer, et c'est ce qui empêche une fausse ambiguïté.
  const cherchee = normaliserVille(ville);
  const candidates = zones.elements
    .filter((e) => {
      const nom = (e.tags ?? {})["name"];
      return typeof nom === "string" && normaliserVille(nom) === cherchee;
    })
    .slice(0, ZONES_MAX);

  if (candidates.length === 0) return { statut: "echec", raison: "ville_introuvable" };
  if (candidates.length > 1) return { statut: "echec", raison: "ville_ambigue" };

  const relation = candidates[0]!.id;
  if (typeof relation !== "number" || !Number.isSafeInteger(relation) || relation <= 0) {
    // Une zone sans identifiant exploitable n'est pas une zone résolue.
    return { statut: "echec", raison: "ville_introuvable" };
  }

  const commerces = await interrogerOverpass(
    requeteMagasinsDansZone(idZoneDepuisRelation(relation)),
    options,
  );
  // ⚠️ UNE PANNE DE LA SECONDE REQUÊTE N'EST PAS UNE VILLE INTROUVABLE. La
  // commune a été résolue ; ce qui a échoué, c'est la lecture de ses commerces.
  if (commerces.statut === "echec") return { statut: "echec", raison: commerces.raison };
  if (commerces.statut === "zero_results") return { statut: "ok", magasins: [], tronque: false };

  return { statut: "ok", ...magasinsDepuis(commerces) };
}

/* ── 3. LA RECHERCHE AUTOUR D'UN POINT ───────────────────────────────────── */

export interface AutourDeLEleve {
  readonly lat: number;
  readonly lon: number;
  readonly rayonKm: number;
}

/**
 * Les commerces alimentaires autour d'une position.
 *
 * ⚠️ LA POSITION SERT, PUIS DISPARAÎT. Elle entre ici, part chez Overpass dans
 * un CORPS de requête, sert à trier, et n'est écrite nulle part — ni en base,
 * ni dans un journal, ni dans la réponse rendue au client.
 *
 * ⚠️ LE RAYON DU CLIENT N'EST PAS CRU. Le schéma l'a déjà borné, la route
 * aussi ; c'est la troisième barrière, et la dernière avant le réseau. Un rayon
 * hors bornes est une erreur de programme, pas une saisie : on lève.
 */
export async function decouvrirAutour(
  p: AutourDeLEleve,
  options: OptionsOverpass = {},
): Promise<ResultatDecouverte> {
  if (p.rayonKm < RAYON_KM_MIN || p.rayonKm > RAYON_KM_MAX) {
    throw new RangeError("rayon hors bornes");
  }
  const requete = requeteMagasinsAutour({
    lat: p.lat,
    lon: p.lon,
    rayonM: Math.round(p.rayonKm * 1000),
  });

  const reponse = await interrogerOverpass(requete, options);
  if (reponse.statut === "echec") return { statut: "echec", raison: reponse.raison };
  if (reponse.statut === "zero_results") return { statut: "ok", magasins: [], tronque: false };

  const brut = magasinsDepuis(reponse);
  // ⚠️ LE TRI PRÉCÈDE LA BORNE — SINON LA BORNE GARDE N'IMPORTE QUI. Couper à
  // soixante avant d'avoir trié rendrait soixante magasins pris dans l'ordre
  // d'Overpass, dont le plus proche pourrait être absent.
  const classes = classerParDistance(
    dedupliquerParIdentiteOsm(
      reponse.elements.map(normaliserElementOsm).filter((m): m is MagasinOsm => m !== null),
    ),
    { lat: p.lat, lon: p.lon },
  );
  return {
    statut: "ok",
    magasins: classes.slice(0, MAGASINS_MAX_UI),
    tronque: brut.tronque,
  };
}

/* ── 4. LA TRADUCTION EN RÉPONSE HTTP ────────────────────────────────────── */

/**
 * Une raison → un code HTTP et un code lisible.
 *
 * ⚠️ SEPT RAISONS, SEPT CODES, ET AUCUNE PANNE NE DIT « INTROUVABLE ». C'est la
 * correction faite en C4.3a sur la sélection, appliquée ici à la recherche :
 * un élève dont l'appel a expiré ne doit pas lire que sa ville n'existe pas.
 *
 * ⚠️ ET AUCUN DÉTAIL INTERNE NE SORT. Le code dit ce qui s'est passé du point
 * de vue de l'élève ; il ne nomme ni l'amont, ni l'endpoint, ni la requête.
 */
export function httpDecouverte(raison: EchecDecouverte): { status: number; code: string } {
  switch (raison) {
    case "ville_introuvable":
      return { status: 404, code: "VILLE_INTROUVABLE" };
    case "ville_ambigue":
      return { status: 409, code: "VILLE_AMBIGUE" };
    case "rate_limited":
      return { status: 429, code: "TROP_DE_RECHERCHES_AMONT" };
    case "timeout":
      return { status: 504, code: "RECHERCHE_TROP_LONGUE" };
    case "invalid_json":
      return { status: 503, code: "REPONSE_ILLISIBLE" };
    case "invalid_envelope":
      return { status: 503, code: "REPONSE_INATTENDUE" };
    case "unavailable":
      return { status: 503, code: "ANNUAIRE_INDISPONIBLE" };
  }
}

/* ── 5. LA CANONICALISATION D'UN MAGASIN CHOISI ──────────────────────────── */

export type ResultatCanonique =
  | { readonly statut: "ok"; readonly magasin: MagasinOsm }
  | { readonly statut: "absent" }
  | { readonly statut: "non_exploitable" }
  | { readonly statut: "echec"; readonly raison: RaisonEchecOverpass };

/**
 * La fiche canonique d'UN élément OSM, relue chez la source.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE NAVIGATEUR DÉSIGNE, IL NE DÉCRIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * C'est la doctrine de C4.3a, conservée mot pour mot dans son esprit et
 * seulement déplacée de source. Le corps de la requête ne porte qu'une identité
 * `(osmType, osmId)` ; tout le reste — nom, marque, coordonnées, identifiants
 * Wikidata — est RELU ici. Sans cette relecture, n'importe qui ferait
 * apparaître « Mon faux magasin » dans un catalogue que TOUS les élèves lisent.
 *
 * ⚠️ UN APPEL PAR SÉLECTION, ET C'EST ACCEPTABLE. Un geste rare, un seul
 * magasin. C'est exactement ce qui rend la recherche gratuite : trente
 * résultats affichés ne coûtent aucun appel supplémentaire.
 *
 * ⚠️ ET L'IDENTITÉ RENDUE EST VÉRIFIÉE. Un amont qui répondrait autre chose que
 * ce qu'on a demandé ferait enregistrer un magasin que personne n'a choisi.
 */
export async function lireElementCanonique(
  osmType: TypeOsm,
  osmId: number,
  options: OptionsOverpass = {},
): Promise<ResultatCanonique> {
  const reponse = await interrogerOverpass(requeteElement(osmType, osmId), options);
  if (reponse.statut === "echec") return { statut: "echec", raison: reponse.raison };
  if (reponse.statut === "zero_results") return { statut: "absent" };

  const premier = reponse.elements[0];
  if (premier === undefined) return { statut: "absent" };

  // ⚠️ « IL N'EXISTE PAS » ET « CE N'EST PAS UN MAGASIN » SONT DEUX REFUS
  // DIFFÉRENTS. Le premier invite à recommencer, le second à choisir autre
  // chose. Les confondre ferait chercher une panne là où il n'y a qu'un
  // coiffeur.
  const magasin = normaliserElementOsm(premier);
  if (magasin === null) return { statut: "non_exploitable" };
  if (magasin.osmType !== osmType || magasin.osmId !== osmId) return { statut: "non_exploitable" };

  return { statut: "ok", magasin };
}
