import { Dumbbell } from "lucide-react";

import { PageComingSoon } from "@/components/student/PageComingSoon";

export default function EntrainementPage() {
  return (
    <PageComingSoon
      icon={Dumbbell}
      title="Entraînement"
      description="La liste de tes programmes et le détail de tes séances (échauffement, exercices, séries, charges) arrivent dans une prochaine étape."
    />
  );
}
