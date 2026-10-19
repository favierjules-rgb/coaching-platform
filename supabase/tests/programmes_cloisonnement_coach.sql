-- ════════════════════════════════════════════════════════════════════════════
-- PROGRAMMES — CLOISONNEMENT PAR COACH ET RÉSERVE DE PUBLICATION
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/programmes_cloisonnement_coach.sql
--
-- Ce que cette checklist prouve, et que l'interface ne peut pas prouver : un
-- second coach, dans SA session, ne lit, ne modifie, ne supprime et ne publie
-- rien qui ne soit à lui — par des requêtes SQL NUES, c'est-à-dire exactement
-- ce qu'un appel PostgREST direct produirait.
--
-- ⚠️ CINQ ACTEURS. Le collaborateur est présent pour une raison précise : le
-- cloisonnement des programmes par coach ne doit RIEN changer à P13-B. Lui
-- n'a jamais eu `est_staff_global()` ; ses droits passent par ses élèves
-- affectés et sa catégorie `entrainement`, et la section F le mesure.
--
-- ⚠️ UN REFUS REND -1, JAMAIS 0 pour les lectures. « Refusé » et « rien
-- trouvé » sont deux résultats différents.

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

create or replace function pg_temp.devenir(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.lire(p_user uuid, p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin execute p_sql into v; exception when others then v := -1; end;
  reset role; return coalesce(v, 0);
end $$;

/**
 * Lecture dans le rôle `anon` — le visiteur non connecté.
 *
 * ⚠️ UN REFUS REND -1, ET C'EST LA DISTINCTION QUI COMPTE ICI. « La vitrine
 * est vide » et « la requête de la vitrine a été refusée » sont deux états
 * très différents : le second était le défaut à corriger. Les contrôles
 * d'absence acceptent donc `<= 0` (rien à voir, ou refusé), et les contrôles
 * de présence exigent une valeur exacte.
 */
/**
 * Redevenir le SERVEUR : rôle ET revendications remises à zéro.
 *
 * ⚠️ `reset role` NE SUFFIT PAS, et la première version de la section H est
 * tombée dessus. `pg_temp.devenir` pose `request.jwt.claims` ; `reset role`
 * rend le rôle `postgres` mais LAISSE les revendications. `auth.uid()`
 * continue donc de désigner le dernier acteur, et un décor inséré « en
 * postgres » était en réalité jugé comme lui — ici le coach 2, à qui le
 * déclencheur de publication a refusé un programme public, avec raison.
 */
create or replace function pg_temp.serveur() returns void
language plpgsql as $$
begin
  reset role;
  -- ⚠️ `'{}'` ET PAS LA CHAÎNE VIDE : `auth.uid()` parse cette variable en
  -- JSON, et une chaîne vide lève « invalid input syntax for type json ». Un
  -- objet vide est du JSON valide sans `sub` — donc `auth.uid()` est NULL,
  -- c'est-à-dire exactement un contexte serveur.
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create or replace function pg_temp.lire_anon(p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin execute p_sql into v; exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

create or replace function pg_temp.ecrit(p_user uuid, p_sql text) returns boolean
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin
    execute p_sql; get diagnostics v = row_count; reset role; return v > 0;
  exception
    when insufficient_privilege then reset role; return false;
    when others then
      reset role;
      if sqlstate like '23%' then
        raise notice '  (SQLSTATE % — décor incohérent, PAS un refus : %)', sqlstate, p_sql;
      end if;
      return false;
  end;
end $$;


-- ── A. LE DÉCOR ────────────────────────────────────────────────────────────
do $$
declare
  u_adm   constant uuid := '00000000-0000-4000-8000-00000000a001';
  u_c1    constant uuid := '00000000-0000-4000-8000-00000000a002';
  u_c2    constant uuid := '00000000-0000-4000-8000-00000000a003';
  u_collab constant uuid := '00000000-0000-4000-8000-00000000a004';
  u_eleve constant uuid := '00000000-0000-4000-8000-00000000a005';
  c_adm   constant uuid := '00000000-0000-4000-8000-00000000a101';
  c_c1    constant uuid := '00000000-0000-4000-8000-00000000a102';
  c_c2    constant uuid := '00000000-0000-4000-8000-00000000a103';
  c_collab constant uuid := '00000000-0000-4000-8000-00000000a104';
  e_c1    constant uuid := '00000000-0000-4000-8000-00000000a201';
  p_c1    constant uuid := '00000000-0000-4000-8000-00000000a301';
  p_c1b   constant uuid := '00000000-0000-4000-8000-00000000a302';
  p_c1c   constant uuid := '00000000-0000-4000-8000-00000000a303';
  p_c2    constant uuid := '00000000-0000-4000-8000-00000000a304';
  p_orph  constant uuid := '00000000-0000-4000-8000-00000000a305';
  p_pub   constant uuid := '00000000-0000-4000-8000-00000000a306';
  p_copie constant uuid := '00000000-0000-4000-8000-00000000a307';
  w_c1    constant uuid := '00000000-0000-4000-8000-00000000a401';
  t_offre constant uuid := '00000000-0000-4000-8000-00000000a501';
begin
  insert into auth.users (id, email) values
    (u_adm,'pg.adm@test.local'), (u_c1,'pg.c1@test.local'), (u_c2,'pg.c2@test.local'),
    (u_collab,'pg.collab@test.local'), (u_eleve,'pg.eleve@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,'pg.adm@test.local','admin','PG','Admin'),
    (u_c1,'pg.c1@test.local','coach','PG','Coach1'),
    (u_c2,'pg.c2@test.local','coach','PG','Coach2'),
    (u_collab,'pg.collab@test.local','coach','PG','Collab'),
    (u_eleve,'pg.eleve@test.local','student','PG','Eleve');
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm,  u_adm,  'pg.adm@test.local','PG Admin','admin','actif','-'),
    (c_c1,   u_c1,   'pg.c1@test.local','PG Coach1','assistant','actif','-'),
    (c_c2,   u_c2,   'pg.c2@test.local','PG Coach2','assistant','actif','-'),
    (c_collab,u_collab,'pg.collab@test.local','PG Collab','collaborateur','actif','-');
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type)
  values (e_c1, u_eleve, c_c1,'PG','Eleve','pg.eleve@test.local','active','coaching');
  -- Le collaborateur suit l'élève du coach 1, avec entrainement en ÉCRITURE.
  insert into public.collaborateur_eleves (collaborateur_id, student_id, affecte_par) values (c_collab, e_c1, c_c1);
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
  select c_collab, c, 'ecriture', c_c1
    from unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition']) c;

  insert into public.subscription_templates (id, name, amount_cents, currency, billing_interval, is_active, stripe_price_id)
  values (t_offre,'PG Offre', 4900,'eur','one_time', true,'price_pg');

  -- Trois modèles au coach 1 (un par essai destructif), un au coach 2,
  -- un ORPHELIN (coach_id NULL, comme les trois de la production),
  -- un PUBLIC posé par l'administrateur, et une COPIE individuelle.
  insert into public.programs (id, name, program_mode, is_public, status, coach_id) values
    (p_c1, 'PG Prog C1','individuel',false,'actif',c_c1),
    (p_c1b,'PG Prog C1 b','individuel',false,'actif',c_c1),
    (p_c1c,'PG Prog C1 c','individuel',false,'actif',c_c1),
    (p_c2, 'PG Prog C2','individuel',false,'actif',c_c2),
    (p_orph,'PG Prog orphelin','individuel',false,'actif',null);
  insert into public.programs (id, name, program_mode, is_public, status, coach_id, public_subscription_template_id)
  values (p_pub,'PG Prog public','individuel',true,'actif',c_adm,t_offre);
  insert into public.programs (id, name, program_mode, is_public, status, coach_id, owner_student_id)
  values (p_copie,'PG Copie eleve','individuel',false,'actif',c_c1,e_c1);
  insert into public.program_weeks (id, program_id, week_number) values (w_c1, p_c1, 1);
end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── B. LE COACH 2 NE VOIT QUE LES SIENS ───────────────────────────────────
do $$
declare
  u_c2   constant uuid := '00000000-0000-4000-8000-00000000a003';
  c_c2   constant uuid := '00000000-0000-4000-8000-00000000a103';
  p_c1   constant uuid := '00000000-0000-4000-8000-00000000a301';
  p_c2   constant uuid := '00000000-0000-4000-8000-00000000a304';
  p_orph constant uuid := '00000000-0000-4000-8000-00000000a305';
  p_copie constant uuid := '00000000-0000-4000-8000-00000000a307';
  w_c1   constant uuid := '00000000-0000-4000-8000-00000000a401';
begin
  -- ⚠️ EXACTEMENT 1, ET LE COMPTE EXACT EST LA BONNE MESURE : « il voit peu »
  -- ne prouverait rien. Son propre modèle, et rien d'autre — pas même le
  -- programme public, parce que `programs_select_public` est accordée au rôle
  -- `{anon}` seul : la vitrine est pour les VISITEURS, un coach connecté ne
  -- voit que ses droits. Le contrôle E11 mesure la vitrine en `anon`.
  perform pg_temp.noter('B','B1. il voit SON modèle, et exactement rien d''autre',
    pg_temp.lire(u_c2,'select count(*) from public.programs') = 1);
  perform pg_temp.noter('B','B2. le modèle PRIVÉ du coach 1 lui est invisible, même par son identifiant',
    pg_temp.lire(u_c2, format('select count(*) from public.programs where id = %L', p_c1)) = 0);
  perform pg_temp.noter('B','B3. le modèle ORPHELIN (coach_id NULL) lui est invisible',
    pg_temp.lire(u_c2, format('select count(*) from public.programs where id = %L', p_orph)) = 0);
  perform pg_temp.noter('B','B4. la COPIE individuelle de l''élève du coach 1 lui est invisible',
    pg_temp.lire(u_c2, format('select count(*) from public.programs where id = %L', p_copie)) = 0);
  perform pg_temp.noter('B','B5. son propre modèle, lui, est bien là',
    pg_temp.lire(u_c2, format('select count(*) from public.programs where id = %L', p_c2)) = 1);
  perform pg_temp.noter('B','B6. program_ids_lecture() ne lui rend que le sien',
    pg_temp.lire(u_c2,'select count(*) from public.program_ids_lecture()') = 1);
  -- La STRUCTURE suit : semaines, séances, blocs, exercices s'enchaînent sur
  -- program_ids_*. Une isolation qui s'arrêterait à l'en-tête ne vaudrait rien.
  perform pg_temp.noter('B','B7. les SEMAINES du programme du coach 1 lui sont invisibles',
    pg_temp.lire(u_c2, format('select count(*) from public.program_weeks where program_id = %L', p_c1)) = 0);
  perform pg_temp.noter('B','B8. recherche par nom : le programme du coach 1 ne remonte pas',
    pg_temp.lire(u_c2, $q$select count(*) from public.programs where name ilike '%Prog C1%'$q$) = 0);
end $$;


-- ── C. ET IL N'ÉCRIT RIEN CHEZ LE COACH 1 ─────────────────────────────────
do $$
declare
  u_c2  constant uuid := '00000000-0000-4000-8000-00000000a003';
  c_c1  constant uuid := '00000000-0000-4000-8000-00000000a102';
  c_c2  constant uuid := '00000000-0000-4000-8000-00000000a103';
  p_c1  constant uuid := '00000000-0000-4000-8000-00000000a301';
  p_c1b constant uuid := '00000000-0000-4000-8000-00000000a302';
  p_c1c constant uuid := '00000000-0000-4000-8000-00000000a303';
  w_c1  constant uuid := '00000000-0000-4000-8000-00000000a401';
begin
  perform pg_temp.noter('C','C1. modifier le programme du coach 1 : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$update public.programs set name='pirate' where id=%L$q$, p_c1)));
  perform pg_temp.noter('C','C2. …et la valeur n''a pas changé',
    (select name from public.programs where id = p_c1) = 'PG Prog C1');
  perform pg_temp.noter('C','C3. supprimer le programme du coach 1 : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$delete from public.programs where id=%L$q$, p_c1b)));
  perform pg_temp.noter('C','C4. …et le programme est toujours là',
    (select count(*) from public.programs where id = p_c1b) = 1);
  perform pg_temp.noter('C','C5. ajouter une semaine au programme du coach 1 : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$insert into public.program_weeks (program_id, week_number)
      values (%L, 9) returning id$q$, p_c1c)));
  perform pg_temp.noter('C','C6. dupliquer : créer un modèle AU NOM du coach 1 : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$insert into public.programs (name, program_mode, is_public, status, coach_id)
      values ('vol','individuel',false,'actif',%L) returning id$q$, c_c1)));
  perform pg_temp.noter('C','C7. s''attribuer le programme du coach 1 : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$update public.programs set coach_id=%L where id=%L$q$, c_c2, p_c1)));
  perform pg_temp.noter('C','C8. assigner le programme du coach 1 à un élève : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$insert into public.assignments (content_type, content_id, student_id)
      values ('programme', %L, %L) returning id$q$, p_c1, '00000000-0000-4000-8000-00000000a201'::uuid)));
