"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, MapPin, Navigation, Search, Store } from "lucide-react";

import { CarteDesMagasins } from "@/components/student/CarteDesMagasins";
/*
 * ⚠️ L'INDICATEUR DU DÉPÔT, PAS UN CERCLE ÉCRIT POUR L'OCCASION.
 * `components/ui/Loader.tsx` porte une doctrine explicite : « un spinner
 * générique ne dit rien », l'attente est habitée par l'emblème du site. Il
 * gère déjà `role="status"`, `aria-live`, le libellé lu à voix haute et
 * l'arrêt du mouvement sous `prefers-reduced-motion`. En écrire un second
 * ici donnerait deux indicateurs qui divergeraient au premier ajustement.
 */
import { Loader } from "@/components/ui/Loader";
import { urlItineraire, type Point } from "@/lib/cartographie/vue-magasins";
import { ANTI_RAFALE_MS, SAISIE_MIN } from "@/lib/communes/bornes";
import { cleIdentiteOsm, marqueAAfficher, type MagasinOsm } from "@/lib/nutrition/magasins-osm";
import {
  MODES,
  RAYONS_PROPOSES,
  RAYON_KM_DEFAUT,
  enChargement,
  issueDeGeolocalisation,
  libelleDuBouton,
  libelleDuRayon,
  messageHorsBouton,
  rayonUtilisable,
  resumeDeLaRecherche,
  situationApres,
  type ModeRecherche,
  type Situation,
} from "@/lib/nutrition/recherche-commerces";

/**
 * COURSES — LA RECHERCHE DE COMMERCES : LA LISTE ET LA CARTE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE MOTEUR DE RECHERCHE ET LE FOND DE CARTE NE SE CONNAISSENT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * Ce composant parle à TROIS routes de NOTRE serveur, et à aucun service
 * extérieur :
 *   · `/api/student/stores/communes` — résout une saisie en communes nommées ;
 *   · `/api/student/stores/search`   — les commerces d'une commune (code INSEE) ;
 *   · `/api/student/stores/nearby`   — les commerces autour d'une position.
 *
 * `CarteDesMagasins` reçoit la liste DÉJÀ TROUVÉE et la dessine. Elle ne fait
 * aucun appel, ne connaît aucune route, et ne sait pas ce qu'est une commune.
 * Si le fournisseur de fonds de carte disparaît, la recherche continue : c'est
 * la raison de cette séparation, pas une élégance.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE REQUÊTE À CHAQUE CARACTÈRE
 * ════════════════════════════════════════════════════════════════════════════
 * La saisie passe par un ANTI-RAFALE (`ANTI_RAFALE_MS`) : taper « Marseille »
 * déclenche UN appel, pas neuf. Et l'appel n'a lieu qu'à partir de deux
 * lettres — en dessous, l'annuaire rendrait des milliers de communes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LA POSITION DE L'ÉLÈVE, ET CE QUI A CHANGÉ
 * ════════════════════════════════════════════════════════════════════════════
 * Jusqu'ici elle était lue, postée, et perdue dans la même fonction. La carte
 * oblige à la GARDER le temps de l'afficher : sans elle, impossible de centrer
 * sur l'élève ni de dire quels commerces sont de son côté.
 *
 * Elle vit donc dans un état React, et NULLE PART AILLEURS : aucun
 * `localStorage`, aucun `sessionStorage`, aucun cookie, aucune URL, aucune
 * colonne. Elle disparaît au démontage et au changement de mode. Ce qui est
 * enregistré, c'est le magasin choisi — l'adresse d'un commerce, pas celle de
 * quelqu'un.
 *
 * ⚠️ ET LE FOURNISSEUR DE TUILES VOIT LA ZONE REGARDÉE. C'est inévitable pour
 * toute carte : les tuiles sont demandées par le navigateur. Le détail est
 * écrit dans `CarteDesMagasins`, pour que ce soit un choix et non une surprise.
 */

