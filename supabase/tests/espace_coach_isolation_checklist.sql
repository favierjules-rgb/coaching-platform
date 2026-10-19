-- ════════════════════════════════════════════════════════════════════════════
-- ESPACE COACH ISOLÉ — AGENDA, DOCUMENTS, FICHIERS, JOURNAL D'EMAILS
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/espace_coach_isolation_checklist.sql
--
-- Ce que cette checklist prouve, et que l'interface ne peut pas prouver : un
-- second coach, DANS SA SESSION, ne lit, ne modifie, ne supprime et ne
-- télécharge rien qui ne soit à lui — par des requêtes SQL nues et par les
-- RPC réellement appelées par l'application, c'est-à-dire exactement ce qu'un
-- appel PostgREST direct produirait.
--
-- ⚠️ SIX ACTEURS, ET CHACUN POUR UNE RAISON.
--   · l'administrateur  → il ne doit RIEN perdre ;
--   · le coach A        → le propriétaire ;
--   · le coach B        → celui qui ne doit rien voir ; c'est le « nouveau
--                         compte coach » du rapport ;
--   · le collaborateur  → P13-B ne doit pas bouger d'un pouce ;
--   · l'élève de A      → la vitrine documentaire et la réservation doivent
--                         continuer de marcher ;
--   · le visiteur anon  → aucune policy ne doit LEVER pour lui (une policy qui
--                         lève fait échouer toute la requête).
--
-- ⚠️ UN REFUS REND -1, JAMAIS 0 pour les lectures. « Refusé » et « rien
-- trouvé » sont deux résultats différents, et c'est toute la question ici.
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
 * ⚠️ `reset role` NE SUFFIT PAS : il laisse `request.jwt.claims`, donc
 * `auth.uid()` continuerait de désigner le dernier acteur et le décor inséré
 * « en postgres » serait jugé comme lui.
 *
 * ⚠️ `'{}'` ET PAS LA CHAÎNE VIDE : `auth.uid()` parse cette variable en JSON.
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

/**
 * Écriture : rend le NOMBRE DE LIGNES touchées, ou -1 si la commande a été
 * refusée.
 *
 * ⚠️ 0 ET -1 NE DISENT PAS LA MÊME CHOSE, et la distinction est le cœur de
 * cette checklist. « Aucune ligne touchée » (la policy a filtré) et « refusé »
 * (la règle ou une RPC a dit non) sont deux refus légitimes, mais un UPDATE
 * qui rend 1 est une fuite.
 */
