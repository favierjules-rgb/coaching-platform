"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  enregistrerPhysiologie,
  enregistrerReglagesZones,
  lirePhysiologie,
  PHYSIOLOGIE_VIDE,
  referencesDepuisPhysiologie,
  type EcriturePhysiologie,
  type PhysiologieBrute,
} from "@/lib/supabase/physiologie";
import {
  reinitialiserZones,
  REGLAGES_PAR_DEFAUT,
  type ReferencesAthlete,
  type ReglagesZones,
} from "@/lib/zones-physiologiques";

/**
 * LE PROFIL PHYSIOLOGIQUE D'UN ÉLÈVE, CÔTÉ ÉCRAN.
 *
 * ⚠️ UN SEUL ÉLÈVE, NOMMÉ. Toutes les lectures et écritures passent par
 * `studentId` : ce hook n'a aucun chemin capable d'atteindre un autre athlète.
 * C'est ce qui rend l'isolation vérifiable — il n'y a pas de « profil courant »
 * implicite à confondre.
 *
 * ⚠️ APRÈS UNE ÉCRITURE, ON RELIT. Reconstituer l'état localement à partir de
 * ce qu'on croit avoir envoyé afficherait des zones calculées depuis des
 * valeurs que la base n'a peut-être pas acceptées (colonne absente tant que la
 * migration dort, RLS, contrainte). La relecture est la seule preuve.
 */
export interface EtatPhysiologie {
  readonly physio: PhysiologieBrute;
  readonly references: ReferencesAthlete;
  readonly reglages: ReglagesZones;
  /** `false` quand Supabase n'est pas configuré — l'écran le dit au lieu de mentir. */
  readonly disponible: boolean;
  readonly chargement: boolean;
  readonly erreur: string | null;
}

export function usePhysiologieEleve(studentId: string) {
  const [physio, setPhysio] = useState<PhysiologieBrute>(PHYSIOLOGIE_VIDE);
  const [disponible, setDisponible] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;

    async function lire() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setDisponible(false);
          setChargement(false);
        }
        return;
      }
      const resultat = await lirePhysiologie(supabase, studentId);
      if (annule) return;
      setPhysio(resultat.physio);
      setDisponible(true);
      setErreur(resultat.erreur);
      setChargement(false);
    }

    void lire();
    return () => {
      annule = true;
    };
  }, [studentId, version]);

  const relire = useCallback(() => {
    setVersion((precedente) => precedente + 1);
  }, []);

  const enregistrer = useCallback(
    async (ecriture: EcriturePhysiologie): Promise<{ ok: boolean; erreur: string | null }> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      const resultat = await enregistrerPhysiologie(supabase, studentId, ecriture);
      if (resultat.ok) relire();
      return resultat;
    },
    [studentId, relire],
  );

  /**
   * ⚠️ CE CHEMIN NE TOUCHE QUE `zone_settings`. Il n'existe aucune branche ici
   * capable d'écrire une VMA, un FTP, une PMA ou une FC : « Réinitialiser mes
   * zones » ne peut donc pas effacer une référence physiologique, même par
   * accident.
   */
  const enregistrerZones = useCallback(
    async (reglages: ReglagesZones | null): Promise<{ ok: boolean; erreur: string | null }> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return { ok: false, erreur: "Supabase n'est pas configuré." };
      const resultat = await enregistrerReglagesZones(supabase, studentId, reglages);
      if (resultat.ok) relire();
      return resultat;
    },
    [studentId, relire],
  );

  const reinitialiser = useCallback(
    () => enregistrerZones(reinitialiserZones()),
    [enregistrerZones],
  );

  const etat: EtatPhysiologie = {
    physio,
    references: referencesDepuisPhysiologie(physio),
    reglages: physio.reglagesZones ?? REGLAGES_PAR_DEFAUT,
    disponible,
    chargement,
    erreur,
  };

  return { etat, enregistrer, enregistrerZones, reinitialiser, relire };
}
