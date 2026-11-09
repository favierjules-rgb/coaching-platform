"use client";

import { NBSP } from "@/lib/nutrition/basis-points";
import type { CausePrixAbsent } from "@/lib/nutrition/causes-prix";
import type { EtatCouverture } from "@/lib/nutrition/couverture-magasin";
import {
  type BudgetObserve,
  type ComparaisonBudget,
  formaterMontantMilli,
} from "@/lib/nutrition/budget-observe";

/**
 * COURSES C4.6 — LE MINIMUM OBSERVÉ, À L'ÉCRAN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE BLOC N'AFFICHE JAMAIS « BUDGET »
 * ════════════════════════════════════════════════════════════════════════════
 * Le nombre montré est le coût le plus bas que les relevés disponibles
 * permettent de calculer pour couvrir la liste, dans le magasin choisi. Ce
 * n'est ni un prix garanti, ni un prix d'aujourd'hui, ni ce que l'élève
 * dépensera : il achètera peut-être une autre marque, et ce sera plus cher.
 *
 * Trois libellés, trois situations, et aucun ne se déguise en l'autre :
 *
 *   COMPLET      « Minimum observé : 42,30 € »
 *   PARTIEL      « Minimum observé connu : 34,80 € » + « 8 / 10 articles »
 *   INDÉTERMINÉ  « Minimum observé indisponible »
 *
 * ⚠️ ZÉRO LIGNE RÉSOLUE N'AFFICHE JAMAIS « 0,00 € ». C'est la doctrine de C3,
 * reprise telle quelle : `aucuneEstimation` y garde déjà le zéro hors de
 * l'écran. « Les courses coûtent zéro » et « nous ne connaissons aucun coût »
 * sont deux phrases différentes, et une seule est vraie.
 *
 * ⚠️ ET AUCUN ÉCART GLOBAL SUR UNE COUVERTURE PARTIELLE. C'est le défaut D-4 de
 * C3 : « il te reste 6,60 € » était affirmé alors que cinq articles sur vingt
 * n'étaient pas comptés — arithmétiquement exact, pratiquement faux.
 */
