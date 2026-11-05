/**
 * COURSES — LA VALIDATION D'UNE SÉRIE DE REPAS, HORS DE REACT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 * La boucle de validation vivait dans `useListeDeCourses`, et c'est là qu'était
 * le défaut : un double clic lançait deux boucles concurrentes, parce que le
 * seul garde-fou était `disabled={enCours}` — un état React, donc effectif au
 * rendu SUIVANT.
 *
 * Tant que cette boucle vivait dans un hook, aucun test Node ne pouvait la
 * faire tourner : ni le double clic, ni la réponse lente, ni l'erreur réseau,
 * ni la nouvelle tentative. Les neuf cas que l'énoncé demande d'éprouver
 * étaient précisément ceux qu'on ne pouvait qu'affirmer.
 *
 * Ici, tout est injecté : écrire, relire, traduire une erreur. Aucun React,
 * aucun Supabase, aucun réseau. Le hook devient une coquille qui branche cet
 * orchestrateur sur son état d'affichage.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE L'ORCHESTRATEUR GARANTIT
 * ════════════════════════════════════════════════════════════════════════════
 *   1. UNE ÉCRITURE À LA FOIS. Le verrou est une variable, lue et écrite
 *      synchroniquement : un second appel dans le même tour de boucle
 *      d'événements le voit posé. Un état React ne le permet pas.
 *   2. UN SECOND APPEL EST REFUSÉ, PAS MIS EN FILE. L'empiler rejouerait une
 *      écriture que personne n'a demandée deux fois.
 *   3. AUCUNE ENTRÉE N'EST LAISSÉE NON TENTÉE. Un échec au douzième n'arrête
 *      pas les neuf suivants : l'élève doit savoir en une fois ce qui reste.
 *   4. LA RELECTURE A LIEU AVANT QUE LE VERROU NE TOMBE, et même après un
 *      échec partiel — sans quoi l'écran proposerait de revalider ce qui est
 *      déjà en base.
 *   5. RIEN N'EST INVENTÉ. `complet` n'est vrai que si tout est passé ; il n'y
 *      a aucune transaction entre repas et on ne fait pas semblant.
 */

/** Une entrée à écrire : de quoi la nommer dans un rapport, et sa charge. */
export interface EntreeAEcrire<T> {
  readonly cle: string;
  /** « Lundi 17 août · Petit déjeuner » — de quoi retrouver le repas. */
  readonly libelle: string;
  readonly charge: T;
}

export interface EchecDEntree {
  readonly cle: string;
  readonly libelle: string;
  readonly message: string;
}

export interface RapportDeSerie {
  readonly valides: number;
  readonly echecs: readonly EchecDEntree[];
  /** `true` si et seulement si TOUT est passé. Jamais un faux succès. */
  readonly complet: boolean;
  /**
   * `true` quand l'appel a été refusé parce qu'une écriture était déjà en vol.
   *
   * ⚠️ DISTINCT D'UN ÉCHEC D'ÉCRITURE. Rien n'a été tenté, rien n'est à
   * corriger : l'appelant ne doit ni afficher « à corriger », ni perdre les
   * choix de l'élève.
   */
  readonly refuseCarEnCours: boolean;
}

/**
 * Ce que l'orchestrateur a besoin de savoir faire, À CHAQUE APPEL.
 *
 * ⚠️ INJECTÉES PAR APPEL, PAS À LA CONSTRUCTION — et ce n'est pas un détail de
 * style. `relire` dépend de la période affichée : capturée une fois à la
 * construction, elle relirait la semaine d'il y a trois écrans. Les passer au
 * moment du geste garantit qu'elles décrivent l'état courant.
 *
 * Seul le VERROU survit d'un appel à l'autre, parce que c'est précisément ce
 * qui doit survivre.
 */
export interface DependancesDeSerie<T> {
  /** Écrit UNE entrée. Rejette pour signaler un refus ou une panne. */
  readonly ecrire: (charge: T) => Promise<unknown>;
  /** Relit l'état réellement enregistré. Attendue avant la fin. */
  readonly relire: () => Promise<void>;
  /** Prévenu au début et à la fin — c'est lui qui pilote `enCours` à l'écran. */
  readonly surChangementDEtat?: (enCours: boolean) => void;
}

/**
 * Un validateur à verrou, réutilisable d'un appel à l'autre.
 *
 * ⚠️ LE VERROU VIT DANS LA CLÔTURE, PAS DANS UN PARAMÈTRE. Le rendre externe
 * obligerait chaque appelant à le gérer, et un appelant qui l'oublie retrouve
 * exactement le défaut qu'on vient de corriger.
 */
export function creerValidateurEnSerie<T>(options: {
  /** Traduit un rejet en message lisible. Stable : ne dépend d'aucun écran. */
  readonly traduireErreur: (erreur: unknown) => string;
}) {
  let enVol = false;

  return {
    /** Y a-t-il une écriture en cours ? Lecture synchrone, sans rendu. */
    enVol: () => enVol,

    async valider(
      entrees: readonly EntreeAEcrire<T>[],
      deps: DependancesDeSerie<T>,
    ): Promise<RapportDeSerie> {
      if (enVol) {
        return {
          valides: 0,
          echecs: entrees.map((e) => ({
            cle: e.cle,
            libelle: e.libelle,
            message: "Une validation est déjà en cours.",
          })),
          complet: false,
          refuseCarEnCours: true,
        };
      }

      enVol = true;
      deps.surChangementDEtat?.(true);
      const echecs: EchecDEntree[] = [];
      let valides = 0;

      try {
        for (const entree of entrees) {
          try {
            await deps.ecrire(entree.charge);
            valides += 1;
          } catch (erreur) {
            echecs.push({
              cle: entree.cle,
              libelle: entree.libelle,
              message: options.traduireErreur(erreur),
            });
          }
        }
      } finally {
        /*
         * ⚠️ LA RELECTURE EST DANS LE `finally`, ET ELLE EST ATTENDUE.
         *
         * Dans le `finally` : onze repas écrits sur vingt-et-un, ce sont onze
         * repas qui doivent apparaître validés, même si la suite a échoué.
         *
         * Attendue : l'appelant avance d'écran sur ce rapport. S'il avançait
         * avant la relecture, l'écran suivant montrerait l'état d'AVANT —
         * c'est-à-dire exactement ce que l'énoncé interdit (« après succès,
         * l'état affiché doit correspondre aux données réellement
         * enregistrées »).
         *
         * ⚠️ ET UNE RELECTURE QUI ÉCHOUE NE DOIT PAS AVALER LE RAPPORT. Les
         * écritures ont eu lieu ; les perdre parce que la lecture suivante a
         * échoué serait la pire des réponses.
         */
        try {
          await deps.relire();
        } catch {
          // Volontairement silencieux : voir ci-dessus.
        }
        enVol = false;
        deps.surChangementDEtat?.(false);
      }

      return {
        valides,
        echecs,
        complet: echecs.length === 0 && entrees.length > 0,
        refuseCarEnCours: false,
      };
    },
  };
}
