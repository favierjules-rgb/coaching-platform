-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A2, CONSOMMATION PAR REPAS
-- Migration couverte : 20260901090000_consumed_meals.sql
--
-- CE QU'ELLE VÉRIFIE
--   A2-DB1  l'élève crée / obtient son repas de consommation prescrit
--   A2-DB2  un repas prescrit est réellement lié à une prescription VALIDE
--           de cet élève — et son instantané de cible en découle
--   A2-DB3  l'élève ne peut pas fabriquer un faux repas prescrit d'un autre
--   A2-DB4  l'élève crée un repas personnel — sans aucune cible coach
--   A2-DB5  il ne modifie / ne supprime QUE son repas personnel
--   A2-DB6  le coach ne modifie aucun repas d'élève
--   A2-DB7  l'ajout d'un aliment calcule les macros CÔTÉ SERVEUR
--   A2-DB8  120 g donnent exactement l'instantané attendu
--   A2-DB9  l'édition 120 → 150 g recalcule l'instantané
--   A2-DB10 une modification ultérieure de food_catalog ne change pas
--           une entrée déjà saisie
--   A2-DB11 la pièce ne fonctionne que si piece_weight_g existe
--   A2-DB12 une quantité ≤ 0 est refusée
--   A2-DB13 un aliment inaccessible ou archivé est refusé
--   A2-DB14 un élève ne peut pas injecter de macros arbitraires
--   A2-DB15 total d'un repas = somme de SES entrées
--   A2-DB16 total d'une journée = repas prescrits + repas élèves
--   A2-SUP  contrôles SUPPLÉMENTAIRES qu'aucun numéro officiel ne réclame :
--           forme de la table, vocabulaires, cible figée dans le temps, RLS
--           complète, plan du coach intact, absence de scanner et de GTIN.
--           Ils sont ÉTIQUETÉS À PART pour ne jamais gonfler un numéro
--           officiel avec une preuve qui ne le concerne pas.
--   Z       après le ROLLBACK, aucune donnée de test ne subsiste
--
-- La numérotation A2-DB1…16 est celle du CONTRAT PRODUIT, reprise mot pour
-- mot. Chaque numéro est démontré par des contrôles EXÉCUTÉS, pas par une
-- lecture de code.
--
-- COMPTES SYNTHÉTIQUES — aucun compte réel, aucune donnée de production.
--   coach A → élève A (plan assigné, 2000 kcal) et élève C (sans plan)
--   coach B → élève B (plan assigné, 1800 kcal)
--
-- EXÉCUTION (base LOCALE uniquement) :
--   psql -U postgres -d <base_locale> -v ON_ERROR_STOP=1 \
--     -f supabase/tests/aliments_a2_checklist.sql
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

-- Un contrôle vaut vrai, faux… ou NULL. Le troisième cas est le plus
-- dangereux : `accepte(sql) and (select …)` rend NULL quand la sous-requête ne
-- voit aucune ligne, et un récapitulatif écrit `count(*) filter (where not
-- ok)` ne compte PAS les NULL — le contrôle disparaît du total sans avoir été
-- vérifié. Mesuré sur A1, pas supposé. `noter` range donc NULL comme un ÉCHEC.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · % (contrôle mal formé : traité comme un échec)', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

