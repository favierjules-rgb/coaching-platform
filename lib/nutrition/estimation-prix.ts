import {
  type ObservationCategorie,
  type PricePer,
  instantCalendaire,
} from "@/lib/nutrition/prix-observes";

/**
 * COURSES — L'ESTIMATION INDICATIVE, À PARTIR DES RELEVÉS PAR CATÉGORIE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ UNE ESTIMATION N'EST PAS UN PRIX, ET CE MODULE EXISTE POUR QUE LES DEUX
 * NE PUISSENT JAMAIS SE CONFONDRE
 * ════════════════════════════════════════════════════════════════════════════
 * Un prix EXACT répond à « combien coûte CE produit DANS CE magasin » : un
 * relevé, une date, un magasin, une preuve photographiée. Une ESTIMATION répond
 * à « combien coûtent les carottes, en général, d'après ce qu'on a vu » : une
 * médiane sur des magasins qui ne sont pas celui de l'élève.
 *
 * Les deux ne s'additionnent pas, et ce module ne rend RIEN qui puisse entrer
 * dans un `BudgetObserve` :
 *   · son type de retour (`Estimation`) n'est ni un `Scenario`, ni une
 *     `ResolutionLigne`, ni un montant nu ;
 *   · il ne lit que des `ObservationCategorie`, jamais des `ObservationPrix` ;
 *   · il porte toujours son échantillon, sa date et sa provenance, pour que
 *     l'écran ne puisse pas afficher le nombre sans les afficher aussi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI LE SEUIL D'ÉCHANTILLON EST HAUT, ET POURQUOI IL LE RESTE
 * ════════════════════════════════════════════════════════════════════════════
 * Mesuré autour de Toulon le 08/11/2026 : dans un rayon de 50 km, il existe
 * NEUF relevés de catégorie, répartis sur trois lieux — une Biocoop
 * marseillaise à 49 km, un producteur de L'Ayguade, une épicerie des Salins.
 * Par catégorie, cela donne un ou deux relevés.
 *
 * Calculer une médiane sur un ou deux relevés issus d'un producteur de bord de
 * route, puis l'afficher à côté d'un supermarché toulonnais, serait un chiffre
 * faux habillé en chiffre juste. **En dessous du seuil, ce module refuse.**
 * C'est le comportement attendu aujourd'hui sur la quasi-totalité des
 * catégories, et c'est voulu : il vaut mieux ne rien dire.
 *
 * ⚠️ FONCTION PURE. Aucun réseau, aucune horloge : la date du jour est INJECTÉE.
 * Une fonction qui lit `Date.now()` n'est pas testable sur la fraîcheur — et la
 * fraîcheur est précisément ce qu'il faut tester.
 */

/**
 * Le nombre minimal de relevés sous lequel aucune médiane n'est rendue.
 *
 * ⚠️ CINQ, ET PAS TROIS. Avec trois relevés, la médiane EST l'un des trois : un
 * seul relevé atypique la déplace entièrement. À cinq, il en faut trois pour la
 * faire mentir.
 */
export const ECHANTILLON_MINIMAL = 5;

/**
 * La fenêtre au-delà de laquelle un relevé ne compte plus dans une estimation.
 *
 * ⚠️ UN AN, ET C'EST DÉJÀ GÉNÉREUX. Les prix alimentaires ont bougé de plus de
 * 10 % sur certains postes en un an. Au-delà, le nombre ne décrit plus le
 * rayon d'aujourd'hui. Un prix EXACT, lui, reste affichable plus longtemps :
 * il est montré AVEC sa date, l'élève juge lui-même. Une médiane cache ses
 * dates derrière un seul nombre — elle doit donc être plus stricte.
 */
export const FRAICHEUR_ESTIMATION_JOURS = 365;

