"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  VILLE_LONGUEUR_MAX,
  VILLE_LONGUEUR_MIN,
  villeValide,
  type MagasinProche,
} from "@/lib/nutrition/magasin-proche";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { lireMagasinChoisi, type MagasinChoisi } from "@/lib/supabase/magasins";

/**
 * COURSES C4.3a — « TROUVER UN MAGASIN PRÈS DE MOI ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPOSANT NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il ne connaît ni Open Prices, ni son URL, ni son contrat, ni ses paramètres.
 * Il envoie une position à NOTRE route et reçoit une liste déjà filtrée. Un
 * appel direct depuis le navigateur enverrait la position de l'élève à un
 * tiers, avec son adresse IP, hors de toute borne et de toute limite de débit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA POSITION VIT EN MÉMOIRE, LE TEMPS D'UN APPEL
 * ────────────────────────────────────────────────────────────────────────────
 * Elle n'est écrite dans AUCUN état React durable, aucun `localStorage`, aucun
 * `sessionStorage`, aucun cookie, aucune URL. Elle est lue, postée, et perdue.
 * Ce qui reste, c'est le magasin choisi — l'adresse d'un commerce, pas celle de
 * quelqu'un.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX GESTES AVANT LA PERMISSION, COMME LE SCANNER A4
 * ────────────────────────────────────────────────────────────────────────────
 * Ouvrir cet écran ne demande RIEN. La permission de géolocalisation n'est
 * demandée qu'au tap sur le bouton — même doctrine, même raison : un écran qui
 * réclame une autorisation à l'ouverture est un écran qu'on refuse par réflexe.
 */

type Etat =
  | "inactif"
  | "demande_permission"
  | "chargement"
  | "permission_refusee"
  | "indisponible"
  | "expire"
  | "aucun_resultat"
  | "erreur"
  | "succes"
  // ── COURSES C4.3b — la recherche manuelle, ses états à elle ────────────
  | "ville_saisie"
  | "ville_chargement"
  | "ville_aucun_resultat"
  | "ville_invalide"
  | "ville_erreur";

/** Le délai laissé au navigateur pour produire une position, avant d'abandonner. */
const DELAI_POSITION_MS = 10_000;

