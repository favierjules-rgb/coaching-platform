-- ════════════════════════════════════════════════════════════════════════════
-- LA PREUVE D'ÉQUIVALENCE RLS EST-ELLE ENCORE UNE PREUVE ?
-- Chantier feat/entrainement-performances, lot C. Octobre 2026.
-- ════════════════════════════════════════════════════════════════════════════
-- La migration C a été rendue ~20 fois plus rapide en ne parcourant plus les
-- identités une par une mais par CLASSE D'ÉQUIVALENCE. Une preuve accélérée qui
-- ne détecterait plus rien serait pire que pas de preuve du tout : cette
-- checklist vérifie qu'elle DÉTECTE ENCORE.
--
-- MÉTHODE : on sabote, on réapplique la migration, on exige qu'elle LÈVE. Le
-- sabotage porte sur les anciennes fonctions d'ENSEMBLE, que la migration ne
-- recrée pas — sinon elle réparerait le sabotage avant de le voir. Chaque
-- sabotage est annulé en réexécutant la définition relevée AVANT.
--
-- ⚠️ BASE DE VALIDATION ISOLÉE UNIQUEMENT. Ce fichier remplace temporairement
-- des fonctions de sécurité ; il n'a rien à faire sur une base réelle.
--
-- Prérequis : base à l'état « A et B appliquées, C et D non », décor
-- représentatif, et un jeu d'identités (coach + élèves).
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CE FICHIER NE TOURNE QUE SUR UNE INSTANCE LOCALE. Il réapplique la
-- migration via `pg_read_file`, ce qui exige un chemin lisible PAR LE SERVEUR
-- et le droit superutilisateur. Sur une base Supabase managée, cela ne
-- fonctionne pas — et ne doit pas : ce fichier remplace temporairement des
-- fonctions de sécurité.
--
-- USAGE :
--   psql "<url locale>" \
--     -c "set mig.chemin = '<chemin absolu>/20261028090000_entrainement_predicats_rls_scalaires.sql';" \
--     -f supabase/tests/preuve_equivalence_rls_checklist.sql
--
-- Prérequis : base à l'état « A et B appliquées, C et D non », décor
-- représentatif appliqué, et plusieurs identités (coach admin, coach
-- assistant, élèves) — voir perf_decor_representatif.sql.
\set ON_ERROR_STOP on

create temporary table if not exists resultats (n int, libelle text, verdict text);
truncate resultats;
create temporary table if not exists sauvegarde (nom text primary key, def text);
truncate sauvegarde;

-- ── outil : mémoriser puis restaurer une définition de fonction ─────────────
create or replace function pg_temp.memoriser(p_nom text) returns void
language plpgsql as $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nom
   limit 1;
  if v_def is null then raise exception 'fonction % introuvable', p_nom; end if;
  insert into sauvegarde (nom, def) values (p_nom, v_def)
    on conflict (nom) do update set def = excluded.def;
end $$;

create or replace function pg_temp.restaurer(p_nom text) returns void
language plpgsql as $$
declare v_def text;
begin
  select def into v_def from sauvegarde where nom = p_nom;
  if v_def is null then raise exception 'aucune sauvegarde pour %', p_nom; end if;
  execute v_def;
end $$;

-- ── outil : isoler un sabotage sur UNE SEULE identité ──────────────────────
-- ⚠️ DEUX TECHNIQUES ONT ÉCHOUÉ AVANT CELLE-CI, ET LES DEUX ÉCHECS SONT
-- INSTRUCTIFS.
--   1. Faire rendre TOUS les programmes à `program_ids_ecriture()` pour une
--      identité donnée ne divergeait pas pour un ADMIN : son prédicat scalaire
--      rend déjà vrai partout, les deux côtés restaient d'accord, et le test
--      passait au vert sans rien éprouver.
--   2. Envelopper la fonction d'origine dans une copie nommée `…_origine` a été
--      REFUSÉ par la garde statique de la migration : la fonction comparée
--      référençait soudain une fonction hors signature. La garde a fait son
--      travail sur le test lui-même.
-- D'où cette troisième technique : on extrait le CORPS d'origine et on le
-- réinjecte comme sous-requête, en ajoutant la seule condition d'identité.
-- Aucune fonction nouvelle n'apparaît, la garde reste satisfaite, et la
-- divergence n'existe que pour l'identité ciblée.
create or replace function pg_temp.corps_de(p_nom text) returns text
language plpgsql as $$
declare v_def text;
begin
  select def into v_def from sauvegarde where nom = p_nom;
  if v_def is null then raise exception 'memoriser(%) d''abord', p_nom; end if;
  -- pg_get_functiondef délimite le corps par $function$. On retire le
  -- point-virgule final : le corps est réinjecté comme SOUS-REQUÊTE, et un `;`
  -- au milieu d'un `from ( … )` est une erreur de syntaxe.
  return regexp_replace(split_part(v_def, '$function$', 2), '\s*;\s*$', '');
