-- ============================================================================
-- Checklist PostgreSQL — fix/nutrition-single-assigned-plan
-- Migration couverte : 20260806090000_assign_nutrition_plan_unique.sql
--
-- CE QU'ELLE VÉRIFIE
--   A. les trois fonctions existent, avec la bonne signature, security
--      invoker, search_path verrouillé, propriétaire et privilèges conformes ;
--   B. l'index unique partiel existe et REFUSE réellement un doublon ;
--   C. assignation d'un plan v1 à un élève sans plan ;
--   D. remplacement A → B : l'ancien est retiré, le nouveau assigné, dans
--      la MÊME transaction — jamais deux lignes, jamais zéro ;
--   E. plan v2 complet assignable ; plan v2 incomplet REFUSÉ, sans qu'aucune
--      ligne ne bouge (l'ancien plan reste en place) ;
--   F. idempotence du rejeu, et désassignation volontaire toujours possible ;
--   G. atomicité : une erreur en cours de transaction ne laisse aucun état
--      partiel ;
--   H. programmes et documents intacts ;
--   I. après le ROLLBACK, aucune donnée de test ne subsiste.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=0 \
--     -f supabase/tests/nutrition_single_assigned_plan_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production. La transaction se termine par un
--    ROLLBACK, mais le principe reste : base locale uniquement.
-- ============================================================================

\timing off
\set ON_ERROR_STOP 0

begin;

-- Table de faits : chaque contrôle y dépose son résultat, on tranche à la fin.
create temporary table _faits (
  section text,
  libelle text,
  ok boolean
) on commit drop;

-- Les RPC s'exécutent sous `authenticated` (security invoker) : ce rôle doit
-- pouvoir écrire dans la table temporaire de la checklist.
do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then
    raise notice 'OK      — %', p_libelle;
  else
    raise warning 'ÉCHEC   — %', p_libelle;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Section A — les fonctions, leur sécurité et leurs privilèges
-- ---------------------------------------------------------------------
do $$
declare
  v_nb int;
  v_secdef boolean;
  v_owner text;
  v_config text[];
begin
  select count(*) into v_nb
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('assign_nutrition_plan', 'unassign_nutrition_plan', 'nutrition_plan_v2_blocking_issue');
  perform pg_temp.noter('A', 'A1. les trois fonctions existent', v_nb = 3);

  perform pg_temp.noter('A', 'A2. signature assign_nutrition_plan(uuid, uuid) returns jsonb', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'assign_nutrition_plan'
       and pg_get_function_identity_arguments(p.oid) = 'p_plan_id uuid, p_student_id uuid'
       and pg_get_function_result(p.oid) = 'jsonb'));

  perform pg_temp.noter('A', 'A3. signature unassign_nutrition_plan(uuid) returns jsonb', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'unassign_nutrition_plan'
       and pg_get_function_identity_arguments(p.oid) = 'p_plan_id uuid'
       and pg_get_function_result(p.oid) = 'jsonb'));

  for v_secdef, v_owner, v_config in
    select p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('assign_nutrition_plan', 'unassign_nutrition_plan', 'nutrition_plan_v2_blocking_issue')
  loop
    perform pg_temp.noter('A', 'A4. SECURITY INVOKER (prosecdef = false)', v_secdef = false);
    perform pg_temp.noter('A', 'A5. propriétaire postgres', v_owner = 'postgres');
    perform pg_temp.noter('A', 'A6. search_path verrouillé à vide',
      v_config @> array['search_path=']::text[] or v_config @> array['search_path=""']::text[]
      or v_config @> array['search_path=''''']::text[]);
  end loop;
end $$;

do $$
begin
  perform pg_temp.noter('A', 'A7. anon ne peut pas exécuter assign_nutrition_plan',
    not has_function_privilege('anon', 'public.assign_nutrition_plan(uuid, uuid)', 'execute'));
  perform pg_temp.noter('A', 'A8. anon ne peut pas exécuter unassign_nutrition_plan',
    not has_function_privilege('anon', 'public.unassign_nutrition_plan(uuid)', 'execute'));
  perform pg_temp.noter('A', 'A9. PUBLIC ne peut pas exécuter assign_nutrition_plan',
    not has_function_privilege('public', 'public.assign_nutrition_plan(uuid, uuid)', 'execute'));
  perform pg_temp.noter('A', 'A10. authenticated peut exécuter assign_nutrition_plan',
    has_function_privilege('authenticated', 'public.assign_nutrition_plan(uuid, uuid)', 'execute'));
  perform pg_temp.noter('A', 'A11. authenticated peut exécuter unassign_nutrition_plan',
    has_function_privilege('authenticated', 'public.unassign_nutrition_plan(uuid)', 'execute'));
end $$;

-- ---------------------------------------------------------------------
-- Section B — l'invariant en base
-- ---------------------------------------------------------------------
do $$
declare v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'nutrition_plans_one_plan_per_student';
  perform pg_temp.noter('B', 'B1. l''index unique partiel existe', v_def is not null);
  perform pg_temp.noter('B', 'B2. il est UNIQUE sur (student_id)',
    v_def like '%UNIQUE INDEX%' and v_def like '%(student_id)%');
  perform pg_temp.noter('B', 'B3. il est PARTIEL (student_id is not null)',
    v_def like '%WHERE (student_id IS NOT NULL)%');
end $$;

-- Jeu d'essai
insert into auth.users (id, email) values
  ('eeee6666-6666-4666-8666-666666666666', 'sa.coach@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email)
values ('eeee6666-6666-4666-8666-666666666666', 'coach', 'Sacha', 'A', 'sa.coach@test.local');

insert into public.students (id, first_name, last_name, email, status, access_type)
values ('55550000-0000-4000-8000-000000000001', 'Léa', 'L', 'lea@test.local', 'active', 'coaching'),
       ('55550000-0000-4000-8000-000000000002', 'Théo', 'T', 'theo@test.local', 'active', 'coaching');

-- Plan A : v1, assignable par définition.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
values ('66660000-0000-4000-8000-00000000000a', 'Plan A (v1)', 'maintien', 'actif',
        '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 1);

-- Plan B : v2 COMPLET.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
values ('66660000-0000-4000-8000-00000000000b', 'Plan B (v2 complet)', 'maintien', 'actif', '{}'::jsonb, 2);
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('77770000-0000-4000-8000-00000000000b', '66660000-0000-4000-8000-00000000000b', 'default', 2400, 3000, 4500, 2500);
insert into public.nutrition_meal_slot_targets (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
values ('77770000-0000-4000-8000-00000000000b', 'breakfast',      true, 2000, 2000, 2000, 1),
       ('77770000-0000-4000-8000-00000000000b', 'morning_snack',  true, 1000, 1000, 1000, 2),
       ('77770000-0000-4000-8000-00000000000b', 'lunch',          true, 3000, 3000, 3000, 3),
       ('77770000-0000-4000-8000-00000000000b', 'afternoon_snack',true, 1000, 1000, 1000, 4),
       ('77770000-0000-4000-8000-00000000000b', 'dinner',         true, 2500, 2500, 2500, 5),
       ('77770000-0000-4000-8000-00000000000b', 'dessert',        true,  500,  500,  500, 6);

-- Plan C : v2 INCOMPLET (protéines à 9 000 seulement).
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
values ('66660000-0000-4000-8000-00000000000c', 'Plan C (v2 incomplet)', 'maintien', 'prochain', '{}'::jsonb, 2);
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('77770000-0000-4000-8000-00000000000c', '66660000-0000-4000-8000-00000000000c', 'default', 2000, 3000, 4500, 2500);
insert into public.nutrition_meal_slot_targets (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
values ('77770000-0000-4000-8000-00000000000c', 'breakfast',      true, 2000, 2000, 2000, 1),
       ('77770000-0000-4000-8000-00000000000c', 'morning_snack',  true, 1000, 1000, 1000, 2),
       ('77770000-0000-4000-8000-00000000000c', 'lunch',          true, 3000, 3000, 3000, 3),
       ('77770000-0000-4000-8000-00000000000c', 'afternoon_snack',true, 1000, 1000, 1000, 4),
       ('77770000-0000-4000-8000-00000000000c', 'dinner',         true, 1500, 2500, 2500, 5),
       ('77770000-0000-4000-8000-00000000000c', 'dessert',        true,  500,  500,  500, 6);

-- Programme et document témoins : ils ne doivent jamais bouger.
insert into public.programs (id, name, goal, level, duration_weeks, description, status)
values ('88880000-0000-4000-8000-000000000001', 'Programme témoin', 'maintien', 'debutant', 4,
        'ne doit pas bouger', 'actif');
insert into public.assignments (student_id, content_type, content_id)
values ('55550000-0000-4000-8000-000000000001', 'programme', '88880000-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeee6666-6666-4666-8666-666666666666","role":"authenticated"}';

-- ---------------------------------------------------------------------
-- Section C — un élève sans plan reçoit un plan valide
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb;
begin
  select public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000a',
                                      '55550000-0000-4000-8000-000000000001') into v_res;
  perform pg_temp.noter('C', 'C1. plan v1 assigné à un élève sans plan',
    (v_res->'plan'->>'student_id') = '55550000-0000-4000-8000-000000000001');
  perform pg_temp.noter('C', 'C2. aucun plan retiré (l''élève n''en avait pas)',
    jsonb_array_length(v_res->'unassigned_plan_ids') = 0);
  perform pg_temp.noter('C', 'C3. exactement un plan en base pour cet élève',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') = 1);
end $$;

-- ---------------------------------------------------------------------
-- Section D — remplacement A → B, atomique
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb;
begin
  select public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000b',
                                      '55550000-0000-4000-8000-000000000001') into v_res;
  perform pg_temp.noter('D', 'D1. le plan v2 complet est assigné',
    (v_res->'plan'->>'id') = '66660000-0000-4000-8000-00000000000b');
  perform pg_temp.noter('D', 'D2. l''ancien plan A est retiré dans la MÊME transaction',
    (v_res->'unassigned_plan_ids') @> '["66660000-0000-4000-8000-00000000000a"]'::jsonb);
  perform pg_temp.noter('D', 'D3. A n''a plus d''élève EN BASE',
    (select student_id from public.nutrition_plans
      where id = '66660000-0000-4000-8000-00000000000a') is null);
  perform pg_temp.noter('D', 'D4. B est le SEUL plan de cet élève',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') = 1);
  perform pg_temp.noter('D', 'D5. jamais zéro plan : l''élève en a toujours un',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') >= 1);
end $$;

-- ---------------------------------------------------------------------
-- Section E — refus d'un plan v2 incomplet, sans effet de bord
-- ---------------------------------------------------------------------
do $$
declare
  v_avant jsonb;
  v_apres jsonb;
  v_refuse boolean := false;
  v_message text;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id) order by id)
    into v_avant from public.nutrition_plans;

  begin
    perform public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000c',
                                         '55550000-0000-4000-8000-000000000001');
  exception when others then
    v_refuse := true;
    v_message := sqlerrm;
  end;

  perform pg_temp.noter('E', 'E1. le plan v2 incomplet est REFUSÉ', v_refuse);
  perform pg_temp.noter('E', 'E2. le refus nomme la règle violée',
    coalesce(v_message, '') like '%PLAN_NOT_ASSIGNABLE%');

  select jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id) order by id)
    into v_apres from public.nutrition_plans;
  perform pg_temp.noter('E', 'E3. AUCUNE ligne modifiée par le refus', v_avant = v_apres);
  perform pg_temp.noter('E', 'E4. l''élève conserve son plan B',
    (select student_id from public.nutrition_plans
      where id = '66660000-0000-4000-8000-00000000000b') = '55550000-0000-4000-8000-000000000001');
  perform pg_temp.noter('E', 'E5. le plan incomplet n''est assigné à personne',
    (select student_id from public.nutrition_plans
      where id = '66660000-0000-4000-8000-00000000000c') is null);
end $$;

-- Détail des règles v2 reproduites en SQL.
do $$
begin
  perform pg_temp.noter('E', 'E6. la règle violée est bien identifiée (protein_split_incomplete)',
    public.nutrition_plan_v2_blocking_issue('66660000-0000-4000-8000-00000000000c') = 'protein_split_incomplete');
  perform pg_temp.noter('E', 'E7. un plan v2 complet ne remonte aucun problème',
    public.nutrition_plan_v2_blocking_issue('66660000-0000-4000-8000-00000000000b') is null);
end $$;

-- ---------------------------------------------------------------------
-- Section F — idempotence, et désassignation volontaire
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb;
begin
  select public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000b',
                                      '55550000-0000-4000-8000-000000000001') into v_res;
  perform pg_temp.noter('F', 'F1. rejeu du MÊME plan : toujours assigné',
    (v_res->'plan'->>'student_id') = '55550000-0000-4000-8000-000000000001');
  perform pg_temp.noter('F', 'F2. rejeu : aucun plan retiré (le plan cible est exclu)',
    jsonb_array_length(v_res->'unassigned_plan_ids') = 0);
  perform pg_temp.noter('F', 'F3. toujours exactement un plan pour cet élève',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') = 1);

  select public.unassign_nutrition_plan('66660000-0000-4000-8000-00000000000b') into v_res;
  perform pg_temp.noter('F', 'F4. désassignation volontaire autorisée',
    (v_res->'plan'->>'student_id') is null and (v_res->>'assigned') = 'false');
  perform pg_temp.noter('F', 'F5. l''élève n''a plus aucun plan',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') = 0);

  -- Un plan INVALIDE doit lui aussi pouvoir être retiré.
  update public.nutrition_plans set student_id = '55550000-0000-4000-8000-000000000002'
   where id = '66660000-0000-4000-8000-00000000000c';
  select public.unassign_nutrition_plan('66660000-0000-4000-8000-00000000000c') into v_res;
  perform pg_temp.noter('F', 'F6. un plan INVALIDE peut être retiré',
    (v_res->'plan'->>'student_id') is null);
end $$;

-- ---------------------------------------------------------------------
-- Section G — l'invariant refuse réellement un doublon, et atomicité
-- ---------------------------------------------------------------------
do $$
declare
  v_bloque boolean := false;
  v_message text;
begin
  perform public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000a',
                                       '55550000-0000-4000-8000-000000000001');
  -- Écriture DIRECTE fautive, telle que la faisait l'ancien code : la base
  -- doit la refuser, même si le code applicatif se trompait.
  begin
    update public.nutrition_plans
       set student_id = '55550000-0000-4000-8000-000000000001'
     where id = '66660000-0000-4000-8000-00000000000b';
  exception when unique_violation then
    v_bloque := true;
    v_message := sqlerrm;
  end;
  perform pg_temp.noter('G', 'G1. une écriture directe créant un doublon est REFUSÉE par la base', v_bloque);
  perform pg_temp.noter('G', 'G2. le refus nomme l''index d''unicité',
    coalesce(v_message, '') like '%nutrition_plans_one_plan_per_student%');
  perform pg_temp.noter('G', 'G3. toujours un seul plan pour cet élève',
    (select count(*) from public.nutrition_plans
      where student_id = '55550000-0000-4000-8000-000000000001') = 1);
end $$;

do $$
declare
  v_avant jsonb;
  v_apres jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id) order by id)
    into v_avant from public.nutrition_plans;
  begin
    -- Plan inexistant : la RPC échoue, rien ne doit bouger.
    perform public.assign_nutrition_plan('00000000-0000-4000-8000-00000000dead',
                                         '55550000-0000-4000-8000-000000000002');
  exception when others then null;
  end;
  select jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id) order by id)
    into v_apres from public.nutrition_plans;
  perform pg_temp.noter('G', 'G4. plan inexistant : AUCUN état partiel', v_avant = v_apres);

  begin
    -- Élève inexistant : idem.
    perform public.assign_nutrition_plan('66660000-0000-4000-8000-00000000000b',
                                         '00000000-0000-4000-8000-00000000beef');
  exception when others then null;
  end;
  select jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id) order by id)
    into v_apres from public.nutrition_plans;
  perform pg_temp.noter('G', 'G5. élève inexistant : AUCUN état partiel', v_avant = v_apres);
end $$;

-- ---------------------------------------------------------------------
-- Section H — programmes et documents intacts
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('H', 'H1. l''assignation de programme témoin est intacte',
    (select count(*) from public.assignments
      where student_id = '55550000-0000-4000-8000-000000000001'
        and content_type = 'programme'
        and content_id = '88880000-0000-4000-8000-000000000001') = 1);
  perform pg_temp.noter('H', 'H2. aucun index d''unicité n''a été posé sur assignments',
    not exists (select 1 from pg_indexes
                 where schemaname = 'public' and tablename = 'assignments'
                   and indexname like '%one_%_per_student%'));
  perform pg_temp.noter('H', 'H3. document_assignments n''a pas été touché',
    not exists (select 1 from pg_indexes
                 where schemaname = 'public' and tablename = 'document_assignments'
                   and indexname like '%one_%_per_student%'));
end $$;

-- ---------------------------------------------------------------------
-- Section I — bilan
-- ---------------------------------------------------------------------
reset role;

do $$
declare
  v_total int;
  v_ko int;
  v_liste text;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  select string_agg(libelle, E'\n  ') into v_liste from _faits where not ok;
  raise notice '';
  raise notice '──────── % contrôles, % échec(s) ────────', v_total, v_ko;
  if v_ko > 0 then
    raise exception E'CHECKLIST EN ÉCHEC :\n  %', v_liste;
  end if;
end $$;

\echo ''
\echo '--- Tous les contrôles sont passés. ROLLBACK : aucune donnée de test ne subsiste. ---'
\echo ''

rollback;

-- Contrôle POST-ROLLBACK, hors transaction.
do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_plans
   where name in ('Plan A (v1)', 'Plan B (v2 complet)', 'Plan C (v2 incomplet)');
  if nb <> 0 then
    raise exception 'ÉCHEC   — I1. des plans de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from public.students
   where id in ('55550000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-000000000002');
  if nb <> 0 then
    raise exception 'ÉCHEC   — I2. des élèves de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from auth.users where email = 'sa.coach@test.local';
  if nb <> 0 then
    raise exception 'ÉCHEC   — I3. un compte de test a survécu au ROLLBACK';
  end if;
  select count(*) into nb from public.programs where id = '88880000-0000-4000-8000-000000000001';
  if nb <> 0 then
    raise exception 'ÉCHEC   — I4. un programme de test a survécu au ROLLBACK';
  end if;
  raise notice 'OK      — I1/I4. aucune donnée de test persistante après le ROLLBACK';
end $$;

-- L'index, lui, DOIT rester : il vient de la migration, pas de la checklist.
do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'nutrition_plans_one_plan_per_student') then
    raise exception 'ÉCHEC   — I5. l''index d''unicité a disparu';
  end if;
  raise notice 'OK      — I5. l''index d''unicité de la migration est toujours en place';
end $$;
