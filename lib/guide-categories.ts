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
  etapes: [
    {
      id: "seance-echauffement",
      cible: "espace-seance-echauffement",
      href: "/entrainement/seance",
      titre: "L'échauffement",
      texte: "Ce que votre coach a prévu avant d'attaquer le travail principal.",
    },
    {
      id: "seance-notes",
      cible: "espace-seance-notes",
      href: "/entrainement/seance",
      titre: "Les notes du coach",
      texte: "Les consignes laissées pour cette séance précise : intention, points de vigilance, adaptations.",
    },
    {
      id: "seance-retour",
      cible: "espace-seance-retour",
      href: "/entrainement/seance",
      titre: "Votre retour de séance",
      texte:
        "En fin de séance, vous renvoyez à votre coach ce qui s'est passé. C'est ce retour qui lui permet d'ajuster la suite.",
      exemple: "Signaler qu'un exercice était trop lourd pour que la charge soit revue.",
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
