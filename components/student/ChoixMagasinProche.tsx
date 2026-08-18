"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MagasinProche } from "@/lib/nutrition/magasin-proche";
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
  | "succes";

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

  const enCours = état === "demande_permission" || état === "chargement";

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

      {état === "demande_permission" && <p role="status">Autorise la localisation pour continuer.</p>}

      {état === "permission_refusee" && (
        <p role="status">
          Localisation refusée. La recherche par ville arrivera dans une prochaine étape ; en
          attendant, rien n’est enregistré et tu peux réessayer quand tu veux.
        </p>
      )}

      {état === "indisponible" && (
        <p role="status">
          Ton appareil n’a pas pu donner ta position. La recherche par ville arrivera dans une
          prochaine étape.
        </p>
      )}

      {état === "expire" && <p role="status">La localisation a mis trop de temps. Réessaie.</p>}

      {état === "aucun_resultat" && (
        <p role="status">
          Aucun magasin connu autour de toi. Ce n’est pas une erreur : la base de magasins est
          collaborative et reste incomplète par endroits.
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
                  <span>
                    {magasin.city ?? ""} · {magasin.distanceKm.toFixed(1)} km
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
