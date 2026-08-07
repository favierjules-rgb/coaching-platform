-- ============================================================================
-- Checklist PostgreSQL — MATRICE DE SÉCURITÉ INTER-ÉLÈVES (PR E.1, §12 à §21)
--
-- LA QUESTION POSÉE, ET LA SEULE
--   « L'élève A peut-il LIRE ou MODIFIER une donnée privée de l'élève B,
--     même en connaissant son UUID exact ? »
--
-- COMMENT ELLE EST POSÉE
--   Pas en lisant des policies : en EXÉCUTANT des requêtes sous le rôle
--   `authenticated`, avec les claims JWT de quatre comptes distincts —
--   Coach A, Élève A, Coach B, Élève B — plus un administrateur et `anon`.
--   Chaque identifiant utilisé dans une tentative est l'identifiant RÉEL de
--   la ressource visée : c'est exactement ce que ferait quelqu'un qui aurait
--   relevé un UUID dans une URL.
--
-- CE QUE LA CHECKLIST VÉRIFIE AUSSI, ET QUI COMPTE AUTANT
--   Que les lectures LÉGITIMES fonctionnent. Une matrice où tout est refusé
--   serait « sûre » et parfaitement inutile ; chaque refus est donc encadré
--   par l'autorisation symétrique qui, elle, doit passer.
--
-- SECTIONS
--   A. le décor : deux coachs, deux élèves, deux jeux de données complets ;
--   B. lectures LÉGITIMES — la base de comparaison ;
--   C. IDOR en LECTURE : l'élève A vise chaque table de B par UUID exact ;
--   D. IDOR en ÉCRITURE : update, delete, insert sur les données de B ;
--   E. CLÉS ÉTRANGÈRES FORGÉES : rattacher sa propre ligne à un parent de B ;
--   F. RPC : chaque fonction appelable, avec les identifiants de B ;
--   G. cloisonnement COACH ↔ COACH ;
--   H. administrateur : selon les règles réelles du dépôt ;
--   I. anon : rien, nulle part ;
--   J. colonnes sensibles et fonctions SECURITY DEFINER ;
--   K. rien ne survit au ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_security_matrix_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

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
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

create or replace function pg_temp.refuse(p_appel text)
returns boolean language plpgsql as $$
declare v jsonb;
begin
  execute 'select (' || p_appel || ')::jsonb' into v;
  -- Un retour structuré : le refus est explicite.
  return coalesce((v->>'ok')::boolean, false) is not true;
exception
  -- Un `raise exception` (NOT_AUTHORIZED, 42501…) est un refus tout aussi
  -- valable : ce qui compte est qu'aucune écriture n'ait eu lieu.
  when others then return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. LE DÉCOR — deux mondes complets et volontairement symétriques
-- ════════════════════════════════════════════════════════════════════════════
-- Symétriques pour que le test soit honnête : si l'élève A ne voit rien de B,
-- l'élève B ne doit rien voir de A. Un cloisonnement qui ne marcherait que
-- dans un sens serait invisible avec un seul élève.

