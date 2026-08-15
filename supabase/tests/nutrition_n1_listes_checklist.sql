-- ============================================================================
-- Checklist PostgreSQL — N1.1, LISTES DE CHOIX ET REPAS PLANIFIÉ
--
-- CE QU'ELLE VÉRIFIE — la numérotation est celle du contrat N1.
--   N1-A   les six tables, la RLS, et l'ABSENCE de toute colonne de rôle
--   N1-B   une option ne peut être qu'une identité réelle de la base
--   N1-C   LE SNAPSHOT — modifier un modèle ne change rien à un repas,
--          avec le contrôle négatif qui prouve que le test discrimine
--   N1-D   la même liste deux fois dans le même repas
--   N1-E   l'ordre des occurrences et des options
--   N1-F   personnaliser une occurrence ne touche pas le modèle, et l'inverse
--   N1-G   un aliment hors liste est refusé PAR LA BASE, pas par la RPC
--   N1-H   `choice_slot_id` non nul : le trou du `match simple` est fermé
--   N1-I   la RPC — accès, repas guidé, remplacement intégral, idempotence
--   N1-J   planifier n'écrit JAMAIS dans consumed_meals / meal_entries
--   N1-K   la cible du repas est la MÊME que celle d'ouvrir_repas_prescrit
--   N1-CHOIX une occurrence = UN choix, et toutes sont obligatoires
--   N1-PLAN  un plan « prochain » n'est ni lisible ni planifiable
--   N1-L   les unités : la pièce refusée sans poids déclaré
--   N1-M   RLS — élève, coach, et cloisonnement des bibliothèques
--   N1-N   privilèges — aucune écriture directe sur le repas planifié
--   N1-O   anciens plans : un repas sans occurrence est intact
--   N1-P   archivage et suppression d'un modèle ne cassent aucun repas
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

-- NULL est rangé comme un ÉCHEC : un contrôle indéterminé disparaîtrait du
-- total sans avoir rien prouvé. Même convention qu'en A1, A2, A5 et A5.7.
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

-- Refuse AVEC LE BON MOTIF : `refuse` seul serait vert sur une faute de frappe.
create or replace function pg_temp.refuse_pour(p_sql text, p_motif text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return sqlerrm like '%' || p_motif || '%'; end $$;

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
-- Section 0 — LE BANC : deux coachs, deux élèves, un plan complet
-- ---------------------------------------------------------------------
-- Deux coachs sont nécessaires : sans le second, « un coach ne voit pas la
-- bibliothèque d'un autre » serait vert même avec une policy qui laisse tout
-- voir. Deux élèves, pour la même raison côté repas planifié.

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-0000000000a1', 'n1-eleve-a@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000a2', 'n1-eleve-b@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000c1', 'n1-coach-1@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000c2', 'n1-coach-2@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('b1000000-0000-4000-8000-0000000000a1', 'student', 'N1', 'EleveA', 'n1-eleve-a@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000a2', 'student', 'N1', 'EleveB', 'n1-eleve-b@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000c1', 'coach',   'N1', 'Coach1', 'n1-coach-1@test.invalid'),
  ('b1000000-0000-4000-8000-0000000000c2', 'coach',   'N1', 'Coach2', 'n1-coach-2@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000c1', 'Coach N1 1', 'n1-coach-1@test.invalid'),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-0000000000c2', 'Coach N1 2', 'n1-coach-2@test.invalid');

insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('61000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1',
   'c1000000-0000-4000-8000-000000000001', 'Eleve', 'A', 'n1-eleve-a@test.invalid', 'active'),
  ('61000000-0000-4000-8000-0000000000a2', 'b1000000-0000-4000-8000-0000000000a2',
   'c1000000-0000-4000-8000-000000000002', 'Eleve', 'B', 'n1-eleve-b@test.invalid', 'active');

-- Trois aliments réels, avec des valeurs reconnaissables. Le troisième porte un
-- poids de pièce : il sert au contrôle des unités (N1-L).
-- `slug` est une colonne GÉNÉRÉE (`food_slug(name)`) : on ne la fournit pas.
insert into public.food_catalog
  (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g) values
  ('a1000000-0000-4000-8000-000000000001', 'Aliment N1 Poulet',  'g', 20,  0,  4, null),
  ('a1000000-0000-4000-8000-000000000002', 'Aliment N1 Riz',     'g',  7, 78,  1, null),
  ('a1000000-0000-4000-8000-000000000003', 'Aliment N1 Oeuf',    'g', 13,  0, 10, 50),
  ('a1000000-0000-4000-8000-000000000004', 'Aliment N1 Crevette','g', 24,  0,  1, null);

-- Un plan v2 complet pour l'élève A : profil du lundi, part du dîner, un repas
-- GUIDÉ (avec occurrences) et un repas LIBRE (sans occurrence, ancien mode).
insert into public.nutrition_plans (id, student_id, coach_id, name, status, nutrition_model_version)
values ('91000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
        'c1000000-0000-4000-8000-000000000001', 'Plan N1', 'actif', 2);

insert into public.nutrition_plan_profiles
  (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
   'day_monday', 2000, 3000, 4000, 3000);

insert into public.nutrition_meal_slot_targets
  (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order) values
  ('92000000-0000-4000-8000-000000000001', 'dinner', true, 5000, 4000, 5000, 4);

insert into public.nutrition_days (id, plan_id, day, profile_key)
values ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
        'monday', 'day_monday');

insert into public.meals (id, nutrition_day_id, slot, name, items, coach_notes) values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
   'dinner', 'Dîner guidé', '[]'::jsonb, ''),
  -- ⚠️ LE REPAS ANCIEN MODE : du texte libre, aucune occurrence. Il doit rester
  -- rigoureusement intact (N1-O).
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001',
   'lunch', 'Déjeuner libre',
   '[{"name":"150 g poulet","quantity":""},{"name":"80 g riz","quantity":""}]'::jsonb,
   'Note historique du coach');

do $$
begin
  perform pg_temp.noter('0', 'le banc : 2 coachs, 2 élèves, 1 plan, 2 repas dont un ancien mode',
    (select count(*) from public.coaches where email like 'n1-%@test.invalid') = 2
    and (select count(*) from public.students where email like 'n1-%@test.invalid') = 2
    and (select count(*) from public.meals where nutrition_day_id = '93000000-0000-4000-8000-000000000001') = 2);
end $$;


-- ---------------------------------------------------------------------
-- N1-A — LES SIX TABLES, LA RLS, ET SURTOUT L'ABSENCE DE RÔLE
-- ---------------------------------------------------------------------
do $$
declare v_tables text[] := array['food_lists','food_list_items','meal_choice_slots',
                                 'meal_choice_options','planned_meals','planned_meal_items'];
