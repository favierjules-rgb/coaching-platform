import type { SupabaseClient } from "@supabase/supabase-js";

import { valeurPhysio, VALEUR_ABSENTE, type SourceValeur, type ValeurPhysio } from "@/lib/physiologie";
import type { ReferencesAthlete, ReglagesZones } from "@/lib/zones-physiologiques";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * LE PROFIL PHYSIOLOGIQUE D'UN ATHLÈTE — lecture et écriture.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI `select("*")` ET UNE LECTURE DÉFENSIVE
 * ════════════════════════════════════════════════════════════════════════
 * Sept colonnes physiologiques existent depuis juillet 2026 (`vma_kmh`,
 * `hr_max`, `hr_resting`, `ftp_watts`, `reference_paces`,
 * `last_fitness_test_date`, `fitness_test_protocol`) ; les autres arrivent avec
 * la migration `20260930090000`, qui N'EST PAS APPLIQUÉE.
 *
 * Nommer les colonnes une par une dans le `select` ferait échouer la requête
 * ENTIÈRE tant que la migration dort — y compris pour les sept colonnes qui
 * existent. `select("*")` rend ce qui existe, et la lecture traite une clé
 * absente exactement comme une valeur nulle : l'écran fonctionne avant la
 * migration (avec moins de champs) et après (avec tous), sans branche
 * conditionnelle et sans drapeau de version.
 *
 * ⚠️ L'ÉCRITURE, ELLE, NE PEUT PAS ÊTRE DÉFENSIVE. Écrire `sex` sur une base
 * qui n'a pas la colonne échoue, et c'est bien : un échec visible vaut mieux
 * qu'une donnée silencieusement perdue. `enregistrerPhysiologie` remonte donc
 * l'erreur à l'appelant plutôt que de filtrer ce qu'elle envoie.
 *
 * ⚠️ AUCUNE POLICY N'EST CONTOURNÉE ICI. `student_profiles` porte
 * `student_profiles_manage_self_or_staff` : le coach écrit, l'élève écrit le
 * sien. Ce module ne fait qu'émettre la requête ; la garde est la RLS.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. LA FORME LUE
 * ════════════════════════════════════════════════════════════════════════ */

/** Les champs physiologiques bruts, tels que la table les porte. */
export interface PhysiologieBrute {
  readonly sex: string | null;
  readonly birthDate: string | null;
  readonly poidsKg: number | null;
  readonly tailleCm: number | null;
  readonly hrRepos: number | null;
  readonly hrMax: number | null;
  readonly hrSeuil: number | null;
  readonly vo2max: number | null;
  /* Course */
  readonly vmaCourseKmh: number | null;
  readonly ftpRunWatts: number | null;
  readonly puissanceCritiqueRunWatts: number | null;
  readonly vitesseCritiqueKmh: number | null;
  readonly hrMaxCourse: number | null;
  /* Vélo */
  readonly ftpWatts: number | null;
  readonly pmaWatts: number | null;
  readonly puissanceCritiqueWatts: number | null;
  readonly hrMaxVelo: number | null;
  /* Natation */
  readonly vmaNatationKmh: number | null;
  readonly vitesseCritiqueNatationKmh: number | null;
  readonly hrMaxNatation: number | null;
  /* Méta */
  readonly sources: Readonly<Record<string, SourceValeur>>;
  readonly reglagesZones: ReglagesZones | null;
  readonly derniereMiseAJour: string | null;
}

export const PHYSIOLOGIE_VIDE: PhysiologieBrute = {
  sex: null, birthDate: null, poidsKg: null, tailleCm: null,
  hrRepos: null, hrMax: null, hrSeuil: null, vo2max: null,
  vmaCourseKmh: null, ftpRunWatts: null, puissanceCritiqueRunWatts: null, vitesseCritiqueKmh: null, hrMaxCourse: null,
  ftpWatts: null, pmaWatts: null, puissanceCritiqueWatts: null, hrMaxVelo: null,
  vmaNatationKmh: null, vitesseCritiqueNatationKmh: null, hrMaxNatation: null,
  sources: {}, reglagesZones: null, derniereMiseAJour: null,
};

/** Les clés dont la provenance peut être déclarée. */
export const CLES_PHYSIO = [
  "hr_resting", "hr_max", "hr_threshold", "vo2max",
  "vma_kmh", "ftp_run_watts", "critical_power_run_watts", "critical_speed_kmh", "hr_max_run",
  "ftp_watts", "pma_watts", "critical_power_watts", "hr_max_bike",
  "vma_swim_kmh", "critical_speed_swim_kmh", "hr_max_swim",
] as const;
export type ClePhysio = (typeof CLES_PHYSIO)[number];

/* ════════════════════════════════════════════════════════════════════════
 * II. LECTURE
 * ════════════════════════════════════════════════════════════════════════ */