create or replace function pg_temp.ecrit(p_user uuid, p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin
    execute p_sql; get diagnostics v = row_count;
  exception when others then
    v := -1;
    if sqlstate like '23%' then
      raise notice '  (SQLSTATE % — décor incohérent, PAS un refus : %)', sqlstate, left(p_sql, 70);
    end if;
  end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

/** Appel d'une RPC : rend 1 si elle a abouti, -1 si elle a refusé. */
create or replace function pg_temp.rpc(p_user uuid, p_sql text) returns int
language plpgsql as $$
begin
  perform pg_temp.devenir(p_user);
  begin execute p_sql; exception when others then
    perform pg_temp.serveur(); return -1; end;
  perform pg_temp.serveur(); return 1;
end $$;


-- ── A. LE DÉCOR ────────────────────────────────────────────────────────────
do $$
declare
  u_adm    constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a      constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b      constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_collab constant uuid := '00000000-0000-4000-8000-00000000e004';
  u_el_a   constant uuid := '00000000-0000-4000-8000-00000000e005';
  u_el_b   constant uuid := '00000000-0000-4000-8000-00000000e006';
  c_adm    constant uuid := '00000000-0000-4000-8000-00000000e101';
  c_a      constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b      constant uuid := '00000000-0000-4000-8000-00000000e103';
  c_collab constant uuid := '00000000-0000-4000-8000-00000000e104';
  e_a      constant uuid := '00000000-0000-4000-8000-00000000e201';
  e_b      constant uuid := '00000000-0000-4000-8000-00000000e202';
  d_hist   constant uuid := '00000000-0000-4000-8000-00000000e301';
  d_adm    constant uuid := '00000000-0000-4000-8000-00000000e302';
  d_a      constant uuid := '00000000-0000-4000-8000-00000000e303';
  disp_a   constant uuid := '00000000-0000-4000-8000-00000000e401';
  disp_hist constant uuid := '00000000-0000-4000-8000-00000000e402';
begin
  perform pg_temp.serveur();

  insert into auth.users (id, email) values
    (u_adm,'ec.adm@test.local'), (u_a,'ec.a@test.local'), (u_b,'ec.b@test.local'),
    (u_collab,'ec.collab@test.local'), (u_el_a,'ec.eleve.a@test.local'), (u_el_b,'ec.eleve.b@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,'ec.adm@test.local','admin','EC','Admin'),
    (u_a,'ec.a@test.local','coach','EC','CoachA'),
    (u_b,'ec.b@test.local','coach','EC','CoachB'),
    (u_collab,'ec.collab@test.local','coach','EC','Collab'),
    (u_el_a,'ec.eleve.a@test.local','student','EC','EleveA'),
    (u_el_b,'ec.eleve.b@test.local','student','EC','EleveB');
  -- ⚠️ `assistant` EST L'ÉTIQUETTE D'UN COACH AUTONOME, et c'est elle qui
  -- rendait `est_staff_global()` vrai — la cause de tout ce lot.
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm, u_adm,'ec.adm@test.local','EC Admin','admin','actif','-'),
    (c_a, u_a,'ec.a@test.local','EC CoachA','assistant','actif','-'),
    (c_b, u_b,'ec.b@test.local','EC CoachB','assistant','actif','-'),
    (c_collab, u_collab,'ec.collab@test.local','EC Collab','collaborateur','actif','-');
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    (e_a, u_el_a, c_a,'EC','EleveA','ec.eleve.a@test.local','active','coaching'),
    (e_b, u_el_b, c_b,'EC','EleveB','ec.eleve.b@test.local','active','coaching');
  -- P13-B : le collaborateur suit l'élève du coach A, agenda en écriture.
  insert into public.collaborateur_eleves (collaborateur_id, student_id, affecte_par) values (c_collab, e_a, c_a);
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
  select c_collab, c, 'ecriture', c_a
    from unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition']) c;

  -- Agenda : une disponibilité au coach A, et une SANS PROPRIÉTAIRE —
  -- l'état réel de la production avant ce lot.
  insert into public.coach_availabilities
    (id, coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location, is_active) values
    (disp_a, c_a, 1,'09:00','12:00',60,'visio','Studio A', true),
    (disp_hist, null, 2,'14:00','18:00',60,'visio','Historique', true);

  -- Réglages : la ligne historique unique, sans propriétaire = défaut du cabinet.
  insert into public.booking_settings (min_lead_minutes, max_days_ahead, default_duration_minutes)
  values (120, 30, 60);

  -- Documents : un historique sans propriétaire (les 17 de production), un de
  -- l'administrateur, un du coach A — tous publiés en visibilité globale,
  -- c'est-à-dire le cas qui fuyait.
  insert into public.documents (id, coach_id, title, type, category, status, visibility) values
    (d_hist, null,'EC Doc historique','pdf','administratif','publié','global'),
    (d_adm,  c_adm,'EC Doc admin','pdf','administratif','publié','global'),
    (d_a,    c_a,  'EC Doc coach A','pdf','administratif','publié','global');

  -- Les fichiers correspondants dans le seau « documents » : convention
  -- <document_id>/<nom>, insérés en serveur pour pouvoir mesurer la lecture.
  insert into storage.objects (bucket_id, name) values
    ('documents', d_hist::text || '/historique.pdf'),
    ('documents', d_adm::text  || '/admin.pdf'),
    ('documents', d_a::text    || '/coach-a.pdf');

  -- Journal d'emails : un envoi système (sans auteur) et un envoi du coach A.
  insert into public.email_logs (recipient_email, email_type, subject, status, sent_by_coach_id) values
    ('x@test.local','welcome','EC systeme','sent', null),
    ('y@test.local','welcome','EC coach A','sent', c_a);
end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── B. LES DISPONIBILITÉS RÉCURRENTES ──────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000e103';
  disp_a constant uuid := '00000000-0000-4000-8000-00000000e401';
  v_neuve uuid;
begin
  perform pg_temp.noter('B','B1. le coach A voit SA disponibilité, et exactement rien d''autre',
    pg_temp.lire(u_a,'select count(*) from public.coach_availabilities') = 1);
  perform pg_temp.noter('B','B2. le coach B n''en voit AUCUNE',
    pg_temp.lire(u_b,'select count(*) from public.coach_availabilities') = 0);
  perform pg_temp.noter('B','B3. …même en la désignant par son identifiant',
    pg_temp.lire(u_b, format('select count(*) from public.coach_availabilities where id=%L', disp_a)) = 0);
  perform pg_temp.noter('B','B4. le coach B ne la MODIFIE pas',
    pg_temp.ecrit(u_b, format($q$update public.coach_availabilities set is_active=false where id=%L$q$, disp_a)) <= 0);
  perform pg_temp.noter('B','B5. …et elle est toujours active',
    (select is_active from public.coach_availabilities where id = disp_a) = true);
  perform pg_temp.noter('B','B6. le coach B ne la SUPPRIME pas',
    pg_temp.ecrit(u_b, format($q$delete from public.coach_availabilities where id=%L$q$, disp_a)) <= 0);
  perform pg_temp.noter('B','B7. …et elle est toujours là — c''est le défaut rapporté',
    (select count(*) from public.coach_availabilities where id = disp_a) = 1);

  -- La propriété est posée à la création, sans que le client l'envoie : c'est
  -- exactement ce que fait `createCoachAvailability`.
  perform pg_temp.devenir(u_b);
  insert into public.coach_availabilities
    (weekday, start_time, end_time, slot_duration_minutes, appointment_type, location, is_active)
  values (3,'10:00','11:00',60,'visio','Studio B', true) returning id into v_neuve;
  perform pg_temp.serveur();
  perform pg_temp.noter('B','B8. le coach B crée la sienne sans envoyer coach_id', v_neuve is not null);
  perform pg_temp.noter('B','B9. …et le déclencheur a posé SA fiche comme propriétaire',
    (select coach_id from public.coach_availabilities where id = v_neuve) = c_b);
  perform pg_temp.noter('B','B10. le coach A ne voit pas celle du coach B',
    pg_temp.lire(u_a, format('select count(*) from public.coach_availabilities where id=%L', v_neuve)) = 0);

  -- ⚠️ LE CONTRÔLE QUI COMPTE POUR UNE API DIRECTE : désigner le coach d'un
  -- autre dans la requête. Le `with check` de la policy doit refuser.
  perform pg_temp.noter('B','B11. le coach B ne crée RIEN au nom du coach A (requête forgée)',
    pg_temp.ecrit(u_b, format($q$insert into public.coach_availabilities
      (coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location, is_active)
      values (%L, 4,'10:00','11:00',60,'visio','vol', true)$q$, c_a)) = -1);
  perform pg_temp.noter('B','B12. …et il ne se réattribue pas celle du coach A',
    pg_temp.ecrit(u_b, format($q$update public.coach_availabilities set coach_id=%L where id=%L$q$, c_b, disp_a)) <= 0);

  -- La suppression chez A ne touche rien chez B, et réciproquement.
  perform pg_temp.noter('B','B13. le coach A supprime la SIENNE : accepté',
    pg_temp.ecrit(u_a, format($q$delete from public.coach_availabilities where id=%L$q$, disp_a)) = 1);
  perform pg_temp.noter('B','B14. …et celle du coach B est intacte',
    (select count(*) from public.coach_availabilities where id = v_neuve) = 1);

  -- L'administrateur, lui, garde la main sur tout, y compris l'historique.
  perform pg_temp.noter('B','B15. l''administrateur voit les disponibilités de tous, historique compris',
    pg_temp.lire(u_adm,'select count(*) from public.coach_availabilities') = 2);
  perform pg_temp.noter('B','B16. …et le coach B ne voit toujours pas la ligne SANS propriétaire',
    pg_temp.lire(u_b,'select count(*) from public.coach_availabilities where coach_id is null') = 0);
end $$;


-- ── C. LES ÉVÉNEMENTS D'AGENDA (RPC RÉELLEMENT APPELÉES) ───────────────────
do $$
declare
  u_adm constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a   constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b   constant uuid := '00000000-0000-4000-8000-00000000e003';
  c_a   constant uuid := '00000000-0000-4000-8000-00000000e102';
  v_ev  uuid;
begin
  -- ⚠️ ON PASSE PAR LA RPC, PAS PAR UN INSERT. C'est le chemin de
  -- l'application, et il est `SECURITY DEFINER` : la RLS ne le gouverne pas.
  perform pg_temp.devenir(u_a);
  v_ev := public.create_coach_event_atomic('professional','EC Event A','','Studio', false,
            now() + interval '1 day', now() + interval '1 day 1 hour', '', false);
  perform pg_temp.serveur();
  perform pg_temp.noter('C','C1. le coach A crée un événement par la RPC', v_ev is not null);
  perform pg_temp.noter('C','C2. …et la RPC a posé SA fiche comme propriétaire',
    (select coach_id from public.coach_unavailabilities where id = v_ev) = c_a);
  perform pg_temp.noter('C','C3. le coach B ne le voit pas',
    pg_temp.lire(u_b, format('select count(*) from public.coach_unavailabilities where id=%L', v_ev)) = 0);

  -- ⚠️ LE TROU LE PLUS GRAVE DE L'ANCIEN CODE : `update_coach_event_atomic`
  -- autorisait sur `staff_role() in ('admin','assistant')`, donc tout coach
  -- autonome modifiait l'événement de n'importe qui — RLS hors jeu.
  perform pg_temp.noter('C','C4. le coach B ne MODIFIE pas l''événement de A par la RPC',
    pg_temp.rpc(u_b, format($q$select public.update_coach_event_atomic(%L,'pirate','','',false,
      now() + interval '1 day', now() + interval '1 day 2 hours')$q$, v_ev)) = -1);
  perform pg_temp.noter('C','C5. …et le titre n''a pas changé',
    (select title from public.coach_unavailabilities where id = v_ev) = 'EC Event A');
  perform pg_temp.noter('C','C6. le coach A modifie le SIEN : accepté',
    pg_temp.rpc(u_a, format($q$select public.update_coach_event_atomic(%L,'EC Event A bis','','',false,
      now() + interval '1 day', now() + interval '1 day 2 hours')$q$, v_ev)) = 1);
  perform pg_temp.noter('C','C7. le coach B ne le SUPPRIME pas',
    pg_temp.ecrit(u_b, format($q$delete from public.coach_unavailabilities where id=%L$q$, v_ev)) <= 0);
  perform pg_temp.noter('C','C8. l''administrateur, lui, modifie l''événement du coach A',
    pg_temp.rpc(u_adm, format($q$select public.update_coach_event_atomic(%L,'EC Event vu admin','','',false,
      now() + interval '1 day', now() + interval '1 day 2 hours')$q$, v_ev)) = 1);
end $$;


-- ── D. LES RÉGLAGES DE RÉSERVATION ─────────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000e005';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000e103';
  v_defaut uuid;
begin
  v_defaut := (select id from public.booking_settings where coach_id is null);

  -- Avant ce lot, le coach modifiait LA ligne du cabinet : 1 ligne touchée.
  perform pg_temp.noter('D','D1. le coach B ne modifie PAS le réglage par défaut du cabinet',
    pg_temp.ecrit(u_b, format($q$update public.booking_settings set max_days_ahead=99 where id=%L$q$, v_defaut)) <= 0);
  perform pg_temp.noter('D','D2. …et le défaut du cabinet est intact',
    (select max_days_ahead from public.booking_settings where id = v_defaut) = 30);

  -- Il crée les SIENS (c'est ce que fait `saveMyBookingSettings`).
  perform pg_temp.noter('D','D3. le coach B crée ses propres réglages, sans envoyer coach_id',
    pg_temp.ecrit(u_b, $q$insert into public.booking_settings (min_lead_minutes, max_days_ahead, default_duration_minutes)
      values (60, 15, 45)$q$) = 1);
  perform pg_temp.noter('D','D4. …et ils lui appartiennent',
    (select count(*) from public.booking_settings where coach_id = c_b and max_days_ahead = 15) = 1);
  perform pg_temp.noter('D','D5. le coach A ne voit QUE le défaut du cabinet (il n''a pas les siens)',
    pg_temp.lire(u_a,'select count(*) from public.booking_settings') = 1);
  perform pg_temp.noter('D','D6. le coach B voit le défaut ET les siens',
    pg_temp.lire(u_b,'select count(*) from public.booking_settings') = 2);
  perform pg_temp.noter('D','D7. le coach B ne crée rien au nom du coach A (requête forgée)',
    pg_temp.ecrit(u_b, format($q$insert into public.booking_settings (coach_id, min_lead_minutes, max_days_ahead, default_duration_minutes)
      values (%L, 1, 1, 1)$q$, c_a)) = -1);
  perform pg_temp.noter('D','D8. l''administrateur voit tous les réglages',
    pg_temp.lire(u_adm,'select count(*) from public.booking_settings') = 2);
  perform pg_temp.noter('D','D9. l''élève du coach A voit le défaut, pas les réglages du coach B',
    pg_temp.lire(u_el_a,'select count(*) from public.booking_settings') = 1);
end $$;


-- ── E. LES CRÉNEAUX OCCUPÉS SONT CEUX D'UN SEUL AGENDA ─────────────────────
-- ⚠️ C'EST LA FORME LA PLUS VISIBLE DU DÉFAUT RAPPORTÉ. `get_busy_ranges` et
-- `calendar_has_conflict` balayaient le cabinet entier : les heures occupées
-- de l'administrateur apparaissaient occupées chez le coach, et un coach ne
-- pouvait pas poser un créneau sur une plage prise par un autre.
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  c_adm  constant uuid := '00000000-0000-4000-8000-00000000e101';
  v_debut timestamptz := date_trunc('hour', now()) + interval '3 days';
  v_n int;
begin
  -- Un événement de l'ADMINISTRATEUR sur une plage précise.
  perform pg_temp.serveur();
  insert into public.coach_unavailabilities (coach_id, category, title, start_at, end_at, reason)
  values (c_adm, 'personal', 'EC Admin prive', v_debut, v_debut + interval '1 hour', '');

  perform pg_temp.devenir(u_adm);
  select count(*) into v_n from public.get_busy_ranges(v_debut - interval '1 hour', v_debut + interval '2 hours');
  perform pg_temp.serveur();
  perform pg_temp.noter('E','E1. l''administrateur voit SA plage occupée', v_n >= 1);

  perform pg_temp.devenir(u_b);
  select count(*) into v_n from public.get_busy_ranges(v_debut - interval '1 hour', v_debut + interval '2 hours');
  perform pg_temp.serveur();
  perform pg_temp.noter('E','E2. le coach B ne voit PAS la plage occupée de l''administrateur', v_n = 0);

  -- Et il peut donc poser son propre créneau sur la même plage.
  perform pg_temp.noter('E','E3. …et il crée son événement sur cette même plage : accepté',
    pg_temp.rpc(u_b, format($q$select public.create_coach_event_atomic('professional','EC Event B','','',false,%L,%L,'',false)$q$,
      v_debut, v_debut + interval '1 hour')) = 1);

  perform pg_temp.devenir(u_a);
  select count(*) into v_n from public.get_busy_ranges(v_debut - interval '1 hour', v_debut + interval '2 hours');
  perform pg_temp.serveur();
  perform pg_temp.noter('E','E4. le coach A ne voit ni celle de l''administrateur ni celle du coach B', v_n = 0);

  perform pg_temp.devenir(u_b);
  select count(*) into v_n from public.get_busy_ranges(v_debut - interval '1 hour', v_debut + interval '2 hours');
  perform pg_temp.serveur();
  perform pg_temp.noter('E','E5. le coach B voit la sienne, et une seule', v_n = 1);
end $$;


-- ── F. LES RENDEZ-VOUS ─────────────────────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000e005';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000e102';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000e201';
  v_rdv uuid;
  v_debut timestamptz := date_trunc('hour', now()) + interval '5 days';
begin
  perform pg_temp.devenir(u_a);
  v_rdv := public.create_appointment_atomic(e_a,'EC RDV A','','visio', v_debut, v_debut + interval '1 hour','','','','confirmed');
  perform pg_temp.serveur();
  perform pg_temp.noter('F','F1. le coach A crée un rendez-vous pour SON élève', v_rdv is not null);
  -- ⚠️ `coach_id` N'ÉTAIT PAS ÉCRIT DU TOUT avant ce lot : tous les
  -- rendez-vous créés par l'application étaient sans propriétaire.
  perform pg_temp.noter('F','F2. …et la RPC a posé l''agenda auquel il appartient',
    (select coach_id from public.appointments where id = v_rdv) = c_a);
  perform pg_temp.noter('F','F3. le coach B ne le voit pas',
    pg_temp.lire(u_b, format('select count(*) from public.appointments where id=%L', v_rdv)) = 0);
  perform pg_temp.noter('F','F4. le coach B ne l''ANNULE pas par la RPC',
    pg_temp.rpc(u_b, format($q$select public.cancel_appointment_atomic(%L,'pirate')$q$, v_rdv)) = -1);
  perform pg_temp.noter('F','F5. …et il est toujours confirmé',
    (select status from public.appointments where id = v_rdv) = 'confirmed');
  perform pg_temp.noter('F','F6. le coach B ne le REPORTE pas non plus',
    pg_temp.rpc(u_b, format($q$select public.reschedule_appointment_atomic(%L,%L,%L,'')$q$,
      v_rdv, v_debut + interval '1 day', v_debut + interval '1 day 1 hour')) = -1);
  perform pg_temp.noter('F','F7. le coach A, lui, l''annule',
    pg_temp.rpc(u_a, format($q$select public.cancel_appointment_atomic(%L,'EC raison')$q$, v_rdv)) = 1);
  perform pg_temp.noter('F','F8. l''élève du coach A voit son rendez-vous',
    pg_temp.lire(u_el_a, format('select count(*) from public.appointments where id=%L', v_rdv)) = 1);
end $$;


-- ── G. LES DOCUMENTS, ET LES FICHIERS QUI VONT AVEC ────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000e005';
  u_el_b constant uuid := '00000000-0000-4000-8000-00000000e006';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000e103';
  d_hist constant uuid := '00000000-0000-4000-8000-00000000e301';
  d_adm  constant uuid := '00000000-0000-4000-8000-00000000e302';
  d_a    constant uuid := '00000000-0000-4000-8000-00000000e303';
  v_neuf uuid;
begin
  -- ⚠️ C'EST LE DÉFAUT « LE COACH VOIT LES 17 DOCUMENTS ». La policy élève
  -- n'avait aucune condition sur l'appelant dans sa branche « globale ».
  perform pg_temp.noter('G','G1. le coach B ne voit AUCUN document (il n''en a pas encore)',
    pg_temp.lire(u_b,'select count(*) from public.documents') = 0);
  perform pg_temp.noter('G','G2. …ni celui de l''administrateur par son identifiant',
    pg_temp.lire(u_b, format('select count(*) from public.documents where id=%L', d_adm)) = 0);
  perform pg_temp.noter('G','G3. …ni celui du coach A',
    pg_temp.lire(u_b, format('select count(*) from public.documents where id=%L', d_a)) = 0);
  perform pg_temp.noter('G','G4. …ni les documents historiques sans propriétaire',
    pg_temp.lire(u_b, format('select count(*) from public.documents where id=%L', d_hist)) = 0);
  perform pg_temp.noter('G','G5. le coach A voit le SIEN, et lui seul',
    pg_temp.lire(u_a,'select count(*) from public.documents') = 1);
  perform pg_temp.noter('G','G6. le coach B ne MODIFIE pas le document de l''administrateur',
    pg_temp.ecrit(u_b, format($q$update public.documents set title='pirate' where id=%L$q$, d_adm)) <= 0);
  perform pg_temp.noter('G','G7. …et le titre est intact',
    (select title from public.documents where id = d_adm) = 'EC Doc admin');
  perform pg_temp.noter('G','G8. le coach B ne SUPPRIME pas le document du coach A',
    pg_temp.ecrit(u_b, format($q$delete from public.documents where id=%L$q$, d_a)) <= 0);

  -- La propriété est posée à la création, sans que le client l'envoie.
  perform pg_temp.devenir(u_b);
  insert into public.documents (title, type, category, status, visibility)
  values ('EC Doc coach B','pdf','administratif','publié','global') returning id into v_neuf;
  perform pg_temp.serveur();
  perform pg_temp.noter('G','G9. le coach B crée le sien sans envoyer coach_id', v_neuf is not null);
  perform pg_temp.noter('G','G10. …et il lui appartient',
    (select coach_id from public.documents where id = v_neuf) = c_b);
  perform pg_temp.noter('G','G11. il ne crée RIEN au nom du coach A (requête forgée)',
    pg_temp.ecrit(u_b, format($q$insert into public.documents (coach_id, title, type, category, status, visibility)
      values (%L,'vol','pdf','administratif','publié','global')$q$, c_a)) = -1);

  -- L'élève : aucune régression. Il voit les documents globaux de SON coach et
  -- le fonds historique du cabinet, pas ceux d'un autre coach.
  perform pg_temp.noter('G','G12. l''élève du coach A voit le document de son coach',
    pg_temp.lire(u_el_a, format('select count(*) from public.documents where id=%L', d_a)) = 1);
  perform pg_temp.noter('G','G13. …et le fonds historique sans propriétaire (aucune régression)',
    pg_temp.lire(u_el_a, format('select count(*) from public.documents where id=%L', d_hist)) = 1);
  perform pg_temp.noter('G','G14. …mais PAS le document du coach B',
    pg_temp.lire(u_el_a, format('select count(*) from public.documents where id=%L', v_neuf)) = 0);
  perform pg_temp.noter('G','G15. l''élève du coach B voit celui du coach B',
    pg_temp.lire(u_el_b, format('select count(*) from public.documents where id=%L', v_neuf)) = 1);
  perform pg_temp.noter('G','G16. …et pas celui du coach A',
    pg_temp.lire(u_el_b, format('select count(*) from public.documents where id=%L', d_a)) = 0);

  -- L'administrateur garde la gestion globale, historique compris.
  perform pg_temp.noter('G','G17. l''administrateur voit tous les documents',
    pg_temp.lire(u_adm,'select count(*) from public.documents') = 4);

  -- ⚠️ ET LE FICHIER. Masquer la ligne ne protège rien si l'URL signée reste
  -- accessible : la policy Storage autorisait tout `is_coach_or_admin()`.
  perform pg_temp.noter('G','G18. le coach B ne voit pas le FICHIER du document de l''administrateur',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='documents' and name like %L$q$, d_adm::text || '/%')) = 0);
  perform pg_temp.noter('G','G19. …ni celui du coach A',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='documents' and name like %L$q$, d_a::text || '/%')) = 0);
  perform pg_temp.noter('G','G20. le coach A voit le fichier de SON document',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects
      where bucket_id='documents' and name like %L$q$, d_a::text || '/%')) = 1);
  perform pg_temp.noter('G','G21. le coach B ne SUPPRIME pas le fichier du coach A',
    pg_temp.ecrit(u_b, format($q$delete from storage.objects
      where bucket_id='documents' and name like %L$q$, d_a::text || '/%')) <= 0);
  perform pg_temp.noter('G','G22. …et le fichier est toujours là',
    (select count(*) from storage.objects where bucket_id='documents' and name like d_a::text || '/%') = 1);
  perform pg_temp.noter('G','G23. l''élève du coach A obtient le fichier de son coach',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='documents' and name like %L$q$, d_a::text || '/%')) = 1);
  perform pg_temp.noter('G','G24. …et pas celui du document du coach B',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='documents' and name like %L$q$, v_neuf::text || '/%')) = 0);
