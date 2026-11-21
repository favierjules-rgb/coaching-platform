-- ============================================================================
-- LOT 1 — CHECKLIST SQL : affectation multi-coach
--
-- À exécuter sur un projet de TEST, jamais sur la production. Le fichier
-- s'exécute dans UNE transaction qui finit par ROLLBACK : il ne laisse rien
-- derrière lui, même en cas de succès.
--
-- ⚠️ CE QUE CE HARNAIS NE PROUVE PAS. Il s'exécute avec le rôle propriétaire,
-- qui contourne la RLS. Il vérifie donc les gardes ÉCRITES DANS LA RPC —
-- précisément celles que `SECURITY DEFINER` rend obligatoires, puisque la
-- policy `coach_availabilities_select_eleve` ne protège pas cette lecture. Le
-- cloisonnement par policy se vérifie ailleurs
-- (supabase/tests/p13b_roles_collaborateurs_checklist.sql).
-- ============================================================================
begin;

create or replace function lot1_endosser(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', coalesce(p_user::text, ''), 'role', 'authenticated')::text, true);
end $$;

/*
 * Appelle la RPC et rend soit « OK:<coach_id du rendez-vous créé> », soit
 * « ERR:<message> ». Le rendez-vous créé est supprimé aussitôt : chaque cas
 * repart du même état.
 */
create or replace function lot1_essai(
  p_user uuid, p_eleve_attendu uuid, p_dispo uuid,
  p_start timestamptz, p_end timestamptz,
  p_type text default 'Coaching en salle', p_lieu text default 'X'
) returns text language plpgsql as $$
declare v_id uuid; v_coach uuid; v_type text; v_lieu text; v_eleve uuid;
begin
  perform lot1_endosser(p_user);
  begin
    /*
     * ⚠️ `reserver_creneau_eleve` NE PREND NI ÉLÈVE NI COACH. `p_eleve_attendu`
     * n'est donc PAS transmis : il sert à vérifier, après coup, que le
     * rendez-vous a bien été rattaché à l'élève de la SESSION. C'est la
     * propriété qui ferme le contournement par identité double — et un
     * paramètre qu'on ne peut plus envoyer est un paramètre qu'on ne peut plus
     * falsifier.
     *
     * `p_type` et `p_lieu` ne sont pas transmis non plus : la RPC les prend
     * sur la disponibilité verrouillée. Ils restent dans la signature pour que
     * les cas puissent envoyer n'importe quoi et vérifier que c'est ignoré.
     */
    v_id := public.reserver_creneau_eleve(p_dispo, p_start, p_end, 'lot1-essai');
  exception when others then
    return 'ERR:' || sqlerrm;
  end;
  select coach_id, appointment_type, location, student_id
    into v_coach, v_type, v_lieu, v_eleve
    from public.appointments where id = v_id;
  delete from public.appointments where id = v_id;
  if p_eleve_attendu is not null and v_eleve is distinct from p_eleve_attendu then
    return 'ELEVE-INATTENDU:' || coalesce(v_eleve::text, 'NULL');
  end if;
  return 'OK:' || coalesce(v_coach::text, 'NULL') || '|' || v_type || '|' || v_lieu;
end $$;

/**
 * Chemin STAFF : création manuelle, sans disponibilité. Rend « OK:<coach_id du
 * rendez-vous> » ou « ERR:<message> », et nettoie derrière lui.
 */
create or replace function lot1_essai_staff(
  p_user uuid, p_student uuid, p_debut timestamptz, p_fin timestamptz
) returns text language plpgsql as $$
declare v_id uuid; v_coach uuid;
begin
  perform lot1_endosser(p_user);
  begin
    -- ⚠️ L'APPEL VA DANS UNE VARIABLE, JAMAIS DANS UN `where` : la RPC est
    -- VOLATILE et serait réévaluée par ligne.
    v_id := public.creer_rendez_vous_staff(
      p_student, 'Séance manuelle', '', 'Coaching en salle',
      p_debut, p_fin, 'Salle', '', 'lot1-staff-essai', 'confirmed');
  exception when others then
    return 'ERR:' || sqlerrm;
  end;
  select coach_id into v_coach from public.appointments where id = v_id;
  delete from public.appointments where id = v_id;
  return 'OK:' || coalesce(v_coach::text, 'NULL');
end $$;

/**
 * Chemin ANCIEN : la 10-arguments conservée par M1 en garde-fou. Rend
 * « OK:<coach_id> » ou « ERR:<message> », et nettoie derrière lui.
 *
 * ⚠️ N'EXISTE QUE DANS L'ÉTAT M1. Après M2 la fonction a disparu, et les cas
 * qui l'utilisent sont sautés — voir la détection d'état plus bas.
 */
create or replace function lot1_essai_ancienne(
  p_user uuid, p_student uuid, p_debut timestamptz, p_fin timestamptz
) returns text language plpgsql as $$
declare v_id uuid; v_coach uuid;
begin
  perform lot1_endosser(p_user);
  begin
    -- ⚠️ L'APPEL VA DANS UNE VARIABLE, JAMAIS DANS UN `where` : la RPC est
    -- VOLATILE et serait réévaluée par ligne.
    v_id := public.create_appointment_atomic(
      p_student, 'Séance ancienne', '', 'Coaching en salle',
      p_debut, p_fin, 'Salle', '', 'lot1-ancienne-essai', 'confirmed');
  exception when others then
    return 'ERR:' || sqlerrm;
  end;
  select coach_id into v_coach from public.appointments where id = v_id;
  delete from public.appointments where id = v_id;
  return 'OK:' || coalesce(v_coach::text, 'NULL');
end $$;

do $$
declare
  c_a constant uuid := '53c76658-9560-41c1-9382-6588972271c2';
  /*
   * ⚠️ CETTE CHECKLIST SERT AUX DEUX ÉTAPES DU DÉPLOIEMENT, et elle le dit.
   * Après M1, `create_appointment_atomic` existe encore — réduite à un
   * garde-fou qui délègue. Après M2, elle a disparu. Asserter « zéro
   * signature » dans les deux états rendrait le fichier faux à l'une des deux
   * étapes ; détecter l'état et choisir le bloc documente les deux.
   */
  v_etape_m1 boolean := exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'create_appointment_atomic'
  );
  v_uc uuid := gen_random_uuid(); v_ud uuid := gen_random_uuid();
  v_ucol uuid := gen_random_uuid();
  v_uadmin uuid := gen_random_uuid();
  v_udouble uuid := gen_random_uuid();   -- fiche coaches ET fiche students
  v_uadmin2 uuid := gen_random_uuid();   -- administrateur AVEC fiche students
  v_upur uuid := gen_random_uuid();      -- élève sans aucune autre fiche
  v_uadmin3 uuid := gen_random_uuid();   -- administrateur SANS fiche coaches, AVEC fiche élève
  v_eleve_admin3 uuid;
  v_eleve_double uuid; v_eleve_admin2 uuid; v_eleve_pur uuid; v_coach_double uuid;
  v_c uuid; v_d uuid; v_col uuid;
  v_ue uuid := gen_random_uuid(); v_uf uuid := gen_random_uuid();
  v_eleve_c uuid; v_eleve_d uuid; v_eleve_sans_coach uuid;
  v_ua constant uuid := '11111111-1111-1111-1111-111111111111';
  v_dispo_c uuid; v_dispo_d uuid; v_dispo_inactive uuid; v_dispo_orpheline uuid;
  -- Lundi 23/11/2026, 09:00 Europe/Paris = 08:00Z. Grille de 45 minutes.
  t0 constant timestamptz := '2026-11-23 09:00+01';
  t1 constant timestamptz := '2026-11-23 09:45+01';
  t2 constant timestamptz := '2026-11-23 10:30+01';
  r text; n int; echecs int := 0; v_id uuid;

