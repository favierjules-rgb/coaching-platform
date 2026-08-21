import { formatIntegerFr, NBSP } from "@/lib/nutrition/basis-points";
import type { RaisonNonCalculable, Scenario, ScenarioAchat } from "@/lib/nutrition/conditionnements";
import { cleInstantIso, type RaisonIndisponible, type EtatPrixObserves } from "@/lib/nutrition/prix-observes";

/**
 * COURSES C4.6 — LE MINIMUM OBSERVÉ D'UNE LISTE DE COURSES.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE NOMBRE EST, ET CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════════
 * C4.6 répond à UNE question : « d'après les relevés disponibles, quel est le
 * COÛT LE PLUS BAS qui couvrirait ce besoin dans le magasin choisi ? »
 *
 * C'est une BORNE MINIMALE, et rien d'autre. Ce n'est pas :
 *
 *   - un prix garanti, ni un prix d'aujourd'hui — un relevé est un fait PASSÉ
 *     et daté, et sa date voyage avec lui jusqu'à l'écran ;
 *   - une disponibilité — savoir qu'un prix a été vu ne dit rien du rayon ;
 *   - le produit recommandé à l'élève — il achètera peut-être une autre marque,
 *     et ce sera plus cher. C'est précisément pourquoi le nombre est un
 *     MINIMUM et doit être nommé comme tel à l'écran ;
 *   - une moyenne, ni une estimation théorique, ni le budget C3.
 *
 * ⚠️ AFFICHER CE NOMBRE SOUS L'ÉTIQUETTE « BUDGET » SERAIT UN MENSONGE
 * ARITHMÉTIQUEMENT EXACT — la même faute que le défaut D-4 de C3, où
 * « Budget restant : 6,60 € » était affirmé alors que cinq articles sur vingt
 * n'étaient pas comptés.
 *
 * ⚠️ CE MODULE NE PARLE À PERSONNE. Ni base, ni réseau, ni React. Il compose
 * les sorties de C4.4 (observations) et de C4.5 (scénarios d'achat) sans
 * refaire un seul de leurs calculs.
 *
 * ⚠️ ET IL NE LIT JAMAIS C3. `food_price_estimates` reste en place pour la
 * surface « estimation », mais aucun repli silencieux n'existe : un minimum
 * observé absent ne devient pas une estimation manuelle. Les deux notions ont
 * des sources, des dates et des garanties différentes ; les mélanger
 * produirait un nombre dont personne ne saurait dire ce qu'il vaut.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. L'ENTRÉE D'UNE LIGNE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ce que C4.4 et C4.5 rendent pour UNE ligne de courses.
 *
 * ⚠️ `tronque` ET `ignores` VOYAGENT JUSQU'ICI, ET C'EST TOUT L'ENJEU DU LOT.
 * Ils ne servent pas qu'à l'affichage : ce sont eux qui distinguent un minimum
 * PROUVÉ d'un minimum simplement CONNU.
 */
/**
 * D'où vient une ligne de la liste — `shopping_list_items.source`, dont le
 * CHECK n'admet que deux valeurs.
 *
 * ⚠️ `manuel` N'EST PAS UN CAS DÉGRADÉ DE `plan`. Une ligne manuelle est un
 * libellé libre — « éponges », « papier toilette » — que la base EMPÊCHE de
 * porter une identité : `shopping_list_items_manual_check` exige un libellé
 * non vide ET aucune cible. Elle n'a donc ni aliment générique, ni produit, ni
 * code-barres, et n'en aura jamais par ce chemin.
 */
export type OrigineLigne = "plan" | "manuel";

