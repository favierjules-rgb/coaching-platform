/**
 * Réparation des copies individuelles privées de leurs prescriptions cardio
 * (chantier fix/program-copy-training-prescriptions, §6).
 *
 * ⚠️ CE SCRIPT N'A JAMAIS ÉTÉ EXÉCUTÉ EN PRODUCTION. À lancer manuellement
 * après validation explicite — et après application de la migration
 * 20260802190000 (sinon toute nouvelle copie renaîtra incomplète).
 *
 *   npx tsx scripts/reparation-copies-cardio.mts            → DRY-RUN (défaut)
 *   npx tsx scripts/reparation-copies-cardio.mts --apply    → application réelle
 *
 * GARDES STRICTES — le script REFUSE de réparer quand :
 *   - source_template_id est NULL ou le modèle n'existe plus (classe C :
 *     rien n'est recréé par supposition — la copie est listée, sans action) ;
 *   - la correspondance structurelle bloc↔bloc est AMBIGUË (clé
 *     semaine::jour::position non bijective, nombres de blocs différents) ;
 *   - le bloc de la copie possède DÉJÀ au moins une prescription (jamais de
 *     doublon, jamais d'écrasement) ;
 *   - la source porte des prescriptions PAR EXERCICE (hors périmètre de
 *     cette réparation — signalées, non copiées automatiquement).
 * Aucune assignation, aucun email : uniquement des INSERT
 * training_prescriptions rattachés aux blocs de la copie. Rapport
 * avant/après (prescriptions et segments par copie) dans les deux modes.
 *
 * Prérequis : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans
 * l'environnement (jamais en argument, jamais journalisées).
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../types/supabase";

type Ligne = Record<string, unknown>;

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.");
    process.exit(1);
  }
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log(apply ? "MODE APPLICATION (écritures réelles)" : "MODE DRY-RUN (aucune écriture)");

  // 1. Copies individuelles possédant des blocs cardio.
  const { data: copies, error: copiesError } = await supabase
    .from("programs")
    .select("id, name, source_template_id")
    .not("owner_student_id", "is", null);
  if (copiesError) throw new Error(copiesError.message);

  let erreurs = 0;
  for (const copie of copies ?? []) {
    const structureCopie = await chargerStructure(supabase, copie.id);
    const nbBlocsCardio = structureCopie.blocs.filter((b) => b.block_type === "cardio").length;
    if (nbBlocsCardio === 0) continue;

    const avant = structureCopie.prescriptions.length;
    console.log(`\n── Copie ${copie.id} (« ${String(copie.name).slice(0, 30)} ») — ${nbBlocsCardio} bloc(s) cardio, ${avant} prescription(s)`);

    // Garde : source absente ou supprimée → classe C, AUCUNE action.
    if (!copie.source_template_id) {
      console.log("   REFUS (classe C) : source_template_id NULL — modèle supprimé, reconstruction automatique impossible.");
      continue;
    }
    const structureSource = await chargerStructure(supabase, copie.source_template_id);
    if (structureSource.blocs.length === 0 && structureSource.prescriptions.length === 0) {
      console.log("   REFUS (classe C) : le modèle source n'existe plus ou est vide.");
      continue;
    }
    // Garde : prescriptions par exercice côté source → hors périmètre.
    if (structureSource.prescriptionsExercice > 0) {
      console.log(`   REFUS : ${structureSource.prescriptionsExercice} prescription(s) PAR EXERCICE côté source — hors périmètre de cette réparation.`);
      erreurs += 1;
      continue;
    }
    // Correspondance structurelle bloc↔bloc : semaine::jour::position, bijective.
    const cleDe = (b: Ligne) => `${b.week_number}::${b.day}::${b.position}`;
    const parCleSource = new Map<string, Ligne>();
    const parCleCopie = new Map<string, Ligne>();
    let ambigu = false;
    for (const b of structureSource.blocs) {
      if (parCleSource.has(cleDe(b))) ambigu = true;
      parCleSource.set(cleDe(b), b);
    }
    for (const b of structureCopie.blocs) {
      if (parCleCopie.has(cleDe(b))) ambigu = true;
      parCleCopie.set(cleDe(b), b);
    }
    if (ambigu || parCleSource.size !== parCleCopie.size) {
      console.log("   REFUS : correspondance bloc↔bloc ambiguë (clés non bijectives) — réparation manuelle requise.");
      erreurs += 1;
      continue;
    }

    let planifiees = 0;
    for (const [cle, blocCopie] of parCleCopie) {
      const blocSource = parCleSource.get(cle);
      if (!blocSource) { ambigu = true; break; }
      const prescSource = structureSource.prescriptions.filter((p) => p.block_id === blocSource.id);
      const prescCopie = structureCopie.prescriptions.filter((p) => p.block_id === blocCopie.id);
      if (prescSource.length === 0) continue;
      if (prescCopie.length > 0) {
        console.log(`   bloc ${cle} : ${prescCopie.length} prescription(s) déjà présentes — intact (jamais de doublon).`);
        continue;
      }
      planifiees += prescSource.length;
      console.log(`   bloc ${cle} : ${prescSource.length} prescription(s) à recopier${apply ? "" : " (dry-run)"}`);
      if (apply) {
        // Parents d'abord (mapping ancien → nouveau), puis enfants remappés.
        const mapping = new Map<string, string>();
        const parents = prescSource.filter((p) => !p.parent_prescription_id).sort((a, b) => Number(a.position) - Number(b.position));
        const enfants = prescSource.filter((p) => p.parent_prescription_id).sort((a, b) => Number(a.position) - Number(b.position));
        const champsCopiables = (ligne: Ligne): Ligne => {
          const champs = { ...ligne };
          delete champs.id;
          delete champs.created_at;
          delete champs.updated_at;
          return champs;
        };
        for (const parent of parents) {
          const { data: insere, error } = await supabase
            .from("training_prescriptions")
            .insert({ ...champsCopiables(parent), block_id: blocCopie.id, exercise_id: null, parent_prescription_id: null } as never)
            .select("id")
            .single();
          if (error || !insere) throw new Error(`insert parent : ${error?.message}`);
          mapping.set(String(parent.id), insere.id);
        }
        for (const enfant of enfants) {
          const nouveauParent = mapping.get(String(enfant.parent_prescription_id));
          if (!nouveauParent) throw new Error("parent introuvable dans le mapping — abandon");
          const { error } = await supabase
            .from("training_prescriptions")
            .insert({ ...champsCopiables(enfant), block_id: blocCopie.id, exercise_id: null, parent_prescription_id: nouveauParent } as never);
          if (error) throw new Error(`insert enfant : ${error.message}`);
        }
      }
    }

    const apres = apply ? (await chargerStructure(supabase, copie.id)).prescriptions.length : avant + planifiees;
    console.log(`   RAPPORT : avant ${avant} → ${apply ? "après" : "prévu"} ${apres} prescription(s).`);
  }

  console.log(`\n${apply ? "Réparation terminée" : "Dry-run terminé"}${erreurs > 0 ? ` — ${erreurs} copie(s) nécessitant une décision manuelle.` : "."}`);
  if (erreurs > 0) process.exit(1);
}

/** Blocs (avec semaine/jour/position) + prescriptions d'un programme. */
async function chargerStructure(supabase: ReturnType<typeof createClient<Database>>, programId: string) {
  const { data: semaines } = await supabase.from("program_weeks").select("id, week_number").eq("program_id", programId);
  const semainesIds = (semaines ?? []).map((w) => w.id);
  const { data: seances } = semainesIds.length
    ? await supabase.from("workout_sessions").select("id, program_week_id, day").in("program_week_id", semainesIds)
    : { data: [] };
  const numeroSemaine = new Map((semaines ?? []).map((w) => [w.id, w.week_number]));
  const seancesIds = (seances ?? []).map((s) => s.id);
  const { data: blocsBruts } = seancesIds.length
    ? await supabase.from("training_blocks").select("*").in("session_id", seancesIds)
    : { data: [] };
  const infoSeance = new Map((seances ?? []).map((s) => [s.id, s]));
  const blocs = (blocsBruts ?? []).map((b) => ({
    ...b,
    day: infoSeance.get(b.session_id)?.day,
    week_number: numeroSemaine.get(infoSeance.get(b.session_id)?.program_week_id ?? ""),
  }));
  const blocsIds = blocs.map((b) => b.id);
  const { data: prescriptions } = blocsIds.length
    ? await supabase.from("training_prescriptions").select("*").in("block_id", blocsIds)
    : { data: [] };
  const { data: prescExo } = seancesIds.length
    ? await supabase
        .from("training_prescriptions")
        .select("id, exercise_id, workout_exercises!inner(session_id)")
        .in("workout_exercises.session_id", seancesIds)
    : { data: [] };
  return {
    blocs: blocs as Ligne[],
    prescriptions: (prescriptions ?? []) as Ligne[],
    prescriptionsExercice: (prescExo ?? []).length,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
