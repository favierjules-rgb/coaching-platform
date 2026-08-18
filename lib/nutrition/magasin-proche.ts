/**
 * COURSES C4.3a — LES RÈGLES DE LA DÉCOUVERTE, SANS RÉSEAU NI BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EST PUR
 * ────────────────────────────────────────────────────────────────────────────
 * Tout ce qui décide — quelle position est acceptable, quel rayon, quel lieu
 * est un magasin, lequel est un doublon, quand arrêter de paginer — vit ici,
 * et se prouve sur des fixtures. `lib/open-prices/locations.ts` ne fait que
 * parler au réseau ; il n'arbitre rien.
 *
 * ⚠️ AUCUN MONTANT, AUCUNE DISPONIBILITÉ. La découverte répond à « où », jamais
 * à « combien » ni à « en rayon ou pas » — cette dernière donnée n'existe même
 * pas chez la source.
 */

/**
 * Un lieu tel qu'Open Prices le rend. Tous les champs sont optionnels et de
 * type inconnu À DESSEIN : c'est une réponse réseau, pas un contrat que nous
 * contrôlons. `normaliserLieu` est le seul endroit où l'on décide qu'une de ces
 * valeurs est exploitable.
 */
export interface LieuBrut {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly osm_type?: unknown;
  readonly osm_id?: unknown;
  readonly osm_name?: unknown;
  readonly osm_brand?: unknown;
  readonly osm_tag_key?: unknown;
  readonly osm_tag_value?: unknown;
  readonly osm_address_postcode?: unknown;
  readonly osm_address_city?: unknown;
  readonly osm_address_country_code?: unknown;
  readonly osm_lat?: unknown;
  readonly osm_lon?: unknown;
  readonly distance_km?: unknown;
}

/**
 * Ce qui traverse jusqu'à l'écran, et RIEN DE PLUS.
 *
 * L'amont rend vingt-cinq champs — `osm_version`, `proof_count`, `user_count`,
 * `source`, `website_url`, `osm_display_name`… Les recopier ferait de notre
 * route un miroir d'Open Prices, et chaque champ recopié deviendrait un champ
 * à maintenir le jour où l'amont le renomme.
 */
export interface MagasinProche {
  readonly opLocationId: number;
  readonly osmType: "NODE" | "WAY" | "RELATION";
  readonly osmId: number;
  readonly name: string;
  readonly brand: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly countryCode: string | null;
  readonly lat: number;
  readonly lon: number;
  /**
   * ⚠️ `null` QUAND IL N'Y A PAS DE POINT DE DÉPART. `/nearby` calcule et rend
   * une distance ; la recherche par ville n'en a AUCUNE — il n'existe pas de
   * position de référence. Fabriquer un nombre depuis « le centre de la ville »
   * afficherait une précision que rien ne fonde, et l'élève la croirait.
   */
  readonly distanceKm: number | null;
}

/* ── 1. LES BORNES D'ENTRÉE ────────────────────────────────────────────── */

export function latitudeValide(valeur: unknown): boolean {
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= -90 && valeur <= 90;
}

export function longitudeValide(valeur: unknown): boolean {
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= -180 && valeur <= 180;
}

/**
 * ⚠️ LE MAXIMUM EST LE NÔTRE, ET IL DOIT L'ÊTRE.
 *
 * Mesuré sur le code de l'amont le 17/08/2026 : son sérialiseur pose
 * `min_value=0` et AUCUN `max_value`, et sa vue n'écrête rien. `radius_km=20000`
 * y déclenche un balayage planétaire chez un service bénévole — et rien, chez
 * eux, ne l'empêche.
 *
 * 25 km n'est pas une limite technique, c'est une limite PRODUIT : au-delà, la
 * liste cesse d'être « des magasins près de moi » et devient du bruit trié par
 * distance. 1 km au minimum, parce qu'un rayon nul ne veut rien dire.
 */
export const RAYON_KM_MIN = 1;
export const RAYON_KM_DEFAUT = 10;
export const RAYON_KM_MAX = 25;

/**
 * `null` = REFUS, jamais un écrêtage silencieux. Ramener 20 000 à 25 rendrait
 * une réponse plausible à une demande absurde, et masquerait un client fautif.
 */
