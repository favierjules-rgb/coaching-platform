-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A5, FAVORIS ET INDEX DES RÉCENTS
-- Migrations couvertes :
--   20260905090000_meal_entries_student_recent_index.sql
--   20260905090100_food_favorites.sql
--
-- CE QU'ELLE VÉRIFIE — la numérotation est celle du contrat A5.
--   A5-5   un favori `catalog_food` s'écrit et se relit
--   A5-6   un favori `product` s'écrit et se relit
--   A5-7   l'élève B ne voit AUCUN favori de l'élève A — exécuté, pas relu
--   A5-8   une cible invalide est REFUSÉE : zéro cible, deux cibles
--   A5-8b  un doublon élève + cible est REFUSÉ — et le contrôle négatif prouve
--          qu'un index à trois colonnes, lui, l'aurait laissé passer
--   A5-9   retirer un favori fonctionne, et ne touche pas ceux des autres
--   A5-SUP `update` est REFUSÉ PAR PRIVILÈGE, pas seulement par policy
--   A5-SUP le coach ne voit RIEN — aucune policy ne le prévoit
--   A5-SUP supprimer la cible emporte le favori (`cascade`), et n'emporte
--          JAMAIS un instantané de journal (`set null`, invariant d'A1/A3)
--   A5-SUP l'index des récents existe, et il porte bien (student_id, created_at)
--   Z      après le ROLLBACK, aucune donnée de test ne subsiste
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

-- NULL est rangé comme un ÉCHEC : `accepte(sql) and (select …)` rend NULL quand
-- la sous-requête ne voit rien, et un contrôle indéterminé disparaîtrait du
-- total sans avoir été vérifié. Mesuré en A1, pas supposé.
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
begin execute p_sql; return false;
exception when others then return true; end $$;

create or replace function pg_temp.accepte(p_sql text)
returns boolean language plpgsql as $$
begin execute p_sql; return true;
exception when others then return false; end $$;

create or replace function pg_temp.compte(p_sql text)
returns integer language plpgsql as $$
declare n integer;
begin execute p_sql into n; return coalesce(n, -1);
exception when others then return -1; end $$;

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
-- Section 0 — le banc : deux élèves du MÊME coach, un aliment, un produit
-- ---------------------------------------------------------------------
-- Deux élèves du même coach, et non de deux coachs : c'est le cas le plus
-- exigeant pour A5-7. Si la RLS s'appuyait par erreur sur le rattachement au
-- coach plutôt que sur l'identité de l'élève, deux élèves de coachs différents
-- seraient isolés par accident, et le contrôle passerait sans rien prouver.
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-0000000000a1', 'eleve-a5-a@test.invalid'),
  ('b0000000-0000-4000-8000-0000000000a2', 'eleve-a5-b@test.invalid'),
  ('b0000000-0000-4000-8000-0000000000a3', 'coach-a5@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('b0000000-0000-4000-8000-0000000000a1', 'student', 'El', 'EveA', 'eleve-a5-a@test.invalid'),
  ('b0000000-0000-4000-8000-0000000000a2', 'student', 'El', 'EveB', 'eleve-a5-b@test.invalid'),
  ('b0000000-0000-4000-8000-0000000000a3', 'coach',   'Co', 'AchA5', 'coach-a5@test.invalid');
insert into public.coaches (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a3', 'Coach A5', 'coach-a5@test.invalid');
insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('60000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1',
   'c0000000-0000-4000-8000-0000000000a5', 'Eleve', 'A', 'eleve-a5-a@test.invalid', 'active'),
  ('60000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a2',
   'c0000000-0000-4000-8000-0000000000a5', 'Eleve', 'B', 'eleve-a5-b@test.invalid', 'active');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('a5000000-0000-4000-8000-000000000001', 'Aliment de banc A5', 'g', 10, 20, 5);

insert into public.food_products
  (id, gtin, brand, product_name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100,
   source, source_version, source_fetched_at)
values
  ('a5000000-0000-4000-8000-000000000002', '3017620422003', 'Marque A5', 'Produit de banc A5',
   'g', 6.3, 57.5, 30.9, 'open_food_facts', 'v3.4', now());

do $$
begin
  perform pg_temp.noter('0', 'le banc compte deux élèves du même coach, un aliment et un produit',
    (select count(*) from public.students where email like '%a5%@test.invalid') = 2
    and (select count(*) from public.food_catalog where id = 'a5000000-0000-4000-8000-000000000001') = 1
    and (select count(*) from public.food_products where id = 'a5000000-0000-4000-8000-000000000002') = 1);
end $$;

-- ---------------------------------------------------------------------
-- A5-5 · A5-6 — un favori s'écrit et se relit, pour les deux cibles
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-0000000000a1');

do $$
begin
  perform pg_temp.noter('A5-5', 'l''élève A met un ALIMENT du catalogue en favori',
    pg_temp.accepte($q$
      insert into public.food_favorites (student_id, catalog_food_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001')
    $q$));

  perform pg_temp.noter('A5-5', 'et il le relit',
    pg_temp.compte($q$
      select count(*) from public.food_favorites
       where catalog_food_id = 'a5000000-0000-4000-8000-000000000001'
    $q$) = 1);

  perform pg_temp.noter('A5-6', 'l''élève A met un PRODUIT en favori',
    pg_temp.accepte($q$
      insert into public.food_favorites (student_id, product_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000002')
    $q$));

  perform pg_temp.noter('A5-6', 'et il voit ses DEUX favoris',
    pg_temp.compte('select count(*) from public.food_favorites') = 2);
end $$;

-- ---------------------------------------------------------------------
-- A5-8 — une cible invalide est REFUSÉE par la base
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A5-8', 'ZÉRO cible est refusé',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id) values ('60000000-0000-4000-8000-0000000000a1')
    $q$));

  perform pg_temp.noter('A5-8', 'DEUX cibles à la fois sont refusées',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id, catalog_food_id, product_id)
      values ('60000000-0000-4000-8000-0000000000a1',
              'a5000000-0000-4000-8000-000000000001',
              'a5000000-0000-4000-8000-000000000002')
    $q$));

  -- Un favori pour un ALIMENT INEXISTANT est refusé par la clé étrangère : un
  -- raccourci vers rien n'a pas de sens.
  perform pg_temp.noter('A5-8', 'une cible inexistante est refusée',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id, catalog_food_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-0000000000ff')
    $q$));
