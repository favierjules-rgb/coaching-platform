-- ============================================================================
-- Checklist PostgreSQL — N1.6A, LA COULEUR DES LISTES.
--
-- CE QU'ELLE VÉRIFIE
--   C-A   les deux colonnes existent, nullables, sans default
--   C-B   le vocabulaire est EXACTEMENT celui de training_blocks
--   C-C   une couleur hors vocabulaire est refusée, des deux côtés
--   C-D   AUCUN BACKFILL : aucune couleur posée par la migration
--   C-E   la RPC SNAPSHOTE la couleur reçue, et ne lit pas food_lists
--   C-F   repeindre la bibliothèque ne touche AUCUN repas déjà construit
--   C-G   AUCUNE policy select sur food_lists pour un élève — le snapshot est
--         donc OBLIGATOIRE, pas optionnel
--   C-H   la couleur n'est PAS sur meal_choice_options : elle appartient à
--         l'occurrence, pas à l'aliment
--   Z     après le ROLLBACK, aucune donnée de test ne subsiste
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
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · % (contrôle mal formé : traité comme un échec)', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse_pour(p_sql text, p_motif text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return sqlerrm like '%' || p_motif || '%'; end $$;

-- ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE — leçon rappelée cinq fois sur ce
-- chantier. La RPC EXPLIQUE en commentaire qu'elle ne lit pas `food_lists` ;
-- une recherche naïve trouverait le mot et déclarerait une lecture inexistante.
create or replace function pg_temp.sans_prose(p_src text)
returns text language sql immutable as $$
  select regexp_replace(p_src, '--[^\n]*', ' ', 'g');
$$;