begin
  perform pg_temp.noter('N1-A', 'les six tables existent',
    (select count(*) from pg_tables where schemaname = 'public' and tablename = any(v_tables)) = 6);

  perform pg_temp.noter('N1-A', 'la RLS est active sur les six',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(v_tables) and c.relrowsecurity) = 6);

  -- ⚠️ LE CONTRÔLE LE PLUS IMPORTANT DE CE LOT. Le contrat produit dit qu'une
  -- liste n'a AUCUN rôle nutritionnel. Ce n'est pas une intention de code : il
  -- ne doit exister aucune colonne où en ranger un.
  perform pg_temp.noter('N1-A', 'AUCUNE colonne de rôle nutritionnel dans les six tables',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = any(v_tables)
        and (column_name ilike '%role%'
          or column_name ilike '%macro%'
          or column_name ilike '%protein%'
          or column_name ilike '%carb%'
          or column_name ilike '%fat%'
          or column_name ilike '%reference%')
        -- Les cibles figées du repas planifié sont l'exception assumée : ce
        -- sont les objectifs du créneau, pas des valeurs d'aliment.
        and not (table_name = 'planned_meals' and column_name like 'target\_%')) = 0);

  -- Et aucune macro n'est stockée sur un aliment planifié : elles se dérivent.
  perform pg_temp.noter('N1-A', 'planned_meal_items ne stocke AUCUNE macro',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'planned_meal_items'
        and column_name in ('protein_g','carb_g','fat_g','calories','kcal')) = 0);
end $$;


-- ---------------------------------------------------------------------
-- N1-B — UNE OPTION EST UNE IDENTITÉ RÉELLE, JAMAIS DU TEXTE
-- ---------------------------------------------------------------------
insert into public.food_lists (id, coach_id, name) values
  ('f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Protéines'),
  ('f1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Glucides'),
  -- La bibliothèque de l'AUTRE coach, pour le cloisonnement (N1-M).
  ('f1000000-0000-4000-8000-0000000000f2', 'c1000000-0000-4000-8000-000000000002', 'Liste privée du coach 2');

insert into public.food_list_items (list_id, position, catalog_food_id) values
  ('f1000000-0000-4000-8000-000000000001', 1, 'a1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000001', 2, 'a1000000-0000-4000-8000-000000000003'),
  ('f1000000-0000-4000-8000-000000000002', 1, 'a1000000-0000-4000-8000-000000000002');

do $$
begin
  perform pg_temp.noter('N1-B', 'une option sans aucune identité est refusée',
    pg_temp.refuse($q$insert into public.food_list_items (list_id, position)
                      values ('f1000000-0000-4000-8000-000000000001', 9)$q$));

  perform pg_temp.noter('N1-B', 'une option avec DEUX identités est refusée',
    pg_temp.refuse($q$insert into public.food_list_items (list_id, position, catalog_food_id, product_id)
                      values ('f1000000-0000-4000-8000-000000000001', 9,
                              'a1000000-0000-4000-8000-000000000001',
                              '00000000-0000-4000-8000-000000000099')$q$));

  perform pg_temp.noter('N1-B', 'un aliment inexistant est refusé par la clé étrangère',
    pg_temp.refuse($q$insert into public.food_list_items (list_id, position, catalog_food_id)
                      values ('f1000000-0000-4000-8000-000000000001', 9,
                              'aaaaaaaa-0000-4000-8000-000000000000')$q$));

  perform pg_temp.noter('N1-B', 'aucune colonne texte ne peut tenir lieu d''identité',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name in ('food_list_items','meal_choice_options')
        and data_type in ('text','character varying')) = 0);

  perform pg_temp.noter('N1-B', 'le même aliment ne peut pas figurer deux fois dans une liste',
    pg_temp.refuse($q$insert into public.food_list_items (list_id, position, catalog_food_id)
                      values ('f1000000-0000-4000-8000-000000000001', 9,
                              'a1000000-0000-4000-8000-000000000001')$q$));
end $$;


-- ---------------------------------------------------------------------
-- N1-C · N1-D · N1-E — LE SNAPSHOT, LA RÉPÉTITION, L'ORDRE
-- ---------------------------------------------------------------------
-- Le repas guidé reçoit TROIS occurrences, dont DEUX issues du même modèle.
insert into public.meal_choice_slots (id, meal_id, position, label, source_list_id) values
  ('51000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 1, 'Protéines',
   'f1000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 2, 'Protéines',
   'f1000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', 3, 'Glucides',
   'f1000000-0000-4000-8000-000000000002');

-- LA COPIE. C'est ce que fera l'écran du coach : lire le modèle une fois, et
-- écrire des lignes propres à l'occurrence.
insert into public.meal_choice_options (slot_id, position, catalog_food_id)
select s.id, i.position, i.catalog_food_id
  from public.meal_choice_slots s
  join public.food_list_items i on i.list_id = s.source_list_id
 where s.meal_id = '94000000-0000-4000-8000-000000000001';