export function bornerRayon(demande: unknown): number | null {
  if (demande === undefined || demande === null) return RAYON_KM_DEFAUT;
  if (typeof demande !== "number" || !Number.isFinite(demande)) return null;
  if (demande < RAYON_KM_MIN || demande > RAYON_KM_MAX) return null;
  return demande;
}

/* ── 2. LA PAGINATION, BORNÉE PARCE QUE LE FILTRAGE EST CHEZ NOUS ──────── */

/**
 * ⚠️ CETTE TAILLE EST LA NÔTRE, ET LE CLIENT NE LA DICTE JAMAIS.
 * L'amont plafonne à 100 et ramène silencieusement toute valeur supérieure —
 * demander davantage donnerait l'illusion d'une page plus grande.
 */
export const NEARBY_TAILLE_PAGE = 100;

/**
 * ⚠️ LE PIÈGE DE CE LOT. `LocationFilter` est court-circuité sur `/nearby` :
 * on ne peut PAS demander à l'amont de ne rendre que des commerces
 * alimentaires. Le tri se fait donc chez nous, APRÈS pagination — et une page
 * de 100 lieux peut n'en contenir que trois d'utilisables. S'arrêter à la
 * première page afficherait « 3 magasins près de vous » là où il y en a trente.
 *
 * Il faut donc pouvoir avancer… et s'arrêter. Trois pages, soit 300 lieux
 * examinés au plus : assez pour qu'une zone dense donne une liste utile, assez
 * peu pour qu'aucune requête ne se transforme en aspiration du service.
 */
export const NEARBY_PAGES_MAX = 3;

/** Ce qu'un écran de choix peut montrer sans devenir un annuaire. */
export const NEARBY_RESULTATS_CIBLE = 20;

/* ── 3. QU'EST-CE QU'UN MAGASIN ? ──────────────────────────────────────── */

/**
 * ⚠️ LA SEULE CLÉ DE TAG ACCEPTÉE. `amenity`, `tourism`, `office`, `man_made`
 * décrivent des lieux qui ne vendent pas de courses — et l'amont en renvoie.
 */
export const TAG_CLE_COMMERCE = "shop";

/**
 * ⚠️ CE VOCABULAIRE VIENT DE LA TAXONOMIE OPENSTREETMAP, PAS D'UNE LISTE
 * D'ENSEIGNES. Aucune marque n'est nommée ici, et aucune ne doit l'être : une
 * liste de marques exclurait tous les commerces indépendants et deviendrait un
 * référentiel commercial maison à entretenir.
 *
 * La règle est volontairement ÉTROITE : ne sont retenus que les commerces dont
 * l'objet est de vendre de quoi cuisiner chez soi. Sont donc VOLONTAIREMENT
 * absents `department_store`, `general`, `wholesale`, `alcohol`, `wine`,
 * `confectionery`, `chocolate`, `pastry`, `coffee`, `tea` — non parce qu'ils
 * sont faux, mais parce qu'ils sont ambigus, et qu'un faux négatif coûte un
 * magasin manquant là où un faux positif envoie quelqu'un acheter son riz dans
 * une confiserie.
 *
 * ⚠️ LA LIMITE, ÉNONCÉE PLUTÔT QUE MASQUÉE : ces étiquettes sont saisies par
 * les contributeurs d'OpenStreetMap et recopiées telles quelles par Open
 * Prices. Nous ne pouvons donc pas garantir « c'est un magasin alimentaire » ;
 * nous garantissons « OpenStreetMap le décrit comme un commerce alimentaire ».
 * Un commerce mal étiqueté sera mal filtré, et c'est irréductible avec les
 * champs que la source expose.
 */
export const VALEURS_COMMERCE_ALIMENTAIRE: ReadonlySet<string> = new Set([
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
  "organic",
  "farm",
  "dairy",
  "pasta",
  "rice",
  "spices",
  "nuts",
  "beverages",
  "water",
  "food",
  "grocery",
]);

