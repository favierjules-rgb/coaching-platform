/**
 * Table de décision UNIQUE du provisionnement des programmes (correction
 * produit, feat/student-workout-history) — fonctions pures, aucune dépendance.
 *
 * Les trois modes officiels de création (app/admin/programmes/nouveau) sont
 * représentés en base par DEUX champs explicites, et rien d'autre :
 *
 *   - `programs.program_mode`  : "individuel" | "groupe"  (pôle de coaching) ;
 *   - `programs.is_public`     : true = pôle « home page / achat unique ».
 *
 * (`programs.program_type` existe mais n'est JAMAIS écrit par l'application —
 * simple valeur par défaut héritée du schéma, ignorée ici volontairement.)
 *
 * Règles produit :
 *   groupe        → "shared"          (partage voulu : un planning commun,
 *                                      chaque élève garde SES feedbacks) ;
 *   individuel    → "individual-copy" (copie par élève, owner/source posés) ;
 *   achat unique  → "individual-copy" (copie par acheteur ; le programme
 *                                      commercial du catalogue reste le
 *                                      modèle, jamais assigné directement).
 *
 * La décision ne repose ni sur l'origine de l'appel (Stripe ou coach), ni sur
 * le nombre d'élèves assignés, ni sur une déduction implicite : uniquement
 * sur ces champs. Tous les chemins d'affectation DOIVENT passer par ici.
 */

export type ProgramProvisioningMode = "shared" | "individual-copy";

export interface ProgramModeFields {
  /** `programs.program_mode` — "individuel" | "groupe" (null sur de très vieux enregistrements). */
  programMode?: string | null;
  /** `programs.is_public` — pôle achat unique / home page. */
  isPublic?: boolean | null;
}

export function resolveProgramProvisioningMode(program: ProgramModeFields): ProgramProvisioningMode {
  // Seul le mode groupe, EXPLICITE, autorise le partage.
  if (program.programMode === "groupe") {
    return "shared";
  }
  // Individuel, achat unique, et tout mode absent ou inconnu : copie
  // individuelle. En cas d'ambiguïté on ne partage JAMAIS par accident —
  // c'est le sens de la règle produit.
  return "individual-copy";
}

/**
 * §5 (contrôle technique) — combinaison CONTRADICTOIRE `groupe` +
 * `is_public=true` : les deux pôles sont exclusifs par construction produit
 * (un programme de groupe est un planning de coaching partagé, jamais une
 * fiche de vente de la home). Politique retenue, jamais d'ambiguïté
 * silencieuse :
 *
 *   - à l'ÉCRITURE (createProgram / updateProgram) : NORMALISATION — le mode
 *     groupe force `is_public=false` (et aucun template d'abonnement public),
 *     la combinaison n'est donc jamais stockée par l'application ;
 *   - à la LECTURE (provisionnement) : si une ligne contradictoire existait
 *     malgré tout (écriture hors application), le mode groupe explicite
 *     l'emporte (→ "shared", cohérent avec resolveProgramProvisioningMode)
 *     et l'incohérence est SIGNALÉE via ce prédicat (devWarn côté appelant).
 */
export function isContradictoryProgramMode(program: ProgramModeFields): boolean {
  return program.programMode === "groupe" && program.isPublic === true;
}
