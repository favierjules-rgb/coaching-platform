-- ════════════════════════════════════════════════════════════════════════════
-- P13-A/perf — MESURE D'UNE SAUVEGARDE COMPLÈTE PAR save_nutrition_plan_v2
--
-- POURQUOI CE SCRIPT PORTE SON PROPRE JEU DE DONNÉES
--   `scripts/db-local-init.sh` n'accepte qu'une seule option de seed,
--   `npm run db:local:init -- --seed`, qui charge `supabase/seed.sql`. Or ce
--   fichier ne contient AUCUNE ligne de nutrition (vérifié : zéro insert dans
--   nutrition_plans, nutrition_days, meals, meal_choice_slots). Même avec
--   `--seed`, la base locale n'a donc pas un seul plan à mesurer — c'est
--   exactement pourquoi la première version de ce script s'est arrêtée.
--   Il construit donc lui-même un plan représentatif, dans la transaction qu'il
--   annule à la fin. Rien n'est ajouté au dépôt, rien ne survit au script.
--
-- CE QU'IL MESURE, ET CE QU'IL NE MESURE PAS
--   Il chronomètre la RPC ELLE-MÊME, sous l'identité d'un coach autorisé, avec
--   le `statement_timeout` réel du rôle `authenticated`. Un SELECT isolé ne
--   prouverait rien : `save_nutrition_plan_v2` SUPPRIME puis RÉINSÈRE l'arbre
--   complet du plan, et ce sont ces écritures qui déclenchaient le 57014.
--
--   La taille du jeu est paramétrable ci-dessous. Par défaut il vise l'ordre de
--   grandeur de la production (≈ 7 jours × 6 repas × 4 créneaux × 6 options),
--   mais une base locale reste une base locale : c'est le RAPPORT avant/après
--   qui fait preuve, pas la valeur absolue.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i supabase_db_coaching-platform-bootstrap \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/p13a_perf_sauvegarde_mesure.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ════════════════════════════════════════════════════════════════════════════

\timing off

