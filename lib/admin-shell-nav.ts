/**
 * Helpers PURS et testables du shell admin (polish Apple, Lot A) :
 *  - détection de route active de la sidebar (item + groupe Programmation),
 *    source unique du style actif ET de `aria-current` ;
 *  - machine d'état minimale du drawer mobile (Échap / overlay / navigation /
 *    bouton menu) ;
 *  - boucle de focus du drawer (Tab depuis le dernier élément → premier,
 *    Shift+Tab depuis le premier → dernier, focus égaré → premier), calculée
 *    sur une simple liste — aucun accès DOM ici, donc testable en Node ;
 *  - verrou de scroll du document derrière le drawer.
 * Aucune dépendance. Consommé par AdminShell/AdminSidebar uniquement.
 */

/** Item actif : correspondance exacte pour /admin (racine), préfixe sinon. */
export function isAdminRouteActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

/** Groupe actif (ex. Programmation) : au moins une route enfant active. */
export function isAnyAdminRouteActive(pathname: string | null | undefined, hrefs: readonly string[]): boolean {
  return hrefs.some((href) => isAdminRouteActive(pathname, href));
}

/** Sous-menu affiché : ouvert dès qu'une route du groupe est active, sinon piloté par le clic. */
export function isSubmenuOpen(groupActive: boolean, manuallyOpen: boolean): boolean {
  return groupActive || manuallyOpen;
}

/**
 * Sélecteur des éléments focusables du drawer. `:not([disabled])` exclut les
 * contrôles désactivés de la boucle clavier.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Cible du focus pour un appui Tab/Shift+Tab dans le drawer :
 *  - liste vide → null (rien à faire) ;
 *  - focus courant hors de la liste (égaré derrière l'overlay) → premier ;
 *  - Tab sur le dernier → premier ; Shift+Tab sur le premier → dernier ;
 *  - sinon → null (le navigateur gère le Tab interne normalement).
 */
export function wrapFocusTarget<T>(elements: readonly T[], current: T | null, shiftKey: boolean): T | null {
  if (elements.length === 0) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const index = current === null ? -1 : elements.indexOf(current);
  if (index === -1) return first;
  if (shiftKey && index === 0) return last;
  if (!shiftKey && index === elements.length - 1) return first;
  return null;
}

export type DrawerEvent = "escape" | "overlay" | "navigate" | "toggle";

/** Prochain état ouvert/fermé du drawer selon l'événement. */
export function nextDrawerOpen(open: boolean, event: DrawerEvent): boolean {
  if (event === "toggle") return !open;
  return false; // escape, overlay et navigation ferment toujours
}

/**
 * Valeur d'`overflow` du <body> : "hidden" tant que le drawer est ouvert,
 * valeur d'origine restaurée à la fermeture (y compris chaîne vide).
 */
export function bodyOverflowFor(open: boolean, previousOverflow: string): string {
  return open ? "hidden" : previousOverflow;
}

/* ══════════════════════════════════════════════════════════════════════════
   CLOISONNEMENT DE LA NAVIGATION PAR CATÉGORIE (P13-B, 11/10/2026)

   ⚠️ CE N'EST PAS UNE PROTECTION. Masquer un lien n'empêche personne de taper
   l'URL : la sécurité réelle est portée par les policies RLS (migration
   20261011100000) et par les gardes de lib/api/authz.ts, qui refusent
   indépendamment de ce qui est affiché. Ce qui est corrigé ici est un problème
   d'HONNÊTETÉ de l'interface : un collaborateur nutrition voyait les quinze
   sections, dont treize ne lui montraient que des listes vides.

   La catégorie de chaque section est déduite des TABLES qu'elle lit, telles
   que la migration les range — et non du nom de la section :

     /admin                 accueil      tout le staff (point d'entrée)
     /admin/eleves          suivi_eleve  students, student_profiles, coach_notes
     /admin/programmes      entrainement programs, workout_sessions
     /admin/exercices       entrainement exercise_library
     /admin/seances         entrainement session_templates, training_blocks
     /admin/calendrier      agenda_comm. appointments, coach_availabilities
     /admin/nutrition       nutrition    nutrition_plans, meals, food_lists
     /admin/documents       3 catégories documents, routés par `category`
     /admin/retours         entrainement workout_feedback, exercise_feedback
     /admin/paiements       —            payments (aucune catégorie ne l'ouvre)
     /admin/abonnements     —            subscription_templates
     /admin/emails          —            email_logs : est_staff_global()
     /admin/notifications   —            notification_campaigns : est_staff_global()
     /admin/newsletter      —            newsletter_subscribers : est_staff_global()
     /admin/parametres      —            coaches, profiles : is_admin()

   Les cinq dernières ne sont PAS un oubli : `est_staff_global()` et
   `is_admin()` ne sont vrais pour aucun collaborateur, quelle que soit sa
   permission. Leur liste de catégories est donc VIDE, et une liste vide
   signifie « jamais visible pour un collaborateur ».

   /admin/documents est la seule à en porter trois, parce que la migration
   route les documents sur `documents.category` : nutrition → nutrition,
   entrainement → entrainement, administratif → suivi_eleve. Une seule des
   trois suffit à y voir quelque chose.
   ══════════════════════════════════════════════════════════════════════════ */