end $$;


-- ── D. SES PROPRES PROGRAMMES : IL TRAVAILLE NORMALEMENT ──────────────────
do $$
declare
  u_c2  constant uuid := '00000000-0000-4000-8000-00000000a003';
  c_c2  constant uuid := '00000000-0000-4000-8000-00000000a103';
  p_c2  constant uuid := '00000000-0000-4000-8000-00000000a304';
  v_neuf uuid;
  v_ok boolean;
begin
  perform pg_temp.noter('D','D1. renommer son programme : accepté',
    pg_temp.ecrit(u_c2, format($q$update public.programs set name='PG C2 renomme' where id=%L$q$, p_c2)));
  perform pg_temp.noter('D','D2. passer son programme en `actif` (travail interne) : accepté',
    pg_temp.ecrit(u_c2, format($q$update public.programs set status='actif' where id=%L$q$, p_c2)));
  perform pg_temp.noter('D','D3. `publication_status` (visibilité pour SON élève) : accepté',
    pg_temp.ecrit(u_c2, format($q$update public.programs set publication_status='published' where id=%L$q$, p_c2)));
  perform pg_temp.noter('D','D4. ajouter une semaine chez lui : accepté',
    pg_temp.ecrit(u_c2, format($q$insert into public.program_weeks (program_id, week_number)
      values (%L, 2) returning id$q$, p_c2)));

  -- ⚠️ LA CRÉATION DOIT POSER LA PROPRIÉTÉ. Sans cela, `coach_id` resterait
  -- NULL — c'est l'état relevé en production sur les 28 programmes — et le
  -- coach serait aveugle à son propre travail.
  perform pg_temp.devenir(u_c2);
  begin
    insert into public.programs (name, program_mode, is_public, status)
    values ('PG Prog neuf C2','individuel',false,'actif') returning id into v_neuf;
    v_ok := v_neuf is not null;
  exception when others then v_ok := false;
  end;
  reset role;
  perform pg_temp.noter('D','D5. créer un programme : accepté (INSERT … RETURNING)', coalesce(v_ok, false));
  perform pg_temp.noter('D','D6. …et `coach_id` est posé sur SA fiche, sans qu''il l''ait envoyé',
    (select coach_id from public.programs where id = v_neuf) = c_c2);
  perform pg_temp.noter('D','D7. …il le relit donc immédiatement',
    pg_temp.lire(u_c2, format('select count(*) from public.programs where id = %L', v_neuf)) = 1);
  perform pg_temp.noter('D','D8. …et le coach 1 ne le voit pas',
    pg_temp.lire('00000000-0000-4000-8000-00000000a002', format('select count(*) from public.programs where id = %L', v_neuf)) = 0);
  perform pg_temp.noter('D','D9. supprimer SON programme : accepté',
    pg_temp.ecrit(u_c2, format($q$delete from public.programs where id=%L$q$, v_neuf)));