/**
 * ⚠️ NI LE NOM NI L'ENSEIGNE N'ENTRENT DANS CETTE DÉCISION, et c'est la même
 * doctrine qu'en C4.1 pour le rapprochement produit : un test de nom marche sur
 * les exemples qu'on a sous les yeux et échoue sur le reste du monde.
 *
 * Une étiquette manquante est un REFUS. L'amont autorise `osm_tag_key` et
 * `osm_tag_value` nuls, et beaucoup de lieux les ont : sans eux, nous ne savons
 * pas ce qu'est ce lieu — et « je ne sais pas » ne se propose pas à un élève
 * comme un magasin.
 */
export function estCommerceAlimentaire(lieu: {
  readonly osm_tag_key?: unknown;
  readonly osm_tag_value?: unknown;
}): boolean {
  const cle = typeof lieu.osm_tag_key === "string" ? lieu.osm_tag_key.trim().toLowerCase() : "";
  const valeur = typeof lieu.osm_tag_value === "string" ? lieu.osm_tag_value.trim().toLowerCase() : "";
  if (cle !== TAG_CLE_COMMERCE) return false;
  return VALEURS_COMMERCE_ALIMENTAIRE.has(valeur);
}

/* ── 4. NORMALISATION ──────────────────────────────────────────────────── */

const OSM_TYPES: ReadonlySet<string> = new Set(["NODE", "WAY", "RELATION"]);

/**
 * ⚠️ `Number.isSafeInteger`, ET SURTOUT PAS `Number.isInteger`.
 *
 * C4.2 a délibérément posé `op_location_id bigint` et `osm_id bigint` pour ne
 * pas rétrécir l'identité amont — 64 bits chez la source. Or JavaScript ne
 * représente exactement que les entiers jusqu'à 2⁵³−1 : au-delà,
 * `JSON.parse` ARRONDIT en silence. `9007199254740993` devient
 * `9007199254740992`, et `Number.isInteger` dit oui. On écrirait alors dans
 * `stores` un identifiant qui n'est celui de PERSONNE — proche du bon, donc
 * indétectable à la lecture.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * L'INVARIANT DE C4.3a, ÉNONCÉ PLUTÔT QUE SUBI
 * ────────────────────────────────────────────────────────────────────────────
 * Ce lot supporte le sous-ensemble EXACT des identifiants Open Prices et
 * OpenStreetMap représentables sans perte par JavaScript. Au-delà, il ÉCHOUE
 * FRANCHEMENT — il n'arrondit pas, il ne tronque pas, il ne devine pas.
 *
 * Ce n'est pas une refonte `BigInt` : ce serait un chantier à part, avec son
 * propre parseur JSON, et il n'est pas justifié aujourd'hui — les identifiants
 * OSM observés sont de l'ordre de 10¹⁰, très loin de la limite. Mais le jour
 * où la source les dépassera, le refus est infiniment préférable à une
 * identité fausse écrite dans un référentiel partagé.
 */
export function identifiantExterneValide(valeur: unknown): boolean {
  return typeof valeur === "number" && Number.isSafeInteger(valeur) && valeur > 0;
}

function entierPositif(valeur: unknown): number | null {
  return identifiantExterneValide(valeur) ? (valeur as number) : null;
}
function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;
}

/**
 * `null` = ce lieu n'est pas exploitable, et on l'écarte ENTIÈREMENT.
 *
 * ⚠️ JAMAIS DE DEMI-MAGASIN. Un lieu sans nom est inchoisissable ; un lieu sans
 * coordonnées ne peut pas entrer dans `stores`, dont les colonnes sont NOT
 * NULL. Rendre une fiche à trous obligerait l'écran — puis la route de
 * sélection, puis la base — à décider quoi faire d'un trou, chacun à sa façon.
 */