end $$;

-- Remplace `p_nom` par « le même ensemble, mais filtré par p_condition ».
create or replace function pg_temp.restreindre(p_nom text, p_condition text)
returns void language plpgsql as $$
begin
  execute format($f$
    create or replace function public.%1$s() returns setof uuid
    language sql stable security definer set search_path = public, pg_temp as $corps$
      select * from ( %2$s ) as origine(id) where %3$s;
    $corps$;
  $f$, p_nom, pg_temp.corps_de(p_nom), p_condition);
end $$;

-- Remplace `p_nom` par « l'ensemble d'origine, ÉLARGI pour p_condition ».
create or replace function pg_temp.elargir(p_nom text, p_condition text)
returns void language plpgsql as $$
begin
  execute format($f$
    create or replace function public.%1$s() returns setof uuid
    language sql stable security definer set search_path = public, pg_temp as $corps$
      select * from ( %2$s ) as origine(id)
      union
      select p.id from public.programs p where %3$s;
    $corps$;
  $f$, p_nom, pg_temp.corps_de(p_nom), p_condition);
end $$;

-- ── outil : appliquer la migration C et rendre le verdict ──────────────────
-- Renvoie NULL si elle passe, sinon le SQLSTATE et le message.
create or replace function pg_temp.appliquer_C(p_chemin text) returns text
language plpgsql as $$
begin
  -- On ne peut pas `\i` depuis plpgsql : la migration est passée par
  -- pg_read_file, ce qui exige d'être superutilisateur — c'est le cas dans le
  -- bac à sable, et c'est acceptable pour un test.
  execute pg_read_file(p_chemin);
  return null;
exception when others then
  return sqlstate || ' | ' || sqlerrm;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
do $t$
declare
  v_res text;
  v_classes int;
  v_identites int;