end $$;


-- ── E. PUBLIER ET VENDRE : L'ADMINISTRATEUR SEUL ──────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000a001';
  u_c2   constant uuid := '00000000-0000-4000-8000-00000000a003';
  c_c2   constant uuid := '00000000-0000-4000-8000-00000000a103';
  p_c2   constant uuid := '00000000-0000-4000-8000-00000000a304';
  p_pub  constant uuid := '00000000-0000-4000-8000-00000000a306';
  t_offre constant uuid := '00000000-0000-4000-8000-00000000a501';
begin
  perform pg_temp.noter('E','E1. le coach PUBLIE son programme (is_public) : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$update public.programs set is_public=true where id=%L$q$, p_c2)));
  perform pg_temp.noter('E','E2. …et le programme n''est pas public',
    (select is_public from public.programs where id = p_c2) = false);
  perform pg_temp.noter('E','E3. le coach MET EN VENTE son programme : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$update public.programs set public_subscription_template_id=%L where id=%L$q$, t_offre, p_c2)));
  perform pg_temp.noter('E','E4. …et aucune offre n''y est rattachée',
    (select public_subscription_template_id from public.programs where id = p_c2) is null);
  perform pg_temp.noter('E','E5. le coach CRÉE directement un programme public : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$insert into public.programs (name, program_mode, is_public, status, coach_id)
      values ('PG neuf public','individuel',true,'actif',%L) returning id$q$, c_c2)));
  perform pg_temp.noter('E','E6. le coach CRÉE directement un programme en vente : REFUSÉ',
    not pg_temp.ecrit(u_c2, format($q$insert into public.programs (name, program_mode, is_public, status, coach_id, public_subscription_template_id)
      values ('PG neuf vendu','individuel',false,'actif',%L,%L) returning id$q$, c_c2, t_offre)));
  perform pg_temp.noter('E','E7. aucun programme public ne porte sa fiche',
    (select count(*) from public.programs where coach_id = c_c2 and (is_public or public_subscription_template_id is not null)) = 0);

  -- ⚠️ ET LE TRAVAIL INTERNE N'EST PAS CONFONDU AVEC LA COMMERCIALISATION :
  -- `status` et `publication_status` lui restent (contrôles D2 et D3).
  perform pg_temp.noter('E','E8. l''administrateur, lui, publie',
    pg_temp.ecrit(u_adm, format($q$update public.programs set is_public=true where id=%L$q$, p_c2)));
  perform pg_temp.noter('E','E9. …et met en vente',
    pg_temp.ecrit(u_adm, format($q$update public.programs set public_subscription_template_id=%L where id=%L$q$, t_offre, p_c2)));
  perform pg_temp.noter('E','E10. …et crée un programme public de toutes pièces',
    pg_temp.ecrit(u_adm, $q$insert into public.programs (name, program_mode, is_public, status)
      values ('PG admin public','individuel',true,'actif') returning id$q$));
  /*
   * ⚠️ CE CONTRÔLE EST STATIQUE, ET IL FAUT DIRE POURQUOI.
   *
   * La règle de la vitrine — `programs_select_public` : `is_public = true AND
   * status = 'actif'`, accordée au rôle `{anon}` — est ce qui donne un sens à
   * la publication par l'administrateur. Ce lot ne doit pas y toucher, et ce
   * contrôle le vérifie.
   *
   * En revanche, une LECTURE anonyme de `public.programs` échoue aujourd'hui,
   * AVANT comme APRÈS ce lot : mesuré `42501 permission denied for function
   * student_ids_entrainement_lecture`. Les policies du staff portent le rôle
   * `{public}`, donc elles sont évaluées pour `anon` aussi, et P13-B
   * (20261011110000) a retiré à `anon` l'EXECUTE des fonctions de portée —
   * une policy permissive qui lève fait échouer toute la requête. La même
   * chose se reproduit un cran plus loin sur `subscription_templates`, que la
   * vitrine joint pour afficher le prix.
   *
   * C'est un défaut ANTÉRIEUR et DISTINCT, signalé au rapport, dont le
   * correctif (restreindre les policies du staff au rôle `authenticated`)
   * sort du périmètre de ce lot : il touche la surface publique du catalogue
   * d'offres. On ne l'encode donc pas comme une attente ici — un test qui
   * exigerait le refus deviendrait rouge le jour où le défaut est corrigé.
   */
  perform pg_temp.noter('E','E11. la règle de la vitrine publique est intacte (is_public + status actif, rôle anon)',
    exists (select 1 from pg_policies
             where schemaname='public' and tablename='programs'
               and policyname='programs_select_public'
               and roles::text = '{anon}'
               and qual ~ 'is_public' and qual ~ 'actif'));
  perform pg_temp.noter('E','E12. et ce lot n''a pas touché la policy de la vitrine ni celle de l''élève assigné',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='programs'
        and policyname in ('programs_select_public','programs_select_assigned_student')) = 2);

  -- Le coach qui édite un programme que l'administrateur a publié ne le
  -- déPUBLIE pas par inadvertance : son payload renvoie toujours les deux
  -- colonnes, et elles sont conservées.
  perform pg_temp.ecrit(u_c2, format($q$update public.programs set name='PG C2 edite', is_public=false, public_subscription_template_id=null where id=%L$q$, p_c2));
  perform pg_temp.noter('E','E13. éditer un programme publié par l''administrateur ne le dépublie pas',
    (select is_public from public.programs where id = p_c2) = true
    and (select public_subscription_template_id from public.programs where id = p_c2) = t_offre);
  perform pg_temp.noter('E','E14. …et son édition, elle, a bien eu lieu',
    (select name from public.programs where id = p_c2) = 'PG C2 edite');