-- ── A. ÉTAT DES LIEUX ──────────────────────────────────────────────────────
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nutrition_plan_ids_geres','nutrition_day_ids_geres',
                        'meal_ids_geres','meal_choice_slot_ids_geres',
                        'nutrition_plan_profile_ids_geres','student_ids_geres'))
    as fonctions_ensembles_sur_6,
  -- Compté sur `qual` ET `with_check`. Une policy `FOR INSERT` n'a PAS de
  -- `qual` — PostgreSQL ne stocke pour elle qu'un `with_check` — et
  -- `nutrition_plans_insert_own_coach` est exactement dans ce cas. Ne compter
  -- que `qual` en rend donc 9 au lieu de 10, et c'est le compteur qui a tort,
  -- pas la migration.
  (select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') like '%\_ids\_geres()%'
        or coalesce(with_check,'') like '%\_ids\_geres()%'))
    as policies_en_forme_ensembliste,
  (select coalesce(array_to_string(p.proconfig, ' | '), '(aucun)')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_nutrition_plan_v2')
    as proconfig_save_nutrition_plan_v2;
-- Attendu après 20261003090000 : 6 | 10 | search_path=""  (plus de statement_timeout)
--
-- LES 10 POLICIES EN FORME ENSEMBLISTE, NOMMÉMENT :
--   nutrition_plans_select_own_coach   (qual)        nutrition_plans_insert_own_coach   (with_check seul)
--   nutrition_plans_update_own_coach   (qual+check)  nutrition_days_manage_own_coach
--   nutrition_plan_profiles_manage_own_coach         nutrition_meal_slot_targets_manage_own_coach
--   meals_manage_own_coach                           meal_choice_slots_manage_own_coach
--   meal_choice_options_manage_own_coach             nutrition_daily_logs_manage_own_coach
--
-- Les 10 autres policies de la migration n'ont AUCUNE raison d'y figurer, et
-- les compter serait une erreur :
--   * les 8 `_manage_admin` opposent `is_admin()`, pas une propriété de coach ;
--   * `nutrition_plans_delete_own_coach` compare `coach_id` directement — le
--     plan supprimable est forcément un plan MODÈLE, sans élève, donc sans
--     ensemble à traverser ;
--   * `nutrition_daily_logs_manage_own_student` est l'accès ÉLÈVE.
-- Un compteur à 20 signifierait que l'accès admin ou l'accès élève est passé
-- par la propriété coach : ce serait une régression, pas un progrès.

begin;

-- Le carnet de résultats. Même forme que les autres checklists du dépôt : les
-- blocs qui tournent sous le rôle `authenticated` doivent pouvoir y écrire.
create temporary table _faits_perf (libelle text, ok boolean) on commit drop;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits_perf to authenticated, anon', s);
end $$;

create or replace function pg_temp.noter_perf(p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits_perf values (p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- ── A2. LA GARDE ADMIN EST BIEN EN BASE ────────────────────────────────────
-- Contrôlé AVANT toute mesure, et sur la base elle-même — pas sur le texte des
-- migrations. Si la garde posée par 20261003190000 manque ici, la mesure qui
-- suit n'a plus de sens : elle mesurerait l'état d'avant le correctif et
-- échouerait en 57014 sans qu'on sache pourquoi.
--
-- La forme exacte compte. `not (select public.is_admin())` est hissé en
-- InitPlan — évalué une fois, AVANT les sous-plans, ce qui permet au `and` de
-- les court-circuiter. Un `not public.is_admin()` nu serait réévalué à chaque
-- ligne : même verdict, coût inchangé. Le motif ci-dessous n'accepte donc que
-- la forme hissée, telle que PostgreSQL la restitue dans `pg_policies`.
do $$
declare
  v_attendu constant text[] := array[
    'nutrition_plans_select_own_coach',   'nutrition_plans_insert_own_coach',
    'nutrition_plans_update_own_coach',   'nutrition_plans_delete_own_coach',
    'nutrition_days_manage_own_coach',    'nutrition_plan_profiles_manage_own_coach',
    'nutrition_meal_slot_targets_manage_own_coach', 'meals_manage_own_coach',
    'meal_choice_slots_manage_own_coach', 'meal_choice_options_manage_own_coach',
    'nutrition_daily_logs_manage_own_coach'
  ];
  c_hissee constant text := '^\(+NOT \( SELECT is_admin\(\) AS is_admin\)\) AND ';
  v_liste text;
  v_n int;
begin
  -- (a) Les 11 policies coach existent et CHACUNE de leurs clauses présentes
  -- commence par la garde hissée. Une clause gardée et l'autre non suffirait à
  -- faire repasser l'écriture par l'ensemble complet.
  -- Un LEFT JOIN, sans `union all` : `p.policyname is null` couvre la policy
  -- ABSENTE, les deux `!~` couvrent la policy présente mais non gardée. Un
  -- `union all` ici serait non parenthésé et ferait tomber, à juste titre, le
  -- contrôle d'associativité qui garde la section F.
  select coalesce(string_agg(a.nom, ', '), ''), count(*) into v_liste, v_n
    from unnest(v_attendu) as a(nom)
    left join pg_policies p
      on p.schemaname = 'public' and p.policyname = a.nom
   where p.policyname is null
      or (p.qual is not null and p.qual !~ c_hissee)
      or (p.with_check is not null and p.with_check !~ c_hissee);
  perform pg_temp.noter_perf(
    format('A2a. les 11 policies coach portent la garde admin hissée%s',
           case when v_liste = '' then '' else ' — sans : ' || v_liste end),
    v_n = 0);

  -- (b) Et AUCUNE policy administrateur ne la porte. `not is_admin() and
  -- is_admin()` est toujours faux : l'admin perdrait la table, et la mesure
  -- qui suit échouerait en « permission denied » au lieu de mesurer.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and policyname like '%\_manage\_admin'
     and (coalesce(qual, '') ~ c_hissee or coalesce(with_check, '') ~ c_hissee);
  perform pg_temp.noter_perf(
    format('A2b. aucune policy administrateur n''est gardée%s',
           case when v_liste = '' then '' else ' — trouvées : ' || v_liste end),
    v_n = 0);

  -- (c) CONTRÔLE DU CONTRÔLE. Aucune garde en forme NON hissée ne traîne : le
  -- motif de (a) les rejetterait, mais elles passeraient inaperçues sur une
  -- policy hors des 11 attendues.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'NOT is_admin\(\)'
       or coalesce(with_check, '') ~ 'NOT is_admin\(\)');
  perform pg_temp.noter_perf(
    format('A2c. CONTRÔLE — aucune garde en forme non hissée (coût par ligne)%s',
           case when v_liste = '' then '' else ' — trouvées : ' || v_liste end),
    v_n = 0);
end $$;

-- ── A3. LA LECTURE ÉLÈVE EST BIEN EN FORME ENSEMBLISTE ────────────────────
-- Même principe que A2, sur l'autre moitié du correctif. Si les policies
-- élève sont redevenues des EXISTS corrélés, la mesure qui suit replanifiera
-- ~576 nœuds à chaque instruction et échouera en 57014 sans qu'on sache
-- pourquoi. La forme exacte compte : `(select public.current_student_id())`
-- est hissé en InitPlan, un appel nu serait réévalué à chaque ligne.
do $$
declare
  v_attendu constant text[] := array[
    'nutrition_plans_select_self_or_assigned', 'nutrition_days_select_self_or_assigned',
    'nutrition_days_update_self',              'nutrition_plan_profiles_select_assigned',
    'nutrition_meal_slot_targets_select_assigned', 'meals_select_self_or_assigned',
    'meal_choice_slots_select_assigned',       'meal_choice_options_select_assigned'
  ];
  v_fonctions constant text[] := array[
    'nutrition_plan_ids_eleve','nutrition_day_ids_eleve',
    'nutrition_plan_profile_ids_eleve','meal_ids_eleve','meal_choice_slot_ids_eleve'
  ];
  c_hissee constant text := '^\(+\( SELECT current_student_id\(\) AS current_student_id\) IS NOT NULL\) AND ';
  v_liste text;
  v_n int;
begin
  -- (a) Les 8 policies élève existent et leur USING commence par la garde.
  select coalesce(string_agg(a.nom, ', '), ''), count(*) into v_liste, v_n
    from unnest(v_attendu) as a(nom)
    left join pg_policies p
      on p.schemaname = 'public' and p.policyname = a.nom
   where p.policyname is null
      or p.qual is null
      or p.qual !~ c_hissee;
  perform pg_temp.noter_perf(
    format('A3a. les 8 policies élève portent la garde current_student_id() hissée%s',
           case when v_liste = '' then '' else ' — sans : ' || v_liste end),
    v_n = 0);

  -- (b) Aucune ne traverse plus d'autre table : plus un seul EXISTS.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and policyname = any(v_attendu)
     and coalesce(qual, '') like '%EXISTS%';
  perform pg_temp.noter_perf(
    format('A3b. aucune policy élève ne réapplique la RLS d''une table jointe%s',
           case when v_liste = '' then '' else ' — trouvées : ' || v_liste end),
    v_n = 0);

  -- (c) Les cinq ensembles élève existent, sans argument, SECURITY DEFINER,
  -- pg_temp nommé en dernier.
  select coalesce(string_agg(f.nom, ', '), ''), count(*) into v_liste, v_n
    from unnest(v_fonctions) as f(nom)
    left join (
      select pr.proname, pr.pronargs, pr.prosecdef, pr.provolatile,
             array_to_string(pr.proconfig, ' ') as config
        from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
       where n.nspname = 'public'
    ) p on p.proname = f.nom
   where p.proname is null
      or p.pronargs <> 0
      or not p.prosecdef
      or p.provolatile <> 's'
      or coalesce(p.config, '') !~ ', *pg_temp$';
  perform pg_temp.noter_perf(
    format('A3c. les 5 ensembles élève sont sans argument, STABLE SECURITY DEFINER, pg_temp en dernier%s',
           case when v_liste = '' then '' else ' — en défaut : ' || v_liste end),
    v_n = 0);

  -- (d) CONTRÔLE DU CONTRÔLE. Aucune garde élève en forme NON hissée : le
  -- motif de (a) les rejetterait, mais elles passeraient inaperçues ailleurs.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), ''), count(*)
    into v_liste, v_n
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ '[^)] current_student_id\(\) IS NOT NULL'
       or coalesce(with_check, '') ~ '[^)] current_student_id\(\) IS NOT NULL');
  perform pg_temp.noter_perf(
    format('A3d. CONTRÔLE — aucune garde élève en forme non hissée (coût par ligne)%s',
           case when v_liste = '' then '' else ' — trouvées : ' || v_liste end),
    v_n = 0);
