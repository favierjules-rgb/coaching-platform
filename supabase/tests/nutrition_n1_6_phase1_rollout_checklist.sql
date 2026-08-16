-- ============================================================================
-- Checklist PostgreSQL — L'ÉTAT INTERMÉDIAIRE DU ROLLOUT N1.6 (PHASE 1).
--
-- À exécuter sur une base où N1.6A (COLOR) et N1.6B (SAVE) SONT appliquées et
-- où le CONTRACT ne l'est PAS. C'est l'état dans lequel la production vivra
-- entre la phase 1 et la phase 3.
--
-- CE QU'IL MESURE
--   I-A  `preferred_unit` est TOUJOURS là, avec ses trois contraintes legacy
--   I-B  COLOR est fonctionnel
--   I-C  SAVE est fonctionnel
--   I-D  L'ANCIEN runtime n'est pas cassé : la RPC continue d'ÉCRIRE
--        `preferred_unit`, donc un lecteur encore déployé trouve sa valeur
--   I-E  Un ANCIEN client — clé `preferred_unit`, aucune couleur — traverse
--        la RPC, sur les DEUX chemins (`insert` puis `update`)
--   I-F  La RPC de N1.1 garde sa signature et ses droits
--   Z    aucune donnée de test ne subsiste
--
-- ⚠️ ELLE EST ROUGE APRÈS LE CONTRACT, ET C'EST NORMAL. Elle décrit l'état qui
-- existe ENTRE la phase 1 et la phase 3 ; une fois `preferred_unit` supprimée,
-- I-A et I-D n'ont plus d'objet. Symétriquement, les checklists
-- `nutrition_n1_listes`, `nutrition_n1_5_1_portions` et
-- `nutrition_n1_5_2_minimum` décrivent l'état POST-CONTRACT et sont rouges ici.
-- Chaque checklist dit UN état ; aucune ne prétend dire les deux.
--
-- Reconstruire la base de phase 1 : appliquer les migrations post-baseline en
-- s'arrêtant AVANT 20260913090000 (51 au lieu de 52).
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================
\timing off
begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then raise warning 'INDÉTERMINÉ — % · %', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.connecte(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.six_creneaux() returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
           'slot', s.slot, 'enabled', s.slot = 'breakfast',
           'protein_bp', case when s.slot = 'breakfast' then 10000 else 0 end,
           'carb_bp',    case when s.slot = 'breakfast' then 10000 else 0 end,
           'fat_bp',     case when s.slot = 'breakfast' then 10000 else 0 end,
           'display_order', s.ord) order by s.ord)
    from (values ('breakfast',1),('morning_snack',2),('lunch',3),
                 ('afternoon_snack',4),('dinner',5),('dessert',6)) as s(slot, ord);
$$;

-- ⚠️ CHARGE UTILE DE L'ANCIEN CLIENT : aucune clé `color_key` nulle part.
create or replace function pg_temp.payload_ancien(p_options jsonb, p_occ_id uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', 'e1000000-0000-4000-8000-00000000b001',
    'plan', jsonb_build_object('name', 'Plan PHASE1', 'status', 'actif'),
    'profile', jsonb_build_object('profile_key', 'default', 'daily_calories', 2000,
                                  'protein_bp', 3000, 'carb_bp', 4000, 'fat_bp', 3000),
    'slots', pg_temp.six_creneaux(),
    'main_profile_key', 'default',
    'profiles', jsonb_build_array(jsonb_build_object(
      'profile_key','default','daily_calories',2000,'protein_bp',3000,'carb_bp',4000,'fat_bp',3000,
      'slots', pg_temp.six_creneaux())),
    'days', jsonb_build_array(jsonb_build_object(
      'day', 'monday', 'profile_key', 'default', 'meals', jsonb_build_array(
        jsonb_build_object(
          'id', 'e1000000-0000-4000-8000-00000000e001',
          'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
          'choice_slots', jsonb_build_array(jsonb_build_object(
            'id', p_occ_id, 'label', 'Occurrence ancienne',
            'source_list_id', 'e1000000-0000-4000-8000-00000000a001',
            'options', p_options)))))));
$$;