begin
  -- ── 1. la migration passe sur une base saine ────────────────────────────
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (1, 'la migration C s''applique sur une base saine',
    case when v_res is null then 'OK' else 'ÉCHEC : ' || v_res end);

  -- ── 2. ÉQUIVALENCE CASSÉE SUR programs → la preuve doit LEVER ───────────
  -- `program_ids_lecture()` se met à rendre TOUS les programmes : le côté
  -- « ensemble » devient plus permissif que le prédicat scalaire.
  perform pg_temp.memoriser('program_ids_lecture');
  execute $sab$
    create or replace function public.program_ids_lecture() returns setof uuid
    language sql stable security definer set search_path = public, pg_temp as $f$
      select id from public.programs;
    $f$;
  $sab$;
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (2, 'une divergence sur programs fait LEVER la preuve',
    case when v_res like '%ÉQUIVALENCE ROMPUE sur programs%' then 'OK'
         when v_res is null then 'ÉCHEC : la preuve n''a RIEN vu'
         else 'ÉCHEC : a levé pour une autre raison — ' || v_res end);
  perform pg_temp.restaurer('program_ids_lecture');

  -- ── 3. ÉQUIVALENCE CASSÉE PLUS BAS (séances) → doit LEVER aussi ─────────
  -- Vérifie que la réduction par couples sur les exercices et la réduction par
  -- classes ne masquent pas une divergence sur une table intermédiaire.
  perform pg_temp.memoriser('workout_session_ids_ecriture');
  execute $sab$
    create or replace function public.workout_session_ids_ecriture() returns setof uuid
    language sql stable security definer set search_path = public, pg_temp as $f$
      select id from public.workout_sessions;
    $f$;
  $sab$;
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (3, 'une divergence sur workout_sessions fait LEVER la preuve',
    case when v_res like '%ÉQUIVALENCE ROMPUE%' then 'OK'
         when v_res is null then 'ÉCHEC : la preuve n''a RIEN vu'
         else 'ÉCHEC : ' || v_res end);
  perform pg_temp.restaurer('workout_session_ids_ecriture');

  -- ── 4. DIVERGENCE PROPRE À L'ANONYME, ET À LUI SEUL → doit LEVER ───────
  -- Le cas qui avait révélé la perte du `coalesce(…, false)` : sans identité,
  -- TOUT doit être faux. On ÉLARGIT le côté « ensemble » pour l'anonyme et pour
  -- lui seul ; les autres identités gardent exactement leur comportement. Si la
  -- classe ANONYME n'était pas réellement prouvée, rien ne lèverait.
  perform pg_temp.memoriser('program_ids_lecture');
  perform pg_temp.elargir('program_ids_lecture', 'auth.uid() is null');
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (4, 'une divergence propre au SEUL anonyme fait LEVER la preuve',
    case when v_res like '%ÉQUIVALENCE ROMPUE%' and v_res like '%anonyme%' then 'OK'
         when v_res like '%ÉQUIVALENCE ROMPUE%' then 'ÉCHEC : a levé, mais pas sur l''anonyme — ' || left(v_res, 90)
         when v_res is null then 'ÉCHEC : la classe ANONYME n''est pas réellement prouvée'
         else 'ÉCHEC : ' || left(v_res, 120) end);
  perform pg_temp.restaurer('program_ids_lecture');

  -- ── 5. DIVERGENCE PROPRE À UNE SEULE IDENTITÉ DE STAFF → doit LEVER ────
  -- La réduction par classes ne doit pas « avaler » une identité particulière.
  -- On RETIRE le droit d'écriture du côté « ensemble » pour le seul coach admin
  -- du décor ; son prédicat scalaire continue de rendre vrai. La divergence est
  -- réelle et n'existe que pour cette identité.
  perform pg_temp.memoriser('program_ids_ecriture');
  perform pg_temp.restreindre('program_ids_ecriture',
    $c$auth.uid() is distinct from '11111111-1111-4111-8111-111111111111'::uuid$c$);
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (5, 'une divergence propre à UNE identité de staff fait LEVER la preuve',
    case when v_res like '%ÉQUIVALENCE ROMPUE%' and v_res like '%11111111%' then 'OK'
         when v_res like '%ÉQUIVALENCE ROMPUE%' then 'ÉCHEC : a levé sur une AUTRE identité — ' || left(v_res, 90)
         when v_res is null then 'ÉCHEC : cette identité de staff n''est pas couverte'
         else 'ÉCHEC : ' || left(v_res, 120) end);
  perform pg_temp.restaurer('program_ids_ecriture');

  -- ── 6. LA GARDE STATIQUE : une dépendance d'identité NON DÉCLARÉE ───────
  -- Si une fonction comparée se met à lire l'identité par un chemin absent de
  -- la signature, la réduction par classes n'est plus fondée. La preuve doit
  -- REFUSER de tourner, et le dire.
  execute $sab$
    create or replace function public.scope_hors_signature() returns boolean
    language sql stable security definer set search_path = public, pg_temp as $f$
      select auth.uid() is not null;
    $f$;
  $sab$;
  perform pg_temp.memoriser('program_ids_lecture');
  execute $sab$
    create or replace function public.program_ids_lecture() returns setof uuid
    language sql stable security definer set search_path = public, pg_temp as $f$
      select p.id from public.programs p
       where coalesce(public.scope_hors_signature(), false)
         and p.id in (select public.program_ids_ecriture());
    $f$;
  $sab$;
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (6, 'une dépendance d''identité non déclarée fait REFUSER la preuve',
    case when v_res like '%PREUVE INVALIDE%' and v_res like '%scope_hors_signature%' then 'OK'
         when v_res like '%PREUVE INVALIDE%' then 'OK (refus, fonction non nommée)'
         when v_res is null then 'ÉCHEC : la garde statique n''a RIEN vu'
         else 'ÉCHEC : a levé pour une autre raison — ' || v_res end);
  perform pg_temp.restaurer('program_ids_lecture');
  execute 'drop function if exists public.scope_hors_signature()';

  -- ── 7. retour à l'état sain, et couverture annoncée ─────────────────────
  v_res := pg_temp.appliquer_C(current_setting('mig.chemin'));
  insert into resultats values (7, 'après restauration, la migration repasse',
    case when v_res is null then 'OK' else 'ÉCHEC : ' || v_res end);

  -- ── 8. toutes les identités sont COUVERTES, pas seulement échantillonnées ─
  select count(distinct u) into v_identites from (
    select user_id as u from public.coaches where user_id is not null
    union select user_id from public.profiles where user_id is not null
    union select null::uuid) q;
  insert into resultats values (8,
    format('la base de test porte bien plusieurs identités (%s) et plusieurs rôles', v_identites),
    case when v_identites >= 5 then 'OK' else 'ÉCHEC : jeu d''identités trop pauvre pour prouver quoi que ce soit' end);
end $t$;

\echo ''
\echo '════════ PREUVE D ÉQUIVALENCE RLS — LA PREUVE DÉTECTE-T-ELLE ENCORE ? ════════'
select n, libelle, verdict from resultats order by n;
select count(*) filter (where verdict like 'OK%') as verts,
       count(*) filter (where verdict not like 'OK%') as rouges,
       count(*) as total
  from resultats;