export function normaliserLieu(lieu: LieuBrut): MagasinProche | null {
  if (!estCommerceAlimentaire(lieu)) return null;

  const opLocationId = entierPositif(lieu.id);
  const osmId = entierPositif(lieu.osm_id);
  const osmType = typeof lieu.osm_type === "string" ? lieu.osm_type.toUpperCase() : "";
  const name = texteOuNull(lieu.osm_name);
  // ⚠️ PAS DE `Number(...)` DE CONFORT ICI. `Number(null)` vaut ZÉRO, pas NaN :
  // un lieu sans coordonnées serait donc accepté au large du golfe de Guinée,
  // et une ligne à 0/0 entrerait dans `stores`. Une coordonnée absente est une
  // coordonnée absente.
  const lat = typeof lieu.osm_lat === "number" ? lieu.osm_lat : Number.NaN;
  const lon = typeof lieu.osm_lon === "number" ? lieu.osm_lon : Number.NaN;
  // ⚠️ ABSENTE N'EST PAS INVALIDE. `/locations` ne rend pas ce champ : un lieu
  // sans distance reste parfaitement exploitable, il n'a simplement pas de
  // distance à afficher.
  const distanceKm =
    typeof lieu.distance_km === "number" && Number.isFinite(lieu.distance_km) && lieu.distance_km >= 0
      ? lieu.distance_km
      : null;

  if (opLocationId === null || osmId === null) return null;
  if (!OSM_TYPES.has(osmType)) return null;
  if (name === null) return null;
  if (!latitudeValide(lat) || !longitudeValide(lon)) return null;

  const pays = texteOuNull(lieu.osm_address_country_code);
  return {
    opLocationId,
    osmType: osmType as "NODE" | "WAY" | "RELATION",
    osmId,
    name,
    brand: texteOuNull(lieu.osm_brand),
    city: texteOuNull(lieu.osm_address_city),
    postcode: texteOuNull(lieu.osm_address_postcode),
    countryCode: pays === null ? null : pays.toUpperCase(),
    lat,
    lon,
    distanceKm,
  };
}

/** La clé OSM, telle que C4.2 la rend unique : le COUPLE, jamais `osm_id` seul. */
export function cleOsm(magasin: MagasinProche): string {
  return `${magasin.osmType}|${magasin.osmId}`;
}

/**
 * Accumule les lieux exploitables d'une page, sans jamais perdre l'historique.
 *
 * ⚠️ ON ACCUMULE LES CANDIDATS, PAS LE RÉSULTAT FILTRÉ, et c'est ce qui permet
 * au cas D de fonctionner : une ambiguïté révélée à la page 2 doit retirer
 * AUSSI le magasin déjà retenu à la page 1. Si l'accumulateur ne contenait que
 * le résultat déjà filtré, l'information nécessaire à ce retrait aurait
 * disparu — et la variante fautive resterait affichée.
 *
 * La déduplication EXACTE — mêmes deux identités — se fait ici : c'est le même
 * magasin vu deux fois, il n'y a rien d'ambigu.
 */
export function retenirCandidats(
  page: readonly LieuBrut[],
  deja: readonly MagasinProche[],
): readonly MagasinProche[] {
  const vus = new Set(deja.map((m) => `${m.opLocationId}#${cleOsm(m)}`));
  const candidats = [...deja];
  for (const brut of page) {
    const magasin = normaliserLieu(brut);
    if (magasin === null) continue;
    const empreinte = `${magasin.opLocationId}#${cleOsm(magasin)}`;
    if (vus.has(empreinte)) continue;
    vus.add(empreinte);
    candidats.push(magasin);
  }
  return candidats;
}

/**
 * Les magasins dont l'identité est SANS AMBIGUÏTÉ, triés par distance.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA DÉCOUVERTE DOIT PARLER LE MÊME MODÈLE D'IDENTITÉ QUE LA PERSISTANCE
 * ────────────────────────────────────────────────────────────────────────────
 * C4.2 pose DEUX unicités indépendantes : `op_location_id`, et le couple
 * `(osm_type, osm_id)`. Une déduplication sur le seul `op_location_id` laissait
 * donc passer ceci :
 *
 *     lieu A : op 42, WAY/999
 *     lieu B : op 77, WAY/999
 *
 * Les deux étaient proposés à l'élève. Il choisissait A — enregistré. Puis il
 * changeait d'avis pour B, et la sélection échouait sur le conflit d'identité
 * que `upserterMagasin` sait justement détecter. L'élève voyait une erreur
 * incompréhensible sur un magasin que NOUS lui avions montré.
 *
 * ⚠️ ET ON NE TRANCHE PAS À SA PLACE. Devant deux `op_location_id` pour un même
 * objet OpenStreetMap, rien ne dit lequel est le bon : c'est une incohérence de
 * la source, et choisir « le premier » ou « le mieux fourni » fabriquerait une
 * réponse là où il n'y en a pas. Les DEUX variantes sortent des résultats. Le
 * cas symétrique — un `op_location_id` portant deux identités OSM — est traité
 * de la même façon, pour la même raison.
 *
 * ⚠️ NI LE NOM NI L'ENSEIGNE N'ENTRENT JAMAIS DANS CE CALCUL : deux commerces
 * d'une même enseigne, avec des identités distinctes, restent deux magasins.
 */
