import type { SupabaseStudentProfile } from "@/types";

/**
 * LE PROFIL D'ONBOARDING, VU PAR L'ÉLÈVE — vues d'affichage PURES (P8).
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ
 * ════════════════════════════════════════════════════════════════════════
 * `/profil` rendait ses quatre blocs — préférences alimentaires, préférences
 * sportives, blessures, objectifs — depuis `data/student.ts`, et uniquement
 * dans la branche de DÉMONSTRATION (`!useSupabase`). Conséquence mesurée le
 * 05/10/2026 : un élève Supabase ne voyait **aucun** de ces quatre blocs dans
 * le corps de la page. Ses réponses existaient bien — le coach les lit tous
 * les jours dans `/admin/eleves/[studentId]` — mais elles ne lui étaient
 * rendues que derrière la modale « Voir mes informations complètes ».
 *
 * ⚠️ LA SOURCE EST CELLE DU COACH, PAS UNE SECONDE. Les champs lus ici sont
 * exactement ceux que lit `app/admin/eleves/[studentId]/page.tsx` dans sa
 * branche `onboardingProfile` : `dietType`, `dislikedFoods`, `allergies`,
 * `intolerances`, `sportsPracticed`, `availableEquipment`,
 * `avoidedExercises`, `onboardingInjuries`, `mainGoal`, `secondaryGoals`…
 * Deux écrans qui liraient deux colonnes différentes finiraient par afficher
 * deux profils, et c'est l'élève qui découvrirait l'écart devant son coach.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS COLONNES SONT MORTES, ET ON NE LES LIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Mesuré sur les 32 profils de production :
 *
 *   · `sport_preferences` (jsonb) — `{}` sur 32/32. JAMAIS écrit par le
 *     dépôt (`buildProfileUpdate` ne le nomme pas). Les préférences sportives
 *     vivent dans les colonnes plates ;
 *   · `injury_note` (jsonb) — `{}` sur 32/32, jamais écrit non plus. Les
 *     blessures vivent dans `injuries` (texte) ;
 *   · `priority` — `null` sur 32/32, lu mais jamais écrit ;
 *   · `tracked_indicators` — `[]` sur 32/32 (lu et affiché côté coach).
 *
 * ⚠️ `SupabaseStudentProfile.sportPreferences` ET `.injuryNote` NE SONT DONC
 * PAS LUS ICI. Les afficher rendrait quatre listes structurellement vides et
 * un texte toujours vide, que l'élève lirait comme « je n'ai rien répondu »
 * alors qu'il a répondu — ailleurs.
 *
 * ⚠️ `foodPreferences.liked` EST L'EXCEPTION, ET ELLE EST DÉLIBÉRÉE. C'est la
 * SEULE clé que `food_preferences` porte (32/32 l'ont, et elle seule), la
 * seule que `buildProfileUpdate` écrive, et celle que le coach lit à la ligne
 * 824 de sa page. Les clés `disliked` / `intolerances` / `diet` du même JSONB
 * sont absentes de 32/32 : on ne les lit pas, leurs équivalents vivants sont
 * `dislikedFoods`, `intolerances` et `dietType`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI N'EST JAMAIS FABRIQUÉ
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ `pastInjuries`, `recurringPain`, `movementsToAvoid`, `coachRemarks` et
 * `priority` N'ONT AUCUNE COLONNE en base. Les types de démonstration
 * (`InjuryNote`, `StudentGoal`) les portent ; le schéma non. Les vues
 * ci-dessous sont donc volontairement PLUS PAUVRES que ces types : réutiliser
 * `InjuryNote` obligerait à remplir quatre champs qui n'existent pas, donc à
 * inventer. C'est la raison d'être de ce module.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/** Préférences alimentaires, telles que l'élève les a renseignées. */