end $$;

-- ---------------------------------------------------------------------
-- A5-8b — le doublon, et LA RAISON pour laquelle l'index est PARTIEL
-- ---------------------------------------------------------------------
do $$
declare v_doublons_possibles boolean;
begin
  perform pg_temp.noter('A5-8b', 'le MÊME aliment ne peut pas être mis deux fois en favori',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id, catalog_food_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001')
    $q$));

  perform pg_temp.noter('A5-8b', 'le MÊME produit non plus',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id, product_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000002')
    $q$));

  -- ⚠️ CONTRÔLE NÉGATIF STRUCTUREL — celui qui justifie la forme choisie.
  --
  -- L'index NAÏF serait `(student_id, catalog_food_id, product_id)`. En SQL,
  -- NULL n'est jamais égal à NULL : deux lignes (élève, banane, NULL) sont donc
  -- vues comme DIFFÉRENTES, et le doublon passerait sans un mot. On le PROUVE
  -- ici, sur une table jumelle, plutôt que de l'affirmer en commentaire.
  create temporary table _naif (
    student_id uuid not null,
    catalog_food_id uuid,
    product_id uuid
  ) on commit drop;
  create unique index _naif_unique on _naif (student_id, catalog_food_id, product_id);

  v_doublons_possibles := pg_temp.accepte($q$
    insert into _naif (student_id, catalog_food_id) values
      ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001'),
      ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001')
  $q$);

  perform pg_temp.noter('A5-8b',
    'un index à trois colonnes AURAIT laissé passer le doublon — c''est pourquoi il est partiel',
    v_doublons_possibles and (select count(*) from _naif) = 2);
end $$;

-- ---------------------------------------------------------------------
-- A5-7 — l'ÉTANCHÉITÉ entre élèves, exécutée
-- ---------------------------------------------------------------------
select pg_temp.connecte('b0000000-0000-4000-8000-0000000000a2');

