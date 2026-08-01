/**
 * Régularisation des achats/affectations antérieurs à la correction produit
 * (contrôle technique §9-§10, feat/student-workout-history).
 *
 * ⚠️ CE SCRIPT N'A JAMAIS ÉTÉ EXÉCUTÉ EN PRODUCTION. Il est fourni prêt à
 * l'emploi, à lancer manuellement après validation explicite — et après
 * application de la migration 20260801120000 (RPC provision_program_copy),
 * sans laquelle la création de copie retombe sur le clonage applicatif non
 * transactionnel.
 *
 *   npx tsx scripts/regularisation-achats.mts            → DRY-RUN (défaut)
 *   npx tsx scripts/regularisation-achats.mts --apply    → application réelle
 *
 * Le dry-run parcourt EXACTEMENT le même chemin de décision que
 * l'application, sans aucune écriture. `--apply` est idempotent : un second
 * passage (ou une reprise après échec partiel) ne rejoue que les étapes
 * manquantes. NE PAS lancer `--apply` en production sans validation.
 *
 * Prérequis : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans
 * l'environnement (jamais en argument de ligne de commande, jamais
 * journalisées — même tronquées ; convention scripts/audit). Le client est
 * créé ici directement : lib/supabase/admin.ts importe `server-only`, qui
 * refuse volontairement tout contexte hors Next.js.
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../types/supabase";
import { executerRegularisation, CIBLES_REGULARISATION_2026_08 } from "../lib/regularisation-achats";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans l'environnement.");
    process.exit(1);
  }
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(apply ? "MODE APPLICATION (écritures réelles)" : "MODE DRY-RUN (aucune écriture)");
  const rapport = await executerRegularisation(supabase, CIBLES_REGULARISATION_2026_08, { dryRun: !apply });

  for (const action of rapport.actions) {
    console.log(`[${action.statut.padEnd(9)}] ${action.cible} — ${action.type} : ${action.detail}`);
  }
  if (rapport.erreurs.length > 0) {
    console.error("\nErreurs bloquantes :");
    for (const erreur of rapport.erreurs) console.error(`  - ${erreur}`);
    process.exit(1);
  }
  console.log(`\n${rapport.dryRun ? "Dry-run terminé" : "Application terminée"} — ${rapport.actions.length} action(s), 0 erreur.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
