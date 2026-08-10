/**
 * LE BROUILLON, ENREGISTRÉ EN CONTINU — ET LA COURSE QU'IL FABRIQUE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN DIFFÉRÉ
 * ════════════════════════════════════════════════════════════════════════
 * L'élève tape « 82,5 » : cinq frappes, donc cinq écritures si l'on écrit à
 * chaque touche. Sur un téléphone, en salle, ces écritures s'empilent
 * pendant qu'il continue à saisir. Le différé les fond en une seule.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ET POURQUOI IL EST DANGEREUX
 * ════════════════════════════════════════════════════════════════════════
 * Un différé, c'est une écriture PROGRAMMÉE : elle porte l'état du moment
 * où elle a été programmée, et elle se déclenche plus tard. Le scénario qui
 * coûte une séance :
 *
 *   • l'élève modifie une charge   → écriture « état A » programmée ;
 *   • il valide immédiatement      → « état B » écrit, complet, définitif ;
 *   • le différé se réveille       → « état A » écrase B.
 *
 * L'élève verrait sa séance revenir en arrière, sans erreur, sans trace.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX FILETS, ET LE SECOND EST DANS LA BASE
 * ════════════════════════════════════════════════════════════════════════
 *   1. ICI : `abandonner()` est appelé avant toute validation finale. Le
 *      différé en attente ne part jamais.
 *   2. DANS LE DÉPÔT : chaque écriture porte une révision strictement
 *      croissante, et `ecrireBrouillon` REFUSE une révision inférieure ou
 *      égale à celle déjà enregistrée. Même si un différé échappait au
 *      premier filet — un rappel déjà dans la file de tâches du navigateur,
 *      par exemple — il serait refusé par le second.
 *
 * Ce module ne réimplémente ni la révision, ni le conflit, ni l'isolation
 * des comptes, ni l'atomicité : il les APPELLE. Il n'ordonnance que le
 * temps.
 */

/** Ce que le planificateur sait faire écrire. Injecté : ni React, ni IndexedDB ici. */
export type EcritureBrouillon = (payload: unknown, revision: number) => Promise<boolean>;

/** Minuteur injectable — les tests n'attendent pas 800 ms pour vérifier une règle. */
export interface Minuteur {
  programmer(rappel: () => void, delaiMs: number): unknown;
  annuler(jeton: unknown): void;
}

const MINUTEUR_REEL: Minuteur = {
  programmer: (rappel, delaiMs) => setTimeout(rappel, delaiMs),
  annuler: (jeton) => clearTimeout(jeton as ReturnType<typeof setTimeout>),
};

export interface PlanificateurBrouillon {
  /** Programme l'enregistrement de cet état. Remplace tout différé en attente. */
  planifier(payload: unknown): void;
  /**
   * Écrit MAINTENANT ce qui attend, et annule le différé.
   *
   * À appeler avant une validation finale quand on veut conserver la
   * dernière frappe. Rend `false` si rien n'attendait.
   */
  viderMaintenant(): Promise<boolean>;
  /**
   * Abandonne ce qui attend, SANS écrire.
   *
   * C'est ce qu'on appelle juste avant `validerRetourHorsLigne` : la
   * validation écrit elle-même le brouillon définitif, dans sa propre
   * transaction, et tout différé antérieur est par construction périmé.
   */
  abandonner(): void;
  enAttente(): boolean;
  /** Dernière révision effectivement soumise à l'écriture. */
  derniereRevision(): number;
}

export interface OptionsPlanificateur {
  ecrire: EcritureBrouillon;
  /** Révision de départ — celle du brouillon déjà en base, ou 0. */
  revisionInitiale?: number;
  delaiMs?: number;
  minuteur?: Minuteur;
  /** Prévenu quand une écriture est REFUSÉE par la garde de révision du dépôt. */
  surRefus?: (revision: number) => void;
}

export function creerPlanificateurBrouillon(
  options: OptionsPlanificateur,
): PlanificateurBrouillon {
  const minuteur = options.minuteur ?? MINUTEUR_REEL;
  const delaiMs = options.delaiMs ?? 800;
  let revision = options.revisionInitiale ?? 0;
  let jeton: unknown = null;
  let enAttentePayload: { valeur: unknown } | null = null;

  /**
   * La révision est prise ICI, au moment de l'écriture — pas au moment où
   * l'état a été saisi.
   *
   * C'est volontaire : deux différés successifs sur la même frappe ne
   * doivent pas se disputer un numéro. Ce qui protège de l'inversion, c'est
   * que ce compteur est strictement croissant et que le dépôt refuse tout
   * ce qui n'est pas supérieur à l'existant.
   */
  async function ecrireMaintenant(payload: unknown): Promise<boolean> {
    revision += 1;
    const numero = revision;
    const accepte = await options.ecrire(payload, numero);
    if (!accepte) options.surRefus?.(numero);
    return accepte;
  }

  return {
    planifier(payload) {
      if (jeton !== null) minuteur.annuler(jeton);
      enAttentePayload = { valeur: payload };
      jeton = minuteur.programmer(() => {
        jeton = null;
        const attendu = enAttentePayload;
        enAttentePayload = null;
        if (attendu) void ecrireMaintenant(attendu.valeur);
      }, delaiMs);
    },

    async viderMaintenant() {
      if (jeton !== null) {
        minuteur.annuler(jeton);
        jeton = null;
      }
      const attendu = enAttentePayload;
      enAttentePayload = null;
      if (!attendu) return false;
      await ecrireMaintenant(attendu.valeur);
      return true;
    },

    abandonner() {
      if (jeton !== null) {
        minuteur.annuler(jeton);
        jeton = null;
      }
      enAttentePayload = null;
    },

    enAttente: () => enAttentePayload !== null,
    derniereRevision: () => revision,
  };
}