end $$;

-- ── B. LE DÉCOR, ÉPHÉMÈRE ──────────────────────────────────────────────────
-- Deux coachs, deux élèves : le cloisonnement doit être vérifiable dans la
-- même transaction que la mesure, sinon on mesurerait vite sans savoir si on
-- mesure encore quelque chose de sûr.

insert into auth.users (id, email) values
  ('9e4f0000-0000-4000-8000-00000000c0a1'::uuid, 'perf.coachA@test.local'),
  ('9e4f0000-0000-4000-8000-00000000c0b1'::uuid, 'perf.coachB@test.local'),
  ('9e4f0000-0000-4000-8000-0000000051a2'::uuid, 'perf.eleveA@test.local'),
  ('9e4f0000-0000-4000-8000-0000000051b2'::uuid, 'perf.eleveB@test.local'),
  ('9e4f0000-0000-4000-8000-0000000000d0'::uuid, 'perf.admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('9e4f0000-0000-4000-8000-00000000c0a1'::uuid, 'coach',   'PerfCoachA', 'S', 'perf.coachA@test.local'),
  ('9e4f0000-0000-4000-8000-00000000c0b1'::uuid, 'coach',   'PerfCoachB', 'S', 'perf.coachB@test.local'),
  ('9e4f0000-0000-4000-8000-0000000051a2'::uuid, 'student', 'PerfEleveA', 'S', 'perf.eleveA@test.local'),
  ('9e4f0000-0000-4000-8000-0000000051b2'::uuid, 'student', 'PerfEleveB', 'S', 'perf.eleveB@test.local'),
  ('9e4f0000-0000-4000-8000-0000000000d0'::uuid, 'admin',   'PerfAdmin',  'S', 'perf.admin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('9e4fc0ac-0000-4000-8000-0000000000a1'::uuid, '9e4f0000-0000-4000-8000-00000000c0a1'::uuid, 'PerfCoachA', 'perf.coachA@test.local'),
  ('9e4fc0ac-0000-4000-8000-0000000000b1'::uuid, '9e4f0000-0000-4000-8000-00000000c0b1'::uuid, 'PerfCoachB', 'perf.coachB@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type, coach_id) values
  ('9e4f5700-0000-4000-8000-0000000000a2'::uuid, '9e4f0000-0000-4000-8000-0000000051a2'::uuid, 'PerfEleveA', 'S', 'perf.eleveA@test.local', 'active', 'coaching', '9e4fc0ac-0000-4000-8000-0000000000a1'::uuid),
  ('9e4f5700-0000-4000-8000-0000000000b2'::uuid, '9e4f0000-0000-4000-8000-0000000051b2'::uuid, 'PerfEleveB', 'S', 'perf.eleveB@test.local', 'active', 'coaching', '9e4fc0ac-0000-4000-8000-0000000000b1'::uuid);

-- Des aliments, uniquement s'il n'y en a pas déjà. On ne crée rien d'inutile.
insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100, status)
select ('9e4fa11d-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'Perf aliment ' || i, 20, 10, 5, 'active'
  from generate_series(1, 12) i
 where not exists (select 1 from public.food_catalog where status = 'active');

-- ── C. LE CONSTRUCTEUR DE CHARGE UTILE ─────────────────────────────────────
-- Forme reprise telle quelle de supabase/tests/nutrition_n1_3_occurrences_checklist.sql
-- (fonctions pg_temp.six_creneaux / pg_temp.option_aliment / pg_temp.payload) :
-- c'est le contrat que la RPC attend réellement, pas une reconstitution.

create or replace function pg_temp.six_creneaux()
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
           'slot', s.slot, 'enabled', true,
           'protein_bp', 1666, 'carb_bp', 1666, 'fat_bp', 1666,
           'display_order', s.ord) order by s.ord)
    from (values ('breakfast',1),('morning_snack',2),('lunch',3),
                 ('afternoon_snack',4),('dinner',5),('dessert',6)) as s(slot, ord);
$$;

create or replace function pg_temp.option_aliment(p_id uuid)
returns jsonb language sql immutable as $$ select jsonb_build_object('catalog_food_id', p_id) $$;

-- Un repas : `p_options` options réparties sur `p_creneaux` créneaux de choix.
create or replace function pg_temp.repas(p_slot text, p_creneaux int, p_options int)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'slot', p_slot,
    'name', 'Perf ' || p_slot,
    'items', '[]'::jsonb,
    'choice_slots', (
      select jsonb_agg(jsonb_build_object(
               'label', 'Choix ' || c,
               'options', (
                 select jsonb_agg(pg_temp.option_aliment(f.id))
                   from (select id from public.food_catalog
                          where status = 'active' order by id limit p_options) f)))
        from generate_series(1, p_creneaux) c));
