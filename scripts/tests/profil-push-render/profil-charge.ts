/**
 * LE PROFIL SUPABASE, TEL QU'IL ARRIVE QUAND TOUT VA BIEN.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * La suite `parcours-offline-render` ne montait `/profil` que HORS LIGNE
 * (PROF1). Le chemin NOMINAL — un vrai élève, une vraie fiche, le réseau
 * qui répond — n'était monté nulle part. C'est exactement celui qui était
 * cassé : `/profil` restait sur « Chargement du profil… » indéfiniment pour
 * tous les élèves Supabase, en ligne comme en PWA.
 *
 * On substitue donc `@/hooks/useSupabaseStudentProfile` par ce module, qui
 * rend ce que le vrai hook rend quand la requête aboutit — forme COMPLÈTE
 * (`ready`, `state`, `accessType`, `email`, et les cinq mutateurs), pour que
 * `ProfilPageContent` s'exécute exactement comme en production.
 *
 * Rien d'autre n'est substitué : le composant, ses gardes, ses sections,
 * `useEtatOfflineEleve`, `useNotificationsPush` et `NotificationsSection`
 * sont le code de production.
 */

const PROFIL_CHARGE = {
  profile: {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    firstName: "Camille",
    lastName: "Réelle",
    goal: "Prise de force",
    level: "Intermédiaire",
    startDate: "2026-02-03",
    weekNumber: 5,
    age: 29,
    heightCm: 171,
    currentWeightKg: 63.4,
    targetWeightKg: 61,
    trainingFrequencyPerWeek: 4,
    trainingLocation: "Salle",
    coachingStatus: "actif",
  },
  weightHistory: [],
  measurements: [],
  customMeasurements: [],
  measurementHistory: [],
  photos: [],
};

/** Le prénom de démonstration ne doit JAMAIS apparaître : c'est celui-ci qu'on attend. */
export const PRENOM_REEL = PROFIL_CHARGE.profile.firstName;

/**
 * `charge = false` rejoue l'instant où la vérification Supabase n'a pas
 * encore rendu son verdict (`ready: false`) : le seul moment où
 * « Chargement du profil… » est légitime.
 */
function charge(): boolean {
  return (globalThis as unknown as { __PROFIL_CHARGE?: boolean }).__PROFIL_CHARGE !== false;
}

export function useSupabaseStudentProfile() {
  const rien = async () => {};
  const faux = async () => false;
  return {
    ready: charge(),
    state: charge() ? PROFIL_CHARGE : null,
    accessType: "coaching" as const,
    email: "camille@example.com",
    updateProfile: faux,
    updateWeight: faux,
    updateMeasurements: rien,
    addPhoto: rien,
    removePhoto: rien,
  } as unknown as ReturnType<typeof import("@/hooks/useSupabaseStudentProfile").useSupabaseStudentProfile>;
}
