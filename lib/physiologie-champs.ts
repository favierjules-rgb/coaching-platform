import type { SourceValeur } from "@/lib/physiologie";
import type { EcriturePhysiologie, PhysiologieBrute } from "@/lib/supabase/physiologie";

/**
 * LA DESCRIPTION DU FORMULAIRE PHYSIOLOGIQUE — sans une ligne de React.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * La saisie physiologique est le seul endroit du projet où une faute de frappe
 * dans un nom de colonne ne casse RIEN visiblement : le champ s'affiche, le
 * coach saisit, l'UPDATE part avec une clé inconnue… et PostgREST refuse la
 * requête entière, ou — pire — la colonne voisine reçoit la valeur. La liste
 * ci-dessous est donc la SEULE source de vérité du lien
 * « libellé → clé lue → colonne écrite », et elle est testable sans monter un
 * composant.
 *
 * ⚠️ AUCUNE VALEUR N'EST DÉDUITE D'UNE AUTRE. Il n'y a pas de « FCmax estimée
 * depuis l'âge », pas de « VO2max estimé depuis la VMA », pas de Karvonen :
 * le modèle de référence iDO n'en documente aucun, et en inventer un
 * fabriquerait une règle métier que personne n'a validée. `birthDate` sert
 * à AFFICHER un âge, jamais à calculer une fréquence cardiaque.
 *
 * ⚠️ UN CHAMP VIDÉ EFFACE LA DONNÉE (`null`), il ne la « laisse pas comme
 * avant ». C'est la seule façon de corriger une valeur saisie par erreur —
 * et c'est pour cela que l'écriture ne part que depuis la modale, sur
 * validation explicite.
 */

/** Les quatre écrans de la fiche. */
export type GroupePhysio = "general" | "course" | "velo" | "natation";

/** Ce qu'un champ accepte — détermine la validation, jamais une conversion. */
export type NaturePhysio = "entier" | "decimal" | "date" | "choix";

export interface ChampPhysio {
  /** Clé dans `PhysiologieBrute` (lecture). */
  readonly cle: keyof PhysiologieBrute;
  /** Colonne `student_profiles` (écriture). */
  readonly colonne: string;
  readonly libelle: string;
  /** Unité affichée à côté de la valeur ("" si aucune). */
  readonly unite: string;
  readonly groupe: GroupePhysio;
  readonly nature: NaturePhysio;
  /**
   * `true` quand le coach peut déclarer « mesurée » ou « estimée ». Le sexe, la
   * date de naissance, le poids et la taille n'ont pas de provenance : ce ne
   * sont pas des performances.
   */
  readonly provenanceDeclarable: boolean;
  /** Aide courte affichée sous le champ, quand elle évite une ambiguïté. */
  readonly aide?: string;
}

/** Valeurs autorisées par `student_profiles_sex_check` — recopiées, pas devinées. */
export const OPTIONS_SEXE: readonly { readonly value: string; readonly label: string }[] = [
  { value: "", label: "Non renseigné" },
  { value: "male", label: "Homme" },
  { value: "female", label: "Femme" },
  { value: "unspecified", label: "Non précisé" },
];