begin
  -- ── Décor : deux coachs réels, chacun avec son élève et sa disponibilité.
  insert into auth.users (id) values (v_uc), (v_ud), (v_ucol), (v_ue), (v_uf);
  insert into public.coaches (user_id, name, role, status) values (v_uc, 'Coach C', 'admin', 'actif') returning id into v_c;
  insert into public.coaches (user_id, name, role, status) values (v_ud, 'Coach D', 'admin', 'actif') returning id into v_d;
  insert into public.coaches (user_id, name, role, status) values (v_ucol, 'Collab', 'collaborateur', 'actif') returning id into v_col;
  insert into public.profiles (user_id, role) values (v_uc,'coach'), (v_ud,'coach'), (v_ucol,'coach'), (v_ue,'student'), (v_uf,'student');
  insert into public.students (user_id, coach_id, first_name, last_name) values (v_ue, v_c, 'EleveC','T') returning id into v_eleve_c;
  insert into public.students (user_id, coach_id, first_name, last_name) values (v_uf, v_d, 'EleveD','T') returning id into v_eleve_d;
  insert into public.coach_availabilities (coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location)
    values (v_c, 1, '09:00', '12:00', 45, 'Coaching visio', 'Visio C') returning id into v_dispo_c;
  insert into public.coach_availabilities (coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location)
    values (v_d, 1, '09:00', '12:00', 45, 'Bilan mensuel', 'Salle D') returning id into v_dispo_d;
  insert into public.coach_availabilities (coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location, is_active)
    values (v_c, 1, '14:00', '17:00', 45, 'Coaching visio', 'Visio C', false) returning id into v_dispo_inactive;
  insert into public.coach_availabilities (coach_id, weekday, start_time, end_time, slot_duration_minutes, appointment_type, location)
    values (v_c, 1, '18:00', '20:00', 45, 'Coaching visio', 'Visio C') returning id into v_dispo_orpheline;
  -- Orpheline fabriquée APRÈS coup : le trigger refuserait un insert à null
  -- avec une session authentifiée, mais l'historique en contient (5 lignes
  -- mesurées le 15/11/2026). On reproduit donc l'état, pas le chemin.
  update public.coach_availabilities set coach_id = null where id = v_dispo_orpheline;

  -- ── T01 : élève de C sur un créneau de C → coach_id = C, type et lieu
  --         repris de la disponibilité (le navigateur avait envoyé autre chose).
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, t0, t1, 'Autre', 'Falsifié');
  if r <> 'OK:' || v_c::text || '|Coaching visio|Visio C' then
    raise warning 'T01 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T01 ok — coach du créneau, type et lieu de la disponibilité'; end if;

  -- ── T02 : élève de D sur un créneau de D → coach_id = D
  r := lot1_essai(v_uf, v_eleve_d, v_dispo_d, t0, t1);
  if r <> 'OK:' || v_d::text || '|Bilan mensuel|Salle D' then
    raise warning 'T02 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T02 ok — un second coach obtient bien SES rendez-vous'; end if;

  -- ── T03 : élève de C sur le créneau de D → refus
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_d, t0, t1);
  if r not like 'ERR:%calendar_slot_forbidden%' then
    raise warning 'T03 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T03 ok — le créneau d''un autre coach est refusé'; end if;

  -- ── T04 : falsification. La RPC n'a AUCUN paramètre de coach : le seul
  --         canal est l'identifiant de disponibilité, et il est vérifié.
  /*
   * ⚠️ T04 A CHANGÉ DE FORME AVEC LA SÉPARATION DES PARCOURS. Il vérifiait
   * qu'aucun paramètre de coach n'était exposé ; il vérifie maintenant la
   * propriété plus forte qui remplace ce contrôle : `reserver_creneau_eleve`
   * n'expose NI coach NI élève, et l'ancienne RPC ne donne plus accès au
   * chemin sans validation de disponibilité.
   */
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='create_appointment_atomic';
  if v_etape_m1 then
    -- État M1 : exactement UNE signature, la 10-arguments historique.
    if n <> 1 then
      raise warning 'T04a ÉCHEC (M1) : % signature(s) de create_appointment_atomic au lieu d''une', n;
      echecs := echecs + 1;
    else raise notice 'T04a ok (M1) — l''ancienne RPC survit en une seule signature, réduite à un garde-fou'; end if;
  else
    if n <> 0 then
      raise warning 'T04a ÉCHEC (M2) : % signature(s) de create_appointment_atomic subsiste(nt)', n;
      echecs := echecs + 1;
    else raise notice 'T04a ok (M2) — l''ancienne RPC à double intention a disparu'; end if;
  end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='reserver_creneau_eleve'
     and pg_get_function_identity_arguments(p.oid) ~* '(coach|student)';
  if n <> 0 then raise warning 'T04b ÉCHEC : la réservation élève expose une identité en paramètre'; echecs := echecs + 1;
  else raise notice 'T04b ok — la réservation élève n''expose ni coach ni élève'; end if;

  -- ── T05 : créneau sans propriétaire → refus explicite, aucun repli
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_orpheline, '2026-11-23 18:00+01', '2026-11-23 18:45+01');
  if r not like 'ERR:%calendar_slot_unowned%' then
    raise warning 'T05 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T05 ok — créneau sans propriétaire refusé'; end if;

  -- ── T06 : créneau désactivé, puis inexistant
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_inactive, '2026-11-23 14:00+01', '2026-11-23 14:45+01');
  if r not like 'ERR:%calendar_slot_inactive%' then
    raise warning 'T06a ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T06a ok — créneau désactivé refusé'; end if;
  r := lot1_essai(v_ue, v_eleve_c, gen_random_uuid(), t0, t1);
  if r not like 'ERR:%calendar_slot_not_found%' then
    raise warning 'T06b ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T06b ok — créneau inexistant refusé'; end if;
  r := lot1_essai(v_ue, v_eleve_c, null, t0, t1);
  if r not like 'ERR:%calendar_slot_required%' then
    raise warning 'T06c ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T06c ok — un élève sans créneau désigné est refusé'; end if;

  -- ── T07 : horaire hors de la plage, et mauvais jour
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, '2026-11-23 12:00+01', '2026-11-23 12:45+01');
  if r not like 'ERR:%calendar_slot_mismatch%' then
    raise warning 'T07a ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T07a ok — horaire au-delà de end_time refusé'; end if;
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, '2026-11-24 09:00+01', '2026-11-24 09:45+01');
  if r not like 'ERR:%calendar_slot_mismatch%' then
    raise warning 'T07b ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T07b ok — mauvais jour de semaine refusé'; end if;

  -- ── T08 : durée invalide, puis début hors grille
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, t0, '2026-11-23 11:00+01');
  if r not like 'ERR:%calendar_slot_mismatch%' then
    raise warning 'T08a ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T08a ok — durée différente de slot_duration_minutes refusée'; end if;
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, '2026-11-23 09:05+01', '2026-11-23 09:50+01');
  if r not like 'ERR:%calendar_slot_mismatch%' then
    raise warning 'T08b ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T08b ok — début hors grille refusé'; end if;

  -- ── T09 : une indisponibilité du coach bloque SES créneaux
  insert into public.coach_unavailabilities (coach_id, start_at, end_at, reason)
    values (v_c, t0, t1, 'Indisponible');
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, t0, t1);
  if r not like 'ERR:%calendar_conflict%' then
    raise warning 'T09 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T09 ok — indisponibilité du coach bloquante'; end if;

  -- ── T11 : séparation des conflits. Le même horaire reste libre chez D.
  r := lot1_essai(v_uf, v_eleve_d, v_dispo_d, t0, t1);
  if r <> 'OK:' || v_d::text || '|Bilan mensuel|Salle D' then
    raise warning 'T11a ÉCHEC : l''indisponibilité de C bloque D — %', r; echecs := echecs + 1;
  else raise notice 'T11a ok — l''agenda de C ne bloque pas celui de D'; end if;
  delete from public.coach_unavailabilities where coach_id = v_c;

  -- Un rendez-vous confirmé de C bloque C et pas D.
  insert into public.appointments (coach_id, student_id, appointment_type, start_at, end_at, status, ics_uid)
    values (v_c, v_eleve_c, 'Coaching visio', t1, t2, 'confirmed', 'lot1-occupe');
  r := lot1_essai(v_ue, v_eleve_c, v_dispo_c, t1, t2);
  if r not like 'ERR:%calendar_conflict%' then
    raise warning 'T11b ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T11b ok — rendez-vous existant bloque le bon coach'; end if;
  r := lot1_essai(v_uf, v_eleve_d, v_dispo_d, t1, t2);
  if r not like 'OK:' || v_d::text || '%' then
    raise warning 'T11c ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T11c ok — et ne bloque pas l''autre coach'; end if;

  -- ── T12/T15 : création manuelle par le staff, sans disponibilité.
  perform lot1_endosser(v_uc);
  /*
   * ⚠️ L'APPEL VA DANS UNE VARIABLE, JAMAIS DANS UN `where`. La RPC est
   * VOLATILE : écrite en `where id = reserver_creneau_eleve(…)`, elle est
   * réévaluée POUR CHAQUE LIGNE scannée — autant d'insertions, et la seconde
   * échoue en `calendar_conflict`. Erreur commise puis corrigée ici le
   * 15/11/2026 ; la trace reste pour qu'elle ne soit pas refaite.
   */
  begin
    v_id := public.creer_rendez_vous_staff(v_eleve_c, 'Séance ajoutée', '', 'Coaching en salle',
      '2026-11-25 10:00+01', '2026-11-25 11:00+01', 'Salle', '', 'lot1-staff', 'confirmed');
    r := 'OK:' || (select coach_id::text from public.appointments where id = v_id);
  exception when others then r := 'ERR:' || sqlerrm; end;
  if r <> 'OK:' || v_c::text then
    raise warning 'T12 ÉCHEC : la création manuelle du staff est cassée — %', r; echecs := echecs + 1;
  else raise notice 'T12 ok — création manuelle staff pour SON élève : coach titulaire (= l''auteur ici)'; end if;

  -- ── T16 : report. Le nouveau rendez-vous garde le coach de l'original.
  perform lot1_endosser(v_uc);
  begin
    v_id := public.reschedule_appointment_atomic(
      (select id from public.appointments where ics_uid = 'lot1-staff'),
      '2026-11-25 15:00+01', '2026-11-25 16:00+01', 'lot1-report');
    r := 'OK:' || (select coach_id::text from public.appointments where id = v_id);
  exception when others then r := 'ERR:' || sqlerrm; end;
  if r <> 'OK:' || v_c::text then
    raise warning 'T16a ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T16a ok — report : coach conservé'; end if;
  if (select count(*) from public.appointments where ics_uid = 'lot1-staff' and status = 'cancelled') <> 1 then
    raise warning 'T16b ÉCHEC : l''original n''est pas annulé'; echecs := echecs + 1;
  else raise notice 'T16b ok — l''original est annulé, l''historique conservé'; end if;

  -- ── T13 : collaborateur. Sans permission d'écriture sur l'agenda, refus ;
  --          avec permission ET élève affecté, création autorisée.
  insert into public.collaborateur_eleves (collaborateur_id, student_id) values (v_col, v_eleve_c);
  perform lot1_endosser(v_ucol);
  begin
    r := 'OK:' || public.creer_rendez_vous_staff(v_eleve_c, 'Par collab', '', 'Coaching en salle',
      '2026-11-26 10:00+01', '2026-11-26 11:00+01', 'Salle', '', 'lot1-collab', 'confirmed')::text;
  exception when others then r := 'ERR:' || sqlerrm; end;
  if r not like 'ERR:%calendar_not_allowed%' then
    raise warning 'T13a ÉCHEC : un collaborateur sans permission a pu écrire — %', r; echecs := echecs + 1;
  else raise notice 'T13a ok — collaborateur sans permission refusé'; end if;

  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau)
    values (v_col, 'agenda_communication', 'ecriture');

  /*
   * ⚠️ CE CAS ASSERTAIT LE DÉFAUT. Écrit le 15/11/2026, T13b exigeait
   * `coach_id = <le collaborateur>` et s'affichait vert : il figeait l'idée
   * que l'AUTEUR de la saisie devient propriétaire de l'agenda. C'est
   * exactement la règle métier inverse — un collaborateur n'est pas le coach
   * titulaire de l'élève, et une séance saisie par lui doit rester dans
   * l'agenda du coach qui l'animera. L'assertion est donc refaite, pas
   * supprimée : elle vérifie désormais les DEUX choses demandées, l'
   * autorisation ET le propriétaire final.
   */
  r := lot1_essai_staff(v_ucol, v_eleve_c, '2026-11-26 10:00+01', '2026-11-26 11:00+01');
  if r <> 'OK:' || v_c::text then
    raise warning 'T13b ÉCHEC : un collaborateur autorisé doit créer la séance DANS l''agenda du coach titulaire — %', r;
    echecs := echecs + 1;
  else raise notice 'T13b ok — collaborateur autorisé : séance attribuée au coach titulaire, pas à lui'; end if;

  -- ── T18 : et il ne peut rien s'attribuer, même sans élève.
  r := lot1_essai_staff(v_ucol, null, '2026-11-26 14:00+01', '2026-11-26 15:00+01');
  if r not like 'ERR:%calendar_owner_unresolved%' then
    raise warning 'T18 ÉCHEC : un collaborateur ne doit pas pouvoir ouvrir une séance dans un agenda qui n''est pas le sien — %', r;
    echecs := echecs + 1;
  else raise notice 'T18 ok — séance sans élève refusée à un collaborateur (pas d''agenda propre)'; end if;

  -- ── T19 : l'administrateur crée pour l'élève d'un AUTRE coach.
  r := lot1_essai_staff(v_ua, v_eleve_d, '2026-11-27 10:00+01', '2026-11-27 11:00+01');
  if r <> 'OK:' || v_d::text then
    raise warning 'T19 ÉCHEC : la séance doit aller dans l''agenda du coach titulaire (D), pas dans celui de l''administrateur — %', r;
    echecs := echecs + 1;
  else raise notice 'T19 ok — administrateur pour l''élève d''un autre coach : attribuée au coach titulaire'; end if;

  -- ── T20 : séance sans élève par un coach titulaire → son propre agenda.
  r := lot1_essai_staff(v_uc, null, '2026-11-27 14:00+01', '2026-11-27 15:00+01');
  if r <> 'OK:' || v_c::text then
    raise warning 'T20 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T20 ok — séance sans élève : agenda de son auteur, qui en a un'; end if;

  -- ── T21 : élève sans coach titulaire → refus, aucun propriétaire par défaut.
  insert into public.students (first_name, last_name, coach_id) values ('SansCoach', 'T', null)
    returning id into v_eleve_sans_coach;
  r := lot1_essai_staff(v_ua, v_eleve_sans_coach, '2026-11-27 16:00+01', '2026-11-27 17:00+01');
  if r not like 'ERR:%calendar_owner_unresolved%' then
    raise warning 'T21 ÉCHEC : sans coach titulaire, il faut refuser et non choisir — %', r;
    echecs := echecs + 1;
  else raise notice 'T21 ok — élève sans coach titulaire : refus explicite'; end if;

  /*
   * ── T22 : L'ADMINISTRATEUR SANS FICHE `coaches`.
   *
   * ⚠️ CE CAS MANQUAIT, ET IL ÉTAIT CASSÉ. `v_est_staff` ne testait que
   * `current_staff_id() is not null` : un administrateur applicatif
   * (`profiles.role = 'admin'`) sans ligne dans `coaches` basculait dans la
   * branche ÉLÈVE et recevait `calendar_slot_required`, alors que
   * `est_staff_global()` est vrai pour lui et que l'élève est dans son
   * périmètre d'écriture. C'était une régression du lot : la version d'avant
   * acceptait sa création manuelle. Le projet connaît ce profil — le
   * commentaire de `protect_students_ownership_columns` le nomme.
   */
  insert into auth.users (id) values (v_uadmin);
  insert into public.profiles (user_id, role) values (v_uadmin, 'admin');
  perform lot1_endosser(v_uadmin);
  if public.current_staff_id() is not null then
    raise warning 'T22 préparation ÉCHEC : cet administrateur ne doit PAS avoir de fiche coaches';
    echecs := echecs + 1;
  end if;
  if not coalesce(public.is_admin(), false) or not coalesce(public.est_staff_global(), false) then
    raise warning 'T22 préparation ÉCHEC : is_admin/est_staff_global devraient être vrais';
    echecs := echecs + 1;
  end if;
  r := lot1_essai_staff(v_uadmin, v_eleve_c, '2026-11-27 10:00+01', '2026-11-27 11:00+01');
  if r <> 'OK:' || v_c::text then
    raise warning 'T22a ÉCHEC : administrateur sans fiche coaches — attendu le coach titulaire %, obtenu %', v_c, r;
    echecs := echecs + 1;
  else raise notice 'T22a ok — administrateur sans fiche : séance attribuée au coach titulaire'; end if;

  /*
   * Et sans élève, il n'a pas d'agenda à lui : REFUS.
   *
   * ⚠️ LE MOTIF MESURÉ EST `calendar_not_allowed`, PAS
   * `calendar_owner_unresolved`, et c'est l'attente du test qui était fausse.
   * La garde d'autorisation tranche AVANT la logique d'attribution : sa
   * troisième branche exige `p_student_id is null and current_staff_id() is
   * not null`, donc un administrateur sans fiche est écarté dès l'entrée, en
   * 42501. C'est le refus le PLUS strict des deux ; relâcher la garde pour
   * obtenir un nom d'erreur plus joli affaiblirait une garde d'autorisation
   * pour un motif cosmétique. L'issue métier est identique : rien n'est créé,
   * et aucun propriétaire n'est choisi par défaut.
   */
  r := lot1_essai_staff(v_uadmin, null, '2026-11-27 14:00+01', '2026-11-27 15:00+01');
  if r not like 'ERR:%calendar_not_allowed%' then
    raise warning 'T22b ÉCHEC : sans fiche coaches et sans élève, attendu calendar_not_allowed, obtenu %', r;
    echecs := echecs + 1;
  else raise notice 'T22b ok — administrateur sans fiche, séance sans élève : refusé par la garde d''autorisation'; end if;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * T23..T27 — IDENTITÉS DOUBLES ET CLOISONNEMENT DES DEUX PARCOURS
   *
   * ⚠️ RIEN N'INTERDIT À UN COMPTE D'AVOIR LES DEUX FICHES. `coaches.user_id`
   * et `students.user_id` référencent tous deux `auth.users`. Avec une RPC
   * unique et un discriminant serveur, un tel compte entrait dans la branche
   * STAFF même en réservant depuis son espace élève — donc sans validation de
   * jour, d'horaire, de durée, de grille ni de propriétaire du créneau.
   *
   * Les deux RPC ferment cela par construction : `reserver_creneau_eleve`
   * n'accepte pas de rendez-vous sans disponibilité, et
   * `creer_rendez_vous_staff` refuse un non-staff. Ces cas le vérifient.
   * ══════════════════════════════════════════════════════════════════════════
   */
  insert into auth.users (id) values (v_udouble), (v_uadmin2), (v_upur);
  insert into public.profiles (user_id, role)
    values (v_udouble, 'coach'), (v_uadmin2, 'admin'), (v_upur, 'student');
  insert into public.coaches (user_id, name, role, status)
    values (v_udouble, 'Double identite', 'admin', 'actif') returning id into v_coach_double;
  -- Les trois fiches élèves sont rattachées à COACH C : c'est donc la
  -- disponibilité de C qui est légitime pour elles, et celle de D qui ne l'est pas.
  insert into public.students (user_id, coach_id, first_name, last_name)
    values (v_udouble, v_c, 'Double', 'T') returning id into v_eleve_double;
  insert into public.students (user_id, coach_id, first_name, last_name)
    values (v_uadmin2, v_c, 'AdminEleve', 'T') returning id into v_eleve_admin2;
  insert into public.students (user_id, coach_id, first_name, last_name)
    values (v_upur, v_c, 'ElevePur', 'T') returning id into v_eleve_pur;

  -- ── T23 : un compte COACH qui possède aussi une fiche élève.
  perform lot1_endosser(v_udouble);
  if public.current_staff_id() is null or public.current_student_id() is null then
    raise warning 'T23 préparation ÉCHEC : ce compte doit avoir les DEUX identités';
    echecs := echecs + 1;
  end if;

  -- a) Il réserve pour lui-même : traité en ÉLÈVE, créneau de son coach titulaire.
  r := lot1_essai(v_udouble, v_eleve_double, v_dispo_c, t0, t1, 'Autre', 'Falsifié');
  if r <> 'OK:' || v_c::text || '|Coaching visio|Visio C' then
    raise warning 'T23a ÉCHEC : réservation pour soi-même — %', r; echecs := echecs + 1;
  else raise notice 'T23a ok — compte coach + élève : réservation traitée en élève, coach du créneau'; end if;

  -- b) ET IL NE PEUT PAS CONTOURNER : sans disponibilité, refus.
  r := lot1_essai(v_udouble, v_eleve_double, null, t0, t1);
  if r not like 'ERR:%calendar_slot_required%' then
    raise warning 'T23b ÉCHEC : une identité double a contourné le contrôle de disponibilité — %', r;
    echecs := echecs + 1;
  else raise notice 'T23b ok — identité double sans disponibilité : refusée comme tout élève'; end if;

  -- c) Ni réserver chez un coach qui n'est pas le sien.
  r := lot1_essai(v_udouble, v_eleve_double, v_dispo_d, t0, t1);
  if r not like 'ERR:%calendar_slot_forbidden%' then
    raise warning 'T23c ÉCHEC : identité double sur le créneau d''un autre coach — %', r;
    echecs := echecs + 1;
  else raise notice 'T23c ok — identité double : créneau d''un autre coach refusé'; end if;

  -- d) Hors de la grille non plus : la validation complète s'applique.
  r := lot1_essai(v_udouble, v_eleve_double, v_dispo_c, '2026-11-23 09:05+01', '2026-11-23 09:50+01');
  if r not like 'ERR:%calendar_slot_mismatch%' then
    raise warning 'T23d ÉCHEC : identité double hors grille — %', r; echecs := echecs + 1;
  else raise notice 'T23d ok — identité double : validation d''horaire appliquée intégralement'; end if;

  -- ── T24 : un ADMINISTRATEUR qui possède aussi une fiche élève.
  perform lot1_endosser(v_uadmin2);
  if not coalesce(public.is_admin(), false) or public.current_student_id() is null then
    raise warning 'T24 préparation ÉCHEC : administrateur + fiche élève attendus';
    echecs := echecs + 1;
  end if;
  r := lot1_essai(v_uadmin2, v_eleve_admin2, null, t0, t1);
  if r not like 'ERR:%calendar_slot_required%' then
    raise warning 'T24a ÉCHEC : un administrateur avec fiche élève a contourné le contrôle — %', r;
    echecs := echecs + 1;
  else raise notice 'T24a ok — administrateur avec fiche élève : disponibilité exigée'; end if;
  r := lot1_essai(v_uadmin2, v_eleve_admin2, v_dispo_c, t0, t1);
  if r <> 'OK:' || v_c::text || '|Coaching visio|Visio C' then
    raise warning 'T24b ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T24b ok — administrateur avec fiche élève : réservation normale, coach du créneau'; end if;

  -- ── T25 : la RPC de réservation sans disponibilité, pour un élève ordinaire.
  r := lot1_essai(v_upur, v_eleve_pur, null, t0, t1);
  if r not like 'ERR:%calendar_slot_required%' then
    raise warning 'T25 ÉCHEC : %', r; echecs := echecs + 1;
  else raise notice 'T25 ok — réservation sans disponibilité : refusée'; end if;

  -- ── T26 : la RPC MANUELLE appelée par un non-staff.
  r := lot1_essai_staff(v_upur, v_eleve_pur, '2026-11-28 10:00+01', '2026-11-28 11:00+01');
  if r not like 'ERR:%calendar_staff_required%' then
    raise warning 'T26a ÉCHEC : un élève a pu appeler la création manuelle — %', r; echecs := echecs + 1;
  else raise notice 'T26a ok — création manuelle refusée à un non-staff'; end if;
  -- Même refusée pour SA PROPRE fiche élève : c'est la porte élève qui s'applique.
  r := lot1_essai_staff(v_upur, v_eleve_pur, '2026-11-28 14:00+01', '2026-11-28 15:00+01');
  if r not like 'ERR:%calendar_staff_required%' then
    raise warning 'T26b ÉCHEC : un élève a pu se créer une séance hors disponibilité — %', r;
    echecs := echecs + 1;
  else raise notice 'T26b ok — un élève ne se crée pas de séance hors disponibilité'; end if;

  -- ── T27 : la RPC de RÉSERVATION appelée par quelqu'un qui n'est pas élève.
  r := lot1_essai(v_uc, null, v_dispo_c, t0, t1);
  if r not like 'ERR:%calendar_student_required%' then
    raise warning 'T27 ÉCHEC : un staff sans fiche élève a pu appeler la réservation élève — %', r;
    echecs := echecs + 1;
  else raise notice 'T27 ok — réservation élève refusée à qui n''a pas de fiche élève'; end if;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * T28..T32 — L'ANCIENNE RPC PENDANT LA FENÊTRE M1
   *
   * Ces cas ne valent que dans l'état M1 : après M2 la fonction n'existe plus
   * et les appeler lèverait « function does not exist », ce qui ne prouverait
   * rien sur le comportement voulu. Ils sont donc sautés, et le fichier le dit.
   * ══════════════════════════════════════════════════════════════════════════
   */
  if not v_etape_m1 then
    raise notice 'T28..T32 sautés — état M2 : l''ancienne RPC a été retirée (vérifié par T04a)';
  else
    -- ── T28 : élève PUR. Refus attendu : la 10-arguments n'a pas de
    --          disponibilité à valider, donc elle ne doit plus servir à réserver.
    r := lot1_essai_ancienne(v_upur, v_eleve_pur, '2026-11-29 10:00+01', '2026-11-29 11:00+01');
    if r not like 'ERR:%calendar_parcours_obsolete%' then
      raise warning 'T28 ÉCHEC : un élève a pu réserver par l''ancienne RPC — %', r; echecs := echecs + 1;
    else raise notice 'T28 ok — élève pur : ancienne RPC refusée (parcours obsolète)'; end if;

    -- ── T29 : COACH + fiche élève.
    r := lot1_essai_ancienne(v_udouble, v_eleve_double, '2026-11-29 12:00+01', '2026-11-29 13:00+01');
    if r not like 'ERR:%calendar_identite_ambigue%' then
      raise warning 'T29 ÉCHEC : identité double coach+élève acceptée par l''ancienne RPC — %', r;
      echecs := echecs + 1;
    else raise notice 'T29 ok — coach + fiche élève : identité ambiguë refusée'; end if;

    /*
     * ── T30 : ADMINISTRATEUR AVEC FICHE ÉLÈVE ET SANS FICHE `coaches`.
     *
     * ⚠️ LE CAS QUI DÉMASQUE UNE GARDE INCOMPLÈTE. Une garde qui ne testerait
     * que `current_staff_id()` laisserait passer ce profil : il n'a pas de
     * fiche `coaches`, donc `current_staff_id()` rend NULL, et seul
     * `is_admin()` le reconnaît. C'est exactement l'erreur commise dans la
     * première rédaction de cette garde, et celle qu'avait déjà commise le
     * discriminant `v_est_staff` du lot. D'où les trois lectures.
     */
    insert into auth.users (id) values (v_uadmin3);
    insert into public.profiles (user_id, role) values (v_uadmin3, 'admin');
    insert into public.students (user_id, coach_id, first_name, last_name)
      values (v_uadmin3, v_c, 'AdminSansFiche', 'T') returning id into v_eleve_admin3;
    perform lot1_endosser(v_uadmin3);
    if public.current_staff_id() is not null then
      raise warning 'T30 préparation ÉCHEC : ce profil ne doit PAS avoir de fiche coaches';
      echecs := echecs + 1;
    end if;
    if not coalesce(public.is_admin(), false) or public.current_student_id() is null then
      raise warning 'T30 préparation ÉCHEC : is_admin ET fiche élève attendus';
      echecs := echecs + 1;
    end if;
    r := lot1_essai_ancienne(v_uadmin3, v_eleve_admin3, '2026-11-29 14:00+01', '2026-11-29 15:00+01');
    if r not like 'ERR:%calendar_identite_ambigue%' then
      raise warning 'T30 ÉCHEC : administrateur SANS fiche coaches avec fiche élève accepté — %', r;
      echecs := echecs + 1;
    else raise notice 'T30 ok — administrateur sans fiche coaches + fiche élève : identité ambiguë refusée'; end if;

    -- ── T31 : STAFF PUR. Le chemin staff est conservé, et il DÉLÈGUE : le
    --          propriétaire est donc le coach titulaire, pas l'auteur.
    r := lot1_essai_ancienne(v_uc, v_eleve_c, '2026-11-29 16:00+01', '2026-11-29 17:00+01');
    if r <> 'OK:' || v_c::text then
      raise warning 'T31 ÉCHEC : création manuelle staff cassée par le garde-fou — %', r; echecs := echecs + 1;
    else raise notice 'T31 ok — staff pur : ancienne RPC conservée, déléguée, coach titulaire'; end if;

    -- ── T32 : COLLABORATEUR autorisé via l'ancienne RPC → la délégation
    --          applique la même règle d'attribution que la porte staff.
    r := lot1_essai_ancienne(v_ucol, v_eleve_c, '2026-11-29 18:00+01', '2026-11-29 19:00+01');
    if r <> 'OK:' || v_c::text then
      raise warning 'T32 ÉCHEC : la délégation n''applique pas l''attribution au coach titulaire — %', r;
      echecs := echecs + 1;
    else raise notice 'T32 ok — collaborateur par l''ancienne RPC : séance attribuée au coach titulaire'; end if;

    -- ── T32b : et un administrateur créant pour l'élève d'un AUTRE coach
    --           hérite lui aussi de la bonne attribution.
    r := lot1_essai_ancienne(v_ua, v_eleve_d, '2026-11-29 20:00+01', '2026-11-29 21:00+01');
    if r <> 'OK:' || v_d::text then
      raise warning 'T32b ÉCHEC : attendu le coach titulaire D, obtenu %', r; echecs := echecs + 1;
    else raise notice 'T32b ok — administrateur par l''ancienne RPC : coach titulaire de l''élève'; end if;
  end if;

  -- ── T14 : P13-B. Aucune policy d'écriture directe sur appointments.
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='appointments' and cmd <> 'SELECT';
  if n <> 0 then raise warning 'T14 ÉCHEC : % policy(ies) d''écriture directe', n; echecs := echecs + 1;
  else raise notice 'T14 ok — la RPC reste le seul chemin d''écriture'; end if;

  -- ── T17 : plus aucun rendez-vous orphelin, et aucun chemin n'en crée.
  if exists (select 1 from public.appointments where coach_id is null) then
    raise warning 'T17 ÉCHEC : un rendez-vous sans propriétaire subsiste'; echecs := echecs + 1;
  else raise notice 'T17 ok — aucun rendez-vous sans propriétaire'; end if;

  if echecs > 0 then
    raise exception 'LOT1 CHECKLIST : % cas en échec', echecs;
  end if;
  raise notice '════ LOT1 CHECKLIST : tous les cas sont verts ════';
