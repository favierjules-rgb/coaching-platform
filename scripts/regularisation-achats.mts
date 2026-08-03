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
  const argProgramme = process.argv.find((a) => a.startsWith("--program-id="))?.slice("--program-id=".length)
    ?? (process.argv.includes("--program-id") ? process.argv[process.argv.indexOf("--program-id") + 1] : undefined);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans l'environnement.");
    process.exit(1);
  }
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // SÉCURITÉS --apply : cible EXPLICITE obligatoire, une seule ACTION
  // PROPOSÉE attendue, préconditions revérifiées par une passe dry-run
  // immédiatement avant l'écriture. Les NO-OP sont ignorés, tout REFUS
  // bloque. Ce script ne supprime jamais un modèle ni ses séances et
  // n'écrit jamais dans workout_feedback (le module ne le fait pas).
  let cibles = CIBLES_REGULARISATION_2026_08;
  if (apply) {
    if (!argProgramme) {
      console.error("REFUS : --apply exige un ciblage explicite, ex. --program-id=1b67fc3b-031d-4088-adac-d98b04d2cf95");
      process.exit(1);
    }
    cibles = CIBLES_REGULARISATION_2026_08.filter((c) => c.programId === argProgramme);
    if (cibles.length !== 1) {
      console.error(`REFUS : --program-id=${argProgramme} ne correspond à aucune cible connue.`);
      process.exit(1);
    }
    // Revérification des préconditions JUSTE AVANT l'écriture : passe dry-run.
    const controle = await executerRegularisation(supabase, cibles, { dryRun: true });
    const actionsProposees = controle.decisions.filter((d) => d.decision === "ACTION PROPOSÉE");
    if (controle.decisions.some((d) => d.decision === "REFUS")) {
      console.error("REFUS : la revérification signale un état ambigu — aucune écriture.");
      for (const d of controle.decisions) console.error(`  ${d.cible} — ${d.decision} : ${d.raison}`);
      process.exit(1);
    }
    if (actionsProposees.length === 0) {
      console.log("NO-OP : la revérification ne propose aucune action — rien à appliquer.");
      process.exit(0);
    }
    if (actionsProposees.length !== 1) {
      console.error(`REFUS : ${actionsProposees.length} actions proposées, 1 attendue — aucune écriture.`);
      process.exit(1);
    }
    console.log(`CIBLE CONFIRMÉE : programme ${argProgramme} (${actionsProposees[0].cible})`);
    console.log(`  avant : ${JSON.stringify(actionsProposees[0].avant)}`);
    console.log(`  après prévu : ${JSON.stringify(actionsProposees[0].apresPrevu)}`);
  } else if (argProgramme) {
    cibles = CIBLES_REGULARISATION_2026_08.filter((c) => c.programId === argProgramme);
  }

  console.log(apply ? "MODE APPLICATION (écritures réelles)" : "MODE DRY-RUN (aucune écriture)");
  const rapport = await executerRegularisation(supabase, cibles, { dryRun: !apply });

  for (const d of rapport.decisions) {
    console.log(`\n═══ ${d.cible} — ${d.decision}`);
    console.log(`    raison : ${d.raison}`);
    for (const p of d.preconditions) console.log(`    précondition : ${p}`);
    console.log(`    avant : ${JSON.stringify(d.avant)}`);
    console.log(`    après prévu : ${JSON.stringify(d.apresPrevu)}`);
  }
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
