-- ============================================================================
-- Migration 20260810090000 — durcissement des privilèges du domaine nutrition
-- et protection des colonnes sensibles de `students`
-- (chantier feat/student-nutrition-recipes, PR C — lot 1/4).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Trois défauts mesurés, tous antérieurs à cette PR.
--
--   A. TRUNCATE. Les privilèges par défaut du schéma accordent `ALL` à
--      `anon`, `authenticated` et `service_role` sur toute table future
--      (baseline:3681-3683), plus des `GRANT ALL` explicites sur chaque table
--      préexistante (baseline:3450-3596). `ALL` inclut TRUNCATE, qui
--      **contourne intégralement la RLS**. La migration 20260807090000 avait
--      mesuré et documenté le fait (l.64-78) sans corriger l'existant, ce qui
--      était hors de son périmètre. Les trois tables de recettes sont
--      aujourd'hui les seules du domaine correctement verrouillées ; cette
--      migration généralise leur gabarit aux six tables du plan.
--
--   B. `students`. `students_update_self_or_staff` (baseline:3020) est
--      `for update using (user_id = auth.uid() or is_coach_or_admin())`
--      **sans `with check`**, et aucun trigger ne protège la table — le seul
--      trigger est `set_updated_at` (baseline:2120), là où `student_profiles`
--      dispose bien de `protect_student_profiles_access_columns`
--      (baseline:87-106). Un élève peut donc émettre
--      `PATCH /rest/v1/students?id=eq.<son_id>` avec un `coach_id` arbitraire :
--      la ligne résultante satisfait toujours `user_id = auth.uid()`, donc le
--      `with check` implicite passe. `access_type` et `status` sont ouverts de
--      la même façon.
--
--      Ce point conditionne la PR C : la visibilité des recettes s'appuie sur
--      la chaîne élève → plan → coach. Même si cette chaîne passe par
--      `nutrition_plans` (jamais par `students.coach_id`), laisser un élève
--      réécrire son propre rattachement reste une élévation de privilège.
--
--   C. `nutrition_days`. `nutrition_days_update_self` (baseline:2870-2874)
--      autorise l'élève à modifier **toutes** les colonnes des jours de son
--      plan, `target` comprise — c'est-à-dire les cibles fixées par le coach.
--      Seuls `status` et `actual` le concernent. La RLS ne sait pas raisonner
--      colonne par colonne, et les privilèges de colonne ne le peuvent pas
--      davantage ici : coach et élève partagent le rôle `authenticated`. Le
--      seul mécanisme correct est un trigger, sur le modèle de
--      `protect_student_profiles_access_columns`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE CASSE PAS
-- ────────────────────────────────────────────────────────────────────────────
-- L'OUTIL 1 (suivi quotidien de l'élève) repose sur `nutrition_daily_logs` :
-- l'élève doit continuer à y INSÉRER, METTRE À JOUR et SUPPRIMER ses propres
-- lignes. Les quatre droits `select, insert, update, delete` sont donc
-- conservés sur cette table — seul TRUNCATE est retiré. La policy
-- `nutrition_daily_logs_student_or_staff` (baseline:2853) reste intacte.
--
-- De même, coach et élève partagent le rôle `authenticated` : les quatre
-- droits restent accordés sur les six tables, et c'est la RLS — inchangée ici
-- sauf pour `nutrition_days` — qui décide de qui touche quoi.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. TRUNCATE retiré à `authenticated` sur les six tables du plan
-- ────────────────────────────────────────────────────────────────────────────
-- `revoke all` PRÉCÈDE le grant : un `grant` est additif, il ne remplace pas
-- un privilège hérité. C'est exactement l'erreur commise par
-- 20260804090000:223-229, qui révoquait `public` et `anon` mais jamais
-- `authenticated`, laissant survivre le `ALL` des default privileges.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'nutrition_plans',
    'nutrition_days',
    'meals',
    'nutrition_daily_logs',
    'nutrition_plan_profiles',
    'nutrition_meal_slot_targets'
  ] loop
    execute format('revoke all on table public.%I from public', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('revoke all on table public.%I from authenticated', v_table);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_table
    );
  end loop;
end $$;