export interface VuePreferencesAlimentaires {
  readonly alimentsAimes: readonly string[];
  readonly alimentsEvites: readonly string[];
  readonly allergies: readonly string[];
  readonly intolerances: readonly string[];
  readonly regime: string;
  /** `""` quand aucun nombre n'a été renseigné — jamais `"0"`. */
  readonly repasParJour: string;
  readonly horairesDeRepas: string;
  readonly contraintesTravailOuSociales: string;
  readonly notes: string;
}

/** Préférences et contexte sportifs. */
export interface VuePreferencesSportives {
  readonly sportsPratiques: readonly string[];
  readonly autresActivites: readonly string[];
  readonly materielDisponible: readonly string[];
  readonly exercicesPreferesEnSalle: readonly string[];
  readonly exercicesPreferes: readonly string[];
  readonly exercicesAEviter: readonly string[];
  readonly niveauActivite: string;
  readonly lieuDEntrainement: string;
  /** `""` quand aucune fréquence n'a été renseignée — jamais `"0x / semaine"`. */
  readonly seancesParSemaine: string;
}

/**
 * Blessures et contraintes.
 *
 * ⚠️ UN SEUL CHAMP DE BLESSURES, ET C'EST EXACT. La base porte `injuries`
 * (texte libre), pas quatre listes. `exercicesAEviter` l'accompagne parce que
 * c'est ainsi que le coach le présente — même colonne, même voisinage.
 */
export interface VueBlessures {
  readonly douleursEtBlessures: string;
  readonly exercicesAEviter: readonly string[];
  readonly notesSante: string;
  readonly traitements: string;
  readonly medicaments: string;
  readonly notesPourLeCoach: string;
}

/**
 * Objectifs.
 *
 * ⚠️ AUCUNE PRIORITÉ. `student_profiles.priority` est `null` sur 32/32 et
 * n'est écrit nulle part ; l'exposer ici conduirait un appelant à indexer une
 * table de libellés avec `null` et à afficher `undefined`.
 */
export interface VueObjectifs {
  readonly objectifPrincipal: string;
  readonly objectifsSecondaires: readonly string[];
  readonly dateCible: string;
  readonly delaiSouhaite: string;
  readonly indicateursSuivis: readonly string[];
}

export interface VuesProfilOnboarding {
  readonly alimentaire: VuePreferencesAlimentaires;
  readonly sportive: VuePreferencesSportives;
  readonly blessures: VueBlessures;
  readonly objectifs: VueObjectifs;
  /**
   * `false` quand aucune fiche `student_profiles` n'est encore arrivée.
   *
   * ⚠️ CE N'EST PAS « L'ÉLÈVE N'A RIEN RÉPONDU ». C'est « on n'a pas sa
   * fiche ». L'écran doit le DIRE plutôt que d'afficher huit tirets, qui se
   * lisent comme des réponses vides.
   */
  readonly ficheDisponible: boolean;
}

/** Tableau figé : une seule référence pour tous les champs absents. */
const AUCUN: readonly string[] = [];

export const VUES_PROFIL_VIDES: VuesProfilOnboarding = {
  alimentaire: {
    alimentsAimes: AUCUN,
    alimentsEvites: AUCUN,
    allergies: AUCUN,
    intolerances: AUCUN,
    regime: "",
    repasParJour: "",
    horairesDeRepas: "",
    contraintesTravailOuSociales: "",
    notes: "",
  },
  sportive: {
    sportsPratiques: AUCUN,
    autresActivites: AUCUN,
    materielDisponible: AUCUN,
    exercicesPreferesEnSalle: AUCUN,
    exercicesPreferes: AUCUN,
    exercicesAEviter: AUCUN,
    niveauActivite: "",
    lieuDEntrainement: "",
    seancesParSemaine: "",
  },
  blessures: {
    douleursEtBlessures: "",
    exercicesAEviter: AUCUN,
    notesSante: "",
    traitements: "",
    medicaments: "",
    notesPourLeCoach: "",
  },
  objectifs: {
    objectifPrincipal: "",
    objectifsSecondaires: AUCUN,
    dateCible: "",
    delaiSouhaite: "",
    indicateursSuivis: AUCUN,
  },
  ficheDisponible: false,
};