/**
 * Les candidats dont l'identité est SANS AMBIGUÏTÉ — sans tri.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA DÉCOUVERTE DOIT PARLER LE MÊME MODÈLE D'IDENTITÉ QUE LA PERSISTANCE
 * ────────────────────────────────────────────────────────────────────────────
 * C4.2 pose DEUX unicités indépendantes : `op_location_id`, et le couple
 * `(osm_type, osm_id)`. Une déduplication sur le seul `op_location_id`
 * laisserait passer ceci :
 *
 *     lieu A : op 42, WAY/999
 *     lieu B : op 77, WAY/999
 *
 * Les deux seraient proposés à l'élève. Il choisirait A — enregistré. Puis il
 * changerait d'avis pour B, et la sélection échouerait sur le conflit
 * d'identité que `upserterMagasin` sait justement détecter. L'élève verrait
 * une erreur incompréhensible sur un magasin que NOUS lui avons montré.
 *
 * ⚠️ ET ON NE TRANCHE PAS À SA PLACE. Devant deux `op_location_id` pour un même
 * objet OpenStreetMap, rien ne dit lequel est le bon : c'est une incohérence de
 * la source, et choisir « le premier » ou « le mieux fourni » fabriquerait une
 * réponse là où il n'y en a pas. Les DEUX variantes sortent des résultats. Le
 * cas symétrique — un `op_location_id` portant deux identités OSM — est traité
 * de la même façon, pour la même raison.
 *
 * ⚠️ NI LE NOM NI L'ENSEIGNE N'ENTRENT JAMAIS DANS CE CALCUL : deux commerces
 * d'une même enseigne, avec des identités distinctes, restent deux magasins.
 *
 * ⚠️ EXTRAITE DU TRI, PARCE QUE LES DEUX CHEMINS DE DÉCOUVERTE N'ORDONNENT PAS
 * PAREIL — la géolocalisation par distance, la ville par pertinence — mais
 * doivent appliquer EXACTEMENT la même règle d'identité. Deux copies auraient
 * divergé au premier correctif.
 */
export function identitesCoherentes(
  candidats: readonly MagasinProche[],
): readonly MagasinProche[] {
  const osmParOp = new Map<number, Set<string>>();
  const opParOsm = new Map<string, Set<number>>();
  for (const m of candidats) {
    const osm = cleOsm(m);
    if (!osmParOp.has(m.opLocationId)) osmParOp.set(m.opLocationId, new Set());
    osmParOp.get(m.opLocationId)!.add(osm);
    if (!opParOsm.has(osm)) opParOsm.set(osm, new Set());
    opParOsm.get(osm)!.add(m.opLocationId);
  }
  return candidats.filter(
    (m) => osmParOp.get(m.opLocationId)!.size === 1 && opParOsm.get(cleOsm(m))!.size === 1,
  );
}

/** Les magasins cohérents, triés par distance croissante — chemin `/nearby`. */
export function magasinsCoherents(
  candidats: readonly MagasinProche[],
): readonly MagasinProche[] {
  return [...identitesCoherentes(candidats)].sort((a, b) => {
    const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
    const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
    return da === db ? a.opLocationId - b.opLocationId : da - db;
  });
}

/* ── 5. LA RECHERCHE MANUELLE PAR VILLE ────────────────────────────────── */