function nombre(ligne: Record<string, unknown>, cle: string): number | null {
  const brut = ligne[cle];
  if (brut === null || brut === undefined) return null;
  const valeur = typeof brut === "number" ? brut : Number(brut);
  return Number.isFinite(valeur) ? valeur : null;
}

function texte(ligne: Record<string, unknown>, cle: string): string | null {
  const brut = ligne[cle];
  return typeof brut === "string" && brut.trim() !== "" ? brut : null;
}

/**
 * ⚠️ UNE SOURCE INCONNUE EST IGNORÉE, PAS DEVINÉE. Un jsonb écrit à la main
 * pourrait contenir n'importe quoi ; seules « mesuree » et « estimee » entrent.
 */
function lireSources(brut: unknown): Record<string, SourceValeur> {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return {};
  const sources: Record<string, SourceValeur> = {};
  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (valeur === "mesuree" || valeur === "estimee") sources[cle] = valeur;
  }
  return sources;
}

/**
 * ⚠️ UN `zone_settings` ILLISIBLE REDEVIENT LE BARÈME DE RÉFÉRENCE, jamais un
 * objet à moitié appliqué. Une borne corrompue produirait des allures fausses
 * présentées comme personnalisées.
 */
function lireReglagesZones(brut: unknown): ReglagesZones | null {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const source = brut as Record<string, unknown>;
  const resultat: Record<string, unknown> = {};

  const paires = (valeur: unknown): Record<number, [number, number]> | undefined => {
    if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return undefined;
    const sortie: Record<number, [number, number]> = {};
    for (const [zone, bornes] of Object.entries(valeur as Record<string, unknown>)) {
      const numero = Number(zone);
      if (!Number.isInteger(numero) || numero < 1 || numero > 7) continue;
      if (!Array.isArray(bornes) || bornes.length !== 2) continue;
      const [min, max] = bornes;
      if (typeof min !== "number" || typeof max !== "number") continue;
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      sortie[numero] = [min, max];
    }
    return Object.keys(sortie).length > 0 ? sortie : undefined;
  };

  for (const cle of ["fc", "vmaCourse", "ftp", "pma", "vmaNatation"] as const) {
    const valeur = paires(source[cle]);
    if (valeur) resultat[cle] = valeur;
  }
  if (source.rpe && typeof source.rpe === "object" && !Array.isArray(source.rpe)) {
    const rpe: Record<number, number> = {};
    for (const [zone, valeur] of Object.entries(source.rpe as Record<string, unknown>)) {
      const numero = Number(zone);
      if (Number.isInteger(numero) && numero >= 1 && numero <= 7 && typeof valeur === "number" && Number.isFinite(valeur)) {
        rpe[numero] = valeur;
      }
    }
    if (Object.keys(rpe).length > 0) resultat.rpe = rpe;
  }
  return Object.keys(resultat).length > 0 ? (resultat as ReglagesZones) : null;
}

/** Convertit une ligne `student_profiles` en profil physiologique. */
export function physiologieDepuisLigne(ligne: Record<string, unknown> | null): PhysiologieBrute {
  if (!ligne) return PHYSIOLOGIE_VIDE;
  return {
    sex: texte(ligne, "sex"),
    birthDate: texte(ligne, "birth_date"),
    poidsKg: nombre(ligne, "current_weight_kg"),
    tailleCm: nombre(ligne, "height_cm"),
    hrRepos: nombre(ligne, "hr_resting"),
    hrMax: nombre(ligne, "hr_max"),
    hrSeuil: nombre(ligne, "hr_threshold"),
    vo2max: nombre(ligne, "vo2max"),
    vmaCourseKmh: nombre(ligne, "vma_kmh"),
    ftpRunWatts: nombre(ligne, "ftp_run_watts"),
    puissanceCritiqueRunWatts: nombre(ligne, "critical_power_run_watts"),
    vitesseCritiqueKmh: nombre(ligne, "critical_speed_kmh"),
    hrMaxCourse: nombre(ligne, "hr_max_run"),
    ftpWatts: nombre(ligne, "ftp_watts"),
    pmaWatts: nombre(ligne, "pma_watts"),
    puissanceCritiqueWatts: nombre(ligne, "critical_power_watts"),
    hrMaxVelo: nombre(ligne, "hr_max_bike"),
    vmaNatationKmh: nombre(ligne, "vma_swim_kmh"),
    vitesseCritiqueNatationKmh: nombre(ligne, "critical_speed_swim_kmh"),
    hrMaxNatation: nombre(ligne, "hr_max_swim"),
    sources: lireSources(ligne.physio_sources),
    reglagesZones: lireReglagesZones(ligne.zone_settings),
    derniereMiseAJour: texte(ligne, "physio_updated_at"),
  };
}

