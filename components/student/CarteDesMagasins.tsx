"use client";

import { useEffect, useRef, useState } from "react";

import {
  configurationDepuisEnv,
  messageCarteIndisponible,
  type ConfigurationCarte,
} from "@/lib/cartographie/maptiler";
import {
  cadreDeLaRecherche,
  marqueursDepuisMagasins,
  type Marqueur,
  type Point,
} from "@/lib/cartographie/vue-magasins";
import type { MagasinOsm } from "@/lib/nutrition/magasins-osm";

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

/** Ce que la carte peut ne pas réussir à faire, après que la clé a été jugée bonne. */
type EchecCarte = "webgl" | "chargement" | "style";

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
      .then(({ Map: CarteGL }) => {
        if (!vivant) return;
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
            // ⚠️ L'ATTRIBUTION EST OBLIGATOIRE ET NON REPLIABLE : MapTiler
            // comme OpenStreetMap exigent un crédit visible et cliquable.
            attributionControl: { compact: false },
            // ⚠️ SUR TÉLÉPHONE, UN DOIGT FAIT DÉFILER LA PAGE, PAS LA CARTE.
            // Sans cela, l'élève qui veut descendre dans la liste reste
            // prisonnier de la carte.
            cooperativeGestures: true,
          });
        } catch {
          setEchec("webgl");
          return;
        }
        carte.current = instance;

        instance.on("load", () => {
          if (vivant) setPrete(true);
        });
        /*
         * ⚠️ UNE ERREUR DE CARTE NE DOIT PAS ÊTRE SILENCIEUSE. Clé révoquée,
         * quota dépassé, fournisseur en panne : MapLibre émet `error` et laisse
         * un cadre gris. Un cadre gris sans explication se lit comme un bogue
         * de la plateforme.
         */
        instance.on("error", () => {
          if (vivant) setEchec((actuel) => actuel ?? "style");
        });
      })
      .catch(() => {
        // Le lot n'a pas pu être téléchargé : réseau coupé, ou blocage.
        if (vivant) setEchec("chargement");
      });

    return () => {
      vivant = false;
      instance?.remove();
      carte.current = null;
      setPrete(false);
    };
  }, [urlDuStyle]);

  /* ── Les marqueurs, et le cadrage ───────────────────────────────────────── */
  useEffect(() => {
    const instance = carte.current;
    if (!prete || instance === null) return;
    let vivant = true;
    let poses: import("maplibre-gl").Marker[] = [];

    void import("maplibre-gl").then(({ Marker }) => {
      if (!vivant) return;

      for (const marqueur of marqueursDepuisMagasins(magasins, selectionnee)) {
        const element = elementDeMarqueur(marqueur);
        element.addEventListener("click", (evenement) => {
          // ⚠️ `stopPropagation` : sans lui, MapLibre traite aussi le clic
          // comme un clic sur la carte et la fiche se referme aussitôt.
          evenement.stopPropagation();
          selection.current(marqueur.cle);
        });
        poses.push(new Marker({ element, anchor: "bottom" }).setLngLat([marqueur.lon, marqueur.lat]).addTo(instance));
      }

      if (depart !== null) {
        poses.push(
          new Marker({ element: elementDeDepart(), anchor: "center" })
            .setLngLat([depart.lon, depart.lat])
            .addTo(instance),
        );
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
      for (const pose of poses) pose.remove();
      poses = [];
    };
  }, [prete, magasins, selectionnee, depart, centreCommune]);

  /* ── Les états d'affichage ──────────────────────────────────────────────── */

  /*
   * ⚠️ TROIS CAUSES, TROIS MESSAGES, ET SURTOUT PAS UN SEUL.
   *
   * « Pas de clé cartographique » et « pas de coordonnées à montrer » sont
   * deux choses sans rapport, et les confondre envoie chercher le problème au
   * mauvais endroit : on irait vérifier une variable d'environnement alors que
   * c'est la recherche qui n'a rien rendu, ou l'inverse. L'ordre compte aussi —
   * sans clé, la question des coordonnées ne se pose même pas.
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

/**
 * Le marqueur d'un commerce.
 *
 * ⚠️ CONSTRUIT EN DOM, PAS EN JSX, parce que MapLibre attend un `HTMLElement`
 * et non un nœud React. Le rendre avec React dans un portail marcherait aussi,
 * et ajouterait un portail par marqueur — soixante portails pour soixante
 * commerces.
 *
 * ⚠️ LES COULEURS SONT CELLES DU THÈME, lues dans les variables CSS du projet.
 * Les écrire en dur ici donnerait deux palettes qui divergeraient au premier
 * changement de thème.
 */
function elementDeMarqueur(marqueur: Marqueur): HTMLElement {
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.setAttribute("aria-label", marqueur.nom);
  bouton.title = marqueur.marque === null ? marqueur.nom : `${marqueur.nom} — ${marqueur.marque}`;
  bouton.style.cursor = "pointer";
  bouton.style.background = "none";
  bouton.style.border = "none";
  bouton.style.padding = "0";
  bouton.style.lineHeight = "0";
  // ⚠️ LE SÉLECTIONNÉ EST PLUS GRAND ET AU-DESSUS. Une simple différence de
  // couleur disparaît quand deux marqueurs se chevauchent.
  bouton.style.zIndex = marqueur.selectionne ? "2" : "1";

  const taille = marqueur.selectionne ? 38 : 28;
  const remplissage = marqueur.selectionne ? "var(--success)" : "var(--primary)";
  const contour = marqueur.selectionne ? "var(--card)" : "var(--card)";
  bouton.innerHTML = [
    `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" aria-hidden="true">`,
    `<path d="M12 23s8-8.2 8-13.6A8 8 0 1 0 4 9.4C4 14.8 12 23 12 23z"`,
    ` fill="${remplissage}" stroke="${contour}" stroke-width="1.8"/>`,
    `<circle cx="12" cy="9.4" r="2.8" fill="${contour}"/>`,
    `</svg>`,
  ].join("");
  return bouton;
}

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
