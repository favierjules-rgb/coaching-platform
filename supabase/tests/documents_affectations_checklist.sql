-- ════════════════════════════════════════════════════════════════════════════
-- AFFECTATION DES DOCUMENTS AUX ÉLÈVES — DROITS RÉELS, PAR ACTEUR
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/documents_affectations_checklist.sql
--
-- ⚠️ CETTE CHECKLIST EST LE FILET QUI MANQUAIT. Le défaut corrigé par
-- 20261025090000 — la PREMIÈRE affectation d'un document était impossible — a
-- vécu depuis le 11/10/2026 sans qu'aucun test ne rougisse. Relevé :
--   · `student-content-assignment.mts` (contrôle 18) exerce bien
--     `setDocumentAssignment`, mais contre un FAUX client : aucune policy n'y
--     est évaluée, il passait au vert pendant que la production refusait ;
--   · `espace_coach_isolation_checklist.sql` ne mentionnait
--     `document_assignments` qu'une fois, pour une lecture `anon` à 0.
-- Aucun test, nulle part, n'exécutait un INSERT dans cette table par un
-- acteur réel. C'est ce que fait ce fichier.
--
-- ⚠️ SEPT ACTEURS, ET CHACUN POUR UNE RAISON.
--   · l'administrateur        → il ne doit RIEN perdre ;
--   · le coach A              → le propriétaire des documents ;
--   · le coach B              → celui qui ne doit rien pouvoir ;
--   · le collaborateur        → habilité en `entrainement`, PAS en
--                               `nutrition` : la catégorie doit trancher ;
--   · l'élève du coach A      → il lit sa propre affectation, et rien d'autre ;
--   · l'élève du coach B      → il ne doit apparaître dans AUCUNE affectation
--                               écrite par le coach A ;
--   · le visiteur anon        → aucune ligne, et aucune policy qui LÈVE.
--
-- ⚠️ UN REFUS REND -1, JAMAIS 0 pour les écritures. « Aucune ligne touchée »
-- et « refusé » sont deux résultats différents, et c'est toute la question.
--
-- ⚠️ PDF TÉLÉVERSÉ ET LIEN EXTERNE SONT TESTÉS SÉPARÉMENT, parce que le
-- rapport de bug les désignait. Le résultat attendu est le MÊME pour les deux :
-- ni le type, ni `storage_path`, ni `external_url` n'entrent dans la décision.
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

create or replace function pg_temp.serveur() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void language plpgsql as $$
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
  perform pg_temp.serveur(); return coalesce(v, 0);
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