-- ---------------------------------------------------------------------
-- I-A — LA COLONNE LEGACY SURVIT À LA PHASE 1
-- ---------------------------------------------------------------------
do $$
declare v_src text := regexp_replace(
  pg_get_functiondef('public.save_nutrition_plan_v2(jsonb)'::regprocedure), '--[^\n]*', ' ', 'g');
begin
  perform pg_temp.noter('I-A', 'preferred_unit EXISTE encore', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='preferred_unit'));
  perform pg_temp.noter('I-A', 'les TROIS contraintes legacy sont là', (
    select count(*) = 3 from pg_constraint
     where conrelid='public.meal_choice_options'::regclass
       and conname in ('meal_choice_options_preferred_paire',
                       'meal_choice_options_preferred_unit_check',
                       'meal_choice_options_unite_legacy_coherente')));
  perform pg_temp.noter('I-A', 'quantity_unit de N1.5.2 est là aussi (les DEUX cohabitent)', (
    select count(*) = 2 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name like '%unit%'));

  -- ---------------------------------------------------------------------
  -- I-D — L'ANCIEN RUNTIME N'EST PAS CASSÉ
  -- ⚠️ C'EST LE CŒUR DE LA CORRECTION D'ORDRE. COLOR reproduit la RPC ; si sa
  -- reproduction avait laissé tomber la double écriture, un plan enregistré
  -- APRÈS la phase 1 et AVANT le déploiement porterait `preferred_unit` NULL,
  -- et le code encore en ligne lirait une unité vide sur une portion.
  -- ---------------------------------------------------------------------
  perform pg_temp.noter('I-D', 'la RPC écrit ENCORE preferred_unit (double écriture intacte)',
    v_src like '%preferred_unit = %');
  perform pg_temp.noter('I-D', 'la double écriture reste CONDITIONNÉE à la portion',
    v_src like '%case when v_opt_pref is not null then v_opt_pref_unit end%');
  perform pg_temp.noter('I-D', 'et la RPC comprend la clé d''entrée ANCIENNE',
    v_src like '%v_option->>''preferred_unit''%');
  perform pg_temp.noter('I-B', 'la RPC écrit la couleur N1.6A', v_src like '%color_key%');
end $$;

