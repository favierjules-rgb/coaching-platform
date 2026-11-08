"use client";

import { useEffect, useRef, useState } from "react";

import {
  classerErreurDeCarte,
  configurationDepuisEnv,
  messageCarteIndisponible,
  type ConfigurationCarte,
} from "@/lib/cartographie/fond-de-carte";
import {
  cadreDeLaRecherche,
  collectionDeMagasins,
  coordonneesFiables,
  type Point,
} from "@/lib/cartographie/vue-magasins";
import { cleIdentiteOsm, type MagasinOsm } from "@/lib/nutrition/magasins-osm";
import { WORKER_MAPLIBRE_URL } from "@/lib/cartographie/worker-maplibre.generated";

/**
 * COURSES — LA CARTE DES COMMERCES.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE COMPOSANT NE CHERCHE RIEN
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ IL NE FAIT AUCUN `fetch`, N'APPELLE AUCUNE ROUTE, NE CONNAÎT NI OVERPASS,
 * NI VILLE, NI RAYON. Il reçoit une liste de commerces déjà trouvée et la
 * dessine. C'est la séparation demandée : le moteur de recherche et le
 * fournisseur de carte ne se rencontrent jamais.
 *
 * Conséquence vérifiable : supprimer ce fichier n'enlève aucune fonctionnalité
 * de recherche. Un test le mesure.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * MAPLIBRE EST CHARGÉ TARD, ET SEULEMENT SI ON EN A BESOIN
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ IMPORT DYNAMIQUE, PAS STATIQUE. Le bundle de MapLibre pèse environ 295 Ko
 * compressés. En import statique, il entrerait dans le lot de la route Courses
 * et serait téléchargé par tout élève qui vient consulter sa liste, y compris
 * sur un téléphone en 3G, y compris s'il n'ouvre jamais la carte.
 *
 * ⚠️ ET L'IMPORT EST DANS UN EFFET, donc jamais au rendu serveur. MapLibre
 * s'importe sans DOM (vérifié), mais `new Map()` exige un conteneur et du
 * WebGL : au rendu serveur, ce composant ne produit qu'un cadre vide.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE QUE LE FOURNISSEUR DE TUILES APPREND, ET CE QU'IL FAUT SAVOIR
 * ════════════════════════════════════════════════════════════════════════════
 * Une carte se charge tuile par tuile. Le fournisseur voit donc QUELLES TUILES
 * sont demandées, c'est-à-dire la zone regardée, et l'adresse IP qui les
 * demande. Sur le mode « autour de moi », cela revient à lui indiquer la zone
 * où se trouve l'élève — approximativement, mais réellement.
 *
 * Il ne reçoit en revanche RIEN d'autre : ni la liste des commerces (les
 * marqueurs sont dessinés par le navigateur, à partir de notre réponse), ni la
 * ville saisie, ni l'identité de l'élève, ni aucune coordonnée exacte dans une
 * requête. Les marqueurs ne passent par aucun service de géocodage.
 *
 * C'est le prix d'une carte, quel que soit le fournisseur. Il est écrit ici
 * pour qu'il soit un choix, et non une surprise.
 */

/*
 * ⚠️ LES IDENTIFIANTS SONT DES CONSTANTES, PAS DES CHAÎNES SEMÉES. Une couche
 * ajoutée sous un nom et retirée sous un autre reste en place pour toujours —
 * et le symptôme, des pastilles fantômes d'une recherche précédente, se
 * cherche longtemps.
 */
const SOURCE = "commerces";
const COUCHE_AMAS = "commerces-amas";
const COUCHE_AMAS_NOMBRE = "commerces-amas-nombre";
const COUCHE_POINT = "commerces-point";
const COUCHE_CHOISI = "commerces-choisi";

/*
 * ⚠️ LES COULEURS VIENNENT DU THÈME, et non d'un code écrit ici. Les écrire en
 * dur donnerait deux palettes qui divergeraient au premier changement de
 * thème. `--primary` pour le neutre, `--success` pour le choisi, `--card` pour
 * le contour — exactement ce que portaient les anciens marqueurs.
 */
/*
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ MAPLIBRE N'EST PAS DU CSS : IL NE RÉSOUT AUCUNE VARIABLE
 * ════════════════════════════════════════════════════════════════════════════
 * Les couleurs des couches passaient les jetons sémantiques tels quels —
 * `"var(--primary)"`. MapLibre analyse lui-même les couleurs, hors du moteur
 * de style du navigateur : il refuse la chaîne et REJETTE LA COUCHE ENTIÈRE.
 *
 * Mesuré dans Chromium sur cette configuration exacte, sept erreurs :
 *
 *     layers.commerces-amas.paint.circle-color:
 *       color expected, "var(--primary)" found
 *
 * Conséquence : aucune couche n'était ajoutée, donc AUCUN marqueur, AUCUN
 * amas, AUCUNE mise en évidence du commerce choisi — et chacune de ces sept
 * erreurs émettait `error`, ce qui faisait basculer l'écran sur « le fond de
 * carte est momentanément indisponible » alors que le fond, lui, était chargé.
 *
 * ⚠️ LA RÉPONSE N'EST PAS D'ÉCRIRE DES COULEURS EN DUR. Le jeton reste la
 * source de vérité — il change avec le thème clair ou sombre. On le RÉSOUT
 * donc à l'exécution, sur le conteneur de la carte, et le repli ne sert que si
 * la feuille de style n'est pas encore appliquée.
 */
