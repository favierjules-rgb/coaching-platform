# Modèle Supabase nutrition

Ce document fixe le modèle utilisé pour la migration des plans alimentaires
mockés vers de vrais plans Supabase — même démarche que
`docs/supabase-programs-model.md` pour les programmes.

## Décision : aucune nouvelle table

`supabase/schema.sql` contenait déjà `nutrition_plans`, `nutrition_days`,
`meals` (sections 15-17), RLS comprise, jamais branchées à l'app. La table
générique `assignments` (déjà utilisée pour les programmes) supporte
`content_type = 'nutrition'` nativement : réutilisée telle quelle, pas de
`student_nutrition_assignments` créée.

**Vérification live effectuée** (suite au signalement d'un plan affiché en
UI absent de `nutrition_plans` côté base) : le schéma live correspond bien
à `supabase/schema.sql` (colonnes additives dont `description`/
`coach_notes`/`hydration_tip`/`supplements` présentes), et un `insert`
simulé sous le rôle `authenticated` avec les claims JWT de l'admin réussit
sans erreur RLS. Le bug reproduit n'était donc pas côté base : les pages
admin affichaient encore un plan mock/localStorage à côté des vrais plans
Supabase, avec un élève réel visible dans les deux listes — d'où
l'apparence d'une "assignation factice". Corrigé en supprimant tout repli
mock une fois Supabase configuré (voir "Assignation" plus bas).

## Ajustements additifs nécessaires

1. **`nutrition_plans.description` / `coach_notes` / `hydration_tip` /
   `supplements`** — n'existaient pas. `NutritionPlanBuilder` (mock)
   collecte déjà ces champs (notes coach niveau plan — distinctes des
   notes par repas, déjà couvertes par `meals.coach_notes` —, conseil
   hydratation, liste de compléments) : sans ces colonnes, une saisie
   coach y serait silencieusement perdue.
2. **`nutrition_days.week_start_date` assoupli en nullable** — pensé pour
   une journée réelle datée (suivi élève), mais un "jour type" créé par le
   coach (un jour par nom de semaine, Lundi..Dimanche, pas de vraie date)
   n'a pas de date calendaire à fournir.
3. **RLS** (`nutrition_plans_select_self_or_assigned`,
   `nutrition_days_select_self_or_assigned`, `meals_select_self_or_assigned`)
   — un élève lit un plan uniquement si `nutrition_plans.student_id`
   correspond à son id (voir "Assignation" ci-dessous). Les policies sont
   supprimées (`drop policy if exists`) puis recréées à chaque rejeu du
   script — aucune donnée supprimée, uniquement une règle de lecture.

Aucune suppression de donnée, aucune table cassée. Bloc complet dans
`supabase/schema.sql` (section "17bis" + policies RLS des tables
`nutrition_plans`/`nutrition_days`/`meals`), safe à rejouer plusieurs fois.

## Portée volontairement exclue : suivi jour par jour de l'élève

`useNutritionTracking`, `NutritionPlanWorkspace`, `NutritionWeekStatusClient`,
`computeAdjustment` (validation d'une journée réelle, ajustement calorique)
restent 100% mock/localStorage. Le schéma (`nutrition_days.actual`/`status`)
les anticipait déjà, mais ce n'était pas demandé pour cette étape (lecture
seule côté élève) — migration séparée si besoin.

## Composition vers les types existants

- **Admin** : `lib/supabase/nutrition.ts` compose les lignes Supabase en
  `AdminNutritionPlan` / `AdminNutritionDay` / `AdminMeal` (types mock déjà
  utilisés par `NutritionPlanBuilder` et tout `/admin/nutrition`).
- **Élève** : nouvelles pages `/nutrition` et `/nutrition/[planId]`
  affichent directement `AdminNutritionPlan` en lecture seule (pas de
  conversion vers les types élève `NutritionPlan`/`NutritionDay`, qui sont
  pensés pour le suivi jour par jour hors périmètre).

## Assignation

**Source de vérité : `nutrition_plans.student_id` directement — pas la
table générique `assignments`.** Celle-ci reste réservée aux programmes
(voir `lib/supabase/programs.ts`) ; mélanger les deux mécanismes pour la
nutrition créerait deux sources de vérité divergentes. Un plan a donc au
plus un élève assigné à la fois :

- assigner : `update nutrition_plans set student_id = <id élève>`
- retirer : `update nutrition_plans set student_id = null`

`lib/supabase/nutrition.ts::setNutritionAssignment` implémente cette
écriture directe. `getAssignedNutritionPlansForStudent` /
`getAssignedNutritionPlanForStudent` / `getAssignedNutritionPlanIdsByStudent`
lisent `nutrition_plans` filtré par `student_id` — plus de jointure via
`assignments`. `hooks/useContentAssignment.ts` route vers
`setNutritionAssignment` dès que Supabase est configuré ; `lib/supabase/students.ts::toAdminStudent`
peuple `assignedNutritionPlanIds` depuis cette même source.

**Jamais de mélange mock/réel.** Dès que Supabase est configuré,
`/admin/nutrition`, `/admin/eleves/[studentId]`, `/nutrition` (élève) et le
dashboard élève n'affichent plus jamais de plan mock/localStorage — un
`nutrition_plans` vide affiche un état vide ("Aucun plan alimentaire
attribué" / liste vide + bouton de création), jamais un plan de démo. Le
repli mock complet ne s'applique que si Supabase n'est pas configuré du
tout (environnement de démo sans backend).

## Contexte onboarding

Les champs demandés (allergies, intolérances, aliments aimés/à éviter,
repas/jour, régime, contraintes horaires/sociales/pro) étaient déjà affichés
dans la carte "Préférences alimentaires" de `/admin/eleves/[studentId]`
(construite lors de la migration onboarding) — seul `nutritionNotes`
manquait, ajouté. Dashboards admin/élève restent synthétiques : ces champs
ne créent jamais automatiquement de plan.