insert into auth.users (id, email) values
  ('5ec00000-0000-4000-8000-0000000000a1'::uuid, 'sec.coachA@test.local'),
  ('5ec00000-0000-4000-8000-0000000000a2'::uuid, 'sec.eleveA@test.local'),
  ('5ec00000-0000-4000-8000-0000000000b1'::uuid, 'sec.coachB@test.local'),
  ('5ec00000-0000-4000-8000-0000000000b2'::uuid, 'sec.eleveB@test.local'),
  ('5ec00000-0000-4000-8000-0000000000d0'::uuid, 'sec.admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('5ec00000-0000-4000-8000-0000000000a1'::uuid, 'coach',   'CoachA', 'S', 'sec.coachA@test.local'),
  ('5ec00000-0000-4000-8000-0000000000a2'::uuid, 'student', 'EleveA', 'S', 'sec.eleveA@test.local'),
  ('5ec00000-0000-4000-8000-0000000000b1'::uuid, 'coach',   'CoachB', 'S', 'sec.coachB@test.local'),
  ('5ec00000-0000-4000-8000-0000000000b2'::uuid, 'student', 'EleveB', 'S', 'sec.eleveB@test.local'),
  ('5ec00000-0000-4000-8000-0000000000d0'::uuid, 'admin',   'Admin',  'S', 'sec.admin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('c0ac0000-0000-4000-8000-0000000000a1'::uuid, '5ec00000-0000-4000-8000-0000000000a1'::uuid, 'CoachA', 'sec.coachA@test.local'),
  ('c0ac0000-0000-4000-8000-0000000000b1'::uuid, '5ec00000-0000-4000-8000-0000000000b1'::uuid, 'CoachB', 'sec.coachB@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type) values
  ('57000000-0000-4000-8000-0000000000a2'::uuid, '5ec00000-0000-4000-8000-0000000000a2'::uuid, 'EleveA', 'S', 'sec.eleveA@test.local', 'active', 'coaching'),
  ('57000000-0000-4000-8000-0000000000b2'::uuid, '5ec00000-0000-4000-8000-0000000000b2'::uuid, 'EleveB', 'S', 'sec.eleveB@test.local', 'active', 'coaching');

insert into public.student_profiles (student_id, main_goal, sport_level) values
  ('57000000-0000-4000-8000-0000000000a2'::uuid, 'Objectif SECRET de A', 'intermediaire'),
  ('57000000-0000-4000-8000-0000000000b2'::uuid, 'Objectif SECRET de B', 'debutant');

insert into public.weight_entries (id, student_id, weight_kg, recorded_at) values
  ('4e000000-0000-4000-8000-0000000000a2'::uuid, '57000000-0000-4000-8000-0000000000a2'::uuid, 72.5, now()),
  ('4e000000-0000-4000-8000-0000000000b2'::uuid, '57000000-0000-4000-8000-0000000000b2'::uuid, 91.2, now());

-- Les plans : ASSIGNÉS et ACTIFS, sinon la RLS les cache pour une autre
-- raison que celle qu'on teste, et le test ne prouverait rien.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version, student_id, coach_id) values
  ('91a00000-0000-4000-8000-0000000000a2'::uuid, 'Plan de A', 'maintien', 'actif',
   '{"calories":2200,"protein":160,"carbs":220,"fat":70}'::jsonb, 2,
   '57000000-0000-4000-8000-0000000000a2'::uuid, 'c0ac0000-0000-4000-8000-0000000000a1'::uuid),
  ('91a00000-0000-4000-8000-0000000000b2'::uuid, 'Plan de B', 'perte-de-poids', 'actif',
   '{"calories":1800,"protein":150,"carbs":150,"fat":55}'::jsonb, 2,
   '57000000-0000-4000-8000-0000000000b2'::uuid, 'c0ac0000-0000-4000-8000-0000000000b1'::uuid);

insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('40000000-0000-4000-8000-0000000000a2'::uuid, '91a00000-0000-4000-8000-0000000000a2'::uuid, 'entrainement', 2400, 3000, 4500, 2500),
  ('40000000-0000-4000-8000-0000000000b2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid, 'entrainement', 2000, 3500, 4000, 2500);

insert into public.nutrition_meal_slot_targets (id, profile_id, slot, enabled, protein_bp, carb_bp, fat_bp) values
  ('50000000-0000-4000-8000-0000000000a2'::uuid, '40000000-0000-4000-8000-0000000000a2'::uuid, 'breakfast', true, 2500, 2500, 2500),
  ('50000000-0000-4000-8000-0000000000b2'::uuid, '40000000-0000-4000-8000-0000000000b2'::uuid, 'breakfast', true, 2500, 2500, 2500);

insert into public.nutrition_days (id, plan_id, day, status, profile_key) values
  ('da000000-0000-4000-8000-0000000000a2'::uuid, '91a00000-0000-4000-8000-0000000000a2'::uuid, 'monday', 'non-commence', 'entrainement'),
  ('da000000-0000-4000-8000-0000000000b2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid, 'monday', 'non-commence', 'entrainement');

insert into public.meals (id, nutrition_day_id, slot, name, items) values
  ('3ea00000-0000-4000-8000-0000000000a2'::uuid, 'da000000-0000-4000-8000-0000000000a2'::uuid, 'breakfast', 'Repas SECRET de A', '[]'::jsonb),
  ('3ea00000-0000-4000-8000-0000000000b2'::uuid, 'da000000-0000-4000-8000-0000000000b2'::uuid, 'breakfast', 'Repas SECRET de B', '[]'::jsonb);


insert into public.nutrition_daily_logs (id, student_id, nutrition_plan_id, log_date, calories) values
  ('106a0000-0000-4000-8000-0000000000a2'::uuid, '57000000-0000-4000-8000-0000000000a2'::uuid, '91a00000-0000-4000-8000-0000000000a2'::uuid, current_date, 2100),
  ('106a0000-0000-4000-8000-0000000000b2'::uuid, '57000000-0000-4000-8000-0000000000b2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid, current_date, 1750);

insert into public.nutrition_recipes (id, coach_id, name, status) values
  ('4ec00000-0000-4000-8000-0000000000a1'::uuid, 'c0ac0000-0000-4000-8000-0000000000a1'::uuid, 'Recette de CoachA', 'active'),
  ('4ec00000-0000-4000-8000-0000000000b1'::uuid, 'c0ac0000-0000-4000-8000-0000000000b1'::uuid, 'Recette de CoachB', 'active');

insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams) values
  ('19000000-0000-4000-8000-0000000000a1'::uuid, '4ec00000-0000-4000-8000-0000000000a1'::uuid, 1, 'Poulet A', 'protein', 25, 0, 1, 140),
  ('19000000-0000-4000-8000-0000000000b1'::uuid, '4ec00000-0000-4000-8000-0000000000b1'::uuid, 1, 'Poulet B', 'protein', 25, 0, 1, 140);

insert into public.nutrition_recipe_tags (recipe_id, kind, value) values
  ('4ec00000-0000-4000-8000-0000000000a1'::uuid, 'diet', 'halal'),
  ('4ec00000-0000-4000-8000-0000000000b1'::uuid, 'diet', 'vegan');

-- ════════════════════════════════════════════════════════════════════════════
-- B. LES LECTURES LÉGITIMES — la base de comparaison
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  perform pg_temp.noter('B', 'B0. current_student_id() rend bien la fiche de l''élève A',
    public.current_student_id() = '57000000-0000-4000-8000-0000000000a2'::uuid);

  select count(*) into v_n from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B1. l''élève A LIT son plan', v_n = 1);

  select count(*) into v_n from public.nutrition_days where id = 'da000000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B2. il lit ses journées', v_n = 1);

  select count(*) into v_n from public.meals where id = '3ea00000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B3. il lit ses repas', v_n = 1);

  select count(*) into v_n from public.nutrition_plan_profiles where id = '40000000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B4. il lit les profils de son plan', v_n = 1);

  select count(*) into v_n from public.nutrition_meal_slot_targets where id = '50000000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B5. il lit les cibles de créneau de son plan', v_n = 1);

  select count(*) into v_n from public.nutrition_daily_logs where id = '106a0000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B6. il lit son suivi quotidien', v_n = 1);

  select count(*) into v_n from public.nutrition_recipes where id = '4ec00000-0000-4000-8000-0000000000a1'::uuid;
  perform pg_temp.noter('B', 'B7. il lit les recettes ACTIVES de SON coach', v_n = 1);

  select count(*) into v_n from public.nutrition_recipe_ingredients where recipe_id = '4ec00000-0000-4000-8000-0000000000a1'::uuid;
  perform pg_temp.noter('B', 'B8. et leurs ingrédients', v_n = 1);

  select count(*) into v_n from public.student_profiles where student_id = '57000000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B9. il lit sa propre fiche de profil', v_n = 1);
  reset role;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. IDOR EN LECTURE — l'élève A vise B par UUID EXACT
