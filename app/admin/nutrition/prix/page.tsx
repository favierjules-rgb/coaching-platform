import Link from "next/link";

import { requireAdmin } from "@/lib/supabase/guards";

/**
 * COURSES C3 → C4.1 — LA PAGE DES PRIX ESTIMATIFS, DÉSORMAIS DÉSACTIVÉE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE PAGE NE REND PLUS DE FORMULAIRE
 * ════════════════════════════════════════════════════════════════════════════
 * Le besoin produit a changé. Le parcours cible est désormais :
 *
 *     aliment générique  →  PRODUIT RÉEL (code-barres OFF)  →  PRIX OBSERVÉ
 *
 * Un prix alimentaire saisi à la main n'a plus sa place dans ce parcours : il
 * est invérifiable, il ne dépend d'aucun magasin, et il vieillit sans que
 * personne ne s'en aperçoive. Laisser le formulaire accessible « en attendant
 * C4.3 » aurait un défaut précis — il marcherait. Il remplirait la base de
 * chiffres plausibles que le nouveau moteur devrait ensuite départager, et
 * l'écran budget de l'élève ne saurait plus dire d'où vient un montant.
 *
 * ⚠️ IL EST PRÉFÉRABLE QUE L'ÉLÈVE VOIE « AUCUNE ESTIMATION DISPONIBLE » plutôt
 * qu'un montant fabriqué. C'est exactement la doctrine de couverture honnête
 * écrite en C3 : une absence affichée vaut mieux qu'un chiffre qu'on ne peut
 * pas justifier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI N'A PAS ÉTÉ SUPPRIMÉ, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════════
 * Rien d'autre. Ni la table `food_price_estimates`, ni sa migration (appliquée
 * en production le 16/09 — une migration distante ne se réécrit jamais), ni
 * `publierPrix`, ni `components/admin/PrixEstimatifsAdmin.tsx`, ni les tests
 * C3 qui les couvrent.
 *
 * L'accès est fermé ; le code reste, intact et testé, jusqu'au lot C4.4 qui
 * fera le retrait complet une fois C4.3 en service. Supprimer maintenant
 * produirait un grand diff, casserait la suite C3, et ne rendrait rien de plus
 * à personne : la table compte **zéro ligne** en production.
 */
export default async function PagePrixEstimatifs() {
  await requireAdmin();

  return (
    <section
      className="flex flex-col gap-4 p-4"
      aria-label="Prix estimatifs — fonctionnalité retirée"
    >
      <h1 className="text-lg font-semibold">PRIX ESTIMATIFS — RETIRÉ</h1>

      <p className="text-sm text-muted-foreground" role="status">
        La saisie manuelle d&apos;un prix alimentaire n&apos;est plus proposée. Les prix
        proviennent désormais de relevés réels observés en magasin, rattachés à des produits
        existants&nbsp;: un prix ne se saisit plus, il se constate.
      </p>

      <p className="text-sm text-muted-foreground">
        Le travail d&apos;administration consiste maintenant à rattacher un aliment du catalogue à
        des produits réels, par son code Ciqual.
      </p>

      <Link
        href="/admin/nutrition/pont"
        className="min-h-11 self-start rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition"
      >
        ALLER AU PONT PRODUITS
      </Link>

      <p className="text-xs text-muted-foreground">
        Tant que les prix réels ne sont pas branchés, l&apos;écran budget de l&apos;élève affiche
        «&nbsp;aucune estimation disponible&nbsp;». C&apos;est volontaire, et préférable à un
        montant fabriqué.
      </p>
    </section>
  );
}