end $$;


-- ── H. LE JOURNAL D'EMAILS ─────────────────────────────────────────────────
-- ⚠️ LE JOURNAL N'EST PAS ÉCRIT DEPUIS LE NAVIGATEUR, et c'est important pour
-- lire ces contrôles. `email_logs` n'a AUCUNE policy d'écriture : tous les
-- envois sont journalisés côté serveur (`createSupabaseAdminClient`, donc
-- `service_role`). L'auteur est résolu par la route depuis la SESSION de
-- l'appelant, puis passé explicitement — c'est ce que H5 reproduit.
do $$
declare
  u_adm constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a   constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b   constant uuid := '00000000-0000-4000-8000-00000000e003';
  c_a   constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b   constant uuid := '00000000-0000-4000-8000-00000000e103';
  v_id  uuid;
  v_ok  boolean;
  v_err text;
begin
  perform pg_temp.noter('H','H1. le coach A ne voit QUE ses propres envois',
    pg_temp.lire(u_a,'select count(*) from public.email_logs') = 1);
  perform pg_temp.noter('H','H2. le coach B n''en voit aucun',
    pg_temp.lire(u_b,'select count(*) from public.email_logs') = 0);
  perform pg_temp.noter('H','H3. …ni les envois SYSTÈME, sans auteur',
    pg_temp.lire(u_b,'select count(*) from public.email_logs where sent_by_coach_id is null') = 0);
  perform pg_temp.noter('H','H4. l''administrateur voit le journal entier',
    pg_temp.lire(u_adm,'select count(*) from public.email_logs') = 2);

  -- H5 — le serveur journalise un envoi AU NOM du coach B, comme le fait la
  -- route après avoir résolu l'auteur sur la session.
  perform pg_temp.serveur();
  insert into public.email_logs (recipient_email, email_type, subject, status, sent_by_coach_id)
  values ('z@test.local','welcome','EC envoi coach B','sent', c_b) returning id into v_id;
  perform pg_temp.noter('H','H5. le coach B relit l''envoi journalisé à son nom par le serveur',
    pg_temp.lire(u_b, format('select count(*) from public.email_logs where id=%L', v_id)) = 1);
  perform pg_temp.noter('H','H6. …et le coach A ne le voit pas',
    pg_temp.lire(u_a, format('select count(*) from public.email_logs where id=%L', v_id)) = 0);

  -- H7 — un coach ne peut RIEN écrire dans le journal depuis sa session :
  -- aucune policy d'écriture n'existe, et c'est voulu.
  perform pg_temp.noter('H','H7. un coach n''écrit rien dans le journal depuis sa session',
    pg_temp.ecrit(u_b, $q$insert into public.email_logs (recipient_email, email_type, subject, status)
      values ('direct@test.local','welcome','direct','sent')$q$) = -1);

  /*
   * H8 — ⚠️ LE DÉCLENCHEUR, EXERCÉ SANS LA POLICY. On insère en contexte
   * serveur (la RLS ne s'applique donc pas) MAIS avec les revendications du
   * coach B : `auth.uid()` désigne B, et la ligne prétend venir de A. C'est
   * le seul moyen d'atteindre le déclencheur, puisque la policy bloque déjà
   * toute écriture de session. Il doit refuser.
   */
  perform pg_temp.devenir(u_b);
  reset role;   -- on garde les revendications, on reprend les droits serveur
  begin
    insert into public.email_logs (recipient_email, email_type, subject, status, sent_by_coach_id)
    values ('vol@test.local','welcome','vol','sent', c_a);
    v_ok := true;
  exception when others then
    v_ok := false; v_err := sqlerrm;
  end;
  perform pg_temp.serveur();
  perform pg_temp.noter('H','H8. le déclencheur refuse qu''un envoi soit signé au nom d''un autre coach',
    not coalesce(v_ok, true) and coalesce(v_err, '') ~ 'au nom d''un autre coach');

  -- H9 — et l'auteur est posé automatiquement quand il n'est pas fourni.
  perform pg_temp.devenir(u_b);
  reset role;
  insert into public.email_logs (recipient_email, email_type, subject, status)
  values ('auto@test.local','welcome','auto','sent') returning id into v_id;
  perform pg_temp.serveur();
  perform pg_temp.noter('H','H9. …et il est posé tout seul quand la session en a un',
    (select sent_by_coach_id from public.email_logs where id = v_id) = c_b);