-- ---------------------------------------------------------------------
-- C-A / C-B / C-H — LE SCHÉMA
-- ---------------------------------------------------------------------
do $$
declare v_ref text[];
begin
  perform pg_temp.noter('C-A', 'food_lists.color_key existe, text, nullable, sans default', (
    select data_type = 'text' and is_nullable = 'YES' and column_default is null
      from information_schema.columns
     where table_schema='public' and table_name='food_lists' and column_name='color_key'));

  perform pg_temp.noter('C-A', 'meal_choice_slots.color_key existe, text, nullable, sans default', (
    select data_type = 'text' and is_nullable = 'YES' and column_default is null
      from information_schema.columns
     where table_schema='public' and table_name='meal_choice_slots' and column_name='color_key'));

  -- ⚠️ LE VOCABULAIRE EST CELUI QUI EXISTAIT DÉJÀ. `training_blocks.color_key`
  -- porte ces sept clés depuis le chantier multi-blocs. Deux vocabulaires
  -- divergeraient au premier ajout de teinte.
  for v_ref in select array['gray','red','orange','yellow','green','blue','purple'] loop
    perform pg_temp.noter('C-B', 'food_lists : le vocabulaire est celui de training_blocks', (
      select bool_and(pg_get_constraintdef(oid) like '%''' || c || '''%')
        from pg_constraint, unnest(v_ref) c
       where conrelid='public.food_lists'::regclass and conname='food_lists_color_key_check'));
    perform pg_temp.noter('C-B', 'meal_choice_slots : le vocabulaire est celui de training_blocks', (
      select bool_and(pg_get_constraintdef(oid) like '%''' || c || '''%')
        from pg_constraint, unnest(v_ref) c
       where conrelid='public.meal_choice_slots'::regclass and conname='meal_choice_slots_color_key_check'));
  end loop;

  -- ⚠️ PAS DE `pink`, ET LA CONTRAINTE LE DIT.
  perform pg_temp.noter('C-B', 'aucune couleur « pink » nulle part', (
    select count(*) = 0 from pg_constraint
     where pg_get_constraintdef(oid) ilike '%pink%'));

  -- ⚠️ LA COULEUR APPARTIENT À L'OCCURRENCE, PAS À L'ALIMENT. La poser sur
  -- `meal_choice_options` en ferait une propriété d'aliment — donc, de proche
  -- en proche, un rôle.
  perform pg_temp.noter('C-H', 'aucune couleur sur meal_choice_options', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name like '%color%'));
  perform pg_temp.noter('C-H', 'aucune couleur sur food_list_items ni food_catalog', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name in ('food_list_items','food_catalog')
       and column_name like '%color%'));
end $$;

-- ---------------------------------------------------------------------
-- C-G — LA RAISON D'ÊTRE DU SNAPSHOT
-- ---------------------------------------------------------------------
do $$
begin
  -- ⚠️ CE CONTRÔLE EST LA JUSTIFICATION DE TOUTE LA COLONNE `color_key` SUR
  -- `meal_choice_slots`. Aucune policy ne donne à un élève le droit de lire
  -- `food_lists` : sans snapshot, la couleur serait invisible de son côté.
  -- Le jour où quelqu'un ajouterait une policy « select » élève, ce contrôle
  -- rougirait — et il faudrait alors se redemander pourquoi on snapshot.
  perform pg_temp.noter('C-G', 'aucune policy ne donne food_lists en lecture à un élève', (
    select count(*) = 0 from pg_policies
     where schemaname='public' and tablename='food_lists'
       and coalesce(qual, '') like '%current_student_id%'));
  perform pg_temp.noter('C-G', 'les policies food_lists restent coach + admin', (
    select count(*) = 2 from pg_policies where schemaname='public' and tablename='food_lists'));
end $$;

-- ---------------------------------------------------------------------
-- C-C / C-D — LES VALEURS
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values ('d6000000-0000-4000-8000-0000000000c1', 'n16a@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email)
values ('d6000000-0000-4000-8000-0000000000c1', 'coach', 'N16A', 'Coach', 'n16a@test.invalid');
insert into public.coaches (id, user_id, name, email)
values ('d6000000-0000-4000-8000-00000000c001', 'd6000000-0000-4000-8000-0000000000c1', 'Coach N16A', 'n16a@test.invalid');
insert into public.food_lists (id, coach_id, name)
values ('d6000000-0000-4000-8000-00000000a001', 'd6000000-0000-4000-8000-00000000c001', 'Liste sans couleur');

do $$
begin
  perform pg_temp.noter('C-D', 'une liste neuve n''a AUCUNE couleur', (
    select color_key is null from public.food_lists
     where id = 'd6000000-0000-4000-8000-00000000a001'));

  -- ⚠️ AUCUN BACKFILL : la migration n'a posé de couleur nulle part.
  perform pg_temp.noter('C-D', 'aucune couleur posée par la migration (food_lists)', (
    select count(*) = 0 from public.food_lists where color_key is not null));
  perform pg_temp.noter('C-D', 'aucune couleur posée par la migration (meal_choice_slots)', (
    select count(*) = 0 from public.meal_choice_slots where color_key is not null));

  perform pg_temp.noter('C-C', 'une couleur du vocabulaire est acceptée', (
    select pg_temp.refuse_pour($q$ update public.food_lists set color_key = 'purple'
                                    where id = 'd6000000-0000-4000-8000-00000000a001' $q$,
                               'jamais') = false));
  perform pg_temp.noter('C-C', 'une couleur HORS vocabulaire est refusée (food_lists)',
    pg_temp.refuse_pour($q$ update public.food_lists set color_key = 'pink'
                            where id = 'd6000000-0000-4000-8000-00000000a001' $q$,
                        'food_lists_color_key_check'));
  perform pg_temp.noter('C-C', 'une chaîne CSS arbitraire est refusée',
    pg_temp.refuse_pour($q$ update public.food_lists set color_key = '#ff0000'
                            where id = 'd6000000-0000-4000-8000-00000000a001' $q$,
                        'food_lists_color_key_check'));
  perform pg_temp.noter('C-C', 'retirer la couleur (null) reste possible', (
    select pg_temp.refuse_pour($q$ update public.food_lists set color_key = null
                                    where id = 'd6000000-0000-4000-8000-00000000a001' $q$,
                               'jamais') = false));
end $$;

-- ---------------------------------------------------------------------
-- C-E / C-F — LA RPC
-- ---------------------------------------------------------------------
do $$
declare v_src text := pg_temp.sans_prose(pg_get_functiondef('public.save_nutrition_plan_v2(jsonb)'::regprocedure));
begin
  perform pg_temp.noter('C-E', 'la RPC lit la couleur dans la charge utile', v_src like '%color_key%');
  perform pg_temp.noter('C-E', 'la RPC écrit color_key sur l''occurrence', v_src like '%color_key = excluded.color_key%');
  perform pg_temp.noter('C-E', 'la RPC refuse une couleur inconnue', v_src like '%COULEUR_INCONNUE%');

  -- ⚠️ ELLE NE RÉSOUT RIEN. Relire `food_lists` pour retrouver la couleur
  -- ferait du snapshot un recalcul : repeindre la bibliothèque changerait
  -- alors un repas déjà construit, au prochain enregistrement.
  perform pg_temp.noter('C-F', 'la RPC ne lit JAMAIS food_lists', v_src not like '%food_lists%');
  perform pg_temp.noter('C-F', 'la RPC ne lit JAMAIS food_list_items', v_src not like '%food_list_items%');

  -- ⚠️ ET AUCUN CALCUL NE LA VOIT. La couleur ne doit apparaître dans aucune
  -- fonction de solveur ou de cible.
  perform pg_temp.noter('C-E', 'aucune autre fonction SQL ne lit une couleur de liste', (
    select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname <> 'save_nutrition_plan_v2'
       and pg_temp.sans_prose(p.prosrc) like '%color_key%'
       and pg_temp.sans_prose(p.prosrc) like '%meal_choice_slots%'));
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'N1.6A · COULEURS DES LISTES — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Section Z — APRÈS LE ROLLBACK, VÉRIFIÉ ET NON SUPPOSÉ
-- ---------------------------------------------------------------------
do $$
declare v_restes int;
begin
  select
      (select count(*) from public.food_lists where id::text like 'd6000000%')
    + (select count(*) from public.coaches   where id::text like 'd6000000%')
    + (select count(*) from public.profiles  where user_id::text like 'd6000000%')
    + (select count(*) from auth.users       where id::text like 'd6000000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
