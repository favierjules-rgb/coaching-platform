import type { BudgetObserve } from "@/lib/nutrition/budget-observe";
import type { EtatCouverture } from "@/lib/nutrition/couverture-magasin";
import type { Estimation } from "@/lib/nutrition/estimation-prix";
import { joursEcoules } from "@/lib/nutrition/estimation-prix";
import type { RaisonIndisponible } from "@/lib/nutrition/prix-observes";

/**
 * COURSES C5 — POURQUOI IL N'Y A PAS DE PRIX, EN UNE CAUSE ET UNE SEULE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE DÉFAUT QUE CE MODULE CORRIGE
 * ════════════════════════════════════════════════════════════════════════════
 * L'écran affichait « Ce magasin n'a pas encore de prix observés » dès que la
 * couverture valait `magasin_sans_couverture_prix`, et « aucun article n'a pu
 * être chiffré à partir des relevés de ce magasin » dans tous les autres cas
 * d'échec. Deux phrases pour six situations — et les deux accusent le MAGASIN.
 *
 * Or, mesuré sur la base le 08/11/2026 : **898 produits, aucun relié à un
 * aliment du catalogue** ; **127 lignes de plan sur 128 sans aucun
 * code-barres**. La cause réelle, dans l'immense majorité des cas, n'est pas le
 * magasin : c'est que l'ingrédient n'a aucun produit correspondant. Changer de
 * magasin, ce que la phrase suggérait, n'y aurait rien changé.
 *
 * ⚠️ L'ORDRE DE PRIORITÉ EST LE CŒUR DE CE MODULE, pas le texte affiché. Une
 * cause qui bloque TOUT doit être annoncée avant une cause qui ne bloque qu'une
 * partie — sans quoi l'élève répare ce qui n'est pas cassé.
 *
 * ⚠️ FONCTION PURE : aucune horloge, aucun réseau. La date du jour est injectée.
 */

export type CausePrixAbsent =
  /* ── Ce qui ne vient ni de l'élève, ni des données ───────────────────── */
  /** 6 — Notre installation est incomplète. Ni l'élève ni le magasin n'y sont pour rien. */
  | "configuration_manquante"
  /** 5 — L'amont n'a pas répondu. Réessayer a un sens. */
  | "api_indisponible"

  /* ── Ce qui manque en amont de toute requête ─────────────────────────── */
  /** 2 — L'ingrédient n'a aucun produit relié : rien ne peut être cherché. */
  | "aucun_produit_correspondant"
  /**
   * ⚠️ AUCUNE CATÉGORIE ASSOCIÉE À L'ALIMENT — donc aucune estimation possible.
   * Les relevés par catégorie s'interrogent par un tag Open Food Facts
   * (`en:carrots`). Le catalogue est bâti sur CIQUAL, qui n'en porte aucun, et
   * cette correspondance n'est PAS inventée ici : tant qu'elle n'existe pas,
   * aucune requête n'est émise et cette cause le dit.
   */
  | "aucune_categorie_associee"

  /* ── Ce que le magasin choisi permet, ou non ─────────────────────────── */
  /** Aucun magasin choisi : la question des prix ne se pose pas encore. */
  | "aucun_magasin_choisi"
  /**
   * ⚠️ LE MAGASIN N'EST PAS CONNU D'OPEN PRICES — ce n'est PAS « il n'y a pas
   * de prix ». Nous n'avons interrogé personne, faute d'interlocuteur. Mesuré :
   * 7 des 8 magasins de la base rendent 404 sur `/locations/osm/…`.
   */
  | "magasin_sans_correspondance"
  /** 1 — Le magasin est interrogeable ; personne n'y a déposé de prix. */
  | "aucun_prix_dans_le_magasin"

  /* ── Ce que les relevés de la zone permettent, ou non ────────────────── */
  /** 3 — Rien du tout dans la zone. */
  | "aucun_releve_dans_la_zone"
  /**
   * ⚠️ DES RELEVÉS EXISTENT, MAIS TROP PEU. Dire « aucun relevé dans ta
   * région » serait faux : il y en a, ils ne suffisent pas à une médiane.
   */
  | "releves_trop_peu_nombreux"
  /**
   * ⚠️ ASSEZ DE RELEVÉS, MAIS TROP CONCENTRÉS. Cinq prix d'un seul magasin ne
   * sont pas une médiane régionale. Attendre des relevés du même rayon n'y
   * changerait rien — il en faut d'AILLEURS.
   */
  | "releves_de_lieux_trop_concentres"
  /**
   * ⚠️ DES RELEVÉS INCOMPATIBLES ENTRE EUX — au kilo et à la pièce, ou en
   * plusieurs devises. Ce n'est ni une absence ni une insuffisance : c'est que
   * les nombres ne parlent pas de la même chose.
   */
  | "releves_incompatibles"
  /** 4 — Des relevés existent, mais ils sont trop vieux pour dire un prix d'aujourd'hui. */
  | "donnees_trop_anciennes";

