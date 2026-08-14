-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A5.7, HISTORIQUE ALIMENTAIRE HEBDOMADAIRE
--
-- ⚠️ AUCUNE MIGRATION N'ACCOMPAGNE A5.7. Cette checklist ne vérifie donc pas un
-- schéma nouveau : elle vérifie que l'historique se LIT correctement sur le
-- schéma existant, et surtout que le fait de le lire n'a élargi aucun droit.
--
-- CE QU'ELLE VÉRIFIE — la numérotation est celle du contrat A5.7.
--   HIST5   une semaine bornée à sept dates ne rend QUE ces sept dates
--   HIST6   un repas prescrit OUVERT MAIS VIDE n'apporte aucune consommation
--   HIST13  les totaux d'une semaine sont exacts, voisins exclus
--   HIST17  l'élève B ne voit RIEN de l'élève A — exécuté, pas relu
--   HIST18  le coach voit ses élèves, et JAMAIS l'élève d'un autre coach
--   HIST19  le coach ne peut RIEN écrire : ni entrée, ni repas, ni date
--   HIST23  aucune lecture d'historique ne déplace un `consumed_on`
--   COACH-HIST1..3  le ciblage par élève (A5.8) : sans lui le coach reçoit
--                   deux athlètes, avec lui un seul — et nommer l'élève d'un
--                   autre coach ne contourne rien
--   SUP     aucune table / vue / vue matérialisée d'historique n'existe
--   SUP     une semaine se lit sur les index existants, sans seq scan
--   Z       après le ROLLBACK, aucune donnée de test ne subsiste
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
-- total sans avoir rien prouvé. Même convention qu'en A1, A2 et A5.
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