create or replace function pg_temp.accepte(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end $$;

create or replace function pg_temp.compte(p_sql text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql into n;
  return coalesce(n, -1);
exception when others then
  return -1;
end $$;

-- Un scalaire quelconque, rendu en texte, sous l'identité courante. Rend NULL
-- si la requête échoue — et `noter` traitera ce NULL comme un échec.
create or replace function pg_temp.valeur(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $$;

create or replace function pg_temp.connecte(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

-- ---------------------------------------------------------------------
-- Section 0 — les comptes, les plans, le catalogue
-- ---------------------------------------------------------------------
-- Identifiants FIXES : une checklist doit être rejouable à l'identique.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'coach-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000005', 'eleve-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000006', 'eleve-c@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin',   'Adm','In',  'admin@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach',   'Co','AchA', 'coach-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'coach',   'Co','AchB', 'coach-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'student', 'El','EveA', 'eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000005', 'student', 'El','EveB', 'eleve-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000006', 'student', 'El','EveC', 'eleve-c@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'Coach A', 'coach-a@test.invalid'),
  ('c0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000003', 'Coach B', 'coach-b@test.invalid');

insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('50000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004',
   'c0000000-0000-4000-8000-00000000000a', 'Eleve','A','eleve-a@test.invalid','active'),
  ('50000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000005',
   'c0000000-0000-4000-8000-00000000000b', 'Eleve','B','eleve-b@test.invalid','active'),
  ('50000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000006',
   'c0000000-0000-4000-8000-00000000000a', 'Eleve','C','eleve-c@test.invalid','active');

-- ── Le plan de l'élève A ────────────────────────────────────────────────
-- 2000 kcal, réparties 30 / 40 / 30 en points de base sur la JOURNÉE.
-- Puis, sur le créneau `lunch`, 40 % de CHAQUE MACRO de la journée.
--
-- Les valeurs attendues se calculent donc en DEUX étages, exactement comme
-- computeDailyMacroTargets puis computeMealDistribution :
--   P jour = 2000 × 0,30 / 4 = 150 g   → P midi = 150 × 0,40 = 60 g
--   G jour = 2000 × 0,40 / 4 = 200 g   → G midi = 200 × 0,40 = 80 g
--   L jour = 2000 × 0,30 / 9 = 66,67 g → L midi = 66,67 × 0,40 = 26,666… g
--   kcal midi = 4×60 + 4×80 + 9×26,666… = 800
--
-- Un seul étage (2000 × 0,40 appliqué directement au créneau) donnerait
-- d'autres nombres : ce serait une SECONDE convention nutritionnelle, et
-- l'élève verrait un objectif différent de celui que l'écran lui affiche.
insert into public.nutrition_plans (id, student_id, coach_id, name, status) values
  ('70000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-00000000000a', 'Plan A', 'actif');
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('80000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000a', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_meal_slot_targets (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order) values
  ('80000000-0000-4000-8000-00000000000a', 'breakfast', true,  3000, 3000, 3000, 0),
  ('80000000-0000-4000-8000-00000000000a', 'lunch',     true,  4000, 4000, 4000, 2),
  ('80000000-0000-4000-8000-00000000000a', 'dinner',    false, 3000, 3000, 3000, 4);
insert into public.nutrition_days (id, plan_id, day, profile_key, status) values
  ('90000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000a', 'monday', 'default', 'non-commence');

-- `lunch` : aucune macro saisie par le coach → la part du créneau s'applique.
-- `breakfast` : le coach a tapé ses propres valeurs → elles priment.
-- `dinner` : créneau désactivé ET nom vide → ni objectif, ni libellé.
insert into public.meals (id, nutrition_day_id, slot, name, macros, coach_notes, items) values
  ('b0000000-0000-4000-8000-00000000000a', '90000000-0000-4000-8000-00000000000a',
   'lunch', 'Déjeuner', '{}', 'Note du coach a ne pas toucher', '[{"name": "Riz", "quantity": "150 g"}]'),
  ('b0000000-0000-4000-8000-00000000000b', '90000000-0000-4000-8000-00000000000a',
   'breakfast', 'Petit-déjeuner', '{"calories": 500, "protein": 30, "carbs": 50, "fat": 15}', '', '[]'),
  ('b0000000-0000-4000-8000-00000000000d', '90000000-0000-4000-8000-00000000000a',
   'dinner', '', '{}', '', '[]');

-- ── Le plan de l'élève B, chez un AUTRE coach ───────────────────────────
insert into public.nutrition_plans (id, student_id, coach_id, name, status) values
  ('70000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b',
   'c0000000-0000-4000-8000-00000000000b', 'Plan B', 'actif');
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('80000000-0000-4000-8000-00000000000b', '70000000-0000-4000-8000-00000000000b', 'default', 1800, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, profile_key, status) values
  ('90000000-0000-4000-8000-00000000000b', '70000000-0000-4000-8000-00000000000b', 'monday', 'default', 'non-commence');
insert into public.meals (id, nutrition_day_id, slot, name, macros) values
  ('b0000000-0000-4000-8000-00000000000c', '90000000-0000-4000-8000-00000000000b', 'lunch', 'Déjeuner B', '{}');

-- ── Le catalogue ───────────────────────────────────────────────────────
insert into public.food_catalog
  (id, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g, status) values
  ('f0000000-0000-4000-8000-00000000000a', null, 'Banane', 'g',  1.1, 22.8, 0.3,  120, 'active'),
  ('f0000000-0000-4000-8000-00000000000b', null, 'Lait',   'ml', 3.3,  4.8, 1.6, null, 'active'),
  ('f0000000-0000-4000-8000-00000000000c', null, 'Retire', 'g',    1,    1,   1, null, 'archived');
insert into public.food_catalog
  (id, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status) values
  ('f0000000-0000-4000-8000-00000000000d', 'c0000000-0000-4000-8000-00000000000a',
   'Prive du coach A', 'g', 1, 1, 1, 'active');

-- Photographie du plan AVANT toute consommation : c'est la référence du
-- contrôle de non-régression A2-DB16.
create temporary table _plan_avant on commit drop as
  select id, nutrition_day_id, slot, name, macros, coach_notes, items, updated_at
    from public.meals order by id;
create temporary table _jours_avant on commit drop as
  select id, plan_id, day, profile_key, status, target, actual, updated_at
    from public.nutrition_days order by id;
create temporary table _profils_avant on commit drop as
  select p.id, p.daily_calories, p.protein_bp, p.carb_bp, p.fat_bp, p.updated_at
    from public.nutrition_plan_profiles p order by p.id;

do $$
begin
  -- MIS À JOUR PAR A3 PHASE 2. Cette checklist comptait TOUT le catalogue,
  -- ce qui supposait qu'il soit vide en dehors de ses propres décors — vrai
  -- jusqu'à l'import Ciqual, qui y ajoute 3 330 aliments. On compte donc les
  -- QUATRE ALIMENTS DE TEST, identifiés par leur clé, plutôt que la table
  -- entière : l'intention est la même, et elle ne dépend plus de ce que
  -- d'autres lots mettent dans le catalogue.
  perform pg_temp.noter('0', 'les six comptes, les deux plans et les quatre aliments de test existent',
    (select count(*) from public.students) = 3
    and (select count(*) from public.meals) = 4
    and (select count(*) from public.food_catalog
          where id in ('f0000000-0000-4000-8000-00000000000a',
                       'f0000000-0000-4000-8000-00000000000b',
                       'f0000000-0000-4000-8000-00000000000c',
                       'f0000000-0000-4000-8000-00000000000d')) = 4);
end $$;

-- ---------------------------------------------------------------------
-- A2-SUP — la forme de `consumed_meals` (structure, vocabulaires)
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A2-SUP', 'la table existe, avec RLS activée',
    to_regclass('public.consumed_meals') is not null
    and (select relrowsecurity from pg_class where oid = 'public.consumed_meals'::regclass));

  perform pg_temp.noter('A2-SUP', 'kind est un vocabulaire CHECK, jamais un type énuméré',
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.consumed_meals'::regclass
        and conname = 'consumed_meals_kind_check') ~ 'prescribed.*student'
    and not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'public' and t.typtype = 'e'));

  perform pg_temp.noter('A2-SUP', 'un kind inventé est refusé', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'triche', 'X') $q$));

  perform pg_temp.noter('A2-SUP', 'un libellé vide est refusé', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'student', '   ') $q$));

  perform pg_temp.noter('A2-SUP', 'un créneau hors vocabulaire v2 est refusé', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, slot_key, label)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'student', 'brunch', 'X') $q$));

  -- C'est le contrôle que A1 ne peut plus porter : le vocabulaire du créneau
  -- a suivi la colonne quand elle a changé de table (voir l'entête de
  -- aliments_a1_checklist.sql).
  perform pg_temp.noter('A2-SUP', 'un créneau NULL reste accepté (repas hors créneau)', pg_temp.accepte($q$
    insert into public.consumed_meals (id, student_id, consumed_on, kind, slot_key, label)
    values ('d0000000-0000-4000-8000-0000000000ff', '50000000-0000-4000-8000-00000000000a',
            date '2026-08-01', 'student', null, 'Hors creneau') $q$));

  -- Le pointeur de provenance est écrit dans le sens qui SURVIT à
  -- `on delete set null` : on interdit un pointeur incohérent, on n'exige pas
  -- un pointeur présent. L'implication inverse rendrait la suppression d'un
  -- plan impossible.
  perform pg_temp.noter('A2-DB2', 'un repas « student » ne peut PAS pointer vers un repas prescrit',
    pg_temp.refuse($q$
      insert into public.consumed_meals (student_id, consumed_on, kind, prescribed_meal_id, label)
      values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'student',
              'b0000000-0000-4000-8000-00000000000a', 'X') $q$));

  perform pg_temp.noter('A2-DB2', 'un repas « prescribed » au pointeur NULL reste légal',
    pg_temp.accepte($q$
      insert into public.consumed_meals (id, student_id, consumed_on, kind, prescribed_meal_id, label)
      values ('d0000000-0000-4000-8000-0000000000fe', '50000000-0000-4000-8000-00000000000a',
              date '2026-08-01', 'prescribed', null, 'Plan supprime') $q$));

  perform pg_temp.noter('A2-DB2', 'le pointeur vers meals est bien en ON DELETE SET NULL',
    (select confdeltype from pg_constraint
      where conrelid = 'public.consumed_meals'::regclass and contype = 'f'
        and confrelid = 'public.meals'::regclass) = 'n');

  perform pg_temp.noter('A2-SUP', 'une cible négative est refusée', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label, target_kcal)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'prescribed', 'X', -1) $q$));
end $$;

-- ---------------------------------------------------------------------
-- A2-DB4 (a) — un repas ÉLÈVE ne porte JAMAIS de cible coach
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A2-DB4', 'poser une cible sur un repas élève est refusé', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label, target_kcal)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'student', 'Collation', 500) $q$));

  perform pg_temp.noter('A2-DB4', 'même une seule macro de cible est refusée', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label, target_protein_g)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'student', 'Collation', 30) $q$))
    ;

  perform pg_temp.noter('A2-DB4', 'la promouvoir après coup par UPDATE est refusé aussi', pg_temp.refuse($q$
    update public.consumed_meals set target_kcal = 500
     where id = 'd0000000-0000-4000-8000-0000000000ff' $q$));
end $$;

-- On efface les deux lignes de décor posées par A2-DB1 : la suite compte les
-- conteneurs, et un décor oublié fausserait ces comptes.
delete from public.consumed_meals
 where id in ('d0000000-0000-4000-8000-0000000000ff', 'd0000000-0000-4000-8000-0000000000fe');

-- ---------------------------------------------------------------------
-- A2-DB3 — l'élève ne peut pas fabriquer un faux repas prescrit d'un autre
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A

do $$
begin
  perform pg_temp.noter('A2-DB3', 'l''élève A ne peut pas ouvrir le repas prescrit de l''élève B',
    pg_temp.refuse($q$ select public.ouvrir_repas_prescrit(
      'b0000000-0000-4000-8000-00000000000c', date '2026-08-13') $q$));

  perform pg_temp.noter('A2-DB3', 'un identifiant de repas inexistant est refusé',
    pg_temp.refuse($q$ select public.ouvrir_repas_prescrit(
      'b0000000-0000-4000-8000-0000000000ee', date '2026-08-13') $q$));

  perform pg_temp.noter('A2-DB3', 'une date manquante est refusée',
    pg_temp.refuse($q$ select public.ouvrir_repas_prescrit(
      'b0000000-0000-4000-8000-00000000000a', null) $q$));

  perform pg_temp.noter('A2-DB3', 'aucun conteneur n''a été créé par ces tentatives',
    pg_temp.compte($q$ select count(*)::int from public.consumed_meals $q$) = 0);

  -- La RPC résout l'élève par current_student_id(), jamais par un paramètre :
  -- il n'existe donc AUCUN moyen d'en désigner un autre.
  perform pg_temp.noter('A2-DB3', 'aucune RPC de A2 ne prend un identifiant d''élève en écriture',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                          'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                          'ajouter_aliment_manuel', 'modifier_quantite_entree', 'supprimer_entree')
        and pg_get_function_arguments(p.oid) ~ 'student') = 0);

  perform pg_temp.noter('A2-SUP', 'les huit RPC sont security definer, search_path figé à public',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                          'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                          'ajouter_aliment_manuel', 'modifier_quantite_entree', 'supprimer_entree')
        and p.prosecdef
        and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))) = 8);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB1 — l'élève crée / obtient son repas de consommation prescrit
