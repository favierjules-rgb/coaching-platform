/**
 * CARTOGRAPHIE — LE FOND DE CARTE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE NE CONNAÎT AUCUN MAGASIN
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE MOTEUR DE RECHERCHE DES COMMERCES ET LE FOURNISSEUR DE FOND DE CARTE
 * SONT DEUX CHOSES SÉPARÉES, ET CE FICHIER EST LA FRONTIÈRE.
 *
 * Les commerces viennent d'Overpass / OpenStreetMap (`lib/openstreetmap/`), via
 * NOS routes serveur. Le fournisseur de fond ne sert qu'à DESSINER : il ne
 * reçoit aucune liste de magasins, aucune requête de recherche, aucune ville
 * saisie. Il ne reçoit que des numéros de tuiles.
 *
 * Conséquence directe, et elle vient d'être éprouvée : changer de fournisseur
 * ne touche ni `lib/openstreetmap/`, ni `app/api/student/stores/*`, ni le
 * composant de recherche. Il a suffi de réécrire ce fichier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI OPENFREEMAP, ET CE QU'IL FAUT SAVOIR DU MARCHÉ CONCLU
 * ════════════════════════════════════════════════════════════════════════════
 * Relevé sur les pages officielles le 08/11/2026 :
 *
 *   · usage commercial — « Is commercial usage allowed? » → « Yes. » ;
 *   · « There's no registration, no user database, no API keys, and no
 *     cookies » ;
 *   · « there are no limits on the number of map views or requests » ;
 *   · attribution automatique avec MapLibre : « they are automatically added,
 *     you have nothing to do ».
 *
 * ⚠️ ET CE QU'ON ABANDONNE EN ÉCHANGE, QUI N'EST PAS RIEN :
 *   · « I don't offer SLA guarantees or personalized support » ;
 *   · « provided "as-is," with no warranties » ; « we aim to maintain the
 *     Site's availability but may discontinue it at any time without notice ».
 *
 * Le service est tenu par une personne, financé par des dons. En contrepartie,
 * le projet est sous licence MIT, les images complètes de la planète sont
 * publiées chaque semaine, et l'auto-hébergement est documenté : si le service
 * public s'arrête, la sortie existe et elle ne demande ni contrat ni clé.
 * C'est ce qui rend ce pari raisonnable — pas la gratuité seule.
 *
 * ⚠️ AUCUN APPEL RÉSEAU DANS CE MODULE. Il ne fait que lire une variable
 * d'environnement et rendre une URL. Fonctions PURES, testables sans réseau.
 */

/**
 * L'hôte unique du fournisseur — et c'est tout ce que la CSP doit ouvrir.
 *
 * ⚠️ UN SEUL HÔTE, VÉRIFIÉ SUR LE STYLE LUI-MÊME. Le document `liberty` ne
 * cite aucune autre origine : le style, les polices (`/fonts/`), les planches
 * de symboles (`/sprites/`), les tuiles vectorielles (`/planet/`) et le relief
 * ombré (`/natural_earth/`) en viennent tous. Déclarer un joker serait ouvrir
 * ce dont personne n'a besoin.
 */
export const ORIGINE_FOND_DE_CARTE = "https://tiles.openfreemap.org";

/** Le style par défaut : des rues lisibles, sans relief ni 3D. */
export const STYLE_PAR_DEFAUT = `${ORIGINE_FOND_DE_CARTE}/styles/liberty`;

export type RaisonFondIndisponible = "style_invalide" | "origine_interdite";

export type ConfigurationCarte =
  | {
      readonly statut: "prete";
      readonly urlDuStyle: string;
      readonly attributions: readonly Attribution[];
    }
  | { readonly statut: "indisponible"; readonly raison: RaisonFondIndisponible };

export interface Attribution {
  readonly libelle: string;
  readonly href: string;
}

/**
 * L'attribution EXIGÉE — et elle est posée par MapLibre, pas par nous.
 *
 * Le TileJSON d'OpenFreeMap porte son propre champ `attribution`
 * (OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap), et le contrôle
 * d'attribution de MapLibre l'affiche automatiquement. C'est ce que dit la
 * documentation : « If you are using MapLibre, they are automatically added,
 * you have nothing to do. »
 *
 * ⚠️ CETTE LISTE EST DONC UN FILET, PAS LA SOURCE. Elle sert à ce qu'un test
 * puisse vérifier que le crédit est exigé, et à l'afficher si un jour le style
 * cessait de le porter. Le contrôle d'attribution reste activé et non
 * repliable dans tous les cas.
 */
