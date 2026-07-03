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
      foodPreferences={foodPreferences}
      sportPreferences={sportPreferences}
      injuryNote={injuryNote}
      studentGoal={studentGoal}
    />
  );
}