/**
 * Les refus d'estimation, traduits UN POUR UN.
 *
 * ⚠️ AUCUNE FUSION, ET C'EST LA CORRECTION. Les quatre refus retombaient tous
 * sur « aucun relevé dans ta région » — une phrase fausse dans trois cas sur
 * quatre. « Il n'y en a pas », « il n'y en a pas assez », « ils viennent tous
 * du même endroit » et « ils ne sont pas comparables » appellent des réponses
 * différentes, et une seule d'entre elles invite à patienter.
 */
const CAUSE_PAR_REFUS_ESTIMATION = {
  aucun_releve: "aucun_releve_dans_la_zone",
  echantillon_insuffisant: "releves_trop_peu_nombreux",
  lieux_insuffisants: "releves_de_lieux_trop_concentres",
  unites_incompatibles: "releves_incompatibles",
  devises_melangees: "releves_incompatibles",
  /*
   * ⚠️ UNE DATE IMPOSSIBLE REJOINT LES RELEVÉS INEXPLOITABLES, PAS LES VIEUX.
   * Elle y était rangée, et l'écran disait « vos relevés datent de plus d'un
   * an » — ce qui invite à ATTENDRE. Or il n'y a rien à attendre : la donnée
   * est corrompue. `releves_incompatibles` dit la seule chose vraie pour
   * l'élève — ces relevés ne sont pas utilisables — sans lui promettre que le
   * temps y changera quelque chose.
   *
   * ⚠️ ET AUCUNE TREIZIÈME CAUSE N'EST CRÉÉE POUR CELA. L'élève n'a rien à
   * faire de différent selon que l'unité ou la date est en faute ; la
   * distinction compte pour NOUS, et elle vit dans `RaisonSansEstimation` et
   * dans le compteur `datesIllisibles`.
   */
  dates_illisibles: "releves_incompatibles",
  releves_trop_anciens: "donnees_trop_anciennes",
} as const satisfies Record<
  Exclude<Estimation, { disponible: true }>["raison"],
  CausePrixAbsent
>;

/**
 * La cause PRINCIPALE, ou `null` quand il n'y a rien à expliquer.
 *
 * `null` signifie « des prix ont été trouvés et ils sont exploitables » : la
 * couverture peut rester partielle, et c'est l'écran de budget qui le dit.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDRE DE PRIORITÉ, ET POURQUOI IL EST CELUI-LÀ
 * ════════════════════════════════════════════════════════════════════════════
 *   1. ce qui a empêché de POSER la question  (configuration, panne) ;
 *   2. ce qui manque pour POUVOIR la poser    (produit relié, magasin choisi) ;
 *   3. ce que la réponse du magasin dit       (inconnu d'Open Prices, ou vide) ;
 *   4. ce que les relevés de la zone disent   (absence, rareté, concentration,
 *      incompatibilité, ancienneté).
 *
 * ⚠️ UNE CAUSE QUI BLOQUE TOUT PASSE AVANT UNE CAUSE QUI NE BLOQUE QU'UNE
 * PARTIE. Sans quoi l'élève répare ce qui n'est pas cassé — c'était le défaut
 * d'origine : « change de magasin » affiché alors qu'aucun ingrédient n'avait
 * de produit relié.
 */
