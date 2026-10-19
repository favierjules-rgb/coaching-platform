/**
 * REFUS D'AUTORISATION SUR UNE AFFECTATION — pourquoi un type à part.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE FAIT MESURÉ
 * ════════════════════════════════════════════════════════════════════════
 * Depuis P13-B, `provision_program_copy` refuse un appelant hors portée
 * (migration 20261011130000) : un collaborateur sans la permission
 * `entrainement / ecriture`, ou sans l'affectation explicite de l'élève,
 * reçoit un `42501`. Le parcours applicatif, lui, écrasait TOUTE erreur de la
 * RPC en un `null`, puis en un `false`, puis en un unique message de modale :
 *
 *     « L'enregistrement a échoué. Ta sélection est conservée — réessaie,
 *       ou vérifie ta connexion. »
 *
 * Le succès n'a jamais été affiché à tort — ce point tenait déjà. Mais le
 * message envoyait un collaborateur réessayer une opération que la base
 * refusera toujours, et lui suggérait une panne réseau inexistante. Un refus
 * de droits n'est pas un échec technique : il ne se corrige pas en cliquant
 * à nouveau.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * ► Il nomme le refus — une erreur DOMAINE, distincte d'un échec de
 *   transport ou d'une panne serveur, pour que la modale puisse dire la
 *   vérité à l'utilisateur.
 *
 * ► Il ne reclasse rien lui-même : la lecture de l'erreur reste celle de
 *   `classerErreur` (lib/offline/source-donnees.ts), déjà en place et déjà
 *   testée, qui rend `"autorisation"` sur un `42501` ou un HTTP 403. Ajouter
 *   un second classificateur aurait créé deux vérités sur la même erreur.
 *
 * ► Il NE PORTE AUCUN DÉTAIL TECHNIQUE. Pas de message SQL, pas de code
 *   d'erreur, pas d'identifiant d'élève ni de programme : seul le NOM de
 *   l'opération refusée voyage, et c'est déjà ce que l'utilisateur sait
 *   puisqu'il vient de la déclencher. Un refus ne doit pas apprendre à son
 *   destinataire l'existence de l'élève qu'il n'a pas le droit de toucher.
 */

/** Pourquoi une écriture d'affectation n'a pas abouti. */
export type NatureEchecAffectation =
  /** La base a refusé : droits insuffisants. Réessayer ne changera rien. */
  | "autorisation"
  /** Tout le reste : panne réseau, 5xx, contrainte, bug applicatif. */
  | "technique";

/**
 * Refus de droits sur une écriture d'affectation.
 *
 * ⚠️ LEVÉE PLUTÔT QUE RENDUE. Les trois étages entre la RPC et la modale
 * (`cloneIndividualProgramCopy` → `individualizeProgramForStudent` →
 * `setProgramAssignment`) rendent `string | null` puis `boolean` : aucun
 * n'a de place pour une cause. Une exception traverse les trois sans
 * toucher à leur signature — donc sans rien changer pour la nutrition et
 * les documents, qui empruntent les mêmes fonctions d'agrégation.
 *
 * ⚠️ ET ELLE NE PEUT PAS DEVENIR UN FAUX SUCCÈS. `terminerAssignation`
 * attrape déjà tout rejet en `ok: false` : même sans le reste de ce lot, un
 * refus laisse la modale ouverte. Ce type ne sert qu'à CHOISIR LE MESSAGE.
 */
export class RefusAutorisationAffectation extends Error {
  /** Marqueur structurel — voir `estRefusAutorisation`. */
  readonly natureEchec: NatureEchecAffectation = "autorisation";

  constructor(
    /**
     * L'opération refusée, en clair et sans détail technique
     * (ex. « affectation de programme »).
     */
    readonly operation: string,
  ) {
    super(`${operation} : autorisation refusée`);
    this.name = "RefusAutorisationAffectation";
  }
}

/**
 * Est-ce un refus de droits ?
 *
 * ⚠️ PAS SEULEMENT `instanceof`. Un `instanceof` suffit dans un module unique,
 * mais une classe dupliquée par le bundler (deux copies du module, client et
 * serveur) le ferait échouer silencieusement — et un refus retomberait alors
 * dans « réessaie, vérifie ta connexion », exactement le défaut corrigé ici.
 * Le marqueur structurel ferme ce trou.
 */
export function estRefusAutorisation(valeur: unknown): boolean {
  if (valeur instanceof RefusAutorisationAffectation) return true;
  if (typeof valeur !== "object" || valeur === null) return false;
  const candidat = valeur as { name?: unknown; natureEchec?: unknown };
  return candidat.natureEchec === "autorisation" && candidat.name === "RefusAutorisationAffectation";
}

/**
 * LE MESSAGE AFFICHÉ — une seule source, deux modales.
 *
 * ⚠️ LE TEXTE « TECHNIQUE » EST CELUI D'AVANT, AU CARACTÈRE PRÈS. Les deux
 * modales le portaient en dur, à l'identique ; le centraliser ici empêche
 * qu'elles divergent, et prouve qu'aucun échec non-autorisation n'a changé de
 * message.
 *
 * ⚠️ LE TEXTE « AUTORISATION » NE NOMME NI L'ÉLÈVE, NI LA TABLE, NI LE CODE
 * D'ERREUR. Il dit ce qui manque (des droits), ce qui a été préservé (la
 * sélection), que réessayer est inutile, et à qui s'adresser. Rien de plus :
 * un refus ne doit pas servir d'oracle sur ce qui existe de l'autre côté de la
 * cloison.
 */
export function messageEchecAffectation(echec: NatureEchecAffectation): string {
  if (echec === "autorisation") {
    return (
      "Tu n'as pas les droits nécessaires pour cette affectation. Ta sélection est conservée, " +
      "mais réessayer ne changera rien : demande à un administrateur l'accès en écriture sur " +
      "l'entraînement, ou l'affectation de l'élève concerné."
    );
  }
  return "L'enregistrement a échoué. Ta sélection est conservée — réessaie, ou vérifie ta connexion.";
}