export function BlocMinimumObserve({
  budget,
  comparaison,
  couvertureMagasin,
  chargement,
  ok,
  cause = null,
  listeAbsente = false,
  enTete,
}: {
  readonly budget: BudgetObserve | null;
  readonly comparaison: ComparaisonBudget | null;
  readonly couvertureMagasin: EtatCouverture;
  readonly chargement: boolean;
  readonly ok: boolean;
  /**
   * POURQUOI il n'y a pas de prix — déjà décidé, jamais décidé ici.
   *
   * ⚠️ CE BLOC TRADUIT, IL N'ARBITRE PAS. L'arbitrage vit dans
   * `causePrincipale`, fonction pure et testée sur ses six issues. Le faire ici
   * aurait obligé le composant à connaître la lecture amont et la médiane de
   * zone — deux notions qui n'ont rien à faire dans un rendu.
   */
  readonly cause?: CausePrixAbsent | null;
  /**
   * Aucune liste n'existe encore pour cette période.
   *
   * ⚠️ C'EST UN ÉTAT D'ÉCRAN, PAS UN ÉTAT DE COUVERTURE — et la distinction
   * est tout l'enjeu. `EtatCouverture` répond à « que sait-on des prix DANS ce
   * magasin ». Ici, la question ne se pose même pas : il n'y a rien à chiffrer.
   * En faire une septième valeur de couverture aurait mêlé une absence de
   * liste à une absence de relevés, et les six états existants auraient cessé
   * de dire ce qu'ils disent.
   *
   * ⚠️ ET DANS CE CAS, RIEN N'EST LU. Aucune requête `/observed-prices` ne
   * part : `useBudgetObserve` ne charge pas sans identifiant de liste.
   * L'affichage suit ce silence au lieu de le déguiser en « aucun prix ».
   */
  readonly listeAbsente?: boolean;
  /**
   * Le sélecteur de magasin, rendu DANS cette carte, sous le titre.
   *
   * ⚠️ UNE SEULE CARTE, ET C'EST LE POINT. Le magasin et les prix observés
   * sont la même question — « combien coûte ma liste, et où ». Les enfermer
   * dans deux cadres empilés donnerait deux objets visuels pour un seul sujet.
   *
   * ⚠️ ET CE BLOC N'EN SAIT RIEN. Il reçoit un nœud et le pose ; il n'importe
   * ni le sélecteur, ni Supabase, ni la géolocalisation. C'est ce qui le laisse
   * pur, et testable sur ses six états sans monter quoi que ce soit d'autre.
   */
  readonly enTete?: React.ReactNode;
}) {
  const titre = (
    <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
      PRIX OBSERVÉS
    </h3>
  );

  const cadre = (contenu: React.ReactNode) => (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4"
      aria-label="Minimum observé de la liste"
    >
      {titre}
      {enTete}
      {contenu}
    </section>
  );

  // ⚠️ AVANT TOUT LE RESTE. Sans liste, il n'y a ni chargement, ni panne, ni
  // couverture à commenter — mais il y a un magasin à choisir, et c'est le bon
  // moment pour le faire : l'élève prépare ses courses.
  if (listeAbsente) {
    return cadre(
      <p className="text-sm text-muted-foreground" role="status">
        Génère ta liste pour voir les prix observés.
      </p>,
    );
  }

  if (chargement) {
    return cadre(
      <p className="text-sm text-muted-foreground" role="status">
        Lecture des relevés…
      </p>,
    );
  }

  // ⚠️ UNE PANNE N'EST PAS UNE ABSENCE. Le dire évite qu'un élève conclue
  // qu'aucun prix n'existe pour ses articles.
  if (!ok) {
    return cadre(
      <p className="text-sm text-warning" role="status">
        Minimum observé indisponible pour l&apos;instant : les relevés n&apos;ont pas pu être lus.
      </p>,
    );
  }

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA CAUSE EST JUGÉE AVANT TOUTE PHRASE — ET AVANT LA COUVERTURE
   * ════════════════════════════════════════════════════════════════════════
   * La couverture du magasin était jugée en premier, donc « ce magasin n'a pas
   * encore de prix observés » sortait même quand la vraie cause était
   * qu'aucun ingrédient n'a de produit relié — mesuré : 127 lignes sur 128.
   * L'élève changeait de magasin pour rien.
   */
  if (cause !== null && cause !== "aucun_prix_dans_le_magasin") {
    return cadre(messageDeCause(cause));
  }
  /*
   * ⚠️ `aucun_prix_dans_le_magasin` EST VOLONTAIREMENT LAISSÉ PASSER. La
   * branche d'en bas rend la même chose en MIEUX : elle compte les articles
   * (« aucun des 10 articles »). Et cette cause implique `lignesResolues === 0`
   * — `causePrincipale` rend `null` dès qu'un prix récent a été retenu —, donc
   * la branche est toujours atteinte.
   */

  if (couvertureMagasin === "aucun_magasin") {
    return cadre(
      <p className="text-sm text-muted-foreground" role="status">
        Choisis un magasin pour voir le minimum observé de ta liste.
      </p>,
    );
  }

  // ⚠️ C4.3c — LE MAGASIN EXISTE, SES PRIX N'EXISTENT PAS ENCORE. Une phrase à
  // elle seule, et c'est tout l'objet de ce lot.
  //
  // Les quatre phrases qu'elle remplace disaient toutes quelque chose de faux :
  //   · « Choisis un magasin » — il vient d'en choisir un, et son choix est bon ;
  //   · « 0,00 € » — nous n'avons pas établi que ces courses sont gratuites ;
  //   · « indisponible pour l'instant » — rien n'est en panne, et réessayer
  //     dans une heure donnera exactement le même résultat ;
  //   · « aucun article n'a pu être chiffré dans ce magasin » — vrai à la
  //     lettre, mais il fait chercher la faute du côté des articles.
  //
  // ⚠️ ET CE N'EST PAS UN CAS RARE. Mesuré à Toulon : deux lieux Open Prices
  // pour ~180 000 habitants. C'est l'état ORDINAIRE d'un magasin français, et
  // il mérite une phrase qui n'accuse personne.
  if (couvertureMagasin === "magasin_sans_couverture_prix") {
    /*
     * ⚠️ CE CHEMIN EST LE REPLI, pas le chemin normal. Quand l'écran reçoit une
     * `cause`, c'est elle qui décide — et elle distingue « magasin inconnu
     * d'Open Prices » de « magasin connu, mais vide ». Cette branche sert
     * lorsqu'aucune cause n'a été calculée, et elle rend la MÊME phrase, par la
     * même constante : une phrase affichée deux fois est une phrase qui
     * divergera.
     */
    return cadre(phraseMagasinSansPrix);
  }

  if (budget === null || budget.lignesTotal === 0) {
    // Liste vide — exactement le « — » de C3, qui teste l'absence AVANT le
    // montant plutôt que d'afficher un zéro.
    return cadre(<p className="text-sm text-muted-foreground">—</p>);
  }

  if (budget.lignesResolues === 0) {
    /*
     * ⚠️ ON N'ARRIVE ICI QUE SI LA CAUSE EST BIEN LE MAGASIN. Les cinq autres
     * causes ont déjà été traitées plus haut ; cette phrase ne peut donc plus
     * accuser le magasin à tort.
     */
    return cadre(
      <>
        <p className="text-sm text-muted-foreground" role="status">
          Minimum observé indisponible.
        </p>
        <p className="text-xs text-muted-foreground">
          Aucun des {budget.lignesTotal} article{budget.lignesTotal > 1 ? "s" : ""} n&apos;a pu être
          chiffré à partir des relevés de ce magasin.
        </p>
      </>,
    );
  }

  const complet = budget.statut === "complet";

  return cadre(
    <>
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            {complet ? "Minimum observé" : "Minimum observé connu"}
          </dt>
          <dd className="font-semibold tabular-nums">
            {formaterMontantMilli(budget.totalConnuMilli)}
          </dd>
        </div>

        {/* ⚠️ L'ÉCART N'EXISTE QUE SI LA COUVERTURE EST COMPLÈTE. Sur une
            couverture partielle, `comparaison.disponible` est faux et l'écran
            le DIT, plutôt que de montrer une marge plus grande que la
            réalité. */}
        {comparaison?.disponible === true && comparaison.margeMilli !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">
              {comparaison.depassement ? "Dépassement du budget" : "Marge sur le budget"}
            </dt>
            <dd
              className={`font-semibold tabular-nums ${comparaison.depassement ? "text-warning" : "text-success"}`}
            >
              {formaterMontantMilli(Math.abs(comparaison.margeMilli))}
            </dd>
          </div>
        )}
      </dl>

      {!complet && (
        <p className="text-xs text-muted-foreground" role="status">
          {budget.lignesResolues}
          {NBSP}/{NBSP}
          {budget.lignesTotal} article{budget.lignesTotal > 1 ? "s" : ""} chiffré
          {budget.lignesResolues > 1 ? "s" : ""} — comparaison au budget indisponible tant que la
          liste n&apos;est pas complète.
        </p>
      )}

      {/* ⚠️ « OBSERVÉ », JAMAIS « ACTUEL ». Un relevé est un fait passé et daté ;
          promettre un prix du jour serait une promesse que personne ne tient. */}
      <p className="text-xs text-muted-foreground">
        Coût le plus bas calculable à partir des relevés Open Prices de ce magasin. Un relevé est un
        prix observé à une date, pas un prix garanti.
      </p>
    </>,
  );
}