end $$;

rollback;

-- ============================================================================
-- T10 — DEUX ÉLÈVES SIMULTANÉS SUR LE MÊME CRÉNEAU
--
-- Ce cas ne peut pas tenir dans un fichier : il demande DEUX sessions
-- réellement concurrentes. Procédure exécutée le 15/11/2026 sur une base
-- PostgreSQL 16.15 jetable, après application de la migration :
--
--   Session 1 : begin;
--               select reserver_creneau_eleve(<dispo>, <debut>, <fin>, 'uid-1');
--               select pg_sleep(4);          -- garde pg_advisory_xact_lock
--               commit;
--   Session 2 (lancée 1 s plus tard, même créneau, autre élève du même coach) :
--               select reserver_creneau_eleve(<dispo>, <debut>, <fin>, 'uid-2');
--
-- Résultat observé : la session 2 ATTEND le verrou, puis échoue en
-- `calendar_conflict`. Un seul rendez-vous existe à l'arrivée. C'est bien le
-- verrou qui sérialise : sans lui, les deux lectures de conflit auraient eu
-- lieu avant la première insertion et les deux auraient réussi.
-- ============================================================================

-- ============================================================================
-- C1..C5 — MODIFICATION CONCURRENTE DE LA DISPONIBILITÉ
--
-- Même raison que T10 : il faut plusieurs sessions réelles. Procédures
-- exécutées le 15/11/2026 sur un PostgreSQL 16.15 jetable, après application de
-- la migration, avec le décor : coach CC, son élève E1, une disponibilité
-- lundi 09:00-12:00 / 45 min / « Coaching visio » / « Visio C ».
--
-- ── Fenêtre visée : l'élève appelle la RPC et reste bloqué sur
--    `pg_advisory_xact_lock` ; le coach modifie sa plage pendant ce temps.
--
--   Session BLOQUEUR : begin; select pg_advisory_xact_lock(hashtext('calendar_booking'));
--                      select pg_sleep(5); commit;
--   Session RÉSA (t+1s) : select reserver_creneau_eleve(<dispo>,
--                           '2026-11-23 09:00+01','2026-11-23 09:45+01', …);
--   Session MODIF (t+2s) : update public.coach_availabilities set … where id = <dispo>;
--
--   Résultats observés, une ligne par modification appliquée par MODIF :
--
--     is_active = false              → ERROR: calendar_slot_inactive
--     coach_id = <autre coach>       → ERROR: calendar_slot_forbidden
--     start_time/end_time → 14:00-17:00 → ERROR: calendar_slot_mismatch
--     slot_duration_minutes = 60     → ERROR: calendar_slot_mismatch
--     weekday = 4                    → ERROR: calendar_slot_mismatch
--     appointment_type / location    → RÉUSSIT, et le rendez-vous inséré porte
--                                      « Bilan mensuel | Salle neuve » : ce qui
--                                      valide et ce qui écrit viennent bien de
--                                      la MÊME version verrouillée.
--
-- ── C5 : le verrou de ligne est-il tenu jusqu'à la fin de l'insertion ?
--
--   Session RÉSA : begin; select reserver_creneau_eleve(…); select pg_sleep(5); commit;
--   Session MODIF (t+2s) : set lock_timeout = '1500ms';
--                          update public.coach_availabilities set is_active = false where id = <dispo>;
--
--   Résultat observé : « ERROR: canceling statement due to lock timeout », et
--   `pg_locks` montre 1 verrou Share sur `coach_availabilities`. La
--   modification concurrente attend donc bien la fin de la transaction.
--
-- ── Contre-épreuve de l'ORDRE (15/11/2026)
--
--   Variante installée volontairement : validations faites AVANT le verrou,
--   puis relecture `for share` ne revérifiant que existence / is_active /
--   coach_id — c'est la première version de ce lot.
--
--   Résultat observé avec « start_time/end_time → 14:00-17:00 » : la
--   réservation RÉUSSIT sur 09:00, hors de la plage réelle, et insère le type
--   et le lieu d'AVANT le verrou. Le scénario C4a rougit donc bien lorsque la
--   validation des horaires n'est pas répétée après le verrou.
-- ============================================================================