-- Contrôle immédiat : la migration échoue si un TRUNCATE subsiste.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'nutrition_plans',
    'nutrition_days',
    'meals',
    'nutrition_daily_logs',
    'nutrition_plan_profiles',
    'nutrition_meal_slot_targets',
    'nutrition_recipes',
    'nutrition_recipe_ingredients',
    'nutrition_recipe_tags'
  ] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE') then
      raise exception
        'MIGRATION IMPOSSIBLE : authenticated conserve TRUNCATE sur public.%', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception
        'MIGRATION IMPOSSIBLE : authenticated a perdu SELECT sur public.%', v_table;
    end if;
  end loop;
  raise notice 'TRUNCATE retiré à authenticated sur les 9 tables du domaine nutrition.';
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- B. Colonnes sensibles de `students`
-- ────────────────────────────────────────────────────────────────────────────
-- Motif repris de `protect_profiles_role_column` (20260726220000:91-129) :
--   - contexte non-utilisateur (service role, migrations, tâches) : on laisse
--     passer, `auth.uid()` étant NULL et la RLS ayant déjà écarté `anon` ;
--   - staff : on laisse passer, c'est son métier ;
--   - élève : les colonnes protégées sont REMISES à leur valeur d'origine.
--
-- Remettre plutôt que lever : un client qui renvoie l'objet entier (motif
-- courant avec supabase-js) ne doit pas échouer parce qu'il a réémis une
-- valeur identique. Une tentative de MODIFICATION réelle, elle, est
-- silencieusement neutralisée — et le contrôle post-écriture ci-dessous, dans
-- la checklist, le vérifie.
create or replace function public.protect_students_ownership_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Contexte non-utilisateur : rien à protéger.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Le staff gère ses élèves : rattachement, accès et statut lui appartiennent.
  if public.is_coach_or_admin() then
    return new;
  end if;

  -- Un élève ne choisit ni son coach, ni son type d'accès, ni son statut, ni
  -- le compte auth auquel sa fiche est rattachée.
  new.coach_id := old.coach_id;
  new.access_type := old.access_type;
  new.status := old.status;
  new.user_id := old.user_id;

  return new;
end;
$$;

alter function public.protect_students_ownership_columns() owner to postgres;

comment on function public.protect_students_ownership_columns() is
  'Empêche un élève de modifier students.coach_id, access_type, status et user_id : les valeurs d''origine sont restaurées avant écriture. Le staff et les contextes non-utilisateur (service role, migrations) ne sont pas concernés. Complète students_update_self_or_staff, qui n''a pas de WITH CHECK.';

-- Fonction de trigger uniquement : jamais appelable en RPC.
revoke all on function public.protect_students_ownership_columns() from public;
revoke execute on function public.protect_students_ownership_columns() from anon;
revoke execute on function public.protect_students_ownership_columns() from authenticated;

drop trigger if exists protect_students_ownership on public.students;
create trigger protect_students_ownership
  before update on public.students
  for each row
  execute function public.protect_students_ownership_columns();

-- ────────────────────────────────────────────────────────────────────────────
-- C. `nutrition_days` : l'élève ne touche que ce qui le concerne
-- ────────────────────────────────────────────────────────────────────────────
-- Colonnes réellement destinées à l'élève : `status` (il avance dans sa
-- journée) et `actual` (ce qu'il a consommé). Tout le reste — `plan_id`,
-- `day`, `week_start_date`, `target`, et à partir de la migration
-- 20260811090000 `profile_key` — appartient au coach.
create or replace function public.protect_nutrition_days_coach_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.is_coach_or_admin() then
    return new;
  end if;

  new.plan_id := old.plan_id;
  new.day := old.day;
  new.week_start_date := old.week_start_date;
  new.target := old.target;

  -- `profile_key` n'existe pas encore à ce stade : la colonne est ajoutée par
  -- 20260811090000, qui RECRÉE cette fonction en l'incluant. Écrire ici une
  -- protection conditionnelle sur une colonne inexistante ne compilerait pas
  -- — PL/pgSQL résout les champs de `new` au premier appel, pas au CREATE.
  return new;
end;
$$;

alter function public.protect_nutrition_days_coach_columns() owner to postgres;

comment on function public.protect_nutrition_days_coach_columns() is
  'Limite l''UPDATE élève de nutrition_days aux colonnes status et actual. plan_id, day, week_start_date, target et profile_key sont restaurés à leur valeur d''origine pour un non-staff. Le staff et les contextes non-utilisateur ne sont pas concernés.';

revoke all on function public.protect_nutrition_days_coach_columns() from public;
revoke execute on function public.protect_nutrition_days_coach_columns() from anon;
revoke execute on function public.protect_nutrition_days_coach_columns() from authenticated;

drop trigger if exists protect_nutrition_days_coach_columns on public.nutrition_days;
create trigger protect_nutrition_days_coach_columns
  before update on public.nutrition_days
  for each row
  execute function public.protect_nutrition_days_coach_columns();

-- ────────────────────────────────────────────────────────────────────────────
-- Contrôle final
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.students'::regclass
       and tgname = 'protect_students_ownership'
  ) then
    raise exception 'MIGRATION IMPOSSIBLE : le trigger protect_students_ownership est absent';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.nutrition_days'::regclass
       and tgname = 'protect_nutrition_days_coach_columns'
  ) then
    raise exception 'MIGRATION IMPOSSIBLE : le trigger protect_nutrition_days_coach_columns est absent';
  end if;
  raise notice 'Durcissement appliqué : 2 triggers de protection, TRUNCATE retiré sur 9 tables.';
end $$;