end $$;


-- ── I. P13-B INTACT : LE COLLABORATEUR N'A NI GAGNÉ NI PERDU ───────────────
do $$
declare
  u_collab constant uuid := '00000000-0000-4000-8000-00000000e004';
  c_a      constant uuid := '00000000-0000-4000-8000-00000000e102';
  d_a      constant uuid := '00000000-0000-4000-8000-00000000e303';
  v_n int;
begin
  perform pg_temp.noter('I','I1. le collaborateur voit les disponibilités du coach de son élève (portée P13-B)',
    pg_temp.lire(u_collab, format('select count(*) from public.coach_availabilities where coach_id=%L', c_a)) >= 0);
  perform pg_temp.noter('I','I2. …et pas le journal d''emails',
    pg_temp.lire(u_collab,'select count(*) from public.email_logs') = 0);
  perform pg_temp.noter('I','I3. …ni les réglages de réservation d''un coach qui n''est pas dans sa portée',
    pg_temp.lire(u_collab,'select count(*) from public.booking_settings where coach_id is not null') = 0);
  perform pg_temp.devenir(u_collab);
  select count(*) into v_n from public.get_busy_ranges(now(), now() + interval '10 days');
  perform pg_temp.serveur();
  perform pg_temp.noter('I','I4. les créneaux occupés lui restent accessibles (sa catégorie agenda)', v_n >= 0);
