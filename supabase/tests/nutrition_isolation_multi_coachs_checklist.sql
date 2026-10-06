-- ============================================================================
-- Checklist PostgreSQL — P13-A : ISOLATION DU CŒUR NUTRITION ENTRE COACHS
--
-- LA QUESTION POSÉE, ET LA SEULE
--   « Le coach B peut-il LIRE, CRÉER, MODIFIER ou SUPPRIMER une donnée
--     nutritionnelle d'un élève du coach A — même en connaissant les UUID
--     exacts, même en passant par une table fille, même en réécrivant une
--     clé étrangère ? »
--
-- POURQUOI DEUX COACHS, EXPLICITEMENT
--   La base réelle ne contient AUCUN profil de rôle `coach` (le seul compte
--   coach est l'administrateur lui-même). Un test mené sur cette base
--   passerait donc au vert sans rien prouver : il n'y aurait personne à
--   cloisonner. Cette checklist crée donc DEUX coachs complets, symétriques,
--   et vérifie l'isolation dans LES DEUX SENS. Un cloisonnement qui ne
--   marcherait que de A vers B serait invisible autrement.
--
-- CE QU'ELLE VÉRIFIE AUSSI, ET QUI COMPTE AUTANT
--   Que les accès LÉGITIMES fonctionnent. Une matrice où tout est refusé
--   serait « sûre » et inutile : chaque refus est encadré par l'autorisation
--   symétrique, qui doit passer.
--
-- DIFFÉRENCE AVEC nutrition_security_matrix_checklist.sql
--   Celle-là porte sur l'isolation inter-ÉLÈVES et constate explicitement
--   (contrôles G6 à G9) que le cloisonnement inter-COACHS n'existait pas.
--   Celle-ci teste précisément ce que G6-G9 annonçaient comme « à traiter
--   dans un chantier dédié ». Les deux sont complémentaires ; aucune ne
--   remplace l'autre. Noter que la matrice E.1 insère ses élèves SANS
--   `coach_id` — c'est pour cela qu'elle ne pouvait pas tester ce lien.
--
-- SECTIONS
--   A. le décor : deux coachs, trois élèves (dont un sans coach), six plans ;
--   B. accès LÉGITIMES — la base de comparaison ;
--   C. isolation COACH ↔ COACH en LECTURE, table par table ;
--   D. isolation COACH ↔ COACH en ÉCRITURE (insert / update / delete) ;
--   E. CONTOURNEMENTS : réécriture de student_id, de coach_id, clé forgée ;
--   F. le DELETE direct, qui contournait la RPC ;
--   G. l'élève sans coach, et le plan incohérent ;
--   H. administrateur : accès global conservé ;
--   I. l'élève : ses propres données, et rien de plus ;
--   J. recensement : plus aucune policy du cœur sur is_coach_or_admin() seul ;
--   K. rien ne survit au ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_isolation_multi_coachs_checklist.sql
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

-- Une écriture REFUSÉE PAR LA RLS se manifeste de deux façons, et de deux
-- seulement :
--   * zéro ligne touchée           — le USING a caché la ligne ;
--   * 42501 insufficient_privilege — le WITH CHECK a rejeté la ligne d'arrivée.
--
-- TOUT LE RESTE EST UN ÉCHEC DU CONTRÔLE, et c'est le point important.
-- Une version antérieure de cette fonction terminait par `when others then
-- return true` : elle comptait donc N'IMPORTE QUELLE exception comme un refus.
-- Une violation d'unicité (23505) ou de clé étrangère (23503) passait ainsi
-- pour un succès du cloisonnement — alors qu'elle prouve exactement le
-- contraire : si l'écriture est allée jusqu'à heurter une contrainte, c'est
-- que la RLS L'A LAISSÉE PASSER. Le contrôle devenait vert pour la mauvaise
-- raison, et c'est le pire défaut qu'un test de sécurité puisse avoir.
--
-- Les codes sont donc discriminés explicitement, et tout refus non-RLS est
-- rapporté avec son SQLSTATE pour rester diagnosticable.
create or replace function pg_temp.ecriture_refusee(p_sql text)
returns boolean language plpgsql as $$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return true;   -- USING a caché la ligne : refus RLS.
  end if;
  raise notice 'ECRITURE PASSEE (% ligne(s)) — aucun refus : %', v_n, p_sql;
  return false;
exception
  when insufficient_privilege then
    return true;   -- 42501 : WITH CHECK a rejeté la ligne d'arrivée. Refus RLS.
  when unique_violation then
    raise notice 'REFUS NON-RLS 23505 unique_violation — la RLS a laissé passer l''écriture, c''est la contrainte qui l''a arrêtée : %', p_sql;
    return false;
  when foreign_key_violation then
    raise notice 'REFUS NON-RLS 23503 foreign_key_violation — la RLS a laissé passer l''écriture : %', p_sql;
    return false;
  when others then
    raise notice 'REFUS NON-RLS % (%) — cause inattendue, le contrôle ne prouve rien : %', sqlstate, sqlerrm, p_sql;
    return false;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. LE DÉCOR
-- ════════════════════════════════════════════════════════════════════════════
-- Trois élèves, parce que le troisième — SANS coach — est un cas que la règle
-- doit trancher et que deux élèves ne révéleraient pas.
-- Six plans, dont un plan INCOHÉRENT reproduisant la ligne qui existe
-- réellement en base : coach_id renseigné, mais élève sans coach.

insert into auth.users (id, email) values
  ('13a00000-0000-4000-8000-00000000c0a1'::uuid, 'p13a.coachA@test.local'),
  ('13a00000-0000-4000-8000-00000000c0b1'::uuid, 'p13a.coachB@test.local'),
  ('13a00000-0000-4000-8000-0000000051a2'::uuid, 'p13a.eleveA@test.local'),
  ('13a00000-0000-4000-8000-0000000051a3'::uuid, 'p13a.eleveA2@test.local'),
  ('13a00000-0000-4000-8000-0000000051b2'::uuid, 'p13a.eleveB@test.local'),
  ('13a00000-0000-4000-8000-000000005100'::uuid, 'p13a.eleveSansCoach1@test.local'),
  ('13a00000-0000-4000-8000-000000005200'::uuid, 'p13a.eleveSansCoach2@test.local'),
  ('13a00000-0000-4000-8000-000000005300'::uuid, 'p13a.eleveSansCoach3@test.local'),
  ('13a00000-0000-4000-8000-0000000000d0'::uuid, 'p13a.admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('13a00000-0000-4000-8000-00000000c0a1'::uuid, 'coach',   'P13aCoachA', 'S', 'p13a.coachA@test.local'),
  ('13a00000-0000-4000-8000-00000000c0b1'::uuid, 'coach',   'P13aCoachB', 'S', 'p13a.coachB@test.local'),
  ('13a00000-0000-4000-8000-0000000051a2'::uuid, 'student', 'P13aEleveA', 'S', 'p13a.eleveA@test.local'),
  ('13a00000-0000-4000-8000-0000000051a3'::uuid, 'student', 'P13aEleveA2', 'S', 'p13a.eleveA2@test.local'),
  ('13a00000-0000-4000-8000-0000000051b2'::uuid, 'student', 'P13aEleveB', 'S', 'p13a.eleveB@test.local'),
  ('13a00000-0000-4000-8000-000000005100'::uuid, 'student', 'P13aEleveN1', 'S', 'p13a.eleveSansCoach1@test.local'),
  ('13a00000-0000-4000-8000-000000005200'::uuid, 'student', 'P13aEleveN2', 'S', 'p13a.eleveSansCoach2@test.local'),
  ('13a00000-0000-4000-8000-000000005300'::uuid, 'student', 'P13aEleveN3', 'S', 'p13a.eleveSansCoach3@test.local'),
  ('13a00000-0000-4000-8000-0000000000d0'::uuid, 'admin',   'P13aAdmin',  'S', 'p13a.admin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('13a0c0ac-0000-4000-8000-0000000000a1'::uuid, '13a00000-0000-4000-8000-00000000c0a1'::uuid, 'P13aCoachA', 'p13a.coachA@test.local'),
  ('13a0c0ac-0000-4000-8000-0000000000b1'::uuid, '13a00000-0000-4000-8000-00000000c0b1'::uuid, 'P13aCoachB', 'p13a.coachB@test.local');

-- LE LIEN QUI PORTE TOUT LE CHANTIER : students.coach_id.
insert into public.students (id, user_id, first_name, last_name, email, status, access_type, coach_id) values
  ('13a05700-0000-4000-8000-0000000000a2'::uuid, '13a00000-0000-4000-8000-0000000051a2'::uuid, 'P13aEleveA', 'S', 'p13a.eleveA@test.local', 'active', 'coaching', '13a0c0ac-0000-4000-8000-0000000000a1'::uuid),
  -- UN SECOND ÉLÈVE DU COACH A, VOLONTAIREMENT SANS PLAN. Il sert de cible aux
  -- contrôles où le coach B tente de s'offrir un élève de A en réécrivant
  -- `student_id` (E1). Viser l'élève A lui-même serait un piège : il porte
  -- déjà un plan assigné, et l'écriture pourrait mourir sur l'index unique
  -- `nutrition_plans_one_plan_per_student` AU LIEU d'être refusée par la RLS.
  -- Le contrôle passerait alors au vert sans rien démontrer.
  ('13a05700-0000-4000-8000-0000000000a3'::uuid, '13a00000-0000-4000-8000-0000000051a3'::uuid, 'P13aEleveA2', 'S', 'p13a.eleveA2@test.local', 'active', 'coaching', '13a0c0ac-0000-4000-8000-0000000000a1'::uuid),
  ('13a05700-0000-4000-8000-0000000000b2'::uuid, '13a00000-0000-4000-8000-0000000051b2'::uuid, 'P13aEleveB', 'S', 'p13a.eleveB@test.local', 'active', 'coaching', '13a0c0ac-0000-4000-8000-0000000000b1'::uuid),
  -- TROIS élèves SANS COACH, et non un seul. Aucun ne doit être visible d'un
  -- coach ; ils sont distincts parce que l'invariant
  -- `nutrition_plans_one_plan_per_student` — index unique PARTIEL sur
  -- `(student_id) where student_id is not null`, migration 20260806090000 —
  -- n'autorise QU'UN SEUL plan assigné par élève. Faire porter deux plans au
  -- même élève violait cet invariant et faisait échouer le décor avant tout
  -- contrôle. Un élève par cas, donc :
  --   N1 → porte le plan ORPHELIN (plan sans coach) ;
  --   N2 → porte le plan INCOHÉRENT (plan avec coach_id, élève sans coach) ;
  --   N3 → ne porte AUCUN plan, pour que les contrôles d'appropriation (G6)
  --        ne puissent être refusés que par la RLS, jamais par l'index unique.
  ('13a05700-0000-4000-8000-000000000000'::uuid, '13a00000-0000-4000-8000-000000005100'::uuid, 'P13aEleveN1', 'S', 'p13a.eleveSansCoach1@test.local', 'active', 'coaching', null),
  ('13a05700-0000-4000-8000-000000000002'::uuid, '13a00000-0000-4000-8000-000000005200'::uuid, 'P13aEleveN2', 'S', 'p13a.eleveSansCoach2@test.local', 'active', 'coaching', null),
  ('13a05700-0000-4000-8000-000000000003'::uuid, '13a00000-0000-4000-8000-000000005300'::uuid, 'P13aEleveN3', 'S', 'p13a.eleveSansCoach3@test.local', 'active', 'coaching', null);

insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version, student_id, coach_id) values
  -- Plans affectés, un par coach.
  ('13a09100-0000-4000-8000-0000000000a2'::uuid, 'P13a Plan de A', 'maintien', 'actif',
   '{"calories":2200,"protein":160,"carbs":220,"fat":70}'::jsonb, 2,
   '13a05700-0000-4000-8000-0000000000a2'::uuid, '13a0c0ac-0000-4000-8000-0000000000a1'::uuid),
  ('13a09100-0000-4000-8000-0000000000b2'::uuid, 'P13a Plan de B', 'perte-de-poids', 'actif',
   '{"calories":1800,"protein":150,"carbs":150,"fat":55}'::jsonb, 2,
   '13a05700-0000-4000-8000-0000000000b2'::uuid, '13a0c0ac-0000-4000-8000-0000000000b1'::uuid),
  -- Plans modèles, sans élève : propriété portée par coach_id seul.
  ('13a09100-0000-4000-8000-00000000d0a1'::uuid, 'P13a Modele de A', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2,
   null, '13a0c0ac-0000-4000-8000-0000000000a1'::uuid),
  ('13a09100-0000-4000-8000-00000000d0b1'::uuid, 'P13a Modele de B', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2,
   null, '13a0c0ac-0000-4000-8000-0000000000b1'::uuid),
  -- Plan d'un élève SANS coach.
  ('13a09100-0000-4000-8000-000000000000'::uuid, 'P13a Plan orphelin', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2,
   '13a05700-0000-4000-8000-000000000000'::uuid, null),
  -- LE PLAN INCOHÉRENT : coach_id = A, mais l'élève porté n'a pas de coach.
  -- La règle dit que l'ÉLÈVE tranche : ce plan n'appartient donc à personne.
  -- Il porte l'élève N2, et non N1 : N1 porte déjà le plan orphelin, et
  -- `nutrition_plans_one_plan_per_student` n'autorise qu'un plan par élève.
  ('13a09100-0000-4000-8000-0000000000ff'::uuid, 'P13a Plan incoherent', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2,
   '13a05700-0000-4000-8000-000000000002'::uuid, '13a0c0ac-0000-4000-8000-0000000000a1'::uuid);

insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('13a04000-0000-4000-8000-0000000000a2'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid, 'entrainement', 2400, 3000, 4500, 2500),
  ('13a04000-0000-4000-8000-0000000000b2'::uuid, '13a09100-0000-4000-8000-0000000000b2'::uuid, 'entrainement', 2000, 3500, 4000, 2500),
  -- Le profil du plan MODÈLE de A. Il n'est pas décoratif : `nutrition_days`
  -- porte la clé étrangère COMPOSITE `nutrition_days_profile_fkey` sur
  -- (plan_id, profile_key) vers cette table. Le jour posé plus bas sur le plan
  -- modèle A avec `profile_key = 'entrainement'` exige donc le profil
  -- correspondant SUR CE PLAN-LÀ — un profil portant la même clé sur un autre
  -- plan ne satisfait pas la contrainte.
  ('13a04000-0000-4000-8000-00000000d0a1'::uuid, '13a09100-0000-4000-8000-00000000d0a1'::uuid, 'entrainement', 2000, 3000, 4500, 2500);

insert into public.nutrition_meal_slot_targets (id, profile_id, slot, enabled, protein_bp, carb_bp, fat_bp) values
  ('13a05000-0000-4000-8000-0000000000a2'::uuid, '13a04000-0000-4000-8000-0000000000a2'::uuid, 'breakfast', true, 2500, 2500, 2500),
  ('13a05000-0000-4000-8000-0000000000b2'::uuid, '13a04000-0000-4000-8000-0000000000b2'::uuid, 'breakfast', true, 2500, 2500, 2500);

insert into public.nutrition_days (id, plan_id, day, status, profile_key) values
  ('13a0da00-0000-4000-8000-0000000000a2'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid, 'monday', 'non-commence', 'entrainement'),
  ('13a0da00-0000-4000-8000-0000000000b2'::uuid, '13a09100-0000-4000-8000-0000000000b2'::uuid, 'monday', 'non-commence', 'entrainement'),
  ('13a0da00-0000-4000-8000-00000000d0a1'::uuid, '13a09100-0000-4000-8000-00000000d0a1'::uuid, 'monday', 'non-commence', 'entrainement');

insert into public.meals (id, nutrition_day_id, slot, name, items) values
  ('13a03ea0-0000-4000-8000-0000000000a2'::uuid, '13a0da00-0000-4000-8000-0000000000a2'::uuid, 'breakfast', 'P13a Repas SECRET de A', '[]'::jsonb),
  ('13a03ea0-0000-4000-8000-0000000000b2'::uuid, '13a0da00-0000-4000-8000-0000000000b2'::uuid, 'breakfast', 'P13a Repas SECRET de B', '[]'::jsonb);

insert into public.meal_choice_slots (id, meal_id, position, label) values
  ('13a05c00-0000-4000-8000-0000000000a2'::uuid, '13a03ea0-0000-4000-8000-0000000000a2'::uuid, 1, 'P13a Creneau de A'),
  ('13a05c00-0000-4000-8000-0000000000b2'::uuid, '13a03ea0-0000-4000-8000-0000000000b2'::uuid, 1, 'P13a Creneau de B');

-- `meal_choice_options` porte la contrainte `meal_choice_options_cible_unique` :
--   (catalog_food_id is null ? 0 : 1) + (product_id is null ? 0 : 1) = 1
-- Une option désigne donc EXACTEMENT une cible — un aliment du catalogue OU un
-- produit, jamais les deux, jamais aucun. Laisser les deux colonnes nulles
-- faisait échouer le décor.
--
-- POURQUOI UNE SÉLECTION DYNAMIQUE, ET NON DEUX UUID ÉCRITS EN DUR
-- ─────────────────────────────────────────────────────────────────
-- `public.food_catalog` n'est PAS créée par ce décor : elle est importée, et
-- ses identifiants DIFFÈRENT d'une base à l'autre (vérifié : les deux premiers
-- aliments actifs de la base locale n'existent pas dans la base distante, et
-- réciproquement). Deux UUID écrits en dur auraient donc lié cette checklist à
-- UNE base précise : reconstruire le catalogue, ou lancer la checklist sur une
-- autre machine, aurait fait échouer
-- `meal_choice_options_catalog_food_id_fkey` sans que rien ne soit cassé.
--
-- Le décor choisit donc lui-même deux aliments existants, par un ordre
-- déterministe (`order by id`), et ne dépend plus que d'une prémisse :
-- « le catalogue contient au moins deux aliments actifs ». Cette prémisse est
-- vérifiée JUSTE AVANT, et son échec est explicite — un décor qui insérerait
-- zéro option en silence rendrait verts, pour la mauvaise raison, tous les
-- contrôles portant sur les options.
--
-- AUCUN aliment n'est créé : le décor se sert de ce qui est déjà là.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from (select 1 from public.food_catalog where status = 'active' limit 2) x;
  if v_n < 2 then
    raise exception
      'DÉCOR P13-A INSUFFISANT : public.food_catalog contient % aliment(s) actif(s), il en faut au moins 2 pour que les options de choix de A et de B désignent des aliments DIFFÉRENTS. Charge le catalogue (npm run db:local:init) avant de relancer cette checklist.',
      v_n
      using errcode = 'P0002';
  end if;
end $$;

-- Option de A : le PREMIER aliment actif, par ordre d'identifiant.
insert into public.meal_choice_options (id, slot_id, position, catalog_food_id)
select '13a00c00-0000-4000-8000-0000000000a2'::uuid,
       '13a05c00-0000-4000-8000-0000000000a2'::uuid,
       1,
       f.id
  from public.food_catalog f
 where f.status = 'active'
 order by f.id
 limit 1;

-- Option de B : le DEUXIÈME. Un aliment différent de celui de A, pour que les
-- deux mondes restent distincts jusque dans leurs options.
insert into public.meal_choice_options (id, slot_id, position, catalog_food_id)
select '13a00c00-0000-4000-8000-0000000000b2'::uuid,
       '13a05c00-0000-4000-8000-0000000000b2'::uuid,
       1,
       f.id
  from public.food_catalog f
 where f.status = 'active'
 order by f.id
 offset 1
 limit 1;

insert into public.nutrition_daily_logs (id, student_id, nutrition_plan_id, log_date, calories) values
  ('13a0106a-0000-4000-8000-0000000000a2'::uuid, '13a05700-0000-4000-8000-0000000000a2'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid, current_date, 2100),
  ('13a0106a-0000-4000-8000-0000000000b2'::uuid, '13a05700-0000-4000-8000-0000000000b2'::uuid, '13a09100-0000-4000-8000-0000000000b2'::uuid, current_date, 1750);

insert into public.food_lists (id, coach_id, name) values
  ('13a0f100-0000-4000-8000-0000000000a1'::uuid, '13a0c0ac-0000-4000-8000-0000000000a1'::uuid, 'P13a Liste de A'),
  ('13a0f100-0000-4000-8000-0000000000b1'::uuid, '13a0c0ac-0000-4000-8000-0000000000b1'::uuid, 'P13a Liste de B');


-- ════════════════════════════════════════════════════════════════════════════
-- B. LES ACCÈS LÉGITIMES — la base de comparaison
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0a1","role":"authenticated"}', true);

  perform pg_temp.noter('B', 'B0. current_coach_id() rend bien la fiche du coach A',
    public.current_coach_id() = '13a0c0ac-0000-4000-8000-0000000000a1'::uuid);

  perform pg_temp.noter('B', 'B0b. is_coach_of_student() reconnaît SON élève',
    public.is_coach_of_student('13a05700-0000-4000-8000-0000000000a2'::uuid));

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B1. le coach A LIT le plan de SON élève', v_n = 1);

  select count(*) into v_n from public.nutrition_days where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B2. il lit les journées de ce plan', v_n = 1);

  select count(*) into v_n from public.meals where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B3. il lit les repas de ce plan', v_n = 1);

  select count(*) into v_n from public.nutrition_plan_profiles where id = '13a04000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B4. il lit les profils de ce plan', v_n = 1);

  select count(*) into v_n from public.nutrition_meal_slot_targets where id = '13a05000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B5. il lit les cibles de créneau de ce plan', v_n = 1);

  select count(*) into v_n from public.meal_choice_slots where id = '13a05c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B6. il lit les créneaux de choix de ce plan', v_n = 1);

  select count(*) into v_n from public.meal_choice_options where id = '13a00c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B7. il lit les options de choix de ce plan', v_n = 1);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('B', 'B8. il lit le journal quotidien de SON élève', v_n = 1);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid;
  perform pg_temp.noter('B', 'B9. il lit SON plan modèle (sans élève)', v_n = 1);

  -- Les écritures légitimes, elles aussi. Un cloisonnement qui casserait le
  -- travail normal du coach serait un échec, pas une réussite.
  update public.meals set name = 'P13a Repas de A modifie'
   where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('B', 'B10. il MODIFIE un repas de son élève', v_n = 1);

  update public.nutrition_plans set name = 'P13a Plan de A modifie'
   where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('B', 'B11. il MODIFIE le plan de son élève', v_n = 1);

  insert into public.nutrition_days (id, plan_id, day, status, profile_key)
  values ('13a0da00-0000-4000-8000-00000000aa01'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid,
          'tuesday', 'non-commence', 'entrainement');
  get diagnostics v_n = row_count;
  perform pg_temp.noter('B', 'B12. il AJOUTE une journée au plan de son élève', v_n = 1);

  insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version, student_id, coach_id)
  values ('13a09100-0000-4000-8000-00000000aa02'::uuid, 'P13a Nouveau de A', 'maintien', 'actif',
          '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2, null,
          '13a0c0ac-0000-4000-8000-0000000000a1'::uuid);
  get diagnostics v_n = row_count;
  perform pg_temp.noter('B', 'B13. il CRÉE un plan modèle à son nom', v_n = 1);

  -- Et le coach B, symétriquement : sinon on ne saurait pas si B est bloqué
  -- par le cloisonnement ou simplement cassé.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('B', 'B14. SYMÉTRIE — le coach B lit le plan de SON élève', v_n = 1);

  update public.meals set name = 'P13a Repas de B modifie'
   where id = '13a03ea0-0000-4000-8000-0000000000b2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('B', 'B15. SYMÉTRIE — le coach B modifie un repas de son élève', v_n = 1);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- C. ISOLATION COACH ↔ COACH EN LECTURE, TABLE PAR TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- Chaque UUID visé est l'UUID RÉEL de la ressource de l'autre coach : c'est
