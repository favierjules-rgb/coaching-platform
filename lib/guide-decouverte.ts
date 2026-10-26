import { sectionAdminVisible, type DroitsNavigationAdmin } from "@/lib/admin-shell-nav";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * VISITE GUIDÉE DE DÉCOUVERTE — LA LOGIQUE, SANS REACT ET SANS DOM
 * ════════════════════════════════════════════════════════════════════════════
 * Tout ce qui peut être décidé sans navigateur l'est ici : le contenu des
 * étapes, leur filtrage par rôle, le passage d'une étape à l'autre, le
 * placement de la carte et la mémorisation de la fin du parcours.
 * `components/guide/GuideDecouverte.tsx` ne fait que poser le DOM par-dessus.
 *
 * ⚠️ LE FILTRAGE PAR RÔLE N'EST PAS RÉÉCRIT ICI. Il appelle
 * `sectionAdminVisible()`, la fonction qui décide DÉJÀ ce que la sidebar
 * affiche. Dupliquer la règle, c'est signer sa divergence : le jour où un
 * collaborateur gagne ou perd une catégorie, la sidebar et le guide ne
 * diraient plus la même chose, et le guide montrerait un menu que l'élève ou
 * le collaborateur ne voit pas. Une seule source, donc.
 *
 * ⚠️ CE GUIDE N'OUVRE AUCUN DROIT. Il ne lit que ce que la navigation expose
 * déjà ; il ne contourne ni les gardes serveur (`lib/supabase/guards.ts`) ni
 * la RLS. Masquer une étape est un confort d'affichage, jamais une sécurité —
 * exactement comme le masquage de menu qu'il reprend.
 */

/** Valeur de l'attribut `data-guide` posé sur l'élément à mettre en lumière. */
export type CibleGuide = string;