create or replace function pg_temp.ecrit(p_user uuid, p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin
    execute p_sql; get diagnostics v = row_count;
  exception when others then v := -1;
  end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

create or replace function pg_temp.ecrit_anon(p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin execute p_sql; get diagnostics v = row_count;
  exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

/** Remet le décor à zéro entre deux acteurs, EN SERVEUR (RLS hors jeu). */
create or replace function pg_temp.reinitialiser() returns void language plpgsql as $$
begin
  perform pg_temp.serveur();
  delete from public.document_assignments
   where document_id in (select id from public.documents where title like 'AFF %');
  insert into public.document_assignments (document_id, student_id)
  values ('00000000-0000-4000-8000-00000000d305', '00000000-0000-4000-8000-00000000d201'),
         ('00000000-0000-4000-8000-00000000d305', '00000000-0000-4000-8000-00000000d202');
end $$;


-- ── A. LE DÉCOR ────────────────────────────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000d001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000d002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000d003';
  u_col  constant uuid := '00000000-0000-4000-8000-00000000d004';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000d005';
  u_el_b constant uuid := '00000000-0000-4000-8000-00000000d006';
  u_el_a2 constant uuid := '00000000-0000-4000-8000-00000000d007';
  c_adm  constant uuid := '00000000-0000-4000-8000-00000000d101';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000d102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000d103';
  c_col  constant uuid := '00000000-0000-4000-8000-00000000d104';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000d201';
  e_b    constant uuid := '00000000-0000-4000-8000-00000000d202';
  e_a2   constant uuid := '00000000-0000-4000-8000-00000000d203';
  d_pdf  constant uuid := '00000000-0000-4000-8000-00000000d301';
  d_lien constant uuid := '00000000-0000-4000-8000-00000000d302';
  d_nutri constant uuid := '00000000-0000-4000-8000-00000000d303';
  d_b    constant uuid := '00000000-0000-4000-8000-00000000d304';
  d_fc   constant uuid := '00000000-0000-4000-8000-00000000d305';
  d_fc_vide constant uuid := '00000000-0000-4000-8000-00000000d306';
begin
  perform pg_temp.serveur();

  insert into auth.users (id, email) values
    (u_adm,'aff.adm@test.local'), (u_a,'aff.a@test.local'), (u_b,'aff.b@test.local'),
    (u_col,'aff.col@test.local'), (u_el_a,'aff.ea@test.local'), (u_el_b,'aff.eb@test.local'),
    (u_el_a2,'aff.ea2@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,'aff.adm@test.local','admin','AFF','Admin'),
    (u_a,'aff.a@test.local','coach','AFF','CoachA'),
    (u_b,'aff.b@test.local','coach','AFF','CoachB'),
    (u_col,'aff.col@test.local','coach','AFF','Collab'),
    (u_el_a,'aff.ea@test.local','student','AFF','EleveA'),
    (u_el_b,'aff.eb@test.local','student','AFF','EleveB'),
    (u_el_a2,'aff.ea2@test.local','student','AFF','EleveA2');
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm, u_adm,'aff.adm@test.local','AFF Admin','admin','actif','-'),
    (c_a,   u_a,  'aff.a@test.local','AFF CoachA','assistant','actif','-'),
    (c_b,   u_b,  'aff.b@test.local','AFF CoachB','assistant','actif','-'),
    (c_col, u_col,'aff.col@test.local','AFF Collab','collaborateur','actif','-');
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    (e_a,  u_el_a,  c_a,'AFF','EleveA','aff.ea@test.local','active','coaching'),
    (e_a2, u_el_a2, c_a,'AFF','EleveA2','aff.ea2@test.local','active','coaching'),
    (e_b,  u_el_b,  c_b,'AFF','EleveB','aff.eb@test.local','active','coaching');

  -- ⚠️ LE COLLABORATEUR EST HABILITÉ EN `entrainement` ET `suivi_eleve`, PAS EN
  -- `nutrition` : c'est ce qui permet de mesurer que la CATÉGORIE du document
  -- tranche encore, et que le correctif n'a pas élargi P13-B.
  insert into public.collaborateur_eleves (collaborateur_id, student_id, affecte_par)
    values (c_col, e_a, c_a);
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
    select c_col, c, 'ecriture', c_a
      from unnest(array['entrainement','suivi_eleve','agenda_communication']) c;

  -- Cinq documents. Les deux premiers ne diffèrent QUE par leur support :
  -- un fichier téléversé contre un lien externe (type Canva).
  insert into public.documents
    (id, coach_id, title, type, category, status, visibility, storage_path, file_name, external_url) values
    (d_pdf,  c_a,  'AFF pdf televerse','pdf','entrainement','publié','assigned',
       c_a::text || '/' || d_pdf::text || '/1-guide.pdf', 'guide.pdf', null),
    (d_lien, c_a,  'AFF lien externe','pdf','entrainement','publié','assigned',
       null, null, 'https://www.canva.com/design/AFF/view'),
    (d_nutri, c_a, 'AFF nutrition','pdf','nutrition','publié','assigned', null, null, null),
    (d_b,    c_b,  'AFF doc du coach B','pdf','entrainement','publié','assigned', null, null, null),
    (d_fc,   null, 'AFF fonds commun','pdf','entrainement','publié','global', null, null, null),
    -- ⚠️ UN FONDS COMMUN SANS AUCUNE AFFECTATION : c'est le seul décor où la
    -- question « qui peut poser la PREMIÈRE affectation » se pose vraiment.
    (d_fc_vide, null, 'AFF fonds commun vide','pdf','entrainement','publié','global', null, null, null);

  -- Le fonds commun porte DEUX affectations, une par cabinet : c'est le décor
  -- qui révélait la fuite en lecture.
  insert into public.document_assignments (document_id, student_id) values (d_fc, e_a), (d_fc, e_b);
end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── B. LE DÉBLOCAGE — LA PREMIÈRE AFFECTATION D'UN DOCUMENT ────────────────
-- ⚠️ C'EST LE DÉFAUT RAPPORTÉ. Avant 20261025090000, chacun de ces contrôles
-- rendait -1 (`42501`), pour les TROIS rôles, administrateur compris.
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000d001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000d002';
  u_col  constant uuid := '00000000-0000-4000-8000-00000000d004';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000d201';
  e_a2   constant uuid := '00000000-0000-4000-8000-00000000d203';
  d_pdf  constant uuid := '00000000-0000-4000-8000-00000000d301';
  d_lien constant uuid := '00000000-0000-4000-8000-00000000d302';
  acteurs text[][] := array[['administrateur','00000000-0000-4000-8000-00000000d001'],
                            ['coach proprietaire','00000000-0000-4000-8000-00000000d002'],
                            ['collaborateur habilite','00000000-0000-4000-8000-00000000d004']];
  i int; nom text; u uuid;
begin
  for i in 1..array_length(acteurs,1) loop
    nom := acteurs[i][1]; u := acteurs[i][2]::uuid;

    perform pg_temp.reinitialiser();
    perform pg_temp.noter('B', format('B1/%s. PREMIERE affectation sur un PDF TELEVERSE sans affectation', nom),
      pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_pdf, e_a)) = 1);

    perform pg_temp.reinitialiser();
    perform pg_temp.noter('B', format('B2/%s. PREMIERE affectation sur un document a LIEN EXTERNE (Canva)', nom),
      pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_lien, e_a)) = 1);

    -- SÉLECTION MULTIPLE — et elle se mesure DANS LA PORTÉE DE L'ACTEUR.
    -- ⚠️ Le collaborateur n'a QU'UN élève affecté (`collaborateur_eleves`) :
    -- attendre deux affectations de sa part serait attendre une fuite. Pour
    -- lui, le contrôle correct est « l'un passe, l'autre est refusé ».
    perform pg_temp.reinitialiser();
    if nom = 'collaborateur habilite' then
      perform pg_temp.noter('B', format('B3/%s. SELECTION MULTIPLE bornee : son eleve passe, l autre est refuse', nom),
        pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
          values (%L,%L)$q$, d_pdf, e_a)) = 1
        and pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
          values (%L,%L)$q$, d_pdf, e_a2)) = -1
        and pg_temp.lire(u, format($q$select count(*) from public.document_assignments
          where document_id=%L$q$, d_pdf)) = 1);
    else
      perform pg_temp.noter('B', format('B3/%s. SELECTION MULTIPLE : deux eleves affectes au meme document', nom),
        pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
          values (%L,%L)$q$, d_pdf, e_a)) = 1
        and pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
          values (%L,%L)$q$, d_pdf, e_a2)) = 1
        and pg_temp.lire(u, format($q$select count(*) from public.document_assignments
          where document_id=%L$q$, d_pdf)) = 2);
    end if;

    -- ⚠️ L'ALLER-RETOUR COMPLET : c'est lui qui ferme le piège sans retour.
    perform pg_temp.reinitialiser();
    perform pg_temp.noter('B', format('B4/%s. ALLER-RETOUR : affecter, lire, revoquer, REAFFECTER', nom),
      pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_pdf, e_a)) = 1
      and pg_temp.lire(u, format($q$select count(*) from public.document_assignments
        where document_id=%L and student_id=%L$q$, d_pdf, e_a)) = 1
      and pg_temp.ecrit(u, format($q$delete from public.document_assignments
        where document_id=%L and student_id=%L$q$, d_pdf, e_a)) = 1
      and pg_temp.lire(u, format($q$select count(*) from public.document_assignments
        where document_id=%L$q$, d_pdf)) = 0
      -- ⚠️ ET C'EST ICI QUE L'ANCIEN COMPORTEMENT RENDAIT -1 : le document
      -- n'avait plus aucune affectation, donc plus aucun moyen d'en recevoir.
      and pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_pdf, e_a)) = 1);

    -- PDF et lien externe donnent le MÊME verdict : le support n'entre pas en jeu.
    perform pg_temp.reinitialiser();
    perform pg_temp.noter('B', format('B5/%s. PDF televerse et lien externe : verdict IDENTIQUE', nom),
      pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_pdf, e_a))
      = pg_temp.ecrit(u, format($q$insert into public.document_assignments (document_id,student_id)
        values (%L,%L)$q$, d_lien, e_a)));
  end loop;
  perform pg_temp.reinitialiser();