const JETON_NEUTRE = "--primary";
const JETON_CHOISI = "--success";
const JETON_CONTOUR = "--card";
/** Replis : les valeurs du thème clair, lues dans `app/globals.css`. */
const REPLI_NEUTRE = "#111111";
const REPLI_CHOISI = "#16a34a";
const REPLI_CONTOUR = "#ffffff";

/**
 * La valeur RÉELLE d'un jeton, telle que le navigateur l'a calculée.
 *
 * ⚠️ `getPropertyValue` REND UNE CHAÎNE VIDE quand la propriété n'est pas
 * définie — pas `null`, et sans lever. Le repli couvre ce cas, ainsi qu'un
 * rendu serveur où il n'y a pas de style calculé du tout.
 */
function couleurDuJeton(element: HTMLElement, jeton: string, repli: string): string {
  try {
    const valeur = getComputedStyle(element).getPropertyValue(jeton).trim();
    return valeur === "" ? repli : valeur;
  } catch {
    return repli;
  }
}

/** Ce que la carte peut ne pas réussir à faire, après que la clé a été jugée bonne. */
type EchecCarte = "webgl" | "chargement" | "style" | "refus_amont";

export interface CarteDesMagasinsProps {
  readonly magasins: readonly MagasinOsm[];
  /** L'identité OSM du commerce sélectionné, ou `null`. */
  readonly selectionnee: string | null;
  /** La position de l'élève, quand il l'a partagée pour CETTE recherche. */
  readonly depart: Point | null;
  /**
   * Le centre de la commune cherchée, en mode « par ville ».
   *
   * ⚠️ IL N'EST PAS UN SUBSTITUT DE GPS, ET LA CARTE NE DÉPEND D'AUCUN DES
   * DEUX. Chaque mode a sa source de centrage : la position pour « autour de
   * moi », le centre officiel de la commune pour « par ville ». Aucun des deux
   * n'emprunte celle de l'autre, et la carte s'affiche dès que l'un existe —
   * ou dès qu'il y a des commerces à encadrer.
   */
  readonly centreCommune?: Point | null;
  readonly onSelectionner: (cle: string) => void;
  /** Rendu de la fiche, au-dessus de la carte. Le parent la fournit. */
  readonly ficheDuSelectionne?: React.ReactNode;
  /** Pour les tests : injecte une configuration au lieu de lire l'environnement. */
  readonly configuration?: ConfigurationCarte;
}