$$;

-- Le plan complet : `p_jours` jours × 6 repas.
create or replace function pg_temp.charge_utile(p_plan_id uuid, p_jours int,
                                                p_creneaux int, p_options int)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'plan_id', p_plan_id,
    'plan', jsonb_build_object('name', 'Perf plan P13-A', 'status', 'actif'),
    'profile', jsonb_build_object('profile_key', 'default', 'daily_calories', 2200,
                                  'protein_bp', 3000, 'carb_bp', 4000, 'fat_bp', 3000),
    'slots', pg_temp.six_creneaux(),
    'main_profile_key', 'default',
    'profiles', jsonb_build_array(jsonb_build_object(
      'profile_key','default','daily_calories',2200,'protein_bp',3000,'carb_bp',4000,'fat_bp',3000,
      'slots', pg_temp.six_creneaux())),
    'days', (
      select jsonb_agg(jsonb_build_object(
               'day', j.jour, 'profile_key', 'default',
               'meals', (select jsonb_agg(pg_temp.repas(s.slot, p_creneaux, p_options))
                           from (values ('breakfast'),('morning_snack'),('lunch'),
                                        ('afternoon_snack'),('dinner'),('dessert')) as s(slot))))
        from (select unnest((array['monday','tuesday','wednesday','thursday',
                                   'friday','saturday','sunday'])[1:p_jours]) as jour) j)
  );