-- ---------------------------------------------------------------------
-- I-B — COLOR EST FONCTIONNEL
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('I-B', 'food_lists.color_key existe', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='food_lists' and column_name='color_key'));
  perform pg_temp.noter('I-B', 'meal_choice_slots.color_key existe', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_slots' and column_name='color_key'));
  perform pg_temp.noter('I-B', 'les deux contraintes de vocabulaire sont posées', (
    select count(*) = 2 from pg_constraint
     where conname in ('food_lists_color_key_check', 'meal_choice_slots_color_key_check')));
end $$;

-- ---------------------------------------------------------------------
-- I-C — SAVE EST FONCTIONNEL, ALORS QUE preferred_unit EXISTE ENCORE
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('I-C', 'la RPC d''enregistrement structuré existe', (
    select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enregistrer_repas_structure_consomme'));
  perform pg_temp.noter('I-C', 'elle est security definer', (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enregistrer_repas_structure_consomme'));
  perform pg_temp.noter('I-C', 'anon n''a pas le droit de l''exécuter', (
    select not has_function_privilege('anon', p.oid, 'execute')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'enregistrer_repas_structure_consomme'));
  perform pg_temp.noter('I-C', 'planned_meals.consumed_meal_id est disponible comme clé d''idempotence', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='planned_meals' and column_name='consumed_meal_id'));
end $$;

-- ---------------------------------------------------------------------
-- I-C/I-D SUR DONNÉES — un plan enregistré EN PHASE 1 reste lisible par
-- l'ANCIEN code. On passe une charge utile de l'ancienne forme (clé
-- `preferred_unit`, aucune couleur) et une de la nouvelle.
-- ---------------------------------------------------------------------
insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('e1000000-0000-4000-8000-00000000f001', 'PHASE1 Aliment', 'g', 20, 10, 5);
insert into auth.users (id, email) values ('e1000000-0000-4000-8000-0000000000c1', 'phase1@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email)
values ('e1000000-0000-4000-8000-0000000000c1', 'coach', 'PHASE1', 'Coach', 'phase1@test.invalid');
insert into public.coaches (id, user_id, name, email)
values ('e1000000-0000-4000-8000-00000000c001', 'e1000000-0000-4000-8000-0000000000c1', 'Coach PHASE1', 'phase1@test.invalid');
insert into public.food_lists (id, coach_id, name)
values ('e1000000-0000-4000-8000-00000000a001', 'e1000000-0000-4000-8000-00000000c001', 'Liste PHASE1');
insert into public.food_list_items (id, list_id, position, catalog_food_id)
values ('e1000000-0000-4000-8000-000000001001', 'e1000000-0000-4000-8000-00000000a001', 1,
        'e1000000-0000-4000-8000-00000000f001');
insert into public.nutrition_plans (id, name, status, nutrition_model_version)
values ('e1000000-0000-4000-8000-00000000b001', 'Plan PHASE1', 'actif', 2);
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('e1000000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key)
values ('e1000000-0000-4000-8000-00000000d001', 'e1000000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values ('e1000000-0000-4000-8000-00000000e001', 'e1000000-0000-4000-8000-00000000d001', 'breakfast', 'PDJ', '[]', '{}', '');
insert into public.meal_choice_slots (id, meal_id, position, label)
values ('e1000000-0000-4000-8000-00000000a501', 'e1000000-0000-4000-8000-00000000e001', 1, 'Occurrence PHASE1');

do $$
begin
  -- ⚠️ CHARGE UTILE ANCIENNE : clé `preferred_unit`, aucune `color_key`. C'est
  -- littéralement ce qu'un onglet ouvert avant la phase 1 postera.
  insert into public.meal_choice_options
    (slot_id, position, catalog_food_id, preferred_quantity, quantity_unit, preferred_unit)
  values ('e1000000-0000-4000-8000-00000000a501', 1,
          'e1000000-0000-4000-8000-00000000f001', 25, 'g', 'g');

  perform pg_temp.noter('I-D', 'une portion écrite en phase 1 porte LES DEUX unités', (
    select preferred_quantity = 25 and quantity_unit = 'g' and preferred_unit = 'g'
      from public.meal_choice_options
     where slot_id = 'e1000000-0000-4000-8000-00000000a501' and position = 1));

  -- ⚠️ ET LA CONTRAINTE LEGACY MORD ENCORE : une portion sans son unité legacy
  -- est refusée. C'est la preuve que l'ancien contrat est INTACT, pas seulement
  -- que la colonne existe.
  begin
    insert into public.meal_choice_options
      (slot_id, position, catalog_food_id, preferred_quantity, quantity_unit)
    values ('e1000000-0000-4000-8000-00000000a501', 2,
            'e1000000-0000-4000-8000-00000000f001', 10, 'g');
    perform pg_temp.noter('I-D', 'la paire N1.5.1 refuse une portion sans unité legacy', false);
  exception when check_violation then
    perform pg_temp.noter('I-D', 'la paire N1.5.1 refuse une portion sans unité legacy', true);
  end;

  -- ⚠️ ET LA COULEUR VIT SUR LA MÊME OCCURRENCE, sans rien devoir à l'unité.
  update public.meal_choice_slots set color_key = 'green'
   where id = 'e1000000-0000-4000-8000-00000000a501';
  perform pg_temp.noter('I-B', 'une couleur se pose sur l''occurrence en phase 1', (
    select color_key = 'green' from public.meal_choice_slots
     where id = 'e1000000-0000-4000-8000-00000000a501'));

  begin
    update public.meal_choice_slots set color_key = 'pink'
     where id = 'e1000000-0000-4000-8000-00000000a501';
    perform pg_temp.noter('I-B', 'une couleur hors vocabulaire est refusée', false);
  exception when check_violation then
    perform pg_temp.noter('I-B', 'une couleur hors vocabulaire est refusée', true);
  end;
end $$;

-- ---------------------------------------------------------------------
-- I-E — L'ANCIEN CLIENT PASSE PAR LA RPC, PAS PAR UN INSERT DIRECT.
-- ⚠️ C'EST LE VRAI CHEMIN DE LA PRODUCTION. Une charge utile de l'ANCIENNE
-- forme — clé `preferred_unit`, AUCUNE `color_key` — doit traverser la RPC
-- reproduite par COLOR sans rien perdre et sans être refusée.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  t := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', t);
  execute format('grant execute on all functions in schema %I to authenticated, anon', t);
  execute format('grant insert, select on %I._faits to authenticated, anon', t);
end $$;

set local role authenticated;
select pg_temp.connecte('e1000000-0000-4000-8000-0000000000c1');

do $$
declare v_occ uuid;
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload_ancien(jsonb_build_array(
    jsonb_build_object('catalog_food_id', 'e1000000-0000-4000-8000-00000000f001',
                       'preferred_quantity', 30, 'preferred_unit', 'g'))));

  perform pg_temp.noter('I-E', 'une charge utile ANCIENNE traverse la RPC sans erreur', true);

  perform pg_temp.noter('I-E', 'elle remplit LES DEUX unites - l''ancien lecteur trouve la sienne', (
    select o.preferred_quantity = 30 and o.quantity_unit = 'g' and o.preferred_unit = 'g'
      from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.label = 'Occurrence ancienne'));

  perform pg_temp.noter('I-E', 'l''absence de color_key ne casse rien : la couleur est NULL', (
    select s.color_key is null from public.meal_choice_slots s
     where s.label = 'Occurrence ancienne'));

  -- ⚠️ LA DOUBLE ÉCRITURE A DEUX CHEMINS, ET IL FAUT LES DEUX. La RPC tente
  -- d'abord un `update`, et n'`insert` que si rien n'a été trouvé. Un premier
  -- enregistrement passe donc par l'INSERT ; un second, sur la même occurrence
  -- et la même identité, passe par l'UPDATE. Un contrôle négatif l'a prouvé :
  -- annuler la double écriture du seul chemin UPDATE ne faisait RIEN rougir
  -- tant que ce banc ne réenregistrait pas.
  select s.id into v_occ from public.meal_choice_slots s where s.label = 'Occurrence ancienne';
  perform public.save_nutrition_plan_v2(pg_temp.payload_ancien(jsonb_build_array(
    jsonb_build_object('catalog_food_id', 'e1000000-0000-4000-8000-00000000f001',
                       'preferred_quantity', 45, 'preferred_unit', 'g')), v_occ));

  perform pg_temp.noter('I-E', 'le RÉ-enregistrement (chemin UPDATE) remplit lui aussi les deux unités', (
    select o.preferred_quantity = 45 and o.quantity_unit = 'g' and o.preferred_unit = 'g'
      from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.label = 'Occurrence ancienne'));

  perform pg_temp.noter('I-E', 'et il n''a pas dupliqué l''option', (
    select count(*) = 1 from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.label = 'Occurrence ancienne'));
exception when others then
  perform pg_temp.noter('I-E', 'une charge utile ANCIENNE traverse la RPC sans erreur', false);
  raise warning 'I-E - la RPC a leve : % (%)', sqlerrm, sqlstate;
end $$;

reset role;

-- ---------------------------------------------------------------------
-- I-F — LA RPC DE N1.1 GARDE SA SIGNATURE. N1.6B la reproduit ; si sa
-- signature ou ses droits changeaient, l'ANCIEN code qui l'appelle casserait.
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('I-F', 'enregistrer_repas_planifie garde sa signature (uuid, date, jsonb)', (
    select pg_get_function_identity_arguments(p.oid) = 'p_meal_id uuid, p_planned_on date, p_items jsonb'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'enregistrer_repas_planifie'));
  perform pg_temp.noter('I-F', 'et reste exécutable par authenticated', (
    select has_function_privilege('authenticated', p.oid, 'execute')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'enregistrer_repas_planifie'));
end $$;

do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'PHASE 1 · état intermédiaire — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'BANC EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
declare v_restes int;
begin
  select (select count(*) from public.food_catalog      where id::text like 'e1000000%')
       + (select count(*) from public.nutrition_plans   where id::text like 'e1000000%')
       + (select count(*) from public.meal_choice_slots where id::text like 'e1000000%')
    into v_restes;
  if v_restes > 0 then raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu', v_restes; end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