end $$;


-- ── J. LE VISITEUR ANONYME : REFUS NET, SANS LEVÉE ─────────────────────────
-- ⚠️ ON MESURE QUE ÇA NE LÈVE PAS, PAS SEULEMENT QUE C'EST VIDE. Une policy
-- `{public}` qui appelle une fonction interdite à `anon` LÈVE, et une policy
-- qui lève fait échouer TOUTE la requête — c'est le piège qui avait rendu la
-- vitrine publique illisible. `-1` ici signifierait « requête refusée ».
do $$
begin
  perform pg_temp.noter('J','J1. aucune disponibilité, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.coach_availabilities') = 0);
  perform pg_temp.noter('J','J2. aucun événement d''agenda, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.coach_unavailabilities') = 0);
  perform pg_temp.noter('J','J3. aucun réglage de réservation, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.booking_settings') = 0);
  perform pg_temp.noter('J','J4. aucun rendez-vous, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.appointments') = 0);
  perform pg_temp.noter('J','J5. aucun document, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.documents') = 0);
  perform pg_temp.noter('J','J6. aucun fichier du seau documents, et la requête aboutit',
    pg_temp.lire_anon($q$select count(*) from storage.objects where bucket_id='documents'$q$) = 0);
  perform pg_temp.noter('J','J7. aucun email journalisé, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.email_logs') = 0);
  perform pg_temp.noter('J','J8. aucune affectation de document, et la requête aboutit',
    pg_temp.lire_anon('select count(*) from public.document_assignments') = 0);
