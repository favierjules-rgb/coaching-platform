/**
 * LE RANGEMENT DE LA FICHE ÉLÈVE — six catégories, et rien d'autre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE MODULE NE RANGE QUE DE L'AFFICHAGE
 * ════════════════════════════════════════════════════════════════════════
 * Il ne lit rien, n'écrit rien, ne connaît ni Supabase ni React : ce sont des
 * DONNÉES, et c'est ce qui permet de vérifier le rangement (aucune section
 * perdue, aucune en double, aucun onglet vide) sans monter une page ni une base.
 *
 * ⚠️ IL N'EST PAS LA SOURCE DE VÉRITÉ DE L'AFFICHAGE, IL EN EST LE CONTRAT.
 * Les sections sont rendues par la page, avec leurs composants et leurs
 * conditions d'origine INCHANGÉS. Ce registre déclare où chacune est rangée, et
 * c'est sur lui que les tests s'appuient pour détecter une section qui
 * disparaîtrait, se dédoublerait, ou changerait d'onglet en silence.
 *
 * ⚠️ UNE SECTION, UNE CATÉGORIE. Le cahier des charges interdit les doublons :
 * il n'y a donc PAS de « vue d'ensemble » faite de contenus déjà placés
 * ailleurs. Le rôle de vue d'ensemble est tenu par l'en-tête (identité, statut,
 * barre d'actions), qui reste HORS des onglets et visible depuis chacun.
 */

export type CategorieProfil = "profil" | "corps" | "entrainement" | "nutrition" | "administration" | "notes";

export interface CategorieDuProfil {
  readonly cle: CategorieProfil;
  readonly libelle: string;
}

/**
 * Les six onglets, dans l'ordre affiché.
 *
 * ⚠️ UN SEUL LIBELLÉ PAR ONGLET, POUR TOUTES LES TAILLES D'ÉCRAN. Une variante
 * courte cachée en `sm:hidden` ferait exister deux fois le même intitulé dans
 * l'arbre d'accessibilité ; la barre défile horizontalement sur mobile plutôt
 * que d'abréger.
 */
export const CATEGORIES_DU_PROFIL: readonly CategorieDuProfil[] = [
  { cle: "profil", libelle: "Profil" },
  { cle: "corps", libelle: "Suivi corporel" },
  { cle: "entrainement", libelle: "Entraînement" },
  { cle: "nutrition", libelle: "Nutrition" },
  { cle: "administration", libelle: "Administration" },
  { cle: "notes", libelle: "Notes & historique" },
];

/** L'onglet ouvert à l'arrivée sur la fiche. */
export const CATEGORIE_PAR_DEFAUT: CategorieProfil = "profil";

export interface SectionDuProfil {
  /** Identifiant stable, jamais affiché. */
  readonly cle: string;
  /** Le titre tel qu'il est LU à l'écran, mot pour mot — inchangé par ce chantier. */
  readonly titre: string;
  readonly categorie: CategorieProfil;
  /**
   * `true` quand la section n'apparaît que sous condition (élève Supabase, plan
   * assigné, questionnaire rempli).
   *
   * ⚠️ SERT À PROUVER QU'AUCUN ONGLET NE PEUT ÊTRE VIDE. Chaque catégorie doit
   * contenir au moins une section INCONDITIONNELLE : sans cela, une fiche de
   * démonstration ouvrirait un onglet sur une page blanche.
   */
  readonly conditionnelle: boolean;
  /** La condition d'affichage, telle qu'elle est écrite dans la page. */
  readonly condition?: string;
}

/**
 * Les 21 sections de la fiche, et leur onglet.
 *
 * ⚠️ AUCUNE SECTION N'EST AJOUTÉE NI RETIRÉE ICI. Cette liste décrit l'existant :
 * si elle s'écarte de la page, c'est la liste ou la page qui a tort, et les tests
 * le disent.
 *
 * ⚠️ L'ORDRE SUIT CELUI DE LA PAGE, ET CE N'EST PAS UN DÉTAIL. À l'intérieur d'un
 * onglet, les sections gardent leur ordre relatif d'avant le rangement : le coach
 * retrouve les mêmes voisines, et le test d'ordre détecte une section qu'on aurait
 * déplacée « au passage » sans que personne l'ait demandé.
 */