interface CommuneSuggeree {
  readonly code: string;
  readonly nom: string;
  readonly codePostal: string | null;
  readonly departement: string;
  /** Le centre officiel : c'est lui qui centre la carte SANS GPS. */
  readonly centre: { readonly lat: number; readonly lon: number } | null;
}

/** Le délai laissé au navigateur pour produire une position. */
const DELAI_POSITION_MS = 10_000;

export function RechercheDeCommerces({
  onChoisir,
  choixEnCours,
}: {
  /** Appelé quand l'élève retient un commerce. Le parent écrit, pas nous. */
  readonly onChoisir: (magasin: MagasinOsm) => void;
  /** L'identité OSM en cours d'enregistrement, ou `null`. */
  readonly choixEnCours: string | null;
}) {
  const [mode, setMode] = useState<ModeRecherche>("autour");
  const [situation, setSituation] = useState<Situation>("repos");
  const [magasins, setMagasins] = useState<readonly MagasinOsm[]>([]);
  const [tronque, setTronque] = useState(false);
  const [rayonKm, setRayonKm] = useState(RAYON_KM_DEFAUT);
  const [depart, setDepart] = useState<Point | null>(null);
  /**
   * Le centre de la commune cherchée — la source de centrage du mode « ville ».
   *
   * ⚠️ IL N'EST PAS UN REPLI DE LA POSITION GPS, ET RÉCIPROQUEMENT. Chaque mode
   * a sa propre source, et aucun n'emprunte celle de l'autre : utiliser la
   * position de l'élève pour centrer une recherche « par ville » montrerait
   * une carte de là où il est, pas de là où il cherche.
   */
  const [centreCommune, setCentreCommune] = useState<Point | null>(null);
  const [selectionnee, setSelectionnee] = useState<string | null>(null);
  /** Sur téléphone seulement : la carte ou la liste. Sur ordinateur, les deux. */
  const [ongletMobile, setOngletMobile] = useState<"liste" | "carte">("liste");

  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<readonly CommuneSuggeree[]>([]);
  const [communeChoisie, setCommuneChoisie] = useState<CommuneSuggeree | null>(null);
  const [annuaireMuet, setAnnuaireMuet] = useState(false);

  /** Garde de double tap : deux appuis rapprochés partiraient tous les deux. */
  const enVol = useRef(false);
  /**
   * La recherche en vol, pour pouvoir l'ANNULER quand une nouvelle la remplace.
   *
   * ⚠️ LE VERROU NE SUFFIT PAS, ET LES DEUX SE COMPLÈTENT. Le verrou empêche
   * deux recherches de partir ensemble ; celui-ci coupe une recherche devenue
   * sans objet — l'élève a changé de rayon, de commune, ou de mode. Sans lui,
   * la réponse de l'ANCIENNE recherche pourrait arriver après la nouvelle et
   * écraser ses résultats : l'élève verrait les commerces d'une autre commune.
   */
  const recherche = useRef<AbortController | null>(null);

  useEffect(() => {
    // Au démontage, rien ne doit continuer à tourner pour un écran fermé.
    return () => {
      recherche.current?.abort();
    };
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     LES SUGGESTIONS DE COMMUNES — AVEC ANTI-RAFALE
     ══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    const texte = saisie.trim();
    if (mode !== "ville" || texte.length < SAISIE_MIN || communeChoisie !== null) {
      return;
    }
    const controleur = new AbortController();
    /*
     * ⚠️ LE MINUTEUR EST ANNULÉ À CHAQUE FRAPPE, ET C'EST TOUT L'ANTI-RAFALE.
     * Chaque caractère reprogramme l'appel ; seul le dernier survit assez
     * longtemps pour partir.
     */
    const minuteur = setTimeout(() => {
      // ⚠️ L'ÉTAT DE CHARGEMENT EST POSÉ ICI, PAS AU DÉBUT DE L'EFFET. Le
      // poser dès la frappe ferait clignoter l'écran à chaque caractère, pour
      // un appel qui ne part pas encore.
      setSituation((actuelle) => (actuelle === "repos" ? "chargement_commune" : actuelle));
      void fetch("/api/student/stores/communes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saisie: texte }),
        signal: controleur.signal,
      })
        .then(async (reponse) => {
          if (!reponse.ok) {
            // ⚠️ L'ANNUAIRE MUET N'EST PAS UNE PANNE DE LA RECHERCHE. L'élève
            // doit pouvoir valider son nom de ville au clavier malgré tout.
            setAnnuaireMuet(true);
            setSuggestions([]);
            return;
          }
          const donnees = (await reponse.json()) as { communes?: CommuneSuggeree[] };
          setAnnuaireMuet(false);
          setSuggestions(Array.isArray(donnees.communes) ? donnees.communes : []);
        })
        .catch(() => {
          // Un abandon volontaire (frappe suivante) ne doit rien afficher.
          if (!controleur.signal.aborted) {
            setAnnuaireMuet(true);
            setSuggestions([]);
          }
        })
        .finally(() => {
          /*
           * ⚠️ DANS UN `finally`, ET SANS EXCEPTION. C'est la seule façon de
           * garantir qu'un chargement se termine : succès, 503, abandon, ou
           * exception imprévue, l'état repasse au repos. Un `setSituation`
           * posé dans le seul chemin de succès est exactement ce qui laisse un
           * indicateur tourner indéfiniment.
           */
          if (controleur.signal.aborted) return;
          setSituation((actuelle) => (actuelle === "chargement_commune" ? "repos" : actuelle));
        });
    }, ANTI_RAFALE_MS);

    return () => {
      clearTimeout(minuteur);
      controleur.abort();
    };
  }, [saisie, mode, communeChoisie]);

  /* ══════════════════════════════════════════════════════════════════════
     LES DEUX RECHERCHES
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * ⚠️ UNE SEULE PORTE DE SORTIE, ET ELLE NE PEUT PAS LAISSER UN CHARGEMENT.
   * `situationApres` ne rend jamais une situation de chargement ; le `finally`
   * rend le verrou dans tous les cas. C'est ce qui rend « ne pas afficher de
   * chargement permanent » vrai par construction plutôt que par vigilance.
   */
  const conclure = useCallback(
    (issue: Parameters<typeof situationApres>[0], trouves: readonly MagasinOsm[], coupe: boolean) => {
      setMagasins(trouves);
      setTronque(coupe);
      setSelectionnee(null);
      setSituation(situationApres(issue));
    },
    [],
  );

  const chercherAutour = useCallback(async () => {
    if (enVol.current) return;
    enVol.current = true;
    // ⚠️ LA PRÉCÉDENTE EST COUPÉE AVANT QUE LA NOUVELLE NE PARTE. Sa réponse
    // n'intéresse plus personne, et la laisser arriver écraserait celle-ci.
    recherche.current?.abort();
    const controleur = new AbortController();
    recherche.current = controleur;
    setMagasins([]);
    setDepart(null);
    setCentreCommune(null);
    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        conclure({ type: "position_indisponible" }, [], false);
        return;
      }
      setSituation("permission");
      const position = await new Promise<GeolocationPosition>((resoudre, rejeter) => {
        navigator.geolocation.getCurrentPosition(resoudre, rejeter, {
          enableHighAccuracy: false,
          timeout: DELAI_POSITION_MS,
          maximumAge: 0,
        });
      });

      setSituation("chargement_autour");
      const point: Point = { lat: position.coords.latitude, lon: position.coords.longitude };
      // ⚠️ POST, ET LA POSITION DANS LE CORPS. En chaîne de requête, elle
      // finirait dans les journaux d'accès, l'historique et le `Referer`.
      const reponse = await fetch("/api/student/stores/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: point.lat, lon: point.lon, rayonKm: rayonUtilisable(rayonKm) }),
        signal: controleur.signal,
      });
      if (!reponse.ok) {
        conclure({ type: "echec" }, [], false);
        return;
      }
      const donnees = (await reponse.json()) as { magasins?: MagasinOsm[]; tronque?: boolean };
      const trouves = Array.isArray(donnees.magasins) ? donnees.magasins : [];
      // La position est gardée pour la carte, et pour elle seule.
      setDepart(point);
      conclure({ type: "trouves", nombre: trouves.length }, trouves, donnees.tronque === true);
    } catch (erreur) {
      // ⚠️ UN ABANDON VOLONTAIRE N'EST PAS UNE PANNE. L'élève a relancé une
      // recherche ; lui afficher « la recherche n'a pas abouti » pour celle
      // qu'il vient lui-même de remplacer serait une erreur inventée.
      if (controleur.signal.aborted) return;
      const code = (erreur as GeolocationPositionError | undefined)?.code;
      conclure(issueDeGeolocalisation(code), [], false);
    } finally {
      enVol.current = false;
      if (recherche.current === controleur) recherche.current = null;
    }
  }, [conclure, rayonKm]);

  const chercherCommune = useCallback(
    async (commune: CommuneSuggeree | null, villeLibre: string) => {
      if (enVol.current) return;
      enVol.current = true;
      recherche.current?.abort();
      const controleur = new AbortController();
      recherche.current = controleur;
      setMagasins([]);
      // ⚠️ AUCUN POINT DE DÉPART EN MODE VILLE : il n'en existe pas. En
      // fabriquer un afficherait des distances que rien ne fonde.
      setDepart(null);
      /*
       * ⚠️ LE CENTRE DE LA COMMUNE EST POSÉ AVANT L'APPEL, PAS APRÈS. C'est ce
       * qui permet à la carte d'avoir un centre MÊME SI la recherche ne rend
       * aucun commerce — et c'est exactement ce qu'un élève attend après avoir
       * choisi sa ville.
       */
      setCentreCommune(commune?.centre ?? null);
      setSituation("chargement_ville");
      try {
        /*
         * ⚠️ LE CODE INSEE QUAND IL EXISTE, LE NOM SEULEMENT EN REPLI. C'est
         * l'étape de géocodage : une chaîne brute n'arrive au moteur de
         * commerces que si l'annuaire des communes était indisponible.
         */
        const corps =
          commune !== null ? { codeInsee: commune.code } : { ville: villeLibre.trim() };
        const reponse = await fetch("/api/student/stores/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
          signal: controleur.signal,
        });
        if (!reponse.ok) {
          conclure({ type: "echec" }, [], false);
          return;
        }
        const donnees = (await reponse.json()) as { magasins?: MagasinOsm[]; tronque?: boolean };
        const trouves = Array.isArray(donnees.magasins) ? donnees.magasins : [];
        conclure({ type: "trouves", nombre: trouves.length }, trouves, donnees.tronque === true);
      } catch {
        if (controleur.signal.aborted) return;
        conclure({ type: "echec" }, [], false);
      } finally {
        enVol.current = false;
        if (recherche.current === controleur) recherche.current = null;
      }
    },
    [conclure],
  );

  /* ══════════════════════════════════════════════════════════════════════
     LE RENDU
     ══════════════════════════════════════════════════════════════════════ */

  const occupe = enChargement(situation);
  /*
   * ⚠️ `messageHorsBouton` ET NON `messageDeSituation` : pendant un
   * chargement, le bouton porte déjà l'étape. Afficher en plus
   * « Recherche des commerces autour de toi… » juste en dessous d'un bouton
   * qui dit « Recherche en cours… » était le doublon vu en Preview — et, pour
   * un lecteur d'écran, la même information annoncée deux fois.
   */
  const message = messageHorsBouton(situation, { mode, tronque });
  const selectionne = useMemo(
    () => magasins.find((m) => cleIdentiteOsm(m) === selectionnee) ?? null,
    [magasins, selectionnee],
  );

  function changerDeMode(suivant: ModeRecherche) {
    if (suivant === mode) return;
    setMode(suivant);
    // ⚠️ CHANGER DE MODE REMET TOUT À PLAT, Y COMPRIS LA POSITION. Garder les
    // résultats « autour de moi » sous l'onglet « par ville » afficherait des
    // distances sans point de départ visible.
    setSituation("repos");
    setMagasins([]);
    setTronque(false);
    setDepart(null);
    setCentreCommune(null);
    setSelectionnee(null);
    // La recherche en vol ne concerne plus le mode affiché : on la coupe.
    recherche.current?.abort();
  }

  return (
    <section aria-labelledby="recherche-commerces-titre" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3
          id="recherche-commerces-titre"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-foreground"
        >
          <Store size={16} aria-hidden="true" />
          Trouver un commerce
        </h3>
        <p className="text-xs text-muted-foreground">
          Supermarchés, primeurs, boucheries, boulangeries, fromageries, poissonneries, magasins
          bio, épiceries et commerces spécialisés.
        </p>
      </header>

      {/* ── LES DEUX MODES, NOMMÉS ─────────────────────────────────────────── */}
      <div role="tablist" aria-label="Mode de recherche" className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => changerDeMode(m.id)}
            className={[
              "pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border px-3 text-xs uppercase tracking-widest transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none",
              mode === m.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-info hover:text-info",
            ].join(" ")}
          >
            {m.id === "autour" ? (
              <Crosshair size={14} aria-hidden="true" />
            ) : (
              <Search size={14} aria-hidden="true" />
            )}
            {m.libelle}
          </button>
        ))}
      </div>

      {/* ── MODE « AUTOUR DE MOI » ─────────────────────────────────────────── */}
      {mode === "autour" && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs uppercase tracking-widest text-muted-foreground">
              Rayon de recherche
            </legend>
            <div className="flex flex-wrap gap-2">
              {RAYONS_PROPOSES.map((km) => (
                <button
                  key={km}
                  type="button"
                  aria-pressed={rayonKm === km}
                  onClick={() => setRayonKm(km)}
                  className={[
                    "pressable min-h-[44px] rounded-control border px-3 text-xs tracking-wide transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none",
                    rayonKm === km
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-info hover:text-info",
                  ].join(" ")}
                >
                  {libelleDuRayon(km)}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => void chercherAutour()}
            disabled={occupe}
            aria-busy={occupe}
            className="pressable inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control border border-primary bg-primary/10 px-4 text-sm font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none sm:w-auto"
          >
            {/* ⚠️ L'ICÔNE DEVIENT L'INDICATEUR, elle ne s'ajoute pas à lui :
                deux symboles côte à côte diraient deux fois la même chose.
                Et c'est le `Loader` qui porte l'annonce vocale de l'étape. */}
            {occupe ? (
              <Loader variante="inline" libelle={libelleDuBouton(situation, "autour")} />
            ) : (
              <Crosshair size={16} aria-hidden="true" />
            )}
            {libelleDuBouton(situation, "autour")}
          </button>
        </div>
      )}

      {/* ── MODE « PAR VILLE » ─────────────────────────────────────────────── */}
      {mode === "ville" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="commerce-ville" className="text-xs uppercase tracking-widest text-muted-foreground">
            Commune
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="commerce-ville"
              type="text"
              value={saisie}
              autoComplete="off"
              placeholder="Toulon, Saint-Martin…"
              onChange={(evenement) => {
                setSaisie(evenement.target.value);
                // ⚠️ TAPER ANNULE LE CHOIX PRÉCÉDENT. Sans cela, l'élève
                // corrigerait son texte et chercherait encore l'ancienne
                // commune.
                setCommuneChoisie(null);
              }}
              onKeyDown={(evenement) => {
                if (evenement.key !== "Enter") return;
                evenement.preventDefault();
                /*
                 * ⚠️ ENTRÉE RETIENT LA PREMIÈRE SUGGESTION QUAND IL Y EN A UNE.
                 * Sinon elle part sur le nom libre — le repli qui existe pour
                 * l'annuaire muet, et rien d'autre.
                 */
                const premiere = communeChoisie ?? suggestions[0] ?? null;
                if (premiere !== null) setCommuneChoisie(premiere);
                void chercherCommune(premiere, saisie);
              }}
              className="min-h-[48px] flex-1 rounded-control border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <button
              type="button"
              onClick={() => void chercherCommune(communeChoisie, saisie)}
              disabled={occupe || saisie.trim().length < SAISIE_MIN}
              aria-busy={occupe}
              className="pressable inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control border border-primary bg-primary/10 px-4 text-sm font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
            >
              {occupe ? (
                <Loader variante="inline" libelle={libelleDuBouton(situation, "ville")} />
              ) : (
                <Search size={16} aria-hidden="true" />
              )}
              {libelleDuBouton(situation, "ville")}
            </button>
          </div>

          {/* ⚠️ LES SUGGESTIONS SONT UN CHOIX EXPLICITE, PAS UNE COMPLÉTION
              AUTOMATIQUE. Rien n'est cherché avant que l'élève n'ait désigné
              SA commune : c'est ce qui supprime l'ambiguïté des homonymes. */}
          {communeChoisie === null && suggestions.length > 0 && (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-control border border-border bg-card">
              {suggestions.map((commune) => (
                <li key={commune.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setCommuneChoisie(commune);
                      setSaisie(commune.nom);
                      setSuggestions([]);
                      void chercherCommune(commune, commune.nom);
                    }}
                    className="pressable flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
                  >
                    <span className="truncate">{commune.nom}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {commune.codePostal ?? commune.departement}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {communeChoisie !== null && (
            <p className="text-xs text-muted-foreground">
              Commune retenue&nbsp;:{" "}
              <strong className="font-semibold text-foreground">{communeChoisie.nom}</strong>
              {communeChoisie.codePostal !== null ? ` (${communeChoisie.codePostal})` : ""}
            </p>
          )}

          {annuaireMuet && (
            <p className="text-xs text-muted-foreground" role="status">
              L&apos;annuaire des communes ne répond pas. Tu peux valider le nom de ta ville
              directement&nbsp;; s&apos;il existe plusieurs communes de ce nom, il faudra préciser.
            </p>
          )}
        </div>
      )}

      {/*
        ── L'ÉTAT DE LA RECHERCHE — UNE SEULE VOIX ────────────────────────────

        ⚠️ LA RÉGION EXISTE TOUJOURS, MÊME VIDE, et c'est ce qui la rend
        annonçable. Un `aria-live` monté en même temps que son contenu n'est
        pas annoncé par la plupart des lecteurs d'écran : ils ne surveillent
        que les régions déjà présentes. Une région vide ne coûte rien et
        parle quand il le faut.

        ⚠️ `polite`, PAS `assertive`. « La recherche a échoué » ne doit pas
        couper la phrase en cours de lecture.
      */}
      <div aria-live="polite" aria-atomic="true">
        {/*
          ⚠️ RIEN N'EST ÉCRIT ICI PENDANT UN CHARGEMENT, ET C'EST LE CORRECTIF.
          Le bouton porte l'indicateur et l'étape, et le `Loader` qu'il
          contient annonce déjà cette étape aux lecteurs d'écran. Une seconde
          phrase juste en dessous était le doublon constaté en Preview
          (« RECHERCHE EN COURS… » + « Recherche des commerces autour de
          toi… ») — et, pour un lecteur d'écran, la même information deux fois.
        */}
        {message !== null && (
          <p
            role={message.role}
            className={[
              "rounded-panel border px-4 py-3 text-sm",
              message.role === "alert"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-card text-muted-foreground",
            ].join(" ")}
          >
            {message.texte}
          </p>
        )}
      </div>

      {/*
        ── AUCUN COMMERCE, MAIS UNE COMMUNE : LA CARTE RESTE UTILE ────────────

        ⚠️ ELLE NE DÉPEND PAS DU GPS, ET C'EST TOUT L'INTÉRÊT. L'élève a choisi
        sa commune ; lui montrer où elle est, même sans commerce cartographié,
        vaut mieux qu'un écran vide qui laisse croire à une panne. Le centre
        vient de l'annuaire officiel, pas d'une position empruntée à l'autre
        mode.
      */}
      {situation === "aucun_resultat" && centreCommune !== null && (
        <CarteDesMagasins
          magasins={[]}
          selectionnee={null}
          depart={null}
          centreCommune={centreCommune}
          onSelectionner={() => {}}
        />
      )}

      {/* ── LES RÉSULTATS : LISTE + CARTE ─────────────────────────────────── */}
      {situation === "resultats" && magasins.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* ⚠️ SUR TÉLÉPHONE, DEUX ONGLETS ; SUR ORDINATEUR, LES DEUX À LA
              FOIS. Côte à côte sur un écran de 375 px donnerait deux colonnes
              de 180 px, donc un débordement horizontal ou une carte illisible. */}
          {/*
            ⚠️ CE QUI A ÉTÉ CHERCHÉ, PAS SEULEMENT CE QUI A ÉTÉ TROUVÉ. Une
            liste de douze lignes sans rappel du rayon ni de la commune oblige
            l'élève à remonter l'écran pour savoir ce qu'il regarde.
          */}
          <p className="text-sm text-foreground">
            <strong className="font-semibold">
              {mode === "autour"
                ? resumeDeLaRecherche(magasins.length, { mode: "autour", rayonKm })
                : resumeDeLaRecherche(magasins.length, {
                    mode: "ville",
                    commune: communeChoisie?.nom ?? saisie.trim(),
                  })}
            </strong>
          </p>

          <div role="tablist" aria-label="Affichage des résultats" className="flex gap-2 lg:hidden">
            {(["liste", "carte"] as const).map((onglet) => (
              <button
                key={onglet}
                type="button"
                role="tab"
                aria-selected={ongletMobile === onglet}
                onClick={() => setOngletMobile(onglet)}
                className={[
                  "pressable min-h-[44px] flex-1 rounded-control border px-3 text-xs uppercase tracking-widest transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none",
                  ongletMobile === onglet
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground",
                ].join(" ")}
              >
                {onglet === "liste" ? `Liste (${magasins.length})` : "Carte"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className={ongletMobile === "liste" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <ListeDesCommerces
                magasins={magasins}
                selectionnee={selectionnee}
                choixEnCours={choixEnCours}
                onSelectionner={setSelectionnee}
                onChoisir={onChoisir}
              />
            </div>
            <div className={ongletMobile === "carte" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <CarteDesMagasins
                magasins={magasins}
                selectionnee={selectionnee}
                depart={depart}
                centreCommune={centreCommune}
                onSelectionner={(cle) => {
                  setSelectionnee(cle);
                  // ⚠️ SUR TÉLÉPHONE, LE CLIC SUR UN MARQUEUR NE RENVOIE PAS
                  // À LA LISTE : la fiche s'ouvre SUR la carte, sinon le geste
                  // ferait disparaître la carte qu'on vient de toucher.
                }}
                ficheDuSelectionne={
                  selectionne !== null ? (
                    <FicheCommerce
                      magasin={selectionne}
                      depart={depart}
                      enregistrement={choixEnCours === cleIdentiteOsm(selectionne)}
                      onChoisir={() => onChoisir(selectionne)}
                      onFermer={() => setSelectionnee(null)}
                    />
                  ) : null
                }
              />
            </div>
          </div>

          {tronque && (
            <p className="text-xs text-muted-foreground" role="status">
              Recherche écourtée&nbsp;: seuls les premiers résultats sont affichés.
            </p>
          )}
          {/* Licence de la source des commerces : obligatoire. */}
          <p className="text-xs text-muted-foreground">
            Données des commerces&nbsp;: OpenStreetMap (ODbL).
          </p>
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LA LISTE
   ══════════════════════════════════════════════════════════════════════════ */

function ListeDesCommerces({
  magasins,
  selectionnee,
  choixEnCours,
  onSelectionner,
  onChoisir,
}: {
  readonly magasins: readonly MagasinOsm[];
  readonly selectionnee: string | null;
  readonly choixEnCours: string | null;
  readonly onSelectionner: (cle: string) => void;
  readonly onChoisir: (magasin: MagasinOsm) => void;
}) {
  return (
    <ul className="flex max-h-[460px] flex-col divide-y divide-border overflow-y-auto rounded-card border border-border bg-card">
      {magasins.map((magasin) => {
        const cle = cleIdentiteOsm(magasin);
        const marque = marqueAAfficher(magasin.name, magasin.brand);
        const actif = cle === selectionnee;
        return (
          <li key={cle}>
            {/*
              ⚠️ SÉLECTIONNER N'EST PAS CHOISIR, ET CE SONT DEUX BOUTONS.
              Un seul bouton qui fasse les deux enregistrerait le magasin au
              premier regard : l'élève veut d'abord voir où il est.
            */}
            <div
              className={[
                "flex flex-col gap-2 px-3 py-3 transition-colors motion-reduce:transition-none",
                actif ? "bg-success/10" : "",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSelectionner(cle)}
                aria-pressed={actif}
                className="pressable flex min-h-[44px] flex-col items-start gap-0.5 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-foreground">{magasin.name}</span>
                  {marque !== null && (
                    <span className="text-xs text-muted-foreground">· {marque}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[magasin.postcode, magasin.city].filter(Boolean).join(" ")}
                  {/* ⚠️ LA DISTANCE N'EST AFFICHÉE QUE SI ELLE EXISTE. Une
                      recherche par ville n'a aucun point de départ : en
                      fabriquer une afficherait un nombre que rien ne fonde. */}
                  {magasin.distanceKm !== null ? ` · ${magasin.distanceKm.toFixed(1)} km` : ""}
                </span>
              </button>
              {actif && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onChoisir(magasin)}
                    disabled={choixEnCours !== null}
                    className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-success bg-success/10 px-3 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
                  >
                    <MapPin size={14} aria-hidden="true" />
                    {choixEnCours === cle ? "Enregistrement…" : "Choisir ce commerce"}
                  </button>
                  <LienItineraire magasin={magasin} depart={null} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LA FICHE, SUR LA CARTE
   ══════════════════════════════════════════════════════════════════════════ */

function FicheCommerce({
  magasin,
  depart,
  enregistrement,
  onChoisir,
  onFermer,
}: {
  readonly magasin: MagasinOsm;
  readonly depart: Point | null;
  readonly enregistrement: boolean;
  readonly onChoisir: () => void;
  readonly onFermer: () => void;
}) {
  const marque = marqueAAfficher(magasin.name, magasin.brand);
  return (
    <div className="rounded-card border border-border bg-card/95 p-3 shadow-soft backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{magasin.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {marque !== null ? `${marque} · ` : ""}
            {[magasin.postcode, magasin.city].filter(Boolean).join(" ")}
            {magasin.distanceKm !== null ? ` · ${magasin.distanceKm.toFixed(1)} km` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer la fiche"
          className="pressable shrink-0 rounded-control px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Fermer
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onChoisir}
          disabled={enregistrement}
          className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-success bg-success/10 px-3 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
        >
          <MapPin size={14} aria-hidden="true" />
          {enregistrement ? "Enregistrement…" : "Choisir ce commerce"}
        </button>
        <LienItineraire magasin={magasin} depart={depart} />
      </div>
    </div>
  );
}

/**
 * Le bouton d'itinéraire.
 *
 * ⚠️ `rel="noopener noreferrer"` ET `target="_blank"`. Sans `noreferrer`,
 * l'URL de la page de courses partirait dans l'en-tête `Referer` du service
 * d'itinéraire — et cette URL dit que l'élève fait ses courses.
 */
function LienItineraire({
  magasin,
  depart,
}: {
  readonly magasin: MagasinOsm;
  readonly depart: Point | null;
}) {
  return (
    <a
      href={urlItineraire({ lat: magasin.lat, lon: magasin.lon }, depart)}
      target="_blank"
      rel="noopener noreferrer"
      className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-border px-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-info hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
    >
      <Navigation size={14} aria-hidden="true" />
      Itinéraire
    </a>
  );
}