end $$;


-- ── C. ISOLATION EN ÉCRITURE ───────────────────────────────────────────────
-- ⚠️ AVANT 20261025090000, C1 ET C2 RENDAIENT 1 : les policies ne regardaient
-- QUE `document_id`, jamais `student_id`. Un coach pouvait donc affecter son
-- document à l'élève d'un autre cabinet, qui le voyait ensuite apparaître dans
-- sa bibliothèque.
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000d001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000d002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000d003';
  u_col  constant uuid := '00000000-0000-4000-8000-00000000d004';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000d005';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000d201';
  e_b    constant uuid := '00000000-0000-4000-8000-00000000d202';
  d_pdf  constant uuid := '00000000-0000-4000-8000-00000000d301';
  d_nutri constant uuid := '00000000-0000-4000-8000-00000000d303';
  d_b    constant uuid := '00000000-0000-4000-8000-00000000d304';
  d_fc   constant uuid := '00000000-0000-4000-8000-00000000d305';
begin
  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C1. le coach A n affecte PAS l eleve du coach B a SON document',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_b)) = -1);
  perform pg_temp.noter('C','C2. …meme quand son document porte DEJA une affectation (voie P13-B)',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_a)) = 1
    and pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_b)) = -1);
  perform pg_temp.noter('C','C3. …et la ligne de l eleve du coach B n existe pas',
    (select count(*) from public.document_assignments where document_id=d_pdf and student_id=e_b) = 0);

  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C4. le coach B n affecte rien sur le document du coach A',
    pg_temp.ecrit(u_b, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_b)) = -1);

  perform pg_temp.noter('C','C5. le collaborateur SANS la categorie nutrition n affecte pas un document nutrition',
    pg_temp.ecrit(u_col, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_nutri, e_a)) = -1);
  perform pg_temp.noter('C','C6. …alors qu il affecte bien un document d entrainement (P13-B intact)',
    pg_temp.ecrit(u_col, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_a)) = 1);
  perform pg_temp.noter('C','C7. le collaborateur n affecte pas un eleve qui ne lui est PAS affecte',
    pg_temp.ecrit(u_col, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_b)) = -1);

  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C8. l ELEVE n affecte aucun document, ni a lui ni a un autre',
    pg_temp.ecrit(u_el_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_a)) = -1);
  perform pg_temp.noter('C','C9. le visiteur anonyme n affecte rien',
    pg_temp.ecrit_anon(format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_a)) = -1);

  -- ⚠️ `with check` SUR L'UPDATE : sans lui, une affectation autorisée pourrait
  -- être DÉPLACÉE vers l élève d un autre coach.
  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C10. le coach A ne DEPLACE pas une affectation vers l eleve du coach B',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_pdf, e_a)) = 1
    and pg_temp.ecrit(u_a, format($q$update public.document_assignments set student_id=%L
      where document_id=%L and student_id=%L$q$, e_b, d_pdf, e_a)) <= 0);

  -- ⚠️ DEUX SITUATIONS DISTINCTES SUR LE FONDS COMMUN (`coach_id IS NULL`),
  -- et les confondre donnerait un contrôle faux.
  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C11. fonds commun VIERGE : la 1re affectation reste reservee a l administrateur',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, '00000000-0000-4000-8000-00000000d306',
      '00000000-0000-4000-8000-00000000d203')) = -1);
  perform pg_temp.noter('C','C12. …et l administrateur, lui, la pose',
    pg_temp.ecrit(u_adm, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, '00000000-0000-4000-8000-00000000d306',
      '00000000-0000-4000-8000-00000000d203')) = 1);
  perform pg_temp.serveur();
  delete from public.document_assignments
   where document_id = '00000000-0000-4000-8000-00000000d306';

  -- ⚠️ COMPORTEMENT P13-B CONSERVÉ, ET MESURÉ COMME TEL : quand un de ses
  -- élèves est DÉJÀ affecté à un document du fonds commun, le coach peut y
  -- ajouter un autre de SES élèves. C'était vrai avant ce lot, ça l'est encore.
  perform pg_temp.reinitialiser();
  perform pg_temp.noter('C','C13. fonds commun DEJA ouvert a un de ses eleves : le coach peut en ajouter un autre (P13-B)',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_fc, '00000000-0000-4000-8000-00000000d203')) = 1);
  perform pg_temp.noter('C','C14. …mais toujours pas l eleve d un autre coach',
    pg_temp.ecrit(u_a, format($q$insert into public.document_assignments (document_id,student_id)
      values (%L,%L)$q$, d_fc, e_b)) = -1);
  perform pg_temp.reinitialiser();