export const ATTRIBUTIONS_REQUISES: readonly Attribution[] = [
  { libelle: "OpenFreeMap", href: "https://openfreemap.org" },
  { libelle: "© OpenMapTiles", href: "https://www.openmaptiles.org/" },
  { libelle: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
];

/**
 * La configuration du fond de carte.
 *
 * ⚠️ IL N'Y A PLUS DE CLÉ, DONC PLUS D'ÉTAT « NON CONFIGURÉ ». C'était le
 * premier état d'indisponibilité de l'ancien fournisseur, et la cause de la
 * panne la plus longue de ce chantier : une clé absente en Preview. Elle ne
 * peut plus se produire — il n'y a rien à renseigner pour que la carte marche.
 *
 * ⚠️ CE QUI RESTE VÉRIFIÉ : qu'une surcharge d'environnement, si quelqu'un en
 * pose une, soit bien une URL `https` — et pas une origine quelconque glissée
 * dans une variable publique.
 */
export function configurationCarte(env: { readonly styleUrl?: string | undefined }): ConfigurationCarte {
  const surcharge = (env.styleUrl ?? "").trim();
  const url = surcharge === "" ? STYLE_PAR_DEFAUT : surcharge;

  let analysee: URL;
  try {
    analysee = new URL(url);
  } catch {
    return { statut: "indisponible", raison: "style_invalide" };
  }
  if (analysee.protocol !== "https:") {
    return { statut: "indisponible", raison: "style_invalide" };
  }
  /*
   * ⚠️ UNE SURCHARGE NE PEUT PAS SORTIR DE L'ORIGINE DÉCLARÉE DANS LA CSP.
   * Pointer ailleurs donnerait une carte grise sans explication : la requête
   * partirait, la politique la refuserait, et l'on chercherait la panne dans
   * le code. Mieux vaut le dire ici, tout de suite.
   */
  if (analysee.origin !== ORIGINE_FOND_DE_CARTE) {
    return { statut: "indisponible", raison: "origine_interdite" };
  }

  return { statut: "prete", urlDuStyle: analysee.href, attributions: ATTRIBUTIONS_REQUISES };
}

/**
 * La configuration lue dans l'environnement du NAVIGATEUR.
 *
 * ⚠️ `process.env.NEXT_PUBLIC_*` EST REMPLACÉ À LA COMPILATION par Next, ce qui
 * veut dire qu'il faut l'écrire littéralement — pas via une variable
 * intermédiaire, sinon le remplacement n'a pas lieu.
 *
 * ⚠️ ET LA VARIABLE EST FACULTATIVE. Sans elle, la carte marche : c'est tout
 * l'intérêt d'un fournisseur sans clé.
 */
export function configurationDepuisEnv(): ConfigurationCarte {
  return configurationCarte({ styleUrl: process.env.NEXT_PUBLIC_CARTE_STYLE_URL });
}

/** Un message pour l'élève. Il dit ce qui manque, sans nommer de fournisseur. */
export function messageCarteIndisponible(raison: RaisonFondIndisponible): string {
  switch (raison) {
    case "style_invalide":
      return "Le fond de carte est mal configuré sur cette installation. La liste des commerces reste utilisable.";
    case "origine_interdite":
      return "Le fond de carte demandé n'est pas autorisé ici. La liste des commerces reste utilisable.";
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * CLASSER UNE ERREUR DE MAPLIBRE : FATALE, OU SIMPLE INCIDENT DE RESSOURCE
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ MAPLIBRE ÉMET `error` POUR TOUT CE QUI ÉCHOUE À SE CHARGER, et la plupart
 * de ces échecs ne sont pas des pannes de carte : une tuile, une planche de
 * symboles, un TileJSON. Les traiter comme fatals détruit une carte qui marche.
 *
 * ⚠️ ET « AVANT LE PREMIER `load` » NE SUFFIT PAS À TRANCHER. C'était la règle
 * précédente, et elle est fausse : mesuré dans Chromium sur MapLibre 6.16.0,
 * un sprite absent émet son erreur AVANT `load`, et `load` arrive quand même
 * juste après. La carte était donc détruite pour une planche de symboles.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE L'ÉVÉNEMENT EXPOSE RÉELLEMENT — RELEVÉ, PAS SUPPOSÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Chaque panne a été provoquée séparément et les clés énumérées à l'exécution :
 *
 *   panne                 load  clés de l'événement                      url
 *   ───────────────────── ───── ──────────────────────────────────────── ─────────
 *   style 404 / 403       non   error, type, target, style               = style
 *   style illisible       non   error, type, target, style               absente
 *   TileJSON 404          oui   + sourceId, source, isSourceLoaded       ≠ style
 *   tuile 500             oui   + sourceId, source, isSourceLoaded, tile ≠ style
 *   sprite 404 / 500      oui   error, type, target, style               ≠ style
 *   tuile 404, glyphes    oui   AUCUN ÉVÉNEMENT ÉMIS
 *
 * `AJAXError` porte `status`, `statusText`, `url`, `body` — c'est tout, et
 * c'est documenté dans les typages du paquet. ⚠️ `error.name` vaut `"Error"` et
 * le constructeur est minifié : RIEN NE DOIT REPOSER SUR LE NOM DE LA CLASSE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE QUI EN DÉCOULE
 * ────────────────────────────────────────────────────────────────────────────
 *   1. une erreur rattachée à une SOURCE (`sourceId`) n'est jamais fatale —
 *      c'est une tuile ou un TileJSON, et la carte se dessine autour ;
 *   2. une erreur réseau sur une AUTRE URL que le style n'est jamais fatale —
 *      sprite, polices : des ornements, pas le plan ;
 *   3. une erreur réseau SUR le style est fatale, et un 401 / 403 / 404 y est
 *      un refus de l'amont, pas une panne passagère ;
 *   4. sans source ni URL, seul ce qui arrive AVANT `load` peut être le style
 *      lui-même (illisible). Après `load`, le style est acquis : c'est autre
 *      chose, et ce n'est pas fatal.
 *
 * ⚠️ FONCTION PURE, SANS DOM NI RÉSEAU : la règle se teste pour de bon, avec
 * les formes exactes relevées ci-dessus.
 */
export type IssueErreurCarte = "ressource" | "style" | "refus_amont";

export interface AnalyseErreurCarte {
  /** `"ressource"` = bénin : à journaliser, jamais à faire basculer l'écran. */
  readonly issue: IssueErreurCarte;
  readonly statut: number | null;
  readonly url: string | null;
  readonly message: string;
  /** L'identifiant de source, quand MapLibre en attache un. */
  readonly sourceId: string | null;
}

/** Les statuts par lesquels un amont dit « non », par opposition à « pas maintenant ». */
const STATUTS_DE_REFUS: readonly number[] = [401, 403, 404];

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

export function classerErreurDeCarte(entree: {
  /** L'objet passé par MapLibre à `map.on("error", …)`. */
  readonly evenement: unknown;
  /** L'URL du document de style, telle que la carte l'a reçue. */
  readonly urlDuStyle: string;
  /** La carte a-t-elle DÉJÀ émis `load` une fois ? */
  readonly chargee: boolean;
}): AnalyseErreurCarte {
  const evenement = (entree.evenement ?? {}) as Record<string, unknown>;
  const erreur = (evenement.error ?? null) as Record<string, unknown> | null;

  const sourceId = texte(evenement.sourceId);
  const url = texte(erreur?.url);
  const statut = typeof erreur?.status === "number" ? erreur.status : null;
  const message =
    erreur instanceof Error
      ? erreur.message
      : texte(erreur?.message) ?? (erreur === null ? "" : String(erreur));

  const commun = { statut, url, message, sourceId };

  // 1. Rattachée à une source : tuile ou TileJSON. La carte se dessine autour.
  if (sourceId !== null) return { ...commun, issue: "ressource" };

  if (url !== null) {
    /*
     * 2 et 3. ⚠️ LA COMPARAISON SE FAIT SUR L'URL, parce que c'est la SEULE
     * chose qui distingue le style d'un sprite : l'événement ne porte aucune
     * autre marque. `configurationCarte` rend déjà une URL normalisée par
     * `URL`, et MapLibre la transmet telle quelle — la comparaison stricte
     * suffit, et la forme normalisée la double par précaution.
     */
    const estLeStyle = url === entree.urlDuStyle || memeAdresse(url, entree.urlDuStyle);
    if (!estLeStyle) return { ...commun, issue: "ressource" };
    return {
      ...commun,
      issue: statut !== null && STATUTS_DE_REFUS.includes(statut) ? "refus_amont" : "style",
    };
  }

  /*
   * 4. Ni source ni URL : un style illisible, une validation refusée. Seul ce
   * qui arrive avant `load` peut encore être le style lui-même.
   */
  return { ...commun, issue: entree.chargee ? "ressource" : "style" };
}

function memeAdresse(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}