-- ============================================================================
-- R1..R4 — RÉAFFECTATION CONCURRENTE DE L'ÉLÈVE
--
-- Mêmes contraintes que T10 et C1..C5 : plusieurs sessions réelles. Exécuté le
-- 15/11/2026 sur PostgreSQL 16.15, après application de la migration.
--
-- ── QUI PEUT RÉAFFECTER UN ÉLÈVE (relevé en lecture seule sur la base)
--    • `est_staff_global()` — `is_admin()` ou une fiche `coaches` de rôle
--      `admin`/`assistant` —, via les policies UPDATE `students_update_self_or_staff`
--      et « Admin and coach can update students » ;
--    • `service_role` et tout contexte sans `auth.uid()` (cron, migration) :
--      le trigger `protect_students_ownership_columns` sort avant toute garde ;
--    • NI un élève NI un collaborateur : ce même trigger leur réécrit
--      `new.coach_id := old.coach_id`.
--    AUCUNE fonction SQL n'écrit `public.students`, et AUCUNE ne posait de
--    `for share`/`for update` sur `students` ou `coach_availabilities` avant ce
--    lot : `reserver_creneau_eleve` et `creer_rendez_vous_staff` sont seules à verrouiller ces lignes.
--
-- ── R1 : réaffectation TERMINÉE avant la lecture verrouillée
--    Décor : coach CC possède la disponibilité ; l'élève E1 est chez CC.
--    BLOQUEUR tient le verrou consultatif 5 s ; RÉSA appelle la RPC à t+1 s
--    (donc bloquée) ; MODIF réaffecte E1 à t+2 s et valide.
--
--      coach_id → coach qui ne possède PAS la dispo → ERROR: calendar_slot_forbidden
--      coach_id → null                              → ERROR: calendar_slot_forbidden
--      coach_id → propriétaire de la dispo           → RÉUSSIT, rendez-vous
--                                                      attribué à ce propriétaire
--
-- ── R2 : réaffectation DÉMARRANT après l'acquisition du verrou
--    RÉSA : begin; reserver_creneau_eleve(…); pg_sleep(5); commit;
--    MODIF à t+2 s : set lock_timeout='1500ms'; update public.students set coach_id=… ;
--
--      Résultat : « ERROR: canceling statement due to lock timeout ». Deux
--      verrous Share sur `students` sont visibles dans `pg_locks` pendant la
--      transaction — celui du `for share` et celui, en key-share, que prend la
--      clé étrangère `appointments.student_id`. Après le commit de RÉSA, la même
--      réaffectation passe immédiatement : la ligne est tenue, pas bloquée.
--
-- ── R3 : 12 courses réservation / réaffectation
--      9 réservations acceptées, 3 refus `calendar_slot_forbidden`, 0 autre
--      erreur, 0 interblocage. À chaque itération : AUCUN rendez-vous attribué
--      à un coach différent du propriétaire validé.
--
-- ── R4 : interblocage et ordre de verrouillage
--    ORDRE DU PROJET : `coach_availabilities` PUIS `students`.
--
--      Second chemin en ordre INVERSE (update students, puis update
--      coach_availabilities, en concurrence d'une réservation)
--        → interblocage : 1 (`ERROR: deadlock detected`, PostgreSQL annule la
--          transaction fautive ; la réservation aboutit).
--      Même chemin dans l'ORDRE DE LA RPC
--        → interblocage : 0 ; les deux transactions aboutissent, le rendez-vous
--          est attribué au propriétaire de la disponibilité.
--      Scénarios réalistes (réservation vs réaffectation simple, réservation vs
--      modification de disponibilité — aucun chemin applicatif ne prend les
--      deux tables dans la même transaction)
--        → interblocage : 0.
--
--    C'est cette mesure, et non une préférence de style, qui fixe l'ordre.
--    `scripts/tests/affectation-multi-coach.mts` (TEXTE-13) le fige.
-- ============================================================================