do $$
begin
  perform pg_temp.noter('N1-D', 'la MÊME liste est utilisée deux fois dans le même repas',
    (select count(*) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000001'
        and source_list_id = 'f1000000-0000-4000-8000-000000000001') = 2);

  perform pg_temp.noter('N1-D', 'les deux occurrences ont des options INDÉPENDANTES',
    (select count(*) from public.meal_choice_options where slot_id = '51000000-0000-4000-8000-000000000001') = 2
    and (select count(*) from public.meal_choice_options where slot_id = '51000000-0000-4000-8000-000000000002') = 2
    and (select count(distinct id) from public.meal_choice_options
          where slot_id in ('51000000-0000-4000-8000-000000000001',
                            '51000000-0000-4000-8000-000000000002')) = 4);

  perform pg_temp.noter('N1-E', 'l''ordre des occurrences est conservé',
    (select array_agg(label order by position) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000001')
    = array['Protéines','Protéines','Glucides']);

  perform pg_temp.noter('N1-E', 'l''ordre des options est conservé',
    (select array_agg(f.name order by o.position)
       from public.meal_choice_options o
       join public.food_catalog f on f.id = o.catalog_food_id
      where o.slot_id = '51000000-0000-4000-8000-000000000001')
    = array['Aliment N1 Poulet','Aliment N1 Oeuf']);

  perform pg_temp.noter('N1-E', 'deux occurrences ne peuvent pas partager une position',
    pg_temp.refuse($q$insert into public.meal_choice_slots (meal_id, position, label)
                      values ('94000000-0000-4000-8000-000000000001', 1, 'Doublon')$q$));

  perform pg_temp.noter('N1-E', 'deux options ne peuvent pas partager une position',
    pg_temp.refuse($q$insert into public.meal_choice_options (slot_id, position, catalog_food_id)
                      values ('51000000-0000-4000-8000-000000000001', 1,
                              'a1000000-0000-4000-8000-000000000004')$q$));
end $$;

-- ═══ LE SNAPSHOT, ET SON CONTRÔLE NÉGATIF ═══════════════════════════════
-- Le coach ajoute « Crevette » au MODÈLE « Protéines », deux semaines plus tard.
insert into public.food_list_items (list_id, position, catalog_food_id)
values ('f1000000-0000-4000-8000-000000000001', 3, 'a1000000-0000-4000-8000-000000000004');

do $$
declare v_par_snapshot int; v_par_modele int;
begin
  -- LE CHEMIN RÉEL : le repas se lit par ses options, et par elles seules.
  v_par_snapshot := (select count(*) from public.meal_choice_options
                      where slot_id = '51000000-0000-4000-8000-000000000001');

  -- LE CONTRÔLE NÉGATIF : la même question posée EN JOIGNANT LE MODÈLE. Si le
  -- code lisait le repas par ce chemin, il verrait trois aliments au lieu de
  -- deux — et le test ci-dessus serait vert pour de mauvaises raisons.
  v_par_modele := (select count(*)
                     from public.meal_choice_slots s
                     join public.food_list_items i on i.list_id = s.source_list_id
                    where s.id = '51000000-0000-4000-8000-000000000001');

  perform pg_temp.noter('N1-C', 'MODIFIER LE MODÈLE NE CHANGE RIEN AU REPAS (2 options, pas 3)',
    v_par_snapshot = 2);

  perform pg_temp.noter('N1-C', 'contrôle négatif : la lecture PAR LE MODÈLE, elle, verrait 3',
    v_par_modele = 3);

  perform pg_temp.noter('N1-C', 'les deux chemins DIFFÈRENT — le test discrimine bien',
    v_par_snapshot <> v_par_modele);

  perform pg_temp.noter('N1-C', 'aucune clé étrangère ne relie une option à food_list_items',
    (select count(*) from pg_constraint
      where conrelid = 'public.meal_choice_options'::regclass
        and contype = 'f'
        and confrelid = 'public.food_list_items'::regclass) = 0);
end $$;


-- ---------------------------------------------------------------------
-- N1-F — PERSONNALISER UNE OCCURRENCE NE TOUCHE PAS LE MODÈLE
-- ---------------------------------------------------------------------
do $$
declare v_avant int;
begin
  v_avant := (select count(*) from public.food_list_items
               where list_id = 'f1000000-0000-4000-8000-000000000001');

  -- Le coach retire l'œuf de CE repas, occurrence 2 seulement.
  delete from public.meal_choice_options
   where slot_id = '51000000-0000-4000-8000-000000000002'
     and catalog_food_id = 'a1000000-0000-4000-8000-000000000003';

  perform pg_temp.noter('N1-F', 'retirer une option ne retire rien du modèle',
    (select count(*) from public.food_list_items
      where list_id = 'f1000000-0000-4000-8000-000000000001') = v_avant);

  perform pg_temp.noter('N1-F', 'ni de l''AUTRE occurrence issue du même modèle',
    (select count(*) from public.meal_choice_options
      where slot_id = '51000000-0000-4000-8000-000000000001') = 2);

  perform pg_temp.noter('N1-F', 'l''occurrence personnalisée n''a plus qu''une option',
    (select count(*) from public.meal_choice_options
      where slot_id = '51000000-0000-4000-8000-000000000002') = 1);

  -- Renommer l'occurrence ne renomme pas le modèle.
  update public.meal_choice_slots set label = 'Choisis ta viande'
   where id = '51000000-0000-4000-8000-000000000002';

  perform pg_temp.noter('N1-F', 'renommer une occurrence ne renomme pas le modèle',
    (select name from public.food_lists where id = 'f1000000-0000-4000-8000-000000000001') = 'Protéines');
end $$;


-- ---------------------------------------------------------------------
-- N1-G · N1-H — L'ALIMENT HORS LISTE EST REFUSÉ PAR LA BASE
-- ---------------------------------------------------------------------
-- ⚠️ CES CONTRÔLES SONT EXÉCUTÉS EN TANT QUE PROPRIÉTAIRE, DONC SANS RLS ET
-- SANS PASSER PAR LA RPC. C'est le but : ils prouvent que la protection tient
-- même si un autre chemin d'écriture apparaissait un jour.
insert into public.planned_meals
  (id, student_id, planned_on, meal_id, slot_key, label) values
  ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
   '2026-08-24', '94000000-0000-4000-8000-000000000001', 'dinner', 'Dîner guidé');

do $$
begin
  -- Le poulet EST une option de l'occurrence 1 : accepté.
  perform pg_temp.noter('N1-G', 'un aliment DE la liste est accepté',
    not pg_temp.refuse($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, quantity, unit)
      values ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
              '51000000-0000-4000-8000-000000000001', 1,
              'a1000000-0000-4000-8000-000000000001', 145, 'g')$q$));

  -- ⚠️ CHAQUE REFUS VISE UNE OCCURRENCE DIFFÉRENTE, ET UNE POSITION
  -- DIFFÉRENTE. Deux contrôles négatifs successifs l'ont imposé : d'abord la
  -- position partagée, puis — après l'ajout de l'unicité « un choix par
  -- occurrence » — l'occurrence partagée. Dans les deux cas, retirer la clé
  -- étrangère d'appartenance laissait ces tests VERTS, non parce que l'aliment
  -- était refusé, mais parce qu'une AUTRE contrainte prenait le relais.
  -- Deux contrôles qui partagent une clé d'unicité se masquent.

  -- La crevette est dans le MODÈLE mais PAS dans le snapshot de l'occurrence 2.
  perform pg_temp.noter('N1-G', 'un aliment ajouté au modèle APRÈS le snapshot est refusé',
    pg_temp.refuse($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, quantity, unit)
      values ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
              '51000000-0000-4000-8000-000000000002', 2,
              'a1000000-0000-4000-8000-000000000004', 100, 'g')$q$));

  -- L'œuf est une option, mais de l'occurrence 1, pas de la 3.
  perform pg_temp.noter('N1-G', 'un aliment d''une AUTRE occurrence est refusé',
    pg_temp.refuse($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, quantity, unit)
      values ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
              '51000000-0000-4000-8000-000000000003', 3,
              'a1000000-0000-4000-8000-000000000003', 100, 'g')$q$));

  -- ⚠️ LE TROU DU `match simple`. Une clé étrangère composite dont une colonne
  -- est NULL n'est pas vérifiée : sans `not null`, il suffirait d'omettre
  -- l'occurrence pour planifier n'importe quoi.
  perform pg_temp.noter('N1-H', 'choice_slot_id est NOT NULL — le trou du match simple est fermé',
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'planned_meal_items'
        and column_name = 'choice_slot_id') = 'NO');

  perform pg_temp.noter('N1-H', 'un aliment SANS occurrence est refusé',
    pg_temp.refuse($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, position, catalog_food_id, quantity, unit)
      values ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1',
              5, 'a1000000-0000-4000-8000-000000000004', 100, 'g')$q$));

  perform pg_temp.noter('N1-H', 'un aliment planifié ne peut pas changer d''élève',
    pg_temp.refuse($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, quantity, unit)
      values ('a2000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a2',
              '51000000-0000-4000-8000-000000000001', 6,
              'a1000000-0000-4000-8000-000000000001', 100, 'g')$q$));
end $$;

-- On efface ce banc-là : la RPC doit repartir d'un état propre.
delete from public.planned_meals where id = 'a2000000-0000-4000-8000-000000000001';


-- ---------------------------------------------------------------------
-- N1-I · N1-J — LA RPC D'ENREGISTREMENT
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');

