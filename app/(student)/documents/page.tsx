import { FileText } from "lucide-react";

import { PageComingSoon } from "@/components/student/PageComingSoon";

export default function DocumentsPage() {
  return (
    <PageComingSoon
      icon={FileText}
      title="Documents"
      description="La bibliothèque complète de tes documents (PDF, vidéos, guides) mise à disposition par ton coach arrive dans une prochaine étape."
    />
  );
}