end $$;


-- ── F. P13-B INTACT : LE COLLABORATEUR N'A RIEN GAGNÉ NI PERDU ────────────
do $$
declare
  u_collab constant uuid := '00000000-0000-4000-8000-00000000a004';
  p_c1    constant uuid := '00000000-0000-4000-8000-00000000a301';
  p_copie constant uuid := '00000000-0000-4000-8000-00000000a307';
  p_orph  constant uuid := '00000000-0000-4000-8000-00000000a305';
begin
  -- Son élève est celui du coach 1 : `coach_ids_portee()` rend donc la fiche
  -- du coach 1, et la catégorie `entrainement` lui est accordée en écriture.
  perform pg_temp.noter('F','F1. il voit la COPIE individuelle de son élève affecté',
    pg_temp.lire(u_collab, format('select count(*) from public.programs where id = %L', p_copie)) = 1);
  perform pg_temp.noter('F','F2. il voit les modèles du coach de son élève (portée P13-B inchangée)',
    pg_temp.lire(u_collab, format('select count(*) from public.programs where id = %L', p_c1)) = 1);
  perform pg_temp.noter('F','F3. le modèle orphelin lui reste invisible',
    pg_temp.lire(u_collab, format('select count(*) from public.programs where id = %L', p_orph)) = 0);
  perform pg_temp.noter('F','F4. il travaille sur le programme de son élève (écriture accordée)',
    pg_temp.ecrit(u_collab, format($q$update public.programs set name='PG copie editee' where id=%L$q$, p_copie)));
  perform pg_temp.noter('F','F5. mais il ne PUBLIE pas davantage que le coach',
    not pg_temp.ecrit(u_collab, format($q$update public.programs set is_public=true where id=%L$q$, p_copie)));
  perform pg_temp.noter('F','F6. ni ne met en vente',
    not pg_temp.ecrit(u_collab, format($q$update public.programs set public_subscription_template_id=%L where id=%L$q$,
      '00000000-0000-4000-8000-00000000a501'::uuid, p_copie)));