-- exactement ce que ferait quelqu'un qui l'aurait relevé dans une URL.
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C1. le coach B ne LIT PAS le plan de l''élève de A', v_n = 0);

  select count(*) into v_n from public.nutrition_days where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C2. ni ses journées', v_n = 0);

  select count(*) into v_n from public.meals where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C3. ni ses repas', v_n = 0);

  select count(*) into v_n from public.nutrition_plan_profiles where id = '13a04000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C4. ni ses profils de plan', v_n = 0);

  select count(*) into v_n from public.nutrition_meal_slot_targets where id = '13a05000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C5. ni ses cibles de créneau', v_n = 0);

  select count(*) into v_n from public.meal_choice_slots where id = '13a05c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C6. ni ses créneaux de choix', v_n = 0);

  select count(*) into v_n from public.meal_choice_options where id = '13a00c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C7. ni ses options de choix', v_n = 0);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('C', 'C8. ni le journal quotidien de l''élève de A', v_n = 0);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid;
  perform pg_temp.noter('C', 'C9. ni le plan MODÈLE de A', v_n = 0);

  perform pg_temp.noter('C', 'C10. is_coach_of_student() refuse l''élève de A',
    not public.is_coach_of_student('13a05700-0000-4000-8000-0000000000a2'::uuid));

  perform pg_temp.noter('C', 'C11. can_manage_nutrition_plan() refuse le plan de A',
    not public.can_manage_nutrition_plan('13a09100-0000-4000-8000-0000000000a2'::uuid));

  perform pg_temp.noter('C', 'C12. can_manage_nutrition_day() refuse la journée de A',
    not public.can_manage_nutrition_day('13a0da00-0000-4000-8000-0000000000a2'::uuid));

  perform pg_temp.noter('C', 'C13. can_manage_meal() refuse le repas de A',
    not public.can_manage_meal('13a03ea0-0000-4000-8000-0000000000a2'::uuid));

  -- SENS INVERSE. Un cloisonnement unidirectionnel ne serait pas un
  -- cloisonnement.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0a1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('C', 'C14. SYMÉTRIE — le coach A ne lit pas le plan de l''élève de B', v_n = 0);

  select count(*) into v_n from public.meals where id = '13a03ea0-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('C', 'C15. SYMÉTRIE — ni ses repas', v_n = 0);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('C', 'C16. SYMÉTRIE — ni son journal quotidien', v_n = 0);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- D. ISOLATION COACH ↔ COACH EN ÉCRITURE
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  perform pg_temp.noter('D', 'D1. le coach B ne MODIFIE PAS le plan de l''élève de A',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans set name = 'PIRATE'
      where id = '13a09100-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D2. ni un repas de ce plan',
    pg_temp.ecriture_refusee($q$update public.meals set name = 'PIRATE'
      where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D3. ni une journée de ce plan',
    pg_temp.ecriture_refusee($q$update public.nutrition_days set profile_key = 'repos'
      where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D4. ni un profil de ce plan',
    pg_temp.ecriture_refusee($q$update public.nutrition_plan_profiles set daily_calories = 1
      where id = '13a04000-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D5. ni une cible de créneau de ce plan',
    pg_temp.ecriture_refusee($q$update public.nutrition_meal_slot_targets set protein_bp = 1
      where id = '13a05000-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D6. ni un créneau de choix de ce plan',
    pg_temp.ecriture_refusee($q$update public.meal_choice_slots set label = 'PIRATE'
      where id = '13a05c00-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D7. ni une option de choix de ce plan',
    pg_temp.ecriture_refusee($q$update public.meal_choice_options set position = 99
      where id = '13a00c00-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D8. ni le journal quotidien de l''élève de A',
    pg_temp.ecriture_refusee($q$update public.nutrition_daily_logs set calories = 1
      where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid$q$));

  -- SUPPRESSIONS
  perform pg_temp.noter('D', 'D9. il ne SUPPRIME PAS un repas du plan de A',
    pg_temp.ecriture_refusee($q$delete from public.meals
      where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D10. ni une journée du plan de A',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_days
      where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D11. ni une cible de créneau du plan de A',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_meal_slot_targets
      where id = '13a05000-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('D', 'D12. ni le journal quotidien de l''élève de A',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_daily_logs
      where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid$q$));

  -- INSERTIONS dans le monde de A
  perform pg_temp.noter('D', 'D13. il n''INSÈRE PAS une journée dans le plan de A',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_days (id, plan_id, day, status, profile_key)
      values ('13a0da00-0000-4000-8000-0000000000ee'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid,
              'friday', 'non-commence', 'entrainement')$q$));

  perform pg_temp.noter('D', 'D14. ni un repas dans une journée de A',
    pg_temp.ecriture_refusee($q$insert into public.meals (id, nutrition_day_id, slot, name, items)
      values ('13a03ea0-0000-4000-8000-0000000000ee'::uuid, '13a0da00-0000-4000-8000-0000000000a2'::uuid,
              'lunch', 'PIRATE', '[]'::jsonb)$q$));

  perform pg_temp.noter('D', 'D15. ni un profil dans le plan de A',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
      values ('13a04000-0000-4000-8000-0000000000ee'::uuid, '13a09100-0000-4000-8000-0000000000a2'::uuid,
              'repos', 1, 2500, 2500, 2500)$q$));

  perform pg_temp.noter('D', 'D16. ni un journal quotidien au nom de l''élève de A',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_daily_logs (id, student_id, nutrition_plan_id, log_date, calories)
      values ('13a0106a-0000-4000-8000-0000000000ee'::uuid, '13a05700-0000-4000-8000-0000000000a2'::uuid,
              '13a09100-0000-4000-8000-0000000000a2'::uuid, current_date - 1, 1)$q$));
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LES CONTOURNEMENTS
-- ════════════════════════════════════════════════════════════════════════════
-- Ce ne sont pas des variantes de D : chacun part d'une ligne que le coach
-- POSSÈDE légitimement, et tente de la faire franchir la frontière. C'est le
-- WITH CHECK qui doit refuser, pas le USING.
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  -- E1. Réécrire student_id pour s'offrir un élève de l'autre coach. La cible
  --     est l'élève A2, qui appartient bien au coach A mais ne porte AUCUN
  --     plan : le seul refus possible est donc celui de la policy.
  perform pg_temp.noter('E', 'E1. le coach B n''affecte PAS son plan modèle à un élève de A',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans
      set student_id = '13a05700-0000-4000-8000-0000000000a3'::uuid
      where id = '13a09100-0000-4000-8000-00000000d0b1'::uuid$q$));

  -- E1b. CONTRÔLE DU CONTRÔLE. L'élève A2 appartient bien au coach A et ne
  --      porte aucun plan : E1 ne teste donc que la RLS.
  reset role;
  select count(*) into v_n from public.students s
   where s.id = '13a05700-0000-4000-8000-0000000000a3'::uuid
     and s.coach_id = '13a0c0ac-0000-4000-8000-0000000000a1'::uuid
     and not exists (select 1 from public.nutrition_plans p where p.student_id = s.id);
  perform pg_temp.noter('E',
    'E1b. CONTRÔLE — l''élève A2 est bien au coach A et libre de tout plan', v_n = 1);
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  -- E2. Réécrire coach_id pour s'approprier le plan modèle de l'autre.
  perform pg_temp.noter('E', 'E2. il ne s''APPROPRIE PAS le plan modèle de A en réécrivant coach_id',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans
      set coach_id = '13a0c0ac-0000-4000-8000-0000000000b1'::uuid
      where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid$q$));

  -- E3. Réécrire coach_id sur le plan AFFECTÉ de l'autre coach.
  perform pg_temp.noter('E', 'E3. ni le plan affecté de A',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans
      set coach_id = '13a0c0ac-0000-4000-8000-0000000000b1'::uuid
      where id = '13a09100-0000-4000-8000-0000000000a2'::uuid$q$));

  -- E4. Déplacer SA journée vers le plan de l'autre coach (clé forgée).
  perform pg_temp.noter('E', 'E4. il ne DÉPLACE PAS sa journée vers le plan de A',
    pg_temp.ecriture_refusee($q$update public.nutrition_days
      set plan_id = '13a09100-0000-4000-8000-0000000000a2'::uuid
      where id = '13a0da00-0000-4000-8000-0000000000b2'::uuid$q$));

  -- E5. Rattacher SON repas à une journée de l'autre coach.
  perform pg_temp.noter('E', 'E5. il ne RATTACHE PAS son repas à une journée de A',
    pg_temp.ecriture_refusee($q$update public.meals
      set nutrition_day_id = '13a0da00-0000-4000-8000-0000000000a2'::uuid
      where id = '13a03ea0-0000-4000-8000-0000000000b2'::uuid$q$));

  -- E6. Rattacher SON créneau de choix au repas de l'autre coach.
  perform pg_temp.noter('E', 'E6. il ne RATTACHE PAS son créneau au repas de A',
    pg_temp.ecriture_refusee($q$update public.meal_choice_slots
      set meal_id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid
      where id = '13a05c00-0000-4000-8000-0000000000b2'::uuid$q$));

  -- E7. Rattacher SON option au créneau de l'autre coach.
  perform pg_temp.noter('E', 'E7. il ne RATTACHE PAS son option au créneau de A',
    pg_temp.ecriture_refusee($q$update public.meal_choice_options
      set slot_id = '13a05c00-0000-4000-8000-0000000000a2'::uuid
      where id = '13a00c00-0000-4000-8000-0000000000b2'::uuid$q$));

  -- E8. Créer un plan directement au nom de l'élève de l'autre coach.
  perform pg_temp.noter('E', 'E8. il ne CRÉE PAS un plan pour l''élève de A',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans
      (id, name, goal_type, status, daily_target, nutrition_model_version, student_id, coach_id)
      values ('13a09100-0000-4000-8000-0000000000ee'::uuid, 'PIRATE', 'maintien', 'actif',
              '{"calories":1,"protein":1,"carbs":1,"fat":1}'::jsonb, 2,
              '13a05700-0000-4000-8000-0000000000a2'::uuid, '13a0c0ac-0000-4000-8000-0000000000b1'::uuid)$q$));

  -- E9. Créer un plan modèle au nom de l'autre coach.
  perform pg_temp.noter('E', 'E9. il ne CRÉE PAS un plan modèle au nom de A',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans
      (id, name, goal_type, status, daily_target, nutrition_model_version, student_id, coach_id)
      values ('13a09100-0000-4000-8000-0000000000ef'::uuid, 'PIRATE', 'maintien', 'actif',
              '{"calories":1,"protein":1,"carbs":1,"fat":1}'::jsonb, 2,
              null, '13a0c0ac-0000-4000-8000-0000000000a1'::uuid)$q$));

  -- E10. Puiser dans la liste d'aliments de l'autre coach (garde préexistante,
  --      qui doit être CONSERVÉE par ce chantier).
  perform pg_temp.noter('E', 'E10. il ne PUISE PAS dans la liste d''aliments de A',
    pg_temp.ecriture_refusee($q$update public.meal_choice_slots
      set source_list_id = '13a0f100-0000-4000-8000-0000000000a1'::uuid
      where id = '13a05c00-0000-4000-8000-0000000000b2'::uuid$q$));

  -- E11. CONTRÔLE DU CONTRÔLE : la même opération avec SA liste doit PASSER.
  --      Sans ce contrôle, E10 pourrait réussir parce que la colonne est
  --      inaccessible pour une raison quelconque, et non parce qu'elle est
  --      gardée.
  update public.meal_choice_slots
     set source_list_id = '13a0f100-0000-4000-8000-0000000000b1'::uuid
   where id = '13a05c00-0000-4000-8000-0000000000b2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('E', 'E11. CONTRÔLE — mais il puise bien dans SA propre liste', v_n = 1);

  -- E12. Rien n'a bougé dans le monde de A. On le vérifie en sortant du rôle.
  reset role;
  select count(*) into v_n from public.nutrition_plans
   where id = '13a09100-0000-4000-8000-0000000000a2'::uuid
     and coach_id = '13a0c0ac-0000-4000-8000-0000000000a1'::uuid
     and student_id = '13a05700-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('E', 'E12. BILAN — le plan de A a gardé son coach et son élève', v_n = 1);

  select count(*) into v_n from public.nutrition_plans where name = 'PIRATE';
  perform pg_temp.noter('E', 'E13. BILAN — aucune ligne « PIRATE » n''a été créée', v_n = 0);

  select count(*) into v_n from public.meals
   where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid
     and nutrition_day_id = '13a0da00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('E', 'E14. BILAN — le repas de A est resté dans la journée de A', v_n = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- F. LE DELETE DIRECT, QUI CONTOURNAIT LA RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Avant P13-A, `nutrition_plan_deletion_block` opposait le propriétaire et