do $$
declare v_id uuid; v_id2 uuid; v_cm int; v_me int;
begin
  v_cm := (select count(*) from public.consumed_meals);
  v_me := (select count(*) from public.meal_entries);

  -- Un repas SANS occurrence n'est pas planifiable : le mode libre passe par A5.
  perform pg_temp.noter('N1-I', 'un repas sans occurrence est refusé (REPAS_SANS_LISTE)',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000002', date '2026-08-24', '[]'::jsonb)$q$,
      'REPAS_SANS_LISTE'));

  -- Un aliment hors snapshot est refusé AVEC UN MOTIF LISIBLE.
  --
  -- ⚠️ LES TROIS OCCURRENCES SONT ENVOYÉES. Depuis que tout choix est
  -- obligatoire, un envoi partiel serait refusé pour CHOIX_INCOMPLET — donc
  -- pour la mauvaise raison, et ce test ne prouverait plus rien.
  perform pg_temp.noter('N1-I', 'un aliment hors liste est refusé (CHOIX_HORS_LISTE)',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-24',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000004","quantity":100,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000002",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$,
      'CHOIX_HORS_LISTE'));

  -- Une occurrence d'un autre repas est refusée.
  perform pg_temp.noter('N1-I', 'une occurrence hors du repas est refusée (OCCURRENCE_HORS_REPAS)',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-24',
      '[{"slot_id":"51000000-0000-4000-8000-0000000000ff",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000001",
         "quantity":100,"unit":"g"}]'::jsonb)$q$,
      'OCCURRENCE_HORS_REPAS'));

  -- L'ENREGISTREMENT NOMINAL : le repas a TROIS occurrences, donc TROIS choix.
  v_id := public.enregistrer_repas_planifie(
    '94000000-0000-4000-8000-000000000001', date '2026-08-24',
    '[{"slot_id":"51000000-0000-4000-8000-000000000001",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":100,"unit":"g"},
      {"slot_id":"51000000-0000-4000-8000-000000000002",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
      {"slot_id":"51000000-0000-4000-8000-000000000003",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb);

  perform pg_temp.noter('N1-I', 'le repas planifié est créé avec ses trois aliments',
    v_id is not null
    and (select count(*) from public.planned_meal_items where planned_meal_id = v_id) = 3);

  perform pg_temp.noter('N1-I', 'l''ordre et les quantités sont ceux qui ont été envoyés',
    (select array_agg(quantity order by position) from public.planned_meal_items
      where planned_meal_id = v_id) = array[100, 145, 70]::numeric[]);

  -- REMPLACEMENT INTÉGRAL : les trois mêmes occurrences, d'autres quantités.
  --
  -- ⚠️ L'APPEL EST ENVELOPPÉ, ET C'EST UN CONTRÔLE NÉGATIF QUI L'A IMPOSÉ. Une
  -- RPC qui n'effacerait plus les aliments précédents ne rend pas un résultat
  -- faux : elle lève une violation d'unicité, qui AVORTE le bloc entier et
  -- emporte tous les contrôles suivants. La checklist échouait donc bien, mais
  -- sans dire lequel. Ici, l'échec est capturé et nommé.
  begin
    v_id2 := public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-24',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":120,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000002",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":150,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":80,"unit":"g"}]'::jsonb);
  exception when others then
    v_id2 := null;
  end;

  perform pg_temp.noter('N1-I', 'le second appel REMPLACE au lieu de cumuler (3 aliments, pas 6)',
    v_id2 is not null
    and (select count(*) from public.planned_meal_items where planned_meal_id = v_id2) = 3);

  perform pg_temp.noter('N1-I', 'et c''est le MÊME repas planifié — l''appel est idempotent',
    v_id = v_id2
    and (select count(*) from public.planned_meals
          where student_id = '61000000-0000-4000-8000-0000000000a1'
            and planned_on = '2026-08-24') = 1);

  perform pg_temp.noter('N1-I', 'les quantités remplacées sont les nouvelles',
    (select array_agg(quantity order by position) from public.planned_meal_items
      where planned_meal_id = v_id2) = array[120, 150, 80]::numeric[]);

  -- ⚠️ PLANIFIER N'EST PAS CONSOMMER.
  perform pg_temp.noter('N1-J', 'aucun consumed_meals n''a été créé',
    (select count(*) from public.consumed_meals) = v_cm);

  perform pg_temp.noter('N1-J', 'aucune meal_entries n''a été créée',
    (select count(*) from public.meal_entries) = v_me);

  perform pg_temp.noter('N1-J', 'le repas planifié n''est rattaché à aucune consommation',
    (select consumed_meal_id from public.planned_meals where id = v_id2) is null);
end $$;

-- L'élève B ne peut pas planifier sur le plan de A.
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a2');

do $$
begin
  perform pg_temp.noter('N1-I', 'un élève ne peut pas planifier le repas d''un autre',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-24',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000001",
         "quantity":100,"unit":"g"}]'::jsonb)$q$,
      'REPAS_PRESCRIT_INACCESSIBLE'));
end $$;

reset role;


-- ---------------------------------------------------------------------
-- N1-CHOIX — UNE OCCURRENCE = UN CHOIX, ET TOUTES SONT OBLIGATOIRES
-- ---------------------------------------------------------------------
-- Côté élève, une occurrence est une liste déroulante « Choisir un aliment ».
-- En V1 il n'existe AUCUNE liste facultative : quatre listes, quatre choix.
--
-- Le banc de cette section a QUATRE occurrences, pour que « 4 slots, 3 choix »
-- soit un cas réel et non une extrapolation depuis trois.
insert into public.meal_choice_slots (id, meal_id, position, label, source_list_id) values
  ('51000000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001', 4, 'Glucides bis',
   'f1000000-0000-4000-8000-000000000002');

insert into public.meal_choice_options (slot_id, position, catalog_food_id) values
  ('51000000-0000-4000-8000-000000000004', 1, 'a1000000-0000-4000-8000-000000000002');

-- Le repas planifié du 24 n'a que trois aliments : il ne couvre plus les quatre
-- occurrences. On le supprime, sinon les contrôles suivants liraient un état
-- devenu incohérent avec le banc.
delete from public.planned_meals
 where student_id = '61000000-0000-4000-8000-0000000000a1' and planned_on = '2026-08-24';

set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');

do $$
declare v_id uuid;
  -- Les quatre choix valides, réutilisés tels quels ou amputés selon le cas.
  c1 text := '{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":100,"unit":"g"}';
  c2 text := '{"slot_id":"51000000-0000-4000-8000-000000000002","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"}';
  c3 text := '{"slot_id":"51000000-0000-4000-8000-000000000003","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}';
  c4 text := '{"slot_id":"51000000-0000-4000-8000-000000000004","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":50,"unit":"g"}';