export function ChoixMagasinProche({
  studentId,
  onMagasinChoisi,
}: {
  /** `null` tant que l'identité de l'élève n'est pas connue : on n'affiche rien. */
  studentId: string | null;
  onMagasinChoisi?: (magasin: { storeId: string; name: string }) => void;
}) {
  const [état, setÉtat] = useState<Etat>("inactif");
  const [magasins, setMagasins] = useState<readonly MagasinProche[]>([]);
  const [tronqué, setTronqué] = useState(false);
  const [choixEnCours, setChoixEnCours] = useState<number | null>(null);
  const [choisi, setChoisi] = useState<MagasinChoisi | null>(null);
  /**
   * ⚠️ LA VILLE VIT ICI, ET NULLE PART AILLEURS. Aucun `localStorage`, aucun
   * cookie, aucune colonne : elle disparaît avec le composant. Ce n'est pas une
   * coordonnée GPS, mais c'est tout de même une indication d'endroit, et rien
   * dans ce lot n'a besoin de s'en souvenir.
   */
  const [ville, setVille] = useState("");
  /** Garde de double tap : deux appuis rapprochés partiraient tous les deux. */
  const rechercheRef = useRef(false);

  /**
   * ⚠️ CETTE LECTURE NE DEMANDE AUCUNE PERMISSION. Elle lit le magasin déjà
   * choisi, sous la RLS de l'élève, avec la MÊME fonction que la route serveur
   * — `lireMagasinChoisi` de C4.3a. Rien n'est redéclaré ici, et surtout aucune
   * géolocalisation n'est déclenchée au montage : c'est le bouton qui décide.
   */
  useEffect(() => {
    if (studentId === null) return;
    let vivant = true;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    void lireMagasinChoisi(supabase, studentId).then((magasin) => {
      if (vivant) setChoisi(magasin);
    });
    return () => {
      vivant = false;
    };
  }, [studentId]);

  const chercher = useCallback(async () => {
    if (rechercheRef.current) return;
    rechercheRef.current = true;
    setMagasins([]);
    setTronqué(false);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setÉtat("indisponible");
      rechercheRef.current = false;
      return;
    }

    setÉtat("demande_permission");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: DELAI_POSITION_MS,
          maximumAge: 0,
        });
      });

      setÉtat("chargement");
      // ⚠️ POST, ET LA POSITION DANS LE CORPS. En chaîne de requête, elle
      // finirait dans les journaux d'accès, l'historique et le `Referer`.
      const réponse = await fetch("/api/student/stores/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
      });
      // La position sort de portée ici : rien ne la conserve au-delà.
      if (!réponse.ok) {
        setÉtat("erreur");
        return;
      }
      const données = (await réponse.json()) as {
        magasins?: MagasinProche[];
        tronque?: boolean;
      };
      const trouvés = Array.isArray(données.magasins) ? données.magasins : [];
      setMagasins(trouvés);
      setTronqué(données.tronque === true);
      setÉtat(trouvés.length === 0 ? "aucun_resultat" : "succes");
    } catch (erreur) {
      // ⚠️ TROIS REFUS DIFFÉRENTS, TROIS MESSAGES DIFFÉRENTS. « Permission
      // refusée » n'est pas une panne : c'est un choix, et l'écran doit le
      // respecter au lieu d'afficher une erreur rouge.
      const code = (erreur as GeolocationPositionError | undefined)?.code;
      if (code === 1) setÉtat("permission_refusee");
      else if (code === 2) setÉtat("indisponible");
      else if (code === 3) setÉtat("expire");
      else setÉtat("erreur");
    } finally {
      rechercheRef.current = false;
    }
  }, []);

  /**
   * ⚠️ AUCUNE PERMISSION N'EST DEMANDÉE ICI, et c'est toute la raison d'être de
   * ce chemin : l'élève qui a refusé la géolocalisation — ou dont l'appareil ne
   * sait pas le situer — doit pouvoir choisir son magasin quand même.
   */
  const chercherParVille = useCallback(async () => {
    if (rechercheRef.current) return;
    const saisie = ville.trim();
    if (!villeValide(saisie)) {
      setÉtat("ville_invalide");
      return;
    }
    rechercheRef.current = true;
    setMagasins([]);
    setTronqué(false);
    setÉtat("ville_chargement");
    try {
      // POST : la ville n'a rien à faire dans une chaîne de requête, donc dans
      // les journaux d'accès et l'historique du navigateur.
      const réponse = await fetch("/api/student/stores/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ville: saisie }),
      });
      if (!réponse.ok) {
        setÉtat("ville_erreur");
        return;
      }
      const données = (await réponse.json()) as { magasins?: MagasinProche[]; tronque?: boolean };
      const trouvés = Array.isArray(données.magasins) ? données.magasins : [];
      setMagasins(trouvés);
      setTronqué(données.tronque === true);
      setÉtat(trouvés.length === 0 ? "ville_aucun_resultat" : "succes");
    } catch {
      setÉtat("ville_erreur");
    } finally {
      rechercheRef.current = false;
    }
  }, [ville]);

  const choisir = useCallback(
    async (magasin: MagasinProche) => {
      setChoixEnCours(magasin.opLocationId);
      try {
        // ⚠️ UN ENTIER, ET RIEN D'AUTRE. Envoyer le nom ou l'adresse ferait du
        // navigateur la source de vérité d'un catalogue partagé : le serveur
        // relit la fiche lui-même.
        const réponse = await fetch("/api/student/stores/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opLocationId: magasin.opLocationId }),
        });
        if (!réponse.ok) {
          setÉtat("erreur");
          return;
        }
        const données = (await réponse.json()) as {
          magasin?: { storeId: string; name: string; brand: string | null; city: string | null };
        };
        if (données.magasin) {
          setChoisi({ ...données.magasin, brand: données.magasin.brand ?? null });
          setMagasins([]);
          setÉtat("inactif");
          onMagasinChoisi?.({ storeId: données.magasin.storeId, name: données.magasin.name });
        }
      } finally {
        setChoixEnCours(null);
      }
    },
    [onMagasinChoisi],
  );

  const enCours =
    état === "demande_permission" || état === "chargement" || état === "ville_chargement";

  return (
    <section aria-label="Magasin">
      {choisi ? (
        <p>
          Magasin actuel : <strong>{choisi.name}</strong>
          {choisi.city ? ` — ${choisi.city}` : ""}
        </p>
      ) : (
        <p>Aucun magasin choisi pour l’instant.</p>
      )}

      <button type="button" onClick={() => void chercher()} disabled={enCours}>
        {enCours ? "Recherche en cours…" : "Trouver un magasin près de moi"}
      </button>

      {/* ── COURSES C4.3b — LE REPLI MANUEL, TOUJOURS DISPONIBLE ──────────
          ⚠️ IL N'EST PAS CONDITIONNÉ À UN REFUS DE GÉOLOCALISATION. Un élève
          peut préférer taper sa ville d'emblée — parce qu'il prépare ses
          courses depuis son bureau, par exemple. Le cacher derrière un échec
          ferait de la géolocalisation un passage obligé. */}
      <div>
        <p>ou</p>
        <label htmlFor="magasin-ville">Ville</label>
        <input
          id="magasin-ville"
          type="text"
          value={ville}
          minLength={VILLE_LONGUEUR_MIN}
          maxLength={VILLE_LONGUEUR_MAX}
          autoComplete="off"
          onChange={(e) => {
            setVille(e.target.value);
            if (état === "ville_invalide") setÉtat("ville_saisie");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void chercherParVille();
          }}
        />
        <button type="button" onClick={() => void chercherParVille()} disabled={enCours}>
          Rechercher
        </button>
      </div>

      {état === "ville_invalide" && (
        <p role="alert">Entre un nom de ville d’au moins {VILLE_LONGUEUR_MIN} caractères.</p>
      )}
      {état === "ville_chargement" && <p role="status">Recherche des magasins…</p>}
      {/* ⚠️ ZÉRO RÉSULTAT NE VEUT PAS DIRE « IL N'EN EXISTE AUCUN ».
          Quand `tronque` est vrai, nous n'avons consulté qu'une PORTION du
          référentiel : la source annonce encore des pages, et notre pagination
          est bornée. Affirmer l'absence serait affirmer ce que nous n'avons
          pas mesuré — et l'élève renoncerait à un magasin qui existe. */}
      {état === "ville_aucun_resultat" && !tronqué && (
        <p role="status">
          Aucun magasin connu dans cette ville. Ce n’est pas une erreur : la base de magasins est
          collaborative et reste incomplète par endroits.
        </p>
      )}
      {état === "ville_aucun_resultat" && tronqué && (
        <p role="status">
          Aucun magasin n’a été trouvé dans les premiers résultats consultés. La recherche a été
          limitée : il en existe peut-être d’autres. Précise le nom de la ville et réessaie.
        </p>
      )}
      {état === "ville_erreur" && (
        <p role="alert">La recherche n’a pas abouti. Réessaie dans un instant.</p>
      )}

      {état === "demande_permission" && <p role="status">Autorise la localisation pour continuer.</p>}

      {état === "permission_refusee" && (
        <p role="status">
          Localisation refusée — rien n’est enregistré. Tu peux chercher ta ville juste en dessous.
        </p>
      )}

      {état === "indisponible" && (
        <p role="status">
          Ton appareil n’a pas pu donner ta position. Cherche ta ville juste en dessous.
        </p>
      )}

      {état === "expire" && <p role="status">La localisation a mis trop de temps. Réessaie.</p>}

      {/* ⚠️ MÊME VÉRITÉ POUR LA RECHERCHE GÉOGRAPHIQUE. C4.3a calculait DÉJÀ
          `tronque` correctement ; l'écran, lui, l'ignorait dès que la liste
          était vide. Ce n'est pas un nouveau comportement réseau — c'est le
          booléen existant enfin dit à l'élève. */}
      {état === "aucun_resultat" && !tronqué && (
        <p role="status">
          Aucun magasin connu autour de toi. Ce n’est pas une erreur : la base de magasins est
          collaborative et reste incomplète par endroits.
        </p>
      )}
      {état === "aucun_resultat" && tronqué && (
        <p role="status">
          Aucun magasin n’a été trouvé dans les premiers résultats consultés. La recherche a été
          limitée : il en existe peut-être d’autres.
        </p>
      )}

      {état === "erreur" && (
        <p role="alert">La recherche n’a pas abouti. Réessaie dans un instant.</p>
      )}

      {magasins.length > 0 && (
        <>
          <ul>
            {magasins.map((magasin) => (
              <li key={magasin.opLocationId}>
                <button
                  type="button"
                  onClick={() => void choisir(magasin)}
                  disabled={choixEnCours !== null}
                >
                  <span>{magasin.name}</span>
                  {magasin.brand ? <span>{magasin.brand}</span> : null}
                  {/* ⚠️ LA DISTANCE N'EST AFFICHÉE QUE SI ELLE EXISTE. Une
                      recherche par ville n'a aucun point de départ : en
                      fabriquer une afficherait un nombre que rien ne fonde. Le
                      code postal, lui, vient de la source. */}
                  <span>
                    {[magasin.postcode, magasin.city].filter(Boolean).join(" ")}
                    {magasin.distanceKm !== null ? ` · ${magasin.distanceKm.toFixed(1)} km` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {tronqué && (
            <p role="status">
              Recherche écourtée : seuls les premiers résultats sont affichés.
            </p>
          )}
          {/* Licence de la source : obligatoire, et vérifiée par un test. */}
          <p>Données des magasins : Open Prices / OpenStreetMap (ODbL).</p>
        </>
      )}
    </section>
  );
}