$$;

-- ── D. LA MESURE ───────────────────────────────────────────────────────────
--
-- LA LIMITE DE 8 SECONDES, ET POURQUOI ELLE EST POSÉE ICI ET PAS AILLEURS
--   Sur la base hébergée, `authenticated` porte `statement_timeout = 8s`
--   (relevé dans pg_db_role_setting). La pile Supabase LOCALE ne reprend pas
--   ce réglage de rôle : `current_setting('statement_timeout')` y vaut `0`,
--   c'est-à-dire AUCUNE limite. Mesurer ainsi reviendrait à mesurer sans le
--   garde-fou qu'on cherche justement à respecter.
--
--   On l'impose donc avec `SET LOCAL`, dont la portée est la transaction en
--   cours : annulé par le ROLLBACK, sans effet sur la configuration du serveur,
--   du rôle ou de la production.
--
--   ⚠️ IL EST POSÉ AU NIVEAU SUPÉRIEUR, HORS des blocs `do $$`. Ce n'est pas
--   un détail de mise en forme, c'est la même règle que celle qui rendait
--   inopérant l'`alter function … set statement_timeout = '30s'` : PostgreSQL
--   ARME le minuteur au démarrage d'une instruction de plus haut niveau, et
--   changer la valeur EN COURS d'instruction ne réarme pas un minuteur déjà
--   programmé. Un `set local` écrit à l'intérieur d'un `do $$` ne protégerait
--   donc pas ce bloc-là.
--
--   Conséquence assumée : chaque bloc `do $$` est UNE instruction, donc un
--   budget de 8 s. On sépare les deux appels en deux blocs pour que chaque
--   sauvegarde dispose du même budget qu'en production, où un appel PostgREST
--   = une instruction.
set local statement_timeout = '8s';