begin
  perform pg_temp.noter('N1-CHOIX', 'le banc de cette section a bien QUATRE occurrences',
    (select count(*) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000001') = 4);

  -- N1-CHOIX-1 — quatre occurrences, quatre choix distincts : accepté.
  v_id := public.enregistrer_repas_planifie(
    '94000000-0000-4000-8000-000000000001', date '2026-09-10',
    ('[' || c1 || ',' || c2 || ',' || c3 || ',' || c4 || ']')::jsonb);

  perform pg_temp.noter('N1-CHOIX-1', '4 occurrences + 4 choix distincts sont acceptés',
    v_id is not null
    and (select count(*) from public.planned_meal_items where planned_meal_id = v_id) = 4);

  perform pg_temp.noter('N1-CHOIX-1', 'et chaque occurrence porte EXACTEMENT un aliment',
    (select count(distinct choice_slot_id) from public.planned_meal_items
      where planned_meal_id = v_id) = 4);

  -- N1-CHOIX-2 — une occurrence oubliée.
  perform pg_temp.noter('N1-CHOIX-2', '4 occurrences + 3 choix : refusé (CHOIX_INCOMPLET)',
    pg_temp.refuse_pour(
      'select public.enregistrer_repas_planifie(''94000000-0000-4000-8000-000000000001'','
      || ' date ''2026-09-11'', ''[' || c1 || ',' || c2 || ',' || c3 || ']''::jsonb)',
      'CHOIX_INCOMPLET'));

  -- N1-CHOIX-3 — rien du tout. Les contrôles de doublon et d'appartenance
  -- passent à vide : c'est la couverture des occurrences qui refuse.
  perform pg_temp.noter('N1-CHOIX-3', 'un tableau VIDE est refusé (CHOIX_INCOMPLET)',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-09-12', '[]'::jsonb)$q$,
      'CHOIX_INCOMPLET'));

  -- N1-CHOIX-4 — la même occurrence deux fois, et les quatre couvertes.
  perform pg_temp.noter('N1-CHOIX-4', 'la même occurrence envoyée deux fois : refusé (OCCURRENCE_EN_DOUBLE)',
    pg_temp.refuse_pour(
      'select public.enregistrer_repas_planifie(''94000000-0000-4000-8000-000000000001'','
      || ' date ''2026-09-13'', ''[' || c1 || ',' || c1 || ',' || c2 || ',' || c3 || ',' || c4 || ']''::jsonb)',
      'OCCURRENCE_EN_DOUBLE'));

  -- N1-CHOIX-5 — LE CAS QUE COMPTER NE VERRAIT PAS : une occurrence doublée et
  -- une autre omise. Quatre éléments envoyés pour quatre occurrences : le total
  -- est JUSTE, et pourtant l'envoi est faux.
  perform pg_temp.noter('N1-CHOIX-5', 'une occurrence doublée + une omise : refusé, alors que le TOTAL est bon',
    pg_temp.refuse_pour(
      'select public.enregistrer_repas_planifie(''94000000-0000-4000-8000-000000000001'','
      || ' date ''2026-09-14'', ''[' || c1 || ',' || c1 || ',' || c2 || ',' || c3 || ']''::jsonb)',
      'OCCURRENCE_EN_DOUBLE'));

  perform pg_temp.noter('N1-CHOIX-5', 'et le compte seul ne l''aurait pas vu : 4 envoyés pour 4 occurrences',
    (select jsonb_array_length(('[' || c1 || ',' || c1 || ',' || c2 || ',' || c3 || ']')::jsonb)) = 4
    and (select count(*) from public.meal_choice_slots
          where meal_id = '94000000-0000-4000-8000-000000000001') = 4);

  -- Une occurrence de plus que le repas n'en a.
  perform pg_temp.noter('N1-CHOIX-5', '5 choix pour 4 occurrences : refusé',
    pg_temp.refuse(
      'select public.enregistrer_repas_planifie(''94000000-0000-4000-8000-000000000001'','
      || ' date ''2026-09-15'', ''[' || c1 || ',' || c2 || ',' || c3 || ',' || c4 || ','
      || '{"slot_id":"51000000-0000-4000-8000-0000000000ff","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":10,"unit":"g"}' || ']''::jsonb)'));

  -- N1-CHOIX-7 — l'aliment hors snapshot reste refusé, banc à quatre compris.
  perform pg_temp.noter('N1-CHOIX-7', 'un aliment hors snapshot reste refusé (CHOIX_HORS_LISTE)',
    pg_temp.refuse_pour(
      'select public.enregistrer_repas_planifie(''94000000-0000-4000-8000-000000000001'','
      || ' date ''2026-09-16'', ''['
      || '{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000004","quantity":100,"unit":"g"},'
      || c2 || ',' || c3 || ',' || c4 || ']''::jsonb)',
      'CHOIX_HORS_LISTE'));
end $$;

reset role;

-- N1-CHOIX-6 — LA BASE, SANS LA RPC.
-- ⚠️ Exécuté en tant que propriétaire : ni RLS, ni fonction. Si la contrainte
-- d'unicité disparaissait, ce contrôle serait le seul à s'en apercevoir.
do $$
declare v_planned uuid;
begin
  select id into v_planned from public.planned_meals
   where student_id = '61000000-0000-4000-8000-0000000000a1' and planned_on = '2026-09-10';

  perform pg_temp.noter('N1-CHOIX-6', 'DEUX aliments pour la même occurrence : refusé PAR LA BASE',
    v_planned is not null
    and pg_temp.refuse(format($q$insert into public.planned_meal_items
      (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, quantity, unit)
      values (%L, '61000000-0000-4000-8000-0000000000a1',
              '51000000-0000-4000-8000-000000000001', 9,
              'a1000000-0000-4000-8000-000000000001', 50, 'g')$q$, v_planned)));

  perform pg_temp.noter('N1-CHOIX-6', 'la contrainte d''unicité (planned_meal_id, choice_slot_id) existe',
    (select count(*) from pg_constraint
      where conrelid = 'public.planned_meal_items'::regclass
        and conname = 'planned_meal_items_un_choix_par_occurrence'
        and contype = 'u') = 1);
end $$;

-- On remet le banc à trois occurrences pour les sections suivantes, qui ont été
-- écrites contre lui.
delete from public.planned_meals
 where student_id = '61000000-0000-4000-8000-0000000000a1' and planned_on = '2026-09-10';
delete from public.meal_choice_slots where id = '51000000-0000-4000-8000-000000000004';

set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');
do $$
declare v_id uuid;
begin
  -- Le repas du 24 est reconstitué : les sections N1-K et N1-M le lisent.
  v_id := public.enregistrer_repas_planifie(
    '94000000-0000-4000-8000-000000000001', date '2026-08-24',
    '[{"slot_id":"51000000-0000-4000-8000-000000000001",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":120,"unit":"g"},
      {"slot_id":"51000000-0000-4000-8000-000000000002",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":150,"unit":"g"},
      {"slot_id":"51000000-0000-4000-8000-000000000003",
       "catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":80,"unit":"g"}]'::jsonb);
  perform pg_temp.noter('N1-CHOIX', 'le banc est revenu à trois occurrences, et le repas du 24 est reconstitué',
    (select count(*) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000001') = 3
    and (select count(*) from public.planned_meal_items where planned_meal_id = v_id) = 3);
end $$;
reset role;


-- ---------------------------------------------------------------------
-- N1-PLAN — UN PLAN « PROCHAIN » N'EST PAS PLANIFIABLE
-- ---------------------------------------------------------------------
-- La lecture élève de `meal_choice_slots` exclut `status = 'prochain'`. Une
-- fonction `security definer` ignore la RLS par construction : sans la même
-- condition dans la RPC, l'élève pourrait planifier un repas qu'il ne peut même
-- pas afficher.
do $$
begin
  update public.nutrition_plans set status = 'prochain'
   where id = '91000000-0000-4000-8000-000000000001';
end $$;

set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform pg_temp.noter('N1-PLAN', 'l''élève ne voit plus les occurrences d''un plan « prochain »',
    pg_temp.compte($q$select count(*) from public.meal_choice_slots
                      where meal_id = '94000000-0000-4000-8000-000000000001'$q$) = 0);

  perform pg_temp.noter('N1-PLAN', 'et la RPC refuse de planifier ce repas (REPAS_PRESCRIT_INACCESSIBLE)',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-09-20',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":100,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000002",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003",
         "catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$,
      'REPAS_PRESCRIT_INACCESSIBLE'));
end $$;
reset role;

do $$
begin
  update public.nutrition_plans set status = 'actif'
   where id = '91000000-0000-4000-8000-000000000001';

  -- CONTRÔLE NÉGATIF DU MONTAGE : le refus venait bien du statut, et non d'un
  -- plan devenu invisible pour une autre raison.
  perform pg_temp.noter('N1-PLAN', 'contrôle négatif : le plan redevenu actif est de nouveau lisible',
    (select status from public.nutrition_plans
      where id = '91000000-0000-4000-8000-000000000001') = 'actif');
end $$;


-- ---------------------------------------------------------------------
-- N1-K — LA CIBLE : UN SEUL CALCUL, DEUX CHEMINS, MÊMES NOMBRES
-- ---------------------------------------------------------------------
-- ⚠️ `ouvrir_repas_prescrit` porte encore sa copie EN LIGNE du calcul. Ce
-- contrôle transforme cette duplication en invariant : le jour où l'une des deux
-- dérive, il rougit.
--
-- ⚠️ ON SE RECONNECTE EN A. `reset role` rend le rôle Postgres, mais PAS
-- l'identité applicative : `request.jwt.claims` reste celle du dernier appel à
-- `connecte`, et `ouvrir_repas_prescrit` la lirait — ici celle de l'élève B, qui
-- n'a pas ce plan. Le piège est silencieux : la fonction lèverait
-- REPAS_PRESCRIT_INACCESSIBLE pour une raison sans rapport avec ce qu'on teste.
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');

do $$
declare v_cible record; v_ouvert record; v_conteneur uuid; v_p numeric; v_g numeric; v_l numeric;
begin
  select * into v_cible from public.cible_creneau_du_repas('94000000-0000-4000-8000-000000000001');

  -- Le calcul attendu, écrit à la main : 2000 kcal, P 3000 bp, G 4000 bp,
  -- L 3000 bp ; dîner P 5000 bp, G 4000 bp, L 5000 bp.
  --   P jour = 2000 × 0,30 / 4 = 150 g   → dîner = 150 × 0,50 = 75 g
  --   G jour = 2000 × 0,40 / 4 = 200 g   → dîner = 200 × 0,40 = 80 g
  --   L jour = 2000 × 0,30 / 9 = 66,67 g → dîner = 66,67 × 0,50 = 33,33 g
  perform pg_temp.noter('N1-K', 'la cible du dîner est bien 75 P / 80 G / 33,33 L',
    round(v_cible.target_protein_g, 4) = 75
    and round(v_cible.target_carb_g, 4) = 80
    and round(v_cible.target_fat_g, 2) = 33.33);

  perform pg_temp.noter('N1-K', 'les kcal dérivent du 4/4/9, jamais d''une somme de points de base',
    round(v_cible.target_kcal, 2)
      = round(v_cible.target_protein_g * 4 + v_cible.target_carb_g * 4 + v_cible.target_fat_g * 9, 2));

  -- Le repas planifié a bien FIGÉ cette cible.
  select target_protein_g, target_carb_g, target_fat_g into v_p, v_g, v_l
    from public.planned_meals
   where student_id = '61000000-0000-4000-8000-0000000000a1' and planned_on = '2026-08-24';

  perform pg_temp.noter('N1-K', 'le repas planifié a figé exactement cette cible',
    round(v_p, 6) = round(v_cible.target_protein_g, 6)
    and round(v_g, 6) = round(v_cible.target_carb_g, 6)
    and round(v_l, 6) = round(v_cible.target_fat_g, 6));

  -- L'AUTRE CHEMIN : celui d'A5, inchangé par cette migration.
  v_conteneur := public.ouvrir_repas_prescrit('94000000-0000-4000-8000-000000000001', date '2026-08-25');

  select target_protein_g, target_carb_g, target_fat_g into v_ouvert
    from public.consumed_meals where id = v_conteneur;

  perform pg_temp.noter('N1-K', 'ouvrir_repas_prescrit rend LES MÊMES nombres — pas deux conventions',
    round(v_ouvert.target_protein_g, 6) = round(v_cible.target_protein_g, 6)
    and round(v_ouvert.target_carb_g, 6) = round(v_cible.target_carb_g, 6)
    and round(v_ouvert.target_fat_g, 6) = round(v_cible.target_fat_g, 6));

  delete from public.consumed_meals where id = v_conteneur;
end $$;


-- ---------------------------------------------------------------------
-- N1-L — LES UNITÉS
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');

do $$
begin
  -- ⚠️ CHAQUE APPEL ENVOIE LES TROIS OCCURRENCES. Depuis que tout choix est
  -- obligatoire, un envoi partiel serait refusé pour CHOIX_INCOMPLET, et
  -- chacun de ces contrôles passerait au vert sans rien prouver sur les unités.

  -- Le poulet n'a pas de poids de pièce : la pièce est refusée, par le helper
  -- d'A2 lui-même, avec son propre motif.
  perform pg_temp.noter('N1-L', 'la pièce est refusée quand l''aliment n''en déclare pas le poids',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-26',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":2,"unit":"piece"},
        {"slot_id":"51000000-0000-4000-8000-000000000002","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$,
      'PIECE_SANS_POIDS'));

  -- L'œuf en déclare un (50 g) : la pièce passe.
  perform pg_temp.noter('N1-L', 'la pièce est acceptée quand piece_weight_g est renseigné',
    not pg_temp.refuse($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-26',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000003","quantity":2,"unit":"piece"},
        {"slot_id":"51000000-0000-4000-8000-000000000002","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$));

  perform pg_temp.noter('N1-L', 'une unité inconnue est refusée',
    pg_temp.refuse($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-27',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":100,"unit":"cuillere"},
        {"slot_id":"51000000-0000-4000-8000-000000000002","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$));

  perform pg_temp.noter('N1-L', 'une quantité nulle ou négative est refusée',
    pg_temp.refuse_pour($q$select public.enregistrer_repas_planifie(
      '94000000-0000-4000-8000-000000000001', date '2026-08-27',
      '[{"slot_id":"51000000-0000-4000-8000-000000000001","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":0,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000002","catalog_food_id":"a1000000-0000-4000-8000-000000000001","quantity":145,"unit":"g"},
        {"slot_id":"51000000-0000-4000-8000-000000000003","catalog_food_id":"a1000000-0000-4000-8000-000000000002","quantity":70,"unit":"g"}]'::jsonb)$q$,
      'QUANTITE_INVALIDE'));

  -- `portion` existe dans meal_entries mais n'est convertible nulle part :
  -- l'admettre ici créerait une quantité qui ne pourrait jamais être mangée.
  perform pg_temp.noter('N1-L', 'l''unité « portion » est exclue du repas planifié',
    (select count(*) from pg_constraint
      where conrelid = 'public.planned_meal_items'::regclass
        and conname = 'planned_meal_items_unit_check'
        and pg_get_constraintdef(oid) like '%portion%') = 0);
end $$;

reset role;


-- ---------------------------------------------------------------------
-- N1-M — RLS
-- ---------------------------------------------------------------------
set local role authenticated;

select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform pg_temp.noter('N1-M', 'l''élève voit les occurrences de SON repas',
    pg_temp.compte($q$select count(*) from public.meal_choice_slots
                      where meal_id = '94000000-0000-4000-8000-000000000001'$q$) = 3);

  -- ⚠️ L'ÉLÈVE NE VOIT JAMAIS LA BIBLIOTHÈQUE. La garantie de snapshot est ainsi
  -- doublée d'une garantie de sécurité.
  perform pg_temp.noter('N1-M', 'l''élève ne voit AUCUNE liste de la bibliothèque',
    pg_temp.compte('select count(*) from public.food_lists') = 0);

  perform pg_temp.noter('N1-M', 'l''élève ne voit AUCUN aliment de modèle',
    pg_temp.compte('select count(*) from public.food_list_items') = 0);

  perform pg_temp.noter('N1-M', 'l''élève voit son repas planifié',
    pg_temp.compte($q$select count(*) from public.planned_meals
                      where student_id = '61000000-0000-4000-8000-0000000000a1'$q$) >= 1);
end $$;

select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a2');
do $$
begin
  perform pg_temp.noter('N1-M', 'l''élève B ne voit RIEN du repas planifié de A',
    pg_temp.compte('select count(*) from public.planned_meals') = 0
    and pg_temp.compte('select count(*) from public.planned_meal_items') = 0);

  perform pg_temp.noter('N1-M', 'l''élève B ne voit pas les occurrences du repas de A',
    pg_temp.compte('select count(*) from public.meal_choice_slots') = 0);
end $$;

select pg_temp.connecte('b1000000-0000-4000-8000-0000000000c1');
do $$
begin
  perform pg_temp.noter('N1-M', 'le coach 1 voit ses deux listes, et seulement les siennes',
    pg_temp.compte('select count(*) from public.food_lists') = 2);

  perform pg_temp.noter('N1-M', 'le coach 1 voit le repas planifié de SON élève',
    pg_temp.compte('select count(*) from public.planned_meals') >= 1);
end $$;

select pg_temp.connecte('b1000000-0000-4000-8000-0000000000c2');
do $$
begin
  perform pg_temp.noter('N1-M', 'le coach 2 ne voit QUE sa liste — jamais celles du coach 1',
    pg_temp.compte('select count(*) from public.food_lists') = 1
    and pg_temp.compte($q$select count(*) from public.food_lists
                          where coach_id = 'c1000000-0000-4000-8000-000000000001'$q$) = 0);

  perform pg_temp.noter('N1-M', 'le coach 2 ne voit pas le repas planifié de l''élève du coach 1',
    pg_temp.compte($q$select count(*) from public.planned_meals
                      where student_id = '61000000-0000-4000-8000-0000000000a1'$q$) = 0);

  perform pg_temp.noter('N1-M', 'le coach 2 ne peut pas écrire dans la bibliothèque du coach 1',
    pg_temp.refuse($q$insert into public.food_list_items (list_id, position, catalog_food_id)
                      values ('f1000000-0000-4000-8000-000000000001', 8,
                              'a1000000-0000-4000-8000-000000000002')$q$));
end $$;

reset role;

-- ⚠️ L'ÉCRITURE COACH SUR LES OCCURRENCES EST GLOBALE — ET C'EST LA RÈGLE
-- EXISTANTE, PAS UNE DÉCISION DE N1.
--
-- `is_coach_or_admin()` est un simple contrôle de rôle : il ne vérifie aucune
-- appartenance. Toute la chaîne de prescription l'utilise déjà. Ce contrôle
-- ÉPINGLE l'équivalence : le jour où `meals` sera restreint aux élèves d'un
-- coach, il rougira et forcera à restreindre ces deux tables avec lui.
do $$
declare v_meals text;
begin
  select qual into v_meals from pg_policies
   where schemaname = 'public' and tablename = 'meals' and policyname = 'meals_manage_staff';

  perform pg_temp.noter('N1-M', 'l''écriture staff sur meals est bien globale (is_coach_or_admin)',
    v_meals = 'is_coach_or_admin()');

  -- ── N1.3 A FAIT DIVERGER `meal_choice_slots`, ET C'EST VOULU ────────────
  -- La lecture/écriture staff reste globale sur les deux tables : c'est
  -- l'équivalence avec `meals` que ce contrôle épingle, et elle tient
  -- toujours côté `using`. Le `with check` de `meal_choice_slots`, lui, a
  -- reçu en N1.3 une condition supplémentaire : un coach ne déclare comme
  -- provenance que SES listes. Le contrôle est donc scindé, sans rien
  -- relâcher — si `meals` était restreint un jour, `v_meals` changerait et
  -- les trois assertions ci-dessous rougiraient ensemble.
  perform pg_temp.noter('N1-M', 'les occurrences gardent la règle de LECTURE de meals',
    (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('meal_choice_slots', 'meal_choice_options')
        and cmd = 'ALL' and qual = v_meals) = 2);

  perform pg_temp.noter('N1-M', 'les options gardent AUSSI la règle d''écriture de meals',
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'meal_choice_options'
        and cmd = 'ALL' and with_check = v_meals) = 1);

  -- N1.3 : le `with check` des occurrences part de `is_coach_or_admin()` et
  -- n'y AJOUTE que la propriété de la provenance. On vérifie les deux — la
  -- base conservée, et la restriction ajoutée — plutôt qu'une chaîne exacte
  -- qu'un simple reformatage de PostgreSQL ferait rougir pour rien.
  perform pg_temp.noter('N1-M', 'N1.3 · le with check des occurrences garde la garde de rôle',
    (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'meal_choice_slots' and policyname = 'meal_choice_slots_manage_staff')
    like '%is_coach_or_admin()%');

  perform pg_temp.noter('N1-M', 'N1.3 · et n''accepte une provenance que si le coach la possède',
    (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'meal_choice_slots' and policyname = 'meal_choice_slots_manage_staff')
    like '%food_lists%current_coach_id()%');

  perform pg_temp.noter('N1-M', 'N1.3 · sans jamais mettre l''administrateur dehors',
    (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'meal_choice_slots' and policyname = 'meal_choice_slots_manage_staff')
    like '%is_admin()%');

  -- Et la bibliothèque, elle, suit l'AUTRE convention du dépôt : celle des
  -- catalogues possédés, comme nutrition_recipes.
  perform pg_temp.noter('N1-M', 'la bibliothèque suit la convention « propriétaire », comme nutrition_recipes',
    (select qual from pg_policies where schemaname = 'public'
      and tablename = 'food_lists' and policyname = 'food_lists_manage_own_coach')
    = (select qual from pg_policies where schemaname = 'public'
        and tablename = 'nutrition_recipes' and policyname = 'nutrition_recipes_manage_own_coach'));
end $$;

set local role authenticated;

reset role;


-- ---------------------------------------------------------------------
-- N1-N — PRIVILÈGES : LE REPAS PLANIFIÉ EST EN LECTURE SEULE
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('N1-N', 'authenticated n''a que SELECT sur planned_meals',
    (select string_agg(distinct privilege_type, ',' order by privilege_type)
       from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'planned_meals'
        and grantee = 'authenticated') = 'SELECT');

  perform pg_temp.noter('N1-N', 'authenticated n''a que SELECT sur planned_meal_items',
    (select string_agg(distinct privilege_type, ',' order by privilege_type)
       from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'planned_meal_items'
        and grantee = 'authenticated') = 'SELECT');

  perform pg_temp.noter('N1-N', 'anon n''a aucun privilège sur les six tables',
    (select count(*) from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
        and table_name in ('food_lists','food_list_items','meal_choice_slots',
                           'meal_choice_options','planned_meals','planned_meal_items')) = 0);

  perform pg_temp.noter('N1-N', 'les trois RPC sont security definer avec search_path fixé',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('enregistrer_repas_planifie','supprimer_repas_planifie','cible_creneau_du_repas')
        and p.prosecdef
        and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path%') = 3);

  perform pg_temp.noter('N1-N', 'anon ne peut exécuter aucune des trois RPC',
    (select count(*) from information_schema.role_routine_grants
      where routine_schema = 'public' and grantee = 'anon'
        and routine_name in ('enregistrer_repas_planifie','supprimer_repas_planifie','cible_creneau_du_repas')) = 0);
end $$;

-- L'écriture directe, tentée par un élève authentifié, doit être refusée par le
-- PRIVILÈGE — pas seulement par la policy.
set local role authenticated;
select pg_temp.connecte('b1000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform pg_temp.noter('N1-N', 'un élève ne peut pas insérer directement un repas planifié',
    pg_temp.refuse($q$insert into public.planned_meals
      (student_id, planned_on, meal_id, slot_key, label)
      values ('61000000-0000-4000-8000-0000000000a1', '2026-09-01',
              '94000000-0000-4000-8000-000000000001', 'dinner', 'Triche')$q$));

  perform pg_temp.noter('N1-N', 'ni supprimer directement le sien',
    pg_temp.refuse($q$delete from public.planned_meals
                      where student_id = '61000000-0000-4000-8000-0000000000a1'$q$));

  -- Mais il peut l'annuler par la RPC prévue pour ça.
  perform pg_temp.noter('N1-N', 'il l''annule par la RPC, et elle nettoie les aliments',
    not pg_temp.refuse($q$select public.supprimer_repas_planifie(
      (select id from public.planned_meals
        where student_id = '61000000-0000-4000-8000-0000000000a1'
          and planned_on = '2026-08-26'))$q$));
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('N1-N', 'après l''annulation, aucun aliment orphelin ne subsiste',
    (select count(*) from public.planned_meal_items i
      where not exists (select 1 from public.planned_meals m where m.id = i.planned_meal_id)) = 0);
end $$;


-- ---------------------------------------------------------------------
-- N1-O — LES ANCIENS PLANS SONT INTACTS
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('N1-O', 'le repas ancien mode n''a AUCUNE occurrence',
    (select count(*) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000002') = 0);

  perform pg_temp.noter('N1-O', 'son texte libre est intact, ligne pour ligne',
    (select items from public.meals where id = '94000000-0000-4000-8000-000000000002')
    = '[{"name":"150 g poulet","quantity":""},{"name":"80 g riz","quantity":""}]'::jsonb);

  perform pg_temp.noter('N1-O', 'sa note de coach est intacte',
    (select coach_notes from public.meals where id = '94000000-0000-4000-8000-000000000002')
    = 'Note historique du coach');

  -- ⚠️ AUCUNE COLONNE N'A ÉTÉ AJOUTÉE À `meals`. Un drapeau `is_structured`
  -- serait une seconde vérité à maintenir d'accord avec les occurrences.
  perform pg_temp.noter('N1-O', 'meals garde exactement ses neuf colonnes',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'meals') = 9);

  perform pg_temp.noter('N1-O', 'consumed_meals et meal_entries n''ont pas été modifiées',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'consumed_meals') = 14
    -- 16, et non 18 : `meal_entries` a perdu deux colonnes au fil des lots, et
    -- les positions ordinales restées libres ne sont pas des colonnes. Ce
    -- nombre est MESURÉ sur la base, pas déduit du plus grand `ordinal_position`.
    and (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'meal_entries') = 16);
end $$;


-- ---------------------------------------------------------------------
-- N1-P — ARCHIVER OU SUPPRIMER UN MODÈLE NE CASSE AUCUN REPAS
-- ---------------------------------------------------------------------
do $$
declare v_options_avant int;
begin
  v_options_avant := (select count(*) from public.meal_choice_options
                       where slot_id = '51000000-0000-4000-8000-000000000001');

  update public.food_lists set archived_at = now()
   where id = 'f1000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('N1-P', 'archiver le modèle ne change aucune option',
    (select count(*) from public.meal_choice_options
      where slot_id = '51000000-0000-4000-8000-000000000001') = v_options_avant);

  -- LE CAS DESTRUCTEUR : la suppression pure et simple du modèle.
  delete from public.food_lists where id = 'f1000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('N1-P', 'SUPPRIMER le modèle ne retire AUCUNE option du repas',
    (select count(*) from public.meal_choice_options
      where slot_id = '51000000-0000-4000-8000-000000000001') = v_options_avant);

  perform pg_temp.noter('N1-P', 'les occurrences survivent, en perdant seulement leur provenance',
    (select count(*) from public.meal_choice_slots
      where meal_id = '94000000-0000-4000-8000-000000000001') = 3
    and (select source_list_id from public.meal_choice_slots
          where id = '51000000-0000-4000-8000-000000000001') is null);

  perform pg_temp.noter('N1-P', 'un aliment du catalogue cité par une option ne peut pas être supprimé',
    pg_temp.refuse($q$delete from public.food_catalog
                      where id = 'a1000000-0000-4000-8000-000000000001'$q$));
end $$;


-- ---------------------------------------------------------------------
-- SUP — LE DÉPOUILLEMENT EST HONNÊTE
-- ---------------------------------------------------------------------
do $$
begin
  -- Sans ce contrôle, « aucune colonne de rôle » serait vert sur une base vide.
  perform pg_temp.noter('SUP', 'les six tables ont bien des colonnes — le contrôle N1-A porte sur du réel',
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name in ('food_lists','food_list_items','meal_choice_slots',
                           'meal_choice_options','planned_meals','planned_meal_items')) >= 40);

  perform pg_temp.noter('SUP', 'les deux clés étrangères composites d''appartenance existent',
    (select count(*) from pg_constraint
      where conrelid = 'public.planned_meal_items'::regclass and contype = 'f'
        and confrelid = 'public.meal_choice_options'::regclass) = 2);

  perform pg_temp.noter('SUP', 'aucune table N1 ne référence food_list_items, sauf food_lists elle-même',
    (select count(*) from pg_constraint
      where contype = 'f' and confrelid = 'public.food_list_items'::regclass) = 0);
end $$;


-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'N1.1 · LISTES ET REPAS PLANIFIÉ — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
begin
  raise notice '%', case
    when (select count(*) from public.students where email like 'n1-%@test.invalid') = 0
     and (select count(*) from public.food_lists) = 0
     and (select count(*) from public.planned_meals) = 0
     and (select count(*) from public.meal_choice_slots) = 0
    then 'OK      — Z · aucune donnée de test ne subsiste'
    else 'ÉCHEC   — Z · état inattendu après le ROLLBACK' end;
end $$;