end $$;


-- ── G. L'ADMINISTRATEUR GARDE LA MAIN SUR TOUT ────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000a001';
  p_c1   constant uuid := '00000000-0000-4000-8000-00000000a301';
  p_orph constant uuid := '00000000-0000-4000-8000-00000000a305';
  w_c1   constant uuid := '00000000-0000-4000-8000-00000000a401';
begin
  perform pg_temp.noter('G','G1. il voit tous les programmes, orphelins compris',
    pg_temp.lire(u_adm,'select count(*) from public.programs') >= 7);
  perform pg_temp.noter('G','G2. il voit le modèle ORPHELIN que plus aucun coach ne voit',
    pg_temp.lire(u_adm, format('select count(*) from public.programs where id = %L', p_orph)) = 1);
  perform pg_temp.noter('G','G3. il modifie le programme d''un coach',
    pg_temp.ecrit(u_adm, format($q$update public.programs set name='PG admin a renomme' where id=%L$q$, p_c1)));
  perform pg_temp.noter('G','G4. il voit la structure de ce programme',
    pg_temp.lire(u_adm, format('select count(*) from public.program_weeks where program_id = %L', p_c1)) >= 1);
  perform pg_temp.noter('G','G5. il supprime un programme orphelin',
    pg_temp.ecrit(u_adm, format($q$delete from public.programs where id=%L$q$, p_orph)));
  -- Et la bibliothèque mutualisée du cabinet n'a PAS été cloisonnée : un coach
  -- garde ses exercices et ses modèles de séance.
  perform pg_temp.noter('G','G6. la bibliothèque d''exercices reste ouverte au coach',
    pg_temp.lire('00000000-0000-4000-8000-00000000a003','select count(*) from public.exercise_library') >= 0);
  perform pg_temp.noter('G','G7. les modèles de séance restent ouverts au coach',
    pg_temp.lire('00000000-0000-4000-8000-00000000a003','select count(*) from public.session_templates') >= 0);