-- refusait un plan affecté — mais seulement DANS la RPC. Un DELETE direct ne
-- rencontrait que `is_coach_or_admin()`.
do $$
declare v_n int; v jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  perform pg_temp.noter('F', 'F1. le coach B ne SUPPRIME PAS directement le plan modèle de A',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_plans
      where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid$q$));

  perform pg_temp.noter('F', 'F2. ni le plan AFFECTÉ de l''élève de A',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_plans
      where id = '13a09100-0000-4000-8000-0000000000a2'::uuid$q$));

  -- La RPC, elle, doit refuser pour la même raison, avec un motif lisible.
  v := public.delete_nutrition_plan('13a09100-0000-4000-8000-00000000d0a1'::uuid);
  perform pg_temp.noter('F',
    format('F3. la RPC refuse aussi le plan de A (motif : %s)', coalesce(v->>'reason', '(aucun)')),
    coalesce((v->>'ok')::boolean, false) is not true);

  -- SON PROPRE plan AFFECTÉ : la protection « assigned » que seule la RPC
  -- portait est désormais aussi dans la policy DELETE.
  perform pg_temp.noter('F', 'F4. il ne supprime PAS directement SON plan encore affecté',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_plans
      where id = '13a09100-0000-4000-8000-0000000000b2'::uuid$q$));

  v := public.delete_nutrition_plan('13a09100-0000-4000-8000-0000000000b2'::uuid);
  perform pg_temp.noter('F',
    format('F5. et la RPC le refuse avec le motif « assigned » (reçu : %s)', coalesce(v->>'reason', '(aucun)')),
    v->>'reason' = 'assigned');

  -- CONTRÔLE DU CONTRÔLE : son propre plan modèle, NON affecté, doit bien
  -- partir. Sans cela, F1/F2/F4 passeraient même si le DELETE était cassé
  -- pour tout le monde.
  v := public.delete_nutrition_plan('13a09100-0000-4000-8000-00000000d0b1'::uuid);
  perform pg_temp.noter('F',
    format('F6. CONTRÔLE — mais il supprime bien SON plan modèle non affecté (ok : %s)',
           coalesce(v->>'ok', 'null')),
    coalesce((v->>'ok')::boolean, false));
  reset role;

  select count(*) into v_n from public.nutrition_plans
   where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid;
  perform pg_temp.noter('F', 'F7. BILAN — le plan modèle de A existe toujours', v_n = 1);

  select count(*) into v_n from public.nutrition_plans
   where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('F', 'F8. BILAN — le plan affecté de l''élève de A existe toujours', v_n = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- G. L'ÉLÈVE SANS COACH, ET LE PLAN INCOHÉRENT
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-00000000c0a1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-000000000000'::uuid;
  perform pg_temp.noter('G', 'G1. le coach A ne voit PAS le plan d''un élève sans coach', v_n = 0);

  -- LE CAS DÉCISIF. Ce plan porte coach_id = A, mais son élève n'a pas de
  -- coach. Si la règle opposait coach_id EN OU, le coach A y accéderait et
  -- l'isolation de cet élève serait rouverte. L'élève tranche.
  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000ff'::uuid;
  perform pg_temp.noter('G',
    'G2. DÉCISIF — il ne voit PAS le plan incohérent, bien que coach_id le désigne', v_n = 0);

  perform pg_temp.noter('G', 'G3. can_manage_nutrition_plan() refuse le plan incohérent',
    not public.can_manage_nutrition_plan('13a09100-0000-4000-8000-0000000000ff'::uuid));

  perform pg_temp.noter('G', 'G4. il ne MODIFIE PAS le plan incohérent',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans set name = 'PIRATE'
      where id = '13a09100-0000-4000-8000-0000000000ff'::uuid$q$));

  perform pg_temp.noter('G', 'G5. il ne SUPPRIME PAS le plan incohérent',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_plans
      where id = '13a09100-0000-4000-8000-0000000000ff'::uuid$q$));

  -- G6 vise l'élève N3, qui ne porte AUCUN plan. C'est volontaire : si la
  -- cible portait déjà un plan assigné, l'écriture pourrait mourir sur
  -- `nutrition_plans_one_plan_per_student` AU LIEU d'être refusée par la RLS,
  -- et le contrôle passerait au vert sans rien démontrer. Avec N3, le seul
  -- refus possible est celui de la policy — et `ecriture_refusee` rejette
  -- désormais explicitement un 23505 au cas où.
  perform pg_temp.noter('G', 'G6. il ne s''approprie PAS un élève sans coach via un plan',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans
      set student_id = '13a05700-0000-4000-8000-000000000003'::uuid
      where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid$q$));

  -- G7. CONTRÔLE DU CONTRÔLE. L'élève N3 est bien libre de tout plan : sans
  -- cette vérification, G6 pourrait être vert parce que la cible était
  -- indisponible pour une raison étrangère à la RLS.
  reset role;
  select count(*) into v_n from public.nutrition_plans
   where student_id = '13a05700-0000-4000-8000-000000000003'::uuid;
  perform pg_temp.noter('G',
    'G7. CONTRÔLE — l''élève N3 ne porte aucun plan assigné (G6 ne teste donc que la RLS)',
    v_n = 0);

  -- G8. Et les trois élèves sans coach sont bien dépourvus de coach : c'est
  -- la prémisse de toute la section.
  select count(*) into v_n from public.students
   where id in ('13a05700-0000-4000-8000-000000000000'::uuid,
                '13a05700-0000-4000-8000-000000000002'::uuid,
                '13a05700-0000-4000-8000-000000000003'::uuid)
     and coach_id is null;
  perform pg_temp.noter('G', 'G8. CONTRÔLE — les trois élèves N1/N2/N3 ont bien coach_id IS NULL', v_n = 3);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- H. ADMINISTRATEUR — L'ACCÈS GLOBAL EST CONSERVÉ
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-0000000000d0","role":"authenticated"}', true);

  perform pg_temp.noter('H', 'H0. is_admin() reconnaît bien ce compte', public.is_admin());

  select count(*) into v_n from public.nutrition_plans
   where id in ('13a09100-0000-4000-8000-0000000000a2'::uuid,
                '13a09100-0000-4000-8000-0000000000b2'::uuid);
  perform pg_temp.noter('H', 'H1. l''admin LIT les plans des DEUX coachs', v_n = 2);

  select count(*) into v_n from public.meals
   where id in ('13a03ea0-0000-4000-8000-0000000000a2'::uuid,
                '13a03ea0-0000-4000-8000-0000000000b2'::uuid);
  perform pg_temp.noter('H', 'H2. il lit les repas des deux mondes', v_n = 2);

  select count(*) into v_n from public.nutrition_daily_logs
   where id in ('13a0106a-0000-4000-8000-0000000000a2'::uuid,
                '13a0106a-0000-4000-8000-0000000000b2'::uuid);
  perform pg_temp.noter('H', 'H3. il lit les journaux quotidiens des deux élèves', v_n = 2);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-000000000000'::uuid;
  perform pg_temp.noter('H', 'H4. il lit AUSSI le plan de l''élève sans coach', v_n = 1);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000ff'::uuid;
  perform pg_temp.noter('H', 'H5. et le plan incohérent', v_n = 1);

  update public.nutrition_plans set name = 'P13a admin a modifie A'
   where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('H', 'H6. il MODIFIE un plan du coach A', v_n = 1);

  update public.nutrition_plans set name = 'P13a admin a modifie B'
   where id = '13a09100-0000-4000-8000-0000000000b2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('H', 'H7. et un plan du coach B', v_n = 1);

  update public.meals set name = 'P13a admin a modifie le repas de A'
   where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('H', 'H8. il modifie un repas du coach A', v_n = 1);

  update public.nutrition_daily_logs set calories = 2222
   where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('H', 'H9. il modifie le journal quotidien de l''élève de A', v_n = 1);

  -- L'admin peut même supprimer un plan AFFECTÉ directement : son accès reste
  -- global, c'est la règle posée. La RPC, elle, continue de le lui refuser
  -- pour des raisons métier — et ce n'est pas une contradiction.
  delete from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000ff'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('H', 'H10. il SUPPRIME directement un plan, même affecté', v_n = 1);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- I. L'ÉLÈVE — SES PROPRES DONNÉES, ET RIEN DE PLUS