/**
 * ⚠️ C4.3b EST UNE RECHERCHE MANUELLE **FRANCE**, ET LE DIT.
 *
 * Le projet est francophone et son référentiel nutritionnel est Ciqual : la
 * première version de la recherche manuelle vise la France. Ce choix est ÉCRIT
 * ICI, testé, et il n'est PAS négociable par le navigateur — le déduire de la
 * locale aurait été invisible, intestable, et faux pour un Français en
 * vacances.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX CONSTANTES, DEUX RÔLES, ET SURTOUT PAS UNE TABLE ISO → NOM
 * ────────────────────────────────────────────────────────────────────────────
 * `PAYS_NOM_AMONT` est ce qu'on ENVOIE : `osm_address_country__like` filtre sur
 * le NOM du pays en toutes lettres, pas sur un code. `PAYS_CODE` est ce qu'on
 * VÉRIFIE au retour, sur le `osm_address_country_code` que la réponse porte.
 *
 * Généraliser cela à d'autres pays exigerait une table « code ISO → nom amont »
 * — et cette table serait FAUSSE. Mesuré le 18/08/2026 : les commerces belges
 * portent `osm_address_country = "België / Belgique / Belgien"`. « Belgium »
 * n'y trouve rien, « Belgique » oui, et rien dans un code ISO ne permet de
 * deviner laquelle des trois graphies la source emploie. Le multi-pays sera un
 * lot explicite, avec un vrai contrat de correspondance. Pas une devinette
 * glissée ici.
 */
export const PAYS_CODE = "FR";
export const PAYS_NOM_AMONT = "France";

/** Assez pour « Ax », trop peu pour un caractère isolé qui ramènerait tout. */
export const VILLE_LONGUEUR_MIN = 2;
/** Le plus long nom de commune de France en fait 45 ; 80 laisse de la marge. */
export const VILLE_LONGUEUR_MAX = 80;

/** Mêmes bornes de pagination que la découverte géographique, mêmes raisons. */
export const VILLE_TAILLE_PAGE = 100;
export const VILLE_PAGES_MAX = 3;
export const VILLE_RESULTATS_CIBLE = 20;

export function villeValide(valeur: unknown): boolean {
  if (typeof valeur !== "string") return false;
  const nette = valeur.trim();
  return nette.length >= VILLE_LONGUEUR_MIN && nette.length <= VILLE_LONGUEUR_MAX;
}

/**
 * La forme comparable d'un nom de ville : minuscules, sans accents, espaces
 * réduits.
 *
 * ⚠️ ELLE NE SERT QU'À COMPARER, JAMAIS À INTERROGER. Ce qui part chez l'amont
 * est la saisie de l'élève telle quelle — le filtre y est déjà insensible à la
 * casse (`icontains`), et lui envoyer une chaîne dépouillée de ses accents
 * ferait manquer les villes que la source orthographie correctement.
 */
export function normaliserVille(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Les magasins cohérents d'une recherche par ville, ordonnés.
 *
 * ⚠️ AUCUN SCORE DE PERTINENCE FABRIQUÉ. Deux rangs seulement, et le critère du
 * premier est vérifiable à l'œil : la ville du magasin est-elle EXACTEMENT
 * celle qui a été saisie ?
 *
 * Le second rang existe parce que l'amont fait un `icontains` : chercher
 * « Valence » ramène aussi « Bourg-lès-Valence » — mesuré le 18/08/2026, 6
 * résultats dont 2. Les jeter serait présomptueux : ce sont de vrais commerces,
 * et l'élève cherche peut-être celui-là. On les range après, sans prétendre
 * savoir lequel il veut.
 *
 * À rang égal, l'ordre est déterministe — nom puis identifiant — pour que deux
 * recherches identiques donnent deux listes identiques.
 */
export function magasinsParPertinenceVille(
  candidats: readonly MagasinProche[],
  villeCherchee: string,
): readonly MagasinProche[] {
  const cible = normaliserVille(villeCherchee);
  const rang = (m: MagasinProche) => (m.city !== null && normaliserVille(m.city) === cible ? 0 : 1);
  return [...identitesCoherentes(candidats)].sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    if (ra !== rb) return ra - rb;
    const na = normaliserVille(a.name);
    const nb = normaliserVille(b.name);
    if (na !== nb) return na < nb ? -1 : 1;
    return a.opLocationId - b.opLocationId;
  });
}