export const CHAMPS_PHYSIO: readonly ChampPhysio[] = [
  /* ── Général ────────────────────────────────────────────────────────── */
  { cle: "sex", colonne: "sex", libelle: "Sexe", unite: "", groupe: "general", nature: "choix", provenanceDeclarable: false },
  { cle: "birthDate", colonne: "birth_date", libelle: "Date de naissance", unite: "", groupe: "general", nature: "date", provenanceDeclarable: false },
  { cle: "poidsKg", colonne: "current_weight_kg", libelle: "Poids", unite: "kg", groupe: "general", nature: "decimal", provenanceDeclarable: false },
  { cle: "tailleCm", colonne: "height_cm", libelle: "Taille", unite: "cm", groupe: "general", nature: "decimal", provenanceDeclarable: false },
  { cle: "hrRepos", colonne: "hr_resting", libelle: "FC de repos", unite: "bpm", groupe: "general", nature: "entier", provenanceDeclarable: true, aide: "Borne basse de la Z1 : sans elle, la Z1 démarre à 0 bpm." },
  { cle: "hrMax", colonne: "hr_max", libelle: "FC max", unite: "bpm", groupe: "general", nature: "entier", provenanceDeclarable: true, aide: "Sert aux trois sports tant qu'aucune FC max spécifique n'est renseignée." },
  { cle: "hrSeuil", colonne: "hr_threshold", libelle: "FC seuil", unite: "bpm", groupe: "general", nature: "entier", provenanceDeclarable: true },
  { cle: "vo2max", colonne: "vo2max", libelle: "VO2max", unite: "ml/kg/min", groupe: "general", nature: "decimal", provenanceDeclarable: true },

  /* ── Course ─────────────────────────────────────────────────────────── */
  { cle: "vmaCourseKmh", colonne: "vma_kmh", libelle: "VMA", unite: "km/h", groupe: "course", nature: "decimal", provenanceDeclarable: true, aide: "Référence de toutes les zones de vitesse et d'allure en course." },
  { cle: "vitesseCritiqueKmh", colonne: "critical_speed_kmh", libelle: "Vitesse critique", unite: "km/h", groupe: "course", nature: "decimal", provenanceDeclarable: true },
  { cle: "ftpRunWatts", colonne: "ftp_run_watts", libelle: "FTP course", unite: "W", groupe: "course", nature: "decimal", provenanceDeclarable: true },
  { cle: "puissanceCritiqueRunWatts", colonne: "critical_power_run_watts", libelle: "Puissance critique course", unite: "W", groupe: "course", nature: "decimal", provenanceDeclarable: true },
  { cle: "hrMaxCourse", colonne: "hr_max_run", libelle: "FC max course", unite: "bpm", groupe: "course", nature: "entier", provenanceDeclarable: true, aide: "Facultative. Vide, les zones FC de la course utilisent la FC max générale." },

  /* ── Vélo ───────────────────────────────────────────────────────────── */
  { cle: "ftpWatts", colonne: "ftp_watts", libelle: "FTP", unite: "W", groupe: "velo", nature: "decimal", provenanceDeclarable: true, aide: "Référence des zones %FTP." },
  { cle: "pmaWatts", colonne: "pma_watts", libelle: "PMA", unite: "W", groupe: "velo", nature: "decimal", provenanceDeclarable: true, aide: "Référence des zones %PMA — distincte du FTP, jamais déduite de lui." },
  { cle: "puissanceCritiqueWatts", colonne: "critical_power_watts", libelle: "Puissance critique", unite: "W", groupe: "velo", nature: "decimal", provenanceDeclarable: true },
  { cle: "hrMaxVelo", colonne: "hr_max_bike", libelle: "FC max vélo", unite: "bpm", groupe: "velo", nature: "entier", provenanceDeclarable: true, aide: "Facultative. Vide, les zones FC du vélo utilisent la FC max générale." },

  /* ── Natation ───────────────────────────────────────────────────────── */
  { cle: "vmaNatationKmh", colonne: "vma_swim_kmh", libelle: "VMA natation", unite: "km/h", groupe: "natation", nature: "decimal", provenanceDeclarable: true, aide: "L'allure de natation s'exprime en min/100 m." },
  { cle: "vitesseCritiqueNatationKmh", colonne: "critical_speed_swim_kmh", libelle: "Vitesse critique natation", unite: "km/h", groupe: "natation", nature: "decimal", provenanceDeclarable: true },
  { cle: "hrMaxNatation", colonne: "hr_max_swim", libelle: "FC max natation", unite: "bpm", groupe: "natation", nature: "entier", provenanceDeclarable: true, aide: "Facultative. Vide, les zones FC de la natation utilisent la FC max générale." },
];

export const LIBELLE_GROUPE: Readonly<Record<GroupePhysio, string>> = {
  general: "Général",
  course: "Course",
  velo: "Cyclisme",
  natation: "Natation",
};

export function champsDuGroupe(groupe: GroupePhysio): readonly ChampPhysio[] {
  return CHAMPS_PHYSIO.filter((champ) => champ.groupe === groupe);
}

export function champParCle(cle: string): ChampPhysio | undefined {
  return CHAMPS_PHYSIO.find((champ) => champ.cle === cle);
}

/* ════════════════════════════════════════════════════════════════════════
 * SAISIE ← → BASE
 * ════════════════════════════════════════════════════════════════════════ */

/** Ce que les champs du formulaire portent : du texte, rien que du texte. */
export type SaisiePhysio = Readonly<Record<string, string>>;

/** Pré-remplit le formulaire depuis la lecture. Une valeur absente → "". */
export function saisieDepuisPhysiologie(physio: PhysiologieBrute): Record<string, string> {
  const saisie: Record<string, string> = {};
  for (const champ of CHAMPS_PHYSIO) {
    const valeur = physio[champ.cle];
    saisie[champ.cle] =
      valeur === null || valeur === undefined ? "" : typeof valeur === "number" ? String(valeur) : String(valeur);
  }
  return saisie;
}