-- ---------------------------------------------------------------------
do $$
declare v_un uuid; v_deux uuid;
begin
  v_un  := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-13');
  v_deux := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-13');

  perform pg_temp.noter('A2-DB1', 'deux ouvertures rendent le MÊME conteneur',
    v_un is not null and v_un = v_deux);

  perform pg_temp.noter('A2-DB1', 'un seul conteneur existe pour ce couple (repas, date)',
    (select count(*) from public.consumed_meals
      where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000a'
        and consumed_on = date '2026-08-13') = 1);

  -- Le même repas prescrit, un AUTRE jour : c'est une autre journée, donc un
  -- autre conteneur. Un jour prescrit est un JOUR-TYPE répété indéfiniment.
  perform pg_temp.noter('A2-DB1', 'le même repas un autre jour donne un AUTRE conteneur',
    public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-14') <> v_un);

  perform pg_temp.noter('A2-DB1', 'un index UNIQUE partiel arbitre la concurrence',
    exists (select 1 from pg_indexes where schemaname = 'public'
             and indexname = 'consumed_meals_prescribed_unique'
             and indexdef ~ 'WHERE .*prescribed_meal_id IS NOT NULL'));
end $$;

-- ---------------------------------------------------------------------
-- A2-DB2 (a) — le repas prescrit est lié à une prescription VALIDE de cet élève
-- ---------------------------------------------------------------------
do $$
declare v_midi uuid; v_matin uuid;
begin
  v_midi  := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-13');
  v_matin := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000b', date '2026-08-13');

  -- Cible DÉRIVÉE, deux étages de points de base (voir le commentaire des
  -- fixtures). 26,666… est arrondi ici au centième POUR LA COMPARAISON
  -- seulement : la colonne, elle, garde la valeur non arrondie, comme le
  -- moteur TypeScript qui n'arrondit qu'à l'affichage.
  perform pg_temp.noter('A2-DB2', 'la part du créneau applique les bp du PROFIL puis ceux du CRÉNEAU',
    (select round(target_protein_g, 2) = 60.00
        and round(target_carb_g, 2)    = 80.00
        and round(target_fat_g, 2)     = 26.67
        and round(target_kcal, 2)      = 800.00
       from public.consumed_meals where id = v_midi));

  -- Contrôle DISCRIMINANT : un seul étage (2000 × 0,40 appliqué directement
  -- au créneau) donnerait P = 200, G = 200, L = 88,9. Si un jour la formule
  -- glisse vers cette variante, la ligne ci-dessus rougit — et celle-ci dit
  -- pourquoi.
  perform pg_temp.noter('A2-DB2', 'ce n''est PAS la variante à un seul étage (qui donnerait 200 g de protéines)',
    (select round(target_protein_g, 2) <> 200.00 from public.consumed_meals where id = v_midi));

  perform pg_temp.noter('A2-DB2', 'les kcal suivent le 4/4/9 des grammes du créneau',
    (select round(target_kcal, 4)
          = round(target_protein_g * 4 + target_carb_g * 4 + target_fat_g * 9, 4)
       from public.consumed_meals where id = v_midi));

  -- Les macros TAPÉES par le coach priment — même règle que
  -- StudentPrescribedWeek.tsx, et leurs kcal sont reprises telles quelles :
  -- elles ne sont pas forcément le 4/4/9 de ses propres macros, et les
  -- recalculer trahirait ce qu'il a écrit.
  perform pg_temp.noter('A2-DB2', 'les macros saisies par le coach priment sur la dérivation',
    (select target_kcal = 500 and target_protein_g = 30
        and target_carb_g = 50 and target_fat_g = 15
       from public.consumed_meals where id = v_matin));

  perform pg_temp.noter('A2-DB2', 'le libellé et le créneau viennent du repas prescrit',
    (select label = 'Petit-déjeuner' and slot_key = 'breakfast' and kind = 'prescribed'
        and prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000b'
       from public.consumed_meals where id = v_matin));

  perform pg_temp.noter('A2-DB2', 'la position reprend le display_order du coach',
    (select position from public.consumed_meals where id = v_midi) = 2
    and (select position from public.consumed_meals where id = v_matin) = 0);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB2 (b) — un créneau DÉSACTIVÉ n'a pas d'objectif (il n'en a pas « zéro »)
-- ---------------------------------------------------------------------
do $$
declare v_soir uuid;
begin
  v_soir := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000d', date '2026-08-13');

  perform pg_temp.noter('A2-DB2', 'le repas s''ouvre quand même — l''élève doit pouvoir saisir',
    v_soir is not null);

  -- `slotMacrosForDay` rend `null` pour un créneau désactivé. Écrire des zéros
  -- afficherait « objectif : 0 kcal », ce qui est une information FAUSSE : le
  -- coach n'a pas prescrit zéro, il n'a rien prescrit.
  perform pg_temp.noter('A2-DB2', 'les quatre cibles sont NULL, et non pas zéro',
    (select target_kcal is null and target_protein_g is null
        and target_carb_g is null and target_fat_g is null
       from public.consumed_meals where id = v_soir));

  -- Le repas prescrit n'a pas de nom : le libellé retombe sur le créneau,
  -- jamais sur une chaîne vide — la contrainte l'interdirait.
  perform pg_temp.noter('A2-DB2', 'un repas prescrit sans nom retombe sur son créneau',
    (select label = 'dinner' and slot_key = 'dinner' from public.consumed_meals where id = v_soir));

  perform pg_temp.noter('A2-DB2', 'sa position suit l''ordre canonique des créneaux, pas zéro',
    (select position from public.consumed_meals where id = v_soir) = 5);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB4 (b) / A2-DB5 (a) — créer un repas personnel, le renommer, le supprimer
-- ---------------------------------------------------------------------
do $$
declare v_col uuid; v_resto uuid; v_entree uuid; v_ok boolean;
begin
  v_col   := public.creer_repas_eleve(date '2026-08-13', '  Collation  ');
  v_resto := public.creer_repas_eleve(date '2026-08-13', 'Restaurant');

  perform pg_temp.noter('A2-DB4', 'deux repas libres le MÊME jour coexistent',
    v_col is not null and v_resto is not null and v_col <> v_resto);

  perform pg_temp.noter('A2-DB4', 'le libellé est nettoyé, sans cible, et marqué student',
    (select label = 'Collation' and kind = 'student' and target_kcal is null
        and prescribed_meal_id is null
       from public.consumed_meals where id = v_col));

  -- Bande séparée : un repas libre se range TOUJOURS après le plan, quel que
  -- soit l'ordre dans lequel l'élève a ouvert ses repas prescrits — ils le
  -- sont paresseusement.
  perform pg_temp.noter('A2-DB4', 'les repas libres se rangent après le plan (position ≥ 1000)',
    (select min(position) from public.consumed_meals
      where kind = 'student' and consumed_on = date '2026-08-13') >= 1000
    and (select max(position) from public.consumed_meals
          where kind = 'prescribed' and consumed_on = date '2026-08-13') < 1000);

  perform pg_temp.noter('A2-SUP', 'un libellé vide est refusé à la création',
    pg_temp.refuse($q$ select public.creer_repas_eleve(date '2026-08-13', '   ') $q$));

  -- PIÈGE D'INSTANTANÉ : `accepte(sql) and (select …)` évalue la
  -- sous-requête dans le MÊME instantané que l'appel de fonction — elle ne
  -- voit donc pas l'écriture que `accepte` vient de faire. Écriture et
  -- lecture sont séparées en deux instructions. Mesuré trois fois sur A1.
  v_ok := pg_temp.accepte(format('select public.renommer_repas_eleve(%L, %L)', v_col, '  Collation 16h  '));
  perform pg_temp.noter('A2-DB5', 'renommer fonctionne, et nettoie le libellé',
    v_ok and (select label from public.consumed_meals where id = v_col) = 'Collation 16h');

  perform pg_temp.noter('A2-SUP', 'renommer avec un libellé vide est refusé',
    pg_temp.refuse(format('select public.renommer_repas_eleve(%L, %L)', v_col, '  ')));

  -- Les entrées partent avec le repas, par la CASCADE de la clé étrangère
  -- composite — pas par une suppression applicative en deux temps.
  v_entree := public.ajouter_aliment_manuel(v_resto, 'Pizza', 300, 'g', 10, 25, 12);
  v_ok := pg_temp.accepte(format('select public.supprimer_repas_eleve(%L)', v_resto));
  perform pg_temp.noter('A2-DB5', 'supprimer un repas libre emporte ses entrées (cascade)',
    v_ok
    and (select count(*) from public.consumed_meals where id = v_resto) = 0
    and (select count(*) from public.meal_entries where id = v_entree) = 0);

  perform pg_temp.noter('A2-DB5', 'supprimer deux fois le même repas est refusé la seconde',
    pg_temp.refuse(format('select public.supprimer_repas_eleve(%L)', v_resto)));
end $$;

-- ---------------------------------------------------------------------
-- A2-DB5 (b) — un repas PRESCRIT n'est ni renommable ni supprimable
-- ---------------------------------------------------------------------
do $$
declare v_midi uuid;
begin
  select id into v_midi from public.consumed_meals
   where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000a'
     and consumed_on = date '2026-08-13';

  perform pg_temp.noter('A2-DB5', 'renommer un repas prescrit est refusé',
    pg_temp.refuse(format('select public.renommer_repas_eleve(%L, %L)', v_midi, 'Pirate')));

  perform pg_temp.noter('A2-DB5', 'supprimer un repas prescrit est refusé',
    pg_temp.refuse(format('select public.supprimer_repas_eleve(%L)', v_midi)));

  perform pg_temp.noter('A2-DB5', 'et il est intact après les deux tentatives',
    (select label = 'Déjeuner' and kind = 'prescribed'
       from public.consumed_meals where id = v_midi));

  -- La clause `kind = 'student'` des deux RPC n'est pas décorative : c'est la
  -- règle produit, écrite dans le WHERE.
  perform pg_temp.noter('A2-DB5', 'les deux RPC exigent kind = student dans leur corps',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('renommer_repas_eleve', 'supprimer_repas_eleve')
        and p.prosrc ~ 'kind\s*=\s*''student''') = 2);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB14 — L'ÉLÈVE NE PEUT PAS INJECTER DE MACROS ARBITRAIRES
-- ---------------------------------------------------------------------
-- C'est la règle bloquante du lot. Tant que `authenticated` garde le moindre
-- privilège d'écriture sur meal_entries, tout le calcul serveur n'est qu'une
-- politesse : PostgREST expose la table directement.
do $$
declare v_midi uuid;
begin
  select id into v_midi from public.consumed_meals
   where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000a'
     and consumed_on = date '2026-08-13';

  perform pg_temp.noter('A2-DB14', 'INSERT direct sur meal_entries refusé', pg_temp.refuse(format($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', %L, 'free', 'Macros fabriquees',
            1, 'g', 9999, 9999, 9999) $q$, v_midi)));

  perform pg_temp.noter('A2-DB14', 'UPDATE et DELETE directs refusés',
    pg_temp.refuse($q$ update public.meal_entries set protein_g = 9999 $q$)
    and pg_temp.refuse($q$ delete from public.meal_entries $q$));

  perform pg_temp.noter('A2-DB14', 'aucun privilège d''écriture ne subsiste pour authenticated',
    not exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and grantee = 'authenticated'
                   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')));

  perform pg_temp.noter('A2-DB14', 'la LECTURE, elle, reste ouverte à l''élève',
    exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'meal_entries'
               and grantee = 'authenticated' and privilege_type = 'SELECT'));

  -- Et le client ne peut pas non plus écrire ses conteneurs à la main : la
  -- cible figée serait fabricable.
  perform pg_temp.noter('A2-DB14', 'écrire un conteneur à la main est refusé aussi', pg_temp.refuse($q$
    insert into public.consumed_meals (student_id, consumed_on, kind, label, target_kcal)
    values ('50000000-0000-4000-8000-00000000000a', date '2026-08-13', 'prescribed', 'Faux', 9999) $q$));

  perform pg_temp.noter('A2-DB14', 'aucune RPC ne prend de macro finale en paramètre',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('ajouter_aliment_catalogue', 'modifier_quantite_entree')
        and pg_get_function_arguments(p.oid) ~ '(protein|carb|fat)') = 0);

  -- L'aliment manuel EST une exception assumée : l'élève fournit les valeurs
  -- POUR 100 lues sur l'emballage. Le serveur multiplie — le client ne dicte
  -- donc jamais le RÉSULTAT, seulement la référence.
  perform pg_temp.noter('A2-DB14', 'l''aliment manuel prend des valeurs POUR 100, pas le résultat',
    (select pg_get_function_arguments(p.oid) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ajouter_aliment_manuel')
    ~ 'p_protein_per_100.*p_carb_per_100.*p_fat_per_100');
end $$;

-- ---------------------------------------------------------------------
-- A2-DB7 / A2-DB11 / A2-DB12 / A2-DB13 — `ajouter_aliment_catalogue`
-- ---------------------------------------------------------------------
do $$
declare v_midi uuid; v_e1 uuid; v_e2 uuid;
begin
  select id into v_midi from public.consumed_meals
   where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000a'
     and consumed_on = date '2026-08-13';

  v_e1 := public.ajouter_aliment_catalogue(v_midi, 'f0000000-0000-4000-8000-00000000000a', 150, 'g');

  perform pg_temp.noter('A2-DB7', '150 g de banane → macros calculées par le serveur',
    (select protein_g = 1.65 and carb_g = 34.2 and fat_g = 0.45
        and label = 'Banane' and source_type = 'catalog_food'
        and food_id = 'f0000000-0000-4000-8000-00000000000a'
       from public.meal_entries where id = v_e1));

  -- La pièce n'est proposable que si l'aliment dit ce qu'elle pèse.
  v_e2 := public.ajouter_aliment_catalogue(v_midi, 'f0000000-0000-4000-8000-00000000000a', 2, 'piece');
  perform pg_temp.noter('A2-DB11', '2 pièces × 120 g → les macros de 240 g',
    (select protein_g = 2.64 and carb_g = 54.72 and fat_g = 0.72 and unit = 'piece' and quantity = 2
       from public.meal_entries where id = v_e2));

  perform pg_temp.noter('A2-DB11', 'la pièce est refusée quand piece_weight_g manque',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000b', 1, 'piece') $q$, v_midi)));

  -- AUCUNE conversion ml ↔ g n'est inventée : food_catalog ne porte pas de
  -- densité, et un facteur imaginé créerait une seconde convention.
  perform pg_temp.noter('A2-DB13', 'des grammes sur un aliment en ml sont refusés, sans conversion inventée',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000b', 100, 'g') $q$, v_midi))
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'food_catalog'
                       and column_name ~ '(densite|density|g_per_ml)'));

  perform pg_temp.noter('A2-DB13', 'un aliment ARCHIVÉ est refusé',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000c', 100, 'g') $q$, v_midi)));

  perform pg_temp.noter('A2-DB13', 'un aliment PRIVÉ de coach est refusé, même celui de SON coach',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000d', 100, 'g') $q$, v_midi)));

  perform pg_temp.noter('A2-DB12', 'une quantité nulle ou négative est refusée',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000a', 0, 'g') $q$, v_midi))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_catalogue(
      %L, 'f0000000-0000-4000-8000-00000000000a', -5, 'g') $q$, v_midi)));
