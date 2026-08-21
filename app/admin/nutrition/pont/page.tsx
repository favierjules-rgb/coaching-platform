import { PontRetailAdmin } from "@/components/admin/PontRetailAdmin";
import { requireAdmin } from "@/lib/supabase/guards";

/**
 * COURSES C4.1 — la page d'administration du pont aliment → produit réel.
 *
 * ⚠️ `requireAdmin()`, PAS `requireAdminOrCoach()`. `app/admin/layout.tsx` ouvre
 * toute la section admin aux coachs, et c'est voulu pour presque tout. Le pont
 * produit n'en fait pas partie : il rattache des produits à des aliments
 * GLOBAUX, partagés par tous les élèves de tous les coachs. Même arbitrage
 * qu'en C3 pour les prix (défaut D-3 de l'audit adverse).
 *
 * ⚠️ ET CETTE GARDE NE PROTÈGE RIEN — elle évite seulement de montrer un écran
 * dont chaque bouton échouerait. La protection réelle est côté serveur :
 * `requireAdmin()` de `lib/api/authz` sur les trois routes, et
 * `grant select` seul sur `food_catalog_retail_review`, filtré par
 * `is_admin()`. Doctrine C0.1 — une garde cliente ne suffit jamais.
 */
export default async function PagePontRetail() {
  await requireAdmin();
  return <PontRetailAdmin />;
}