/** Les quatre catégories accordables — mêmes valeurs qu'en base. */
export type CategorieNavigation = "entrainement" | "suivi_eleve" | "agenda_communication" | "nutrition";

/**
 * Catégories qui ouvrent une section. AU MOINS UNE suffit.
 *
 * ⚠️ UNE SECTION ABSENTE DE CETTE TABLE EST TRAITÉE COMME GLOBALE, donc
 * invisible pour un collaborateur. C'est le sens du refus par défaut : une
 * section ajoutée demain et oubliée ici n'apparaît pas, au lieu d'apparaître
 * sans catégorie.
 */
export const CATEGORIES_PAR_SECTION_ADMIN: Readonly<Record<string, readonly CategorieNavigation[]>> = {
  "/admin/eleves": ["suivi_eleve"],
  "/admin/programmes": ["entrainement"],
  "/admin/exercices": ["entrainement"],
  "/admin/seances": ["entrainement"],
  "/admin/calendrier": ["agenda_communication"],
  "/admin/nutrition": ["nutrition"],
  "/admin/documents": ["nutrition", "entrainement", "suivi_eleve"],
  "/admin/retours": ["entrainement"],
  "/admin/paiements": [],
  "/admin/abonnements": [],
  "/admin/emails": [],
  "/admin/notifications": [],
  "/admin/newsletter": [],
  "/admin/parametres": [],
};

/** Le tableau de bord : point d'entrée de l'espace, ses tuiles sont filtrées par la RLS. */
export const SECTION_ADMIN_ACCUEIL = "/admin";

/**
 * Droits de l'appelant tels que l'interface peut les connaître.
 *
 * `roleStaff` vient de `public.staff_role()` et `categoriesLecture` de
 * `public.categories_lecture()` — deux fonctions du modèle P13-B, qui ne
 * renvoient que l'identité de l'appelant. `categories_lecture()` ne filtre
 * PAS sur le niveau : une permission `ecriture` y figure comme une `lecture`,
 * ce qui donne gratuitement la règle « écriture implique visibilité ».
 */
export interface DroitsNavigationAdmin {
  /**
   * La lecture des droits est encore EN COURS.
   *
   * ⚠️ TRAITÉ ICI, ET PLUS CHEZ L'APPELANT. Ce champ existait de fait dans
   * `AdminSidebar`, qui fabriquait un faux `mecanismeIndisponible` pendant le
   * chargement ; `app/admin/page.tsx` l'avait oublié, et l'administrateur
   * perdait de ce fait les trois tuiles de facturation et le composeur de
   * campagnes de son tableau de bord à chaque chargement. Une règle qu'un
   * appelant doit se rappeler d'adapter est une règle fausse : elle est donc
   * dans la fonction, où personne ne peut l'oublier.
   */
  chargement?: boolean;
  /** `profiles.role === "admin"` — toujours lisible, même sans les fonctions P13-B. */
  estAdmin: boolean;
  /** `coaches.role`, ou `null` si inconnu. */
  roleStaff: "admin" | "assistant" | "collaborateur" | null;
  /** Catégories en lecture (niveau `lecture` OU `ecriture`). */
  categoriesLecture: readonly CategorieNavigation[];
  /**
   * `true` quand les fonctions P13-B sont INTROUVABLES — migrations non
   * encore appliquées. À distinguer d'un rôle simplement absent : dans ce cas
   * l'interface ne peut rien savoir, et conserve la navigation d'avant P13-B.
   * La RLS et lib/api/authz.ts continuent de refuser pendant ce temps.
   */
  mecanismeIndisponible: boolean;
}

/**
 * Cette section doit-elle apparaître dans la navigation ?
 *
 * Ordre des décisions, et chacune a sa raison :
 *
 *  0. lecture EN COURS, ou droits INDÉTERMINABLES → navigation inchangée. Un
 *     indice d'interface doit laisser passer quand il ne sait pas : masquer
 *     une rubrique légitime ne protège rien (la RLS et lib/api/authz.ts
 *     refusent de toute façon) et prive un administrateur de son espace.
 *  1. `estAdmin` → tout. Il est reconnu par `profiles.role`, jamais par une
 *     fonction P13-B : sa navigation ne peut donc pas disparaître si les
 *     migrations ne sont pas appliquées ou si sa fiche `coaches` manque.
 *  2. mécanisme indisponible → navigation inchangée. Masquer sur l'absence du
 *     mécanisme casserait la navigation de tout le staff avant l'application
 *     des migrations, pour un affichage qui ne protège rien.
 *  3. `assistant` → tout. Comportement strictement préservé.
 *  4. `collaborateur` → accueil, plus les sections dont au moins une catégorie
 *     lui est accordée en lecture.
 *  5. rôle staff INCONNU alors que le mécanisme répond (aucune fiche active) →
 *     accueil seulement. Refus par défaut.
 */
