import { PrixEstimatifsAdmin } from "@/components/admin/PrixEstimatifsAdmin";
import { requireAdmin } from "@/lib/supabase/guards";

/**
 * COURSES C3 — la page d'administration des prix estimatifs.
 *
 * ⚠️ DÉFAUT D-3, TROUVÉ PAR L'AUDIT ADVERSE, ET CORRIGÉ ICI.
 * `app/admin/layout.tsx` appelle `requireAdminOrCoach()` : un COACH atteignait
 * donc cette page, y voyait un formulaire complet, et se faisait refuser
 * l'écriture par la base. Sécurisé, mais incohérent avec le produit décidé —
 * les prix sont GLOBAUX et n'appartiennent qu'à l'admin. Montrer un bouton
 * voué à échouer n'est pas une protection, c'est une promesse cassée.
 *
 * `requireAdmin()` referme l'écart CÔTÉ AFFICHAGE. La policy
 * `food_price_estimates_manage_admin` reste la seule protection réelle : elle
 * n'a pas été touchée, et un coach qui contournerait cette page se ferait
 * refuser par la base. Doctrine C0.1 — une garde cliente ne suffit jamais.
 */
export default async function PagePrixEstimatifs() {
  await requireAdmin();
  return <PrixEstimatifsAdmin />;
}