end $$;


-- ── H. LE VISITEUR NON CONNECTÉ : LA VITRINE, ET RIEN QUE LA VITRINE ──────
--
-- ⚠️ CETTE SECTION EXISTE PARCE QUE LA VITRINE ÉTAIT CASSÉE, ET QUE PERSONNE
-- NE LE MESURAIT. Les policies INTERNES du staff portaient le rôle `{public}`
-- et étaient donc évaluées pour `anon` aussi : elles appelaient des fonctions
-- dont P13-B avait retiré l'EXECUTE à `anon`, et une policy permissive qui
-- LÈVE fait échouer toute la requête — y compris la branche publique qui
-- aurait dû répondre. Reproduit en local :
--
--     42501  permission denied for function student_ids_entrainement_lecture
--
-- Deux sauts étaient en cause, et le second ne se voyait pas dans le texte des
-- policies : `programs_select_assigned_student` n'appelle aucune fonction
-- interdite, mais sa clause lit `assignments`, dont les policies en appellent.
do $$
declare
  u_adm   constant uuid := '00000000-0000-4000-8000-00000000a001';
  u_c2    constant uuid := '00000000-0000-4000-8000-00000000a003';
  c_adm   constant uuid := '00000000-0000-4000-8000-00000000a101';
  p_pub   constant uuid := '00000000-0000-4000-8000-00000000a306';
  p_priv  constant uuid := '00000000-0000-4000-8000-00000000a301';
  t_offre constant uuid := '00000000-0000-4000-8000-00000000a501';
  p_brou  constant uuid := '00000000-0000-4000-8000-00000000a308';
  t_interne constant uuid := '00000000-0000-4000-8000-00000000a502';
  v_n int;
  v_ok boolean;
  v_err text;