-- ════════════════════════════════════════════════════════════════════════════
-- Régression à surveiller de près : le resserrage du côté staff ne doit RIEN
-- retirer à l'élève.
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-0000000051a2","role":"authenticated"}', true);

  perform pg_temp.noter('I', 'I0. current_student_id() rend bien la fiche de l''élève A',
    public.current_student_id() = '13a05700-0000-4000-8000-0000000000a2'::uuid);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I1. l''élève A LIT toujours son plan', v_n = 1);

  select count(*) into v_n from public.nutrition_days where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I2. il lit toujours ses journées', v_n = 1);

  select count(*) into v_n from public.meals where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I3. il lit toujours ses repas', v_n = 1);

  select count(*) into v_n from public.nutrition_plan_profiles where id = '13a04000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I4. il lit toujours les profils de son plan', v_n = 1);

  select count(*) into v_n from public.nutrition_meal_slot_targets where id = '13a05000-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I5. il lit toujours les cibles de créneau de son plan', v_n = 1);

  select count(*) into v_n from public.meal_choice_slots where id = '13a05c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I6. il lit toujours ses créneaux de choix', v_n = 1);

  select count(*) into v_n from public.meal_choice_options where id = '13a00c00-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I7. il lit toujours ses options de choix', v_n = 1);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I8. il lit toujours son journal quotidien', v_n = 1);

  update public.nutrition_daily_logs set calories = 1999
   where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('I', 'I9. il écrit toujours dans SON journal quotidien', v_n = 1);

  update public.nutrition_days set status = 'en-cours'
   where id = '13a0da00-0000-4000-8000-0000000000a2'::uuid;
  get diagnostics v_n = row_count;
  perform pg_temp.noter('I', 'I10. il met toujours à jour l''état de SA journée', v_n = 1);

  -- Et rien du monde voisin.
  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('I', 'I11. mais il ne voit PAS le plan de l''élève B', v_n = 0);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('I', 'I12. ni le journal quotidien de l''élève B', v_n = 0);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-00000000d0a1'::uuid;
  perform pg_temp.noter('I', 'I13. ni le plan modèle de son coach', v_n = 0);

  perform pg_temp.noter('I', 'I14. il ne MODIFIE PAS son plan prescrit',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans set name = 'PIRATE'
      where id = '13a09100-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('I', 'I15. il ne MODIFIE PAS ses repas prescrits',
    pg_temp.ecriture_refusee($q$update public.meals set name = 'PIRATE'
      where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid$q$));

  perform pg_temp.noter('I', 'I16. ni le journal quotidien de l''élève B',
    pg_temp.ecriture_refusee($q$update public.nutrition_daily_logs set calories = 1
      where id = '13a0106a-0000-4000-8000-0000000000b2'::uuid$q$));
  reset role;

  -- SYMÉTRIE DU CÔTÉ ÉLÈVE. Sans elle, on ne saurait pas distinguer « l'élève B
  -- est cloisonné » de « l'élève B est cassé » : les contrôles I11-I12 seraient
  -- verts dans les deux cas. On endosse donc réellement son identité.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"13a00000-0000-4000-8000-0000000051b2","role":"authenticated"}', true);

  perform pg_temp.noter('I', 'I17. SYMÉTRIE — current_student_id() rend la fiche de l''élève B',
    public.current_student_id() = '13a05700-0000-4000-8000-0000000000b2'::uuid);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('I', 'I18. SYMÉTRIE — l''élève B lit bien SON plan', v_n = 1);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000b2'::uuid;
  perform pg_temp.noter('I', 'I19. SYMÉTRIE — il lit bien SON journal quotidien', v_n = 1);

  select count(*) into v_n from public.nutrition_plans where id = '13a09100-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I20. SYMÉTRIE — mais pas le plan de l''élève A', v_n = 0);

  select count(*) into v_n from public.meals where id = '13a03ea0-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I21. SYMÉTRIE — ni les repas de l''élève A', v_n = 0);

  select count(*) into v_n from public.nutrition_daily_logs where id = '13a0106a-0000-4000-8000-0000000000a2'::uuid;
  perform pg_temp.noter('I', 'I22. SYMÉTRIE — ni le journal quotidien de l''élève A', v_n = 0);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- J. RECENSEMENT — LE DÉFAUT NE DOIT PLUS EXISTER DANS LE CŒUR