end $$;

-- ---------------------------------------------------------------------
-- A2-DB8 / A2-DB9 / A2-DB15 — LE SCÉNARIO NOMMÉ DANS L'ÉNONCÉ
-- ---------------------------------------------------------------------
-- Le §14 du contrat produit décrit un parcours précis : une banane de 120 g
-- au petit déjeuner, corrigée en 150 g, puis supprimée. Ces trois contrôles
-- l'exécutent avec les valeurs EXACTES attendues, plutôt que de se contenter
-- d'une quantité arbitraire qui démontrerait la mécanique sans démontrer le
-- chiffre.
--
--   Banane du catalogue : 1,1 / 22,8 / 0,3 pour 100 g.
--     120 g → 1,32 / 27,36 / 0,36
--     150 g → 1,65 / 34,20 / 0,45
--
-- Un repas neuf est utilisé : les sections précédentes ont laissé des entrées
-- dans le déjeuner, et un total de repas se vérifie sur un contenu connu.
do $$
declare v_pdj uuid; v_banane uuid; v_ok boolean; v_second uuid;
begin
  v_pdj := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000b', date '2026-08-14');

  -- ── A2-DB8 : 120 g donne EXACTEMENT l'instantané attendu ──────────────
  v_banane := public.ajouter_aliment_catalogue(
    v_pdj, 'f0000000-0000-4000-8000-00000000000a', 120, 'g');
  perform pg_temp.noter('A2-DB8', '120 g de banane donnent exactement 1,32 / 27,36 / 0,36',
    (select quantity = 120 and unit = 'g'
        and protein_g = 1.32 and carb_g = 27.36 and fat_g = 0.36
       from public.meal_entries where id = v_banane));

  perform pg_temp.noter('A2-DB8', 'et ses kcal dérivées valent bien 4·P + 4·G + 9·L',
    (select round(protein_g * 4 + carb_g * 4 + fat_g * 9, 2) = 117.96
       from public.meal_entries where id = v_banane));

  -- ── A2-DB15 : le total du REPAS est la somme de ses entrées ───────────
  -- Une seule entrée d'abord : le total du repas doit valoir cette entrée.
  perform pg_temp.noter('A2-DB15', 'total du repas = son unique entrée',
    (select round(sum(e.protein_g), 2) = 1.32 and round(sum(e.carb_g), 2) = 27.36
        and round(sum(e.fat_g), 2) = 0.36
       from public.meal_entries e where e.consumed_meal_id = v_pdj));

  -- Puis une seconde : le total doit suivre, sans qu'aucune valeur ne soit
  -- stockée au niveau du repas — `consumed_meals` ne porte AUCUNE colonne de
  -- total, précisément pour qu'elle ne puisse pas diverger de ses entrées.
  v_second := public.ajouter_aliment_manuel(v_pdj, 'Flocons', 50, 'g', 12, 60, 7);
  perform pg_temp.noter('A2-DB15', 'total du repas = somme de SES entrées, pas une valeur stockée',
    (select round(sum(e.protein_g), 2) = 7.32 and round(sum(e.carb_g), 2) = 57.36
        and round(sum(e.fat_g), 2) = 3.86
       from public.meal_entries e where e.consumed_meal_id = v_pdj)
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'consumed_meals'
                       and column_name ~ '(total|consumed_kcal|consumed_protein)'));

  perform pg_temp.noter('A2-DB15', 'le total d''un repas ne compte QUE ses propres entrées',
    (select count(*) from public.meal_entries where consumed_meal_id = v_pdj) = 2
    and (select count(*) from public.meal_entries) > 2);

  -- ── A2-DB9 : 120 → 150 g recalcule l'instantané ───────────────────────
  -- Écriture puis lecture en DEUX instructions (piège d'instantané, cf. A2-DB4).
  v_ok := pg_temp.accepte(format(
    'select public.modifier_quantite_entree(%L, 150, ''g'')', v_banane));
  perform pg_temp.noter('A2-DB9', '120 g → 150 g : l''instantané est recalculé à 1,65 / 34,20 / 0,45',
    v_ok and (select quantity = 150 and protein_g = 1.65 and carb_g = 34.2 and fat_g = 0.45
                from public.meal_entries where id = v_banane));

  perform pg_temp.noter('A2-DB15', 'et le total du repas suit la correction',
    (select round(sum(e.protein_g), 2) = 7.65 and round(sum(e.carb_g), 2) = 64.2
       from public.meal_entries e where e.consumed_meal_id = v_pdj));

  -- Supprimer l'aliment ramène le total à la seule entrée restante : le §14 C.
  perform public.supprimer_entree(v_banane);
  perform pg_temp.noter('A2-DB15', 'supprimer un aliment ramène le total à ce qui reste',
    (select round(sum(e.protein_g), 2) = 6.00 and round(sum(e.carb_g), 2) = 30.00
       from public.meal_entries e where e.consumed_meal_id = v_pdj));

  perform public.supprimer_entree(v_second);
  perform pg_temp.noter('A2-DB15', 'un repas vidé compte zéro, et le conteneur subsiste',
    (select count(*) from public.meal_entries where consumed_meal_id = v_pdj) = 0
    and (select count(*) from public.consumed_meals where id = v_pdj) = 1);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB7 (b) — `ajouter_aliment_manuel` : le serveur calcule aussi
-- ---------------------------------------------------------------------
do $$
declare v_col uuid; v_e uuid; v_avant int;
begin
  select id into v_col from public.consumed_meals
   where kind = 'student' and label = 'Collation 16h';
  v_avant := (select count(*) from public.food_catalog);

  v_e := public.ajouter_aliment_manuel(v_col, '  Barre maison  ', 60, 'g', 20, 40, 10);

  perform pg_temp.noter('A2-DB7', 'les valeurs POUR 100 sont multipliées par la quantité',
    (select protein_g = 12 and carb_g = 24 and fat_g = 6 and quantity = 60
        and label = 'Barre maison' and source_type = 'free' and food_id is null
       from public.meal_entries where id = v_e));

  -- Un aliment libre ne devient JAMAIS un food_catalog global : ce serait
  -- publier la saisie d'un élève comme une référence pour tous.
  perform pg_temp.noter('A2-SUP', 'AUCUNE entrée n''a été créée dans food_catalog',
    (select count(*) from public.food_catalog) = v_avant);

  perform pg_temp.noter('A2-DB13', 'une unité hors g/ml est refusée',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(
      %L, 'X', 1, 'poignee', 1, 1, 1) $q$, v_col)));

  perform pg_temp.noter('A2-SUP', 'un libellé vide est refusé',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(
      %L, '   ', 100, 'g', 1, 1, 1) $q$, v_col)));

  perform pg_temp.noter('A2-DB14', 'des macros négatives ou NULL sont refusées',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(
      %L, 'X', 100, 'g', -1, 1, 1) $q$, v_col))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(
      %L, 'X', 100, 'g', null, 1, 1) $q$, v_col)));

  perform pg_temp.noter('A2-DB3', 'viser le repas d''un autre élève est refusé',
    pg_temp.refuse($q$ select public.ajouter_aliment_manuel(
      '00000000-0000-4000-8000-000000000000', 'X', 100, 'g', 1, 1, 1) $q$));