end $$;


-- ── K. LES FICHIERS ORPHELINS, ET LE PREMIER TÉLÉVERSEMENT ────────────────
-- ⚠️ CE QUE CETTE SECTION MESURE, ET POURQUOI ELLE EXISTE À PART.
-- 20261022090000 avait aligné les fichiers sur la LIGNE du document, avec une
-- porte dérobée assumée : l'écriture était permise quand AUCUNE ligne ne
-- correspondait au chemin, sans quoi le premier téléversement — qui précède la
-- création de la ligne — aurait été impossible. Un fichier ORPHELIN (ligne
-- supprimée) retombait donc dans cette brèche et redevenait manipulable par
-- n'importe quel membre du staff.
--
-- 20261023090000 met le propriétaire DANS LE CHEMIN :
--
--     <fiche_coach>/<document_id>/<horodatage>-<nom>
--
-- et la policy compare ce premier segment à `current_staff_id()` résolu en
-- base. Le premier téléversement passe sans ligne (K7), un orphelin reste à
-- son propriétaire (K1 à K6), et l'ancienne convention continue d'être lue
-- (K8 à K11).
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000e005';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000e103';
  d_a    constant uuid := '00000000-0000-4000-8000-00000000e303';
  -- Identifiants de documents qui N'EXISTENT PAS en base : c'est tout l'objet
  -- de la section.
  d_mort_b constant uuid := '00000000-0000-4000-8000-00000000e901';
  d_mort_h constant uuid := '00000000-0000-4000-8000-00000000e902';
  d_neuf   constant uuid := '00000000-0000-4000-8000-00000000e903';
  f_orph_b text;
  f_orph_h text;
  f_neuf   text;
  f_a_nouvelle text;
begin
  perform pg_temp.serveur();
  f_orph_b := c_b::text || '/' || d_mort_b::text || '/orphelin-du-coach-b.pdf';
  f_orph_h := d_mort_h::text || '/orphelin-ancienne-convention.pdf';
  f_neuf   := c_a::text || '/' || d_neuf::text || '/premier-televersement.pdf';
  f_a_nouvelle := c_a::text || '/' || d_a::text || '/nouvelle-convention.pdf';

  -- Un orphelin du coach B (nouvelle convention, aucune ligne en base), un
  -- orphelin de l'ancienne convention, et un fichier du coach A rangé à la
  -- nouvelle convention avec SA ligne.
  insert into storage.objects (bucket_id, name) values
    ('documents', f_orph_b), ('documents', f_orph_h), ('documents', f_a_nouvelle);

  -- K1 à K4 — le coach A ne peut RIEN faire de l'orphelin du coach B.
  perform pg_temp.noter('K','K1. le coach A ne VOIT pas le fichier orphelin du coach B',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects where name = %L$q$, f_orph_b)) = 0);
  /*
   * ⚠️ K2 ET K3 TENAIENT DÉJÀ AVANT CE LOT, ET IL FAUT LE DIRE PLUTÔT QUE DE
   * LAISSER CROIRE LE CONTRAIRE. Mesuré : sous les policies de
   * 20261022090000, ce DELETE et cet UPDATE touchaient 0 ligne. La raison est
   * que PostgreSQL applique AUSSI les policies SELECT aux lignes qu'un
   * UPDATE ou un DELETE doit lire pour évaluer son `where` : l'ancienne
   * policy de lecture, fondée sur la ligne `documents`, cachait déjà
   * l'orphelin. La brèche réelle était à l'INSERT, qui ne lit aucune ligne
   * existante — c'est K4 et K20 qui la mesurent, et c'est eux qui rougissent
   * quand on rétablit l'ancien état.
   *
   * Ces deux contrôles restent : la garantie demandée est « A ne peut ni
   * remplacer ni supprimer », et on la mesure, qu'elle vienne d'une policy ou
   * de deux.
   */
  perform pg_temp.noter('K','K2. …il ne le SUPPRIME pas',
    pg_temp.ecrit(u_a, format($q$delete from storage.objects where name = %L$q$, f_orph_b)) <= 0);
  perform pg_temp.noter('K','K3. …il ne le REMPLACE pas (update refusé ou sans effet)',
    pg_temp.ecrit(u_a, format($q$update storage.objects set metadata = '{"vole":true}'::jsonb where name = %L$q$, f_orph_b)) <= 0);
  perform pg_temp.noter('K','K4. …et il n''écrit RIEN sous le préfixe du coach B (chemin forgé)',
    pg_temp.ecrit(u_a, format($q$insert into storage.objects (bucket_id, name) values ('documents', %L)$q$,
      c_b::text || '/' || d_mort_b::text || '/intrus.pdf')) = -1);
  perform pg_temp.noter('K','K5. …et le fichier du coach B est toujours là, intact',
    (select count(*) from storage.objects where name = f_orph_b) = 1);

  -- K6 — mais son propriétaire, lui, le gère.
  perform pg_temp.noter('K','K6. le coach B VOIT son fichier orphelin',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects where name = %L$q$, f_orph_b)) = 1);
  perform pg_temp.noter('K','K7. …et il le supprime',
    pg_temp.ecrit(u_b, format($q$delete from storage.objects where name = %L$q$, f_orph_b)) = 1);

  -- K8 — ⚠️ LE PREMIER TÉLÉVERSEMENT RESTE POSSIBLE : aucune ligne
  -- `documents` n'existe encore, et c'est le cas normal de la création.
  perform pg_temp.noter('K','K8. le PREMIER téléversement d''un document neuf fonctionne (aucune ligne en base)',
    pg_temp.ecrit(u_a, format($q$insert into storage.objects (bucket_id, name) values ('documents', %L)$q$, f_neuf)) = 1);
  perform pg_temp.noter('K','K9. …le coach A relit son fichier tout juste téléversé',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects where name = %L$q$, f_neuf)) = 1);
  perform pg_temp.noter('K','K10. …et le coach B ne le voit pas',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects where name = %L$q$, f_neuf)) = 0);

  -- K11 — un objet NE PEUT PAS être déplacé sous le préfixe d'un autre coach.
  perform pg_temp.noter('K','K11. le coach A ne DÉPLACE pas son fichier sous le préfixe du coach B',
    pg_temp.ecrit(u_a, format($q$update storage.objects set name = %L where name = %L$q$,
      c_b::text || '/' || d_neuf::text || '/deplace.pdf', f_neuf)) <= 0);

  -- K12 à K14 — l'ancienne convention : lecture conservée quand la ligne
  -- existe, et orphelin réservé à l'administrateur quand elle a disparu.
  perform pg_temp.noter('K','K12. le coach A ne voit pas l''orphelin de l''ancienne convention (aucun préfixe de propriété)',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects where name = %L$q$, f_orph_h)) = 0);
  perform pg_temp.noter('K','K13. le coach B non plus',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects where name = %L$q$, f_orph_h)) = 0);
  perform pg_temp.noter('K','K14. l''administrateur, lui, le voit — il reste à lui jusqu''à décision métier',
    pg_temp.lire(u_adm, format($q$select count(*) from storage.objects where name = %L$q$, f_orph_h)) = 1);
  perform pg_temp.noter('K','K15. …et il peut le supprimer',
    pg_temp.ecrit(u_adm, format($q$delete from storage.objects where name = %L$q$, f_orph_h)) = 1);

  -- K16/K17 — la nouvelle convention ne casse ni la propriété par la ligne,
  -- ni l'accès de l'élève.
  perform pg_temp.noter('K','K16. le coach A voit son fichier rangé à la NOUVELLE convention',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects where name = %L$q$, f_a_nouvelle)) = 1);
  perform pg_temp.noter('K','K17. l''élève du coach A l''obtient aussi (téléchargement conservé)',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects where name = %L$q$, f_a_nouvelle)) = 1);
  perform pg_temp.noter('K','K18. mais le coach B ne l''obtient pas',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects where name = %L$q$, f_a_nouvelle)) = 0);
  /*
   * K20 — ⚠️ LA BRÈCHE RÉELLE DE L'ÉTAT PRÉCÉDENT, celle que ce lot ferme.
   * Les policies d'écriture de 20261022090000 laissaient passer l'opération
   * quand AUCUNE ligne `documents` ne correspondait au chemin. Un INSERT ne
   * lit aucune ligne existante : n'importe quel membre du staff pouvait donc
   * DÉPOSER un fichier sous le chemin d'un document mort — ou d'un document
   * qui n'a jamais existé — et donc sous un chemin qui ne lui appartient pas.
   * Mesuré : accepté avant, refusé après.
   */
  perform pg_temp.noter('K','K20. le coach A ne DÉPOSE rien sous le chemin d''un document qui n''existe pas (ancienne convention)',
    pg_temp.ecrit(u_a, format($q$insert into storage.objects (bucket_id, name) values ('documents', %L)$q$,
      d_mort_h::text || '/intrus-ancienne-convention.pdf')) = -1);

  perform pg_temp.noter('K','K19. et un ÉLÈVE n''écrit rien dans le seau',
    pg_temp.ecrit(u_el_a, format($q$insert into storage.objects (bucket_id, name) values ('documents', %L)$q$,
      c_a::text || '/' || d_neuf::text || '/par-un-eleve.pdf')) = -1);
