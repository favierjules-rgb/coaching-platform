# Audit design + plan de refonte — Juillet 2026

Branche : `ui-redesign-seth-v2`. Audit en lecture seule (4 sous-agents parallèles : pages publiques, admin "gestion courante", admin "Programmation", espace élève) + vérifications directes (grep, lecture de fichiers clés). **Aucun fichier source n'a été modifié.** Ce document est le rapport + plan d'action requis avant toute écriture de code.

---

## Lot 1 — Rapport d'exécution

Périmètre réalisé : finalisation du thème clair/sombre, tokens sémantiques, corrections de bugs confirmés (`text-destructive`, routing `SiteChrome`, `bg-black` codés en dur), remplacement progressif de `hover:bg-red-700`, a11y du `Modal` admin partagé. **Training Builder et landing page non touchés**, comme demandé. Aucune modification métier/Supabase/Stripe/Brevo/Resend/API.

### Fichiers modifiés (44)

`.gitignore`, `app/globals.css`, `app/layout.tsx`, `app/error.tsx`, `components/theme/ThemeProvider.tsx` (nouveau), `components/theme/ThemeToggle.tsx` (inchangé, déjà bon), `components/admin/AdminSidebar.tsx`, `components/student/StudentSidebar.tsx`, `components/layout/SiteChrome.tsx`, `components/admin/Modal.tsx`, `app/(student)/documents/[documentId]/page.tsx`, `app/admin/programmes/nouveau/page.tsx`, plus le remplacement `hover:bg-red-700` → `hover:bg-primary-hover` dans 37 fichiers (`app/admin/{abonnements,documents,nutrition,nutrition/[planId],programmes,programmes/[programId]}/page.tsx`, `components/auth/{LoginForm,ForgotPasswordForm,ResetPasswordForm,AccessDenied}.tsx`, `components/onboarding/OnboardingWizard.tsx`, `components/shared/{AccessLimitedContent,CreateCheckoutLinkModal,PaymentCancelContent,PaymentSuccessContent,ProgressPhotosSection}.tsx`, `components/student/{AddProgressPhotoModal,ChangePasswordSection,DailyMacroForm,EditPersonalInfoModal,SessionFeedbackSection,StudentOnboardingDetailModal,SubscriptionSection,UpdateMeasurementsModal,UpdateWeightModal}.tsx`, `components/admin/{AdminOnboardingDetailModal,AppointmentCard,AppointmentModal,AssignStudentsModal,AvailabilityManager,CoachModal,CreateStudentModal,DocumentModal,EditStudentModal,ExerciseLibraryItemModal,StudentSubscriptionSection}.tsx`.

**Volontairement exclus de ce remplacement** (Training Builder + landing, hors périmètre Lot 1) : `components/admin/ProgramBuilder.tsx`, `components/admin/ProgramBuilderFullscreen.tsx`, `components/sections/Hero.tsx`, `components/sections/PublicProgramPurchaseForm.tsx`.

### Tokens ajoutés (`app/globals.css`, dark + light)

- `--primary-hover` (`#b91c1c` dans les deux modes — valeur identique à l'ancien `red-700` codé en dur, zéro changement visuel)
- `--destructive` / `--destructive-foreground`
- `--warning` / `--warning-foreground`
- `--success` / `--success-foreground`

Tous exposés en classes Tailwind via `@theme inline` (`bg-primary-hover`, `text-destructive`, etc.). La définition de `--destructive` corrige à elle seule les 6 usages existants de `text-destructive` qui pointaient vers un token inexistant (aucun fichier composant à modifier).

### Composants partagés créés/modifiés

- **`components/theme/ThemeProvider.tsx`** — remplacement de `useState`+`useEffect` par `useSyncExternalStore` (API React dédiée à la lecture d'une source externe comme `localStorage`) : élimine l'erreur ESLint réelle `react-hooks/set-state-in-effect`, sans changer le comportement (toujours "sombre" par défaut côté serveur, aucun flash, choix mémorisé respecté).
- **`components/admin/Modal.tsx`** — ajout fermeture Échap, fermeture au clic sur l'overlay, piège de focus basique (Tab/Shift+Tab). Aucun changement d'API : tous les consommateurs existants (CoachModal, AppointmentModal, DocumentModal, etc.) en bénéficient automatiquement sans modification.
- **`ThemeToggle`** rendu dans `AdminSidebar.tsx` et `StudentSidebar.tsx` (variante pleine largeur, déjà prête, juste jamais affichée avant).

### Volontairement reporté à un lot ultérieur (pas fait dans ce Lot 1)

Pour garder ce lot revuable et éviter un diff géant peu fiable : consolidation `StatCard`/`StatusBadge`/`AuthCardLayout`/`LibraryCard` (touchent des dizaines de pages, prévues Lot 2/4), migration des couleurs de statut restantes (`red-400`, `amber-400`, `green-400` sur badges/deltas), généralisation du pattern "header fixe + corps scrollable" aux modales élève (`EditPersonalInfoModal` etc. — le composant `Modal` admin est fixé, celui des modales élève est un pattern différent, non touché ici), `aria-label` sur les boutons icône des builders (exclus par consigne).

### Vérifications

- **`npm run lint`** : 1 seule erreur, **pré-existante sur `main`** (confirmé par `git diff main`), sans lien avec le Lot 1 — `components/admin/AdminSidebar.tsx:62`, `react-hooks/set-state-in-effect` sur la logique du sous-menu "Programmation" (antérieure à cette branche). Zéro nouvelle erreur/warning introduite.
- **`npx tsc --noEmit`** : 1 seule erreur, **pré-existante sur `main`**, dans `lib/supabase/session-templates.ts` (fichier non touché par cette branche). Zéro nouvelle erreur introduite.
- **`npm run build`** : ⚠️ échoue dans ce bac à sable avec une erreur interne Turbopack (`TurbopackInternalError`, IPC cassé sur `app/globals.css`). **Vérifié que ce n'est pas lié au code** : le même échec, identique au caractère près, se reproduit en rebuild avec le `globals.css` original de `main` (non modifié). C'est une limitation de cet environnement d'exécution (montage fichier particulier), pas un bug introduit par le Lot 1. À confirmer avec un `npm run build` sur ta machine.
- **Vérification navigateur clair/sombre** : non faite — pas de serveur de dev lancé dans cette session (tu le relances toi-même sur ton terminal). Dis-moi si tu veux que je le fasse via le navigateur une fois le serveur démarré, ou si tu préfères vérifier toi-même.
- **Captures avant/après** : non disponibles pour la même raison (pas de build/serveur fonctionnel ici).

### Résumé des risques de régression

Très faible. Tous les changements sont soit additifs (nouveaux tokens, nouveau comportement de `Modal` sans changement d'API), soit des remplacements mécaniques de classe CSS vers un token de valeur identique (`hover:bg-red-700` → `hover:bg-primary-hover`, même couleur `#b91c1c`), soit des corrections de bugs confirmés et isolés (routing, couleurs opaques). Le seul comportement réellement nouveau à tester visuellement est le `Modal` admin (fermeture Échap/clic extérieur/piège de focus) — à vérifier sur 2-3 modales pour confirmer qu'aucun flux de saisie n'est perturbé.

### Ménage à faire toi-même (hors Git, filesystem)

Mes tentatives de `npm run build` dans ce sandbox ont laissé 3 dossiers `.next-broken-*` sur le disque (dont un de ~3 Go) que je n'ai pas pu supprimer entièrement (même erreur `EPERM` que le fichier `.git/index.lock` signalé précédemment — limitation de ce montage, pas un souci côté repo). Ils sont dans `.gitignore` donc invisibles pour Git, mais à supprimer toi-même : `rm -rf .next-broken-*` à la racine du repo.

**Arrêt obligatoire avant le Lot 2 — en attente de ta validation.**

---

## Lot 2 — Rapport d'exécution

Périmètre réalisé : `StatusBadge` partagé, `StatCard` partagé, unification des "chiffres clés" programme/nutrition, filtre "type de séance" sur la banque de séances, réalignement de la page admin Newsletter, correctif du bug de layout `documents/nouveau`. **Training Builder et landing page non touchés. Aucune modification métier/Supabase/Stripe/Brevo/Resend/API, aucun champ de schéma ajouté.**

### Fichiers modifiés (11) et créé (1)

`app/admin/documents/nouveau/page.tsx`, `app/admin/newsletter/page.tsx`, `app/admin/nutrition/[planId]/page.tsx`, `app/admin/programmes/[programId]/page.tsx`, `app/admin/seances/page.tsx`, `components/admin/NewsletterAdminTable.tsx`, `components/admin/SessionTemplateLibraryManager.tsx`, `components/shared/ProgressAppointmentsSection.tsx`, `components/shared/ProgressSummaryCards.tsx`, `components/student/AppointmentCard.tsx`, `components/student/DashboardContent.tsx`. Créé : `components/shared/StatCard.tsx`.

### Composants partagés créés/consolidés

- **`components/shared/StatCard.tsx`** (nouveau) — fusionne `components/student/StatCard.tsx` et le `SummaryCard` interne de `ProgressSummaryCards.tsx`. Prop `tone` (`default`/`positive`/`negative`) utilisant désormais les tokens `--success`/`--destructive` du Lot 1 au lieu de `green-400`/`red-400` en dur. Prop `size` (`md`/`lg`) pour couvrir à la fois les listes compactes (dashboard, progression) et les lignes de chiffres clés en tête de page de détail (programme, plan nutrition), au lieu d'une taille de texte arbitraire par page. **Le `StatCard` de `components/shared/TrainingMetricsSummary.tsx` n'a volontairement pas été fusionné** : il est aussi rendu depuis `components/admin/ProgramBuilder.tsx` (Training Builder), donc laissé de côté jusqu'au Lot 3.
- **`StatusBadge`** (`components/admin/StatusBadge.tsx`, déjà existant) — désormais réellement partagé : `components/shared/ProgressAppointmentsSection.tsx` et `components/student/AppointmentCard.tsx` recopiaient chacun le même mapping `toneClass`, les deux utilisent maintenant le composant importé (3ᵉ consommateur, `components/admin/AppointmentCard.tsx`, l'utilisait déjà correctement).

### Cartes "chiffres clés" unifiées

`programmes/[programId]` (Niveau/Durée/Séances/Élèves, auparavant texte nu `text-sm` sans carte) et `nutrition/[planId]` (Kcal/Protéines/Glucides/Lipides) utilisent maintenant le même `StatCard size="lg"`. `NutritionWeekSummaryCard.tsx` volontairement laissé tel quel : après vérification, ses stats en `text-lg` sont un bloc imbriqué dans une carte déjà bordée (contexte différent, pas une page de détail), et ce `text-lg` est déjà celui utilisé par `ProgressAppointmentsSection` pour le même type de bloc imbriqué — ce n'était donc pas une 3ᵉ taille incohérente mais deux blocs déjà cohérents entre eux.

### Banque exercices/séances

Ajout d'un filtre "Type de séance" (Musculation/Cardio/Mixte/Tous) sur `/admin/seances`, même emplacement/style que les 5 filtres de `/admin/exercices`. **Le filtre "statut actif/archivé" n'a volontairement pas été ajouté** : `SessionTemplate` n'a pas de champ `status` en base (`session_templates` n'en a jamais eu), l'ajouter demanderait une migration Supabase — hors périmètre visuel, nécessite ta décision explicite (déjà signalé dans le Lot 1). Le filtre "muscle" n'a pas non plus été ajouté côté séances : `muscle_group` y est un champ texte libre, pas un enum comme côté exercices — un filtre par égalité exacte serait trompeur sur du texte libre.

### Bug corrigé — `documents/nouveau/page.tsx`

`PrimaryButton` (de `components/admin/Modal.tsx`, conçu pour occuper toute la largeur d'un pied de modale) était placé à côté du bouton "Publier" dans une rangée `flex` — le `w-full` interne du composant cassait la mise en page. Remplacé par un bouton simple avec les classes `bg-primary` standard, plus aucune dépendance à un composant de modale sur une page qui n'en est pas une.

### Newsletter admin réalignée

`app/admin/newsletter/page.tsx` avait son propre wrapper `mx-auto max-w-6xl px-4 py-10` (aucune autre page admin n'en a — le layout `AdminShell` fournit déjà le padding via `<main className="p-6 lg:p-10">`) et un titre `text-2xl font-bold` au lieu du `text-3xl font-extrabold ... md:text-4xl` standard. Basculé sur la structure d'en-tête standard (titre + sous-titre + bouton d'action, comme `/admin/programmes`). Dans `NewsletterAdminTable.tsx`, les boutons "Exporter en CSV"/"Resync" et les selects de filtre utilisaient une convention propre à ce fichier (`hover:bg-foreground hover:text-background`, tailles de texte différentes) — alignés sur la convention bouton secondaire standard (`hover:border-primary hover:text-primary`, `text-[11px] uppercase tracking-widest`).

### Vérifications

- **`npm run lint`** : **0 erreur, 0 warning.**
- **`npx tsc --noEmit`** : **0 erreur.**
- **`npm run build`** : compilation ✅, typecheck ✅, génération des 70 pages statiques ✅. Échoue ensuite sur le même `EPERM: rmdir` d'environnement déjà rencontré et vérifié indépendant du code lors du Lot 1 (reproduit à l'identique).

### Limitation connue (hors Git, filesystem)

**`components/student/StatCard.tsx` est maintenant un fichier mort** (plus aucun import ne le référence, remplacé par `components/shared/StatCard.tsx`) mais je n'ai pas pu le supprimer — même erreur `EPERM` que le `.git/index.lock` et les dossiers `.next-broken-*` déjà signalés. Le `.git/index.lock` s'est d'ailleurs reformé (probablement recréé par mes propres commandes `git status` dans ce sandbox). À faire toi-même : `rm .git/index.lock` puis `git rm components/student/StatCard.tsx` (ou `rm` + laisser Git détecter la suppression).

### Résumé des risques de régression

Faible. Consolidations de composants avec le même rendu visuel final (mêmes classes Tailwind reprises dans le composant partagé), un ajout de filtre non-destructif (les séances existantes restent toutes visibles par défaut, "Tous les types"), un correctif de bug de layout isolé, et un réalignement de page qui ne change aucune donnée ni logique — seulement la présentation. Point à vérifier visuellement en priorité : la page Newsletter (nouvelle disposition d'en-tête) et le filtre de la banque de séances.

**Arrêt obligatoire avant le Lot 3 — en attente de ta validation.**

## 0. À traiter avant tout le reste

- **`.git/index.lock` présent** (0 octet, créé lors du `git checkout -b ui-redesign-seth-v2`). Le checkout a réussi mais ce fichier résiduel bloquera ton prochain `git add`/`commit` tant qu'il n'est pas supprimé. À faire toi-même depuis ton terminal : `rm .git/index.lock` (à la racine du repo), après avoir vérifié qu'aucune opération git n'est en cours.
- **Thème clair/sombre** : tu as validé "Intègre-le comme option dans le nouveau design system". Le travail déjà fait (`ThemeProvider`, `ThemeToggle`, classe `.light` dans `globals.css`) est repris et complété au Lot 1 ci-dessous plutôt que jeté.

---

## 1. Constat général

Le design actuel est cohérent sur l'identité (fond noir, rouge `#d62828`, typographie condensée) mais souffre de **dérive non centralisée** : chaque page/composant a réimplémenté ses propres variantes de boutons, cartes-stat, badges de statut et couleurs d'état, faute de composants et tokens partagés. Trois bugs réels (pas de simples incohérences) ont été confirmés par vérification directe du code :

1. **`text-destructive` utilisé à 6 endroits du repo alors qu'aucun token `--destructive` n'existe** dans `app/globals.css` (confirmé par grep global). Le texte retombe sur une couleur héritée non intentionnelle. Fichiers : `components/marketing/NewsletterSignupForm.tsx:115`, `components/sections/PublicProgramPurchaseForm.tsx:128`, `app/newsletter/desinscription/UnsubscribeForm.tsx:79`, `components/student/NewsletterPreferenceToggle.tsx:66,89`, + 1 occurrence supplémentaire à localiser au Lot 1.
2. **`SiteChrome.tsx:9-23`** : `PRIVATE_PREFIXES` oublie `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`, `/onboarding`, `/newsletter/desinscription`. Ces pages reçoivent le Header marketing `fixed` en plus de leur propre layout — recouvrement visuel confirmé sur `OnboardingWizard.tsx:90` (padding 40px < 64px de header), nav vers des ancres inexistantes (`#methode`).
3. **`hover:bg-red-700` codé en dur sur 51 occurrences** dans tout le repo (confirmé par grep) au lieu de dériver du token `--primary`. Cohérent en tant que convention (bon point), mais totalement invisible/non ajustable pour le futur mode clair et fragile si la teinte de marque change.

Au-delà de ces 3 bugs, le problème le plus structurant relevé dans les 4 audits est l'**absence de composants partagés** pour des éléments répétés à l'identique ou presque : boutons primaires/destructifs, cartes-statistique, badges de statut, modales (pattern header/scroll), cartes de bibliothèque (exercices/séances/documents).

---

## 2. Constat le plus important pour toi : incohérence banque d'exercices / banque de séances

Tu avais demandé explicitement une présentation cohérente entre les deux bibliothèques. Vérifié : elles divergent sur presque tout.

| Aspect | Banque d'exercices | Banque de séances |
|---|---|---|
| Recherche | Helper partagé `matchesExerciseSearch` (`lib/admin.ts:415`) | Réimplémentation locale ad hoc |
| Filtres (page dédiée) | 5 filtres (muscle/catégorie/matériel/niveau/statut) | **Aucun** |
| Filtres (picker du builder) | 2 filtres (muscle/matériel) | **Aucun** |
| Statut actif/archivé | Oui, badge + boutons Archiver/Réactiver | **Inexistant** (le type `SessionTemplate` n'a même pas de champ `status`) |
| Duplication | Absente | Présente |
| Grille de cartes | Identique | Identique (seul point cohérent) |

C'est le point à traiter en priorité dans le Lot 2 côté visuel (harmoniser recherche/filtres/statut visuellement — **sans** ajouter de champ `status` en base ni changer la logique métier, ce qui sortirait du périmètre visuel et nécessiterait ta validation séparée si jamais souhaité).

---

## 3. Synthèse par zone (HIGH/MEDIUM détaillés, LOW résumé)

### 3.1 Pages publiques & authentification

- **HIGH** — `SiteChrome.tsx:9-23` : routing Header/Footer cassé sur 4 pages (voir §1).
- **HIGH** — `text-destructive` non défini, 3 occurrences dans ce périmètre (voir §1).
- **HIGH** — Contraste insuffisant : `SectionLabel` et le kicker du Hero (`components/sections/Hero.tsx:15`, `SectionLabel.tsx:6`) affichent `text-primary` en 12px sur `#0a0a0a` → ratio ≈3,95:1, sous le seuil AA 4,5:1. Utilisé sur toute la landing + `/programmes`.
- **MEDIUM-HIGH** — Duplication : `components/auth/AccessDenied.tsx` recopie intégralement la structure de `components/shared/PaymentResultCard.tsx` (reconnu dans un commentaire du code lui-même) au lieu de la réutiliser. La structure "carte Logo + formulaire centré" est aussi dupliquée 6 fois (Login/ForgotPassword/ResetPassword/Inscription) sans composant `AuthCardLayout` commun.
- **MEDIUM** — `Method.tsx:18` : `hover:bg-white/[0.03]` codé en dur au lieu du token `--card-hover` déjà exposé en `bg-card-hover`.
- **MEDIUM** — `Hero.tsx:26` : `text-gray-300` au lieu de `text-muted-foreground`.
- **MEDIUM** — Wizard d'onboarding (9 étapes) : aucune transition entre steps, contraste avec la barre de progression qui, elle, est animée.
- **MEDIUM** — Focus clavier faible : `focus:border-primary` seul (pas de ring), combiné au contraste limité du rouge (`LoginForm.tsx`, `ResetPasswordForm.tsx`).
- LOW (groupés) : tailles de flèche de bouton incohérentes (13/14/16px), `Header.tsx` utilise `<a href>` au lieu de `<Link>` pour la nav interne (perte de navigation SPA vers `/programmes`), `PublicProgramCard.tsx` titres sans troncature, grilles non responsive ponctuelles (`PublicProgramPurchaseForm.tsx:77`), `alt=""` sur bannière de programme non décorative.
- **Point positif à conserver** : `PublicProgramsMarquee` gère bien la boucle infinie + `prefers-reduced-motion` (déjà dans `globals.css:73-77`) — bon exemple à répliquer.

### 3.2 Admin — gestion courante (élèves, calendrier, documents, paiements, emails, retours, paramètres)

- **HIGH** — `Modal.tsx` : pas de piège de focus, pas de fermeture Échap, pas de fermeture au clic extérieur.
- **HIGH** — 5 styles de bouton destructif différents selon les pages.
- **HIGH** — Boutons icône sans `aria-label` quasi systématiques (suppression, réordonnancement).
- **MEDIUM** — Token `--card-hover` défini mais jamais utilisé (grep confirmé : 0 usage dans le repo actuel hors définition).
- **MEDIUM** — 3 implémentations différentes de "carte statistique" (voir §3.4, c'est transversal admin/élève).
- **MEDIUM** — Selects natifs sans `<label>` associé à plusieurs endroits.
- `app/admin/newsletter/page.tsx` : signalé comme le plus gros outlier de design system de cette zone (styles isolés, non alignés sur les autres pages admin).
- `app/admin/documents/nouveau/page.tsx` : bug de layout réel — `PrimaryButton` avec `w-full` mal contraint.

### 3.3 Admin — Programmation (programmes, exercices, séances, builder, nutrition)

- **HIGH** — Incohérence banque d'exercices / banque de séances (voir §2).
- **HIGH** — Hiérarchie des "chiffres clés" incohérente entre pages de détail : `programmes/[programId]/page.tsx:140-161` (texte nu `text-sm`) vs `nutrition/[planId]/page.tsx:188-205` (cartes `text-2xl font-heading`) vs `NutritionWeekSummaryCard.tsx:60-80` (`text-lg`) — trois traitements différents pour un même type de contenu.
- **HIGH** — `hover:bg-red-700` sur les CTA primaires les plus visibles de cette zone (7 fichiers).
- **HIGH** — Builder plein écran (`ProgramBuilderFullscreen.tsx`) implicitement desktop-only : panneaux latéraux à largeur fixe (`w-56` + `w-[420px]`) sans aucun repli/message sous ~1100-1200px, potentiellement inutilisable sur mobile/tablette sans avertissement.
- **HIGH** — Icônes d'action sans `aria-label` : tous les boutons `Trash2`/`ArrowUp`/`ArrowDown` de `ProgramBuilder.tsx` (exercices, segments cardio, blocs cardio) et `NutritionPlanBuilder.tsx` (suppression de repas).
- **MEDIUM** — `ProgramBuilder.tsx` : le composant `ProgramBuilder` lui-même (L940-1118) est mort/non utilisé (confirmé dans un commentaire du fichier + absence d'import ailleurs) — à supprimer au nettoyage du Lot 3, ce n'est pas une modification fonctionnelle puisque le code est déjà inerte.
- **MEDIUM** — Réordonnancement drag-and-drop d'exercices/segments sans feedback visuel de zone de dépôt, alors que le builder plein écran a déjà ce pattern (`isDropTarget`) pour l'échange de séances entre jours — incohérence d'un même type d'interaction traité différemment selon l'endroit.
- **MEDIUM** — `ProgramBuilderFullscreen.tsx:118` : nom de séance sans `truncate` alors que les noms d'exercices juste en dessous (L132) le sont.
- LOW (groupés) : tailles d'icônes dispersées sur 8 valeurs sans hiérarchie, grilles de macros à 4 colonnes sans repli mobile par endroits, absence d'animation sur le changement de semaine.

### 3.4 Espace élève

- **HIGH** — `NewsletterPreferenceToggle.tsx:66,89` : `text-destructive` non défini (bug réel, voir §1).
- **HIGH** — Modales avec header captif dans la zone de scroll : `EditPersonalInfoModal.tsx`, `UpdateMeasurementsModal.tsx`, `AddProgressPhotoModal.tsx`, modale d'upload de `ProgressPhotosSection.tsx` — sur formulaire long/petit écran, le bouton de fermeture devient inatteignable. **`StudentOnboardingDetailModal.tsx:145-159` a déjà le bon pattern** (header fixe + corps scrollable) : à généraliser via un composant `Modal` commun plutôt qu'à réinventer.
- **HIGH** — `StudentSidebar.tsx:96` : `hover:bg-white/[0.04]` codé en dur, alors que l'équivalent admin utilise déjà `hover:bg-foreground/5` (token-safe, compatible mode clair).
- **HIGH** — `documents/[documentId]/page.tsx:112` : `bg-black` opaque (pas `/NN`) sur un bloc de contenu — cassera visuellement en mode clair.
- **HIGH** — Duplication confirmée : trois implémentations de "carte stat avec icône" (`StatCard.tsx`, `SummaryCard` dans `ProgressSummaryCards.tsx`, `StatCard` dans `TrainingMetricsSummary.tsx` — deux portent littéralement le même nom dans des fichiers différents) + trois copies littérales du même objet `toneClass` de couleurs de statut (`AppointmentCard.tsx`, `ProgressAppointmentsSection.tsx`, `admin/StatusBadge.tsx`).
- **MEDIUM** — Grilles à 5 tuiles (macros nutrition, `nutrition/[planId]/page.tsx:59-82`, `ProgressNutritionSection.tsx:24`) qui laissent systématiquement un orphelin en fin de ligne en dessous du breakpoint `lg`, contre le pattern "4 tuiles propres" utilisé partout ailleurs.
- **MEDIUM** — Écran séance du jour (le plus utilisé par un élève) : aucune transition, y compris formulaire de retour → confirmation d'envoi (`SessionFeedbackSection.tsx`).
- **MEDIUM** — Aucune modale du périmètre élève ne ferme au clavier (Échap) ; une seule sur six ferme au clic extérieur.
- **Point positif à souligner** : `SubscriptionSection.tsx` réutilise correctement `components/admin/StatusBadge` et `components/shared/BillingStatusBadge` plutôt que de redéfinir ses couleurs — c'est le seul composant élève qui suit déjà le bon principe de réutilisation cross-espace.
- **Point positif** : couverture `aria-label` globalement bonne sur les boutons icône, aucune grille responsive cassée détectée (y compris calendrier de rendez-vous), `BookingSlotPicker.tsx` solide (navigation clavier, états désactivés corrects).

---

## 4. Opportunités d'animation (méthode `find-animation-opportunities`)

Chaque suggestion a passé le filtre Fréquence → Utilité → Vitesse → Fonction. Classées par intérêt.

| # | Emplacement | Aujourd'hui | Utilité | Fréquence | Animation proposée |
|---|---|---|---|---|---|
| 1 | `OnboardingWizard.tsx` (changement d'étape, 9 étapes) | Rendu conditionnel brut, saute d'un bloc à l'autre | Éviter un changement brutal | Rare (une fois par élève) | Fade + léger slide horizontal 8px, `200ms ease-out`, la barre de progression déjà animée reste le repère de continuité |
| 2 | `SessionFeedbackSection.tsx` (formulaire de retour → confirmation) | Bascule instantanée | Confirmation (feedback) | Occasionnelle (après chaque séance) | Fade croisé `180ms ease-out` entre formulaire et état "Retour envoyé" |
| 3 | `ProgramBuilder.tsx` (réordonnancement exercices/segments/blocs cardio, drag-and-drop) | Aucun indicateur de zone de dépôt | Feedback / cohérence spatiale | Occasionnelle (pendant la construction d'un programme) | Reprendre le pattern déjà existant `isDropTarget` de `ProgramBuilderFullscreen.tsx` (bordure en pointillés `transform`/`opacity` uniquement) |
| 4 | `AdminSidebar.tsx` (sous-menu "Programmation", ouverture/fermeture) | Affichage/masquage instantané (`{programmationOpen && (...)}`) | Indication d'état | Occasionnelle (état mémorisé, pas re-cliqué à chaque page) | Hauteur + opacité, `160ms ease-out`, respecte `prefers-reduced-motion` |
| 5 | `Hero.tsx` (landing, premier chargement) | Statique, aucune accroche visuelle | Délice (marque premium) | Rare/première visite | Fade + translateY(12px) au chargement, `500ms ease-out`, léger décalage entre titre/sous-titre/CTA (stagger 80ms) |
| 6 | `PaymentResultCard.tsx` (état succès, icône de confirmation) | Icône statique | Délice (moment à forte charge émotionnelle : achat confirmé) | Rare | Scale `0.9→1` + fade, `300ms`, spring léger (bounce 0.15) |

### Candidats rejetés (filtre appliqué, pas retenus)

- **`AdminSidebar.tsx` liens principaux (Dashboard/Élèves/Calendrier…)** — Rejeté : navigation cœur consultée 100+/jour par un admin en poste, toute animation ajoutée la ferait paraître lente. Le simple `transition-colors` déjà en place suffit.
- **`ExerciseSearchPicker.tsx` / `SessionTemplatePicker.tsx` (résultats de recherche à chaque frappe)** — Rejeté : déclenché à chaque frappe clavier, fréquence effectivement 100+/jour en session de construction de programme. Aucune animation ne doit jamais toucher une recherche en temps réel.
- **`BookingSlotPicker.tsx` (changement de mois)** — Rejeté : donnée fonctionnelle que l'élève doit lire immédiatement pour choisir un créneau ; une transition retarderait la lecture plutôt que de l'aider.
- **Cartes-stat du dashboard élève (apparition en stagger à chaque chargement)** — Rejeté : page consultée plusieurs fois par jour, dashboard dense en information ; le stagger deviendrait vite un ralentissement perçu plutôt qu'un délice.

---

## 5. Proposition de design tokens & composants partagés (base du Lot 1)

### Tokens à ajouter dans `app/globals.css` (mode sombre + `.light`)

```
--destructive: #ef4444        (.light: #dc2626)
--destructive-foreground: #ffffff
--warning: #f59e0b            (.light: #d97706)
--warning-foreground: #1a1200
--success: #22c55e            (.light: #16a34a)
--success-foreground: #ffffff
--primary-hover: color-mix(in srgb, var(--primary) 85%, black)
```
(`--card-hover` existe déjà mais n'est jamais utilisé — à réutiliser partout où `hover:bg-white/[0.0X]` est codé en dur.)

### Composants partagés à créer/consolider (aucun changement de logique métier)

- **`Button`** (variantes `primary`/`secondary`/`destructive`/`ghost`) — remplace les 51 occurrences de `hover:bg-red-700` et les 5 styles de bouton destructif différents.
- **`Modal`** — header fixe + corps `overflow-y-auto` (reprendre le pattern déjà correct de `StudentOnboardingDetailModal.tsx`), fermeture Échap + clic extérieur + piège de focus.
- **`StatCard`** — fusionne les 3 implémentations existantes (`components/student/StatCard.tsx`, `SummaryCard` de `ProgressSummaryCards.tsx`, `StatCard` de `TrainingMetricsSummary.tsx`).
- **`StatusBadge` / `toneClass`** — une seule source pour le mapping couleur de statut (fusionne `AppointmentCard.tsx`, `ProgressAppointmentsSection.tsx`, `admin/StatusBadge.tsx`).
- **`AuthCardLayout`** — structure "Logo + carte centrée" commune à Login/ForgotPassword/ResetPassword/Inscription/AccessDenied/PaymentResultCard.
- **`LibraryCard`** (banque d'exercices/séances) — harmonise recherche, filtres, statut actif/archivé, grille entre les deux bibliothèques (§2), sans toucher au schéma de données.

---

## 6. Plan d'exécution en 6 lots

Après chaque lot : `npm run lint`, `npx tsc --noEmit`, `npm run build`, vérification manuelle des pages concernées, puis capture(s) + résumé avant de passer au lot suivant.

1. **Lot 1 — Fondations** : tokens (§5), intégration finalisée du thème clair/sombre (reprise de `ThemeProvider`/`ThemeToggle`, insertion du bouton dans `AdminSidebar` et `StudentSidebar`), composant `Button`, `Modal` généralisé, correction des 6 `text-destructive`, correction du routing `SiteChrome.tsx`, correction `bg-black` → `bg-background` (2 occurrences déjà identifiées), correction contraste `SectionLabel`/`Hero`.
2. **Lot 2 — Pages admin principales** : harmonisation banque d'exercices/séances (§2), unification des cartes "chiffres clés" (programmes/nutrition/résumés), `StatusBadge` partagé, `app/admin/newsletter/page.tsx` réaligné, correction `documents/nouveau/page.tsx`.
3. **Lot 3 — Training Builder** : suppression du code mort (`ProgramBuilder` legacy L940-1118), `aria-label` sur tous les boutons d'action, feedback visuel du drag-and-drop (opportunité #3), garde-fou visuel/message pour petit écran sur le builder plein écran (sans changer son fonctionnement).
4. **Lot 4 — Espace élève** : `StatCard` unifié, modales corrigées (header fixe), `StudentSidebar` tokens, grilles à 5 tuiles rééquilibrées, animation feedback de séance (opportunité #2).
5. **Lot 5 — Landing & pages publiques** : `AuthCardLayout`, entrée animée du Hero (opportunité #5), transitions du wizard d'onboarding (opportunité #1), icône de confirmation paiement (opportunité #6).
6. **Lot 6 — Responsive, accessibilité, animations restantes, nettoyage** : passe transversale finale (contrastes, `aria-label` restants, `prefers-reduced-motion`, stagger navigation admin, suppression des couleurs Tailwind brutes restantes).

---

## 7. Points nécessitant ta validation avant de commencer

- Confirmes-tu que je peux commencer le **Lot 1** tel que décrit ?
- Pour la banque de séances (§2), l'absence de champ `status` (actif/archivé) est un choix côté schéma de données (`types/index.ts`), pas juste visuel — je ne le change pas sans ton accord explicite. Je me limiterai à harmoniser recherche/filtres/présentation visuelle ; dis-moi si tu veux aussi qu'on discute d'ajouter le statut côté séances (hors périmètre visuel, migration Supabase requise).
- Le fichier `docs/audit-redesign-ui-2026-07.md` est resté non commité (comme le reste de la branche) — à toi de commiter quand tu veux.

---

## Lot 3 — Rapport d'exécution

Périmètre respecté à la lettre : Training Builder uniquement (`components/admin/ProgramBuilder.tsx` + `components/admin/ProgramBuilderFullscreen.tsx`), aucun changement de logique de calcul, de sauvegarde ou de réordonnancement — uniquement du code mort supprimé et des ajouts additifs (attributs, état de feedback visuel, bandeau conditionnel).

### Fichiers modifiés

- **`components/admin/ProgramBuilder.tsx`**
  - Suppression du composant `ProgramBuilder` legacy (lignes 919-1118 avant modification, ~200 lignes) : confirmé mort via `grep` sur tout le repo — seuls `ProgramBuilderData` (type), `DayCard` et `restDaySession` sont importés depuis ce fichier (par `ProgramBuilderFullscreen.tsx` et `lib/supabase/programs.ts`), jamais le composant `ProgramBuilder` lui-même. Un commentaire déjà présent dans le code (au-dessus de `DayCard`) confirmait explicitement ce statut mort.
  - Nettoyage des imports/constantes devenus inutiles après cette suppression : `PrimaryButton` (import), `weekDays` (import — `generateId` reste utilisé et conservé), `statusOptions`, `levelOptions` (constantes locales).
  - Ajout d'`aria-label` sur les 9 boutons d'action icône-seule qui n'en avaient pas : flèches haut/bas + suppression sur `ExerciseRow`, `CardioSegmentRow` et `CardioBlockRow` (ex. "Déplacer l'exercice vers le haut", "Supprimer le segment", "Supprimer le bloc cardio").
  - Ajout du feedback visuel de cible de dépôt pendant un glisser-déposer (même pattern que `isDropTarget`/`DayGridCell` déjà existant dans `ProgramBuilderFullscreen.tsx`), pour le réordonnancement des exercices (nouvel état `dragOverExerciseIndex` dans `DayCard`) et des segments cardio (nouvel état `dragOverSegmentIndex` dans `CardioBlockRow`) : bordure en pointillés `border-primary/70` sur la ligne survolée. Le calcul de réordonnancement (`reorderExercises`/`reorderSegments`, la ref `dragExerciseIndex`/`dragSegmentIndex`, la logique de `splice`+réassignation des `order`) n'a pas été touché — uniquement ajout d'un état parallèle purement visuel et d'un `onDragEnd` pour le nettoyer proprement.
  - Précision : les blocs cardio eux-mêmes (au niveau du bloc, pas de ses segments) n'ont pas de glisser-déposer dans le code existant (seulement les flèches haut/bas) — aucun feedback visuel de dépôt n'a donc été ajouté à ce niveau, pour ne pas introduire une fonctionnalité de drag-and-drop qui n'existait pas.

- **`components/admin/ProgramBuilderFullscreen.tsx`**
  - Ajout d'`aria-label` sur 3 boutons icône-seule qui n'en avaient pas : bouton "Dupliquer cette semaine" (déjà un `title`, `aria-label` ajouté en complément), flèches "Semaine précédente"/"Semaine suivante" (navigation `ChevronLeft`/`ChevronRight`).
  - Ajout d'un bandeau d'avertissement petit écran : visible uniquement sous 1200px (`min-[1200px]:hidden`, sans JS, donc aucun risque de flash ou de mismatch d'hydratation), informe que l'éditeur est optimisé pour les écrans larges et suggère de replier les panneaux latéraux (fonctionnalité de repli déjà existante, boutons `PanelLeftClose`/`PanelRightClose`). Purement informatif : n'modifie ni la largeur des panneaux (`w-56`/`w-[420px]`, toujours fixes), ni leur comportement, ni la grille 7 jours.

### Vérifications

- `npm run lint` → 0 erreur, 0 warning.
- `npx tsc --noEmit` → 0 erreur.
- `npm run build` → compilation + typecheck + génération des 70 pages statiques réussis. L'échec final (`EPERM: rmdir` sur `.next/export/_next/...`) est le même problème d'environnement sandbox déjà documenté dans les rapports Lots 1 et 2 (filesystem fuse-monté), reproduit à l'identique sur du code non modifié — sans impact sur le code livré.
- Aucune vérification navigateur live effectuée (pas de serveur de dev lancé dans ce sandbox) — comme pour les Lots 1 et 2, à vérifier visuellement de ton côté (mode sombre et clair, drag-and-drop des exercices/segments, bandeau petit écran en réduisant la fenêtre sous ~1200px).

### Risque de régression

Faible. Aucune ligne de logique métier (calcul de séries/volume/tonnage, sauvegarde Supabase, calcul de réordonnancement) n'a été modifiée — uniquement : suppression de code strictement mort et confirmé comme tel, ajout d'attributs `aria-label`, ajout d'un état React parallèle purement visuel pour le drag-and-drop (n'intervient jamais dans le calcul des index), et un bandeau conditionnel en pur CSS sans état.

### Limitation connue (déjà signalée, toujours pas résolue)

`.git/index.lock` est réapparu une nouvelle fois pendant ce lot (`git status` renvoie un avertissement `unable to unlink`) — à nettoyer de ton côté depuis ton propre terminal, comme évoqué après les Lots 1 et 2.

---

## Correctif hors-lot — hydratation du thème (entre Lot 3 et Lot 4)

Bug réel signalé par toi en local (`app/layout.tsx:34:5`, mismatch de `className` sur `<html>`) : le script anti-flash (`themeAntiFlashScript`, exécuté avant l'hydratation React) pose la classe `.light` directement sur `document.documentElement` quand le thème clair est mémorisé, alors que le rendu React de `<html>` reste statique (jamais `.light`). Corrigé par l'ajout de `suppressHydrationWarning` sur `<html>` uniquement (`app/layout.tsx`), en complément de l'implémentation déjà correcte (aucune lecture de `localStorage` pendant le rendu serveur, thème sombre par défaut inchangé, choix persisté inchangé, `ThemeProvider` ne touche jamais `document.documentElement` pendant son rendu). Vérifié en navigateur (extension Chrome) : aucune erreur d'hydratation ni erreur console au premier chargement, à l'actualisation en clair, à l'actualisation en sombre, sur la landing, l'admin et l'espace élève. Seul fichier modifié : `app/layout.tsx`.

---

## Lot 4 — Rapport d'exécution

**Note sur l'état Git** : ce lot a commencé avant que tu crées un commit séparé pour le Lot 3 + le correctif d'hydratation — le commit `499776e` ("Redesign lots 3-4 en cours + correctif hydratation") contient donc, en plus du Lot 3 et du correctif d'hydratation, les 5 premiers fichiers du Lot 4 listés ci-dessous. Les 2 fichiers restants (`app/globals.css`, `components/student/SessionFeedbackSection.tsx`) sont encore non commités au moment de ce rapport. Aucun historique Git n'a été réécrit ni réinitialisé — cette note sert uniquement à documenter précisément la frontière entre lots pour ton prochain commit.

Périmètre réalisé : `StatCard` unifié sur la page nutrition élève (dernière page encore non consolidée), grilles à 5 tuiles rééquilibrées, généralisation du pattern "header fixe + corps scrollable" à 4 modales élève, animation de confirmation sur le retour de séance. **Aucune modification métier/Supabase/Stripe/Brevo/Resend/API.** Le Training Builder n'a pas été retouché dans ce lot (seuls les fichiers listés ci-dessous ont changé).

### Fichiers modifiés — déjà présents dans le commit `499776e`

- **`app/(student)/nutrition/[planId]/page.tsx`** — les deux grilles de "chiffres clés" (kcal/jour, protéines, glucides, lipides, kcal/semaine — 5 tuiles, présentes dans la branche Supabase active et dans la branche de repli mock) remplacées par `<StatCard size="lg" />` (`@/components/shared/StatCard`, déjà créé au Lot 2), avec passage de `grid-cols-2 lg:grid-cols-5` à `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` — élimine l'orphelin en fin de ligne entre les breakpoints `sm` et `lg`, même correctif que celui déjà appliqué à `ProgressNutritionSection.tsx` et `/admin/seances` (confirmé déjà conforme, aucun changement nécessaire là). C'était la dernière page à réimplémenter manuellement ce motif au lieu d'utiliser `StatCard`.
- **`components/student/EditPersonalInfoModal.tsx`**, **`components/student/UpdateMeasurementsModal.tsx`**, **`components/student/AddProgressPhotoModal.tsx`**, **`components/shared/ProgressPhotosSection.tsx`** (modale d'upload de photo) — même correctif structurel sur les 4 : le conteneur unique `max-h-[90vh] overflow-y-auto p-6` (en-tête + corps + bouton "Fermer" dans la même zone de scroll) remplacé par `flex max-h-[90vh] flex-col` avec un en-tête `border-b px-6 py-4` fixe (hors zone de scroll) et un corps `flex-1 overflow-y-auto px-6 py-4` — reprend exactement le pattern déjà correct de `StudentOnboardingDetailModal.tsx` (cité dans l'audit comme la seule modale élève déjà bien construite). Sur un formulaire long (`UpdateMeasurementsModal.tsx` a 15 champs de mensuration) et petit écran, le bouton de fermeture ne peut plus sortir de vue au scroll. Aucun changement de logique de soumission/validation/upload — uniquement la structure de conteneur. `components/student/UpdateWeightModal.tsx` vérifié à part : seulement 2 champs, jamais assez long pour scroller, non concerné par ce bug — volontairement non touché.

### Fichiers modifiés — encore non commités

- **`app/globals.css`** — ajout d'un keyframe `fade-in` (opacity 0→1, 180ms ease-out) + classe utilitaire `.animate-fade-in`, avec désactivation sous `prefers-reduced-motion: reduce` (même convention exacte que le bandeau `public-programs-marquee-track` déjà présent dans ce fichier).
- **`components/student/SessionFeedbackSection.tsx`** — classe `animate-fade-in` ajoutée sur le conteneur de l'état "Retour envoyé" (opportunité d'animation #2 de l'audit). Comme le formulaire et la confirmation sont deux branches de rendu distinctes (React démonte l'un, monte l'autre), un cross-fade avec les deux éléments simultanément visibles aurait demandé une machinerie d'état supplémentaire pour un gain visuel marginal ; le fade-in à l'apparition de la confirmation adoucit la bascule avec un changement minimal. Aucune ligne de logique de soumission/persistance touchée.

### StatCard — duplication résiduelle, décision documentée (aucun changement)

`components/student/StatCard.tsx` (fichier mort signalé au Lot 2) n'existe déjà plus — tu l'as supprimé toi-même entre-temps. Le `StatCard` interne à `components/shared/TrainingMetricsSummary.tsx` (utilisé par `TrainingStatCards`) reste volontairement **non fusionné** : il est rendu à la fois par des fichiers élève (`SessionFeedbackSection.tsx`, `SessionAnalysisSection.tsx`, `WeekAnalysisSection.tsx`) et par `components/admin/ProgramBuilder.tsx` (Training Builder). Le fusionner aurait changé visuellement le panneau "Analyse de la séance" du builder (fond, padding, ordre libellé/valeur différents du `StatCard` partagé) — un changement visuel du Training Builder hors périmètre explicite du Lot 4 ("Espace élève"). Repoussé à un lot où le Training Builder est explicitement au périmètre, ou à valider avec toi séparément.

### `StudentSidebar.tsx` — déjà conforme, aucun changement

Vérifié : `hover:bg-white/[0.04]` déjà remplacé par `hover:bg-foreground/5` et `ThemeToggle` déjà rendu, tous deux faits au Lot 1. Seule couleur encore codée en dur : `text-amber-400` sur l'icône de cadenas (ligne 102) — même catégorie que les couleurs `red-400`/`amber-400`/`green-400` explicitement réservées au Lot 6 dans le plan (§6), non touchée ici.

### Vérifications

- **`npm run lint`** : 0 erreur, 0 warning.
- **`npx tsc --noEmit`** : 0 erreur.
- **`npm run build`** : compilation ✅, typecheck ✅, génération des 70 pages statiques ✅. Échoue ensuite sur le même `EPERM: rmdir` d'environnement sandbox déjà rencontré et vérifié indépendant du code à chaque lot précédent.
- **Non-régression Lots 1-3** : `git status` confirme qu'aucun fichier du Training Builder (`ProgramBuilder.tsx`, `ProgramBuilderFullscreen.tsx`), du thème (`ThemeProvider.tsx`, `ThemeToggle.tsx`, `app/layout.tsx`) ni des Lots 1-2 n'a été modifié par ce lot — seuls les 7 fichiers listés ci-dessus ont changé. Le build compile et typecheck l'intégralité du repo (donc Lots 1 à 3 inclus) sans erreur.
- Vérification navigateur live non refaite spécifiquement pour ce lot (au-delà de ce qui a déjà été vérifié pour le correctif d'hydratation) — à faire de ton côté : les 4 modales (ouverture, scroll sur mensurations avec beaucoup de champs, bouton Fermer toujours visible), la page nutrition élève (5 tuiles bien réparties en largeur moyenne), et le fade à l'envoi d'un retour de séance.

### Résumé des risques de régression

Très faible. Un remplacement mécanique de markup par un composant déjà existant et déjà utilisé ailleurs (`StatCard`), une restructuration de conteneur identique sur 4 modales reprenant un pattern déjà validé dans le repo, et l'ajout d'une classe CSS d'animation optionnelle (désactivable, sans état). Aucune fonction de calcul, de soumission ou d'upload modifiée.

**Arrêt obligatoire avant le Lot 5 — en attente de ta validation.**
