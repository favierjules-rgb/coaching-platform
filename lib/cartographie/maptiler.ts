/**
 * CARTOGRAPHIE — LA CONFIGURATION DU FOURNISSEUR DE FONDS DE CARTE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE NE CONNAÎT AUCUN MAGASIN
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE MOTEUR DE RECHERCHE DES COMMERCES ET LE FOURNISSEUR DE CARTE SONT DEUX
 * CHOSES SÉPARÉES, ET CE FICHIER EST LA FRONTIÈRE.
 *
 * Les commerces viennent d'Overpass / OpenStreetMap (`lib/openstreetmap/`), via
 * NOS routes serveur. MapTiler ne sert qu'à DESSINER le fond : il ne reçoit
 * aucune liste de magasins, aucune requête de recherche, aucune ville saisie.
 * Il ne reçoit que des numéros de tuiles.
 *
 * Conséquence directe : changer de fournisseur de fonds de carte ne touche ni
 * `lib/openstreetmap/`, ni `app/api/student/stores/*`, ni le composant de
 * recherche. Il suffit de réécrire `urlDuStyle()`. Et si la carte disparaît
 * entièrement, la recherche continue de fonctionner — c'est la raison d'être de
 * cette séparation, pas une élégance.
 *
 * ⚠️ AUCUN APPEL RÉSEAU DANS CE MODULE. Il ne fait que lire des variables
 * d'environnement et composer une URL. Fonctions PURES, testables sans réseau.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA CLÉ EST PUBLIQUE PAR CONCEPTION, ET PROTÉGÉE AUTREMENT
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ `NEXT_PUBLIC_` N'EST PAS UNE NÉGLIGENCE. Un fond de carte se charge DANS
 * le navigateur, tuile par tuile : la clé part forcément dans l'URL des
 * requêtes, et MapTiler le dit lui-même — « les requêtes authentifiées par une
 * clé API sont visibles du monde entier ». La faire passer par une route
 * serveur ne la cacherait pas, elle ferait transiter chaque tuile par notre
 * serveur, ce qui coûterait notre bande passante pour rien.
 *
 * LA PROTECTION EST AILLEURS, ET ELLE EST À CONFIGURER CHEZ MAPTILER :
 * la clé doit être restreinte aux **origines HTTP autorisées** (le domaine de
 * production, et lui seul). MapTiler : « si quelqu'un vole votre clé et
 * l'utilise sur un autre domaine, elle ne fonctionnera pas. » Les appels étant
 * en lecture seule, un vol ne peut pas abîmer les cartes — il peut seulement
 * consommer le quota, donc coûter de l'argent. D'où la restriction d'origine,
 * et d'où le plafond de dépense à poser sur le compte.
 *
 * ⚠️ NE JAMAIS UTILISER LA CLÉ PAR DÉFAUT DU COMPTE. MapTiler : « la clé par
 * défaut n'a aucune protection… pour un usage public en production, créez une
 * nouvelle clé protégée. » `cleEstParDefaut()` existe pour que ce soit
 * vérifiable, et un test le vérifie.
 */

/** Le style par défaut : des rues lisibles, sans relief ni 3D. */
export const STYLE_PAR_DEFAUT = "streets-v2";

/**
 * ⚠️ PAS DE 3D, ET C'EST AUSSI UNE QUESTION D'ARGENT. MapTiler facture les
 * « sessions 3D » à part et plus cher, et impose son logo sur la 3D même sur
 * les formules payantes. Une liste de courses n'a aucun besoin de relief.
 */
const STYLES_INTERDITS: ReadonlySet<string> = new Set(["3d", "terrain-3d", "basic-3d"]);

/** La valeur que MapTiler distribue comme clé de démonstration. */
const CLE_PAR_DEFAUT_MAPTILER = "get_your_own_key";

export type RaisonCarteIndisponible =
  | "cle_absente"
  | "cle_par_defaut"
  | "style_interdit";

export type ConfigurationCarte =
  | {
      readonly statut: "prete";
      readonly urlDuStyle: string;
      /** Ce que l'attribution doit afficher. Voir `ATTRIBUTIONS_REQUISES`. */
      readonly attributions: readonly Attribution[];
    }
  | { readonly statut: "indisponible"; readonly raison: RaisonCarteIndisponible };

export interface Attribution {
  readonly libelle: string;
  readonly href: string;
}