end $$;


-- ── D. ISOLATION EN LECTURE ────────────────────────────────────────────────
-- ⚠️ AVANT 20261025090000, D1 RENDAIT 2 ET D2 RENDAIT 1 : sur un document du
-- fonds commun affecté à plusieurs cabinets, un coach lisait l identifiant
-- d élèves dont il ne peut pas lire la fiche.
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000d001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000d002';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000d005';
  u_el_b constant uuid := '00000000-0000-4000-8000-00000000d006';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000d201';
  e_b    constant uuid := '00000000-0000-4000-8000-00000000d202';
  d_fc   constant uuid := '00000000-0000-4000-8000-00000000d305';
begin
  perform pg_temp.reinitialiser();
  perform pg_temp.noter('D','D1. le coach A ne lit QUE l affectation de SON eleve sur le fonds commun',
    pg_temp.lire(u_a, format($q$select count(*) from public.document_assignments
      where document_id=%L$q$, d_fc)) = 1);
  perform pg_temp.noter('D','D2. …et PAS celle de l eleve du coach B',
    pg_temp.lire(u_a, format($q$select count(*) from public.document_assignments
      where document_id=%L and student_id=%L$q$, d_fc, e_b)) = 0);
  perform pg_temp.noter('D','D3. …alors qu il ne peut pas davantage lire la FICHE de cet eleve',
    pg_temp.lire(u_a, format($q$select count(*) from public.students where id=%L$q$, e_b)) = 0);
  perform pg_temp.noter('D','D4. l administrateur, lui, lit les deux affectations',
    pg_temp.lire(u_adm, format($q$select count(*) from public.document_assignments
      where document_id=%L$q$, d_fc)) = 2);

  perform pg_temp.noter('D','D5. l eleve lit SA propre affectation (branche inchangee)',
    pg_temp.lire(u_el_a, format($q$select count(*) from public.document_assignments
      where document_id=%L and student_id=%L$q$, d_fc, e_a)) = 1);
  perform pg_temp.noter('D','D6. …et pas celle d un AUTRE eleve',
    pg_temp.lire(u_el_a, format($q$select count(*) from public.document_assignments
      where document_id=%L and student_id=%L$q$, d_fc, e_b)) = 0);
  perform pg_temp.noter('D','D7. l eleve du coach B lit la sienne, et seulement la sienne',
    pg_temp.lire(u_el_b, format($q$select count(*) from public.document_assignments
      where document_id=%L$q$, d_fc)) = 1);

  perform pg_temp.noter('D','D8. le visiteur anonyme ne lit aucune affectation, et aucune policy ne LEVE',
    pg_temp.lire_anon('select count(*) from public.document_assignments') = 0);
