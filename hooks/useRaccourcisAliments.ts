"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type CibleRecente, cleRecent } from "@/lib/nutrition/recents";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type AlimentRapide,
  chargerAlimentsRapides,
  cleAlimentRapide,
  listerRecents,
} from "@/lib/supabase/consumed-meals";
import { ajouterFavori, listerFavoris, retirerFavori } from "@/lib/supabase/food-favorites";

/**
 * FAVORIS ET RÉCENTS (ALIMENTS A5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN SEUL CHARGEMENT, À L'OUVERTURE
 * ────────────────────────────────────────────────────────────────────────────
 * Quatre requêtes au total, toutes bornées :
 *   1. les favoris de l'élève           (index student_id, created_at desc)
 *   2. les 200 dernières entrées        (index student_id, created_at desc)
 *   3. les aliments des deux listes     (`in (…)`)
 *   4. les produits des deux listes     (`in (…)`)
 *
 * Les sources des favoris et des récents sont chargées SÉPARÉMENT et non en une
 * requête commune : les deux listes ont des ordres différents, et les fusionner
 * pour les redécouper ensuite coûterait plus de code qu'une requête de plus sur
 * douze identifiants.
 *
 * ⚠️ AUCUN RECHARGEMENT AU FIL DE LA FRAPPE. Ces deux listes ne dépendent pas
 * du terme cherché : elles s'affichent quand le champ est VIDE. Les recharger à
 * chaque caractère serait le même défaut qu'A3 avait écarté pour la recherche
 * externe, transposé à notre propre base.
 */

export interface RaccourcisAliments {
  readonly favoris: readonly AlimentRapide[];
  readonly recents: readonly AlimentRapide[];
  readonly chargement: boolean;
  /** Vrai si cette cible est dans les favoris — mis à jour immédiatement. */
  readonly estFavori: (cible: CibleRecente) => boolean;
  readonly basculerFavori: (cible: CibleRecente) => Promise<void>;
}

export function useRaccourcisAliments(
  studentId: string | null,
  actif: boolean,
): RaccourcisAliments {
  const [favoris, setFavoris] = useState<readonly AlimentRapide[]>([]);
  const [recents, setRecents] = useState<readonly AlimentRapide[]>([]);
  const [chargement, setChargement] = useState(actif && studentId !== null);
  /** Les clés des favoris — la vérité de l'étoile, séparée de la liste affichée. */
  const [cles, setCles] = useState<readonly string[]>([]);

  const requête = useRef(0);
  // Garde de double bascule : deux tapes très rapprochées sur l'étoile
  // partiraient toutes les deux avant que React n'ait repeint.
  const enCours = useRef(new Set<string>());

  const charger = useCallback(async () => {
    if (!actif || !studentId) {
      setFavoris([]);
      setRecents([]);
      setCles([]);
      setChargement(false);
      return;
    }
    const numéro = ++requête.current;
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const [lignesFavoris, listeRecents] = await Promise.all([
        listerFavoris(supabase),
        listerRecents(supabase, studentId),
      ]);
      const ciblesFavoris = lignesFavoris.map((f) => f.cible);
      const listeFavoris = await chargerAlimentsRapides(supabase, ciblesFavoris);
      if (requête.current !== numéro) return;
      setFavoris(listeFavoris);
      setRecents(listeRecents);
      // Les clés viennent des LIGNES, pas des sources chargées : un favori dont
      // l'aliment a été archivé n'apparaît plus dans la liste, mais l'étoile
      // doit rester juste s'il ressort un jour d'une recherche.
      setCles(ciblesFavoris.map(cleRecent));
    } catch (erreur) {
      if (requête.current !== numéro) return;
      console.error("[useRaccourcisAliments]", erreur);
    } finally {
      if (requête.current === numéro) setChargement(false);
    }
  }, [actif, studentId]);

  useEffect(() => {
    let annulé = false;
    async function lire() {
      if (annulé) return;
      await charger();
    }
    void lire();
    return () => {
      annulé = true;
    };
  }, [charger]);

  const estFavori = useCallback(
    (cible: CibleRecente) => cles.includes(cleRecent(cible)),
    [cles],
  );

  /**
   * Bascule un favori, et met l'écran à jour IMMÉDIATEMENT.
   *
   * L'étoile change avant la réponse du réseau : sur un téléphone, attendre
   * l'aller-retour donnerait une étoile qui « colle ». Si l'écriture échoue,
   * l'état est remis comme il était — on ne laisse pas une étoile mentir.
   */
  const basculerFavori = useCallback(
    async (cible: CibleRecente) => {
      if (!studentId) return;
      const clé = cleRecent(cible);
      if (enCours.current.has(clé)) return;
      enCours.current.add(clé);

      const étaitFavori = cles.includes(clé);
      setCles((actuelles) =>
        étaitFavori ? actuelles.filter((c) => c !== clé) : [...actuelles, clé],
      );
      if (étaitFavori) {
        setFavoris((actuels) => actuels.filter((f) => cleAlimentRapide(f) !== clé));
      }

      try {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) throw new Error("supabase indisponible");
        const ok = étaitFavori
          ? await retirerFavori(supabase, cible)
          : await ajouterFavori(supabase, studentId, cible);
        if (!ok) throw new Error("écriture refusée");
        // On recharge pour que la LISTE des favoris reflète la base — c'est
        // elle qui décide de l'ordre, et un ajout doit apparaître en tête.
        await charger();
      } catch (erreur) {
        console.error("[useRaccourcisAliments] bascule", erreur);
        setCles((actuelles) =>
          étaitFavori ? [...actuelles, clé] : actuelles.filter((c) => c !== clé),
        );
        await charger();
      } finally {
        enCours.current.delete(clé);
      }
    },
    [charger, cles, studentId],
  );

  return { favoris, recents, chargement, estFavori, basculerFavori };
}
