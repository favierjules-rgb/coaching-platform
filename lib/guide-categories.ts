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
    {
      id: "seance-remplacement",
      cible: "seance-remplacement",
      href: "/entrainement/seance",
      titre: "Remplacer un exercice",
      texte:
        "Si un mouvement est impossible — matériel pris, douleur, machine absente — vous choisissez ici un exercice de remplacement proposé pour celui-ci. Votre coach voit ce que vous avez réellement fait à la place.",
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
  etapes: [
    {
      id: "nut-objectifs",
      cible: "espace-nutrition-objectifs",
      href: "/nutrition",
      titre: "Vos objectifs du jour",
      texte: "Le résumé de ce que vous visez sur la journée, et où vous en êtes au fil de vos repas enregistrés.",
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
    {
      id: "nut-courses",
      cible: "espace-nutrition-courses",
      href: "/nutrition",
      titre: "Votre liste de courses",
      texte: "La liste construite à partir de votre plan, que vous cochez au fur et à mesure dans le magasin.",
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   LE CATALOGUE
   ══════════════════════════════════════════════════════════════════════════ */

export const ESPACES_GUIDES: readonly EspaceGuide[] = [
  ENTRAINEMENT_SEANCE,
  ENTRAINEMENT_ACCUEIL,
  NUTRITION_PLAN,
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
  for (const espace of ESPACES_GUIDES) {
    const correspond = pathname === espace.route || pathname.startsWith(espace.route);
    if (!correspond) continue;
    if (!meilleur || espace.route.length > meilleur.route.length) meilleur = espace;
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