-- ════════════════════════════════════════════════════════════════════════════
-- Chaque requête porte l'identifiant réel de la ressource de B. Le résultat
-- attendu est toujours le même : ZÉRO ligne. Pas une erreur, pas un refus
-- bavard — l'invisibilité.
do $$
declare
  v_cibles text[][] := array[
    array['nutrition_plans',              'id',         '91a00000-0000-4000-8000-0000000000b2', 'le plan de B'],
    array['nutrition_days',               'id',         'da000000-0000-4000-8000-0000000000b2', 'la journée de B'],
    array['meals',                        'id',         '3ea00000-0000-4000-8000-0000000000b2', 'le repas de B'],
    array['nutrition_plan_profiles',      'id',         '40000000-0000-4000-8000-0000000000b2', 'le profil de plan de B'],
    array['nutrition_meal_slot_targets',  'id',         '50000000-0000-4000-8000-0000000000b2', 'la cible de créneau de B'],
    array['nutrition_daily_logs',         'id',         '106a0000-0000-4000-8000-0000000000b2', 'le suivi quotidien de B'],
    array['students',                     'id',         '57000000-0000-4000-8000-0000000000b2', 'la fiche élève de B'],
    array['student_profiles',             'student_id', '57000000-0000-4000-8000-0000000000b2', 'le profil détaillé de B'],
    array['weight_entries',               'student_id', '57000000-0000-4000-8000-0000000000b2', 'les pesées de B'],
    array['nutrition_recipes',            'id',         '4ec00000-0000-4000-8000-0000000000b1', 'la recette du coach de B'],
    array['nutrition_recipe_ingredients', 'recipe_id',  '4ec00000-0000-4000-8000-0000000000b1', 'les ingrédients de cette recette'],
    array['nutrition_recipe_tags',        'recipe_id',  '4ec00000-0000-4000-8000-0000000000b1', 'ses étiquettes']
  ];
  i int;
  v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  for i in 1 .. array_length(v_cibles, 1) loop
    execute format('select count(*) from public.%I where %I = %L',
                   v_cibles[i][1], v_cibles[i][2], v_cibles[i][3]) into v_n;
    perform pg_temp.noter('C',
      format('C%s. l''élève A ne voit PAS %s (%s)', i, v_cibles[i][4], v_cibles[i][1]),
      v_n = 0);
  end loop;
  reset role;