/** Une liste sûre : jamais `undefined`, jamais une valeur non textuelle. */
function liste(valeurs: readonly string[] | null | undefined): readonly string[] {
  if (!Array.isArray(valeurs)) return AUCUN;
  const propres = valeurs.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return propres.length === 0 ? AUCUN : propres;
}

/** Un texte sûr, replié sur `""`. */
function texte(valeur: string | null | undefined): string {
  return typeof valeur === "string" ? valeur.trim() : "";
}

/**
 * Un nombre renseigné, en texte — `""` sinon.
 *
 * ⚠️ `null` ET `0` SONT TRAITÉS PAREIL, ET C'EST VOLONTAIRE ICI. « 0 repas par
 * jour » et « 0 séance par semaine » ne sont pas des réponses : ce sont les
 * valeurs qu'une colonne entière non renseignée prend dans ce projet (voir
 * `toAdminStudent`, qui replie `age`/`heightCm` sur 0). Les afficher ferait
 * passer une absence pour une réponse absurde.
 */
function nombre(valeur: number | null | undefined, suffixe = ""): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur <= 0) return "";
  return `${valeur}${suffixe}`;
}

/**
 * Les quatre vues d'un profil d'onboarding.
 *
 * `null` rend `VUES_PROFIL_VIDES` — dont `ficheDisponible: false`. L'appelant
 * ne doit JAMAIS retomber sur `data/student.ts` dans ce cas : une fiche
 * absente est une information, pas une invitation à montrer un exemple.
 */
export function vuesProfilOnboarding(
  profile: SupabaseStudentProfile | null | undefined,
): VuesProfilOnboarding {
  if (!profile) return VUES_PROFIL_VIDES;

  return {
    alimentaire: {
      // ⚠️ LA SEULE CLÉ VIVANTE DU JSONB, et celle que le coach lit aussi.
      alimentsAimes: liste(profile.foodPreferences?.liked),
      alimentsEvites: liste(profile.dislikedFoods),
      allergies: liste(profile.allergies),
      intolerances: liste(profile.intolerances),
      regime: texte(profile.dietType),
      repasParJour: nombre(profile.preferredMealCount),
      horairesDeRepas: texte(profile.mealTimingNotes),
      contraintesTravailOuSociales: texte(profile.workScheduleNotes),
      notes: texte(profile.nutritionNotes),
    },
    sportive: {
      sportsPratiques: liste(profile.sportsPracticed),
      autresActivites: liste(profile.otherActivities),
      materielDisponible: liste(profile.availableEquipment),
      exercicesPreferesEnSalle: liste(profile.favoriteGymExercises),
      exercicesPreferes: liste(profile.favoriteExercises),
      exercicesAEviter: liste(profile.avoidedExercises),
      niveauActivite: texte(profile.neatLevel),
      lieuDEntrainement: texte(profile.trainingLocation),
      seancesParSemaine: nombre(profile.trainingFrequencyPerWeek, "x / semaine"),
    },
    blessures: {
      douleursEtBlessures: texte(profile.onboardingInjuries),
      exercicesAEviter: liste(profile.avoidedExercises),
      notesSante: texte(profile.healthNotes),
      traitements: texte(profile.medicalTreatments),
      medicaments: texte(profile.medications),
      notesPourLeCoach: texte(profile.trainingNotes),
    },
    objectifs: {
      objectifPrincipal: texte(profile.mainGoal),
      objectifsSecondaires: liste(profile.secondaryGoals),
      dateCible: texte(profile.targetDate),
      delaiSouhaite: texte(profile.targetTimeframe),
      indicateursSuivis: liste(profile.trackedIndicators),
    },
    ficheDisponible: true,
  };
}