end $$;

-- ---------------------------------------------------------------------
-- A2-POLISH3…7 — LA RÉFÉRENCE SUIT L'UNITÉ, ET RIEN D'AUTRE
-- ---------------------------------------------------------------------
-- Contrat A2.1 : en grammes, les valeurs saisies valent POUR 100 G ; en
-- millilitres, POUR 100 ML. Le serveur multiplie par la quantité dans CETTE
-- MÊME unité, et n'invente aucune densité pour passer de l'une à l'autre —
-- `food_catalog` n'en porte pas, et en imaginer une créerait une seconde
-- convention nutritionnelle à côté du 4/4/9.
--
-- Le contrôle DISCRIMINANT est le second : la même référence, la même
-- quantité, deux unités différentes doivent rendre des nombres IDENTIQUES.
-- Toute conversion implicite ml → g (× 1,03, × 1, n'importe quoi) les ferait
-- diverger, et ce contrôle rougirait.
do $$
declare v_repas uuid; v_ml uuid; v_g uuid; v_dec uuid; v_ok boolean;
begin
  v_repas := public.creer_repas_eleve(date '2026-08-13', 'Controle des unites');

  -- ── A2-POLISH4 : 250 ml, valeurs pour 100 ml → × 2,5 ──────────────────
  v_ml := public.ajouter_aliment_manuel(v_repas, 'Boisson', 250, 'ml', 3, 5, 2);
  perform pg_temp.noter('A2-POLISH4', '250 ml avec des valeurs /100 ml donnent exactement × 2,5',
    (select unit = 'ml' and quantity = 250
        and protein_g = 7.5 and carb_g = 12.5 and fat_g = 5
       from public.meal_entries where id = v_ml));

  -- ── A2-POLISH3 : 250 g, valeurs pour 100 g → × 2,5 aussi ──────────────
  v_g := public.ajouter_aliment_manuel(v_repas, 'Poudre', 250, 'g', 3, 5, 2);
  perform pg_temp.noter('A2-POLISH3', '250 g avec des valeurs /100 g donnent exactement × 2,5',
    (select unit = 'g' and quantity = 250
        and protein_g = 7.5 and carb_g = 12.5 and fat_g = 5
       from public.meal_entries where id = v_g));

  -- ── A2-POLISH6 : AUCUNE conversion implicite ml → g ───────────────────
  perform pg_temp.noter('A2-POLISH6', 'même référence, même quantité, deux unités : nombres IDENTIQUES',
    (select protein_g from public.meal_entries where id = v_ml)
      = (select protein_g from public.meal_entries where id = v_g)
    and (select carb_g from public.meal_entries where id = v_ml)
      = (select carb_g from public.meal_entries where id = v_g)
    and (select fat_g from public.meal_entries where id = v_ml)
      = (select fat_g from public.meal_entries where id = v_g));

  perform pg_temp.noter('A2-POLISH6', 'aucune densité, aucun facteur de conversion nulle part',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and column_name ~* '(densite|density|g_per_ml|ml_per_g)')
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ajouter_aliment_manuel'
            and p.prosrc ~* '(densit|1\.03|/ 1000|\* 1000)') = 0);

  -- ── A2-POLISH5 : la correction conserve la référence /100 ml ──────────
  v_ok := pg_temp.accepte(format('select public.modifier_quantite_entree(%L, 400, ''ml'')', v_ml));
  perform pg_temp.noter('A2-POLISH5', 'corriger 250 ml → 400 ml garde la référence /100 ml',
    v_ok and (select quantity = 400 and protein_g = 12 and carb_g = 20 and fat_g = 8
                from public.meal_entries where id = v_ml));

  perform pg_temp.noter('A2-POLISH6', 'changer d''unité pendant une correction est REFUSÉ',
    pg_temp.refuse(format('select public.modifier_quantite_entree(%L, 400, ''g'')', v_ml)));

  -- ── A2-POLISH7 : quantité ≤ 0 refusée, dans les deux unités ───────────
  perform pg_temp.noter('A2-POLISH7', 'quantité nulle ou négative refusée, en g comme en ml',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(%L, 'X', 0, 'ml', 1, 1, 1) $q$, v_repas))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(%L, 'X', -5, 'ml', 1, 1, 1) $q$, v_repas))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(%L, 'X', 0, 'g', 1, 1, 1) $q$, v_repas))
    and pg_temp.refuse(format($q$ select public.modifier_quantite_entree(%L, 0, 'ml') $q$, v_ml)));

  -- ── A2-POLISH8 : les décimales traversent intactes ────────────────────
  -- 250 ml × 1,5 / 100 = 3,75. Un arrondi prématuré côté serveur donnerait 4.
  v_dec := public.ajouter_aliment_manuel(v_repas, 'Decimales', 250, 'ml', 1.5, 0.25, 0.125);
  perform pg_temp.noter('A2-POLISH8', 'les décimales des valeurs /100 traversent sans arrondi prématuré',
    (select protein_g = 3.75 and carb_g = 0.625 and fat_g = 0.3125
       from public.meal_entries where id = v_dec));

  -- Une unité hors g/ml reste refusée : la pièce n'a pas de sens pour un
  -- aliment saisi à la main, qui ne dit pas ce que pèse une pièce.
  perform pg_temp.noter('A2-POLISH3', 'une unité hors g/ml reste refusée en saisie manuelle',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(%L, 'X', 1, 'piece', 1, 1, 1) $q$, v_repas))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_manuel(%L, 'X', 1, 'portion', 1, 1, 1) $q$, v_repas)));

  perform public.supprimer_repas_eleve(v_repas);