/**
 * Les attributions EXIGÉES, et elles ne sont pas décoratives.
 *
 * MapTiler impose « © MapTiler » avec un lien vers sa page de copyright, et
 * « © OpenStreetMap » avec un lien vers la sienne dès que les données
 * viennent d'OSM — ce qui est le cas de tous ses fonds de carte standards.
 * Les deux doivent rester visibles et lisibles, dans un coin de la carte.
 *
 * ⚠️ ELLES NE SONT NI MASQUABLES NI REPLIABLES DERRIÈRE UN BOUTON sur grand
 * écran. MapTiler tolère un repli contextuel sur téléphone ; nous les laissons
 * visibles partout, ce qui est plus simple et ne demande rien à personne.
 */
export const ATTRIBUTIONS_REQUISES: readonly Attribution[] = [
  { libelle: "© MapTiler", href: "https://www.maptiler.com/copyright/" },
  { libelle: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
];

/**
 * La configuration de la carte, telle que l'environnement la décrit.
 *
 * ⚠️ « INDISPONIBLE » EST UN ÉTAT NORMAL, PAS UNE PANNE À CACHER. Sans clé —
 * en développement, en recette, ou si le compte est suspendu — l'écran doit
 * montrer la LISTE des commerces et dire pourquoi la carte manque. Un cadre
 * gris vide laisserait croire à un bogue ; une carte factice serait un
 * mensonge.
 */
export function configurationCarte(env: {
  readonly cle?: string | undefined;
  readonly style?: string | undefined;
}): ConfigurationCarte {
  const cle = (env.cle ?? "").trim();
  if (cle === "") return { statut: "indisponible", raison: "cle_absente" };
  if (cleEstParDefaut(cle)) return { statut: "indisponible", raison: "cle_par_defaut" };

  const style = (env.style ?? "").trim() === "" ? STYLE_PAR_DEFAUT : (env.style ?? "").trim();
  if (STYLES_INTERDITS.has(style)) return { statut: "indisponible", raison: "style_interdit" };

  return {
    statut: "prete",
    urlDuStyle: urlDuStyle(style, cle),
    attributions: ATTRIBUTIONS_REQUISES,
  };
}

/** La clé fournie est-elle celle de démonstration de MapTiler ? */
export function cleEstParDefaut(cle: string): boolean {
  return cle.trim().toLowerCase() === CLE_PAR_DEFAUT_MAPTILER;
}

/**
 * L'URL du style.
 *
 * ⚠️ LA CLÉ EST ENCODÉE, ET LE STYLE AUSSI. Une clé collée avec une espace de
 * fin, ou un identifiant de style venu d'une variable d'environnement mal
 * remplie, ne doivent pas pouvoir fabriquer une URL à deux paramètres.
 *
 * ⚠️ UN SEUL ENDROIT DANS LE PROJET CONSTRUIT CETTE URL. Changer de
 * fournisseur, c'est réécrire cette fonction, et rien d'autre.
 */
export function urlDuStyle(style: string, cle: string): string {
  const s = encodeURIComponent(style.trim());
  const k = encodeURIComponent(cle.trim());
  return `https://api.maptiler.com/maps/${s}/style.json?key=${k}`;
}

/**
 * La configuration lue dans l'environnement du NAVIGATEUR.
 *
 * ⚠️ `process.env.NEXT_PUBLIC_*` EST REMPLACÉ À LA COMPILATION par Next, ce qui
 * veut dire qu'il faut l'écrire littéralement — pas via une variable
 * intermédiaire, sinon le remplacement n'a pas lieu et la clé arrive vide en
 * production.
 */
export function configurationDepuisEnv(): ConfigurationCarte {
  return configurationCarte({
    cle: process.env.NEXT_PUBLIC_MAPTILER_KEY,
    style: process.env.NEXT_PUBLIC_MAPTILER_STYLE,
  });
}

/** Un message pour l'élève. Il dit ce qui manque, sans nommer de fournisseur. */
export function messageCarteIndisponible(raison: RaisonCarteIndisponible): string {
  switch (raison) {
    case "cle_absente":
      return "La carte n'est pas configurée sur cette installation. La liste des commerces reste utilisable.";
    case "cle_par_defaut":
      return "La carte n'est pas configurée correctement. La liste des commerces reste utilisable.";
    case "style_interdit":
      return "Le fond de carte demandé n'est pas autorisé ici. La liste des commerces reste utilisable.";
  }
}
