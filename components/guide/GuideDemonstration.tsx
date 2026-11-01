"use client";

import { useSyncExternalStore } from "react";

import { AddFoodSheet, type DemonstrationAjout } from "@/components/student/AddFoodSheet";
import {
  ALIMENTS_DEMONSTRATION,
  PRODUITS_DEMONSTRATION,
  QUANTITE_DEMONSTRATION,
  TERME_DEMONSTRATION,
  abonnerDemonstration,
  demonstrationServeur,
  lireDemonstration,
  type EtatDemonstration,
} from "@/lib/guide-demonstration";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA FEUILLE D'AJOUT, EN DÉMONSTRATION
 * ════════════════════════════════════════════════════════════════════════════
 * Monté une fois dans le shell élève, à côté de `GuideEspace`. Il ne rend rien
 * tant que la visite guidée n'a pas demandé un scénario de démonstration.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE FEUILLE À PART PLUTÔT QUE CELLE D'UN REPAS
 * ════════════════════════════════════════════════════════════════════════════
 * Ouvrir la feuille d'un vrai repas passe par `ConsumedMealSection.ouvrirAjout`,
 * qui appelle `onOuvrirConteneur()` — lequel CRÉE une ligne de repas en base
 * quand ce repas n'existe pas encore. Une visite qui ouvrirait cette feuille
 * écrirait donc dans le journal d'un élève pour illustrer une explication.
 *
 * On monte donc la MÊME feuille — `AddFoodSheet`, le composant de production,
 * pas une maquette — avec des fixtures et des callbacks inertes. Ce que l'élève
 * voit est exact ; ce qu'il peut déclencher ne mène nulle part.
 *
 * ⚠️ LES CALLBACKS CI-DESSOUS N'IMPORTENT RIEN DE `lib/supabase`, ET C'EST LA
 * GARANTIE ELLE-MÊME. Il ne s'agit pas de « ne pas appeler » la base : il n'y a
 * aucune fonction à appeler dans cette portée. Un test le vérifie sur le
 * fichier.
 *
 * ⚠️ UN SCÉNARIO, UN MONTAGE. La `key` change avec le scénario : chaque étape
 * de la visite obtient une feuille neuve, initialisée depuis ses fixtures. Pas
 * un seul effet de synchronisation à écrire — c'est la même technique que
 * `sessionScan` emploie déjà pour le scanner.
 */
export function GuideDemonstration() {
  const etat = useSyncExternalStore<EtatDemonstration>(
    abonnerDemonstration,
    lireDemonstration,
    demonstrationServeur,
  );
  return <FeuilleDemonstration etat={etat} />;
}

/**
 * La feuille, à partir d'un état donné — sans magasin, sans abonnement.
 *
 * ⚠️ SÉPARÉE EXPRÈS, POUR POUVOIR ÊTRE RENDUE EN TEST. `useSyncExternalStore`
 * rend l'instantané SERVEUR pendant `renderToString` — « démonstration
 * éteinte », toujours. Un harnais qui monterait `GuideDemonstration` obtiendrait
 * donc une chaîne vide quel que soit le scénario, et ne prouverait rien. En
 * recevant son état en propriété, cette partie-ci se rend pour de bon, avec le
 * vrai `AddFoodSheet` : c'est le seul moyen de VÉRIFIER qu'un scénario affiche
 * bien les cibles que ses étapes visent, au lieu de chercher des chaînes de
 * caractères dans un fichier.
 */
export function FeuilleDemonstration({ etat }: { readonly etat: EtatDemonstration }) {
  if (!etat.feuilleAjout) return null;

  const demonstration: DemonstrationAjout = {
    onglet: etat.onglet,
    terme: etat.recherche ? TERME_DEMONSTRATION : "",
    aliments: etat.recherche ? ALIMENTS_DEMONSTRATION : [],
    produits: etat.recherche ? PRODUITS_DEMONSTRATION : [],
    choix: etat.choix ? (ALIMENTS_DEMONSTRATION[0] ?? null) : null,
    quantite: QUANTITE_DEMONSTRATION,
    scanner: etat.scanner,
  };

  const cle = `${etat.onglet}-${etat.recherche ? "r" : ""}${etat.choix ? "c" : ""}${etat.scanner ? "s" : ""}`;

  return (
    <AddFoodSheet
      key={cle}
      titreRepas="Exemple de démonstration"
      /* FAVORIS ET RÉCENTS DE DÉMONSTRATION. Ces deux listes n'existent à
         l'écran que si l'élève en a déjà — un nouvel arrivant n'en a aucune, et
         les étapes qui les présentent n'auraient rien à montrer le jour où
         elles sont le plus utiles. L'étoile est inerte : `basculerFavori` ne
         fait rien, et il n'y a rien à enregistrer. */
      raccourcis={{
        favoris: [{ type: "aliment", aliment: ALIMENTS_DEMONSTRATION[0]! }],
        recents: [{ type: "aliment", aliment: ALIMENTS_DEMONSTRATION[1]! }],
        chargement: false,
        estFavori: (cible) => cible.type === "aliment" && cible.id === ALIMENTS_DEMONSTRATION[0]!.id,
        basculerFavori: () => {},
      }}
      enCours={false}
      erreur={null}
      demonstration={demonstration}
      /* FERMETURE : c'est le guide qui éteint la démonstration, à la sortie.
         Une fermeture depuis la feuille elle-même laisserait l'étape courante
         sans cible, ce que le repli du moteur signalerait — mieux vaut que la
         croix ne fasse rien pendant une visite que de casser le parcours. */
      onFermer={() => {}}
      /* ÉCRITURES : aucune. Ces fonctions rendent `false` — « rien n'a été
         enregistré » — ce que la feuille sait déjà afficher. */
      onAjouterCatalogue={async () => false}
      onAjouterProduit={async () => false}
      onAjouterManuel={async () => false}
    />
  );
}