end $$;

-- ---------------------------------------------------------------------
-- A2-DB9 / A2-DB10 — corriger une quantité, sans jamais suivre sa source
-- ---------------------------------------------------------------------
do $$
declare v_cat uuid; v_libre uuid; v_ok boolean;
begin
  select id into v_cat from public.meal_entries
   where source_type = 'catalog_food' and unit = 'g' and quantity = 150;
  select id into v_libre from public.meal_entries where label = 'Barre maison';

  -- Écriture puis lecture en DEUX instructions : voir la note de A2-DB8.
  v_ok := pg_temp.accepte(format('select public.modifier_quantite_entree(%L, 200, ''g'')', v_cat));
  perform pg_temp.noter('A2-DB9', 'catalogue : 150 g → 200 g, macros recalculées depuis la source',
    v_ok and (select quantity = 200 and protein_g = 2.2 and carb_g = 45.6 and fat_g = 0.6
                from public.meal_entries where id = v_cat));

  v_ok := pg_temp.accepte(format('select public.modifier_quantite_entree(%L, 90, ''g'')', v_libre));
  perform pg_temp.noter('A2-DB9', 'manuel : 60 g → 90 g, la référence pour 100 est conservée',
    v_ok and (select quantity = 90 and protein_g = 18 and carb_g = 36 and fat_g = 9
                from public.meal_entries where id = v_libre));

  perform pg_temp.noter('A2-DB12', 'une quantité invalide est refusée et n''écrit rien',
    pg_temp.refuse(format('select public.modifier_quantite_entree(%L, 0, ''g'')', v_cat))
    and (select quantity = 200 from public.meal_entries where id = v_cat));

  perform pg_temp.noter('A2-DB3', 'corriger l''entrée d''un autre élève est refusé',
    pg_temp.refuse($q$ select public.modifier_quantite_entree(
      '00000000-0000-4000-8000-000000000000', 100, 'g') $q$));

  v_ok := pg_temp.accepte(format('select public.supprimer_entree(%L)', v_libre));
  perform pg_temp.noter('A2-SUP', 'supprimer sa propre entrée fonctionne, celle d''un autre non',
    v_ok
    and (select count(*) from public.meal_entries where id = v_libre) = 0
    and pg_temp.refuse(format('select public.supprimer_entree(%L)', v_libre)));
end $$;

reset role;

-- ── A2-DB13 (suite) : l'instantané ne SUIT PAS sa source ────────────────
-- Contrat hérité de A1 : rien de ce qui arrive à food_catalog ne réécrit une
-- entrée existante. Ce qui change en A2, c'est la CORRECTION VOLONTAIRE, qui
-- écrit un instantané neuf depuis la source ACTUELLE.
update public.food_catalog set protein_per_100 = 99, carb_per_100 = 99, fat_per_100 = 99
 where id = 'f0000000-0000-4000-8000-00000000000a';

do $$
begin
  perform pg_temp.noter('A2-DB10', 'corriger le catalogue ne réécrit AUCUNE entrée déjà saisie',
    (select protein_g = 2.2 and carb_g = 45.6 and fat_g = 0.6
       from public.meal_entries where source_type = 'catalog_food' and quantity = 200));
end $$;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');

do $$
declare v_cat uuid; v_ok boolean;
begin
  select id into v_cat from public.meal_entries where quantity = 200 and source_type = 'catalog_food';

  -- Mais une correction EXPLICITE, elle, repart de la source d'aujourd'hui.
  v_ok := pg_temp.accepte(format('select public.modifier_quantite_entree(%L, 100, ''g'')', v_cat));
  perform pg_temp.noter('A2-DB10', 'une correction explicite repart de la source ACTUELLE',
    v_ok and (select protein_g = 99 and carb_g = 99 and fat_g = 99
                from public.meal_entries where id = v_cat));

  -- On remet cette entrée à un état connu : A2-DB14 compte des totaux, et
  -- une section qui hérite silencieusement de l'état d'une autre rend ses
  -- attentes illisibles.
  perform public.supprimer_entree(v_cat);