/**
 * Le nombre minimal de LIEUX DISTINCTS sous lequel aucune médiane n'est rendue.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CINQ PRIX D'UN SEUL MAGASIN NE SONT PAS UNE MÉDIANE RÉGIONALE
 * ════════════════════════════════════════════════════════════════════════════
 * Le seuil d'échantillon seul ne suffisait pas, et c'était un défaut : cinq
 * relevés d'un même rayon décrivent CE rayon, pas une région. Présenter ce
 * nombre à un élève qui fait ses courses ailleurs, c'est lui donner le prix
 * d'un magasin où il ne va pas, en lui laissant croire que c'est une moyenne.
 *
 * ⚠️ ET C'EST EXACTEMENT LE CAS TOULONNAIS. Les neuf relevés de catégorie à
 * moins de 50 km viennent de TROIS lieux, dont une Biocoop marseillaise et un
 * producteur de bord de route. Même en atteignant cinq relevés, la
 * concentration les rendrait non représentatifs.
 *
 * Trois lieux ne font pas une étude de marché. C'est le minimum sous lequel le
 * mot « médiane » devient mensonger, pas le seuil d'une bonne estimation.
 */
export const LIEUX_MINIMAL = 3;

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

export type RaisonSansEstimation =
  /** Aucun relevé du tout pour cette catégorie, sur cette portée. */
  | "aucun_releve"
  /** Des relevés existent, mais tous hors de la fenêtre de fraîcheur. */
  | "releves_trop_anciens"
  /**
   * ⚠️ UNE DATE IMPOSSIBLE N'EST PAS UNE DATE ANCIENNE, et les confondre
   * envoyait chercher le problème au mauvais endroit.
   *
   * Une observation datée `2026-02-31` était écartée comme les autres par le
   * filtre de fraîcheur — `joursEcoules` rend `null`, la date ne passe pas la
   * fenêtre — et le refus final s'appelait `releves_trop_anciens`. L'écran
   * disait donc « vos relevés datent de plus d'un an », ce qui invite à
   * ATTENDRE de nouveaux relevés. Or il n'y avait rien à attendre : la donnée
   * est corrompue, et seul un correctif en amont y changera quelque chose.
   *
   * ⚠️ CE REFUS N'APPARAÎT QUE SI LES DATES ILLISIBLES SONT LA SEULE CAUSE.
   * Quand des relevés réellement vieux cohabitent avec des dates corrompues,
   * c'est l'ancienneté qui est annoncée — elle est vraie, et actionnable. Le
   * nombre de dates illisibles reste porté par `datesIllisibles`, pour que
   * l'anomalie ne disparaisse jamais en silence.
   */
  | "dates_illisibles"
  /**
   * ⚠️ DES RELEVÉS FRAIS EXISTENT, MAIS DANS DES UNITÉS DIFFÉRENTES, et aucune
   * unité à elle seule n'atteint le seuil. « 2,90 €/kg » et « 1,20 €/pièce » ne
   * se moyennent pas : une salade à la pièce et des carottes au kilo répondent
   * à deux questions. Les additionner produirait un nombre qui n'existe pas.
   */
  | "unites_incompatibles"
  /** Une unité domine, mais l'échantillon reste sous `ECHANTILLON_MINIMAL`. */
  | "echantillon_insuffisant"
  /**
   * ⚠️ ASSEZ DE RELEVÉS, MAIS TROP PEU DE MAGASINS. C'est un refus DIFFÉRENT de
   * `echantillon_insuffisant`, et les confondre tromperait sur ce qui manque :
   * ici, attendre d'autres relevés du MÊME magasin n'y changerait rien.
   */
  | "lieux_insuffisants"
  /**
   * ⚠️ DES DEVISES DIFFÉRENTES COHABITENT DANS LA BASE AMONT — 87 recensées.
   * Une médiane qui mêlerait euros et couronnes serait un nombre sans unité de
   * compte. Ce refus n'arrive que si un appelant a oublié `currency=EUR`.
   */
  | "devises_melangees";

/** D'où vient une estimation — jamais tue, jamais résumée à un nombre. */
export interface ProvenanceEstimation {
  /** Combien de LIEUX distincts ont contribué. Un seul lieu n'est pas une médiane. */
  readonly lieux: number;
  /** Les communes connues, triées, sans doublon. Vide si l'amont ne les porte pas. */
  readonly villes: readonly string[];
  /** Le rayon de la recherche, quand elle était géographique. */
  readonly rayonKm: number | null;
}