-- La valeur effective, constatée AVANT toute mesure.
select current_setting('statement_timeout') as statement_timeout_effectif;

-- Si elle n'a pas pris, on s'arrête : mieux vaut pas de mesure qu'une mesure
-- présentée comme conforme alors qu'elle tournait sans limite.
do $$
begin
  if current_setting('statement_timeout') <> '8s' then
    raise exception
      'LIMITE NON IMPOSÉE : statement_timeout vaut « % » au lieu de « 8s ». La mesure tournerait sans le garde-fou de production et ne prouverait rien.',
      current_setting('statement_timeout');
  end if;
end $$;

-- ── D.1 CRÉATION ──────────────────────────────────────────────────────────
do $$
declare
  c_jours    constant int := 7;
  c_creneaux constant int := 4;
  c_options  constant int := 6;
  v_uid      uuid := '9e4f0000-0000-4000-8000-00000000c0a1';  -- coach A
  v_res      jsonb;
  v_t0       timestamptz;
  v_ms       numeric;
  v_n        int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  raise notice '--------------------------------------------------------------';
  raise notice 'Identité      : coach A (%)', v_uid;
  raise notice 'statement_timeout juste avant l''appel : %', current_setting('statement_timeout');
  raise notice 'Charge visée  : % jours x 6 repas x % créneaux x % options = % options',
    c_jours, c_creneaux, c_options, c_jours * 6 * c_creneaux * c_options;

  v_t0 := clock_timestamp();
  begin
    v_res := public.save_nutrition_plan_v2(pg_temp.charge_utile(null, c_jours, c_creneaux, c_options));
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    raise notice '>>> CRÉATION       : % ms', round(v_ms);
  exception
    when query_canceled then
      raise exception '>>> CRÉATION ANNULÉE (57014) après % ms sous une limite de % — le correctif ne suffit pas',
        round(extract(epoch from clock_timestamp() - v_t0) * 1000),
        current_setting('statement_timeout');
  end;

  perform set_config('perf.plan_id', (v_res #>> '{plan,id}'), true);
  perform set_config('perf.ms_creation', round(v_ms)::text, true);

  select count(*) into v_n from public.meal_choice_options o
    join public.meal_choice_slots s on s.id = o.slot_id
    join public.meals m on m.id = s.meal_id
    join public.nutrition_days d on d.id = m.nutrition_day_id
   where d.plan_id = (v_res #>> '{plan,id}')::uuid;
  raise notice '    options réellement écrites : %', v_n;
  perform set_config('perf.options', v_n::text, true);
  reset role;
end $$;

-- ── D.2 RÉÉCRITURE ────────────────────────────────────────────────────────
-- Le cas qui échouait en production : la RPC SUPPRIME tout l'arbre existant
-- avant de le réinsérer, donc les policies sont évaluées en DELETE **et** en
-- INSERT. C'est le pire cas, et il a son propre budget de 8 s.
do $$
declare
  c_jours    constant int := 7;
  c_creneaux constant int := 4;
  c_options  constant int := 6;
  v_plan_id  uuid := current_setting('perf.plan_id')::uuid;
  v_t0       timestamptz;
  v_ms       numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"9e4f0000-0000-4000-8000-00000000c0a1","role":"authenticated"}', true);

  raise notice 'statement_timeout juste avant l''appel : %', current_setting('statement_timeout');

  v_t0 := clock_timestamp();
  begin
    perform public.save_nutrition_plan_v2(pg_temp.charge_utile(v_plan_id, c_jours, c_creneaux, c_options));
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    raise notice '>>> RÉÉCRITURE     : % ms  (suppression + réinsertion de l''arbre)', round(v_ms);
  exception
    when query_canceled then
      raise exception '>>> RÉÉCRITURE ANNULÉE (57014) après % ms sous une limite de % — le correctif ne suffit pas',
        round(extract(epoch from clock_timestamp() - v_t0) * 1000),
        current_setting('statement_timeout');
  end;
  perform set_config('perf.ms_reecriture', round(v_ms)::text, true);
  reset role;

  raise notice '>>> VERDICT        : création % ms + réécriture % ms sur % options, sous une limite de %',
    current_setting('perf.ms_creation'), round(v_ms),
    current_setting('perf.options'), current_setting('statement_timeout');
  raise notice '--------------------------------------------------------------';
end $$;

-- ── E. AUCUN ACCÈS CROISÉ : la vitesse n'a rien coûté au cloisonnement ─────
do $$
declare v_plan uuid := current_setting('perf.plan_id')::uuid; v_n int; v_ok boolean;
begin
  -- Coach B, face au plan que coach A vient d'écrire.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"9e4f0000-0000-4000-8000-00000000c0b1","role":"authenticated"}', true);

  select count(*) into v_n from public.nutrition_plans where id = v_plan;
  perform pg_temp.noter_perf('E1. le coach B ne LIT PAS le plan du coach A', v_n = 0);

  select count(*) into v_n from public.nutrition_days d where d.plan_id = v_plan;
  perform pg_temp.noter_perf('E2. ni ses journées', v_n = 0);

  select count(*) into v_n from public.meals m
    join public.nutrition_days d on d.id = m.nutrition_day_id where d.plan_id = v_plan;
  perform pg_temp.noter_perf('E3. ni ses repas', v_n = 0);

  select count(*) into v_n from public.meal_choice_options o
    join public.meal_choice_slots s on s.id = o.slot_id
    join public.meals m on m.id = s.meal_id
    join public.nutrition_days d on d.id = m.nutrition_day_id where d.plan_id = v_plan;
  perform pg_temp.noter_perf('E4. ni ses options de choix', v_n = 0);

  begin
    update public.nutrition_plans set name = 'PIRATE' where id = v_plan;
    get diagnostics v_n = row_count;
    v_ok := v_n = 0;
  exception when insufficient_privilege then v_ok := true;
            when others then v_ok := false;
  end;
  perform pg_temp.noter_perf('E5. ni ne peut le modifier', v_ok);

  -- Le coach B n'a pas non plus pu se l'approprier au passage.
  reset role;
  select count(*) into v_n from public.nutrition_plans
   where id = v_plan and coach_id = '9e4fc0ac-0000-4000-8000-0000000000a1'::uuid;
  perform pg_temp.noter_perf('E6. BILAN — le plan appartient toujours au coach A', v_n = 1);

  -- L'administrateur, lui, voit tout.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"9e4f0000-0000-4000-8000-0000000000d0","role":"authenticated"}', true);
  select count(*) into v_n from public.nutrition_plans where id = v_plan;
  perform pg_temp.noter_perf('E7. l''administrateur conserve son accès global', v_n = 1);
  reset role;

  -- CONTRÔLE DU CONTRÔLE : le coach A, lui, voit bien son plan. Sans cela,
  -- E1-E4 seraient verts si le plan n'existait tout simplement pas.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"9e4f0000-0000-4000-8000-00000000c0a1","role":"authenticated"}', true);
  select count(*) into v_n from public.nutrition_plans where id = v_plan;
  perform pg_temp.noter_perf('E8. CONTRÔLE — le coach A voit bien SON plan', v_n = 1);
  reset role;