end $$;

reset role;
update public.food_catalog set protein_per_100 = 1.1, carb_per_100 = 22.8, fat_per_100 = 0.3
 where id = 'f0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');

-- ---------------------------------------------------------------------
-- A2-SUP — la cible est FIGÉE : le coach change, la journée ouverte reste
-- ---------------------------------------------------------------------
reset role;

-- Le coach double ses calories et change ses macros de petit-déjeuner APRÈS
-- que l'élève a ouvert sa journée.
update public.nutrition_plan_profiles set daily_calories = 4000
 where id = '80000000-0000-4000-8000-00000000000a';
update public.meals set macros = '{"calories": 999, "protein": 99, "carbs": 99, "fat": 99}'
 where id = 'b0000000-0000-4000-8000-00000000000b';

do $$
declare v_midi uuid; v_matin uuid;
begin
  select id into v_midi from public.consumed_meals
   where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000a' and consumed_on = date '2026-08-13';
  select id into v_matin from public.consumed_meals
   where prescribed_meal_id = 'b0000000-0000-4000-8000-00000000000b' and consumed_on = date '2026-08-13';

  perform pg_temp.noter('A2-SUP', 'la cible dérivée d''une journée déjà ouverte ne bouge pas',
    (select round(target_protein_g, 2) = 60.00 and round(target_kcal, 2) = 800.00
       from public.consumed_meals where id = v_midi));

  perform pg_temp.noter('A2-SUP', 'la cible saisie d''une journée déjà ouverte ne bouge pas non plus',
    (select target_kcal = 500 and target_protein_g = 30
       from public.consumed_meals where id = v_matin));
end $$;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');

do $$
declare v_neuf uuid;
begin
  -- Une journée ouverte APRÈS le changement prend, elle, la NOUVELLE cible :
  -- l'instantané est figé par journée, il n'est pas figé pour toujours.
  v_neuf := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-20');
  perform pg_temp.noter('A2-SUP', 'une journée ouverte APRÈS le changement prend la nouvelle cible',
    (select round(target_protein_g, 2) = 120.00 and round(target_kcal, 2) = 1600.00
       from public.consumed_meals where id = v_neuf));

  -- Rouvrir une journée déjà ouverte ne la recalcule pas : c'est l'idempotence
  -- de A2-DB4 qui protège la cible figée.
  perform pg_temp.noter('A2-SUP', 'rouvrir une journée figée ne la recalcule pas',
    (select round(target_protein_g, 2) from public.consumed_meals
      where id = public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000a', date '2026-08-13'))
    = 60.00);
end $$;

reset role;
update public.nutrition_plan_profiles set daily_calories = 2000
 where id = '80000000-0000-4000-8000-00000000000a';
update public.meals set macros = '{"calories": 500, "protein": 30, "carbs": 50, "fat": 15}'
 where id = 'b0000000-0000-4000-8000-00000000000b';

-- ---------------------------------------------------------------------
-- A2-DB16 — totaux JOURNÉE = repas prescrits + repas élèves, pour UN élève
-- ---------------------------------------------------------------------
-- L'élève B mange le même jour, pour éprouver que les totaux ne se mélangent
-- jamais. MESURÉ : une première version de la fonction, sans sujet explicite,
-- rendait au coach la SOMME de ses élèves — un total de journée faux, présenté
-- comme un total de journée.
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000005');  -- élève B
do $$
declare v_b uuid;
begin
  v_b := public.ouvrir_repas_prescrit('b0000000-0000-4000-8000-00000000000c', date '2026-08-13');
  perform public.ajouter_aliment_catalogue(v_b, 'f0000000-0000-4000-8000-00000000000a', 100, 'g');
  perform pg_temp.noter('A2-DB16', 'l''élève B voit SON total, et lui seul',
    (select round(protein_g, 2) from public.consommation_du_jour(date '2026-08-13')) = 1.10);
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A
do $$
declare v_col uuid;
begin
  -- ÉTAT EXACT à ce point, hérité de A2-DB11 à A2-DB13 : il ne reste qu'une
  -- seule entrée pour l'élève A ce jour-là — les 2 pièces de banane, soit
  -- 240 g à 1,1 / 22,8 / 0,3 pour 100 → 2,64 / 54,72 / 0,72. Les autres ont
  -- été supprimées par les contrôles de correction.
  perform pg_temp.noter('A2-DB16', 'le total de l''élève A somme ses repas prescrits',
    (select round(protein_g, 2) = 2.64 and round(carb_g, 2) = 54.72 and round(fat_g, 2) = 0.72
       from public.consommation_du_jour(date '2026-08-13')));

  -- Un aliment posé dans un repas LIBRE compte dans le total du jour : c'est
  -- tout l'objet du §7 de l'énoncé.
  select id into v_col from public.consumed_meals where kind = 'student' and label = 'Collation 16h';
  -- 30 g d'amandes à 20 / 10 / 50 pour 100 → 6 / 3 / 15.
  perform public.ajouter_aliment_manuel(v_col, 'Amandes', 30, 'g', 20, 10, 50);
  perform pg_temp.noter('A2-DB16', 'un aliment d''un repas LIBRE compte dans le total du jour',
    (select round(protein_g, 2) = 8.64 and round(carb_g, 2) = 57.72 and round(fat_g, 2) = 15.72
       from public.consommation_du_jour(date '2026-08-13')));

  perform pg_temp.noter('A2-DB16', 'les kcal du total suivent le 4/4/9',
    (select round(kcal, 4) = round(protein_g * 4 + carb_g * 4 + fat_g * 9, 4)
       from public.consommation_du_jour(date '2026-08-13')));

  perform pg_temp.noter('A2-DB16', 'une journée sans consommation rend zéro, pas NULL',
    (select protein_g = 0 and carb_g = 0 and fat_g = 0 and kcal = 0
       from public.consommation_du_jour(date '2026-01-01')));

  -- Nommer un autre élève ne donne rien : la RLS reste seule juge.
  perform pg_temp.noter('A2-DB6', 'nommer un AUTRE élève ne rend rien à un élève',
    (select protein_g from public.consommation_du_jour(
       date '2026-08-13', '50000000-0000-4000-8000-00000000000b')) = 0);
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000002');  -- coach A
do $$
begin
  -- Le coach doit NOMMER l'élève. Sans sujet, current_student_id() est NULL
  -- pour lui : il obtient zéro, jamais une somme de plusieurs journées.
  perform pg_temp.noter('A2-DB16', 'le coach sans sujet explicite n''obtient PAS une somme d''élèves',
    (select protein_g from public.consommation_du_jour(date '2026-08-13')) = 0);

  perform pg_temp.noter('A2-DB16', 'le coach nomme SON élève et obtient son total exact',
    (select round(protein_g, 2) from public.consommation_du_jour(
       date '2026-08-13', '50000000-0000-4000-8000-00000000000a')) = 8.64);

  perform pg_temp.noter('A2-DB6', 'le coach nomme l''élève d''un AUTRE coach et n''obtient rien',
    (select protein_g from public.consommation_du_jour(
       date '2026-08-13', '50000000-0000-4000-8000-00000000000b')) = 0);

  perform pg_temp.noter('A2-SUP', 'la fonction est security INVOKER — elle n''emprunte aucun privilège',
    (select not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'consommation_du_jour'));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A2-DB6 / A2-SUP — RLS de consumed_meals, et le coach qui ne modifie rien
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A
do $$
begin
  perform pg_temp.noter('A2-SUP', 'l''élève A lit ses repas et AUCUN autre',
    pg_temp.compte($q$ select count(*)::int from public.consumed_meals $q$) > 0
    and pg_temp.compte($q$ select count(*)::int from public.consumed_meals
                            where student_id <> '50000000-0000-4000-8000-00000000000a' $q$) = 0);
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000002');  -- coach A
do $$
begin
  perform pg_temp.noter('A2-SUP', 'coach A lit les repas de SON élève',
    pg_temp.compte($q$ select count(*)::int from public.consumed_meals
                        where student_id = '50000000-0000-4000-8000-00000000000a' $q$) > 0);

  perform pg_temp.noter('A2-DB6', 'coach A ne lit PAS les repas de l''élève de coach B',
    pg_temp.compte($q$ select count(*)::int from public.consumed_meals
                        where student_id = '50000000-0000-4000-8000-00000000000b' $q$) = 0);

  perform pg_temp.noter('A2-DB6', 'coach A n''écrit rien, ni directement ni par RPC',
    pg_temp.refuse($q$ update public.consumed_meals set label = 'coach' $q$)
    and pg_temp.refuse($q$ delete from public.consumed_meals $q$)
    and pg_temp.refuse($q$ select public.creer_repas_eleve(date '2026-08-13', 'Par le coach') $q$));
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000001');  -- admin
do $$
begin
  perform pg_temp.noter('A2-SUP', 'l''administrateur lit les repas des deux élèves',
    pg_temp.compte($q$ select count(distinct student_id)::int from public.consumed_meals $q$) = 2);
end $$;
reset role;

set local role anon;
select pg_temp.connecte(null);
do $$
begin
  perform pg_temp.noter('A2-DB6', 'un anonyme ne lit rien et n''appelle aucune RPC',
    pg_temp.compte($q$ select count(*)::int from public.consumed_meals $q$) = -1
    and pg_temp.refuse($q$ select public.creer_repas_eleve(date '2026-08-13', 'Anonyme') $q$)
    and pg_temp.refuse($q$ select public.consommation_du_jour(date '2026-08-13') $q$));
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('A2-DB14', 'les privilèges de table sont : SELECT pour authenticated, rien pour anon',
    exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'consumed_meals'
               and grantee = 'authenticated' and privilege_type = 'SELECT')
    and not exists (select 1 from information_schema.role_table_grants
                     where table_schema = 'public' and table_name = 'consumed_meals'
                       and grantee = 'authenticated'
                       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
    and not exists (select 1 from information_schema.role_table_grants
                     where table_schema = 'public' and table_name = 'consumed_meals'
                       and grantee in ('anon', 'PUBLIC')));

  perform pg_temp.noter('A2-DB6', 'aucune RPC de A2 n''est exécutable par anon',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                           'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                           'ajouter_aliment_manuel', 'modifier_quantite_entree',
                           'supprimer_entree', 'consommation_du_jour')
         and has_function_privilege('anon', p.oid, 'execute')));
