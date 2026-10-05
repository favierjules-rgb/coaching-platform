import { ProfilPageContent } from "@/components/student/ProfilPageContent";
import {
  bodyMeasurements,
  customMeasurements,
  foodPreferences,
  injuryNote,
  progressPhotos,
  sportPreferences,
  student,
  studentGoal,
  weightHistory,
} from "@/data/student";

/**
 * ⚠️ LES QUATRE VALEURS DE `demonstration` VIENNENT DE `data/student.ts`, ET
 * LE NOM LE DIT (P8).
 *
 * Elles étaient passées en quatre props anonymes — `foodPreferences`,
 * `sportPreferences`, `injuryNote`, `studentGoal` — que rien ne distinguait
 * d'une donnée réelle : il fallait ouvrir ce fichier pour savoir d'où elles
 * sortaient. `ProfilPageContent` ne les rend que dans sa branche de
 * démonstration, atteinte seulement quand Supabase n'est pas configuré.
 *
 * Pour un élève Supabase, les quatre mêmes sections sont rendues depuis
 * `student_profiles` — la source que le coach lit déjà (voir
 * lib/profil-eleve-onboarding.ts). Aucune de ces fixtures ne l'atteint.
 */
export default function ProfilPage() {
  return (
    <ProfilPageContent
      studentId={student.id}
      seed={{
        profile: student,
        weightHistory,
        measurements: bodyMeasurements,
        customMeasurements,
        measurementHistory: [],
        photos: progressPhotos,
      }}
      demonstration={{ foodPreferences, sportPreferences, injuryNote, studentGoal }}
    />
  );
}
