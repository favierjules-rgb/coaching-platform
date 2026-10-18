-- ════════════════════════════════════════════════════════════════════════════
-- CATALOGUE D'OFFRES — LE CHEMIN RÉEL DU VISITEUR, EN RÔLE `anon`
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/catalogue_offres_role_anon.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI CE FICHIER EXISTE SÉPARÉMENT DE LA MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
-- La migration 20261021090000 borne au rôle `authenticated` les trois policies
-- d'écriture de `subscription_templates`. Elle ne peut PAS vérifier elle-même
-- le comportement du visiteur : pour l'exercer, il faut prendre le rôle `anon`
-- le temps d'une requête, et un fichier de migration ne doit pas toucher au
-- rôle actif de sa session.
--
-- Raison, apprise à nos frais sur le lot précédent : la CLI Supabase applique
-- le fichier PUIS enregistre son passage dans
-- `supabase_migrations.schema_migrations`, sur la même connexion. Un
-- « 42501 permission denied for schema supabase_migrations » a dû être réparé
-- à la main. Une bascule du rôle actif en cours de migration — même rendue à
-- son état d'origine — peut faire perdre à la CLI les droits nécessaires à cet
-- enregistrement.
--
-- La migration garde donc les vérifications de CATALOGUE SYSTÈME, qui n'exigent
-- aucun changement de rôle. Ce fichier-ci porte l'EXÉCUTION RÉELLE, hors du
-- processus de migration, où la bascule de rôle est sans danger.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CE FICHIER MESURE, ET POURQUOI LE SQLSTATE SEUL NE SUFFIT PAS
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ON MESURE LE MESSAGE, PAS SEULEMENT LE SQLSTATE. « refusé par la règle
-- d'accès » et « refusé parce qu'une fonction manque » portent TOUS DEUX le
-- code 42501 : seul le texte les distingue, et c'est précisément ce que ce
-- correctif change.
--
--   avant 20261021090000 :  42501  permission denied for function is_admin
--   après                :  42501  new row violates row-level security policy
--
-- Un contrôle sur le seul SQLSTATE serait resté vert avant comme après. Pire,
-- une policy qui LÈVE au lieu de refuser fait échouer TOUTE la requête — c'est
-- exactement ce mécanisme qui rendait la vitrine publique illisible avant
-- 20261020090000.
--
-- ⚠️ ET LE VISITEUR DÉTIENT LES PRIVILÈGES DE TABLE. `anon` a INSERT, UPDATE
-- et DELETE sur `public.subscription_templates` (GRANT par défaut de Supabase).
-- Ces trois policies sont donc réellement évaluées pour lui : le contrôle n'est
-- pas théorique.
--
-- Tout se termine par un ROLLBACK : rien n'est écrit.

\set ON_ERROR_STOP on

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

/**
 * Redevenir le SERVEUR : rôle ET revendications remises à zéro.
 *
 * ⚠️ `reset role` NE SUFFIT PAS. Il rend le rôle `postgres` mais LAISSE
 * `request.jwt.claims` : `auth.uid()` continuerait de désigner le dernier
 * acteur, et un décor inséré « en postgres » serait en réalité jugé comme lui.
 *
 * ⚠️ `'{}'` ET PAS LA CHAÎNE VIDE : `auth.uid()` parse cette variable en JSON,
 * et une chaîne vide lève « invalid input syntax for type json ». Un objet
 * vide est du JSON valide sans `sub` — donc `auth.uid()` est NULL, c'est-à-dire
 * exactement un contexte serveur.
 */
create or replace function pg_temp.serveur() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.visiteur() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

/**
 * Lecture en rôle `anon`.
 *
 * ⚠️ UN REFUS REND -1, JAMAIS 0. « La vitrine est vide » et « la requête de la
 * vitrine a été refusée » sont deux états très différents : le second était le
 * défaut corrigé par 20261020090000.
 */