do $$
begin
  perform pg_temp.noter('A5-7', 'l''élève B ne voit AUCUN favori de l''élève A',
    pg_temp.compte('select count(*) from public.food_favorites') = 0);

  perform pg_temp.noter('A5-7', 'l''élève B ne peut pas écrire un favori AU NOM de l''élève A',
    pg_temp.refuse($q$
      insert into public.food_favorites (student_id, catalog_food_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001')
    $q$));

  -- Et il ne peut pas non plus les EFFACER : la policy filtre le DELETE comme
  -- le SELECT. Zéro ligne touchée, pas une erreur — c'est le comportement
  -- normal d'un DELETE qui ne voit rien, et c'est ce qu'on mesure.
  perform pg_temp.noter('A5-7', 'l''élève B n''efface aucun favori de l''élève A',
    pg_temp.accepte('delete from public.food_favorites'));

  -- Son propre favori, en revanche, fonctionne.
  perform pg_temp.noter('A5-7', 'l''élève B garde le droit d''avoir SES favoris',
    pg_temp.accepte($q$
      insert into public.food_favorites (student_id, catalog_food_id)
      values ('60000000-0000-4000-8000-0000000000a2', 'a5000000-0000-4000-8000-000000000001')
    $q$)
    and pg_temp.compte('select count(*) from public.food_favorites') = 1);
end $$;

-- On revient à l'élève A : ses deux favoris doivent être INTACTS après la
-- tentative d'effacement de B.
select pg_temp.connecte('b0000000-0000-4000-8000-0000000000a1');

do $$
begin
  perform pg_temp.noter('A5-7', 'les favoris de l''élève A ont survécu au DELETE de l''élève B',
    pg_temp.compte('select count(*) from public.food_favorites') = 2);
end $$;

-- ---------------------------------------------------------------------
-- A5-9 — retirer un favori
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A5-9', 'l''élève A retire son favori produit',
    pg_temp.accepte($q$
      delete from public.food_favorites
       where product_id = 'a5000000-0000-4000-8000-000000000002'
    $q$)
    and pg_temp.compte('select count(*) from public.food_favorites') = 1);

  perform pg_temp.noter('A5-9', 'et il peut le remettre — le retrait ne pose aucun verrou',
    pg_temp.accepte($q$
      insert into public.food_favorites (student_id, product_id)
      values ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000002')
    $q$));
end $$;

-- ---------------------------------------------------------------------
-- A5-SUP — `update` est refusé PAR PRIVILÈGE
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A5-SUP', 'authenticated a bien SELECT, INSERT et DELETE',
    has_table_privilege('authenticated', 'public.food_favorites', 'select')
    and has_table_privilege('authenticated', 'public.food_favorites', 'insert')
    and has_table_privilege('authenticated', 'public.food_favorites', 'delete'));

  -- LE CŒUR DE LA MIGRATION. Une policy dit quelles LIGNES ; le privilège dit
  -- quels VERBES. Sans ce retrait, un `update student_id` déplacerait un favori
  -- d'un élève vers un autre — chemin que le `with check` bloquerait, mais
  -- qu'il vaut mieux ne pas ouvrir du tout.
  perform pg_temp.noter('A5-SUP', 'authenticated n''a PAS le privilège UPDATE',
    not has_table_privilege('authenticated', 'public.food_favorites', 'update'));

  perform pg_temp.noter('A5-SUP', 'un UPDATE échoue réellement, pas seulement en théorie',
    pg_temp.refuse($q$
      update public.food_favorites set created_at = now()
    $q$));

  perform pg_temp.noter('A5-SUP', 'anon n''a AUCUN privilège',
    not has_table_privilege('anon', 'public.food_favorites', 'select')
    and not has_table_privilege('anon', 'public.food_favorites', 'insert'));
end $$;

-- ---------------------------------------------------------------------
-- A5-SUP — le coach ne voit RIEN
-- ---------------------------------------------------------------------
select pg_temp.connecte('b0000000-0000-4000-8000-0000000000a3');

do $$
begin
  perform pg_temp.noter('A5-SUP', 'le coach de l''élève ne voit AUCUN de ses favoris',
    pg_temp.compte('select count(*) from public.food_favorites') = 0);

  -- Et ce n'est pas un accident de configuration : AUCUNE policy ne le nomme.
  perform pg_temp.noter('A5-SUP', 'aucune policy coach n''existe sur la table',
    (select count(*) from pg_policies
      where tablename = 'food_favorites' and policyname ilike '%coach%') = 0);
