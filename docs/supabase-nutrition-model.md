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

**Vérification live non effectuée pour cette étape** : le connecteur
Supabase est resté indisponible côté outils malgré plusieurs tentatives de
réactivation pendant cette session. Le modèle ci-dessous repose sur
`supabase/schema.sql`, qui s'est révélé fiable (identique à la réalité) lors
de la migration programmes précédente. **À vérifier en direct avant de
merger** — voir le bloc SQL ci-dessous, idempotent et sûr à rejouer.

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
3. **RLS étendue** (`nutrition_plans_select_self_or_assigned`,
   `nutrition_days_select_self_or_assigned`, `meals_select_self_or_assigned`)
   — les policies existantes ne laissaient un élève lire un plan que si
   `nutrition_plans.student_id` était directement renseigné à son id. Un
   plan de bibliothèque assigné via `assignments` (comme les programmes)
   doit aussi être lisible. Les anciennes policies sont supprimées
   (`drop policy if exists`) puis recréées avec la condition élargie —
   aucune donnée supprimée, uniquement une règle de lecture.

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

`hooks/useContentAssignment.ts` (généralisation de l'ancien
`useProgramAssignment`, qui ne gérait que les programmes) route vers
`setNutritionAssignment` dès que le plan **et** l'élève affichés sont tous
les deux réels ; sinon repli mock. `lib/supabase/students.ts::toAdminStudent`
peuple désormais `assignedNutritionPlanIds` depuis la vraie table
`assignments` (auparavant toujours `[]`), via
`getAssignedNutritionPlanIdsByStudent`.

## Contexte onboarding

Les champs demandés (allergies, intolérances, aliments aimés/à éviter,
repas/jour, régime, contraintes horaires/sociales/pro) étaient déjà affichés
dans la carte "Préférences alimentaires" de `/admin/eleves/[studentId]`
(construite lors de la migration onboarding) — seul `nutritionNotes`
manquait, ajouté. Dashboards admin/élève restent synthétiques : ces champs
ne créent jamais automatiquement de plan.