end $$;

-- C13 : et la symétrie. Un cloisonnement à sens unique n'en est pas un.
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
  select count(*) into v_n from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C13. et réciproquement : l''élève B ne voit pas le plan de A', v_n = 0);
  select count(*) into v_n from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('C', 'C14. mais il voit bien le sien', v_n = 1);
  reset role;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. IDOR EN ÉCRITURE — modifier ou supprimer ce qui appartient à B
-- ════════════════════════════════════════════════════════════════════════════
-- Sous RLS, un UPDATE ou un DELETE sur une ligne invisible ne LÈVE PAS : il
-- touche zéro ligne. C'est ce qu'on mesure, et on revérifie ensuite que la
-- donnée de B est intacte — un test qui ne compterait que les lignes
-- affectées ne verrait pas une écriture partielle.
do $$
declare v_n int; v_intact boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  with m as (update public.nutrition_plans set name = 'PIRATÉ'
              where id = '91a00000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D1. il ne peut pas MODIFIER le plan de B', v_n = 0);

  with m as (delete from public.nutrition_plans
              where id = '91a00000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D2. ni le SUPPRIMER', v_n = 0);

  with m as (update public.nutrition_daily_logs set calories = 99999
              where id = '106a0000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D3. ni modifier le suivi quotidien de B', v_n = 0);

  with m as (delete from public.nutrition_daily_logs
              where id = '106a0000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D4. ni le supprimer', v_n = 0);

  with m as (update public.meals set name = 'PIRATÉ'
              where id = '3ea00000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D5. ni les repas de B', v_n = 0);

  with m as (update public.nutrition_days set status = 'valide'
              where id = 'da000000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D6. ni les journées de B', v_n = 0);

  with m as (update public.student_profiles set main_goal = 'PIRATÉ'
              where student_id = '57000000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D7. ni le profil de B', v_n = 0);

  with m as (update public.students set email = 'pirate@test.local'
              where id = '57000000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D8. ni la fiche élève de B', v_n = 0);

  with m as (update public.weight_entries set weight_kg = 1
              where student_id = '57000000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('D', 'D9. ni ses pesées', v_n = 0);
  reset role;

  -- Et LES DONNÉES DE B SONT INTACTES, vérifié hors RLS.
  select (select name from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000b2'::uuid) = 'Plan de B'
     and (select calories from public.nutrition_daily_logs where id = '106a0000-0000-4000-8000-0000000000b2'::uuid) = 1750
     and (select name from public.meals where id = '3ea00000-0000-4000-8000-0000000000b2'::uuid) = 'Repas SECRET de B'
     and (select main_goal from public.student_profiles where student_id = '57000000-0000-4000-8000-0000000000b2'::uuid) = 'Objectif SECRET de B'
     and (select weight_kg from public.weight_entries where student_id = '57000000-0000-4000-8000-0000000000b2'::uuid) = 91.2
    into v_intact;
  perform pg_temp.noter('D', 'D10. après toutes ces tentatives, les données de B sont INTACTES', v_intact);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. CLÉS ÉTRANGÈRES FORGÉES — le contournement le plus subtil
-- ════════════════════════════════════════════════════════════════════════════
-- Une FK n'est PAS un contrôle d'accès : rien n'empêche `insert` de désigner
-- un parent qu'on n'a pas le droit de lire. La protection doit venir du
-- `with check` de la policy. On l'éprouve ligne par ligne.
do $$
declare v_ok boolean; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  -- E1. Un suivi quotidien AU NOM DE B.
  begin
    insert into public.nutrition_daily_logs (student_id, nutrition_plan_id, log_date, calories)
    values ('57000000-0000-4000-8000-0000000000b2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid,
            current_date - 1, 1234);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E1. il ne peut pas créer un suivi AU NOM de B', v_ok);

  -- E2. Un suivi à SON nom, mais rattaché au PLAN de B. La colonne
  --     `nutrition_plan_id` n'est pas couverte par le `with check`, qui ne
  --     porte que sur `student_id` : on vérifie ce que ça donne réellement.
  begin
    insert into public.nutrition_daily_logs (student_id, nutrition_plan_id, log_date, calories)
    values ('57000000-0000-4000-8000-0000000000a2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid,
            current_date - 2, 1234);
    v_ok := true;
  exception when insufficient_privilege then v_ok := false;
  end;
  -- Quel que soit le verdict, la ligne reste PRIVÉE : elle porte son
  -- student_id, donc B ne la verra jamais, et elle ne révèle rien du plan de
  -- B — un identifiant que l'élève A possédait déjà pour tenter l'insertion.
  perform pg_temp.noter('E',
    format('E2. un suivi rattaché au plan de B : %s — sans fuite dans les deux cas',
           case when v_ok then 'accepté (ligne privée à A)' else 'refusé' end),
    true);
  if v_ok then
    select count(*) into v_n from public.nutrition_daily_logs
     where nutrition_plan_id = '91a00000-0000-4000-8000-0000000000b2'::uuid
       and student_id = '57000000-0000-4000-8000-0000000000a2'::uuid;
    perform pg_temp.noter('E', 'E2 bis. et cette ligne appartient bien à A, pas à B', v_n = 1);
  end if;

  -- E3. Une journée rattachée au plan de B.
  begin
    insert into public.nutrition_days (plan_id, day, status)
    values ('91a00000-0000-4000-8000-0000000000b2'::uuid, 'tuesday', 'non-commence');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E3. il ne peut pas ajouter une journée au plan de B', v_ok);

  -- E4. Un repas dans la journée de B.
  begin
    insert into public.meals (nutrition_day_id, slot, name, items)
    values ('da000000-0000-4000-8000-0000000000b2'::uuid, 'lunch', 'INTRUS', '[]'::jsonb);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E4. ni un repas dans la journée de B', v_ok);

  -- E5. DÉPLACER sa propre journée vers le plan de B.
  --
  -- CE QU'ON MESURE ICI N'EST PAS LE NOMBRE DE LIGNES TOUCHÉES. L'UPDATE
  -- rapporte bien « 1 ligne », et pourtant `plan_id` ne bouge pas : le
  -- trigger `protect_nutrition_days_coach_columns()` (migration
  -- 20260810090000) réécrit NEW.plan_id avec OLD.plan_id pour tout appelant
  -- qui n'est pas staff. La ligne présentée au WITH CHECK est donc
  -- inchangée, la policy l'accepte, et le déplacement n'a pas lieu.
  --
  -- Un test qui compterait les lignes affectées annoncerait une faille
  -- inexistante ; un test qui ne regarderait que l'absence d'erreur en
  -- manquerait une vraie. On vérifie donc LA VALEUR, seule preuve utile.
  with m as (update public.nutrition_days set plan_id = '91a00000-0000-4000-8000-0000000000b2'::uuid
              where id = 'da000000-0000-4000-8000-0000000000a2'::uuid returning 1)
  select count(*) into v_n from m;
  reset role;
  perform pg_temp.noter('E', 'E5. sa journée reste attachée à SON plan, malgré la tentative', (
    select plan_id from public.nutrition_days where id = 'da000000-0000-4000-8000-0000000000a2'::uuid)
    = '91a00000-0000-4000-8000-0000000000a2'::uuid);
  perform pg_temp.noter('E', 'E5 bis. et la protection vient d''un TRIGGER, pas d''une policy — vérifié', exists (
    select 1 from pg_trigger t join pg_proc pr on pr.oid = t.tgfoid
     where t.tgrelid = 'public.nutrition_days'::regclass
       and pr.proname = 'protect_nutrition_days_coach_columns'));
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  -- E6. S'attribuer le plan de B en changeant `student_id`.
  with m as (update public.nutrition_plans set student_id = '57000000-0000-4000-8000-0000000000a2'::uuid
              where id = '91a00000-0000-4000-8000-0000000000b2'::uuid returning 1)
  select count(*) into v_n from m;
  reset role;
  perform pg_temp.noter('E', 'E6. le plan de B reste à B', (
    select student_id from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000b2'::uuid)
    = '57000000-0000-4000-8000-0000000000b2'::uuid);
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  -- E7. Se créer un plan de toutes pièces.
  begin
    insert into public.nutrition_plans (name, goal_type, status, daily_target, nutrition_model_version, student_id)
    values ('Plan que je m''offre', 'maintien', 'actif', '{"calories":9999}'::jsonb, 2,
            '57000000-0000-4000-8000-0000000000a2'::uuid);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E7. un élève ne peut pas se créer un plan', v_ok);

  -- E8. Se rattacher au coach de B pour voir ses recettes.
  with m as (update public.nutrition_plans set coach_id = 'c0ac0000-0000-4000-8000-0000000000b1'::uuid
              where id = '91a00000-0000-4000-8000-0000000000a2'::uuid returning 1)
  select count(*) into v_n from m;
  reset role;
  perform pg_temp.noter('E', 'E8. son plan reste rattaché à SON coach — sinon il verrait le catalogue de B', (
    select coach_id from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000a2'::uuid)
    = 'c0ac0000-0000-4000-8000-0000000000a1'::uuid);
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
  reset role;

  -- E9. Le catalogue du coach B reste invisible pour l'élève A.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
  select count(*) into v_n from public.nutrition_recipes where coach_id = 'c0ac0000-0000-4000-8000-0000000000b1'::uuid;
  perform pg_temp.noter('E', 'E9. et le catalogue du coach de B lui reste invisible', v_n = 0);
  reset role;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F. LES RPC — appelées avec les identifiants de B
-- ════════════════════════════════════════════════════════════════════════════
-- Une RPC est une porte de plus. Chacune est appelée par l'élève A avec les
-- identifiants de B : aucune ne doit devenir un contournement.
do $$
declare v_texte text; v_ok boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  perform pg_temp.noter('F', 'F1. assign_nutrition_plan refuse un élève', pg_temp.refuse(
    $q$public.assign_nutrition_plan('91a00000-0000-4000-8000-0000000000b2'::uuid, '57000000-0000-4000-8000-0000000000a2'::uuid)$q$));

  perform pg_temp.noter('F', 'F2. unassign_nutrition_plan refuse un élève', pg_temp.refuse(
    $q$public.unassign_nutrition_plan('91a00000-0000-4000-8000-0000000000b2'::uuid)$q$));

  perform pg_temp.noter('F', 'F3. delete_nutrition_plan refuse un élève', pg_temp.refuse(
    $q$public.delete_nutrition_plan('91a00000-0000-4000-8000-0000000000b2'::uuid)$q$));

  perform pg_temp.noter('F', 'F4. delete_nutrition_recipe refuse un élève', pg_temp.refuse(
    $q$public.delete_nutrition_recipe('4ec00000-0000-4000-8000-0000000000b1'::uuid)$q$));

  perform pg_temp.noter('F', 'F5. duplicate_nutrition_recipe refuse un élève', pg_temp.refuse(
    $q$public.duplicate_nutrition_recipe('4ec00000-0000-4000-8000-0000000000b1'::uuid)$q$));

  perform pg_temp.noter('F', 'F6. set_nutrition_recipe_image refuse un élève', pg_temp.refuse(
    $q$public.set_nutrition_recipe_image('4ec00000-0000-4000-8000-0000000000b1'::uuid, null)$q$));

  perform pg_temp.noter('F', 'F7. save_nutrition_recipe refuse un élève', pg_temp.refuse(
    $q$public.save_nutrition_recipe(jsonb_build_object('recipe', jsonb_build_object('name', 'Recette forgée', 'status', 'draft'), 'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb))$q$));

  perform pg_temp.noter('F', 'F8. import_nutrition_recipes refuse un élève', pg_temp.refuse(
    $q$public.import_nutrition_recipes(jsonb_build_object('recipes', jsonb_build_array(jsonb_build_object('name', 'Import forgé', 'ingredients', jsonb_build_array(jsonb_build_object('position', 1, 'name', 'X', 'role', 'protein', 'protein_per_100g', 20, 'carb_per_100g', 0, 'fat_per_100g', 1, 'reference_grams', 100))))))$q$));

  -- F9. L'aperçu du cycle de vie ne doit rien révéler.
  begin
    v_ok := (public.nutrition_lifecycle_overview() is null);
  exception when others then v_ok := true;
  end;
  perform pg_temp.noter('F', 'F9. nutrition_lifecycle_overview ne rend rien à un élève', v_ok);

  -- F10/F11. Les fonctions de diagnostic prennent un uuid : elles ne doivent
  -- pas servir d'oracle sur l'existence des ressources d'autrui.
  begin
    v_texte := public.nutrition_plan_deletion_block('91a00000-0000-4000-8000-0000000000b2'::uuid);
  exception when others then v_texte := 'not_found';
  end;
  perform pg_temp.noter('F', 'F10. nutrition_plan_deletion_block ne renseigne pas sur le plan de B',
    v_texte is null or v_texte = 'not_found' or v_texte = 'plan_not_found');

  begin
    v_texte := public.nutrition_recipe_blocking_issue('4ec00000-0000-4000-8000-0000000000b1'::uuid);
  exception when others then v_texte := 'recipe_not_found';
  end;
  perform pg_temp.noter('F', 'F11. nutrition_recipe_blocking_issue ne renseigne pas sur la recette de B',
    v_texte = 'recipe_not_found');

  -- F12. `provision_program_copy` est SECURITY DEFINER : la plus sensible du
  -- schéma, puisqu'elle s'exécute avec les droits de son propriétaire.
  begin
    perform public.provision_program_copy(
      '4ec00000-0000-4000-8000-0000000000b1'::uuid, '57000000-0000-4000-8000-0000000000b2'::uuid);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pg_temp.noter('F', 'F12. provision_program_copy refuse un élève (SECURITY DEFINER)', v_ok);

  -- F13. Et rien n'a été écrit : le catalogue de B est intact.
  reset role;
  perform pg_temp.noter('F', 'F13. après les treize tentatives, rien n''a été créé ni supprimé', (
    select count(*) = 2 from public.nutrition_recipes
     where id in ('4ec00000-0000-4000-8000-0000000000a1'::uuid, '4ec00000-0000-4000-8000-0000000000b1'::uuid))
    and (select count(*) = 2 from public.nutrition_plans
          where id in ('91a00000-0000-4000-8000-0000000000a2'::uuid, '91a00000-0000-4000-8000-0000000000b2'::uuid)));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- G. COACH ↔ COACH
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_recipes where id = '4ec00000-0000-4000-8000-0000000000a1'::uuid;
  perform pg_temp.noter('G', 'G1. le coach A voit SA recette', v_n = 1);

  select count(*) into v_n from public.nutrition_recipes where id = '4ec00000-0000-4000-8000-0000000000b1'::uuid;
  perform pg_temp.noter('G', 'G2. il ne voit PAS celle du coach B', v_n = 0);

  with m as (update public.nutrition_recipes set name = 'PIRATÉ'
              where id = '4ec00000-0000-4000-8000-0000000000b1'::uuid returning 1)
  select count(*) into v_n from m;
  perform pg_temp.noter('G', 'G3. ni ne peut la modifier', v_n = 0);

  v := public.duplicate_nutrition_recipe('4ec00000-0000-4000-8000-0000000000b1'::uuid);
  perform pg_temp.noter('G', 'G4. ni la dupliquer dans son catalogue', v->>'reason' = 'not_found');

  v := public.set_nutrition_recipe_image('4ec00000-0000-4000-8000-0000000000b1'::uuid, null);
  perform pg_temp.noter('G', 'G5. ni lui poser une photo', v->>'reason' = 'not_found');

  -- G6. Les données des élèves de l'AUTRE coach. La règle métier du dépôt
  --     est que le staff voit les élèves ; on l'écrit telle qu'elle est, sans
  --     prétendre à un cloisonnement qui n'existe pas.
  select count(*) into v_n from public.nutrition_plans where id = '91a00000-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('G',
    format('G6. plan d''un élève d''un autre coach visible par le coach A : %s (règle staff du dépôt)',
           case when v_n > 0 then 'oui' else 'non' end),
    true);
  reset role;

  -- G7. LE CONSTAT, ÉCRIT NOIR SUR BLANC. Le cloisonnement entre coachs
  -- n'existe QUE sur le catalogue de recettes (migration 20260813090000).
  -- Partout ailleurs, les policies de gestion disent `is_coach_or_admin()`,
  -- qui ne distingue pas deux coachs. Ce n'est pas une régression de la
  -- PR E.1 : c'est l'état du dépôt, et il est sans effet sur l'isolation
  -- INTER-ÉLÈVES, qui est l'objet de cette checklist.
  --
  -- La colonne qui permettrait de le corriger EXISTE déjà (`students.coach_id`)
  -- mais aucune policy ne s'en sert. Ce contrôle le vérifie pour que le jour
  -- où quelqu'un s'y attelle, la checklist le lui dise.
  perform pg_temp.noter('G', 'G7. students.coach_id existe — le lien de propriété est disponible', exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students' and column_name = 'coach_id'));

  perform pg_temp.noter('G',
    format('G8. nombre de policies « gestion » qui reposent sur is_coach_or_admin() seul : %s — à traiter dans un chantier dédié',
      (select count(*) from pg_policies
        where schemaname = 'public'
          and coalesce(qual, '') like '%is_coach_or_admin()%'
          and coalesce(qual, '') not like '%current_coach_id()%'
          and coalesce(qual, '') not like '%current_student_id()%')),
    true);

  -- G9. En revanche, le catalogue de recettes EST cloisonné : c'est la
  -- preuve que le cloisonnement par coach est possible dans ce schéma.
  perform pg_temp.noter('G', 'G9. les recettes, elles, sont cloisonnées par coach', exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'nutrition_recipes'
       and policyname = 'nutrition_recipes_manage_own_coach'
       and qual like '%current_coach_id()%'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- H. ADMINISTRATEUR
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"5ec00000-0000-4000-8000-0000000000d0","role":"authenticated"}', true);

  perform pg_temp.noter('H', 'H1. is_admin() reconnaît le compte', public.is_admin());

  select count(*) into v_n from public.nutrition_recipes
   where id in ('4ec00000-0000-4000-8000-0000000000a1'::uuid, '4ec00000-0000-4000-8000-0000000000b1'::uuid);
  perform pg_temp.noter('H', 'H2. l''administrateur voit les deux catalogues (règle 20260813090000)', v_n = 2);

  -- H3. Mais SANS fiche `coaches`, il ne peut pas poser de photo : le chemin
  --     Storage exige un coach propriétaire, et la policy le vérifie.
  perform pg_temp.noter('H', 'H3. il n''a pas de fiche coach, donc current_coach_id() est NULL',
    public.current_coach_id() is null);
  reset role;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- I. ANON
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_total int := 0;
declare t text;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  foreach t in array array['nutrition_plans','nutrition_days','meals','nutrition_daily_logs',
                           'nutrition_plan_profiles','nutrition_meal_slot_targets',
                           'nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags'] loop
    begin
      execute format('select count(*) from public.%I', t) into v_n;
    exception when insufficient_privilege then v_n := 0;
    end;
    v_total := v_total + v_n;
  end loop;
  perform pg_temp.noter('I', 'I1. anon ne lit AUCUNE ligne des neuf tables nutrition', v_total = 0);

  perform pg_temp.noter('I', 'I2. anon ne peut exécuter aucune RPC nutrition',
    not has_function_privilege('anon', 'public.save_nutrition_recipe(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.delete_nutrition_plan(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.duplicate_nutrition_recipe(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.set_nutrition_recipe_image(uuid,text)', 'execute'));
  reset role;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- J. PRIVILÈGES DE TABLE ET FONCTIONS SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text; v_manque text := '';
begin
  -- J1. Aucune table nutrition ne laisse TRUNCATE à `authenticated` : une
  --     seule commande viderait la table pour tout le monde, RLS comprise.
  foreach t in array array['nutrition_plans','nutrition_days','meals','nutrition_daily_logs',
                           'nutrition_plan_profiles','nutrition_meal_slot_targets',
                           'nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      v_manque := v_manque || ' ' || t;
    end if;
  end loop;
  perform pg_temp.noter('J', 'J1. aucun TRUNCATE pour authenticated sur les tables nutrition', v_manque = '');

  -- J2. Et `anon` n'a rien du tout.
  v_manque := '';
  foreach t in array array['nutrition_plans','nutrition_days','meals','nutrition_daily_logs',
                           'nutrition_plan_profiles','nutrition_meal_slot_targets',
                           'nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      v_manque := v_manque || ' ' || t;
    end if;
  end loop;
  perform pg_temp.noter('J', 'J2. anon n''a aucun SELECT sur les tables nutrition', v_manque = '');

  -- J3. La RLS est activée partout où elle doit l'être.
  v_manque := '';
  foreach t in array array['nutrition_plans','nutrition_days','meals','nutrition_daily_logs',
                           'nutrition_plan_profiles','nutrition_meal_slot_targets',
                           'nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags',
                           'students','student_profiles','weight_entries'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      v_manque := v_manque || ' ' || t;
    end if;
  end loop;
  perform pg_temp.noter('J', 'J3. RLS activée sur les douze tables sensibles', v_manque = '');

  -- J4. Aucune fonction SECURITY DEFINER du schéma public n'est exécutable
  --     par `authenticated` SANS search_path fixé — c'est la porte d'entrée
  --     classique du détournement par schéma.
  select coalesce(string_agg(p.proname, ', '), '') into v_manque
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and (p.proconfig is null or not exists (
       select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  perform pg_temp.noter('J',
    format('J4. toute fonction SECURITY DEFINER exécutable par authenticated fixe son search_path%s',
           case when v_manque = '' then '' else ' — manquant : ' || v_manque end),
    v_manque = '');
end $$;

reset role;

-- ---------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_ko int; v_liste text;
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
\echo '--- Matrice complète : aucun accès inter-élèves. ROLLBACK. ---'
\echo ''

rollback;

do $$
declare nb int;
begin
  select count(*) into nb from auth.users where email like 'sec.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — K1. des comptes de test ont survécu au ROLLBACK'; end if;
  select count(*) into nb from public.nutrition_plans where name in ('Plan de A', 'Plan de B');
  if nb <> 0 then raise exception 'ÉCHEC — K2. des plans de test ont survécu'; end if;
  raise notice 'OK      — K1/K2. aucune donnée de test après le ROLLBACK';
end $$;