export const SECTIONS_DU_PROFIL: readonly SectionDuProfil[] = [
  /* ── Profil : ce que l'élève a déclaré ────────────────────────────────── */
  { cle: "informations-personnelles", titre: "Informations personnelles", categorie: "profil", conditionnelle: false },
  { cle: "preferences-alimentaires", titre: "Préférences alimentaires", categorie: "profil", conditionnelle: false },
  { cle: "preferences-sportives", titre: "Préférences sportives", categorie: "profil", conditionnelle: false },
  { cle: "objectifs", titre: "Objectifs", categorie: "profil", conditionnelle: true, condition: "onboardingProfile" },
  { cle: "blessures", titre: "Blessures et contraintes", categorie: "profil", conditionnelle: false },

  /* ── Suivi corporel : ce que le corps dit ─────────────────────────────── */
  { cle: "poids", titre: "Évolution du poids", categorie: "corps", conditionnelle: false },
  { cle: "photos", titre: "Photos de progression", categorie: "corps", conditionnelle: false },
  { cle: "mensurations", titre: "Mensurations", categorie: "corps", conditionnelle: false },
  { cle: "physiologie", titre: "Profil physiologique", categorie: "corps", conditionnelle: true, condition: "isSupabaseStudent" },

  /* ── Entraînement ─────────────────────────────────────────────────────── */
  { cle: "programme-actif", titre: "Programme actif", categorie: "entrainement", conditionnelle: false },
  { cle: "retours-recents", titre: "Retours récents", categorie: "entrainement", conditionnelle: false },
  { cle: "charge-entrainement", titre: "Charge d'entraînement de l'élève", categorie: "entrainement", conditionnelle: false },
  { cle: "performances", titre: "Performances", categorie: "entrainement", conditionnelle: false },

  /* ── Nutrition ────────────────────────────────────────────────────────── */
  { cle: "plan-nutrition", titre: "Plan nutrition actif", categorie: "nutrition", conditionnelle: false },
  {
    cle: "suivi-nutrition",
    titre: "Suivi nutrition",
    categorie: "nutrition",
    conditionnelle: true,
    condition: "isSupabaseStudent && assignedPlan",
  },
  {
    cle: "historique-alimentaire",
    titre: "Historique alimentaire",
    categorie: "nutrition",
    conditionnelle: true,
    condition: "isSupabaseStudent",
  },

  /* ── Administration ───────────────────────────────────────────────────── */
  /*
   * ⚠️ DEUX TITRES POSSIBLES POUR UNE SEULE SECTION. Un élève réel voit
   * « Abonnement & Paiement » (`StudentSubscriptionSection`), une fiche de
   * démonstration voit « Paiement » (`PaymentSection`). C'est le comportement
   * actuel, et il n'est pas touché : le registre retient le titre de la branche
   * réelle, et le test accepte l'un OU l'autre.
   */
  { cle: "abonnement", titre: "Abonnement & Paiement", categorie: "administration", conditionnelle: false },
  { cle: "notifications", titre: "Notifications", categorie: "administration", conditionnelle: true, condition: "isSupabaseStudent" },
  { cle: "documents", titre: "Documents", categorie: "administration", conditionnelle: false },

  /* ── Notes & historique : la trace du coach ───────────────────────────── */
  { cle: "historique-recent", titre: "Historique récent", categorie: "notes", conditionnelle: true, condition: "isSupabaseStudent" },
  { cle: "notes-privees", titre: "Notes privées du coach", categorie: "notes", conditionnelle: false },
];

/** Les sections d'un onglet, dans l'ordre d'affichage. */
export function sectionsDeLaCategorie(categorie: CategorieProfil): SectionDuProfil[] {
  return SECTIONS_DU_PROFIL.filter((section) => section.categorie === categorie);
}

/** L'onglet d'une section — `null` si elle n'est pas rangée. */
export function categorieDeLaSection(cle: string): CategorieProfil | null {
  return SECTIONS_DU_PROFIL.find((section) => section.cle === cle)?.categorie ?? null;
}

/**
 * Les onglets qui pourraient s'ouvrir sur du vide.
 *
 * Un onglet dont TOUTES les sections sont conditionnelles se présenterait vide
 * dès que la condition n'est pas remplie. La liste doit rester vide.
 */
export function categoriesPotentiellementVides(): CategorieProfil[] {
  return CATEGORIES_DU_PROFIL.filter(({ cle }) => {
    const sections = sectionsDeLaCategorie(cle);
    return sections.length === 0 || sections.every((section) => section.conditionnelle);
  }).map(({ cle }) => cle);
}

/** L'identifiant DOM du panneau d'un onglet — partagé par `aria-controls` et le panneau. */
export function idDuPanneau(categorie: CategorieProfil): string {
  return `profil-eleve-panneau-${categorie}`;
}

/** L'identifiant DOM d'un onglet — cible de `aria-labelledby` du panneau. */
export function idDeLOnglet(categorie: CategorieProfil): string {
  return `profil-eleve-onglet-${categorie}`;
}