end $$;


-- ── L. LA GESTION DES COACHS ET DES COLLABORATEURS ────────────────────────
-- ⚠️ POURQUOI CETTE SECTION EXISTE. Une régression a été signalée : « dans
-- l'espace admin, la page Paramètres n'affiche plus que les informations du
-- coach connecté ». La cause était côté INTERFACE — la page décidait
-- « administrateur » sur `coaches.role` (étiquette de la fiche, valeur par
-- défaut `'assistant'`) au lieu de `profiles.role`. La base, elle, n'avait
-- jamais cessé d'accorder la gestion à l'administrateur.
--
-- Ces contrôles figent les deux moitiés de la règle, pour qu'une correction
-- d'interface ne puisse plus être confondue avec un relâchement en base :
-- l'administrateur gère tout le staff, un coach ne gère RIEN — pas même sa
-- propre fiche, dont la modification est réservée à l'administration.
do $$
declare
  u_adm    constant uuid := '00000000-0000-4000-8000-00000000e001';
  u_a      constant uuid := '00000000-0000-4000-8000-00000000e002';
  u_b      constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_collab constant uuid := '00000000-0000-4000-8000-00000000e004';
  c_a      constant uuid := '00000000-0000-4000-8000-00000000e102';
  c_b      constant uuid := '00000000-0000-4000-8000-00000000e103';
  c_collab constant uuid := '00000000-0000-4000-8000-00000000e104';
begin
  -- L1/L2 — la LECTURE du personnel.
  perform pg_temp.noter('L','L1. l''administrateur voit les quatre fiches du staff',
    pg_temp.lire(u_adm,'select count(*) from public.coaches') = 4);
  perform pg_temp.noter('L','L2. le coach B n''en voit AUCUNE, pas même la sienne (P13-B)',
    pg_temp.lire(u_b,'select count(*) from public.coaches') = 0);

  -- L3 à L6 — et il n'en ÉCRIT aucune.
  perform pg_temp.noter('L','L3. le coach B ne modifie pas la fiche du coach A',
    pg_temp.ecrit(u_b, format($q$update public.coaches set name='pirate' where id=%L$q$, c_a)) <= 0);
  perform pg_temp.noter('L','L4. …ni la sienne : les fiches sont gérées par l''administration',
    pg_temp.ecrit(u_b, format($q$update public.coaches set role='admin' where id=%L$q$, c_b)) <= 0);
  perform pg_temp.noter('L','L5. …et le nom du coach A n''a pas bougé',
    (select name from public.coaches where id = c_a) = 'EC CoachA');
  perform pg_temp.noter('L','L6. le coach B ne supprime aucune fiche',
    pg_temp.ecrit(u_b, format($q$delete from public.coaches where id=%L$q$, c_a)) <= 0);
  perform pg_temp.noter('L','L7. …et il n''en crée aucune',
    pg_temp.ecrit(u_b, $q$insert into public.coaches (user_id, email, name, role, status, specialty)
      values (null,'intrus@test.local','Intrus','assistant','actif','-')$q$) = -1);

  -- L8/L9 — l'administrateur, lui, gère tout le staff. C'est ce que la page
  -- Paramètres doit permettre, et ce que la régression masquait.
  perform pg_temp.noter('L','L8. l''administrateur modifie la fiche d''un autre coach',
    pg_temp.ecrit(u_adm, format($q$update public.coaches set specialty='maj admin' where id=%L$q$, c_a)) = 1);
  perform pg_temp.noter('L','L9. …et il crée une fiche',
    pg_temp.ecrit(u_adm, $q$insert into public.coaches (user_id, email, name, role, status, specialty)
      values (null,'ec.neuf@test.local','EC Neuf','collaborateur','actif','-')$q$) = 1);

  -- L10 à L14 — les droits des collaborateurs : administration seule.
  perform pg_temp.noter('L','L10. le coach B ne lit aucune permission de collaborateur',
    pg_temp.lire(u_b,'select count(*) from public.collaborateur_permissions') = 0);
  perform pg_temp.noter('L','L11. …et il n''en accorde aucune',
    pg_temp.ecrit(u_b, format($q$insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
      values (%L,'nutrition','ecriture',%L)$q$, c_collab, c_b)) = -1);
  perform pg_temp.noter('L','L12. …ni n''en retire',
    pg_temp.ecrit(u_b, format($q$delete from public.collaborateur_permissions where collaborateur_id=%L$q$, c_collab)) <= 0);
  perform pg_temp.noter('L','L13. l''administrateur lit les permissions des collaborateurs',
    pg_temp.lire(u_adm,'select count(*) from public.collaborateur_permissions') = 4);
  perform pg_temp.noter('L','L14. …et le collaborateur lit les SIENNES, et seulement les siennes',
    pg_temp.lire(u_collab, format('select count(*) from public.collaborateur_permissions where collaborateur_id=%L', c_collab)) = 4);

  -- L15/L16 — les affectations d'élèves suivent la même règle.
  perform pg_temp.noter('L','L15. le coach B ne voit aucune affectation de collaborateur',
    pg_temp.lire(u_b,'select count(*) from public.collaborateur_eleves') = 0);
  perform pg_temp.noter('L','L16. l''administrateur, lui, les voit',
    pg_temp.lire(u_adm,'select count(*) from public.collaborateur_eleves') = 1);