-- ════════════════════════════════════════════════════════════════════════════
-- Ce contrôle est celui qui attrapera une RÉGRESSION future : si quelqu'un
-- recrée une policy `is_coach_or_admin()` seule sur l'une des huit tables, il
-- passe au rouge, quel que soit le nom choisi pour la policy.
do $$
declare v_liste text; v_n int;
begin
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and tablename in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                       'nutrition_meal_slot_targets','meals','meal_choice_slots',
                       'meal_choice_options','nutrition_daily_logs')
     and (coalesce(qual, '') like '%is_coach_or_admin()%'
          or coalesce(with_check, '') like '%is_coach_or_admin()%');
  perform pg_temp.noter('J',
    format('J1. plus aucune policy du cœur nutrition ne mentionne is_coach_or_admin()%s',
           case when v_liste = '' then '' else ' — restantes : ' || v_liste end),
    v_n = 0);

  -- Aucune policy permissive.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and tablename in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                       'nutrition_meal_slot_targets','meals','meal_choice_slots',
                       'meal_choice_options','nutrition_daily_logs')
     and (btrim(coalesce(qual, 'x')) = 'true' or btrim(coalesce(with_check, 'x')) = 'true');
  perform pg_temp.noter('J',
    format('J2. aucune policy permissive (USING true) sur le cœur%s',
           case when v_liste = '' then '' else ' — trouvées : ' || v_liste end),
    v_n = 0);

  -- Chaque table du cœur porte bien une policy qui oppose une propriété.
  select count(*) into v_n
    from (select unnest(array['nutrition_plans','nutrition_days','nutrition_plan_profiles',
                              'nutrition_meal_slot_targets','meals','meal_choice_slots',
                              'meal_choice_options','nutrition_daily_logs']) as t) tables
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = tables.t
        and (coalesce(p.qual, '') like '%current_coach_id()%'
             or coalesce(p.qual, '') like '%is_coach_of_student%'
             or coalesce(p.qual, '') like '%can_manage_nutrition%'
             or coalesce(p.qual, '') like '%can_manage_meal%'));
  perform pg_temp.noter('J',
    format('J3. les 8 tables du cœur portent une policy de propriété (sans : %s)', v_n),
    v_n = 0);

  -- Les trois fonctions de propriété existent, sont SECURITY DEFINER et
  -- figent leur search_path.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_manage_nutrition_plan','can_manage_nutrition_day','can_manage_meal')
     and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  perform pg_temp.noter('J', 'J4. les 3 fonctions de propriété sont SECURITY DEFINER à search_path figé',
    v_n = 3);

  -- `anon` ne doit avoir aucun droit sur le cœur nutrition.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                        'nutrition_meal_slot_targets','meals','meal_choice_slots',
                        'meal_choice_options','nutrition_daily_logs');
  perform pg_temp.noter('J', 'J5. anon n''a aucun droit de table sur le cœur nutrition', v_n = 0);

  -- Et ne doit pas pouvoir exécuter les fonctions de propriété.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_manage_nutrition_plan','can_manage_nutrition_day','can_manage_meal')
     and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.noter('J', 'J6. anon ne peut exécuter aucune des 3 fonctions de propriété', v_n = 0);

  -- Les policies de lecture élève sont toujours là, toutes les huit.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('nutrition_plans_select_self_or_assigned',
                        'nutrition_days_select_self_or_assigned',
                        'nutrition_days_update_self',
                        'nutrition_plan_profiles_select_assigned',
                        'nutrition_meal_slot_targets_select_assigned',
                        'meals_select_self_or_assigned',
                        'meal_choice_slots_select_assigned',
                        'meal_choice_options_select_assigned');
  perform pg_temp.noter('J', 'J7. les 8 policies de lecture élève sont intactes', v_n = 8);

  -- ── Le search_path des fonctions SECURITY DEFINER ────────────────────────
  -- `pg_temp` doit être nommé EXPLICITEMENT et EN DERNIER. Non listé, il est
  -- cherché EN PREMIER par PostgreSQL pour les noms de relations et de types :
  -- `= 'public'` comme `= ''` le laissent donc en tête, et une table temporaire
  -- hostile pourrait masquer `nutrition_plans` au sein d'une fonction qui
  -- s'exécute avec les droits de `postgres`.
  select coalesce(string_agg(p.proname || ' -> ' || coalesce(array_to_string(p.proconfig, ','), '(aucun)'), ', '), '')
    into v_liste
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_manage_nutrition_plan','can_manage_nutrition_day','can_manage_meal')
     and not exists (
       select 1 from unnest(p.proconfig) c
        where c = 'search_path=public, pg_temp');
  perform pg_temp.noter('J',
    format('J9. les 3 fonctions de propriété déclarent search_path = public, pg_temp%s',
           case when v_liste = '' then '' else ' — non conformes : ' || v_liste end),
    v_liste = '');

  -- Et la vérification qui ne dépend pas de l'orthographe exacte : pg_temp
  -- présent, et en dernière position.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_manage_nutrition_plan','can_manage_nutrition_day','can_manage_meal')
     and exists (
       select 1 from unnest(p.proconfig) c
        where c like 'search_path=%'
          and btrim(split_part(replace(c, 'search_path=', ''), ',',
                array_length(string_to_array(replace(c, 'search_path=', ''), ','), 1))) = 'pg_temp');
  perform pg_temp.noter('J', 'J10. pg_temp est le DERNIER élément du search_path des 3 fonctions', v_n = 3);

  -- CONTRÔLE DU CONTRÔLE. Le droit TEMP est bien accordé sur cette base : la
  -- menace que J9/J10 neutralisent est réelle, pas hypothétique. Si ce
  -- contrôle passait au rouge, J9/J10 seraient verts pour la mauvaise raison.
  perform pg_temp.noter('J',
    'J11. CONTRÔLE — authenticated a bien le droit TEMP (la menace pg_temp est réelle)',
    has_database_privilege('authenticated', current_database(), 'TEMP'));

  -- Le vecteur symétrique, lui, est fermé par les droits : personne ne peut
  -- déposer d'objet hostile dans `public`. C'est ce qui permet de garder
  -- `public` dans le chemin.
  perform pg_temp.noter('J',
    'J12. ni authenticated ni anon ne peuvent CREATE dans le schéma public',
    not has_schema_privilege('authenticated', 'public', 'CREATE')
    and not has_schema_privilege('anon', 'public', 'CREATE'));

  -- La RPC de suppression existe toujours.
  perform pg_temp.noter('J', 'J8. delete_nutrition_plan et nutrition_plan_deletion_block existent toujours',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('delete_nutrition_plan','nutrition_plan_deletion_block')) = 2);
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
\echo '--- P13-A : cœur nutrition cloisonné entre coachs. ROLLBACK. ---'
\echo ''

rollback;

-- ════════════════════════════════════════════════════════════════════════════
-- K. RIEN NE SURVIT AU ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare nb int;
begin
  select count(*) into nb from auth.users where email like 'p13a.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — K1. des comptes de test ont survécu au ROLLBACK'; end if;
  select count(*) into nb from public.nutrition_plans where name like 'P13a %';
  if nb <> 0 then raise exception 'ÉCHEC — K2. des plans de test ont survécu'; end if;
  select count(*) into nb from public.coaches where email like 'p13a.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — K3. des fiches coach de test ont survécu'; end if;
  raise notice 'OK      — K1/K2/K3. aucune donnée de test après le ROLLBACK';
end $$;