export function sectionAdminVisible(href: string, droits: DroitsNavigationAdmin): boolean {
  if (droits.chargement) return true;
  if (droits.estAdmin) return true;
  if (droits.mecanismeIndisponible) return true;
  if (droits.roleStaff === "admin" || droits.roleStaff === "assistant") return true;

  if (href === SECTION_ADMIN_ACCUEIL) return true;
  if (droits.roleStaff !== "collaborateur") return false;

  const categories = CATEGORIES_PAR_SECTION_ADMIN[href];
  if (!categories || categories.length === 0) return false;
  return categories.some((categorie) => droits.categoriesLecture.includes(categorie));
}

/**
 * LE TITRE DU TABLEAU DE BORD, selon le rôle RÉELLEMENT authentifié.
 *
 * ⚠️ NI L'URL NI LE TITRE EXISTANT NE SERVENT À DÉCIDER. `/admin` est la même
 * route pour tout le staff — un coach autonome y est parfaitement légitime
 * (`requireAdminOrCoach()`), et l'ancien titre « Dashboard admin » était
 * simplement écrit en dur. La décision suit `profiles.role === 'admin'`,
 * c'est-à-dire `public.is_admin()` : la même règle que les policies
 * `*_manage_admin`, que `requireAdmin()` et que les sept gardes applicatives.
 *
 * ⚠️ TROIS VALEURS, PAS DEUX, ET C'EST UNE QUESTION D'HONNÊTETÉ. Tant que les
 * droits ne sont pas lus, afficher « admin » à un coach — ou l'inverse —
 * serait une affirmation fausse sur son compte. On affiche alors le titre
 * neutre : il ne dit rien de faux, et il ne clignote qu'une fois.
 */
export function titreDashboard(droits: {
  readonly chargement: boolean;
  readonly estAdmin: boolean;
  readonly mecanismeIndisponible: boolean;
}): "Dashboard" | "Dashboard admin" | "Dashboard coach" {
  if (droits.chargement) return "Dashboard";
  if (droits.mecanismeIndisponible) return "Dashboard";
  return droits.estAdmin ? "Dashboard admin" : "Dashboard coach";
}

/**
 * Un GROUPE (ex. « Programmation ») n'apparaît que si au moins un de ses
 * enfants apparaît — un intitulé dépliable sur un sous-menu vide serait pire
 * qu'un lien manquant.
 */
export function groupeAdminVisible(hrefs: readonly string[], droits: DroitsNavigationAdmin): boolean {
  return hrefs.some((href) => sectionAdminVisible(href, droits));
}

/**
 * Le contexte staff lu par `useStaffContext`, converti en droits de
 * navigation — UNE SEULE FOIS, pour tous les appelants.
 *
 * ⚠️ POURQUOI CETTE FONCTION EXISTE. La conversion était recopiée à la main
 * dans `AdminSidebar` et dans `app/admin/page.tsx`, et les deux copies ne
 * disaient pas la même chose : la sidebar neutralisait le chargement, le
 * tableau de bord non. Résultat mesuré : l'administrateur gardait son menu
 * mais perdait la vitrine « Paiements » de son accueil. Deux copies d'une
 * règle de visibilité finissent toujours par diverger — il n'y en a plus
 * qu'une.
 *
 * Le type d'entrée est volontairement STRUCTUREL (pas `StaffContext`) : ce
 * module reste pur, sans dépendance à React ni à Supabase, donc testable en
 * Node comme le reste du fichier.
 */
export function droitsNavigationDepuisContexte(staff: {
  readonly chargement: boolean;
  readonly estAdmin: boolean;
  readonly role: "admin" | "assistant" | "collaborateur" | null;
  readonly categoriesLecture: readonly string[];
  readonly mecanismeIndisponible: boolean;
}): DroitsNavigationAdmin {
  return {
    chargement: staff.chargement,
    estAdmin: staff.estAdmin,
    roleStaff: staff.role,
    categoriesLecture: staff.categoriesLecture.filter(
      (categorie): categorie is CategorieNavigation =>
        categorie === "entrainement" ||
        categorie === "suivi_eleve" ||
        categorie === "agenda_communication" ||
        categorie === "nutrition",
    ),
    mecanismeIndisponible: staff.mecanismeIndisponible,
  };
}