end $$;

-- ── F. LES DEUX FORMES DE LA RÈGLE RENDENT LE MÊME VERDICT ────────────────
do $$
declare v_uid uuid; v_ecarts int; v_identites int := 0; v_couverture int := 0; v_n int;
begin
  for v_uid in select user_id from public.profiles where user_id is not null order by user_id
  loop
    v_identites := v_identites + 1;
    -- Claims posées SANS bascule de rôle : `auth.uid()` ne dépend pas du rôle
    -- Postgres, et sous `authenticated` la RLS filtrerait d'abord
    -- `nutrition_plans` — on comparerait deux sous-ensembles déjà réduits.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    -- Différence SYMÉTRIQUE. Les parenthèses internes sont indispensables :
    -- `A except B union all B except A` s'associe à gauche et calcule
    -- `((A except B) union all B) except A`, qui masquerait les écarts.
    -- NOMMAGE DE LA COLONNE DE RETOUR. `nutrition_plan_ids_geres()` est
    -- déclarée `returns setof uuid` : un type SCALAIRE, pas composite. Dans un
    -- FROM, PostgreSQL nomme donc sa colonne d'après LA FONCTION
    -- (`nutrition_plan_ids_geres`), et non `id` — d'où le « column "id" does
    -- not exist » de la version précédente. On pose un alias de colonne
    -- explicite des DEUX côtés, ce qui nomme la chose sans dépendre de la
    -- convention implicite.
    select count(*) into v_ecarts from (
      (select p.id from public.nutrition_plans p where public.can_manage_nutrition_plan(p.id)
       except
       select g.plan_id from public.nutrition_plan_ids_geres() as g(plan_id))
      union all
      (select g.plan_id from public.nutrition_plan_ids_geres() as g(plan_id)
       except
       select p.id from public.nutrition_plans p where public.can_manage_nutrition_plan(p.id))
    ) x;
    if v_ecarts <> 0 then
      raise exception 'ÉCART DE RÈGLE pour % : % plan(s) divergent entre can_manage_nutrition_plan() et nutrition_plan_ids_geres()', v_uid, v_ecarts;
    end if;

    select count(*) into v_n from public.nutrition_plan_ids_geres() as g(plan_id);
    if v_n > 0 then v_couverture := v_couverture + 1; end if;
  end loop;

  -- CONTRÔLE DU CONTRÔLE : si personne ne gère rien, l'égalité est vraie par
  -- vacuité et ne prouve rien.
  if v_couverture = 0 then
    raise exception 'CONTRÔLE VIDE : aucune identité ne gère de plan — la comparaison ne prouve rien.';
  end if;
  perform pg_temp.noter_perf(
    format('F1. %s identité(s) comparées, %s gérant au moins un plan : aucun écart entre les deux formes',
           v_identites, v_couverture), true);
end $$;

-- ── G. BILAN ───────────────────────────────────────────────────────────────
do $$
declare v_total int; v_ko int; v_liste text;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits_perf;
  select string_agg(libelle, E'\n  ') into v_liste from _faits_perf where not ok;
  raise notice '';
  raise notice '──────── % contrôles de cloisonnement, % échec(s) ────────', v_total, v_ko;
  if v_ko > 0 then raise exception E'MESURE EN ÉCHEC :\n  %', v_liste; end if;
end $$;

rollback;

-- ── H. RIEN NE SURVIT ──────────────────────────────────────────────────────
do $$
declare nb int;
begin
  select count(*) into nb from auth.users where email like 'perf.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — des comptes de mesure ont survécu au ROLLBACK'; end if;
  select count(*) into nb from public.nutrition_plans where name = 'Perf plan P13-A';
  if nb <> 0 then raise exception 'ÉCHEC — le plan de mesure a survécu au ROLLBACK'; end if;
  select count(*) into nb from public.food_catalog where name like 'Perf aliment %';
  if nb <> 0 then raise exception 'ÉCHEC — des aliments de mesure ont survécu au ROLLBACK'; end if;
  raise notice 'OK — aucune donnée de mesure après le ROLLBACK';
end $$;