export type Estimation =
  | {
      readonly disponible: false;
      readonly raison: RaisonSansEstimation;
      /** Combien de relevés ont été examinés avant le refus — pour pouvoir le dire. */
      readonly relevesExamines: number;
      /**
       * Combien de relevés portaient une date IMPOSSIBLE — `2026-02-31`,
       * `2026-13-01`. ⚠️ TOUJOURS RENDU, même quand le refus porte un autre
       * nom : une donnée corrompue ne doit pas pouvoir passer inaperçue parce
       * qu'une autre cause était plus bavarde.
       */
      readonly datesIllisibles: number;
      /**
       * Combien de LIEUX distincts ces relevés représentaient.
       *
       * ⚠️ DEUX NOMBRES, PAS UN. « Cinq relevés » et « cinq magasins » ne
       * disent pas la même chose, et c'est précisément la confusion que ce
       * module doit rendre impossible.
       */
      readonly lieuxExamines: number;
    }
  | {
      readonly disponible: true;
      /** La médiane, en millièmes d'euro. Entier. */
      readonly medianeMilli: number;
      /** L'unité de la médiane. ⚠️ Sans elle, le nombre ne veut rien dire. */
      readonly pricePer: Exclude<PricePer, null>;
      readonly devise: "EUR";
      /** Combien de relevés composent CETTE médiane — après tous les filtres. */
      readonly relevesUtilises: number;
      /**
       * Combien de relevés ont été écartés pour une date IMPOSSIBLE.
       *
       * ⚠️ RENDU MÊME QUAND L'ESTIMATION ABOUTIT, et c'est tout l'intérêt. Une
       * médiane peut parfaitement se calculer pendant que des données
       * corrompues arrivent à côté : si le champ n'existait que sur les refus,
       * la corruption resterait invisible tant qu'elle ne bloquerait rien.
       * Elle serait découverte le jour où elle deviendrait majoritaire,
       * c'est-à-dire bien trop tard.
       *
       * ⚠️ IL NE DIT RIEN DE LA QUALITÉ DE LA MÉDIANE : les relevés comptés
       * sont `relevesUtilises`, et ceux-là ont tous une date réelle.
       */
      readonly datesIllisibles: number;
      /**
       * Combien de MAGASINS DISTINCTS composent cette médiane.
       *
       * ⚠️ TOUJOURS AFFICHÉ AVEC `relevesUtilises`, jamais à sa place. Cinq
       * relevés venus de trois magasins et cinq relevés venus d'un seul ne
       * valent pas la même chose — le second est refusé (`LIEUX_MINIMAL`).
       */
      readonly lieuxContributeurs: number;
      /** Le plus récent des relevés retenus, au format `AAAA-MM-JJ`. */
      readonly observeLePlusRecent: string;
      /** Le plus ancien des relevés retenus — l'étendue se voit. */
      readonly observeLePlusAncien: string;
      readonly provenance: ProvenanceEstimation;
    };

/**
 * Le nombre de jours entiers entre deux dates `AAAA-MM-JJ`, ou `null`.
 *
 * ⚠️ `Date.UTC` ET PAS `new Date("…")`. Sur une chaîne sans fuseau, les moteurs
 * ont longtemps divergé entre UTC et heure locale ; une heure d'écart suffit à
 * faire basculer un relevé d'un côté ou de l'autre de la fenêtre.
 */
export function joursEcoules(depuis: string, jusqua: string): number | null {
  const ta = instantCalendaire(depuis);
  const tb = instantCalendaire(jusqua);
  if (ta === null || tb === null) return null;
  return Math.round((tb - ta) / MS_PAR_JOUR);
}



/**
 * La médiane d'une liste d'entiers non vide.
 *
 * ⚠️ MOYENNE DES DEUX CENTRAUX SUR UN EFFECTIF PAIR, puis arrondi à l'entier :
 * on reste en millièmes d'euro, jamais en flottant. `Math.round` suffit, la
 * somme de deux entiers sûrs l'étant aussi à cette échelle.
 */
export function mediane(valeurs: readonly number[]): number {
  const triees = [...valeurs].sort((x, y) => x - y);
  const milieu = Math.floor(triees.length / 2);
  if (triees.length % 2 === 1) return triees[milieu]!;
  return Math.round((triees[milieu - 1]! + triees[milieu]!) / 2);
}

/**
 * Une estimation indicative à partir de relevés de catégorie — ou un refus motivé.
 *
 * ⚠️ L'ORDRE DES FILTRES EST LE DIAGNOSTIC. On écarte d'abord les doublons,
 * puis les relevés périmés, puis on groupe par unité. Chaque étape a sa raison
 * de refus, et c'est elle qui permet à l'écran de distinguer « rien du tout »
 * de « trop ancien » et de « pas assez ».
 */