/**
 * Les références d'un athlète, prêtes pour `tableauZones`.
 *
 * ⚠️ LA PROVENANCE SUIT LA VALEUR. Une valeur sans entrée dans
 * `physio_sources` est réputée MESURÉE : c'est ce que le coach a saisi sans
 * rien dire de plus. « Estimée » est une déclaration explicite — jamais un
 * défaut, jamais une déduction.
 */
export function referencesDepuisPhysiologie(physio: PhysiologieBrute): ReferencesAthlete {
  const avec = (valeur: number | null, cle: ClePhysio): ValeurPhysio =>
    valeur === null ? VALEUR_ABSENTE : valeurPhysio(valeur, physio.sources[cle] ?? "mesuree");

  return {
    fcMax: avec(physio.hrMax, "hr_max"),
    fcRepos: avec(physio.hrRepos, "hr_resting"),
    vmaCourseKmh: avec(physio.vmaCourseKmh, "vma_kmh"),
    vmaNatationKmh: avec(physio.vmaNatationKmh, "vma_swim_kmh"),
    ftpWatts: avec(physio.ftpWatts, "ftp_watts"),
    pmaWatts: avec(physio.pmaWatts, "pma_watts"),
    fcMaxParSport: {
      course: avec(physio.hrMaxCourse, "hr_max_run"),
      velo: avec(physio.hrMaxVelo, "hr_max_bike"),
      natation: avec(physio.hrMaxNatation, "hr_max_swim"),
    },
  };
}

export async function lirePhysiologie(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<{ physio: PhysiologieBrute; erreur: string | null }> {
  const { data, error } = await supabase
    .from("student_profiles")
    // Voir l'en-tête : `*` rend ce qui existe, quel que soit l'état de la migration.
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) return { physio: PHYSIOLOGIE_VIDE, erreur: error.message };
  return { physio: physiologieDepuisLigne((data as Record<string, unknown> | null) ?? null), erreur: null };
}

/* ════════════════════════════════════════════════════════════════════════
 * III. ÉCRITURE
 * ════════════════════════════════════════════════════════════════════════ */

/** Ce qu'un formulaire envoie : les colonnes, telles quelles. */
export interface EcriturePhysiologie {
  readonly colonnes: Readonly<Record<string, string | number | null>>;
  readonly sources?: Readonly<Record<string, SourceValeur>>;
}

/**
 * Enregistre les données physiologiques d'UN athlète.
 *
 * ⚠️ TROIS `.eq` ET UNE SEULE LIGNE. `student_profiles` porte un unique profil
 * par élève ; l'ordre vise `student_id` et rien d'autre. Modifier Jules ne
 * peut pas atteindre Marco — la requête ne le nomme pas.
 *
 * ⚠️ `.select("id")` ET COMPTAGE DES LIGNES, pour la même raison que
 * `setProgramStartDate` : un UPDATE PostgREST sans correspondance ne rend pas
 * d'erreur, et rendre « succès » sur zéro ligne écrirait un faux succès à
 * l'écran.
 */
export async function enregistrerPhysiologie(
  supabase: TypedSupabaseClient,
  studentId: string,
  ecriture: EcriturePhysiologie,
): Promise<{ ok: boolean; erreur: string | null }> {
  const valeurs: Record<string, unknown> = { ...ecriture.colonnes };
  if (ecriture.sources) valeurs.physio_sources = ecriture.sources;
  valeurs.physio_updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("student_profiles")
    .update(valeurs as never)
    .eq("student_id", studentId)
    .select("id");
  if (error) return { ok: false, erreur: error.message };
  const lignes = (data as { id: string }[] | null) ?? [];
  if (lignes.length === 0) {
    return { ok: false, erreur: `aucun profil pour l'élève ${studentId} : rien n'a été enregistré` };
  }
  return { ok: true, erreur: null };
}

/**
 * Enregistre les réglages de zones d'UN athlète.
 *
 * ⚠️ `null` EST LA RÉINITIALISATION, et c'est toute la garantie. Remettre la
 * colonne à `null` ne PEUT pas toucher la VMA, le FTP, la PMA, la FCmax, la FC
 * de repos ni le poids : ils vivent dans d'autres colonnes, et cette requête ne
 * les nomme pas. Le bouton « Réinitialiser mes zones » passe par ici.
 */
export async function enregistrerReglagesZones(
  supabase: TypedSupabaseClient,
  studentId: string,
  reglages: ReglagesZones | null,
): Promise<{ ok: boolean; erreur: string | null }> {
  const { data, error } = await supabase
    .from("student_profiles")
    .update({ zone_settings: reglages && Object.keys(reglages).length > 0 ? reglages : null } as never)
    .eq("student_id", studentId)
    .select("id");
  if (error) return { ok: false, erreur: error.message };
  const lignes = (data as { id: string }[] | null) ?? [];
  if (lignes.length === 0) {
    return { ok: false, erreur: `aucun profil pour l'élève ${studentId} : les zones n'ont PAS été enregistrées` };
  }
  return { ok: true, erreur: null };
}