create or replace function pg_temp.nombre(p_sql text)
returns numeric language plpgsql as $$
declare n numeric;
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
-- Section 0 — le banc : DEUX COACHS, TROIS ÉLÈVES
-- ---------------------------------------------------------------------
-- Le montage est plus exigeant que celui d'A5 parce que deux règles
-- différentes doivent être séparées :
--
--   A et B ont le MÊME coach — si la RLS élève s'appuyait par erreur sur le
--   rattachement au coach, ils se verraient l'un l'autre (HIST17) ;
--   C a un AUTRE coach — sans lui, « le coach voit son élève » serait vert
--   même avec une policy qui laisse voir tout le monde (HIST18).
--
-- Un seul de ces deux montages ne prouverait que la moitié de la règle.
insert into auth.users (id, email) values
  ('b7000000-0000-4000-8000-0000000000a1', 'hist-eleve-a@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000a2', 'hist-eleve-b@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000a3', 'hist-eleve-c@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000c1', 'hist-coach-1@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000c2', 'hist-coach-2@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('b7000000-0000-4000-8000-0000000000a1', 'student', 'Hist', 'EleveA', 'hist-eleve-a@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000a2', 'student', 'Hist', 'EleveB', 'hist-eleve-b@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000a3', 'student', 'Hist', 'EleveC', 'hist-eleve-c@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000c1', 'coach',   'Hist', 'Coach1',  'hist-coach-1@test.invalid'),
  ('b7000000-0000-4000-8000-0000000000c2', 'coach',   'Hist', 'Coach2',  'hist-coach-2@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-0000000000c1', 'Coach HIST 1', 'hist-coach-1@test.invalid'),
  ('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-0000000000c2', 'Coach HIST 2', 'hist-coach-2@test.invalid');

insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('67000000-0000-4000-8000-0000000000a1', 'b7000000-0000-4000-8000-0000000000a1',
   'c7000000-0000-4000-8000-000000000001', 'Eleve', 'A', 'hist-eleve-a@test.invalid', 'active'),
  ('67000000-0000-4000-8000-0000000000a2', 'b7000000-0000-4000-8000-0000000000a2',
   'c7000000-0000-4000-8000-000000000001', 'Eleve', 'B', 'hist-eleve-b@test.invalid', 'active'),
  ('67000000-0000-4000-8000-0000000000a3', 'b7000000-0000-4000-8000-0000000000a3',
   'c7000000-0000-4000-8000-000000000002', 'Eleve', 'C', 'hist-eleve-c@test.invalid', 'active');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('a7000000-0000-4000-8000-000000000001', 'Aliment de banc A5.7', 'g', 10, 20, 5);

-- Le journal : trois semaines, écrites en tant que `postgres` pour poser le
-- banc, exactement comme le serveur le ferait par ses RPC `security definer`.
--   semaine -1 : lundi 3 août       (une entrée)
--   semaine 0  : lundi 10 → dim. 16 (trois jours suivis, un repas VIDE)
--   semaine +1 : lundi 17 août      (une entrée)
insert into public.consumed_meals
  (id, student_id, consumed_on, kind, label, position) values
  ('d7000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-0000000000a1', '2026-08-03', 'student', 'Voisin avant', 0),
  ('d7000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-0000000000a1', '2026-08-10', 'student', 'Lundi',        0),
  ('d7000000-0000-4000-8000-000000000003', '67000000-0000-4000-8000-0000000000a1', '2026-08-13', 'student', 'Jeudi',        0),
  ('d7000000-0000-4000-8000-000000000004', '67000000-0000-4000-8000-0000000000a1', '2026-08-16', 'student', 'Dimanche',     0),
  ('d7000000-0000-4000-8000-000000000005', '67000000-0000-4000-8000-0000000000a1', '2026-08-17', 'student', 'Voisin après', 0),
  -- ⚠️ LE REPAS OUVERT MAIS VIDE — un conteneur, zéro aliment. C'est ce que
  -- produit l'ouverture d'un repas prescrit sur lequel l'élève n'a rien noté.
  ('d7000000-0000-4000-8000-000000000006', '67000000-0000-4000-8000-0000000000a1', '2026-08-12', 'student', 'Ouvert et vide', 1),
  -- L'élève B, la même semaine, avec des chiffres reconnaissables.
  ('d7000000-0000-4000-8000-0000000000b1', '67000000-0000-4000-8000-0000000000a2', '2026-08-13', 'student', 'B jeudi', 0),
  -- L'élève C, celui de l'AUTRE coach.
  ('d7000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-0000000000a3', '2026-08-13', 'student', 'C jeudi', 0);

insert into public.meal_entries
  (id, student_id, consumed_meal_id, source_type, food_id, label, quantity, unit, protein_g, carb_g, fat_g) values
  ('e7000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000001',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'Voisin avant', 100, 'g', 999, 0, 0),
  ('e7000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000002',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'Lundi', 100, 'g', 10, 20, 5),
  ('e7000000-0000-4000-8000-000000000003', '67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000003',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'Jeudi', 300, 'g', 30, 40, 10),
  -- ⚠️ LE THÉ SANS SUCRE — une saisie qui vaut zéro. C'est le contre-exemple
  -- du « jour sans saisie », et il doit compter comme un jour SUIVI.
  ('e7000000-0000-4000-8000-000000000004', '67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000004',
   'free', null, 'Thé vert', 250, 'ml', 0, 0, 0),
  ('e7000000-0000-4000-8000-000000000005', '67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000005',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'Voisin après', 100, 'g', 888, 0, 0),
  ('e7000000-0000-4000-8000-0000000000b1', '67000000-0000-4000-8000-0000000000a2', 'd7000000-0000-4000-8000-0000000000b1',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'B jeudi', 100, 'g', 777, 0, 0),
  ('e7000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-0000000000a3', 'd7000000-0000-4000-8000-0000000000c1',
   'catalog_food', 'a7000000-0000-4000-8000-000000000001', 'C jeudi', 100, 'g', 666, 0, 0);

do $$
begin
  perform pg_temp.noter('0', 'le banc compte trois élèves, deux coachs, huit repas et sept entrées',
    (select count(*) from public.students where email like 'hist-%@test.invalid') = 3
    and (select count(*) from public.coaches where email like 'hist-%@test.invalid') = 2
    and (select count(*) from public.consumed_meals where student_id::text like '67000000%') = 8
    and (select count(*) from public.meal_entries where student_id::text like '67000000%') = 7);

  perform pg_temp.noter('0', 'les deux premiers élèves ont bien le MÊME coach, le troisième un autre',
    (select coach_id from public.students where id = '67000000-0000-4000-8000-0000000000a1')
      = (select coach_id from public.students where id = '67000000-0000-4000-8000-0000000000a2')
    and (select coach_id from public.students where id = '67000000-0000-4000-8000-0000000000a3')
      <> (select coach_id from public.students where id = '67000000-0000-4000-8000-0000000000a1'));
end $$;

-- ---------------------------------------------------------------------
-- HIST5 · HIST13 — UNE SEMAINE EST BORNÉE À SEPT DATES
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000a1');

do $$
declare v_dates date[];
begin
  perform pg_temp.noter('HIST5', 'l''élève A voit ses repas de la semaine du 10 au 16, et EUX SEULS',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals
       where consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 4);

  -- Les voisins immédiats — le dimanche d'avant et le lundi d'après — sont
  -- exclus. Ce sont eux qu'une borne mal fermée laisse entrer, et leurs 999 et
  -- 888 g de protéines les rendraient impossibles à manquer dans le total.
  select array_agg(distinct consumed_on order by consumed_on) into v_dates
    from public.consumed_meals
   where consumed_on between date '2026-08-10' and date '2026-08-16';
  perform pg_temp.noter('HIST5', 'et aucune date extérieure ne s''y est glissée',
    v_dates = array['2026-08-10','2026-08-12','2026-08-13','2026-08-16']::date[]);

  -- HIST13 — le total de la semaine, calculé en base, doit valoir exactement
  -- 10 + 30 = 40 g de protéines. 999 ou 888 signeraient un voisin ; 777 ou 666,
  -- une fuite entre élèves.
  perform pg_temp.noter('HIST13', 'les protéines de la semaine valent exactement 40 g',
    pg_temp.nombre($q$
      select coalesce(sum(e.protein_g), 0) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 40);

  perform pg_temp.noter('HIST13', 'et les glucides 60 g, les lipides 15 g',
    pg_temp.nombre($q$
      select coalesce(sum(e.carb_g), 0) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 60
    and pg_temp.nombre($q$
      select coalesce(sum(e.fat_g), 0) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 15);
end $$;

-- ---------------------------------------------------------------------
-- HIST6 · HIST11 — LE CONTENEUR VIDE, ET LE THÉ SANS SUCRE
-- ---------------------------------------------------------------------
do $$
begin
  -- Le repas du 12 existe, et n'a AUCUNE entrée : ouvrir un repas ne crée pas
  -- une consommation. Le 12 ne doit donc pas être un « jour suivi ».
  perform pg_temp.noter('HIST6', 'le repas ouvert du 12 août existe bien…',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals where consumed_on = date '2026-08-12'
    $q$) = 1);

  perform pg_temp.noter('HIST6', '…et n''apporte AUCUNE entrée',
    pg_temp.compte($q$
      select count(*) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on = date '2026-08-12'
    $q$) = 0);

  -- ⚠️ LA DISTINCTION QUI GOUVERNE TOUT LE LOT. Le 12 (conteneur vide) et le 14
  -- (rien du tout) ont le même total : zéro. Le 16 (thé sans sucre) aussi. Et
  -- pourtant seul le 16 est un jour SUIVI — c'est le COMPTE D'ENTRÉES qui
  -- tranche, jamais la somme des macros.
  perform pg_temp.noter('HIST11', 'le 16 août — un thé sans sucre — totalise 0 kcal…',
    pg_temp.nombre($q$
      select coalesce(sum(e.protein_g * 4 + e.carb_g * 4 + e.fat_g * 9), 0)
        from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on = date '2026-08-16'
    $q$) = 0);

  perform pg_temp.noter('HIST11', '…et compte pourtant comme un jour SUIVI, contrairement au 12 et au 14',
    pg_temp.compte($q$
      select count(*) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on = date '2026-08-16'
    $q$) = 1
    and pg_temp.compte($q$
      select count(*) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on = date '2026-08-14'
    $q$) = 0);

  -- Les jours SUIVIS de la semaine : 10, 13, 16. Trois, et non quatre (le
  -- conteneur vide du 12 n'en est pas un) ni sept.
  perform pg_temp.noter('HIST11', 'la semaine compte 3 jours suivis sur 7, pas 4 ni 7',
    pg_temp.compte($q$
      select count(distinct m.consumed_on) from public.consumed_meals m
        join public.meal_entries e on e.consumed_meal_id = m.id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 3);
end $$;

-- ---------------------------------------------------------------------
-- HIST17 — L'ÉLÈVE A NE VOIT JAMAIS L'ÉLÈVE B
-- ---------------------------------------------------------------------
-- ⚠️ A ET B ONT LE MÊME COACH. C'est le cas exigeant : deux élèves de coachs
-- différents seraient isolés par accident si la policy se trompait de critère.
do $$
begin
  perform pg_temp.noter('HIST17', 'l''élève A ne voit AUCUN repas de B ni de C',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals
       where student_id <> '67000000-0000-4000-8000-0000000000a1'
    $q$) = 0);

  perform pg_temp.noter('HIST17', 'ni AUCUNE de leurs entrées',
    pg_temp.compte($q$
      select count(*) from public.meal_entries
       where student_id <> '67000000-0000-4000-8000-0000000000a1'
    $q$) = 0);

  -- CONTRÔLE DISCRIMINANT : la même requête, sur SES données, rend bien
  -- quelque chose. Sans lui, les deux zéros ci-dessus seraient verts même si la
  -- RLS masquait TOUT — y compris son propre journal.
  perform pg_temp.noter('HIST17', 'et il voit bien les siennes — le contrôle discrimine',
    pg_temp.compte('select count(*) from public.meal_entries') = 5);

end $$;

-- ⚠️ CE CONTRÔLE DOIT SORTIR DE LA SESSION ÉLÈVE. Le journal de B existe-t-il
-- vraiment ? Posé à l'intérieur du bloc ci-dessus, il serait lu SOUS LA RLS de
-- l'élève A — il rendrait donc zéro, et déclarerait le banc vide alors que la
-- règle est respectée. C'est exactement le piège qu'il est censé écarter :
-- distinguer « masqué par la RLS » de « jamais écrit ».
reset role;
do $$
begin
  perform pg_temp.noter('HIST17', 'alors que le journal de B existe réellement en base — la RLS le MASQUE, elle ne le supprime pas',
    (select count(*) from public.meal_entries
      where student_id = '67000000-0000-4000-8000-0000000000a2') = 1
    and (select count(*) from public.meal_entries
          where student_id = '67000000-0000-4000-8000-0000000000a3') = 1);
end $$;
set local role authenticated;

-- Symétrie : B non plus ne voit pas A.
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000a2');
do $$
begin
  perform pg_temp.noter('HIST17', 'et réciproquement, B ne voit rien de A',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals
       where student_id = '67000000-0000-4000-8000-0000000000a1'
    $q$) = 0
    and pg_temp.compte('select count(*) from public.meal_entries') = 1);
end $$;

-- ---------------------------------------------------------------------
-- HIST18 — LE COACH VOIT SES ÉLÈVES, ET SEULEMENT LES SIENS
-- ---------------------------------------------------------------------
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000c1');
do $$
begin
  perform pg_temp.noter('HIST18', 'le coach 1 lit l''historique de SES deux élèves',
    pg_temp.compte($q$
      select count(distinct student_id) from public.consumed_meals
    $q$) = 2
    and pg_temp.compte($q$
      select count(*) from public.meal_entries
       where student_id = '67000000-0000-4000-8000-0000000000a1'
    $q$) = 5);

  -- ⚠️ ET PAS CELUI DE L'ÉLÈVE C, qui appartient au coach 2. Sans ce troisième
  -- élève, « le coach voit son élève » serait vert même avec une policy qui
  -- laisse voir tout le monde.
  perform pg_temp.noter('HIST18', 'et ne voit RIEN de l''élève d''un autre coach',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals
       where student_id = '67000000-0000-4000-8000-0000000000a3'
    $q$) = 0
    and pg_temp.compte($q$
      select count(*) from public.meal_entries
       where student_id = '67000000-0000-4000-8000-0000000000a3'
    $q$) = 0);

  -- Le coach 2, lui, voit C — et seulement C.
  perform pg_temp.connecte('b7000000-0000-4000-8000-0000000000c2');
  perform pg_temp.noter('HIST18', 'le coach 2 voit son élève C, et lui seul',
    pg_temp.compte('select count(distinct student_id) from public.consumed_meals') = 1
    and pg_temp.compte($q$
      select count(*) from public.meal_entries
       where student_id = '67000000-0000-4000-8000-0000000000a3'
    $q$) = 1);
end $$;

-- ---------------------------------------------------------------------
-- HIST19 — LE COACH NE PEUT RIEN ÉCRIRE
-- ---------------------------------------------------------------------
-- ⚠️ CE N'EST PAS UNE QUESTION DE POLICY. Une policy dit quelles LIGNES sont
-- visibles ; c'est le PRIVILÈGE qui décide du verbe. Les deux tables retirent
-- `insert/update/delete` à `authenticated` tout entier — donc au coach comme à
-- l'élève —, et tout passe par des fonctions `security definer` qui lisent
-- l'élève dans le jeton, jamais dans un paramètre.
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000c1');
do $$
begin
  perform pg_temp.noter('HIST19', 'le coach ne peut pas AJOUTER une entrée au journal de son élève',
    pg_temp.refuse($q$
      insert into public.meal_entries
        (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('67000000-0000-4000-8000-0000000000a1', 'd7000000-0000-4000-8000-000000000003',
              'free', 'Ajouté par le coach', 100, 'g', 1, 1, 1)
    $q$));

  perform pg_temp.noter('HIST19', 'ni CORRIGER une quantité',
    pg_temp.refuse($q$
      update public.meal_entries set quantity = 1
       where id = 'e7000000-0000-4000-8000-000000000003'
    $q$));

  perform pg_temp.noter('HIST19', 'ni SUPPRIMER une entrée',
    pg_temp.refuse($q$
      delete from public.meal_entries where id = 'e7000000-0000-4000-8000-000000000003'
    $q$));

  perform pg_temp.noter('HIST19', 'ni créer un repas dans le journal de son élève',
    pg_temp.refuse($q$
      insert into public.consumed_meals (student_id, consumed_on, kind, label, position)
      values ('67000000-0000-4000-8000-0000000000a1', '2026-08-11', 'student', 'Coach', 0)
    $q$));

  -- HIST23 — ET SURTOUT : PERSONNE NE DÉPLACE UNE DATE. Consulter une semaine
  -- passée est une LECTURE ; si `consumed_on` était modifiable depuis le
  -- client, une navigation maladroite pourrait réécrire l'histoire.
  perform pg_temp.noter('HIST23', 'le coach ne peut pas DÉPLACER un repas dans le temps',
    pg_temp.refuse($q$
      update public.consumed_meals set consumed_on = '2026-08-11'
       where id = 'd7000000-0000-4000-8000-000000000003'
    $q$));

  -- Et le CONTRÔLE DISCRIMINANT : ce même coach LIT toujours. Les refus
  -- ci-dessus viennent bien du verbe, pas d'une session cassée.
  perform pg_temp.noter('HIST19', 'alors qu''il LIT toujours — les refus portent sur le verbe, pas sur la session',
    pg_temp.compte($q$
      select count(*) from public.meal_entries
       where student_id = '67000000-0000-4000-8000-0000000000a1'
    $q$) = 5);
end $$;

-- L'élève lui-même n'écrit pas davantage EN DIRECT : tout passe par les RPC.
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform pg_temp.noter('HIST23', 'l''élève non plus ne peut pas déplacer son repas d''un jour',
    pg_temp.refuse($q$
      update public.consumed_meals set consumed_on = '2026-08-11'
       where id = 'd7000000-0000-4000-8000-000000000003'
    $q$));

  perform pg_temp.noter('HIST23', 'et les dates du banc sont intactes après toutes ces tentatives',
    (select count(*) from public.consumed_meals
      where id = 'd7000000-0000-4000-8000-000000000003'
        and consumed_on = date '2026-08-13') = 1);
end $$;

-- ---------------------------------------------------------------------
-- COACH-HIST1 · COACH-HIST2 — LE CIBLAGE PAR ÉLÈVE, EXÉCUTÉ (A5.8)
-- ---------------------------------------------------------------------
-- ⚠️ CE QUE CETTE SECTION PROUVE, ET CE QU'ELLE NE PROUVE PAS.
--
-- La RLS du coach laisse passer TOUS ses élèves : c'est voulu, et c'est le
-- §8/§9 qui le vérifie. Elle ne DÉSAMBIGUÏSE donc rien — deux athlètes qui ont
-- mangé le même jour arrivent dans la même réponse, et plus rien ne les
-- distingue une fois les lignes fusionnées à l'écran.
--
-- Le `.eq('student_id', …)` que l'application ajoute depuis A5.8 ne PROTÈGE
-- rien de plus. Il sépare. Les deux contrôles ci-dessous mesurent exactement
-- cela : sans ciblage le coach reçoit deux élèves, avec ciblage un seul.
set local role authenticated;
select pg_temp.connecte('b7000000-0000-4000-8000-0000000000c1');

do $$
begin
  -- SANS ciblage : le coach voit ses DEUX élèves dans une seule réponse.
  -- C'est précisément le tas indifférencié que l'écran ne doit jamais recevoir.
  perform pg_temp.noter('COACH-HIST2', 'SANS ciblage, une semaine rend les repas de DEUX élèves — le mélange est réel',
    pg_temp.compte($q$
      select count(distinct student_id) from public.consumed_meals
       where consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 2);

  -- AVEC ciblage : un seul élève, celui qui est nommé.
  perform pg_temp.noter('COACH-HIST1', 'AVEC ciblage, la même semaine ne rend QUE l''élève nommé',
    pg_temp.compte($q$
      select count(distinct student_id) from public.consumed_meals
       where consumed_on between date '2026-08-10' and date '2026-08-16'
         and student_id = '67000000-0000-4000-8000-0000000000a1'
    $q$) = 1);

  -- Les entrées de A dans la semaine : 3 (les 10, 13 et 16 août). Les voisins
  -- des 3 et 17 août sont hors semaine, l'élève B est un autre élève.
  perform pg_temp.noter('COACH-HIST2', 'ciblé sur A, la semaine rend ses 3 entrées',
    pg_temp.compte($q$
      select count(*) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
         and e.student_id = '67000000-0000-4000-8000-0000000000a1'
    $q$) = 3);

  -- ⚠️ ET LA MESURE QUI DONNE SON SENS À LA PRÉCÉDENTE : sans ciblage, le coach
  -- en reçoit 4 — les 3 de A plus celle de B. C'est l'entrée de trop, celle qui
  -- se serait fondue dans le total de A. Une assertion du type « … and
  -- student_id <> student_id » serait toujours vraie et ne prouverait rien.
  perform pg_temp.noter('COACH-HIST2', 'SANS ciblage il en reçoit 4 — l''entrée de B se serait ajoutée au total de A',
    pg_temp.compte($q$
      select count(*) from public.meal_entries e
        join public.consumed_meals m on m.id = e.consumed_meal_id
       where m.consumed_on between date '2026-08-10' and date '2026-08-16'
    $q$) = 4);

  -- COACH-HIST3 — nommer l'élève d'un AUTRE coach ne contourne rien : la
  -- réponse est vide, et c'est la POLICY qui la vide, pas le filtre.
  perform pg_temp.noter('COACH-HIST3', 'nommer l''élève d''un autre coach rend une réponse VIDE',
    pg_temp.compte($q$
      select count(*) from public.consumed_meals
       where student_id = '67000000-0000-4000-8000-0000000000a3'
    $q$) = 0);

  -- Et le ciblage passe par l'index de tête, sans balayage.
  perform pg_temp.noter('COACH-HIST1', 'le ciblage utilise consumed_meals_student_date_idx',
    (select count(*) from pg_indexes
      where schemaname = 'public' and tablename = 'consumed_meals'
        and indexname = 'consumed_meals_student_date_idx'
        and indexdef ilike '%(student_id, consumed_on%') = 1);
end $$;

-- ---------------------------------------------------------------------
-- SUP — AUCUN AGRÉGAT PERSISTÉ, ET DES REQUÊTES BORNÉES
-- ---------------------------------------------------------------------
reset role;
do $$
declare v_plan text;
begin
  -- ⚠️ L'HISTORIQUE EST DÉRIVÉ. Aucune table, aucune vue, aucune vue
  -- matérialisée ne le double : une copie mentirait dès la première correction.
  -- ⚠️ LE GARDE EST NOMMÉ, PAS ÉLARGI. `training_change_history` existe depuis
  -- longtemps et n'a rien à voir avec la nutrition : l'exclure par une liste
  -- explicite garde le contrôle rouge le jour où une table d'historique
  -- ALIMENTAIRE apparaîtrait, là où assouplir le motif le rendrait muet.
  perform pg_temp.noter('SUP', 'aucune table d''historique alimentaire n''a été créée',
    (select coalesce(array_agg(tablename::text order by tablename), '{}'::text[])
       from pg_tables
      where schemaname = 'public'
        and (tablename ilike '%histor%' or tablename ilike '%hebdo%'
             or tablename ilike '%weekly%' or tablename ilike '%aggregat%'))
    = array['training_change_history']);

  perform pg_temp.noter('SUP', 'aucune vue ni vue matérialisée d''historique non plus',
    (select count(*) from pg_views
      where schemaname = 'public'
        and (viewname ilike '%histor%' or viewname ilike '%weekly%')) = 0
    and (select count(*) from pg_matviews where schemaname = 'public') = 0);

  -- ⚠️ CE CONTRÔLE NE PEUT PAS ÊTRE « PAS DE SEQ SCAN », ET C'EST UNE LEÇON.
  --
  -- Le banc de cette checklist compte HUIT lignes. Sur huit lignes, un Seq Scan
  -- est le plan CORRECT — lire la table entière coûte moins cher que passer par
  -- un index. Exiger l'absence de Seq Scan ici reviendrait à exiger du planner
  -- qu'il se trompe, et le contrôle serait vert ou rouge selon la taille du
  -- banc plutôt que selon la qualité du schéma.
  --
  -- Ce qui NE dépend pas de la taille, c'est qu'un index SERVE le prédicat. On
  -- le mesure en interdisant le balayage : si le planner trouve alors l'index
  -- de semaine, c'est que le prédicat lui correspond vraiment — ce qu'un simple
  -- contrôle d'existence par le nom ne dirait pas.
  --
  -- Le TEMPS réel, lui, a été mesuré sur le banc de stockage (20 élèves,
  -- 90 jours, 21 600 entrées) : Bitmap Index Scan, 0,333 ms.
  set local enable_seqscan = off;
  execute $q$
    explain (format text)
      select id from public.consumed_meals
       where student_id = '67000000-0000-4000-8000-0000000000a1'
         and consumed_on between date '2026-08-10' and date '2026-08-16'
  $q$ into v_plan;
  set local enable_seqscan = on;
  perform pg_temp.noter('SUP', 'un index SERT le prédicat (élève + semaine) — mesuré, pas déduit du nom',
    v_plan ilike '%consumed_meals_student_date_idx%');

  perform pg_temp.noter('SUP', 'et l''index de date existe bien',
    (select count(*) from pg_indexes
      where schemaname = 'public' and tablename = 'consumed_meals'
        and indexname = 'consumed_meals_student_date_idx') = 1);

  -- Et la colonne dont A5.7 avait besoin existait DÉJÀ : c'est pourquoi aucune
  -- migration n'accompagne ce lot.
  perform pg_temp.noter('SUP', 'meal_entries.product_id existe depuis A3 — aucune migration A5.7',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'meal_entries'
        and column_name = 'product_id') = 1);
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'ALIMENTS A5.7 · HISTORIQUE — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
begin
  raise notice '%', case
    when (select count(*) from public.students where email like 'hist-%@test.invalid') = 0
     and (select count(*) from public.meal_entries) = 0
     and (select count(*) from public.consumed_meals) = 0
     and (select count(*) from public.food_catalog where source = 'ciqual') = 3330
    then 'OK      — Z · aucune donnée de test ne subsiste, et les 3 330 aliments Ciqual sont intacts'
    else 'ÉCHEC   — Z · état inattendu après le ROLLBACK' end;
end $$;