export interface EntreeLigne {
  readonly ligneId: string;
  readonly origine: OrigineLigne;
  readonly etat: EtatPrixObserves;
  readonly tronque: boolean;
  readonly ignores: number;
  readonly raisonIndisponible: RaisonIndisponible | null;
  /** Un scénario par observation, tels que C4.5 les a produits. */
  readonly scenarios: readonly Scenario[];
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ÉTAPE 1 — UN SCÉNARIO PAR GTIN : LE RELEVÉ LE PLUS RÉCENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Réduit N scénarios à UN PAR CODE-BARRES : celui du relevé le plus récent.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI « LE PLUS RÉCENT » ET NON « LE MOINS CHER », ICI
 * ════════════════════════════════════════════════════════════════════════════
 * C'est le contrat établi au cadrage C4.4, après examen de quatre options :
 * le prix retenu pour UN produit est le relevé le plus récent, non remisé, en
 * euros. Prendre le minimum parmi les relevés successifs d'un MÊME produit
 * rouvrirait l'option explicitement écartée — « minimum récent » — qui est un
 * comportement de COMPARATEUR : elle répond à « quel est le meilleur prix
 * jamais vu ici » et non à « combien ça coûte ici ». Mesuré : 27 relevés pour
 * un seul yaourt, de 1,21 € à 1,34 € entre mars et août. Retenir 1,21 €
 * sous-estimerait le panier de façon systématique.
 *
 * Le minimum, lui, joue à l'étape suivante — entre produits DIFFÉRENTS, où il
 * répond à une vraie question d'achat : quel paquet prendre.
 *
 * ⚠️ ET CE N'EST PAS `scenarios[0]`. C4.4 rend déjà sa liste triée, mais un tri
 * n'est pas un contrat : il décrit une présentation, pas une règle métier. Le
 * jour où quelqu'un changera l'ordre d'affichage, une lecture par indice
 * changerait le budget en silence. La règle est donc RÉÉCRITE ici, nommée, et
 * éprouvée sur des entrées délibérément désordonnées.
 *
 * ⚠️ LE PLUS RÉCENT MÊME S'IL EST NON CALCULABLE. Un scénario impossible n'est
 * pas écarté au profit d'un plus ancien qui, lui, se calculerait : ce serait
 * choisir un relevé sur sa commodité. La référence sort avec son impossibilité,
 * et c'est `resoudreLigne` qui en tire les conséquences — c'est-à-dire un
 * doute, pas un oubli.
 *
 * L'ordre de sortie est celui de la PREMIÈRE apparition de chaque GTIN :
 * déterministe, et sans autorité.
 */
export function selectionnerDernierScenarioParGtin(
  scenarios: readonly Scenario[],
): readonly Scenario[] {
  const parGtin = new Map<string, Scenario>();
  for (const candidat of scenarios) {
    const courant = parGtin.get(candidat.gtin);
    if (courant === undefined || estPlusRecent(candidat, courant)) {
      parGtin.set(candidat.gtin, candidat);
    }
  }
  return [...parGtin.values()];
}

/** La date d'observation d'un scénario, ou `null` s'il n'est pas calculable. */
function observeLeDe(s: Scenario): string | null {
  return s.calculable ? s.observeLe : null;
}
function createdLeDe(s: Scenario): string | null {
  return s.calculable ? s.createdLe : null;
}

/**
 * « `a` est-il plus récent que `b` ? » — `observeLe` ↓, `createdLe` ↓, `priceId` ↓.
 *
 * ⚠️ `createdLe` PASSE PAR LA CLÉ CANONISÉE DE C4.4. Comparer deux instants ISO
 * comme des chaînes brutes s'inverse quand la fraction de seconde est omise —
 * « …52Z » passe pour plus grand que « …52.276771Z » parce que 'Z' > '.'.
 *
 * ⚠️ UN SCÉNARIO NON CALCULABLE N'A PAS DE DATE. Il ne peut donc pas se
 * comparer par date ; seul `priceId` les départage, et il suffit : il est
 * unique chez Open Prices, ce qui rend l'ordre TOTAL.
 */
function estPlusRecent(a: Scenario, b: Scenario): boolean {
  const oa = observeLeDe(a);
  const ob = observeLeDe(b);
  if (oa !== ob) {
    if (oa === null) return false;
    if (ob === null) return true;
    return oa > ob;
  }
  const ca = cleInstantIso(createdLeDe(a)) ?? "";
  const cb = cleInstantIso(createdLeDe(b)) ?? "";
  if (ca !== cb) return ca > cb;
  return a.priceId > b.priceId;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ÉTAPE 2 — ENTRE GTIN : LE COÛT TOTAL MINIMAL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Élit le scénario le MOINS COÛTEUX pour couvrir le besoin — ou `null` si
 * aucun n'est calculable.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE PREMIER CRITÈRE EST `coutTotalMilli`, JAMAIS LE PRIX DU PAQUET
 * ════════════════════════════════════════════════════════════════════════════
 * C'est toute la raison d'être de C4.5. Pour couvrir 500 g de flocons :
 *
 *     A — paquet de 375 g à 1,690 €  →  2 paquets  →  3,380 €
 *     B — paquet de 500 g à 2,190 €  →  1 paquet   →  2,190 €
 *
 * A est le paquet le moins cher, et il PERD. Comparer les montants d'étiquette
 * — ou pire, un prix au kilo affiché — répondrait à une autre question que
 * celle que l'élève se pose au rayon.
 *
 * ── LE DÉPARTAGE, ET POURQUOI IL DOIT ÊTRE TOTAL ────────────────────────────
 *   1. `coutTotalMilli` ↑   ce qu'on paie pour couvrir le besoin ;
 *   2. `surplusMilli`   ↑   à coût égal, moins de gaspillage ;
 *   3. `observeLe`      ↓   à coût et surplus égaux, le relevé le plus frais ;
 *   4. `createdLe`      ↓   saisi le plus récemment ;
 *   5. `priceId`        ↓   unique chez Open Prices ;
 *   6. `gtin`           ↑   lexical — le filet, si deux relevés partageaient
 *                           tout le reste.
 *
 * Sans départage total, le gagnant dépendrait de l'ordre d'itération d'un `Map`
 * ou de l'ordre d'arrivée réseau : le même écran, rendu deux fois, donnerait
 * deux budgets, et l'on croirait à un changement de prix là où il n'y a qu'un
 * changement de hasard.
 */
export function elireScenarioMinimal(
  candidats: readonly Scenario[],
): ScenarioAchat | null {
  let gagnant: ScenarioAchat | null = null;
  for (const candidat of candidats) {
    if (!candidat.calculable) continue;
    if (gagnant === null || estMoinsCouteux(candidat, gagnant)) gagnant = candidat;
  }
  return gagnant;
}

function estMoinsCouteux(a: ScenarioAchat, b: ScenarioAchat): boolean {
  if (a.coutTotalMilli !== b.coutTotalMilli) return a.coutTotalMilli < b.coutTotalMilli;
  if (a.surplusMilli !== b.surplusMilli) return a.surplusMilli < b.surplusMilli;
  if (a.observeLe !== b.observeLe) return a.observeLe > b.observeLe;
  const ca = cleInstantIso(a.createdLe) ?? "";
  const cb = cleInstantIso(b.createdLe) ?? "";
  if (ca !== cb) return ca > cb;
  if (a.priceId !== b.priceId) return a.priceId > b.priceId;
  return a.gtin < b.gtin;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. LA RÉSOLUTION D'UNE LIGNE
// ────────────────────────────────────────────────────────────────────────────

/** Pourquoi une ligne n'a aucun prix — et l'absence est ici un FAIT constaté. */
export type RaisonSansPrix =
  /** Aliment du catalogue, mais aucun produit retail relié — le pont manque. */
  | "aucun_produit_relie"
  /** Des produits sont reliés, mais ce magasin n'a aucun relevé pour eux. */
  | "aucun_releve"
  /**
   * ⚠️ ARTICLE MANUEL : PAS D'IDENTITÉ, DONC PAS DE PRIX OBSERVÉ — ET CE N'EST
   * NI L'UNE NI L'AUTRE DES DEUX RAISONS CI-DESSUS.
   *
   * `aucun_produit_relie` dirait « cet aliment attend d'être curé », ce qui
   * ferait chercher une curation qui n'a aucun sens ici : des éponges n'ont
   * pas d'aliment générique. `aucun_releve` dirait « ce magasin ne le vend
   * pas », ce que nous n'avons jamais demandé. Le diagnostic doit rester vrai,
   * même quand la conclusion — non résolue — est la même.
   */
  | "article_manuel";

/**
 * Pourquoi le minimum n'est pas PROUVÉ, alors qu'un coût est peut-être connu.
 *
 * ⚠️ CES TROIS RAISONS DISENT LA MÊME CHOSE SOUS TROIS FORMES : il existe une
 * possibilité que nous n'avons pas pu examiner. Un relevé au-delà de nos trois
 * pages, une ligne écartée à la normalisation, une référence dont le
 * conditionnement manque — chacune pourrait cacher un coût plus bas.
 */
export type RaisonIndeterminee =
  | "aucun_magasin"
  /**
   * ⚠️ C4.3c — LE MAGASIN EXISTE, SON PONT OPEN PRICES N'EXISTE PAS.
   *
   * Elle est rangée ici, avec les doutes, et NON sous `RaisonSansPrix` — c'est
   * la décision qui compte dans ce lot. `sans_prix` affirmerait « ce magasin
   * n'a pas ce produit », ce que nous n'avons jamais établi : nous n'avons
   * interrogé personne, faute d'interlocuteur. Ce n'est pas une absence
   * constatée, c'est une question qui n'a pas pu être posée.
   *
   * ⚠️ ET ELLE NE SE CONFOND PAS AVEC `aucun_magasin`, qui la précède. Là,
   * l'élève n'a rien choisi et il faut l'inviter à choisir ; ici, il a choisi,
   * son choix est valide, et lui redemander de choisir serait absurde.
   */
  | "magasin_sans_couverture_prix"
  | "lecture_partielle"
  | "lecture_tronquee"
  | "observations_ecartees"
  | "candidat_non_calculable";

export type ResolutionLigne =
  | {
      readonly ligneId: string;
      readonly statut: "resolue";
      readonly coutRetenuMilli: number;
      readonly scenarioRetenu: ScenarioAchat;
      /** Le gagnant ET les autres candidats retenus à l'étape 1. */
      readonly alternatives: readonly Scenario[];
    }
  | {
      readonly ligneId: string;
      readonly statut: "sans_prix";
      readonly raison: RaisonSansPrix;
    }
  | {
      readonly ligneId: string;
      readonly statut: "indeterminee";
      /**
       * ⚠️ « CONNU », PAS « RETENU », ET LE NOM EST LE CONTRAT. C'est le plus
       * petit coût que nous savons calculer parmi les données exploitables
       * reçues — pas le minimum définitif. L'appeler `coutMilli` masquerait
       * exactement la distinction que ce lot existe pour tenir.
       */
      readonly minimumConnuMilli: number | null;
      readonly scenarioMinimumConnu: ScenarioAchat | null;
      readonly raisons: readonly RaisonIndeterminee[];
      readonly alternatives: readonly Scenario[];
    }
  | {
      readonly ligneId: string;
      readonly statut: "indisponible";
      readonly raison: RaisonIndisponible;
    }
  | {
      readonly ligneId: string;
      readonly statut: "non_calculable";
      readonly raisons: readonly RaisonNonCalculable[];
      readonly alternatives: readonly Scenario[];
    };

/**
 * L'état d'une ligne, et son coût s'il est PROUVÉ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ MINIMUM CONNU ≠ MINIMUM PROUVÉ — C'EST LA RÈGLE CENTRALE DU LOT
 * ════════════════════════════════════════════════════════════════════════════
 * Savoir que A coûte 2,190 € ne prouve pas que 2,190 € est le minimum. Il faut
 * aussi savoir qu'on a pu EXAMINER toutes les possibilités. Trois choses
 * l'empêchent, et chacune suffit :
 *
 *   - la réponse amont était TRONQUÉE — un relevé moins cher peut être page 4 ;
 *   - des lignes ont été ÉCARTÉES — remise, devise, date absente : l'une
 *     d'elles aurait pu être un relevé valide et moins cher ;
 *   - une référence n'est pas CALCULABLE — son conditionnement manque, donc on
 *     ignore ce qu'elle aurait coûté. Elle n'est pas « en trop » : elle est un
 *     trou dans le classement.
 *
 * Dans ces trois cas la ligne est `indeterminee`, et le coût trouvé s'appelle
 * `minimumConnuMilli`. Le déclarer `resolue` reviendrait à affirmer un
 * classement sur une donnée absente.
 *
 * ⚠️ ET `aucun_magasin` EST TRAITÉ COMME UN DOUTE, PAS COMME UNE ABSENCE. Nous
 * n'avons interrogé personne : nous ne savons rien. Le ranger sous `sans_prix`
 * affirmerait qu'il n'existe pas de prix, ce que nous n'avons pas établi.
 */
export function resoudreLigne(entree: EntreeLigne): ResolutionLigne {
  const { ligneId } = entree;

  // ⚠️ AVANT TOUT LE RESTE, ET SANS REGARDER LE MAGASIN. Une ligne manuelle
  // n'est pas résoluble par Open Prices, quel que soit le magasin, quelle que
  // soit la lecture : elle n'a aucune identité à interroger. Le dire ici évite
  // qu'elle hérite d'un diagnostic emprunté — « aucun magasin », « aucun
  // relevé » — qui serait faux tout en menant à la même conclusion.
  //
  // ⚠️ ET ELLE COMPTE DANS LA COUVERTURE. C'est le périmètre de C3, repris tel
  // quel : `articlesTotal` y vaut `lignes.length`, articles manuels et lignes
  // cochées inclus. La faire disparaître du dénominateur afficherait « 2 / 2 »
  // sur une liste de trois articles — un taux de couverture flatteur et faux.
  if (entree.origine === "manuel") {
    return { ligneId, statut: "sans_prix", raison: "article_manuel" };
  }

  if (entree.etat === "aucun_magasin") {
    return {
      ligneId,
      statut: "indeterminee",
      minimumConnuMilli: null,
      scenarioMinimumConnu: null,
      raisons: ["aucun_magasin"],
      alternatives: [],
    };
  }

  // ⚠️ C4.3c — MAGASIN CHOISI, MAIS SANS PONT OPEN PRICES. `indeterminee`, avec
  // sa raison propre. Le ranger sous `sans_prix` — la tentation, puisque le
  // résultat affiché est le même « pas de montant » — dirait à l'élève que son
  // magasin ne vend pas cet article. Il n'en sait rien, et nous non plus.
  //
  // ⚠️ ET SURTOUT : AUCUN REPLI SUR C3. La tentation symétrique serait
  // d'afficher ici le budget estimatif de C3 « pour ne pas laisser un vide ».
  // Ce serait mélanger un prix estimé et un prix observé dans un même total,
  // sans que rien à l'écran ne dise lequel est lequel.
  if (entree.etat === "magasin_sans_couverture_prix") {
    return {
      ligneId,
      statut: "indeterminee",
      minimumConnuMilli: null,
      scenarioMinimumConnu: null,
      raisons: ["magasin_sans_couverture_prix"],
      alternatives: [],
    };
  }
  if (entree.etat === "aucun_produit_relie") {
    return { ligneId, statut: "sans_prix", raison: "aucun_produit_relie" };
  }
  if (entree.etat === "aucun_releve") {
    return { ligneId, statut: "sans_prix", raison: "aucun_releve" };
  }
  if (entree.etat === "indisponible") {
    return { ligneId, statut: "indisponible", raison: entree.raisonIndisponible ?? "unavailable" };
  }

  // ── `indetermine` et `releves` passent par les scénarios ──────────────────
  const candidats = selectionnerDernierScenarioParGtin(entree.scenarios);
  const gagnant = elireScenarioMinimal(candidats);
  const nonCalculables = candidats.filter((c) => !c.calculable);

  if (gagnant === null) {
    if (nonCalculables.length > 0) {
      // ⚠️ DES PRIX EXISTENT : CE N'EST PAS UNE ABSENCE. Ranger ce cas sous
      // `sans_prix` ferait croire que le magasin ne vend rien de tel, alors
      // que c'est NOTRE donnée de conditionnement qui manque.
      const raisons = [...new Set(nonCalculables.map((c) => (c.calculable ? null : c.raison)))].filter(
        (r): r is RaisonNonCalculable => r !== null,
      );
      return { ligneId, statut: "non_calculable", raisons, alternatives: candidats };
    }
    // `indetermine` sans aucun scénario : C4.4 n'a rien pu conclure.
    return {
      ligneId,
      statut: "indeterminee",
      minimumConnuMilli: null,
      scenarioMinimumConnu: null,
      raisons: ["lecture_partielle"],
      alternatives: candidats,
    };
  }

  const doutes: RaisonIndeterminee[] = [];
  if (entree.etat === "indetermine") doutes.push("lecture_partielle");
  if (entree.tronque) doutes.push("lecture_tronquee");
  if (entree.ignores > 0) doutes.push("observations_ecartees");
  if (nonCalculables.length > 0) doutes.push("candidat_non_calculable");

  if (doutes.length > 0) {
    return {
      ligneId,
      statut: "indeterminee",
      minimumConnuMilli: gagnant.coutTotalMilli,
      scenarioMinimumConnu: gagnant,
      raisons: doutes,
      alternatives: candidats,
    };
  }

  return {
    ligneId,
    statut: "resolue",
    coutRetenuMilli: gagnant.coutTotalMilli,
    scenarioRetenu: gagnant,
    alternatives: candidats,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. LE BUDGET DE LA LISTE
// ────────────────────────────────────────────────────────────────────────────

export type StatutBudgetObserve = "complet" | "partiel" | "indetermine";

export interface RaisonLigneNonResolue {
  readonly ligneId: string;
  readonly statut: ResolutionLigne["statut"];
  readonly details: readonly string[];
}

export interface BudgetObserve {
  readonly statut: StatutBudgetObserve;
  /** ⚠️ SOMME DES SEULES LIGNES `resolue`. Un minimum CONNU n'y entre jamais. */
  readonly totalConnuMilli: number;
  readonly lignesTotal: number;
  readonly lignesResolues: number;
  readonly lignesNonResolues: number;
  readonly raisonsNonResolues: readonly RaisonLigneNonResolue[];
  /** Le total a franchi l'entier sûr : il n'est plus exact, donc plus un total. */
  readonly debordement: boolean;
  readonly resolutions: readonly ResolutionLigne[];
}

/**
 * Le minimum observé d'une liste entière.
 *
 * ⚠️ SEULES LES LIGNES `resolue` ENTRENT DANS LE TOTAL. Une ligne
 * `indeterminee` porte peut-être un `minimumConnuMilli` ; l'ajouter
 * transformerait une borne incertaine en total, c'est-à-dire referait le défaut
 * que ce lot existe pour éviter.
 *
 * ⚠️ LISTE VIDE : LE COMPORTEMENT DE C3 EST PRÉSERVÉ. C3 ne marque pas une
 * liste vide comme « partielle » (`partielle = articlesSansPrix > 0`, donc
 * `false`), et son écran affiche « — » parce qu'il teste `articlesEstimes === 0`
 * AVANT le montant. On reproduit exactement : `complet` sur zéro ligne, et
 * c'est l'ÉCRAN qui garde le zéro hors de la vue, comme en C3.
 *
 * ⚠️ ARITHMÉTIQUE ENTIÈRE, ET LE DÉBORDEMENT EST UN ÉTAT. Chaque terme et
 * chaque somme partielle sont vérifiés ; au premier franchissement de
 * `2^53−1`, le total cesse d'être exact et le budget devient `indetermine`.
 * Jamais de saturation : un total inexact n'est pas un total.
 */
export function budgetObserve(entrees: readonly EntreeLigne[]): BudgetObserve {
  const resolutions = entrees.map(resoudreLigne);
  const raisonsNonResolues: RaisonLigneNonResolue[] = [];
  let total = 0;
  let resolues = 0;
  let debordement = false;

  for (const r of resolutions) {
    if (r.statut === "resolue") {
      resolues += 1;
      if (!Number.isSafeInteger(r.coutRetenuMilli) || !Number.isSafeInteger(total)) {
        debordement = true;
        continue;
      }
      const somme = total + r.coutRetenuMilli;
      if (!Number.isSafeInteger(somme)) {
        debordement = true;
        continue;
      }
      total = somme;
      continue;
    }
    raisonsNonResolues.push({ ligneId: r.ligneId, statut: r.statut, details: detailsDe(r) });
  }

  const lignesTotal = resolutions.length;
  const lignesNonResolues = lignesTotal - resolues;

  let statut: StatutBudgetObserve;
  if (debordement) statut = "indetermine";
  else if (lignesTotal === 0) statut = "complet";
  else if (lignesNonResolues === 0) statut = "complet";
  else if (resolues > 0) statut = "partiel";
  else statut = "indetermine";

  return {
    statut,
    totalConnuMilli: total,
    lignesTotal,
    lignesResolues: resolues,
    lignesNonResolues,
    raisonsNonResolues,
    debordement,
    resolutions,
  };
}

/** ⚠️ AUCUNE LIGNE NON RÉSOLUE N'EST MUETTE : chacune sort avec ses motifs. */
function detailsDe(r: ResolutionLigne): readonly string[] {
  if (r.statut === "sans_prix") return [r.raison];
  if (r.statut === "indisponible") return [r.raison];
  if (r.statut === "indeterminee") return r.raisons;
  if (r.statut === "non_calculable") return r.raisons;
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// 6. LA COMPARAISON AU BUDGET DE L'ÉLÈVE
// ────────────────────────────────────────────────────────────────────────────

/**
 * `budget_cents` (C3, centimes) → millièmes.
 *
 * ⚠️ LA CONVERSION VA DANS CE SENS, ET JAMAIS DANS L'AUTRE. Ramener le total
 * observé en centimes (`total / 10`) jetterait la troisième décimale que
 * `Decimal(10,3)` d'Open Prices nous donne — dans la LOGIQUE MÉTIER, pas
 * seulement à l'affichage. Multiplier le budget par 10 est exact et sans perte.
 *
 * Refuse tout ce qui n'est pas un entier sûr positif, y compris le produit :
 * un budget absurde ne doit pas produire une comparaison absurde.
 */
export function budgetMilliDepuisCents(budgetCents: number | null): number | null {
  if (budgetCents === null || typeof budgetCents !== "number") return null;
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0) return null;
  const milli = budgetCents * 10;
  return Number.isSafeInteger(milli) ? milli : null;
}

export interface ComparaisonBudget {
  readonly disponible: boolean;
  readonly raison: "budget_absent" | "couverture_partielle" | "debordement" | null;
  readonly budgetMilli: number | null;
  /** `budget − minimum observé`. `null` dès que la comparaison n'a pas de sens. */
  readonly margeMilli: number | null;
  readonly depassement: boolean;
}

/**
 * L'écart entre le budget de l'élève et le minimum observé.
 *
 * ⚠️ UNIQUEMENT SI LA COUVERTURE EST COMPLÈTE. C'est le défaut D-4 de C3, et il
 * ne doit pas renaître : « il te reste 6,60 € » alors que cinq articles ne sont
 * pas comptés est une phrase arithmétiquement exacte et pratiquement fausse.
 * Sur couverture partielle, l'écran doit dire que la comparaison n'est pas
 * possible — pas afficher un écart plus petit que la réalité.
 *
 * ⚠️ ET SANS BUDGET POSÉ, IL N'Y A PAS D'ÉCART — pas un écart de zéro. Même
 * doctrine que `ecartCents: null` en C3.
 */
export function comparerAuBudget(
  budget: BudgetObserve,
  budgetCents: number | null,
): ComparaisonBudget {
  const indisponible = (raison: ComparaisonBudget["raison"]): ComparaisonBudget => ({
    disponible: false,
    raison,
    budgetMilli: null,
    margeMilli: null,
    depassement: false,
  });

  if (budget.debordement) return indisponible("debordement");
  if (budget.statut !== "complet") return indisponible("couverture_partielle");

  const budgetMilli = budgetMilliDepuisCents(budgetCents);
  if (budgetMilli === null) return indisponible("budget_absent");

  const marge = budgetMilli - budget.totalConnuMilli;
  if (!Number.isSafeInteger(marge)) return indisponible("debordement");

  return {
    disponible: true,
    raison: null,
    budgetMilli,
    margeMilli: marge,
    depassement: marge < 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. L'AFFICHAGE D'UN MONTANT EN MILLIÈMES
// ────────────────────────────────────────────────────────────────────────────

/**
 * « 2,19 € » · « 1,691 € » · « 1 234,56 € ».
 *
 * ⚠️ LA TROISIÈME DÉCIMALE NE SE JETTE PAS EN SILENCE. Open Prices publie des
 * `Decimal(10,3)` ; la plupart tombent juste au centime, et s'affichent alors
 * avec deux décimales comme n'importe quel prix. Mais quand le millième existe,
 * l'effacer ferait afficher 1,69 € pour 1,691 € — un montant faux, présenté
 * comme exact. On montre ce qu'on sait.
 *
 * ⚠️ AUCUNE DIVISION, DONC AUCUN FLOTTANT — même pour afficher. Même doctrine
 * que `formaterMontant` en C3 : euros et décimales sortent d'un `trunc` et d'un
 * modulo sur l'entier reçu. Le séparateur de milliers vient de `formatIntegerFr`,
 * le formateur du projet, pour qu'il n'en existe pas deux.
 */
export function formaterMontantMilli(milli: number): string {
  if (!Number.isFinite(milli)) return `0,00${NBSP}€`;
  const total = Math.trunc(milli);
  const signe = total < 0 ? "-" : "";
  const absolu = Math.abs(total);
  const euros = Math.trunc(absolu / 1000);
  const millimes = absolu % 1000;
  const decimales =
    millimes % 10 === 0
      ? String(Math.trunc(millimes / 10)).padStart(2, "0")
      : String(millimes).padStart(3, "0");
  return `${signe}${formatIntegerFr(euros)},${decimales}${NBSP}€`;
}