/** Les provenances déclarées, pré-remplies depuis `physio_sources`. */
export function provenancesDepuisPhysiologie(physio: PhysiologieBrute): Record<string, SourceValeur> {
  const provenances: Record<string, SourceValeur> = {};
  for (const champ of CHAMPS_PHYSIO) {
    if (!champ.provenanceDeclarable) continue;
    provenances[champ.cle] = physio.sources[champ.colonne] ?? "mesuree";
  }
  return provenances;
}

export interface ResultatValidation {
  readonly ok: boolean;
  /** Message par clé de champ — vide quand tout passe. */
  readonly erreurs: Readonly<Record<string, string>>;
  /** Prêt pour `enregistrerPhysiologie`. Présent seulement si `ok`. */
  readonly ecriture: EcriturePhysiologie | null;
}

/**
 * Valide la saisie et construit l'écriture.
 *
 * ⚠️ UNE SEULE VALEUR REFUSÉE BLOQUE TOUT L'ENREGISTREMENT. Écrire les champs
 * valides et signaler les autres laisserait le profil à moitié à jour sans que
 * le coach sache lesquels sont passés.
 *
 * ⚠️ LA PROVENANCE N'EST CONSERVÉE QUE POUR UNE VALEUR PRÉSENTE. Déclarer
 * « estimée » sur un champ vidé laisserait une provenance orpheline qui
 * réapparaîtrait à la prochaine saisie.
 */
export function ecritureDepuisSaisie(
  saisie: SaisiePhysio,
  provenances: Readonly<Record<string, SourceValeur>>,
  provenancesExistantes: Readonly<Record<string, SourceValeur>> = {},
): ResultatValidation {
  const erreurs: Record<string, string> = {};
  const colonnes: Record<string, string | number | null> = {};
  // On repart des provenances déjà en base pour ne pas effacer celle d'une
  // colonne qui n'est pas dans ce formulaire.
  const sources: Record<string, SourceValeur> = { ...provenancesExistantes };

  for (const champ of CHAMPS_PHYSIO) {
    const brut = (saisie[champ.cle] ?? "").trim();

    if (brut === "") {
      colonnes[champ.colonne] = null;
      delete sources[champ.colonne];
      continue;
    }

    if (champ.nature === "choix") {
      if (!OPTIONS_SEXE.some((option) => option.value === brut)) {
        erreurs[champ.cle] = "Valeur non autorisée.";
        continue;
      }
      colonnes[champ.colonne] = brut;
      continue;
    }

    if (champ.nature === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(brut) || Number.isNaN(Date.parse(brut))) {
        erreurs[champ.cle] = "Date attendue au format AAAA-MM-JJ.";
        continue;
      }
      colonnes[champ.colonne] = brut;
      continue;
    }

    // Virgule décimale acceptée : c'est ce qu'un clavier français produit.
    const normalise = brut.replace(",", ".");
    const nombre = Number(normalise);
    if (!Number.isFinite(nombre)) {
      erreurs[champ.cle] = "Nombre attendu.";
      continue;
    }
    if (nombre <= 0) {
      erreurs[champ.cle] = "Valeur strictement positive attendue.";
      continue;
    }
    if (champ.nature === "entier" && !Number.isInteger(nombre)) {
      erreurs[champ.cle] = "Nombre entier attendu.";
      continue;
    }
    colonnes[champ.colonne] = nombre;
    if (champ.provenanceDeclarable) {
      sources[champ.colonne] = provenances[champ.cle] === "estimee" ? "estimee" : "mesuree";
    }
  }

  if (Object.keys(erreurs).length > 0) {
    return { ok: false, erreurs, ecriture: null };
  }
  return { ok: true, erreurs: {}, ecriture: { colonnes, sources } };
}

/**
 * Âge en années révolues à une date donnée — AFFICHAGE UNIQUEMENT.
 *
 * ⚠️ CETTE FONCTION NE SERT À AUCUN CALCUL PHYSIOLOGIQUE. Elle est ici et pas
 * dans `lib/physiologie.ts` précisément pour que le module de calcul reste
 * incapable de dériver une FC max d'un âge.
 */
export function ageAffiche(birthDate: string | null, aujourdhui: Date): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [annee, mois, jour] = birthDate.split("-").map(Number);
  let age = aujourdhui.getFullYear() - annee;
  const moisCourant = aujourdhui.getMonth() + 1;
  const jourCourant = aujourdhui.getDate();
  if (moisCourant < mois || (moisCourant === mois && jourCourant < jour)) age -= 1;
  return age >= 0 ? age : null;
}