export function causePrincipale(params: {
  readonly couvertureMagasin: EtatCouverture;
  readonly budget: BudgetObserve | null;
  /** La raison remontée par la lecture, quand elle a échoué. */
  readonly raisonIndisponible?: RaisonIndisponible | null;
  /** L'estimation tentée sur la zone, quand il y en a eu une. */
  readonly estimation?: Estimation | null;
  /**
   * L'aliment a-t-il une catégorie Open Food Facts associée ?
   *
   * ⚠️ `false` N'EST PAS « ON N'A PAS CHERCHÉ » : c'est « on ne PEUT pas
   * chercher ». Aucune requête CATEGORY n'est émise sans correspondance, et
   * aucune correspondance n'est inventée.
   */
  readonly categorieAssociee?: boolean;
  /** `AAAA-MM-JJ`. ⚠️ INJECTÉE. */
  readonly aujourdHui: string;
  readonly fraicheurJours?: number;
}): CausePrixAbsent | null {
  const fenetre = params.fraicheurJours ?? FRAICHEUR_AFFICHAGE_JOURS;

  /*
   * ── 1. Ce qui a empêché de poser la question ─────────────────────────────
   * ⚠️ AVANT TOUT LE RESTE. Quand la lecture n'a pas eu lieu, rien de ce qui
   * suit n'a été établi : conclure « ce magasin n'a pas de prix » serait
   * affirmer le résultat d'une question qu'on n'a jamais posée.
   */
  if (params.raisonIndisponible === "non_configure") return "configuration_manquante";
  if (params.raisonIndisponible === "rate_limited" || params.raisonIndisponible === "unavailable") {
    return "api_indisponible";
  }

  const budget = params.budget;
  if (budget === null || budget.lignesTotal === 0) return null;

  /*
   * ── 2. Ce qui manque pour pouvoir la poser ───────────────────────────────
   * ⚠️ AVANT LA CAUSE « MAGASIN », ET C'EST LA CORRECTION PRINCIPALE. Sans
   * code-barres, aucune requête n'est partie : le magasin n'a rien refusé, on
   * ne lui a rien demandé. Changer de magasin ne donnerait pas un prix de plus.
   */
  const details = budget.raisonsNonResolues.flatMap((r) => r.details);
  const sansProduit = details.filter((d) => d === "aucun_produit_relie").length;
  const sansReleve = details.filter((d) => d === "aucun_releve").length;
  const rienDeResolu = budget.lignesResolues === 0;
  if (rienDeResolu && sansProduit > 0 && sansProduit >= sansReleve) {
    return "aucun_produit_correspondant";
  }

  /*
   * ── 3. L'ancienneté des prix EFFECTIVEMENT RETENUS ───────────────────────
   * ⚠️ ON REGARDE LES RELEVÉS RETENUS, pas ceux qu'on a écartés. Si le plus
   * RÉCENT des prix utilisés est hors fenêtre, le total affiché décrit un rayon
   * d'il y a plus d'un an et demi.
   */
  const datesRetenues = budget.resolutions
    .filter((r): r is Extract<typeof r, { statut: "resolue" }> => r.statut === "resolue")
    .map((r) => r.scenarioRetenu.observeLe);
  if (datesRetenues.length > 0) {
    const ages = datesRetenues
      .map((d) => joursEcoules(d, params.aujourdHui))
      .filter((j): j is number => j !== null);
    const plusRecent = ages.length === 0 ? null : Math.min(...ages);
    if (plusRecent !== null && plusRecent > fenetre) return "donnees_trop_anciennes";
    /*
     * ⚠️ DES PRIX RÉCENTS EXISTENT : il n'y a pas d'absence à expliquer, même
     * si la couverture reste partielle. C'est le bloc de budget qui dit
     * « 8 / 10 articles », pas une cause d'absence.
     */
    return null;
  }

  /*
   * ── 4. Ce que le magasin choisi permet ───────────────────────────────────
   * ⚠️ `couvertureMagasin` EST ENFIN LU. Il était reçu et ignoré : la fonction
   * pouvait conclure « ce magasin n'a pas de prix » pour un magasin qu'Open
   * Prices ne connaît même pas — deux situations qui n'appellent ni la même
   * phrase ni la même action.
   */
  if (params.couvertureMagasin === "aucun_magasin") return "aucun_magasin_choisi";

  /*
   * ── 5. Ce que les relevés de la zone disent ──────────────────────────────
   * ⚠️ TRADUCTION UN POUR UN, JAMAIS UNE FUSION. Voir
   * `CAUSE_PAR_REFUS_ESTIMATION` : quatre refus, quatre causes.
   */
  if (params.categorieAssociee === false) return "aucune_categorie_associee";
  const estimation = params.estimation;
  if (estimation !== null && estimation !== undefined && !estimation.disponible) {
    return CAUSE_PAR_REFUS_ESTIMATION[estimation.raison];
  }

  /*
   * ── 6. Le magasin, enfin ─────────────────────────────────────────────────
   * ⚠️ EN DERNIER, ET SEULEMENT QUAND TOUT LE RESTE A ÉTÉ ÉCARTÉ. C'était la
   * première réponse de l'écran ; c'est la dernière ici, parce que c'est la
   * plus rarement vraie.
   */
  if (params.couvertureMagasin === "magasin_sans_couverture_prix") {
    return "magasin_sans_correspondance";
  }
  return "aucun_prix_dans_le_magasin";
}