export function CarteDesMagasins({
  magasins,
  selectionnee,
  depart,
  centreCommune = null,
  onSelectionner,
  ficheDuSelectionne,
  configuration,
}: CarteDesMagasinsProps) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  /** L'instance MapLibre, ou `null` avant le chargement du lot. */
  const carte = useRef<import("maplibre-gl").Map | null>(null);
  const [echec, setEchec] = useState<EchecCarte | null>(null);
  const [prete, setPrete] = useState(false);

  /*
   * ⚠️ LE RAPPEL VIT DANS UNE RÉFÉRENCE, ET CE N'EST PAS UN CONTOURNEMENT DE
   * RÈGLE. `onSelectionner` est recréé à chaque rendu du parent ; le mettre
   * dans les dépendances de l'effet des marqueurs reposerait les soixante
   * marqueurs à chaque frappe dans le champ ville. La référence garde toujours
   * la version courante, sans faire du rappel une dépendance.
   */
  const selection = useRef(onSelectionner);
  useEffect(() => {
    selection.current = onSelectionner;
  }, [onSelectionner]);

  /*
   * ⚠️ LA CONFIGURATION EST LUE UNE FOIS, HORS DE TOUT EFFET. Elle ne dépend
   * que de variables d'environnement remplacées à la compilation : la relire à
   * chaque rendu ne changerait jamais rien.
   */
  const config = configuration ?? configurationDepuisEnv();

  /*
   * ⚠️ EXTRAITE EN VARIABLE SIMPLE, pour que la dépendance de l'effet soit
   * vérifiable statiquement. `null` dit « pas de carte à construire », ce qui
   * couvre exactement les cas où `config.statut` n'est pas « prete ».
   */
  const urlDuStyle = config.statut === "prete" ? config.urlDuStyle : null;

  /* ── Le cycle de vie de la carte ────────────────────────────────────────── */
  useEffect(() => {
    if (urlDuStyle === null) return;
    const element = conteneur.current;
    if (element === null) return;

    let vivant = true;
    let instance: import("maplibre-gl").Map | null = null;

    /*
     * ⚠️ IMPORT NOMMÉ, PAS `module.default`. MapLibre 6 n'expose aucun export
     * par défaut : `module.default` est `undefined` à l'exécution et une erreur
     * de type à la compilation. Les classes se prennent par leur nom.
     */
    void import("maplibre-gl")
      .then(({ Map: CarteGL, getWorkerUrl, setWorkerUrl }) => {
        if (!vivant) return;
        /*
         * ════════════════════════════════════════════════════════════════
         * ⚠️ L'URL DU WORKER EST IMPOSÉE, PARCE QUE CELLE QUE MAPLIBRE
         * DÉDUIT EST FAUSSE DANS NEXT
         * ════════════════════════════════════════════════════════════════
         * MapLibre 6 déduit l'URL de son worker de `import.meta.url` :
         * « le fichier frère, à côté de moi ». Turbopack, lui, copie les
         * `.mjs` du paquet dans `/_next/static/media/` AVEC UNE EMPREINTE.
         * Le frère déduit n'existe donc pas :
         *
         *   déployé  …/maplibre-gl-worker.247mnn5i12bew.mjs  → 200
         *   déduit   …/maplibre-gl-worker.mjs                → 404
         *
         * Mesuré sur le build de ce dépôt. D'où, en console, autant de fois
         * qu'il y a de tentatives : « Worker failed to load. Check that the
         * worker URL is correct. » — et une carte qui ne s'affiche jamais.
         *
         * ⚠️ CE N'ÉTAIT PAS LA CSP. Le fichier est bien déployé, et la
         * politique de ce site n'est qu'en `Report-Only` sur les pages :
         * rien n'était bloqué. L'URL était simplement fausse.
         *
         * ⚠️ ET C'EST POSÉ ICI, PAS AU CHARGEMENT DU MODULE. `setWorkerUrl`
         * écrit dans un état global de MapLibre ; le faire au moment où l'on
         * va construire la carte garantit que c'est fait avant, sans rien
         * exécuter sur les écrans qui n'ouvrent jamais de carte.
         */
        if (getWorkerUrl() !== WORKER_MAPLIBRE_URL) setWorkerUrl(WORKER_MAPLIBRE_URL);
        /*
         * ⚠️ WEBGL N'EST PAS GARANTI. Navigateur ancien, accélération
         * matérielle coupée, machine virtuelle : le constructeur lève. Sans ce
         * `try`, l'écran entier tomberait pour une carte décorative.
         */
        try {
          instance = new CarteGL({
            container: element,
            style: urlDuStyle,
            center: [2.3522, 48.8566],
            zoom: 5,
            // ⚠️ L'ATTRIBUTION EST OBLIGATOIRE ET NON REPLIABLE. Le fond
            // porte son propre crédit (OpenFreeMap · OpenMapTiles · données
            // OpenStreetMap) et MapLibre l'affiche de lui-même : il reste à ne
            // pas le replier derrière un bouton.
            attributionControl: { compact: false },
            // ⚠️ SUR TÉLÉPHONE, UN DOIGT FAIT DÉFILER LA PAGE, PAS LA CARTE.
            // Sans cela, l'élève qui veut descendre dans la liste reste
            // prisonnier de la carte.
            cooperativeGestures: true,
          });
        } catch (erreur) {
          // ⚠️ L'EXCEPTION EST DITE, PAS AVALÉE. Sans elle, « ton navigateur
          // n'arrive pas à afficher la carte » est un constat sans cause.
          console.error("[Carte] échec à la création de l'instance", {
            etape: "new Map",
            message: erreur instanceof Error ? erreur.message : String(erreur),
          });
          setEchec("webgl");
          return;
        }
        carte.current = instance;

        /*
         * ⚠️ CE DRAPEAU NE DÉCIDE PLUS À LUI SEUL, et c'est le correctif. Il
         * dit si la carte a UNE FOIS atteint l'état « chargée », ce qui ne
         * départage que le dernier cas du classement (voir
         * `classerErreurDeCarte`) : un sprite absent échoue AVANT `load` et
         * `load` arrive quand même — « avant load » ne veut donc pas dire
         * « fatal ».
         *
         * ⚠️ UN DRAPEAU LOCAL, PAS L'ÉTAT REACT : l'écouteur d'erreur est une
         * fermeture posée une seule fois, et `prete` y resterait éternellement
         * à la valeur du premier rendu.
         */
        let charge = false;
        instance.on("load", () => {
          charge = true;
          if (vivant) setPrete(true);
        });
        /*
         * ════════════════════════════════════════════════════════════════════
         * ⚠️ TOUTES LES ERREURS DE MAPLIBRE NE SONT PAS DES PANNES — ET LES
         * CONFONDRE ÉTAIT LA CAUSE DE LA CARTE ABSENTE EN PREVIEW
         * ════════════════════════════════════════════════════════════════════
         * MapLibre émet `error` pour TOUT ce qui échoue à se charger : une
         * tuile, un TileJSON, une planche de symboles. Ce sont des incidents de
         * ressource, et la carte se dessine autour.
         *
         * Or le repli basculait sur le MOINDRE `error`. Et le repli REMPLACE le
         * conteneur de la carte dans le rendu : le `<div>` référencé quittait
         * le DOM, l'instance restait derrière sans conteneur, et rien ne la
         * remontait jamais. Une requête ratée sur plusieurs centaines détruisait
         * définitivement une carte qui marchait.
         *
         * ⚠️ C'EST EXACTEMENT CE QUE MONTRAIT SAFARI : le cadre de secours
         * présent en 626 × 460, aucun `.maplibregl-map`, aucun canevas. Pas une
         * carte qui n'a jamais démarré — une carte démolie après coup.
         *
         * ⚠️ LE TRI N'EST PAS FAIT ICI, ET CE N'EST PAS UN DÉTAIL. Il vit dans
         * `classerErreurDeCarte`, fonction pure : la règle repose sur les
         * propriétés RÉELLEMENT exposées par l'événement — relevées une à une
         * dans un navigateur — et elle se teste avec ces formes exactes, ce
         * qu'un écouteur enfermé dans un composant WebGL ne permet pas.
         */
        instance.on("error", (evenement: unknown) => {
          if (!vivant) return;
          /*
           * ════════════════════════════════════════════════════════════════
           * ⚠️ L'ERREUR D'ORIGINE N'EST JAMAIS MASQUÉE
           * ════════════════════════════════════════════════════════════════
           * L'écran bascule sur un cadre de secours, et c'est voulu : une
           * carte grise sans explication se lit comme un bogue. Mais ce
           * basculement effaçait la seule trace du POURQUOI — et l'on
           * cherchait ensuite la panne dans le worker, dans la CSP, partout
           * sauf là où elle était.
           *
           * On journalise donc l'étape, le statut HTTP et l'URL fautive.
           * ⚠️ ET C'EST SANS DANGER DEPUIS LA MIGRATION : il n'y a plus de
           * clé dans les URL de ce fournisseur. Avec une clé, cette trace
           * aurait publié un secret dans la console de chaque élève.
           */
          const analyse = classerErreurDeCarte({ evenement, urlDuStyle, chargee: charge });
          const fatal = analyse.issue !== "ressource";
          console.error("[Carte] erreur du fond de carte", {
            // ⚠️ L'ÉTAPE DISTINGUE LES DEUX CAS, dans la console comme dans le
            // code : « style » = le document de style lui-même a échoué ;
            // « ressource » = un objet secondaire a manqué.
            etape: fatal ? "style" : "ressource",
            fatal,
            issue: analyse.issue,
            statut: analyse.statut,
            url: analyse.url,
            sourceId: analyse.sourceId,
            message: analyse.message,
          });
          /*
           * ⚠️ UNE TUILE MANQUANTE N'EST PAS UNE PANNE DE CARTE. La trace est
           * écrite — on ne masque rien — mais l'écran ne bascule pas : la carte
           * reste affichée, et le trou se remplira au prochain déplacement.
           * Cela vaut AVANT comme APRÈS le premier `load`.
           */
          if (analyse.issue === "ressource") return;
          /*
           * ⚠️ CE TYPAGE EST UN CONTRÔLE, PAS UNE CÉRÉMONIE. Il relie les
           * issues fatales du classement aux états d'échec de l'écran : en
           * ajouter une d'un côté sans l'autre ne compile pas.
           */
          const echecFatal: EchecCarte = analyse.issue;
          /*
           * ⚠️ ET SI L'ÉCRAN BASCULE, L'INSTANCE EST DÉTRUITE AVEC LUI. Le
           * repli remplace le conteneur : laisser l'instance derrière
           * abandonnerait un contexte WebGL et un worker vivants, sans aucun
           * moyen de les récupérer.
           */
          const aDetruire = instance;
          instance = null;
          carte.current = null;
          try {
            aDetruire?.remove();
          } catch {
            // Déjà détruite : il n'y a rien à faire, et insister ferait tomber
            // le rendu de secours pour rien.
          }
          /*
           * ⚠️ UN REFUS DE L'AMONT N'EST PAS UNE PANNE PASSAGÈRE. « Le fond de
           * carte est momentanément indisponible » envoie attendre une panne
           * qui n'existe pas. Mais ce refus ne se lit QUE sur la requête du
           * style : un 404 de tuile n'est pas un refus, et le classement l'a
           * déjà écarté plus haut.
           */
          setEchec((actuel) => actuel ?? echecFatal);
        });
      })
      .catch((erreur: unknown) => {
        // Le lot n'a pas pu être téléchargé : réseau coupé, ou blocage.
        console.error("[Carte] échec au chargement du module MapLibre", {
          etape: "import",
          message: erreur instanceof Error ? erreur.message : String(erreur),
        });
        if (vivant) setEchec("chargement");
      });

    return () => {
      vivant = false;
      /*
       * ⚠️ `instance` PEUT DÉJÀ ÊTRE `null` : l'écouteur d'erreur détruit la
       * carte lui-même quand il bascule sur le repli. Le `try` couvre le reste,
       * car un démontage qui lève ferait tomber l'écran entier.
       */
      try {
        instance?.remove();
      } catch {
        // Déjà détruite ; il n'y a plus rien à détacher.
      }
      instance = null;
      carte.current = null;
      setPrete(false);
    };
  }, [urlDuStyle]);

  /* ── Les commerces : une source qui regroupe, et non des marqueurs ────── */
  useEffect(() => {
    const instance = carte.current;
    if (!prete || instance === null) return;
    let vivant = true;
    let marqueurDepart: import("maplibre-gl").Marker | null = null;
    /** Les écouteurs posés, pour pouvoir les retirer un par un au démontage. */
    const ecouteurs: { couche: string; type: string; f: (e: never) => void }[] = [];

    void import("maplibre-gl").then(({ Marker }) => {
      if (!vivant || carte.current === null) return;

      /*
       * ⚠️ LES JETONS SONT RÉSOLUS ICI, PAS AU CHARGEMENT DU MODULE. Lus sur
       * le conteneur de la carte, ils suivent le thème effectif — et ils sont
       * relus à chaque passage de cet effet, pour qu'un changement de thème
       * repeigne les pastilles au lieu de les laisser à l'ancienne couleur.
       */
      const racine = instance.getContainer();
      const NEUTRE = couleurDuJeton(racine, JETON_NEUTRE, REPLI_NEUTRE);
      const CHOISI = couleurDuJeton(racine, JETON_CHOISI, REPLI_CHOISI);
      const CONTOUR = couleurDuJeton(racine, JETON_CONTOUR, REPLI_CONTOUR);

      /*
       * ════════════════════════════════════════════════════════════════════
       * ⚠️ UNE SOURCE, PAS SOIXANTE MARQUEURS — ET LE REGROUPEMENT VIENT AVEC
       * ════════════════════════════════════════════════════════════════════
       * Chaque commerce était un élément du DOM, créé puis retiré à chaque
       * changement de sélection : soixante éléments recréés au moindre clic,
       * et un oubli de nettoyage suffisait à les empiler en double.
       *
       * Une source GeoJSON renverse le problème. On lui DONNE la liste, elle
       * s'occupe du reste : il ne peut pas y avoir de doublon, parce qu'il n'y
       * a pas d'accumulation — `setData` remplace. Et c'est elle qui sait
       * regrouper les points qui se chevauchent, ce qu'aucun marqueur DOM ne
       * sait faire.
       *
       * ⚠️ `clusterMaxZoom: 13` — AU-DELÀ, PLUS AUCUN AMAS. C'est la règle
       * demandée : au zoom rapproché, chaque commerce redevient choisissable.
       * `clusterRadius: 44` est un peu plus large que le rayon d'un doigt :
       * en dessous, deux pastilles se touchent sans fusionner et l'on vise
       * l'une pour atteindre l'autre.
       */
      if (instance.getSource(SOURCE) === undefined) {
        instance.addSource(SOURCE, {
          type: "geojson",
          data: collectionDeMagasins(magasins) as never,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 44,
        });

        instance.addLayer({
          id: COUCHE_AMAS,
          type: "circle",
          source: SOURCE,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": NEUTRE,
            "circle-opacity": 0.92,
            // Trois paliers : deux commerces et douze ne méritent pas la
            // même pastille, mais une échelle continue les rendrait toutes
            // semblables.
            "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 15, 26],
            "circle-stroke-width": 2,
            "circle-stroke-color": CONTOUR,
          },
        });

        /*
         * ⚠️ LE NOMBRE N'EST AJOUTÉ QUE SI LE STYLE SAIT DESSINER DU TEXTE.
         * Une couche `symbol` exige des glyphes, que le style déclare par son
         * entrée `glyphs`. Sur un style qui n'en a pas, MapLibre émet une
         * erreur par amas et n'affiche rien — notre écouteur d'erreur
         * basculerait alors l'écran sur « fond de carte indisponible » pour
         * un simple chiffre manquant. Les pastilles restent lisibles sans,
         * puisque leur taille dit déjà la densité.
         */
        if (typeof instance.getStyle()?.glyphs === "string") {
          instance.addLayer({
            id: COUCHE_AMAS_NOMBRE,
            type: "symbol",
            source: SOURCE,
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              /*
               * ⚠️ UNE SEULE POLICE, ET CE N'EST PAS UN APPAUVRISSEMENT.
               * MapLibre ne demande pas les polices une par une : il assemble
               * la liste en UN SEUL nom de pile, séparé par des virgules —
               * `…/fonts/Noto Sans Regular,Open Sans Regular/0-255.pbf`. Le
               * serveur de polices ne sert que les piles simples :
               *
               *     Noto Sans Regular                     → 200, 76 580 o
               *     Noto Sans Regular,Open Sans Regular   → 404
               *
               * Mesuré dans Chromium : avec deux noms, 404 à chaque plage, et
               * MapLibre se rabattait sur un rendu local approximatif des
               * chiffres. Avec le seul nom que le fournisseur sert, les
               * glyphes arrivent et le compteur est net.
               */
              "text-font": ["Noto Sans Regular"],
              "text-size": 13,
              "text-allow-overlap": true,
            },
            paint: { "text-color": CONTOUR },
          });
        }

        // Les commerces isolés : neutres.
        instance.addLayer({
          id: COUCHE_POINT,
          type: "circle",
          source: SOURCE,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": NEUTRE,
            "circle-radius": 9,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": CONTOUR,
          },
        });

        /*
         * ⚠️ LE COMMERCE CHOISI A SA PROPRE COUCHE, AU-DESSUS DES AUTRES.
         * Le colorer dans la couche précédente par une expression suffirait à
         * le teinter, mais pas à le faire passer devant : deux pastilles qui
         * se chevauchent cacheraient justement celle qu'on vient de choisir.
         */
        instance.addLayer({
          id: COUCHE_CHOISI,
          type: "circle",
          source: SOURCE,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "cle"], ""]],
          paint: {
            "circle-color": CHOISI,
            "circle-radius": 13,
            "circle-stroke-width": 3,
            "circle-stroke-color": CONTOUR,
          },
        });

        const surPoint = (evenement: {
          features?: { properties?: { cle?: unknown } }[];
        }) => {
          const cle = evenement.features?.[0]?.properties?.cle;
          if (typeof cle === "string" && cle !== "") selection.current(cle);
        };
        const surAmas = (evenement: {
          features?: { properties?: { cluster_id?: unknown } }[];
          lngLat?: { lng: number; lat: number };
        }) => {
          /*
           * ⚠️ UN AMAS SE DÉPLIE, IL NE SE CHOISIT PAS. On demande à la source
           * le zoom auquel il éclate, et on y va : c'est le seul geste qui
           * ait un sens, et il mène toujours quelque part — contrairement à
           * un zoom fixe, qui laisserait parfois l'amas intact.
           */
          const id = evenement.features?.[0]?.properties?.cluster_id;
          const centre = evenement.lngLat;
          if (typeof id !== "number" || centre === undefined) return;
          const source = instance.getSource(SOURCE) as unknown as {
            getClusterExpansionZoom?: (id: number) => Promise<number>;
          };
          void source
            .getClusterExpansionZoom?.(id)
            .then((zoom) => {
              if (vivant) instance.easeTo({ center: centre, zoom, duration: 420 });
            })
            .catch(() => {
              // Un amas qui refuse de dire son zoom : on s'approche quand même.
              if (vivant) instance.easeTo({ center: centre, zoom: instance.getZoom() + 2, duration: 420 });
            });
        };
        const mainOuverte = () => {
          instance.getCanvas().style.cursor = "pointer";
        };
        const mainFermee = () => {
          instance.getCanvas().style.cursor = "";
        };

        for (const [couche, type, f] of [
          [COUCHE_POINT, "click", surPoint],
          [COUCHE_CHOISI, "click", surPoint],
          [COUCHE_AMAS, "click", surAmas],
          [COUCHE_POINT, "mouseenter", mainOuverte],
          [COUCHE_AMAS, "mouseenter", mainOuverte],
          [COUCHE_POINT, "mouseleave", mainFermee],
          [COUCHE_AMAS, "mouseleave", mainFermee],
        ] as const) {
          instance.on(type as never, couche, f as never);
          ecouteurs.push({ couche, type, f: f as never });
        }
      } else {
        // ⚠️ MISE À JOUR, PAS RECONSTRUCTION. C'est ce qui rend les doublons
        // impossibles : la source est remplacée, jamais complétée.
        const source = instance.getSource(SOURCE) as unknown as {
          setData: (d: unknown) => void;
        };
        source.setData(collectionDeMagasins(magasins));
        /*
         * ⚠️ ET ON REPEINT, parce que le thème a pu changer depuis que les
         * couches ont été posées. Sans cela, passer en mode sombre laisserait
         * des pastilles de la palette claire sur un fond sombre.
         */
        for (const [couche, propriete, couleur] of [
          [COUCHE_AMAS, "circle-color", NEUTRE],
          [COUCHE_AMAS, "circle-stroke-color", CONTOUR],
          [COUCHE_POINT, "circle-color", NEUTRE],
          [COUCHE_POINT, "circle-stroke-color", CONTOUR],
          [COUCHE_CHOISI, "circle-color", CHOISI],
          [COUCHE_CHOISI, "circle-stroke-color", CONTOUR],
          [COUCHE_AMAS_NOMBRE, "text-color", CONTOUR],
        ] as const) {
          if (instance.getLayer(couche) !== undefined) {
            instance.setPaintProperty(couche, propriete, couleur);
          }
        }
      }

      // La mise en évidence du choisi, par filtre — aucun marqueur recréé.
      if (instance.getLayer(COUCHE_CHOISI) !== undefined) {
        instance.setFilter(COUCHE_CHOISI, [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "cle"], selectionnee ?? ""],
        ] as never);
      }

      // La position de l'élève reste un marqueur DOM : il n'y en a qu'un, et
      // c'est un disque, pas une goutte — on ne le confond pas avec un
      // commerce (voir `elementDeDepart`).
      if (depart !== null) {
        marqueurDepart = new Marker({ element: elementDeDepart(), anchor: "center" })
          .setLngLat([depart.lon, depart.lat])
          .addTo(instance);
      }

      /*
       * ⚠️ LE CADRAGE SE FAIT SUR LES RÉSULTATS, PAS SUR UN CENTRE DE VILLE.
       * `cadreDeLaRecherche` est pur et testé : voir
       * `lib/cartographie/vue-magasins.ts` pour la raison.
       */
      const cadre = cadreDeLaRecherche(magasins, depart, centreCommune);
      if (cadre !== null) {
        instance.fitBounds(
          [
            [cadre.sudOuest.lon, cadre.sudOuest.lat],
            [cadre.nordEst.lon, cadre.nordEst.lat],
          ],
          { padding: 48, maxZoom: 16, duration: 0 },
        );
      }
    });

    return () => {
      vivant = false;
      marqueurDepart?.remove();
      /*
       * ⚠️ LES ÉCOUTEURS SONT RETIRÉS UN PAR UN, ET LES COUCHES AVANT LA
       * SOURCE. `map.remove()` nettoierait tout, mais ce nettoyage-ci tourne
       * AUSSI quand seule la liste change : sans lui, chaque recherche
       * ajouterait une nouvelle paire d'écouteurs sur les mêmes couches, et
       * un clic finirait par sélectionner sept fois.
       */
      const instance = carte.current;
      if (instance === null) return;
      for (const { couche, type, f } of ecouteurs) {
        try {
          instance.off(type as never, couche, f as never);
        } catch {
          // La carte peut déjà être détruite : il n'y a alors plus rien à
          // détacher, et insister ferait tomber le démontage.
        }
      }
    };
  }, [prete, magasins, selectionnee, depart, centreCommune]);

  /* ── Le recentrage sur le commerce choisi ──────────────────────────────── */
  useEffect(() => {
    const instance = carte.current;
    if (!prete || instance === null || selectionnee === null) return;
    const choisi = magasins.find((m) => cleIdentiteOsm(m) === selectionnee);
    if (choisi === undefined || !coordonneesFiables(choisi)) return;
    /*
     * ⚠️ « PROGRESSIVEMENT », ET SANS DÉZOOMER. `easeTo` glisse jusqu'au
     * commerce ; `Math.max` garde le zoom courant s'il est déjà plus
     * rapproché, pour ne pas reculer sous les pieds de quelqu'un qui venait
     * d'aller voir de près.
     */
    instance.easeTo({
      center: [choisi.lon, choisi.lat],
      zoom: Math.max(instance.getZoom(), 14),
      duration: 520,
    });
  }, [prete, selectionnee, magasins]);

  /* ── Les états d'affichage ──────────────────────────────────────────────── */

  /*
   * ⚠️ TROIS CAUSES, TROIS MESSAGES, ET SURTOUT PAS UN SEUL.
   *
   * « Le fond de carte est mal configuré », « la carte n'a pas pu se charger »
   * et « il n'y a aucun point à montrer » sont trois choses sans rapport, et
   * les confondre envoie chercher le problème au mauvais endroit : on irait
   * vérifier une variable d'environnement alors que c'est la recherche qui n'a
   * rien rendu, ou l'inverse.
   *
   * L'ordre compte aussi : si le fond est refusé, la question des coordonnées
   * ne se pose même pas.
   *
   * ⚠️ ET CE RENDU-CI REMPLACE LE CONTENEUR DE LA CARTE. C'est pour cela que
   * seul un échec FATAL peut y mener, et que l'instance est détruite avant —
   * voir l'écouteur `error`. Un repli déclenché par une tuile manquante
   * démolissait une carte qui fonctionnait.
   */
  if (config.statut === "indisponible") {
    return <CadreMessage texte={messageCarteIndisponible(config.raison)} />;
  }
  if (echec !== null) {
    return <CadreMessage texte={messageEchec(echec)} />;
  }
  if (cadreDeLaRecherche(magasins, depart, centreCommune) === null) {
    return (
      <CadreMessage texte="Rien à afficher sur la carte pour l'instant : lance une recherche pour voir les commerces." />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-card border border-border bg-card">
      {/*
        ⚠️ HAUTEUR EXPLICITE, ET EN `min-h`. Un conteneur de hauteur nulle fait
        que MapLibre s'initialise sur 0 pixel : la carte « ne s'affiche pas »
        sans aucune erreur, ce qui est le plus pénible des défauts à trouver.
      */}
      <div
        ref={conteneur}
        className="h-[320px] min-h-[320px] w-full sm:h-[460px] sm:min-h-[460px]"
        // ⚠️ `aria-hidden` : une carte en WebGL n'est pas lisible par un
        // lecteur d'écran. La LISTE est le chemin accessible, et elle existe
        // toujours à côté — la carte ne remplace jamais la liste.
        aria-hidden="true"
      />
      {!prete && (
        <p
          className="absolute inset-x-0 bottom-0 bg-card/90 px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          Chargement de la carte…
        </p>
      )}
      {ficheDuSelectionne !== undefined && ficheDuSelectionne !== null && (
        <div className="absolute inset-x-2 bottom-2 sm:inset-x-3 sm:bottom-3">{ficheDuSelectionne}</div>
      )}
    </div>
  );
}