end $$;


-- ── E. NON-RÉGRESSION ──────────────────────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000d001';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000d005';
  u_col  constant uuid := '00000000-0000-4000-8000-00000000d004';
  d_fc   constant uuid := '00000000-0000-4000-8000-00000000d305';
  v_n int;
begin
  perform pg_temp.reinitialiser();

  -- ⚠️ LES FONCTIONS DE PORTÉE NE SONT PAS TOUCHÉES. Les policies Storage
  -- (`documents_bucket_select_accessible`, `document_covers_select_accessible`)
  -- s appuient sur elles : les modifier changerait l acces aux FICHIERS.
  perform pg_temp.noter('E','E1. document_ids_ecriture() est inchangee (jointure sur document_assignments)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='document_ids_ecriture'
               and pg_get_functiondef(p.oid) ~ 'join public\.document_assignments'));
  perform pg_temp.noter('E','E2. document_ids_lecture() est inchangee',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='document_ids_lecture'
               and pg_get_functiondef(p.oid) ~ 'join public\.document_assignments'));

  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='documents'
     and policyname in ('documents_select_global_or_assigned','documents_manage_staff_select',
                        'documents_manage_staff_insert','documents_manage_staff_update',
                        'documents_manage_staff_delete');
  perform pg_temp.noter('E','E3. les cinq policies de public.documents sont intactes', v_n = 5);

  select count(*) into v_n from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname in ('documents_bucket_select_accessible','document_covers_select_accessible');
  perform pg_temp.noter('E','E4. les policies Storage des fichiers et des couvertures sont intactes', v_n = 2);

  perform pg_temp.noter('E','E5. l eleve lit toujours sa bibliotheque de documents',
    pg_temp.lire(u_el_a, $q$select count(*) from public.documents$q$) >= 1);
  perform pg_temp.noter('E','E6. …dont le document du fonds commun',
    pg_temp.lire(u_el_a, format($q$select count(*) from public.documents where id=%L$q$, d_fc)) = 1);

  perform pg_temp.noter('E','E7. l eleve marque toujours sa consultation (RPC mark_document_viewed)',
    pg_temp.lire(u_el_a, format($q$select case when public.mark_document_viewed(%L) is not null
      then 1 else 1 end$q$, d_fc)) = 1);

  -- `anon` n a l EXECUTE d aucun des deux nouveaux predicats.
  select count(*) into v_n
    from unnest(array['public.affectation_document_lisible(uuid, uuid)',
                      'public.affectation_document_ecrivable(uuid, uuid)']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  perform pg_temp.noter('E','E8. anon n a l EXECUTE d aucun des deux nouveaux predicats', v_n = 0);

  -- Le collaborateur n a gagne AUCUN droit par ce lot : sa categorie manquante
  -- le bloque toujours (mesure doublee de C5, cote lecture).
  perform pg_temp.noter('E','E9. le collaborateur ne lit aucun document nutrition (categorie absente)',
    pg_temp.lire(u_col, $q$select count(*) from public.documents where title = 'AFF nutrition'$q$) = 0);

  perform pg_temp.noter('E','E10. l administrateur lit les six documents du decor',
    pg_temp.lire(u_adm, $q$select count(*) from public.documents where title like 'AFF %'$q$) = 6);
end $$;


-- ── BILAN ──────────────────────────────────────────────────────────────────
select section,
       count(*) filter (where ok) as reussis,
       count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) filter (where ok) as total_reussis,
       count(*) filter (where not ok) as total_echecs
  from _faits;

select libelle from _faits where not ok order by section, libelle;

do $$
declare v_echecs int;
begin
  select count(*) into v_echecs from _faits where not ok;
  if v_echecs > 0 then
    raise warning '% controle(s) en echec — voir la liste ci-dessus', v_echecs;
  else
    raise notice 'TOUS LES CONTROLES PASSENT : premiere affectation possible (PDF televerse comme lien externe), aller-retour complet, portee eleve verifiee en lecture et en ecriture, P13-B et acces eleve conserves.';
  end if;
end $$;

rollback;