/**
 * La fenêtre au-delà de laquelle un prix EXACT est annoncé comme ancien.
 *
 * ⚠️ PLUS LARGE QUE CELLE DES ESTIMATIONS, et ce n'est pas une incohérence. Un
 * prix exact est montré AVEC sa date : l'élève juge lui-même. Une médiane cache
 * ses dates derrière un nombre unique, elle doit donc être plus stricte.
 */
export const FRAICHEUR_AFFICHAGE_JOURS = 540;


/* ══════════════════════════════════════════════════════════════════════════
   CE QUI EST ACTIF AUJOURD'HUI, ET CE QUI ATTEND LE RACCORDEMENT

   ⚠️ DOUZE CAUSES EXISTENT, SEPT SONT ATTEIGNABLES. La distinction n'est pas
   cosmétique : annoncer douze causes opérationnelles ferait croire que l'écran
   sait dire « trop peu de relevés dans ta région » alors qu'aucune estimation
   n'est jamais calculée.

   Les cinq autres dépendent d'arguments que l'écran NE TRANSMET PAS encore —
   `estimation` et `categorieAssociee` —, parce que la lecture par catégorie
   n'est pas raccordée : elle exigerait une correspondance CIQUAL →
   `category_tag`, qui n'existe pas et qui n'est pas inventée ici.

   ⚠️ ELLES SONT CONSERVÉES, PAS SUPPRIMÉES. Les retirer obligerait à les
   réécrire au raccordement, sans les tests qui les accompagnent aujourd'hui.
   ══════════════════════════════════════════════════════════════════════════ */

/** Les causes qu'un élève peut réellement lire aujourd'hui. */
export const CAUSES_ACTIVES = [
  "configuration_manquante",
  "api_indisponible",
  "aucun_produit_correspondant",
  "donnees_trop_anciennes",
  "aucun_magasin_choisi",
  "magasin_sans_correspondance",
  "aucun_prix_dans_le_magasin",
] as const satisfies readonly CausePrixAbsent[];

/**
 * Les causes écrites, testées, et INATTEIGNABLES tant que CATEGORY n'est pas
 * raccordé. Aucune ne peut survenir avec les arguments que l'écran transmet.
 */
export const CAUSES_EN_ATTENTE_DE_CATEGORIE = [
  "aucune_categorie_associee",
  "aucun_releve_dans_la_zone",
  "releves_trop_peu_nombreux",
  "releves_de_lieux_trop_concentres",
  "releves_incompatibles",
] as const satisfies readonly CausePrixAbsent[];

/**
 * ⚠️ LA PARTITION EST VÉRIFIÉE PAR LE COMPILATEUR, PAS PAR LA VIGILANCE.
 * Ajouter une cause sans la ranger dans l'une des deux listes rend ce type
 * différent de `never`, et l'affectation ci-dessous ne compile plus. Sans ce
 * garde-fou, une douzième cause pourrait se glisser sans qu'on sache si elle
 * est atteignable — exactement l'ambiguïté que ces listes existent pour lever.
 */
type CauseNonClassee = Exclude<
  CausePrixAbsent,
  (typeof CAUSES_ACTIVES)[number] | (typeof CAUSES_EN_ATTENTE_DE_CATEGORIE)[number]
>;
const TOUTES_LES_CAUSES_SONT_CLASSEES: CauseNonClassee extends never ? true : false = true;
export const CAUSES_TOTALES =
  CAUSES_ACTIVES.length + CAUSES_EN_ATTENTE_DE_CATEGORIE.length;
void TOUTES_LES_CAUSES_SONT_CLASSEES;
