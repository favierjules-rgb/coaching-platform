import type { EtapeGuide } from "@/lib/guide-decouverte";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * VISITES D'ESPACE — LE DÉTAIL DE CHAQUE CATÉGORIE
 * ════════════════════════════════════════════════════════════════════════════
 * La visite de `lib/guide-decouverte.ts` présente les MENUS : à quoi sert
 * chaque entrée de la navigation. Celle-ci prend le relais une fois dedans et
 * explique COMMENT la page fonctionne — enregistrer un repas, scanner un
 * produit, rendre un retour de séance.
 *
 * ⚠️ RIEN N'EST MODIFIÉ DANS LA VISITE DES MENUS. Ce fichier n'en reprend que
 * le type `EtapeGuide`, et le composant `GuideDecouverte` est réutilisé TEL
 * QUEL : il reçoit des étapes, il ne sait pas d'où elles viennent. Les deux
 * parcours cohabitent sans se connaître.
 *
 * ⚠️ UNE VISITE PAR PAGE, PAS PAR MENU. Un parcours qui traverserait plusieurs
 * routes devrait naviguer à la place de l'utilisateur, et le guide ne saurait
 * pas suivre ce qu'il déclenche. Chaque visite ne montre donc que ce qui est
 * DÉJÀ à l'écran, et une page différente propose simplement une autre visite.
 */

export interface EspaceGuide {
  readonly id: string;
  /** Titre proposé dans la bannière : « Découvrir … ». */
  readonly titre: string;
  /**
   * Préfixe de route. Le plus LONG qui correspond l'emporte, pour que
   * `/entrainement/seance/x` prenne la visite de la séance et non celle de
   * l'accueil entraînement.
   */
  readonly route: string;
  /**
   * Fin de route exigée en plus du préfixe, pour les pages situées SOUS un
   * identifiant variable.
   *
   * ⚠️ POURQUOI UN SUFFIXE PLUTÔT QU'UN PRÉFIXE PLUS LONG. La page des recettes
   * est `/nutrition/<identifiant du plan>/recettes` : l'identifiant est au
   * MILIEU, et aucun préfixe ne peut la distinguer du plan lui-même. Un gabarit
   * à trous, avec une étoile à la place de l'identifiant, aurait demandé un
   * mini-moteur de motifs et sa part de pièges ; préfixe + suffixe suffit ici,
   * et se lit sans décoder.
   *
   * La spécificité comptée pour départager les visites est alors la somme des
   * deux longueurs : la visite des recettes gagne sur celle du plan.
   */
  readonly routeSuffixe?: string;
  /**
   * La visite ne vaut que pour CETTE route, pas pour ce qui est en dessous.
   *
   * ⚠️ POURQUOI C'EST NÉCESSAIRE. `/documents` et `/documents/<id>` ne montrent
   * pas la même chose : la fiche d'un document ne contient ni la recherche, ni
   * les filtres, ni la liste. Sans ce drapeau, la bannière proposerait sur la
   * fiche une visite dont AUCUNE cible n'existe — le guide sauterait les cinq
   * étapes et se fermerait aussitôt. Un parcours qui s'ouvre pour ne rien
   * montrer est pire que pas de parcours.
   *
   * Les visites existantes ne le déclarent pas et gardent exactement leur
   * comportement de préfixe.
   */
  readonly routeExacte?: boolean;
  readonly etapes: readonly EtapeGuide[];
}

/* ══════════════════════════════════════════════════════════════════════════
   ESPACE ÉLÈVE — ENTRAÎNEMENT
   ══════════════════════════════════════════════════════════════════════════ */

const ENTRAINEMENT_ACCUEIL: EspaceGuide = {
  id: "entrainement-accueil",
  titre: "vos entraînements",
  route: "/entrainement",
  etapes: [
    {
      id: "ent-prochaine",
      cible: "espace-entrainement-prochaine",
      href: "/entrainement",
      titre: "Votre prochaine séance",
      texte:
        "La séance qui vous attend est mise en avant ici. C'est le raccourci le plus direct : vous l'ouvrez et vous commencez.",
    },
    {
      id: "ent-programmes",
      cible: "espace-entrainement-programmes",
      href: "/entrainement",
      titre: "Vos programmes",
      texte:
        "Les programmes que votre coach vous a affectés. Ouvrir un programme donne la liste de ses semaines et de ses séances.",
      exemple: "Revenir sur une séance passée pour revoir les charges que vous aviez notées.",
    },
  ],
};