export interface EtapeGuide {
  /** Identifiant stable, utilisé par les tests et la reprise de parcours. */
  readonly id: string;
  /**
   * ⚠️ UN ATTRIBUT `data-guide`, PAS UN SÉLECTEUR CSS. Une classe Tailwind ou
   * une structure de DOM changent au premier ajustement visuel et la cible
   * devient introuvable en silence. L'attribut est posé exprès pour le guide
   * et ne bouge que si on le décide.
   */
  readonly cible: CibleGuide;
  readonly titre: string;
  readonly texte: string;
  /** Exemple concret, facultatif : affiché en retrait sous l'explication. */
  readonly exemple?: string;
  /** Route correspondante — sert au filtrage par rôle, pas à naviguer. */
  readonly href: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   LE CONTENU
   ══════════════════════════════════════════════════════════════════════════
   ⚠️ LES DESCRIPTIONS DÉCRIVENT CE QUE LE MENU EST, PAS CE QU'ON IMAGINE
   QU'IL FAIT. Elles sont tirées des libellés de `AdminSidebar`/`StudentSidebar`
   et des titres réellement rendus par les pages. Là où la page compose son
   titre dans un sous-composant, l'explication reste au niveau du menu plutôt
   que d'inventer un détail invérifiable.
   ══════════════════════════════════════════════════════════════════════════ */

export const ETAPES_STAFF: readonly EtapeGuide[] = [
  {
    id: "staff-dashboard",
    cible: "nav-admin-dashboard",
    href: "/admin",
    titre: "Votre tableau de bord",
    texte: "Le point de départ : l'activité récente de vos élèves et ce qui demande votre attention.",
    exemple: "Repérer d'un coup d'œil un élève sans connexion récente.",
  },
  {
    id: "staff-eleves",
    cible: "nav-admin-eleves",
    href: "/admin/eleves",
    titre: "Vos élèves",
    texte: "La liste de vos élèves et leur fiche : c'est de là que part l'essentiel du suivi.",
    exemple: "Ouvrir une fiche pour lui affecter un programme ou un plan.",
  },
  {
    id: "staff-programmation",
    cible: "nav-admin-programmation",
    href: "/admin/programmes",
    titre: "Programmation",
    texte:
      "Vos contenus d'entraînement, regroupés : les programmes, la banque d'exercices et la banque de séances.",
    exemple: "Construire un programme, puis le réutiliser pour plusieurs élèves.",
  },
  {
    id: "staff-calendrier",
    cible: "nav-admin-calendrier",
    href: "/admin/calendrier",
    titre: "Calendrier",
    texte: "Vos rendez-vous et vos disponibilités.",
  },
  {
    id: "staff-nutrition",
    cible: "nav-admin-nutrition",
    href: "/admin/nutrition",
    titre: "Nutrition",
    texte: "Les plans alimentaires que vous créez et affectez à vos élèves.",
  },
  {
    id: "staff-documents",
    cible: "nav-admin-documents",
    href: "/admin/documents",
    titre: "Documents",
    texte: "Les documents partagés avec vos élèves.",
  },
  {
    id: "staff-retours",
    cible: "nav-admin-retours",
    href: "/admin/retours",
    titre: "Retours élèves",
    texte: "Ce que vos élèves renvoient après leurs séances.",
    exemple: "Ajuster la charge d'un exercice après un retour de difficulté.",
  },
  {
    id: "staff-paiements",
    cible: "nav-admin-paiements",
    href: "/admin/paiements",
    titre: "Paiements",
    texte: "L'état des abonnements et des paiements.",
  },
  {
    id: "staff-emails",
    cible: "nav-admin-emails",
    href: "/admin/emails",
    titre: "Emails",
    texte: "Vos envois d'emails aux élèves.",
  },
  {
    id: "staff-notifications",
    cible: "nav-admin-notifications",
    href: "/admin/notifications",
    titre: "Notifications",
    texte: "Les notifications envoyées aux élèves et leurs réglages.",
  },
  {
    id: "staff-parametres",
    cible: "nav-admin-parametres",
    href: "/admin/parametres",
    titre: "Paramètres",
    texte: "Vos informations de coach et, selon vos droits, la gestion des coachs.",
  },
] as const;

export const ETAPES_ELEVE: readonly EtapeGuide[] = [
  {
    id: "eleve-dashboard",
    cible: "nav-eleve-dashboard",
    href: "/dashboard",
    titre: "Votre tableau de bord",
    texte: "Votre vue d'ensemble : ce qui vous attend et où vous en êtes.",
  },
  {
    id: "eleve-entrainement",
    cible: "nav-eleve-entrainement",
    href: "/entrainement",
    titre: "Entraînement",
    texte: "Vos séances : c'est ici que vous suivez votre programme et enregistrez vos performances.",
    exemple: "Ouvrir la séance du jour et noter vos charges série par série.",
  },
  {
    id: "eleve-nutrition",
    cible: "nav-eleve-nutrition",
    href: "/nutrition",
    titre: "Nutrition",
    texte: "Votre plan alimentaire et le suivi de vos repas.",
  },
  {
    id: "eleve-progression",
    cible: "nav-eleve-progression",
    href: "/progression",
    titre: "Progression",
    texte: "L'évolution de vos performances et de vos mesures dans le temps.",
  },
  {
    id: "eleve-rendez-vous",
    cible: "nav-eleve-rendez-vous",
    href: "/rendez-vous",
    titre: "Rendez-vous",
    texte: "La prise de rendez-vous avec votre coach.",
  },
  {
    id: "eleve-documents",
    cible: "nav-eleve-documents",
    href: "/documents",
    titre: "Documents",
    texte: "Les documents que votre coach partage avec vous.",
  },
  {
    id: "eleve-profil",
    cible: "nav-eleve-profil",
    href: "/profil",
    titre: "Profil",
    texte: "Vos informations personnelles et vos préférences, dont les notifications.",
  },
] as const;

/**
 * L'identifiant de mise en lumière d'un menu, dérivé de sa route.
 *
 * ⚠️ UNE SEULE SOURCE POUR LES DEUX CÔTÉS. Les sidebars posent
 * `data-guide={cibleGuideStaff(href)}` et les étapes ci-dessus déclarent la
 * même valeur ; le test F3 appelle cette fonction et exige qu'elles
 * coïncident. Tant que la dérivation vivait en double — une copie dans chaque
 * sidebar — rien ne pouvait le vérifier autrement qu'en cherchant une chaîne
 * littérale dans le source, ce qu'un attribut CALCULÉ ne contient jamais.
 */
export function cibleGuideStaff(href: string): CibleGuide {
  if (href === "/admin") return "nav-admin-dashboard";
  if (href === "/admin/programmes" || href === "/admin/exercices" || href === "/admin/seances") {
    return "nav-admin-programmation";
  }
  return `nav-admin-${href.replace("/admin/", "")}`;
}

export function cibleGuideEleve(href: string): CibleGuide {
  return `nav-eleve-${href.replace("/", "")}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   FILTRAGE PAR RÔLE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les étapes staff que CET utilisateur peut voir, dans l'ordre.
 *
 * ⚠️ `sectionAdminVisible` traite déjà le chargement en cours et le cas où les
 * fonctions de rôle sont introuvables : on ne redécide rien ici. Le groupe
 * « Programmation » suit la même règle que la sidebar — visible si au moins
 * une de ses trois sous-sections l'est.
 */
export function etapesStaffVisibles(droits: DroitsNavigationAdmin): readonly EtapeGuide[] {
  const sousSectionsProgrammation = ["/admin/programmes", "/admin/exercices", "/admin/seances"];
  return ETAPES_STAFF.filter((etape) => {
    if (etape.id === "staff-programmation") {
      return sousSectionsProgrammation.some((href) => sectionAdminVisible(href, droits));
    }
    return sectionAdminVisible(etape.href, droits);
  });
}

/** Comptes restreints au programme seul : mêmes routes que `StudentSidebar`. */
const HREFS_PROGRAMME_SEUL: ReadonlySet<string> = new Set(["/entrainement", "/profil"]);

/**
 * Les étapes élève visibles.
 *
 * ⚠️ LE CADENAS N'EST PAS UN MASQUAGE. Un élève dont l'abonnement est expiré
 * voit toujours ses menus, avec un cadenas : la sidebar les affiche, le guide
 * aussi. Seul `programme_seul` RETIRE réellement des entrées, et c'est le seul
 * cas filtré ici — reproduire le cadenas en masquage ferait mentir le guide
 * sur ce que l'élève a sous les yeux.
 */
export function etapesEleveVisibles(accessType: "coaching" | "programme_seul" | null | undefined): readonly EtapeGuide[] {
  if (accessType !== "programme_seul") return ETAPES_ELEVE;
  return ETAPES_ELEVE.filter((etape) => HREFS_PROGRAMME_SEUL.has(etape.href));
}

/* ══════════════════════════════════════════════════════════════════════════
   PARCOURS
   ══════════════════════════════════════════════════════════════════════════ */

/** Index borné : jamais hors du tableau, même sur un parcours vide. */
export function indexBorne(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

export function estDerniereEtape(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}

/**
 * L'étape suivante ATTEIGNABLE à partir de `index`, dans la direction donnée.
 *
 * ⚠️ C'EST LA GARANTIE « JAMAIS BLOQUÉ SUR UNE CIBLE INTROUVABLE ». Un menu
 * peut être absent du DOM sans que le rôle y soit pour rien : replié dans un
 * tiroir mobile, hors écran, pas encore monté. Plutôt que d'afficher une carte
 * pointant le vide, on saute à l'étape suivante dont la cible existe. Si plus
 * aucune n'existe dans cette direction, on rend `null` et l'appelant termine
 * le parcours proprement.
 */
export function prochaineEtapeAtteignable(
  etapes: readonly EtapeGuide[],
  depuis: number,
  direction: 1 | -1,
  cibleExiste: (cible: CibleGuide) => boolean,
): number | null {
  for (let i = depuis; i >= 0 && i < etapes.length; i += direction) {
    const etape = etapes[i];
    if (etape && cibleExiste(etape.cible)) return i;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   PLACEMENT DE LA CARTE
   ══════════════════════════════════════════════════════════════════════════ */

export type PlacementCarte = "droite" | "gauche" | "dessous" | "dessus" | "bas-ecran";

export interface Rectangle {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionCarte {
  readonly top: number;
  readonly left: number;
  readonly placement: PlacementCarte;
}

/** En deçà, la carte occupe le bas de l'écran : aucune place pour la flanquer. */
export const SEUIL_MOBILE = 640;
/** Marge entre la découpe et la carte, et entre la carte et le bord. */
export const ECART = 16;

/**
 * Où poser la carte pour qu'elle reste ENTIÈREMENT visible.
 *
 * Ordre d'essai : à droite de la cible (la navigation est à gauche), sinon à
 * gauche, sinon dessous, sinon dessus. Chaque candidat n'est retenu que s'il
 * tient en entier ; le dernier recours borne la position dans la fenêtre.
 *
 * ⚠️ SOUS `SEUIL_MOBILE`, AUCUN FLANC N'EST TENTÉ. Sur un téléphone, une carte
 * de 320 px à côté d'un menu de 240 px ne tient pas : elle est ancrée en bas
 * de l'écran, pleine largeur, là où le pouce l'atteint. C'est la règle qui
 * empêche la carte de sortir de la zone visible sur mobile.
 */
export function positionnerCarte(
  cible: Rectangle,
  fenetre: { width: number; height: number },
  carte: { width: number; height: number },
): PositionCarte {
  if (fenetre.width < SEUIL_MOBILE) {
    return {
      top: Math.max(ECART, fenetre.height - carte.height - ECART),
      left: ECART,
      placement: "bas-ecran",
    };
  }

  const tientHorizontalement = (left: number) => left >= ECART && left + carte.width <= fenetre.width - ECART;
  const tientVerticalement = (top: number) => top >= ECART && top + carte.height <= fenetre.height - ECART;

  const centreVertical = cible.top + cible.height / 2 - carte.height / 2;
  const centreHorizontal = cible.left + cible.width / 2 - carte.width / 2;

  const candidats: readonly PositionCarte[] = [
    { left: cible.left + cible.width + ECART, top: centreVertical, placement: "droite" },
    { left: cible.left - carte.width - ECART, top: centreVertical, placement: "gauche" },
    { left: centreHorizontal, top: cible.top + cible.height + ECART, placement: "dessous" },
    { left: centreHorizontal, top: cible.top - carte.height - ECART, placement: "dessus" },
  ];

  for (const candidat of candidats) {
    if (tientHorizontalement(candidat.left) && tientVerticalement(candidat.top)) return candidat;
  }

  // Dernier recours : on garde le placement préféré mais on ramène la carte
  // dans la fenêtre. Mieux vaut une carte décalée qu'une carte hors écran.
  const repli = candidats[0] as PositionCarte;
  return {
    placement: repli.placement,
    left: Math.min(Math.max(repli.left, ECART), Math.max(ECART, fenetre.width - carte.width - ECART)),
    top: Math.min(Math.max(repli.top, ECART), Math.max(ECART, fenetre.height - carte.height - ECART)),
  };
}

/** La cible est-elle suffisamment dans la fenêtre pour ne pas devoir défiler ? */
export function doitFaireDefiler(cible: Rectangle, fenetre: { height: number }): boolean {
  return cible.top < ECART || cible.top + cible.height > fenetre.height - ECART;
}

/* ══════════════════════════════════════════════════════════════════════════
   MÉMORISATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ `localStorage` ET PAS LA BASE, ET C'EST UN CHOIX. « J'ai vu la visite »
 * est une préférence d'affichage locale : la stocker en base demanderait une
 * colonne, une migration et une policy pour un confort qui n'a aucune valeur
 * métier. La contrepartie est assumée : la visite sera reproposée sur un
 * nouvel appareil. Le point d'entrée permanent rend cela sans conséquence.
 */
export const CLE_GUIDE_TERMINE = "guide-decouverte-termine";

/** Vrai si l'utilisateur a déjà terminé OU explicitement quitté le parcours. */
export function guideDejaVu(stockage: Pick<Storage, "getItem"> | null | undefined): boolean {
  if (!stockage) return false;
  try {
    return stockage.getItem(CLE_GUIDE_TERMINE) === "1";
  } catch {
    // Mode privé, stockage refusé : on considère que le guide n'a pas été vu.
    // Le reproposer est bénin ; planter ne l'est pas.
    return false;
  }
}

export function marquerGuideVu(stockage: Pick<Storage, "setItem"> | null | undefined): void {
  if (!stockage) return;
  try {
    stockage.setItem(CLE_GUIDE_TERMINE, "1");
  } catch {
    // Sans stockage, la visite sera reproposée : acceptable, jamais bloquant.
  }
}