export function estimerPrixCategorie(params: {
  readonly observations: readonly ObservationCategorie[];
  /** La date du jour, `AAAA-MM-JJ`. ⚠️ INJECTÉE : ce module ne lit aucune horloge. */
  readonly aujourdHui: string;
  /** Le rayon de la recherche, s'il y en avait un — pour la provenance. */
  readonly rayonKm?: number | null;
  /** Surcharge de test. En production, la constante fait foi. */
  readonly echantillonMinimal?: number;
  readonly lieuxMinimal?: number;
  readonly fraicheurJours?: number;
}): Estimation {
  const minimal = params.echantillonMinimal ?? ECHANTILLON_MINIMAL;
  const lieuxMinimal = params.lieuxMinimal ?? LIEUX_MINIMAL;
  const fenetre = params.fraicheurJours ?? FRAICHEUR_ESTIMATION_JOURS;
  const compterLieux = (liste: readonly ObservationCategorie[]) =>
    new Set(liste.map((o) => o.opLocationId)).size;

  /*
   * ⚠️ DÉDUPLICATION PAR `priceId`, EN PLUS du filtre amont
   * `duplicate_of__isnull=true`. Mesuré : l'amont déclare lui-même environ 1 %
   * de doublons. Ce second filet ne coûte rien et protège d'un appelant qui
   * aurait oublié le paramètre — une médiane qui compte deux fois le même
   * ticket est faussée sans que rien ne le signale.
   */
  const vus = new Set<number>();
  const dedupliques = params.observations.filter((o) => {
    if (vus.has(o.priceId)) return false;
    vus.add(o.priceId);
    return true;
  });

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA DEVISE : ON GARDE LES EUROS, ON NE REJETTE PAS LE LOT
   * ════════════════════════════════════════════════════════════════════════
   * Le comportement est EXPLICITE, parce qu'il y avait deux réponses
   * défendables. Celle retenue : **conservation exclusive des relevés en
   * euros**, et refus seulement s'il n'en reste aucun.
   *
   * Pourquoi celle-là : la requête porte déjà `currency=EUR`. Un relevé en
   * couronnes dans la réponse est une anomalie, mais c'est une anomalie que la
   * NORMALISATION attrape déjà en amont (`devise_non_eur`, comptée dans
   * `ignores`). Ce module reçoit donc, en pratique, des euros ou rien. Le
   * filtre ici est un second rempart contre un appelant qui construirait ses
   * observations autrement — et dans ce cas, jeter les seuls relevés
   * exploitables parce que d'autres sont mal libellés serait perdre une
   * information juste à cause d'une information fausse.
   *
   * ⚠️ CE QUI N'EST JAMAIS FAIT : mélanger. Une médiane qui mêlerait euros et
   * couronnes serait un nombre sans unité de compte. Les non-euros ne sont pas
   * convertis, pas pondérés, pas comptés dans `relevesUtilises`.
   *
   * ⚠️ ET S'IL N'EN RESTE AUCUN, LE REFUS EST NOMMÉ. Elle était fondue dans la
   * déduplication : des relevés en couronnes disparaissaient en silence, et le
   * module annonçait « aucun relevé » alors qu'il en avait écarté douze.
   */
  const uniques = dedupliques.filter((o) => o.devise === "EUR");
  if (uniques.length === 0) {
    return dedupliques.length === 0
      ? {
          disponible: false,
          raison: "aucun_releve",
          relevesExamines: 0,
          datesIllisibles: 0,
          lieuxExamines: 0,
        }
      : {
          disponible: false,
          raison: "devises_melangees",
          relevesExamines: dedupliques.length,
          datesIllisibles: 0,
          lieuxExamines: compterLieux(dedupliques),
        };
  }

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ TROIS SORTS, PAS DEUX : FRAIS, PÉRIMÉ, OU ILLISIBLE
   * ════════════════════════════════════════════════════════════════════════
   * Le tri ne faisait que deux tas — ce qui passe la fenêtre, et le reste. Une
   * date impossible tombait donc dans le même tas qu'une date de 2022, et le
   * refus s'appelait « trop anciens ». L'écran invitait à attendre de nouveaux
   * relevés là où il fallait réparer une donnée.
   *
   * ⚠️ UNE DATE FUTURE EST RANGÉE AVEC LES ILLISIBLES, et c'est voulu : un
   * relevé daté de 2099 n'est pas vieux, il est faux.
   */
  const frais: ObservationCategorie[] = [];
  const perimes: ObservationCategorie[] = [];
  const illisibles: ObservationCategorie[] = [];
  for (const o of uniques) {
    const age = joursEcoules(o.observeLe, params.aujourdHui);
    if (age === null || age < 0) illisibles.push(o);
    else if (age > fenetre) perimes.push(o);
    else frais.push(o);
  }

  if (frais.length === 0) {
    /*
     * ⚠️ L'ANCIENNETÉ L'EMPORTE QUAND ELLE EXISTE VRAIMENT. Si des relevés
     * réellement vieux cohabitent avec des dates corrompues, « trop anciens »
     * reste la réponse : elle est vraie, et c'est la seule sur laquelle
     * quelqu'un peut agir en attendant. Le compte des dates illisibles part
     * quand même, pour que l'anomalie se voie.
     */
    return {
      disponible: false,
      raison: perimes.length > 0 ? "releves_trop_anciens" : "dates_illisibles",
      relevesExamines: uniques.length,
      datesIllisibles: illisibles.length,
      lieuxExamines: compterLieux(uniques),
    };
  }

  // ── Groupement par unité : on ne moyenne jamais des kilos avec des pièces ──
  const parUnite = new Map<Exclude<PricePer, null>, ObservationCategorie[]>();
  for (const o of frais) {
    const groupe = parUnite.get(o.pricePer) ?? [];
    groupe.push(o);
    parUnite.set(o.pricePer, groupe);
  }

  let meilleur: ObservationCategorie[] = [];
  for (const groupe of parUnite.values()) {
    if (groupe.length > meilleur.length) meilleur = groupe;
  }

  if (meilleur.length < minimal) {
    /*
     * ⚠️ DEUX REFUS DIFFÉRENTS, ET LA DISTINCTION COMPTE. Si plusieurs unités
     * cohabitent et qu'aucune n'atteint le seuil, le problème n'est pas la
     * rareté : c'est que les relevés ne parlent pas de la même chose. Le dire
     * évite de faire croire qu'attendre dix relevés de plus suffirait.
     */
    const raison = parUnite.size > 1 ? "unites_incompatibles" : "echantillon_insuffisant";
    return {
      disponible: false,
      raison,
      relevesExamines: frais.length,
      datesIllisibles: illisibles.length,
      lieuxExamines: compterLieux(frais),
    };
  }

  /*
   * ── LA DIVERSITÉ DES LIEUX, APRÈS LE NOMBRE DE RELEVÉS ───────────────────
   * ⚠️ CET ORDRE EST LE DIAGNOSTIC. On ne reproche pas la concentration à un
   * échantillon qui est d'abord trop petit : la première question est « en
   * a-t-on assez ? », la seconde « viennent-ils d'ailleurs que d'un seul
   * rayon ? ». Inverser les deux rendrait un refus moins précis.
   */
  const lieuxDuGroupe = compterLieux(meilleur);
  if (lieuxDuGroupe < lieuxMinimal) {
    return {
      disponible: false,
      raison: "lieux_insuffisants",
      relevesExamines: meilleur.length,
      datesIllisibles: illisibles.length,
      lieuxExamines: lieuxDuGroupe,
    };
  }

  const dates = meilleur.map((o) => o.observeLe).sort();
  const lieux = new Set(meilleur.map((o) => o.opLocationId));
  const villes = [
    ...new Set(meilleur.map((o) => o.ville).filter((v): v is string => v !== null && v !== "")),
  ].sort();

  return {
    disponible: true,
    medianeMilli: mediane(meilleur.map((o) => o.montantMilli)),
    pricePer: meilleur[0]!.pricePer,
    devise: "EUR",
    relevesUtilises: meilleur.length,
    datesIllisibles: illisibles.length,
    lieuxContributeurs: lieux.size,
    observeLePlusRecent: dates[dates.length - 1]!,
    observeLePlusAncien: dates[0]!,
    provenance: { lieux: lieux.size, villes, rayonKm: params.rayonKm ?? null },
  };
}