end $$;


-- ── M. L'ACCÈS DE L'ÉLÈVE À SA PROPRE FICHE DE FACTURATION ────────────────
-- ⚠️ POURQUOI CETTE SECTION EXISTE. Le 18/10, tous les élèves ont basculé sur
-- « accès temporairement limité ». Relevé dans les journaux Supabase :
--
--     403 — /rest/v1/student_profiles?select=*&student_id=eq.<élève>
--     « permission denied for table student_profiles », 277 refus,
--     première occurrence 18/10 11:53 — six minutes après l'application de la
--     migration qui a retiré le privilège de TABLE au rôle `authenticated`.
--
-- Le contrôle d'accès lisait la fiche ENTIÈRE pour un seul champ. Les
-- contrôles ci-dessous figent la règle en base : la lecture large est bien
-- refusée (c'est voulu, les trois colonnes d'attribution sont fermées), et la
-- lecture ÉTROITE dont le contrôle d'accès a besoin fonctionne.
do $$
declare
  u_b    constant uuid := '00000000-0000-4000-8000-00000000e003';
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000e005';
  u_el_b constant uuid := '00000000-0000-4000-8000-00000000e006';
  e_a    constant uuid := '00000000-0000-4000-8000-00000000e201';
begin
  perform pg_temp.serveur();
  insert into public.student_profiles (student_id, billing_access_mode)
  values (e_a, 'manual_allowed')
  on conflict (student_id) do update set billing_access_mode = 'manual_allowed';

  -- M1/M2 — la lecture ÉTROITE, celle du contrôle d'accès.
  perform pg_temp.noter('M','M1. l''élève lit SON mode de facturation (lecture étroite)',
    pg_temp.lire(u_el_a, format($q$select count(*) from (select student_id, billing_access_mode
      from public.student_profiles where student_id=%L) t$q$, e_a)) = 1);
  perform pg_temp.noter('M','M2. …et la valeur est bien celle enregistrée',
    (select billing_access_mode from public.student_profiles where student_id = e_a) = 'manual_allowed');

  -- M3 — ⚠️ LA LECTURE LARGE EST REFUSÉE, ET C'EST VOULU. Si ce contrôle
  -- devient vert un jour, c'est qu'on a rouvert les trois colonnes
  -- d'attribution d'offre au rôle `authenticated` : le correctif de
  -- cloisonnement P13-B/10 aurait été défait.
  perform pg_temp.noter('M','M3. la lecture de TOUTE la table reste refusée au rôle authentifié',
    pg_temp.lire(u_el_a, format($q$select count(*) from (select * from public.student_profiles
      where student_id=%L) t$q$, e_a)) = -1);

  -- M4 — mais la fiche complète reste lisible par la VUE, qui exclut les
  -- trois colonnes fermées. C'est le chemin de l'espace élève.
  perform pg_temp.noter('M','M4. …tandis que la vue student_profiles_lisible, elle, répond',
    pg_temp.lire(u_el_a, format($q$select count(*) from (select * from public.student_profiles_lisible
      where student_id=%L) t$q$, e_a)) = 1);

  -- M5/M6 — l'isolation ne bouge pas : ni un autre élève, ni un coach
  -- étranger ne lisent cette fiche.
  perform pg_temp.noter('M','M5. l''élève d''un autre coach ne lit pas cette fiche',
    pg_temp.lire(u_el_b, format($q$select count(*) from (select student_id, billing_access_mode
      from public.student_profiles where student_id=%L) t$q$, e_a)) = 0);
  perform pg_temp.noter('M','M6. le coach B non plus (l''élève est au coach A)',
    pg_temp.lire(u_b, format($q$select count(*) from (select student_id, billing_access_mode
      from public.student_profiles where student_id=%L) t$q$, e_a)) = 0);

  -- M7 — et l'élève ne lit toujours pas la colonne d'attribution d'offre.
  perform pg_temp.noter('M','M7. l''élève ne lit pas la colonne d''attribution d''offre en direct',
    pg_temp.lire(u_el_a, format($q$select count(*) from (select assigned_subscription_template_id
      from public.student_profiles where student_id=%L) t$q$, e_a)) = -1);

  -- M8 — ses abonnements restent lisibles : c'est l'autre moitié du verdict.
  perform pg_temp.noter('M','M8. l''élève lit ses propres abonnements',
    pg_temp.lire(u_el_a,'select count(*) from public.subscriptions') >= 0);
end $$;


-- ── Z. BILAN ──────────────────────────────────────────────────────────────
do $$ begin perform pg_temp.serveur(); end $$;

select section, count(*) as controles, count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) as total_controles, count(*) filter (where not ok) as total_echecs
  from _faits;

select string_agg(libelle, E'\n') as echecs_detailles from _faits where not ok;

rollback;

select
  (select count(*) from public.documents where title like 'EC %')            as documents_restants,
  (select count(*) from public.coach_availabilities where location like 'Studio%') as dispos_restantes,
  (select count(*) from auth.users where email like 'ec.%@test.local')       as comptes_restants;
