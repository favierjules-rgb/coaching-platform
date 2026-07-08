# Suivi nutrition hebdomadaire — modèle Supabase

Chantier "nutrition-weekly-adjustment-tool" : restaurer l'outil de calcul
de journée nutrition (ajustement automatique des calories restantes sur les
jours suivants) pour les plans nutrition **réels** (Supabase), branché sur
`nutrition_plans.student_id` (voir `docs/supabase-nutrition-model.md`).

## Audit : l'ancien outil n'a pas disparu, il n'a jamais été branché au réel

L'outil existe toujours dans le repo, intact :

- `lib/nutrition.ts` — `computeWeeklySummary`/`computeAdjustment`
- `hooks/useNutritionTracking.ts` — persistance `localStorage` par plan
- `components/student/NutritionPlanWorkspace.tsx`,
  `NutritionWeekStatusClient.tsx`, `NutritionAdjustmentCard.tsx`,
  `NutritionWeekDayCard.tsx`, `DailyMacroForm.tsx`

Mais `app/(student)/nutrition/page.tsx` et `[planId]/page.tsx` ne le
montent **que** dans la branche mock (`!supabaseNutrition.active`, ou
`activePlan` mock de `data/student.ts`). Depuis la migration
`supabase-nutrition-plans` (PR #18), un élève réel avec un plan
réellement assigné passe systématiquement par la branche
`supabaseNutrition.active` — qui n'a jamais affiché cet outil. D'où
l'impression de disparition : le code est là, simplement jamais rendu pour
un compte réel.

Ces fichiers mock restent **inchangés** dans ce chantier (toujours utilisés
par la branche non-Supabase, dev/démo sans backend) — le nouvel outil est un
second bloc dédié aux plans réels, pas un remplacement.

## Audit Supabase : aucune table de suivi journalier réel existante

Tables nutrition existantes : `nutrition_plans`, `nutrition_days`, `meals`.
`nutrition_days` a bien des colonnes `target`/`actual` (jsonb) — mais ces
lignes sont des **jours-modèles** (Lundi..Dimanche, sans date réelle,
`week_start_date` nullable depuis PR #18) potentiellement partagés si un
plan de bibliothèque est réassigné à un autre élève. Les réutiliser pour une
saisie réelle datée par élève mélangerait modèle et données réelles, et
casserait si un plan change d'élève. Aucune autre table
(`nutrition_daily_logs`, `daily_intake`, etc.) n'existe côté Supabase.

**Décision : nouvelle table dédiée**, exactement le schéma minimal proposé,
`create table if not exists` + RLS idempotente (safe à rejouer, aucune
donnée existante affectée) :

```sql
create table if not exists public.nutrition_daily_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  nutrition_plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  log_date date not null,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, nutrition_plan_id, log_date)
);
```

RLS (`nutrition_daily_logs_student_or_staff`, section 17ter de
`supabase/schema.sql`) : `student_id = current_student_id() or
is_coach_or_admin()`, pour `all` (select/insert/update/delete) — un élève
lit/écrit uniquement ses propres logs, le coach/admin a un accès complet.
`student_id` référence toujours `students.id`, jamais `profiles.id`,
`auth.users.id` ni `student_profiles.id`.

**⚠️ Migration à rejouer manuellement** : comme pour les chantiers
précédents, `supabase/schema.sql` doit être rejoué dans l'éditeur SQL
Supabase avant que l'outil fonctionne (relation `nutrition_daily_logs`
sinon inexistante côté base). Le connecteur Supabase MCP était déconnecté
pendant cette session — impossible de rejouer la migration ni de vérifier
en direct (tests 1, 6-13 de la liste fournie) ; à faire manuellement ou lors
d'une prochaine session avec le connecteur actif.

## Semaine calendaire, pas semaine "modèle"

`log_date` est une vraie date. La "semaine" affichée est la semaine
calendaire courante (lundi → dimanche, `lib/nutrition-weekly.ts::getCurrentWeekDates`),
pas un cycle abstrait Lundi..Dimanche réutilisé indéfiniment. Conséquences :

- recharger la page un jour donné retrouve le même log (même date, même
  semaine) ;
- la semaine suivante démarre naturellement vide (nouvelles dates), sans
  bouton "réinitialiser" nécessaire — contrairement à l'ancien outil mock.

## Logique de calcul (`lib/nutrition-weekly.ts`)

Fonction pure `computeWeeklyNutritionAdjustment`, sans dépendance
React/Supabase (réutilisée telle quelle côté élève et côté résumé admin) :

```
weeklyTarget = plan.weeklyTargetCalories (si > 0) sinon dailyTarget.calories × 7
consumedSoFar = somme des calories des jours déjà remplis (log existant, calories non nulles)
remainingCalories = weeklyTarget - consumedSoFar
remainingDays = 7 - joursRemplis
adjustedDailyTarget = remainingDays > 0 et remainingCalories >= 0
  ? round(remainingCalories / remainingDays)
  : null  // null => "objectif hebdomadaire déjà dépassé" côté UI, jamais de valeur négative affichée
```

- Un jour déjà rempli garde son objectif **normal** (jamais modifié a
  posteriori) et son réel/écart affichés ; seuls les jours non remplis
  reçoivent `adjustedDailyTarget`.
- Aucun jour rempli → la formule retombe naturellement sur l'objectif
  normal (`remainingCalories / 7 == dailyTarget.calories` quand
  `weeklyTarget == dailyTarget × 7`).
- `overBudget` (booléen, `remainingCalories < 0`) déclenche le message
  "objectif hebdomadaire déjà dépassé" au lieu d'un objectif négatif.
- `lowCalorieWarning` : signale (sans jamais bloquer la saisie) un objectif
  ajusté descendu sous `max(1200 kcal, 50 % de l'objectif journalier)`.

Vérifié à la main contre les deux exemples chiffrés fournis : lundi
2500 kcal (objectif 2200, hebdo 15400) → ajusté mar-dim = 2150 ; puis mardi
2000 kcal → ajusté mer-dim = 2180. Les deux correspondent exactement.

Même formule appliquée aux macros (protéines/glucides/lipides), à partir de
`dailyTarget.protein/carbs/fat × 7` (pas de colonne "objectif hebdo" dédiée
pour les macros dans `nutrition_plans.daily_target`, donc toujours × 7).

## Composition

- `lib/supabase/nutrition-logs.ts` — I/O Supabase
  (`getNutritionLogsForDates`, `getLatestNutritionLog`,
  `upsertNutritionDailyLog` en upsert sur la contrainte unique).
- `hooks/useSupabaseNutritionWeek.ts` — charge les logs de la semaine
  courante pour `(studentId, planId)`, calcule l'ajustement, expose
  `saveDay`. Réutilisé tel quel côté élève (avec sauvegarde) et côté admin
  (lecture seule, `saveDay` simplement pas appelée).
- `components/student/WeeklyNutritionTracker.tsx` — bloc "Suivi de la
  semaine" sur `/nutrition` (résumé semaine + 7 cartes jour, formulaire
  kcal/prot/gluc/lip/note éditable même sur un jour déjà rempli).
- `components/admin/NutritionWeekSummaryCard.tsx` — résumé lecture seule
  dans `/admin/eleves/[studentId]` (objectif semaine, consommé, écart,
  jours remplis, dernier log). Pas d'éditeur admin complet pour cette
  étape, comme demandé.

## Pages modifiées

- `app/(student)/nutrition/page.tsx` — monte `WeeklyNutritionTracker` dans
  la branche `supabaseNutrition.active` avec `activePlan`, juste après
  l'en-tête du plan actif. Si aucun plan actif : inchangé, "Aucun plan
  alimentaire attribué" (l'outil n'est jamais monté).
- `app/admin/eleves/[studentId]/page.tsx` — section "Suivi nutrition" sous
  la grille Programme/Plan nutrition/Documents, visible uniquement si
  `isSupabaseStudent && assignedPlan`.

Aucune autre page touchée : `/admin`, `/admin/nutrition`, `/admin/eleves`,
`/dashboard`, `/profil`, `/entrainement`, programmes Supabase, retours
entraînement, questionnaire onboarding et le reste des plans nutrition
Supabase restent strictement inchangés.