begin
  -- Le décor de cette section s'insère en SERVEUR : voir pg_temp.serveur().
  perform pg_temp.serveur();
  -- Un brouillon PUBLIÉ-mais-pas-actif, et une offre QUI N'EST PAS en vitrine :
  -- ce sont les deux pièges que le visiteur ne doit pas franchir.
  insert into public.programs (id, name, program_mode, is_public, status, coach_id)
  values (p_brou,'PG Prog brouillon public','individuel', true,'brouillon', c_adm);
  insert into public.subscription_templates (id, name, amount_cents, currency, billing_interval, is_active)
  values (t_interne,'PG Offre interne', 29900,'eur','monthly', true);

  -- H1 — la requête EXACTE de la vitrine ne lève plus.
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin
    perform count(*)
       from public.programs p
       left join public.subscription_templates t on t.id = p.public_subscription_template_id
      where p.is_public = true and p.status = 'actif';
    v_ok := true;
  exception when others then v_ok := false; v_err := sqlstate;
  end;
  perform pg_temp.serveur();
  perform pg_temp.noter('H','H1. la requête de la vitrine ne lève plus pour un visiteur', coalesce(v_ok, false));

  -- H2/H3 — il voit le programme publié, AVEC son prix.
  perform pg_temp.noter('H','H2. le visiteur voit le programme publié',
    pg_temp.lire_anon(format($q$select count(*) from public.programs where id=%L$q$, p_pub)) = 1);
  perform pg_temp.noter('H','H3. …et le prix de son offre, par la jointure',
    pg_temp.lire_anon(format($q$select t.amount_cents from public.programs p
      join public.subscription_templates t on t.id = p.public_subscription_template_id
     where p.id = %L$q$, p_pub)) = 4900);

  -- H4 à H6 — et RIEN d'autre.
  perform pg_temp.noter('H','H4. le programme PRIVÉ d''un coach lui est invisible',
    pg_temp.lire_anon(format($q$select count(*) from public.programs where id=%L$q$, p_priv)) = 0);
  perform pg_temp.noter('H','H5. un BROUILLON marqué public lui est invisible (status <> actif)',
    pg_temp.lire_anon(format($q$select count(*) from public.programs where id=%L$q$, p_brou)) = 0);
  perform pg_temp.noter('H','H6. il ne voit QUE les programmes publiés et actifs',
    pg_temp.lire_anon($q$select count(*) from public.programs where not (is_public and status='actif')$q$) = 0);

  -- H7/H8 — le catalogue d'offres est borné à ce que la vitrine présente.
  perform pg_temp.noter('H','H7. il voit l''offre RATTACHÉE au programme publié',
    pg_temp.lire_anon(format($q$select count(*) from public.subscription_templates where id=%L$q$, t_offre)) = 1);
  perform pg_temp.noter('H','H8. mais PAS une offre active qu''aucun programme publié ne présente',
    pg_temp.lire_anon(format($q$select count(*) from public.subscription_templates where id=%L$q$, t_interne)) = 0);

  -- H9 à H12 — aucune donnée d'élève, aucune donnée de cabinet.
  perform pg_temp.noter('H','H9. aucune fiche élève',
    pg_temp.lire_anon('select count(*) from public.student_profiles_lisible') <= 0);
  perform pg_temp.noter('H','H10. aucun élève',
    pg_temp.lire_anon('select count(*) from public.students') <= 0);
  perform pg_temp.noter('H','H11. aucune structure de programme (semaines)',
    pg_temp.lire_anon('select count(*) from public.program_weeks') <= 0);
  perform pg_temp.noter('H','H12. aucune fiche de coach',
    pg_temp.lire_anon('select count(*) from public.coaches') <= 0);

  -- H13 — et le visiteur n'écrit rien, même si le GRANT de table le lui permet.
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin
    insert into public.programs (name, program_mode, is_public, status) values ('anon','individuel',true,'actif');
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.serveur();
  perform pg_temp.noter('H','H13. le visiteur ne crée aucun programme', not coalesce(v_ok, true));

  -- H14 — aucune fonction interne du staff n'a été rouverte à `anon`.
  select count(*) into v_n
    from unnest(array['public.student_ids_entrainement_lecture()',
                      'public.coach_ids_portee()',
                      'public.categories_lecture()',
                      'public.est_staff_global()',
                      'public.is_admin()',
                      'public.program_ids_lecture()']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  perform pg_temp.noter('H','H14. anon n''a l''EXECUTE d''AUCUNE fonction interne du staff', v_n = 0);

  /*
   * ── H15 à H18 : LES TROIS POLICIES D'ÉCRITURE DU CATALOGUE D'OFFRES ────
   *
   * ⚠️ POURQUOI CES CONTRÔLES EXISTENT. 20261020090000 avait borné au rôle
   * `authenticated` les policies internes de `programs` et les deux policies
   * de LECTURE du catalogue, mais pas ses trois policies d'ÉCRITURE. Or `anon`
   * détient les privilèges de table INSERT/UPDATE/DELETE sur
   * `subscription_templates` (GRANT par défaut de Supabase) : ces policies
   * étaient donc réellement évaluées pour un visiteur, et chacune appelle
   * `is_admin()`, dont P13-B lui a retiré l'EXECUTE. Mesuré avant correctif,
   * pour les trois commandes :
   *
   *     42501  permission denied for function is_admin
   *
   * Le visiteur était refusé, et il reste refusé : ce qui change est la NATURE
   * du refus. Corrigé par 20261021090000 (`alter policy … to authenticated`).
   */
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and roles::text = '{authenticated}';
  perform pg_temp.noter('H','H15. les trois policies d''écriture du catalogue sont bornées au rôle authentifié', v_n = 3);

  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_admin';
  perform pg_temp.noter('H','H16. …et elles ont gardé leur condition is_admin()', v_n = 3);

  /*
   * ⚠️ ON MESURE LE MESSAGE, PAS SEULEMENT LE SQLSTATE. « refusé par la règle
   * d'accès » et « refusé parce qu'une fonction manque » portent TOUS DEUX le
   * code 42501 : seul le texte les distingue, et c'est précisément ce que ce
   * correctif change. Un contrôle sur le seul SQLSTATE serait resté vert
   * avant comme après.
   */
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin
    insert into public.subscription_templates (name, amount_cents, currency, billing_interval, is_active)
    values ('PG verification anon', 1, 'eur','monthly', true);
    v_ok := true; v_err := '(acceptée)';
  exception when others then
    v_ok := false; v_err := sqlerrm;
  end;
  perform pg_temp.serveur();
  perform pg_temp.noter('H','H17. le visiteur ne crée aucune offre, et le refus vient de la RÈGLE, pas d''un privilège de fonction',
    not coalesce(v_ok, true) and v_err !~* 'function');

  perform pg_temp.noter('H','H18. l''administrateur, lui, crée toujours une offre',
    pg_temp.ecrit(u_adm, $q$insert into public.subscription_templates (name, amount_cents, currency, billing_interval, is_active)
      values ('PG offre admin', 1, 'eur','monthly', true) returning id$q$));
end $$;


-- ── Z. BILAN ──────────────────────────────────────────────────────────────
do $$ begin reset role; end $$;

select section, count(*) as controles, count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) as total_controles, count(*) filter (where not ok) as total_echecs
  from _faits;

select string_agg(libelle, E'\n') as echecs_detailles from _faits where not ok;

rollback;

select
  (select count(*) from public.programs where name like 'PG %')            as programmes_restants,
  (select count(*) from auth.users where email like 'pg.%@test.local')     as comptes_restants;