const ENTRAINEMENT_SEANCE: EspaceGuide = {
  id: "entrainement-seance",
  titre: "le déroulé d'une séance",
  route: "/entrainement/seance",
  /*
   * ⚠️ DEUX ÉTAPES PEUVENT NE PAS S'AFFICHER, ET C'EST VOULU. Le RPE global
   * et la douleur globale ne sont rendus par `SessionFeedbackSection` que
   * lorsque la séance comporte un bloc CARDIO (`hasCardio`). Sur une séance de
   * force seule, leurs cibles n'existent pas et le guide les saute — c'est le
   * comportement normal, pas une étape manquante.
   */
  etapes: [
    {
      id: "seance-analyse",
      cible: "seance-analyse",
      href: "/entrainement/seance",
      titre: "Ce que la séance représente",
      texte:
        "Avant de commencer : le volume prévu, le nombre de séries et leur répartition par groupe musculaire. C'est le plan de la séance, pas un objectif à atteindre à tout prix.",
      exemple: "Voir que le dos porte 9 séries et les pectoraux 5 : la séance est orientée tirage.",
    },
    {
      id: "seance-echauffement",
      cible: "espace-seance-echauffement",
      href: "/entrainement/seance",
      titre: "L'échauffement",
      texte:
        "Les consignes à faire AVANT les exercices. Elles préparent les articulations sollicitées par cette séance précise.",
    },
    {
      id: "seance-consignes",
      cible: "espace-seance-notes",
      href: "/entrainement/seance",
      titre: "Les notes du coach",
      texte:
        "Les consignes laissées pour cette séance : intention, points de vigilance, adaptations à prévoir.",
    },
    {
      id: "seance-blocs",
      cible: "seance-blocs",
      href: "/entrainement/seance",
      titre: "Les blocs, un par un",
      texte:
        "La séance avance bloc par bloc. Chaque bloc affiche ce qui est prévu, puis son formulaire de réalisation : vous cochez « Bloc terminé » et vous saisissez ce qui est demandé — pour un bloc cardio, la durée et la distance réellement faites.",
      exemple: "Sur un bloc cardio de 10 min prévu, noter 12 min et 2,4 km réalisés.",
    },

    /* ══════════════════════════════════════════════════════════════════════
       UN EXERCICE DE MUSCULATION, CHAMP PAR CHAMP
       ══════════════════════════════════════════════════════════════════════
       ⚠️ CES CINQ ÉTAPES N'EXISTENT QUE S'IL Y A DE LA MUSCULATION. Les ancres
       sont posées par `ExerciseFeedbackCard`, que `SessionCarousel` ne monte
       que pour `renderStrengthExercise`. Une séance uniquement cardio n'en rend
       aucune : les cibles sont absentes, le moteur saute les étapes, et la
       visite enchaîne sur le remplacement d'exercice. C'est la dégradation
       voulue — pas un cas non traité.

       ⚠️ LA CHARGE ET LES RÉPÉTITIONS SONT CIBLÉES SÉPARÉMENT, pas la carte.
       Entourer la carte entière aurait laissé l'élève chercher lequel des trois
       champs d'une ligne est la charge — c'est précisément la question posée.
       ══════════════════════════════════════════════════════════════════════ */
    {
      id: "seance-exercice",
      cible: "seance-exercice",
      href: "/entrainement/seance",
      titre: "La carte d'un exercice",
      texte:
        "Le premier exercice de musculation de la séance. En haut, son numéro et son nom — ou, s'il a été remplacé, le nom du remplaçant et la mention de l'exercice d'origine.",
    },
    {
      id: "seance-prescription",
      cible: "seance-prescription",
      href: "/entrainement/seance",
      titre: "Ce qui est prévu",
      texte:
        "La consigne de votre coach pour cet exercice : nombre de séries, répétitions visées, temps de repos, et selon les cas le tempo, la charge conseillée et le RPE cible. C'est le PRÉVU — ce que vous saisirez plus bas est le RÉALISÉ.",
      exemple: "« 4 séries · 8 reps · 1 min 30 de repos · charge conseillée 40 kg ».",
    },
    {
      id: "seance-serie",
      cible: "seance-serie",
      href: "/entrainement/seance",
      titre: "Une ligne, une série",
      texte:
        "Chaque série a sa propre ligne, numérotée. Il n'y a rien à valider pour passer à la suivante : vous remplissez les lignes dans l'ordre qui vous arrange, et tout part ensemble à l'enregistrement du retour.",
      attenteMs: 1200,
    },
    {
      id: "seance-charge",
      cible: "seance-charge",
      href: "/entrainement/seance",
      titre: "La charge soulevée",
      texte:
        "Le premier champ de la ligne : la charge que vous avez réellement utilisée sur cette série. Le texte grisé n'est qu'un repère — la charge conseillée, ou votre dernière performance — et il ne compte pas comme une saisie.",
      exemple: "Repère « Reco 47 kg », et vous notez 45 si c'est ce que vous avez fait.",
      attenteMs: 1200,
    },
    {
      id: "seance-reps",
      cible: "seance-reps",
      href: "/entrainement/seance",
      titre: "Les répétitions faites",
      texte:
        "Le champ juste à côté : le nombre de répétitions réellement effectuées à cette charge. Un petit écart vert ou rouge apparaît dès que la comparaison avec votre référence a un sens.",
      attenteMs: 1200,
    },
    {
      id: "seance-rpe-serie",
      cible: "seance-rpe-serie",
      href: "/entrainement/seance",
      titre: "Le RPE de cette série",
      texte:
        "Le troisième champ : la difficulté de CETTE série, de 1 à 10 et par demi-points. Ne le confondez pas avec le RPE global de la séance, demandé une seule fois tout en bas.",
      attenteMs: 1200,
    },
    {
      id: "seance-remplacement",
      cible: "seance-remplacement",
      href: "/entrainement/seance",
      titre: "Remplacer un exercice",
      texte:
        "Si un mouvement est impossible — matériel pris, douleur, machine absente — vous choisissez ici un exercice de remplacement proposé pour celui-ci. Votre coach voit ce que vous avez réellement fait à la place.",
    },

    /* ══════════════════════════════════════════════════════════════════════
       LE CHRONOMÈTRE — UN MINUTEUR DE REPOS, ET RIEN D'AUTRE
       ══════════════════════════════════════════════════════════════════════
       ⚠️ CE N'EST NI LA DURÉE DE LA SÉANCE, NI CELLE D'UN BLOC CARDIO.
       `ChronometreSeance` le dit depuis sa création : il ne mesure pas la
       séance, n'écrit dans aucun champ de retour, et ne persiste rien — pas
       même dans le navigateur. La durée de séance est DÉCLARÉE par l'élève
       (étape « La durée réelle ») ; la durée d'un bloc cardio se saisit sous le
       bloc. Les confondre ferait croire qu'oublier de lancer le chronomètre
       fausse le retour. L'étape le dit explicitement.

       ⚠️ LE GUIDE OUVRE LE PANNEAU, IL NE LANCE PAS LE DÉCOMPTE. Ouvrir ne
       touche à aucune donnée ; `ouvrirVia` est donc légitime ici, et
       `fermerVia` referme à la sortie. Aucune étape ne désigne « Démarrer ».
       ══════════════════════════════════════════════════════════════════════ */
    {
      id: "chrono-ouvrir",
      cible: "chrono-ouvrir",
      href: "/entrainement/seance",
      titre: "Le chronomètre de repos",
      texte:
        "Ce bouton rond, en bas à droite, reste là pendant toute la séance. Il ouvre un minuteur de REPOS — il ne mesure pas la séance, et il n'a rien à voir avec la durée d'un bloc cardio.",
    },
    {
      id: "chrono-cadran",
      cible: "chrono-cadran",
      href: "/entrainement/seance",
      titre: "Le temps restant",
      texte:
        "Un décompte, pas un temps écoulé : il part de la durée réglée et descend vers zéro. Le panneau peut être refermé sans arrêter le décompte — le bouton rond affiche alors le temps restant.",
      ouvrirVia: "chrono-ouvrir",
      fermerVia: "chrono-fermer",
      attenteMs: 1000,
    },
    {
      id: "chrono-marche",
      cible: "chrono-marche",
      href: "/entrainement/seance",
      titre: "Démarrer, mettre en pause, remettre à zéro",
      texte:
        "Le bouton principal démarre, puis devient « Pause », puis « Reprendre ». Celui de droite remet le minuteur à la durée réglée. La visite ne presse aucun des deux : rien ne se lance tout seul.",
      ouvrirVia: "chrono-ouvrir",
      fermerVia: "chrono-fermer",
      attenteMs: 1000,
    },
    {
      id: "chrono-ajuster",
      cible: "chrono-ajuster",
      href: "/entrainement/seance",
      titre: "Ajuster en cours de repos",
      texte:
        "Trente secondes de plus ou de moins, sans arrêter le décompte. Pratique quand le repos prévu ne correspond pas à ce que votre corps demande sur le moment.",
      ouvrirVia: "chrono-ouvrir",
      fermerVia: "chrono-fermer",
      attenteMs: 1000,
    },
    {
      id: "chrono-duree",
      cible: "chrono-duree",
      href: "/entrainement/seance",
      titre: "Régler le repos de référence",
      texte:
        "Minutes et secondes du repos à décompter — à régler sur le temps indiqué dans la consigne de l'exercice. Ces deux champs sont inactifs pendant que le minuteur tourne, pour ne pas changer la durée en pleine série.",
      ouvrirVia: "chrono-ouvrir",
      fermerVia: "chrono-fermer",
      attenteMs: 1000,
    },
    {
      id: "seance-terminee",
      cible: "seance-terminee",
      href: "/entrainement/seance",
      titre: "Consultée, réalisée, enregistrée",
      texte:
        "Trois choses différentes. Ouvrir la séance ne l'enregistre pas. Cocher un bloc note ce bloc. Cette case-ci déclare la SÉANCE terminée — et rien n'est transmis tant que vous n'avez pas enregistré votre retour, à la fin.",
    },
    {
      id: "seance-rpe",
      cible: "seance-rpe",
      href: "/entrainement/seance",
      titre: "Votre RPE global",
      texte:
        "Une note sur 10 pour la difficulté GÉNÉRALE de la séance. Elle ne remplace pas le RPE de chaque bloc, qui se saisit sous le bloc concerné : l'un résume, l'autre détaille.",
      exemple: "7 sur 10 : exigeant, mais il restait de la marge.",
    },
    {
      id: "seance-duree",
      cible: "seance-duree",
      href: "/entrainement/seance",
      titre: "La durée réelle",
      texte:
        "Le temps que la séance vous a réellement pris, en minutes. Facultatif — à remplir si l'écart avec le prévu est parlant.",
    },
    {
      id: "seance-commentaire",
      cible: "seance-commentaire",
      href: "/entrainement/seance",
      titre: "Votre commentaire",
      texte:
        "Ce qu'aucun chiffre ne dit : sensations, fatigue, circonstances. C'est souvent ce qui fait bouger la programmation.",
    },
    {
      id: "seance-douleur",
      cible: "seance-douleur",
      href: "/entrainement/seance",
      titre: "Douleur ou gêne",
      texte:
        "Ici vous déclarez un ressenti d'ENSEMBLE. Une gêne liée à un bloc précis se signale sous ce bloc : votre coach sait ainsi où chercher.",
    },
    {
      id: "seance-enregistrer",
      cible: "seance-enregistrer",
      href: "/entrainement/seance",
      titre: "Enregistrer votre retour",
      texte:
        "Ce bouton transmet tout : blocs réalisés, RPE, durée, commentaire et gênes. Tant que vous ne l'avez pas pressé, rien n'est parti. Pendant l'envoi, il affiche « Enregistrement… » et reste inactif.",
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   ESPACE ÉLÈVE — ALIMENTATION
   ══════════════════════════════════════════════════════════════════════════ */

const NUTRITION_PLAN: EspaceGuide = {
  id: "nutrition-plan",
  titre: "votre plan alimentaire",
  route: "/nutrition/",
  /*
   * ⚠️ OBJECTIF, CONSOMMÉ ET RESTANT SONT TROIS CHOSES DIFFÉRENTES, et c'est
   * la confusion que ce parcours sert d'abord à lever. Les quatre premières
   * étapes montrent les OBJECTIFS du plan (`plan.dailyTarget`) ; la cinquième
   * montre le bilan du jour, qui compare le consommé à ces objectifs.
   *
   * ⚠️ AUCUNE VALEUR N'EST PRÉSENTÉE COMME UNE RECOMMANDATION MÉDICALE. Ce
   * sont les chiffres que le coach a fixés dans ce plan, rien de plus.
   */
  etapes: [
    {
      id: "nut-kcal",
      cible: "nutrition-objectif-kcal",
      href: "/nutrition",
      titre: "Votre objectif calorique",
      texte:
        "Le nombre de calories par jour fixé par votre coach pour ce plan. C'est un repère de travail, pas une prescription médicale — s'il vous paraît inadapté, parlez-en à votre coach.",
    },
    {
      id: "nut-proteines",
      cible: "nutrition-objectif-proteines",
      href: "/nutrition",
      titre: "Les protéines",
      texte:
        "L'objectif quotidien en grammes. Les protéines servent surtout à la construction et à la réparation musculaire — c'est ce qui rend ce chiffre important quand vous vous entraînez.",
    },
    {
      id: "nut-glucides",
      cible: "nutrition-objectif-glucides",
      href: "/nutrition",
      titre: "Les glucides",
      texte:
        "L'objectif quotidien en grammes. Les glucides sont le carburant principal de l'effort : ils pèsent beaucoup sur l'énergie disponible en séance.",
    },
    {
      id: "nut-lipides",
      cible: "nutrition-objectif-lipides",
      href: "/nutrition",
      titre: "Les lipides",
      texte:
        "L'objectif quotidien en grammes. Les lipides participent notamment au fonctionnement hormonal — d'où un objectif plancher plutôt qu'un chiffre à minimiser.",
    },
    {
      id: "nut-bilan",
      cible: "nutrition-bilan-jour",
      href: "/nutrition",
      titre: "Le bilan de votre journée",
      texte:
        "Trois choses à ne pas confondre : l'OBJECTIF fixé plus haut, ce que vous avez CONSOMMÉ, et ce qu'il vous RESTE. Ce résumé se met à jour à chaque repas enregistré.",
      exemple: "Protéines 90 g sur 150 g : il reste 60 g à couvrir sur la journée.",
      attenteMs: 1200,
    },
    {
      id: "nut-repas",
      cible: "espace-nutrition-repas",
      href: "/nutrition",
      titre: "Enregistrer un repas",
      texte:
        "C'est ici que vous notez ce que vous avez mangé. Trois façons d'ajouter un aliment : le chercher dans la banque d'aliments, le saisir à la main, ou scanner son code-barres avec l'appareil photo.",
      exemple: "Scanner un paquet de céréales pour reprendre ses valeurs sans rien ressaisir.",
    },

    /* ══════════════════════════════════════════════════════════════════════
       LE JOURNAL — ET LA VÉRITÉ SUR « ENREGISTRER UN REPAS »
       ══════════════════════════════════════════════════════════════════════
       ⚠️ IL N'EXISTE AUCUNE VALIDATION DIFFÉRÉE DU REPAS. On pourrait croire,
       par analogie avec le retour de séance, qu'on remplit un repas puis qu'on
       l'enregistre d'un bouton final. Ce n'est pas ce que fait l'application :
       chaque aliment part en base dès « Ajouter cet aliment », et il n'y a
       nulle part de bouton « Enregistrer le repas ». Laisser cette idée
       flotter ferait chercher un bouton inexistant — et ferait croire un repas
       perdu alors qu'il est déjà écrit. Les étapes le disent franchement.

       La correction, elle, passe par la ligne du journal : on y ouvre le détail
       d'un aliment pour changer sa quantité ou le supprimer, APRÈS coup.
       ══════════════════════════════════════════════════════════════════════ */
    {
      id: "nut-journal",
      cible: "nutrition-journal",
      href: "/nutrition",
      titre: "« Ce que j'ai mangé »",
      texte:
        "Le journal de ce repas. Chaque aliment ajouté y apparaît tout de suite : il n'y a pas de bouton « Enregistrer le repas » à chercher ensuite, l'enregistrement a déjà eu lieu à l'ajout.",
      attenteMs: 2000,
    },
    {
      id: "nut-journal-ligne",
      cible: "nutrition-journal-ligne",
      href: "/nutrition",
      titre: "Corriger ou retirer un aliment",
      texte:
        "Appuyez sur une ligne pour en ouvrir le détail : vous pouvez y corriger la quantité, ou supprimer l'aliment de ce repas. C'est la seule façon de revenir sur un ajout, et elle agit tout de suite.",
      attenteMs: 2000,
    },
    {
      id: "nut-journal-total",
      cible: "nutrition-journal-total",
      href: "/nutrition",
      titre: "Vérifier que c'est bien pris en compte",
      texte:
        "Sous les lignes, le consommé de ce repas — et, sur un repas prescrit, ce qu'il reste par rapport à sa cible. C'est ici, et dans le bilan du jour, qu'un ajout se vérifie.",
      attenteMs: 2000,
    },

    /* ══════════════════════════════════════════════════════════════════════
       AJOUTER UN ALIMENT — LE DÉTAIL, ET SES DEUX EMBRANCHEMENTS
       ══════════════════════════════════════════════════════════════════════
       ⚠️ LA VISITE N'OUVRE PAS LA FEUILLE ELLE-MÊME. « Ajouter un aliment »
       crée un conteneur de repas en base quand il n'en existe pas encore pour
       ce créneau : `ouvrirVia` ferait donc écrire le guide. L'étape déclare
       `gesteAttendu`, met le bouton en lumière, et l'élève appuie — ou n'appuie
       pas, et les étapes suivantes sont simplement sautées.

       ⚠️ TOUTES LES ÉTAPES QUI SUIVENT SONT CONDITIONNELLES, et c'est assumé.
       La feuille d'ajout n'a pas une forme mais plusieurs :
         · champ vide              → favoris, récents, encart « cherche un
                                     aliment », scanner, saisie manuelle ;
         · un nom tapé             → résultats, et le bouton de recherche des
                                     produits de marque ;
         · un aliment choisi       → l'étape quantité remplace la liste ;
         · le scanner ouvert       → il remplace toute la vue de recherche.
       Aucun parcours linéaire ne peut montrer les quatre à la fois. Le moteur
       attend la cible un temps borné puis saute l'étape : l'élève voit ce qui
       est réellement devant lui, et la visite n'attend jamais quelque chose qui
       ne viendra pas. Le rapport de fin de chantier dit lesquelles sont
       conditionnelles ; les tests vérifient que chacune a une ancre réelle dans
       le dépôt, pas qu'elle est visible en permanence.

       ⚠️ AUCUNE ÉTAPE NE PRESSE QUOI QUE CE SOIT. Ni « Ajouter cet aliment »,
       ni « Ouvrir la caméra ». Les deux sont mis en lumière et expliqués, et
       c'est tout. ══════════════════════════════════════════════════════════ */
    {
      id: "nut-ajout-ouvrir",
      cible: "nutrition-ajout-ouvrir",
      href: "/nutrition",
      titre: "Ajouter un aliment",
      texte:
        "Le bouton qui ouvre la feuille d'ajout, sous chaque repas de la journée. Appuyez dessus vous-même pour continuer la visite à l'intérieur : la visite ne l'ouvre pas à votre place, parce qu'ouvrir ce repas le crée dans votre journal.",
      exemple: "Rien n'est encore enregistré : vous ouvrez un repas vide.",
      gesteAttendu: true,
    },
    {
      id: "nut-ajout-modes",
      cible: "nutrition-ajout-modes",
      href: "/nutrition",
      titre: "Deux façons d'ajouter",
      texte:
        "« Rechercher » pour trouver un aliment déjà connu de l'application, « Saisir à la main » pour recopier les valeurs d'un emballage. Les deux sont au même rang : aucune n'est un pis-aller.",
      attenteMs: 4000,
    },
    {
      id: "nut-ajout-recherche",
      cible: "nutrition-ajout-recherche",
      href: "/nutrition",
      titre: "Chercher par le nom",
      texte:
        "Tapez un nom. La frappe ne consulte que les banques de l'application : les aliments génériques de la table Ciqual de l'Anses, et les produits déjà rencontrés. Rien n'est demandé à l'extérieur pendant que vous tapez.",
      exemple: "« banane », « riz », « poulet ».",
      attenteMs: 3000,
    },
    {
      id: "nut-liste-favoris",
      cible: "nutrition-liste-favoris",
      href: "/nutrition",
      titre: "Vos favoris",
      texte:
        "Tant que le champ est vide, vos favoris s'affichent ici : les aliments que vous avez marqués d'une étoile. L'étoile se met et s'enlève depuis n'importe quelle ligne de résultat.",
      attenteMs: 2000,
    },
    {
      id: "nut-liste-recents",
      cible: "nutrition-liste-recents",
      href: "/nutrition",
      titre: "Vos récents",
      texte:
        "Juste en dessous, ce que vous avez ajouté récemment. Favoris et récents sont les deux seules listes toutes prêtes : il n'y a pas de rayons ni de catégories à parcourir.",
      attenteMs: 2000,
    },
    {
      id: "nut-ajout-resultats",
      cible: "nutrition-ajout-resultats",
      href: "/nutrition",
      titre: "Les résultats",
      texte:
        "Les aliments génériques d'abord, les produits de marque ensuite. Appuyer sur une ligne n'enregistre rien : cela ouvre l'étape de la quantité.",
      attenteMs: 3000,
    },
    {
      id: "nut-ajout-produits",
      cible: "nutrition-ajout-produits",
      href: "/nutrition",
      titre: "Chercher aussi les produits",
      texte:
        "Les produits de marque sont cherchés sur demande, par ce bouton, et jamais au fil de la frappe. Ce bouton n'apparaît qu'une fois trois lettres tapées.",
      attenteMs: 2000,
    },
    {
      id: "nut-ajout-quantite",
      cible: "nutrition-ajout-quantite",
      href: "/nutrition",
      titre: "La quantité",
      texte:
        "Combien vous en avez mangé, et dans quelle unité. Les unités proposées sont celles que l'application sait convertir pour cet aliment — un produit dont la fiche est donnée « pour 100 ml » ne se saisit pas en grammes.",
      exemple: "Cette étape n'apparaît qu'après avoir choisi un aliment.",
      attenteMs: 2000,
    },
    {
      id: "nut-ajout-confirmer",
      cible: "nutrition-ajout-confirmer",
      href: "/nutrition",
      titre: "Le seul moment où l'on enregistre",
      texte:
        "Tout ce qui précède reste dans le formulaire. C'est cet appui, et lui seul, qui écrit la ligne dans votre journal. La visite ne le presse pas : elle vous le montre.",
      attenteMs: 2000,
    },
    {
      id: "nut-ajout-manuel",
      cible: "nutrition-ajout-manuel",
      href: "/nutrition",
      titre: "Saisir depuis l'emballage",
      texte:
        "Quand rien ne correspond, recopiez le nom et les valeurs pour 100 g ou 100 ml lues sur le paquet. L'aliment est marqué « saisi à la main » et reste à vous : il n'entre pas dans le catalogue partagé.",
      attenteMs: 2000,
    },
    {
      id: "nut-scan-ouvrir",
      cible: "nutrition-ajout-scanner",
      href: "/nutrition",
      titre: "Scanner un code-barres",
      texte:
        "Le geste le plus rapide pour un produit emballé. Appuyez vous-même si vous voulez voir l'écran du scanner : la visite ne touche pas à votre appareil photo.",
      attenteMs: 2000,
      gesteAttendu: true,
    },
    {
      id: "nut-scan-intro",
      cible: "nutrition-scan-intro",
      href: "/nutrition",
      titre: "Avant d'allumer la caméra",
      texte:
        "L'écran du scanner commence par cette phrase, et elle est exacte : la caméra ne s'ouvre qu'à votre demande, et l'image ne quitte pas votre téléphone. Seul le code-barres lu sert ensuite à retrouver le produit.",
      attenteMs: 3000,
    },
    {
      id: "nut-scan-camera",
      cible: "nutrition-scan-camera",
      href: "/nutrition",
      titre: "Ouvrir la caméra, puis viser",
      texte:
        "Ce bouton allume la caméra — la visite ne le presse pas. Placez ensuite le code-barres dans le cadre blanc : dès qu'il est lu, vous arrivez à la même étape de quantité que pour un aliment choisi dans la liste.",
      exemple: "Si la caméra est refusée ou absente, l'écran propose toujours la recherche par nom et la saisie à la main.",
      attenteMs: 2000,
    },
    {
      id: "nut-courses",
      cible: "espace-nutrition-courses",
      href: "/nutrition",
      titre: "Votre liste de courses",
      texte:
        "La liste construite à partir de votre plan, que vous cochez au fur et à mesure dans le magasin.",
    },
  ],
};

const NUTRITION_RECETTES: EspaceGuide = {
  id: "nutrition-recettes",
  titre: "les recettes adaptées",
  route: "/nutrition/",
  routeSuffixe: "/recettes",
  /*
   * ⚠️ CETTE PAGE N'ENREGISTRE RIEN, ET LA VISITE LE DIT. `StudentAdaptiveRecipes`
   * ne reçoit aucune fonction d'écriture, n'importe rien de `lib/supabase`, et
   * n'offre ni « Enregistrer », ni « Appliquer », ni « Ajouter au plan », ni
   * « Marquer comme consommé » : les trois seuls boutons du bas reviennent en
   * arrière. Le choix de recette vit dans l'état de la page et disparaît au
   * rechargement.
   *
   * C'était l'ambiguïté la plus coûteuse à lever ici : un élève qui croit avoir
   * « validé » sa recette penserait son repas enregistré, et son journal
   * resterait vide. La dernière étape le dit sans détour, et renvoie au bon
   * geste.
   *
   * ⚠️ AUCUNE NOTION DE « PORTIONS » N'EST MONTRÉE, parce qu'il n'en existe pas
   * dans ce composant : il adapte les QUANTITÉS de chaque ingrédient à la cible
   * du créneau, et n'expose pas de nombre de parts.
   */
  etapes: [
    {
      id: "rec-jour",
      cible: "recettes-jour",
      href: "/nutrition",
      titre: "Le jour",
      texte:
        "Tout part de là : les quantités affichées plus bas sont calculées pour les objectifs de CE jour de votre plan. Changer de jour les recalcule.",
    },
    {
      id: "rec-creneau",
      cible: "recettes-creneau",
      href: "/nutrition",
      titre: "Le créneau",
      texte:
        "Petit-déjeuner, déjeuner, collation… Seuls les créneaux que votre coach a activés pour ce jour sont proposés. Si la liste est vide, c'est à lui d'en activer un.",
    },
    {
      id: "rec-cible",
      cible: "recettes-cible",
      href: "/nutrition",
      titre: "Ce que vise ce créneau",
      texte:
        "Les calories et les macros attribuées à ce seul créneau, réparties depuis les objectifs du jour. C'est la cible que les recettes essaient d'atteindre.",
      attenteMs: 1500,
    },
    {
      id: "rec-liste",
      cible: "recettes-liste",
      href: "/nutrition",
      titre: "Les recettes proposées",
      texte:
        "Les recettes de votre coach compatibles avec ce créneau. Appuyer sur une recette ouvre son détail : cela ne l'enregistre ni ne la choisit pour vous.",
      attenteMs: 1500,
    },
    {
      id: "rec-quantites",
      cible: "recettes-quantites",
      href: "/nutrition",
      titre: "Les ingrédients et leurs quantités",
      texte:
        "Chaque ingrédient avec la quantité recalculée pour approcher la cible, et ce qu'il apporte. « Plancher » ou « plafond » signale un ingrédient bloqué à une limite fixée par votre coach.",
      attenteMs: 1500,
    },
    {
      id: "rec-ecarts",
      cible: "recettes-ecarts",
      href: "/nutrition",
      titre: "L'écart qui reste",
      texte:
        "La différence entre le total de la recette ainsi dosée et la cible du créneau. Un écart nul est rare ; le bandeau coloré au-dessus dit si l'approximation est acceptable.",
      attenteMs: 1500,
    },
    {
      id: "rec-sorties",
      cible: "recettes-sorties",
      href: "/nutrition",
      titre: "Rien n'est enregistré ici",
      texte:
        "Ces trois boutons sont les seules actions de la page, et ils ne font que revenir en arrière. Cette page calcule et affiche : elle n'écrit ni dans votre journal, ni dans votre plan, et tout disparaît si vous rechargez.",
      exemple: "Pour noter ce que vous avez vraiment mangé, passez par « Ajouter un aliment » sur la page du plan.",
      attenteMs: 1500,
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   ESPACE ÉLÈVE — TABLEAU DE BORD, PROGRESSION, DOCUMENTS
   ══════════════════════════════════════════════════════════════════════════ */

const DASHBOARD: EspaceGuide = {
  id: "dashboard",
  routeExacte: true,
  titre: "votre tableau de bord",
  route: "/dashboard",
  /*
   * ⚠️ TOUT CE QUI EST SUR CETTE PAGE N'EST PAS À VOUS. `app/(student)/dashboard/page.tsx`
   * passe encore des données d'exemple issues de `@/data/student` pour les
   * notifications du coach et les « Documents récents », et la première vignette
   * porte le libellé « Séances cette semaine (exemple) » avec une valeur écrite
   * en dur. Ces trois éléments n'ont donc PAS d'étape : présenter un exemple
   * comme le suivi d'un élève serait le plus sûr moyen de lui faire perdre
   * confiance dans le reste de la page.
   *
   * Les étapes ci-dessous ne portent que sur les blocs alimentés par les
   * données réelles de l'élève — profil, poids, programme assigné, plan
   * alimentaire, rendez-vous — tels que les lisent les hooks `useSupabase…`.
   */
  etapes: [
    {
      id: "dash-poids",
      cible: "dashboard-poids",
      href: "/dashboard",
      titre: "Votre poids actuel",
      texte:
        "La dernière valeur enregistrée dans votre suivi de poids. « Non renseigné » signifie simplement qu'aucune pesée n'a encore été saisie.",
    },
    {
      id: "dash-objectif",
      cible: "dashboard-objectif",
      href: "/dashboard",
      titre: "Votre objectif",
      texte:
        "L'objectif inscrit sur votre fiche par votre coach. Il sert de cap à la programmation, et se modifie avec lui.",
    },
    {
      id: "dash-progression",
      cible: "dashboard-progression",
      href: "/dashboard",
      titre: "L'écart depuis le départ",
      texte:
        "La différence entre votre poids actuel et votre première pesée enregistrée. Ce n'est pas une note : c'est un écart, et son sens dépend de votre objectif.",
    },
    {
      id: "dash-evolution",
      cible: "dashboard-evolution",
      href: "/dashboard",
      titre: "La courbe de poids",
      texte:
        "Vos pesées dans le temps. La vue couvre six mois : pour l'historique complet, la mise en regard avec l'entraînement et les photos, passez par Progression.",
    },
    {
      id: "dash-prochaine-seance",
      cible: "dashboard-prochaine-seance",
      href: "/dashboard",
      titre: "Votre prochaine séance",
      texte:
        "La séance mise en avant par votre programme assigné, avec son jour et sa durée prévue. « Aucun programme attribué » veut dire exactement cela — rien n'est masqué.",
    },
    {
      id: "dash-plan-alimentaire",
      cible: "dashboard-plan-alimentaire",
      href: "/dashboard",
      titre: "Votre plan alimentaire actif",
      texte:
        "Le plan que votre coach vous a affecté. Le détail des objectifs, le journal et les recettes sont dans la rubrique Alimentation.",
    },
    {
      id: "dash-rendez-vous",
      cible: "dashboard-rendez-vous",
      href: "/dashboard",
      titre: "Votre prochain rendez-vous",
      texte:
        "Le premier rendez-vous à venir qui est confirmé ou en attente. Les rendez-vous passés et la prise de créneau sont dans la rubriques Rendez-vous.",
      attenteMs: 1500,
    },
  ],
};

const PROGRESSION: EspaceGuide = {
  id: "progression",
  routeExacte: true,
  titre: "votre progression",
  route: "/progression",
  /*
   * ⚠️ HISTORIQUE, ÉVOLUTION ET OBJECTIF SONT TROIS LECTURES DIFFÉRENTES, et
   * cette page les présente côte à côte sans le dire. Le résumé donne l'ÉTAT
   * actuel, les sections suivantes l'HISTORIQUE par domaine, et l'objectif
   * reste ce que le coach a fixé sur la fiche. Les étapes nomment la différence.
   *
   * Chaque section est rendue MÊME VIDE : son titre s'affiche, son contenu non.
   * Les étapes tiennent donc toujours une cible, et expliquent ce qui remplira
   * la section plutôt que de laisser croire à un écran cassé.
   */
  etapes: [
    {
      id: "prog-resume",
      cible: "progression-resume",
      href: "/progression",
      titre: "Où vous en êtes",
      texte:
        "Le résumé : votre situation actuelle, en quelques chiffres. C'est un instantané — l'historique qui y mène se trouve dans les sections suivantes.",
      attenteMs: 1500,
    },
    {
      id: "prog-poids",
      cible: "progression-poids",
      href: "/progression",
      titre: "L'évolution du poids",
      texte:
        "Toutes vos pesées, et la tendance qu'elles dessinent. À distinguer de l'objectif fixé par votre coach : cette section décrit ce qui s'est passé, pas ce qui est visé.",
    },
    {
      id: "prog-entrainement",
      cible: "progression-entrainement",
      href: "/progression",
      titre: "Votre entraînement",
      texte:
        "Ce que vos séances enregistrées racontent : assiduité et volume de travail. Alimenté par les retours que vous enregistrez à la fin de chaque séance.",
    },
    {
      id: "prog-nutrition",
      cible: "progression-nutrition",
      href: "/progression",
      titre: "Le suivi nutrition de la semaine",
      texte:
        "Sur sept jours seulement, à la différence du reste de la page. Il se remplit avec ce que vous notez dans votre journal alimentaire.",
    },
    {
      id: "prog-photos",
      cible: "progression-photos",
      href: "/progression",
      titre: "Vos photos de progression",
      texte:
        "Votre galerie, avec le nombre de photos et la date de la dernière. C'est aussi d'ici que vous en ajoutez.",
    },
    {
      id: "prog-avant-apres",
      cible: "progression-avant-apres",
      href: "/progression",
      titre: "La comparaison avant / après",
      texte:
        "Elle ne se construit pas toute seule : choisissez une photo « avant » et une photo « après » dans la galerie juste au-dessus. Le PDF de transformation apparaît une fois les deux désignées.",
    },
  ],
};

const DOCUMENTS: EspaceGuide = {
  id: "documents",
  routeExacte: true,
  titre: "vos documents",
  route: "/documents",
  /*
   * ⚠️ LES ÉTAPES DÉCRIVENT LA BIBLIOTHÈQUE RÉELLE (`RealDocumentLibrary`), pas
   * la version d'exemple. Si aucun document n'est affecté, le composant rend une
   * seule phrase et aucune des ancres : la visite n'a alors rien à montrer et
   * s'arrête proprement, ce qui vaut mieux qu'expliquer une recherche dans une
   * liste vide.
   *
   * ⚠️ AUCUNE ÉTAPE NE PROMET UN TÉLÉCHARGEMENT. Selon le document, l'action
   * réellement offerte est « Ouvrir le PDF », « Voir la vidéo », « Ouvrir » ou
   * « Télécharger » — et sur un document encore verrouillé, aucune. L'étape
   * nomme la zone d'actions sans annoncer un bouton qui n'y sera peut-être pas.
   */
  etapes: [
    {
      id: "doc-recherche",
      cible: "documents-recherche",
      href: "/documents",
      titre: "Retrouver un document",
      texte:
        "La recherche porte sur le titre et la description courte de vos documents. Elle filtre la liste au fil de la frappe.",
      attenteMs: 1500,
    },
    {
      id: "doc-filtres",
      cible: "documents-filtres",
      href: "/documents",
      titre: "Les filtres",
      texte:
        "Les raccourcis par nature de document. Ils se combinent avec la recherche : un filtre actif et un mot tapé s'appliquent tous les deux.",
    },
    {
      id: "doc-liste",
      cible: "documents-liste",
      href: "/documents",
      titre: "Vos documents",
      texte:
        "Une carte par document affecté par votre coach. Le bandeau « Nouveau » ou « Consulté » dit si vous l'avez déjà ouvert.",
    },
    {
      id: "doc-carte",
      cible: "documents-carte",
      href: "/documents",
      titre: "Lire une carte",
      texte:
        "Le titre, puis la nature et la catégorie du document, puis sa description. Un document peut être marqué important, ou encore verrouillé jusqu'à une date — son contenu n'est alors pas accessible.",
    },
    {
      id: "doc-actions",
      cible: "documents-actions",
      href: "/documents",
      titre: "Ouvrir le document",
      texte:
        "Les actions disponibles pour ce document : selon sa nature, ouvrir le PDF, voir la vidéo, ou ouvrir le fichier. Un document verrouillé n'en propose aucune tant que sa date n'est pas atteinte.",
      attenteMs: 1500,
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   LE CATALOGUE
   ══════════════════════════════════════════════════════════════════════════ */

export const ESPACES_GUIDES: readonly EspaceGuide[] = [
  ENTRAINEMENT_SEANCE,
  ENTRAINEMENT_ACCUEIL,
  NUTRITION_RECETTES,
  NUTRITION_PLAN,
  DASHBOARD,
  PROGRESSION,
  DOCUMENTS,
] as const;

/**
 * La visite correspondant à la route courante, ou `null`.
 *
 * ⚠️ LE PRÉFIXE LE PLUS LONG GAGNE. `/entrainement/seance/42` correspond à la
 * fois à `/entrainement` et à `/entrainement/seance` : sans cette règle,
 * l'ordre de déclaration déciderait, et la visite de la séance serait écrasée
 * par celle de l'accueil au premier réarrangement du tableau.
 */
export function espaceGuidePour(pathname: string | null | undefined): EspaceGuide | null {
  if (!pathname) return null;
  let meilleur: EspaceGuide | null = null;
  let meilleureSpecificite = -1;
  for (const espace of ESPACES_GUIDES) {
    const correspond = espace.routeExacte
      ? pathname === espace.route
      : pathname === espace.route || pathname.startsWith(espace.route);
    if (!correspond) continue;
    // Le suffixe, quand il existe, est une CONDITION — pas un bonus.
    if (espace.routeSuffixe && !pathname.endsWith(espace.routeSuffixe)) continue;
    const specificite = espace.route.length + (espace.routeSuffixe?.length ?? 0);
    if (!meilleur || specificite > meilleureSpecificite) {
      meilleur = espace;
      meilleureSpecificite = specificite;
    }
  }
  return meilleur;
}

/* ══════════════════════════════════════════════════════════════════════════
   MÉMORISATION, PAR ESPACE
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ UNE CLÉ PAR ESPACE, ET SURTOUT PAS CELLE DE LA VISITE DES MENUS. Les
   deux parcours répondent à des questions différentes : avoir fait le tour des
   menus ne dit rien sur le fait d'avoir compris comment on enregistre un
   repas. Partager la clé ferait disparaître toutes les propositions d'un coup.
   ══════════════════════════════════════════════════════════════════════════ */

export const PREFIXE_CLE_ESPACE = "guide-espace-";

export function cleEspace(id: string): string {
  return `${PREFIXE_CLE_ESPACE}${id}`;
}

export function espaceDejaVu(stockage: Pick<Storage, "getItem"> | null | undefined, id: string): boolean {
  if (!stockage) return false;
  try {
    return stockage.getItem(cleEspace(id)) === "1";
  } catch {
    // Stockage refusé (navigation privée) : on reproposera, ce qui est bénin.
    return false;
  }
}

export function marquerEspaceVu(stockage: Pick<Storage, "setItem"> | null | undefined, id: string): void {
  if (!stockage) return;
  try {
    stockage.setItem(cleEspace(id), "1");
  } catch {
    // Sans stockage, la proposition reviendra : acceptable, jamais bloquant.
  }
}