end $$;

reset role;

-- ---------------------------------------------------------------------
-- A5-SUP — `cascade` sur la cible, `set null` sur l'instantané
-- ---------------------------------------------------------------------
-- Les deux comportements sont OPPOSÉS, et c'est voulu : un favori est un
-- raccourci vers une source vivante, un instantané de journal est un fait
-- historique. On vérifie les deux dans la même transaction, parce que c'est
-- leur DIFFÉRENCE qui compte.
insert into public.consumed_meals (id, student_id, consumed_on, position, kind, label)
values ('a5000000-0000-4000-8000-00000000000c', '60000000-0000-4000-8000-0000000000a1',
        current_date, 0, 'student', 'Repas de banc A5');

insert into public.meal_entries
  (student_id, consumed_meal_id, source_type, food_id, label, quantity, unit,
   protein_g, carb_g, fat_g)
values
  ('60000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-00000000000c',
   'catalog_food', 'a5000000-0000-4000-8000-000000000001', 'Aliment de banc A5',
   100, 'g', 10, 20, 5);

do $$
declare v_favoris_avant int; v_entrees_avant int;
begin
  select count(*) into v_favoris_avant from public.food_favorites
   where catalog_food_id = 'a5000000-0000-4000-8000-000000000001';
  select count(*) into v_entrees_avant from public.meal_entries
   where food_id = 'a5000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('A5-SUP', 'le banc a bien un favori ET une entrée sur le même aliment',
    v_favoris_avant >= 1 and v_entrees_avant = 1);

  delete from public.food_catalog where id = 'a5000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('A5-SUP',
    'supprimer l''aliment EMPORTE le favori (cascade : un raccourci sans destination n''a pas de sens)',
    (select count(*) from public.food_favorites
      where catalog_food_id = 'a5000000-0000-4000-8000-000000000001') = 0);

  perform pg_temp.noter('A5-SUP',
    'et n''emporte JAMAIS l''instantané du journal (set null : l''histoire ne se réécrit pas)',
    (select count(*) from public.meal_entries
      where consumed_meal_id = 'a5000000-0000-4000-8000-00000000000c') = 1
    and (select food_id from public.meal_entries
          where consumed_meal_id = 'a5000000-0000-4000-8000-00000000000c') is null
    and (select protein_g from public.meal_entries
          where consumed_meal_id = 'a5000000-0000-4000-8000-00000000000c') = 10);
end $$;

-- ---------------------------------------------------------------------
-- A5-SUP — l'index des récents
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A5-SUP', 'l''index des récents existe sur meal_entries',
    (select count(*) from pg_indexes
      where schemaname = 'public' and tablename = 'meal_entries'
        and indexname = 'meal_entries_student_recent_idx') = 1);

  -- Il doit porter (student_id, created_at DESC) et pas autre chose : un index
  -- sur student_id seul obligerait à trier 3 000 lignes à chaque ouverture.
  perform pg_temp.noter('A5-SUP', 'et il porte bien (student_id, created_at DESC)',
    (select indexdef from pg_indexes
      where indexname = 'meal_entries_student_recent_idx')
    ilike '%(student_id, created_at DESC)%');

  -- AUCUNE table de récents n'a été créée : ils restent dérivés.
  perform pg_temp.noter('A5-SUP', 'aucune table de récents n''a été créée',
    (select count(*) from pg_tables
      where schemaname = 'public' and tablename ilike '%recent%') = 0);
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'ALIMENTS A5 · FAVORIS — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
begin
  raise notice '%', case
    when (select count(*) from public.students where email like '%@test.invalid') = 0
     and (select count(*) from public.food_favorites) = 0
     and (select count(*) from public.meal_entries) = 0
     and (select count(*) from public.food_catalog where source = 'ciqual') = 3330
    then 'OK      — Z · aucune donnée de test ne subsiste, et les 3 330 aliments Ciqual sont intacts'
    else 'ÉCHEC   — Z · état inattendu après le ROLLBACK' end;
end $$;