create or replace function pg_temp.lire_anon(p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.visiteur();
  begin execute p_sql into v; exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

/**
 * Écriture dans un rôle donné, en rendant LE MESSAGE et le nombre de lignes.
 *
 * `p_user` NULL ⇒ rôle `anon` ; sinon `authenticated` avec cet identifiant.
 * Rend `(lignes, sqlstate, message)` : c'est le message qui distingue les deux
 * refus, et c'est pour ça qu'on ne rend pas un simple booléen.
 */
create or replace function pg_temp.tenter(p_user uuid, p_sql text,
  out o_lignes int, out o_sqlstate text, out o_message text)
language plpgsql as $$
begin
  if p_user is null then perform pg_temp.visiteur();
  else perform pg_temp.devenir(p_user); end if;
  begin
    execute p_sql;
    get diagnostics o_lignes = row_count;
    o_sqlstate := '00000';
    o_message := '(acceptée)';
  exception when others then
    o_lignes := -1;
    o_sqlstate := sqlstate;
    o_message := sqlerrm;
  end;
  perform pg_temp.serveur();
end $$;


-- ── LE DÉCOR ───────────────────────────────────────────────────────────────
-- Un programme PUBLIÉ qui présente une offre, une offre interne qu'aucun
-- programme publié ne présente, un administrateur et un coach autonome.
do $$
declare
  u_adm   constant uuid := '00000000-0000-4000-8000-0000000000b1';
  u_coach constant uuid := '00000000-0000-4000-8000-0000000000b2';
  c_adm   constant uuid := '00000000-0000-4000-8000-0000000000c1';
  c_coach constant uuid := '00000000-0000-4000-8000-0000000000c2';
  t_pub   constant uuid := '00000000-0000-4000-8000-0000000000d1';
  t_int   constant uuid := '00000000-0000-4000-8000-0000000000d2';
  p_pub   constant uuid := '00000000-0000-4000-8000-0000000000e1';
begin
  perform pg_temp.serveur();

  insert into auth.users (id, email) values
    (u_adm, 'cat.adm@test.local'), (u_coach, 'cat.coach@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,  'cat.adm@test.local',  'admin','CAT','Admin'),
    (u_coach,'cat.coach@test.local','coach','CAT','Coach');
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm,  u_adm,  'cat.adm@test.local',  'CAT Admin','admin','actif','-'),
    (c_coach,u_coach,'cat.coach@test.local','CAT Coach','assistant','actif','-');

  insert into public.subscription_templates
    (id, name, amount_cents, currency, billing_interval, is_active, stripe_price_id) values
    (t_pub,'CAT Offre vitrine', 4900,'eur','one_time', true,'price_cat_pub'),
    (t_int,'CAT Offre interne', 1900,'eur','monthly',  true,'price_cat_int');

  insert into public.programs
    (id, name, program_mode, is_public, status, coach_id, public_subscription_template_id)
  values (p_pub,'CAT Programme publié','individuel',true,'actif',c_adm,t_pub);
end $$;

-- Les fonctions de `pg_temp` sont appelées DEPUIS les rôles `anon` et
-- `authenticated` (pg_temp.serveur à la fin de chaque tentative) : il leur faut
-- l'USAGE du schéma temporaire et l'écriture dans la table des faits.
do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── V. LA VITRINE EN RÔLE `anon` : LA REQUÊTE RÉELLE ABOUTIT ───────────────
do $$
declare
  t_pub constant uuid := '00000000-0000-4000-8000-0000000000d1';
  t_int constant uuid := '00000000-0000-4000-8000-0000000000d2';
  p_pub constant uuid := '00000000-0000-4000-8000-0000000000e1';
  v_ok boolean;
begin
  /*
   * V1 — LA REQUÊTE DE LA VITRINE, celle que `fetchPublicPrograms` émet :
   * les programmes publics et actifs, JOINTS à leur offre. C'est elle qui
   * levait avant 20261020090000, parce qu'une policy permissive évaluée pour
   * `anon` appelait une fonction interdite et faisait échouer toute la requête.
   */
  perform pg_temp.visiteur();
  begin
    perform count(*)
       from public.programs p
       left join public.subscription_templates t on t.id = p.public_subscription_template_id
      where p.is_public = true and p.status = 'actif';
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.serveur();
  perform pg_temp.noter('V','V1. la requête de la vitrine aboutit pour un visiteur (elle ne lève pas)',
    coalesce(v_ok, false));

  perform pg_temp.noter('V','V2. le visiteur voit le programme publié',
    pg_temp.lire_anon(format($q$select count(*) from public.programs where id=%L$q$, p_pub)) = 1);
  perform pg_temp.noter('V','V3. …et le prix de l''offre rattachée, par la jointure',
    pg_temp.lire_anon(format($q$select t.amount_cents from public.programs p
      join public.subscription_templates t on t.id = p.public_subscription_template_id
     where p.id = %L$q$, p_pub)) = 4900);
  perform pg_temp.noter('V','V4. mais PAS une offre active qu''aucun programme publié ne présente',
    pg_temp.lire_anon(format($q$select count(*) from public.subscription_templates where id=%L$q$, t_int)) = 0);
end $$;


-- ── E. L'ÉCRITURE ANONYME : REFUSÉE PAR LA RÈGLE, PAS PAR UN PRIVILÈGE ─────
-- ⚠️ C'EST LE CONTRÔLE DÉPLACÉ DEPUIS LA MIGRATION 20261021090000.
do $$
declare
  t_pub constant uuid := '00000000-0000-4000-8000-0000000000d1';
  v_lignes int;
  v_sqlstate text;
  v_message text;
begin
  -- E1 — INSERT. Refusé, et le refus ne doit PAS venir d'un privilège de
  -- fonction : avec les policies en `{public}`, le message était
  -- « permission denied for function is_admin ».
  select o_lignes, o_sqlstate, o_message into v_lignes, v_sqlstate, v_message
    from pg_temp.tenter(null, $q$insert into public.subscription_templates
      (name, amount_cents, currency, billing_interval, is_active)
      values ('CAT anon insert', 1, 'eur','monthly', true)$q$);
  perform pg_temp.noter('E','E1. le visiteur ne CRÉE aucune offre, et le refus vient de la RÈGLE, pas d''un privilège de fonction',
    v_sqlstate <> '00000' and v_message !~* 'function');
  raise notice '       (INSERT anonyme : % — %)', v_sqlstate, left(v_message, 70);

  -- E2 — UPDATE. Sans policy applicable, il ne touche AUCUNE ligne et ne lève
  -- pas. Avec les policies en `{public}`, la condition `is_admin()` levait.
  select o_lignes, o_sqlstate, o_message into v_lignes, v_sqlstate, v_message
    from pg_temp.tenter(null, format($q$update public.subscription_templates
      set amount_cents = 1 where id = %L$q$, t_pub));
  perform pg_temp.noter('E','E2. le visiteur ne MODIFIE aucune offre, sans erreur de privilège de fonction',
    v_lignes = 0 and v_message !~* 'function');
  perform pg_temp.noter('E','E3. …et le prix de l''offre de vitrine est intact',
    (select amount_cents from public.subscription_templates where id = t_pub) = 4900);

  -- E4 — DELETE, même logique.
  select o_lignes, o_sqlstate, o_message into v_lignes, v_sqlstate, v_message
    from pg_temp.tenter(null, format($q$delete from public.subscription_templates where id = %L$q$, t_pub));
  perform pg_temp.noter('E','E4. le visiteur ne SUPPRIME aucune offre, sans erreur de privilège de fonction',
    v_lignes = 0 and v_message !~* 'function');
  perform pg_temp.noter('E','E5. …et l''offre de vitrine est toujours là',
    (select count(*) from public.subscription_templates where id = t_pub) = 1);
end $$;


-- ── R. LES AUTRES ACTEURS N'ONT RIEN GAGNÉ NI PERDU ───────────────────────
do $$
declare
  u_adm   constant uuid := '00000000-0000-4000-8000-0000000000b1';
  u_coach constant uuid := '00000000-0000-4000-8000-0000000000b2';
  v_lignes int;
  v_sqlstate text;
  v_message text;
  v_n int;
begin
  -- R1 — L'administrateur crée toujours une offre. `to authenticated` RESTREINT
  -- une policy permissive : il ne devait rien perdre, on le vérifie.
  select o_lignes, o_sqlstate into v_lignes, v_sqlstate
    from pg_temp.tenter(u_adm, $q$insert into public.subscription_templates
      (name, amount_cents, currency, billing_interval, is_active)
      values ('CAT offre admin', 1, 'eur','monthly', true)$q$);
  perform pg_temp.noter('R','R1. l''administrateur, lui, crée toujours une offre', v_sqlstate = '00000');

  -- R2 — Le coach autonome reste refusé, comme avant ce lot.
  select o_lignes, o_sqlstate, o_message into v_lignes, v_sqlstate, v_message
    from pg_temp.tenter(u_coach, $q$insert into public.subscription_templates
      (name, amount_cents, currency, billing_interval, is_active)
      values ('CAT offre coach', 1, 'eur','monthly', true)$q$);
  perform pg_temp.noter('R','R2. le coach autonome reste refusé (la condition is_admin() est conservée)',
    v_sqlstate <> '00000');

  -- R3 — La règle elle-même : les trois policies d'écriture sont EXACTEMENT au
  -- rôle authentifié. `= '{authenticated}'` et non `~ 'authenticated'` : une
  -- policy `{anon,authenticated}` satisferait une recherche de sous-chaîne tout
  -- en laissant le visiteur dans la règle.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and roles::text = '{authenticated}';
  perform pg_temp.noter('R','R3. les trois policies d''écriture du catalogue sont bornées au rôle authentifié', v_n = 3);

  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_admin';
  perform pg_temp.noter('R','R4. …et elles ont gardé leur condition is_admin()', v_n = 3);

  -- R5 — La vitrine publique est intacte, et toujours pour `anon` seul.
  perform pg_temp.noter('R','R5. la policy de vitrine publique est toujours là, au rôle anon',
    exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'subscription_templates'
               and policyname = 'subscription_templates_select_vitrine_publique'
               and roles::text = '{anon}'));

  -- R6 — Et aucune fonction interne du staff n'a été rouverte à `anon` : la
  -- correction passe par les rôles des policies, jamais par une réouverture.
  select count(*) into v_n
    from unnest(array['public.is_admin()',
                      'public.est_staff_global()',
                      'public.coach_ids_portee()',
                      'public.categories_lecture()',
                      'public.program_ids_lecture()']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  perform pg_temp.noter('R','R6. anon n''a l''EXECUTE d''AUCUNE fonction interne du staff', v_n = 0);
end $$;


-- ── BILAN ──────────────────────────────────────────────────────────────────
do $$ begin perform pg_temp.serveur(); end $$;

select section, count(*) as controles, count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) as total_controles, count(*) filter (where not ok) as total_echecs
  from _faits;

select string_agg(libelle, E'\n') as echecs_detailles from _faits where not ok;

rollback;

select
  (select count(*) from public.subscription_templates where name like 'CAT %') as offres_restantes,
  (select count(*) from public.programs where name like 'CAT %')               as programmes_restants,
  (select count(*) from auth.users where email like 'cat.%@test.local')        as comptes_restants;