function messageEchec(echec: EchecCarte): string {
  switch (echec) {
    case "webgl":
      return "Ton navigateur n'arrive pas à afficher la carte. La liste des commerces reste utilisable.";
    case "chargement":
      return "La carte n'a pas pu être téléchargée. La liste des commerces reste utilisable.";
    case "style":
      return "Le fond de carte est momentanément indisponible. La liste des commerces reste utilisable.";
    case "refus_amont":
      /*
       * ⚠️ CE MESSAGE S'ADRESSE À L'ÉLÈVE, PAS À L'ADMINISTRATEUR. Il ne
       * nomme ni le fournisseur, ni l'URL : ce sont des détails de notre
       * installation, et les afficher ne l'aiderait en rien. Le diagnostic
       * précis, lui, est dans la console — voir le gestionnaire d'erreur.
       */
      return "Le fond de carte a été refusé. La liste des commerces reste utilisable.";
  }
}

/**
 * ⚠️ UN CADRE QUI EXPLIQUE, PAS UN CADRE GRIS. Et il garde la même place que la
 * carte, pour que l'écran ne saute pas quand la carte échoue après coup.
 */
function CadreMessage({ texte }: { readonly texte: string }) {
  return (
    <div
      className="flex h-[320px] min-h-[320px] items-center justify-center rounded-card border border-border bg-card px-6 text-center text-sm text-muted-foreground sm:h-[460px] sm:min-h-[460px]"
      role="status"
    >
      {texte}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LES MARQUEURS PERSONNALISÉS
   ══════════════════════════════════════════════════════════════════════════ */

/*
 * ⚠️ `elementDeMarqueur` A ÉTÉ RETIRÉ, ET C'EST LE CŒUR DE CETTE REFONTE.
 *
 * Il fabriquait un bouton SVG par commerce. Soixante éléments du DOM, recréés
 * à chaque changement de sélection, et un oubli de nettoyage suffisait à les
 * empiler. Surtout : des marqueurs DOM ne savent pas se regrouper quand ils se
 * chevauchent, et c'est précisément ce qu'il fallait.
 *
 * Les commerces sont maintenant des entités d'une source GeoJSON, dessinées
 * par des couches `circle` — et c'est la source qui regroupe.
 *
 * ⚠️ LE MARQUEUR DE L'ÉLÈVE, LUI, RESTE UN ÉLÉMENT DU DOM. Il n'y en a qu'un,
 * il ne se regroupe avec rien, et il doit être visuellement d'une autre
 * nature qu'un commerce : un disque, pas une pastille.
 */

/**
 * Le marqueur de la position de l'élève.
 *
 * ⚠️ VISUELLEMENT DISTINCT D'UN COMMERCE, et pas seulement d'une autre
 * couleur : c'est un disque, pas une goutte. Un élève qui confond sa position
 * avec un magasin se déplace pour rien.
 */
function elementDeDepart(): HTMLElement {
  const point = document.createElement("div");
  point.setAttribute("aria-hidden", "true");
  point.style.width = "16px";
  point.style.height = "16px";
  point.style.borderRadius = "9999px";
  point.style.background = "var(--info, #60a5fa)";
  point.style.border = "3px solid var(--card)";
  point.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.25)";
  return point;
}