/**
 * Une cause → la phrase que l'élève lit.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ SIX PHRASES, ET AUCUNE NE SE DÉGUISE EN UNE AUTRE
 * ════════════════════════════════════════════════════════════════════════════
 * Chacune dit QUI peut agir, et c'est le seul critère qui compte pour l'élève :
 *
 *   configuration_manquante      personne sur cet écran — c'est chez nous ;
 *   api_indisponible             personne non plus, mais réessayer a un sens ;
 *   aucun_produit_correspondant  personne — l'aliment attend d'être relié ;
 *   donnees_trop_anciennes       personne — mais le chiffre existe, daté ;
 *   aucun_releve_dans_la_zone    changer de magasin n'y changerait rien ;
 *   aucun_prix_dans_le_magasin   LÀ, et là seulement, un autre magasin aide.
 *
 * ⚠️ AUCUNE NE DIT « RÉESSAIE » QUAND RÉESSAYER NE SERT À RIEN. C'était le
 * défaut de l'ancien écran : « indisponible pour l'instant » s'affichait pour
 * une variable d'environnement absente, où « pour l'instant » durera toujours.
 */
function messageDeCause(cause: CausePrixAbsent): React.ReactNode {
  /*
   * ⚠️ `React.ReactNode` ACCEPTE `undefined`, donc un `switch` incomplet
   * COMPILERAIT en silence et rendrait un cadre vide. Le `never` ci-dessous est
   * ce qui transforme l'oubli d'une cause en erreur de compilation.
   */
  switch (cause) {
    case "configuration_manquante":
      return (
        <>
          <p className="text-sm text-warning" role="status">
            Les prix observés ne sont pas disponibles sur cette installation.
          </p>
          <p className="text-xs text-muted-foreground">
            C&apos;est un réglage manquant de notre côté, pas un problème avec ta liste ni avec ton
            magasin. Réessayer plus tard n&apos;y changera rien.
          </p>
        </>
      );
    case "api_indisponible":
      return (
        <>
          <p className="text-sm text-warning" role="status">
            Les relevés de prix ne répondent pas pour l&apos;instant.
          </p>
          <p className="text-xs text-muted-foreground">
            Le service est momentanément injoignable. Ta liste et ton magasin sont intacts —
            réessaie dans quelques minutes.
          </p>
        </>
      );
    case "aucun_produit_correspondant":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Tes ingrédients n&apos;ont pas encore de produit correspondant.
          </p>
          <p className="text-xs text-muted-foreground">
            Les prix se cherchent par code-barres, et ces aliments n&apos;en ont pas encore un
            associé. Changer de magasin n&apos;y changerait rien.
          </p>
        </>
      );
    case "donnees_trop_anciennes":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Les relevés disponibles sont trop anciens.
          </p>
          <p className="text-xs text-muted-foreground">
            Les derniers prix connus pour ces articles datent de plus d&apos;un an et demi. Les
            afficher comme un prix d&apos;aujourd&apos;hui serait trompeur.
          </p>
        </>
      );
    case "aucun_releve_dans_la_zone":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Aucun relevé de prix dans ta région.
          </p>
          <p className="text-xs text-muted-foreground">
            Les prix Open Prices sont contribués par des bénévoles. Il n&apos;y en a pas encore
            assez autour de chez toi — changer de magasin n&apos;y changerait rien.
          </p>
        </>
      );
    case "magasin_sans_correspondance":
    case "aucun_prix_dans_le_magasin":
      /*
       * ⚠️ DEUX CAUSES, UNE SEULE PHRASE — ET C'EST ASSUMÉ. « Open Prices ne
       * connaît pas ce magasin » et « il le connaît mais personne n'y a déposé
       * de prix » appellent le même geste de l'élève : choisir ailleurs. La
       * DISTINCTION compte pour nous — elle est dans la cause, donc dans les
       * traces et les tests —, pas pour lui.
       */
      return phraseMagasinSansPrix;
    case "aucun_magasin_choisi":
      return (
        <p className="text-sm text-muted-foreground" role="status">
          Choisis un magasin pour voir le minimum observé de ta liste.
        </p>
      );
    case "aucune_categorie_associee":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Ces aliments ne sont pas encore rattachés à une catégorie de prix.
          </p>
          <p className="text-xs text-muted-foreground">
            Sans ce rattachement, aucun relevé ne peut être cherché pour eux. Changer de magasin
            n&apos;y changerait rien.
          </p>
        </>
      );
    case "releves_trop_peu_nombreux":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Trop peu de relevés pour avancer un prix.
          </p>
          <p className="text-xs text-muted-foreground">
            Il existe bien quelques relevés dans ta région, mais pas assez pour en tirer un ordre
            de grandeur honnête.
          </p>
        </>
      );
    case "releves_de_lieux_trop_concentres":
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Les relevés disponibles viennent tous des mêmes magasins.
          </p>
          <p className="text-xs text-muted-foreground">
            Quelques prix d&apos;un seul rayon ne disent pas ce qui se pratique autour de toi.
          </p>
        </>
      );
    case "releves_incompatibles":
      /*
       * ⚠️ DEUX DÉFAUTS DISTINCTS SOUS UNE MÊME CAUSE, ET LE TEXTE NE LES
       * CONFOND PAS. Des unités différentes, ce sont des relevés justes qui ne
       * s'additionnent pas ; une date qui n'existe pas, c'est un relevé faux.
       * La première phrase les énumère séparément — « ou bien… ou bien » —
       * plutôt que de les fondre dans un « pas comparables » qui laisserait
       * croire à un seul problème.
       *
       * ⚠️ ET AUCUNE DES DEUX N'INVITE À ATTENDRE. C'est ce qui les réunit, et
       * c'est la seule chose que l'élève ait besoin de savoir : ni l'une ni
       * l'autre ne se réglera toute seule avec le temps.
       */
      return (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Les relevés disponibles ne sont pas exploitables.
          </p>
          <p className="text-xs text-muted-foreground">
            Ou bien ils n&apos;utilisent pas la même unité — certains au kilo, d&apos;autres à
            la pièce —, ou bien ils portent une date qui n&apos;existe pas. Dans un cas comme
            dans l&apos;autre, en tirer un prix donnerait un chiffre faux.
          </p>
        </>
      );
    default: {
      const jamais: never = cause;
      return jamais;
    }
  }
}

/**
 * La phrase du magasin sans prix — définie UNE FOIS.
 *
 * ⚠️ ELLE EST SERVIE PAR DEUX CHEMINS : la cause calculée, et le repli sur
 * `couvertureMagasin` quand aucune cause n'est fournie. La dupliquer, c'est
 * garantir qu'une des deux copies finira par mentir.
 */
const phraseMagasinSansPrix = (
  <>
    <p className="text-sm text-muted-foreground" role="status">
      Ce magasin n&apos;a pas encore de prix observés.
    </p>
    <p className="text-xs text-muted-foreground">
      Les relevés Open Prices sont contribués par des bénévoles, magasin par magasin. Personne
      n&apos;en a encore déposé ici — tu peux choisir un autre magasin en attendant.
    </p>
  </>
);