end $$;

-- ---------------------------------------------------------------------
-- A2-SUP — LE PLAN DU COACH EST INTACT (non-régression du §21)
-- ---------------------------------------------------------------------
-- Tout ce qui précède a créé des repas, ajouté des aliments, corrigé des
-- quantités, supprimé un repas libre. Le plan prescrit doit être, octet pour
-- octet, celui d'avant.
do $$
declare v_diff int;
begin
  select count(*) into v_diff from (
    select id, nutrition_day_id, slot, name, macros, coach_notes, items, updated_at from public.meals
    except
    select id, nutrition_day_id, slot, name, macros, coach_notes, items, updated_at from _plan_avant
  ) d;
  perform pg_temp.noter('A2-SUP', 'AUCUNE ligne de `meals` n''a changé — pas même updated_at',
    v_diff = 0 and (select count(*) from public.meals) = (select count(*) from _plan_avant));

  select count(*) into v_diff from (
    select id, plan_id, day, profile_key, status, target, actual, updated_at from public.nutrition_days
    except
    select id, plan_id, day, profile_key, status, target, actual, updated_at from _jours_avant
  ) d;
  perform pg_temp.noter('A2-SUP', 'AUCUNE ligne de `nutrition_days` n''a changé', v_diff = 0);

  perform pg_temp.noter('A2-SUP', 'la note du coach est intacte',
    (select coach_notes from public.meals where id = 'b0000000-0000-4000-8000-00000000000a')
    = 'Note du coach a ne pas toucher');

  perform pg_temp.noter('A2-SUP', 'les items du repas prescrit sont intacts',
    (select items from public.meals where id = 'b0000000-0000-4000-8000-00000000000a')
    = '[{"name": "Riz", "quantity": "150 g"}]'::jsonb);

  -- La garantie est STRUCTURELLE, pas disciplinaire : aucune RPC de A2 ne
  -- nomme une table du plan en écriture.
  perform pg_temp.noter('A2-SUP', 'aucune RPC de A2 n''écrit dans le plan du coach',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                           'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                           'ajouter_aliment_manuel', 'modifier_quantite_entree', 'supprimer_entree')
         and coalesce(p.prosrc, '') ~*
             '(insert into|update|delete from)\s+(public\.)?(meals|nutrition_days|nutrition_plans|nutrition_plan_profiles|nutrition_meal_slot_targets)'));

  -- Et `nutrition_daily_logs` n'a pas été effleurée : la convergence est un
  -- lot à part, pas un effet de bord de celui-ci.
  perform pg_temp.noter('A2-SUP', 'nutrition_daily_logs est strictement inchangée',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'nutrition_daily_logs') = 11
    and (select count(*) from public.nutrition_daily_logs) = 0
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'ajouter_aliment_catalogue',
                           'ajouter_aliment_manuel', 'modifier_quantite_entree', 'supprimer_entree')
         and coalesce(p.prosrc, '') ~ 'nutrition_daily_logs'));

  -- Aucun scanner, aucun réseau, aucune extension : le périmètre du lot.
  --
  -- ⚠️ CE CONTRÔLE A ÉTÉ RÉÉCRIT LE 13/08/2026, ET IL FAUT DIRE POURQUOI.
  --
  -- Il exigeait `to_regclass('public.food_products') is null`. C'était juste
  -- tant que la table n'existait pas ; la phase 3 d'A3 l'a créée, avec
  -- autorisation explicite. Le contrôle est alors devenu rouge — non parce
  -- qu'A2 avait débordé, mais parce qu'il interrogeait L'ÉTAT FINAL DE LA
  -- BASE pour parler du périmètre d'UN LOT. Ces deux choses ont cessé de
  -- coïncider le jour où un lot suivant est arrivé.
  --
  -- On ne l'a pas simplement supprimé pour retrouver du vert : la garantie
  -- « A2 n'a pas introduit de produits » est CONSERVÉE, et elle est éprouvée
  -- là où elle est durable — sur les FICHIERS d'A2, qui eux ne changent plus,
  -- par scripts/tests/aliments-a2.mts (« food_products », « gtin »,
  -- « openfoodfacts » interdits dans le code du lot).
  --
  -- Ce qui reste ici est ce qui demeure vrai et vérifiable en base : les
  -- tables d'A1 et d'A2 ne portent AUCUN concept de produit, et aucune
  -- extension n'a été installée.
  perform pg_temp.noter('A2-SUP', 'les tables d''A1/A2 ne portent aucun GTIN, et aucune extension n''a été installée',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name in ('consumed_meals', 'meal_entries', 'food_catalog', 'food_aliases')
                   and column_name ~* '(gtin|barcode|ean)')
    and not exists (select 1 from pg_extension where extname in ('pg_trgm', 'unaccent', 'citext', 'http')));

  -- Et les huit RPC d'A2 sont exactement les huit d'A2 : le lot n'a pas
  -- introduit de RPC de produit en douce.
  perform pg_temp.noter('A2-SUP', 'A2 n''a introduit aucune RPC de produit',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                          'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                          'ajouter_aliment_manuel', 'modifier_quantite_entree', 'supprimer_entree')) = 8
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                           'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                           'ajouter_aliment_manuel', 'supprimer_entree')
         and coalesce(p.prosrc, '') ~* '(food_products|gtin)'));
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  -- `filter (where ok is not true)` et non `where not ok` : un contrôle NULL
  -- ne doit pas disparaître du total.
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'ALIMENTS A2 — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- Après le ROLLBACK, la base doit être exactement comme avant.
do $$
begin
  raise notice '%', case
    when (select count(*) from public.consumed_meals) = 0
     and (select count(*) from public.meal_entries) = 0
     and (select count(*) from public.students
           where email like '%@test.invalid') = 0
    then 'OK      — Z · aucune donnée de test ne subsiste après le ROLLBACK'
    else 'ÉCHEC   — Z · des données de test subsistent' end;
end $$;
