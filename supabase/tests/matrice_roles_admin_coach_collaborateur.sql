-- ════════════════════════════════════════════════════════════════════════════
-- MATRICE DE NON-RÉGRESSION — ADMINISTRATEUR · COACH AUTONOME · COLLABORATEUR
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/matrice_roles_admin_coach_collaborateur.sql
--
-- Pourquoi ce fichier existe EN PLUS de p13b_roles_collaborateurs_checklist.sql :
-- celle-ci prouve ce qu'un collaborateur NE PEUT PAS faire. Elle ne prouvait
-- nulle part ce qu'un ADMINISTRATEUR peut faire — et c'est exactement ce qui
-- s'est cassé sans que rien ne le signale. Une matrice de droits ne se vérifie
-- pas par ses refus seuls : les deux colonnes comptent.
--
-- ⚠️ CINQ ACTEURS, DONT DEUX ADMINISTRATEURS. L'« admin sans fiche » n'est pas
-- un cas d'école : `profiles.role = 'admin'` est LA règle d'identification de
-- l'administrateur dans tout le dépôt, et rien n'oblige ce compte à posséder
-- une ligne `coaches`. C'est précisément lui qui perdait fiches élèves,
-- agenda, nutrition, documents et l'écriture sur les élèves, parce que
-- `categories_lecture()` ne regardait que `coaches.role`
-- (corrigé en 20261019090000).
--
-- ⚠️ UN REFUS REND -1, JAMAIS 0. « La requête a été refusée » et « la requête
-- a tourné et n'a rien trouvé » sont deux résultats différents : les
-- confondre ferait passer un contrôle d'absence pour réussi alors que la
-- lecture n'a même pas pu s'exécuter.

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

/*
 * Une écriture RÉUSSIE rend true. Un refus se manifeste de deux façons —
 * 0 ligne touchée (la RLS a filtré) ou 42501 (un trigger/une policy a levé) —
 * et les deux rendent false. Une violation de contrainte (23xxx) n'est PAS un
 * refus : elle signalerait un décor incohérent, et la faire passer pour un
 * refus masquerait un vrai trou. Elle est donc signalée et rendue false.
 */
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
  u_adm   constant uuid := '00000000-0000-4000-8000-0000000a0001'; -- admin + fiche admin
  u_adsf  constant uuid := '00000000-0000-4000-8000-0000000a0002'; -- admin SANS fiche coaches
  u_coach constant uuid := '00000000-0000-4000-8000-0000000a0003'; -- coach autonome (assistant)
  u_clec  constant uuid := '00000000-0000-4000-8000-0000000a0004'; -- collaborateur LECTURE
  u_cecr  constant uuid := '00000000-0000-4000-8000-0000000a0005'; -- collaborateur ÉCRITURE
  u_el1   constant uuid := '00000000-0000-4000-8000-0000000a0011';
  c_adm   constant uuid := '00000000-0000-4000-8000-0000000a0101';
  c_coach constant uuid := '00000000-0000-4000-8000-0000000a0103';
  c_clec  constant uuid := '00000000-0000-4000-8000-0000000a0104';
  c_cecr  constant uuid := '00000000-0000-4000-8000-0000000a0105';
  e_aff   constant uuid := '00000000-0000-4000-8000-0000000a0201'; -- affecté aux deux collaborateurs
  e_hors  constant uuid := '00000000-0000-4000-8000-0000000a0202'; -- hors périmètre collaborateur
  e_mut   constant uuid := '00000000-0000-4000-8000-0000000a0203'; -- réservé aux mutations de la section C
  p_prog  constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem   constant uuid := '00000000-0000-4000-8000-0000000a0401';
  s_sea   constant uuid := '00000000-0000-4000-8000-0000000a0501';
  t_offre constant uuid := '00000000-0000-4000-8000-0000000a0601';
  n_plan  constant uuid := '00000000-0000-4000-8000-0000000a0701';
  d_doc   constant uuid := '00000000-0000-4000-8000-0000000a0801';
begin
  insert into auth.users (id, email) values
    (u_adm,'mx.adm@test.local'), (u_adsf,'mx.adsf@test.local'), (u_coach,'mx.coach@test.local'),
    (u_clec,'mx.clec@test.local'), (u_cecr,'mx.cecr@test.local'), (u_el1,'mx.el1@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,'mx.adm@test.local','admin','MX','Admin'),
    (u_adsf,'mx.adsf@test.local','admin','MX','AdminSansFiche'),
    (u_coach,'mx.coach@test.local','coach','MX','Coach'),
    (u_clec,'mx.clec@test.local','coach','MX','CollabLecture'),
    (u_cecr,'mx.cecr@test.local','coach','MX','CollabEcriture'),
    (u_el1,'mx.el1@test.local','student','MX','Eleve');
  -- u_adsf n'a VOLONTAIREMENT aucune ligne dans coaches.
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm,  u_adm,  'mx.adm@test.local','MX Admin','admin','actif','-'),
    (c_coach,u_coach,'mx.coach@test.local','MX Coach','assistant','actif','-'),
    (c_clec, u_clec, 'mx.clec@test.local','MX CLec','collaborateur','actif','-'),
    (c_cecr, u_cecr, 'mx.cecr@test.local','MX CEcr','collaborateur','actif','-');
  /*
   * ⚠️ TROIS ÉLÈVES, ET LE TROISIÈME EXISTE POUR UNE RAISON DE MÉTHODE. La
   * section C vérifie que l'administrateur peut RÉAFFECTER un élève et le
   * mettre en pause : appliquées à l'élève partagé, ces mutations le
   * retiraient au coach autonome, et les sections D, E et F échouaient
   * ensuite en cascade sur un décor que C avait déplacé sous leurs pieds.
   * `e_mut` est à elle seule.
   */
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    (e_aff,  u_el1, c_coach,'MX','Affecte','mx.el1@test.local','active','coaching'),
    (e_hors, null,  c_coach,'MX','Hors','mx.el2@test.local','active','coaching'),
    (e_mut,  null,  c_coach,'MX','Mutable','mx.el3@test.local','active','coaching');
  insert into public.collaborateur_eleves (collaborateur_id, student_id, affecte_par) values
    (c_clec, e_aff, c_coach), (c_cecr, e_aff, c_coach);
  -- LES QUATRE CATÉGORIES de part et d'autre : seul le NIVEAU les sépare.
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
  select c_clec, c, 'lecture', c_coach
    from unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition']) c;
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau, accorde_par)
  select c_cecr, c, 'ecriture', c_coach
    from unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition']) c;

  insert into public.programs (id, name, program_mode, is_public, status, coach_id)
  values (p_prog,'MX Prog','individuel',false,'actif',c_coach);
  insert into public.program_weeks (id, program_id, week_number) values (w_sem, p_prog, 1);
  insert into public.workout_sessions (id, program_id, program_week_id, day, name)
  values (s_sea, p_prog, w_sem, 'lundi','MX Seance');
  /*
   * ⚠️ L'ATTRIBUTION D'OFFRE EST POSÉE DANS CET INSERT, et pas par un
   * `on conflict do update` plus bas. Le décor s'exécute en `postgres`, pour
   * qui `staff_role()` est NULL : le déclencheur `protect_access_columns`
   * (BEFORE UPDATE) recopiait l'ancienne valeur — NULL — et le contrôle B17
   * échouait sur un décor muet, pas sur un défaut. Un INSERT, lui, n'est pas
   * couvert par ce déclencheur.
   */
  insert into public.subscription_templates (id, name, amount_cents, currency, billing_interval, is_active, stripe_price_id)
  values (t_offre,'MX Offre', 19900,'eur','monthly', true,'price_mx');
  insert into public.student_profiles
    (student_id, goal, assigned_subscription_template_id, assigned_stripe_plan, assigned_stripe_price_id)
  values (e_aff,'MX objectif', t_offre,'MX Offre','price_mx');
  insert into public.appointments (student_id, coach_id, start_at, end_at, status)
  values (e_aff, c_coach, now() + interval '80 days', now() + interval '80 days 1 hour','confirmed');
  insert into public.nutrition_plans (id, name, student_id, coach_id, status)
  values (n_plan,'MX Plan', e_aff, c_coach,'actif');
  -- ⚠️ `documents` N'A PAS DE `student_id` : la table porte `coach_id` et la
  -- visibilité, et le rattachement à un élève se fait par assignation. Le
  -- premier jet de ce décor l'avait supposé, et la matrice ne démarrait pas.
  insert into public.documents (id, coach_id, title, type, category, status, visibility)
  values (d_doc, c_coach,'MX Doc','pdf','administratif','publié','global');
end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── B. L'ADMINISTRATEUR AVEC FICHE : TOUT ─────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-0000000a0001';
  e_aff  constant uuid := '00000000-0000-4000-8000-0000000a0201';
  p_prog constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem  constant uuid := '00000000-0000-4000-8000-0000000a0401';
  t_offre constant uuid := '00000000-0000-4000-8000-0000000a0601';
begin
  perform pg_temp.devenir(u_adm);
  perform pg_temp.noter('B','B1. is_admin() reconnaît l''administrateur', coalesce(public.is_admin(), false));
  perform pg_temp.noter('B','B2. est_staff_global() est vrai', coalesce(public.est_staff_global(), false));
  reset role;
  perform pg_temp.noter('B','B3. il a les QUATRE catégories en lecture',
    pg_temp.lire(u_adm,'select count(*) from public.categories_lecture()') = 4);
  perform pg_temp.noter('B','B4. et les QUATRE en écriture',
    pg_temp.lire(u_adm,'select count(*) from public.categories_ecriture()') = 4);
  perform pg_temp.noter('B','B5. élèves : il voit les trois',
    pg_temp.lire(u_adm,'select count(*) from public.students') = 3);
  perform pg_temp.noter('B','B6. fiches élèves (suivi_eleve) : lisibles',
    pg_temp.lire(u_adm,'select count(*) from public.student_profiles_lisible') >= 1);
  perform pg_temp.noter('B','B7. programmes : lisibles',
    pg_temp.lire(u_adm,'select count(*) from public.programs') >= 1);
  perform pg_temp.noter('B','B8. agenda (rendez-vous) : lisible',
    pg_temp.lire(u_adm,'select count(*) from public.appointments') >= 1);
  perform pg_temp.noter('B','B9. nutrition : lisible',
    pg_temp.lire(u_adm,'select count(*) from public.nutrition_plans') >= 1);
  perform pg_temp.noter('B','B10. documents : lisibles',
    pg_temp.lire(u_adm,'select count(*) from public.documents') >= 1);
  perform pg_temp.noter('B','B11. PARAMÈTRES (coaches) : lisibles',
    pg_temp.lire(u_adm,'select count(*) from public.coaches') >= 4);
  perform pg_temp.noter('B','B12. ABONNEMENTS (catalogue d''offres) : lisible',
    pg_temp.lire(u_adm,'select count(*) from public.subscription_templates') >= 1);
  perform pg_temp.noter('B','B13. NEWSLETTER : lecture autorisée (0 ligne, mais pas de refus)',
    pg_temp.lire(u_adm,'select count(*) from public.newsletter_subscribers') >= 0);
  perform pg_temp.noter('B','B14. NOTIFICATIONS (campagnes) : lecture autorisée',
    pg_temp.lire(u_adm,'select count(*) from public.notification_campaigns') >= 0);
  perform pg_temp.noter('B','B15. PAIEMENTS : lecture autorisée',
    pg_temp.lire(u_adm,'select count(*) from public.payments') >= 0);
  perform pg_temp.noter('B','B16. EMAILS (journal) : lecture autorisée',
    pg_temp.lire(u_adm,'select count(*) from public.email_logs') >= 0);
  perform pg_temp.noter('B','B17. ATTRIBUTION D''OFFRE de son élève : lisible (facturation)',
    pg_temp.lire(u_adm, format($q$select count(*) from public.attribution_offre_eleve(%L) where offre_nom is not null$q$, e_aff)) = 1);

  -- Écritures : création, modification, assignation, suppression.
  perform pg_temp.noter('B','B18. programmation : INSERT … RETURNING accepté',
    pg_temp.ecrit(u_adm, format($q$insert into public.workout_sessions (program_id, program_week_id, day, name)
      values (%L,%L,'mardi','B18') returning id$q$, p_prog, w_sem)));
  perform pg_temp.noter('B','B19. programmation : UPDATE accepté',
    pg_temp.ecrit(u_adm, format($q$update public.programs set name='B19' where id=%L$q$, p_prog)));
  perform pg_temp.noter('B','B20. fiche élève : UPDATE accepté',
    pg_temp.ecrit(u_adm, format($q$update public.students set first_name='B20' where id=%L$q$, e_aff)));
  perform pg_temp.noter('B','B21. nutrition : UPDATE accepté',
    pg_temp.ecrit(u_adm, $q$update public.nutrition_plans set name='B21' where name='MX Plan'$q$));
  perform pg_temp.noter('B','B22. PARAMÈTRES : création d''un coach acceptée',
    pg_temp.ecrit(u_adm, $q$insert into public.coaches (user_id,email,name,role,status,specialty)
      values (null,'mx.b22@test.local','B22','assistant','actif','-') returning id$q$));
  perform pg_temp.noter('B','B23. ABONNEMENTS : création d''une offre acceptée',
    pg_temp.ecrit(u_adm, $q$insert into public.subscription_templates (name,amount_cents,currency,billing_interval,is_active)
      values ('B23',100,'eur','monthly',true) returning id$q$));
  /*
   * ⚠️ B24 NE DIT PAS « L'ADMIN PEUT CRÉER UNE CAMPAGNE EN SQL », PARCE QUE
   * PERSONNE NE PEUT. `authenticated` n'a que le SELECT sur
   * `notification_campaigns` : la création passe par
   * /api/admin/notifications/campaigns, en `service_role`, derrière
   * `requireStaff()`. Mesuré : un INSERT direct par l'administrateur rend
   * `42501 permission denied for table`. Ce qu'il faut donc vérifier, c'est
   * que la LECTURE lui est ouverte et que le GRANT d'écriture reste fermé —
   * un contrôle qui exigerait l'INSERT échouerait sur une règle saine.
   */
  perform pg_temp.noter('B','B24. NOTIFICATIONS : lecture ouverte à l''administrateur',
    pg_temp.lire(u_adm,'select count(*) from public.notification_campaigns') >= 0);
  perform pg_temp.noter('B','B24b. …et la création reste réservée au serveur (un GRANT, pas une policy)',
    not has_table_privilege('authenticated','public.notification_campaigns','INSERT')
    and has_table_privilege('service_role','public.notification_campaigns','INSERT'));
  perform pg_temp.noter('B','B25. programmation : DELETE accepté',
    pg_temp.ecrit(u_adm, $q$delete from public.workout_sessions where name='B18'$q$));
end $$;


-- ── C. L'ADMINISTRATEUR SANS FICHE `coaches` : STRICTEMENT LA MÊME CHOSE ──
-- ⚠️ C'EST LA RÉGRESSION QUI A COÛTÉ SON ESPACE À L'ADMINISTRATEUR.
-- Avant 20261019090000, ce compte mesurait : categories_lecture = 0,
-- student_profiles = 0, appointments = 0, nutrition_plans = 0, documents = 0,
-- UPDATE students REFUSÉ. `profiles.role = 'admin'` ne suffisait pas parce que
-- `categories_lecture()` ne regardait que `coaches.role`.
do $$
declare
  u_adsf constant uuid := '00000000-0000-4000-8000-0000000a0002';
  e_aff  constant uuid := '00000000-0000-4000-8000-0000000a0201';
  e_mut  constant uuid := '00000000-0000-4000-8000-0000000a0203';
  p_prog constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem  constant uuid := '00000000-0000-4000-8000-0000000a0401';
begin
  perform pg_temp.devenir(u_adsf);
  perform pg_temp.noter('C','C1. admin sans fiche : staff_role() est NULL (le décor est bien celui-là)',
    public.staff_role() is null);
  perform pg_temp.noter('C','C2. mais est_staff_global() reste vrai', coalesce(public.est_staff_global(), false));
  reset role;
  perform pg_temp.noter('C','C3. il retrouve ses QUATRE catégories en lecture',
    pg_temp.lire(u_adsf,'select count(*) from public.categories_lecture()') = 4);
  perform pg_temp.noter('C','C4. et ses QUATRE en écriture',
    pg_temp.lire(u_adsf,'select count(*) from public.categories_ecriture()') = 4);
  perform pg_temp.noter('C','C5. FICHES ÉLÈVES : lisibles (étaient à zéro)',
    pg_temp.lire(u_adsf,'select count(*) from public.student_profiles_lisible') >= 1);
  perform pg_temp.noter('C','C6. AGENDA : lisible (était à zéro)',
    pg_temp.lire(u_adsf,'select count(*) from public.appointments') >= 1);
  perform pg_temp.noter('C','C7. NUTRITION : lisible (était à zéro)',
    pg_temp.lire(u_adsf,'select count(*) from public.nutrition_plans') >= 1);
  perform pg_temp.noter('C','C8. DOCUMENTS : lisibles (étaient à zéro)',
    pg_temp.lire(u_adsf,'select count(*) from public.documents') >= 1);
  perform pg_temp.noter('C','C9. élèves : les trois',
    pg_temp.lire(u_adsf,'select count(*) from public.students') = 3);
  perform pg_temp.noter('C','C10. PARAMÈTRES : lisibles',
    pg_temp.lire(u_adsf,'select count(*) from public.coaches') >= 4);
  perform pg_temp.noter('C','C11. fiche élève : UPDATE accepté (était refusé)',
    pg_temp.ecrit(u_adsf, format($q$update public.students set first_name='C11' where id=%L$q$, e_aff)));
  perform pg_temp.noter('C','C12. programmation : INSERT … RETURNING accepté',
    pg_temp.ecrit(u_adsf, format($q$insert into public.workout_sessions (program_id, program_week_id, day, name)
      values (%L,%L,'mercredi','C12') returning id$q$, p_prog, w_sem)));
  perform pg_temp.noter('C','C13. nutrition : UPDATE accepté',
    pg_temp.ecrit(u_adsf, $q$update public.nutrition_plans set name='C13' where student_id is not null$q$));
  /*
   * ⚠️ LES TROIS OPÉRATIONS QUE LES DÉCLENCHEURS LUI REFUSAIENT EN SILENCE.
   * `protect_students_ownership` et `protect_access_columns` testaient
   * `staff_role() in ('admin','assistant')`, c'est-à-dire l'étiquette de la
   * FICHE. Sans fiche, l'UPDATE rendait « 1 ligne modifiée » et la valeur
   * revenait aussitôt : aucune erreur, aucun message — le défaut le plus
   * coûteux de ce lot, parce qu'il se présentait comme un succès.
   */
  -- `students.status` ∈ {active, paused, completed} : 'pause' violait la
  -- contrainte, et `ecrit()` l'a signalé comme décor incohérent — pas comme
  -- un refus. C'est précisément ce que ce garde-fou sert à éviter.
  perform pg_temp.ecrit(u_adsf, format($q$update public.students set status='paused' where id=%L$q$, e_mut));
  perform pg_temp.noter('C','C15. il met un élève en pause (la valeur CHANGE vraiment)',
    (select status from public.students where id = e_mut) = 'paused');
  perform pg_temp.ecrit(u_adsf, format($q$update public.students set coach_id=%L where id=%L$q$,
    '00000000-0000-4000-8000-0000000a0101'::uuid, e_mut));
  perform pg_temp.noter('C','C16. il réaffecte un élève à un autre coach',
    (select coach_id from public.students where id = e_mut) = '00000000-0000-4000-8000-0000000a0101'::uuid);
  perform pg_temp.ecrit(u_adsf, format($q$update public.student_profiles set assigned_stripe_plan='C17' where student_id=%L$q$, e_aff));
  perform pg_temp.noter('C','C17. il attribue une offre à un élève',
    (select assigned_stripe_plan from public.student_profiles where student_id = e_aff) = 'C17');
  perform pg_temp.noter('C','C14. ABONNEMENTS : création d''une offre acceptée',
    pg_temp.ecrit(u_adsf, $q$insert into public.subscription_templates (name,amount_cents,currency,billing_interval,is_active)
      values ('C14',100,'eur','monthly',true) returning id$q$));
end $$;


-- ── D. LE COACH AUTONOME : SES DROITS HABITUELS, PAS CEUX DE L'ADMIN ──────
do $$
declare
  u_coach constant uuid := '00000000-0000-4000-8000-0000000a0003';
  e_aff   constant uuid := '00000000-0000-4000-8000-0000000a0201';
  p_prog  constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem   constant uuid := '00000000-0000-4000-8000-0000000a0401';
begin
  perform pg_temp.devenir(u_coach);
  perform pg_temp.noter('D','D1. is_admin() est FAUX pour un coach autonome', not coalesce(public.is_admin(), false));
  perform pg_temp.noter('D','D2. est_staff_global() est vrai (coach autonome)', coalesce(public.est_staff_global(), false));
  reset role;
  perform pg_temp.noter('D','D3. ses quatre catégories en lecture',
    pg_temp.lire(u_coach,'select count(*) from public.categories_lecture()') = 4);
  -- ⚠️ DEUX, PAS TROIS : la section C a volontairement réaffecté `e_mut` à
  -- l'administrateur, et le coach autonome ne doit donc plus le voir. Ce
  -- contrôle mesure donc AUSSI que la réaffectation de C16 a eu de l'effet.
  perform pg_temp.noter('D','D4. ses élèves : les deux qui lui restent',
    pg_temp.lire(u_coach,'select count(*) from public.students') = 2);
  perform pg_temp.noter('D','D5. fiches élèves : lisibles',
    pg_temp.lire(u_coach,'select count(*) from public.student_profiles_lisible') >= 1);
  perform pg_temp.noter('D','D6. agenda : lisible',
    pg_temp.lire(u_coach,'select count(*) from public.appointments') >= 1);
  perform pg_temp.noter('D','D7. nutrition : lisible',
    pg_temp.lire(u_coach,'select count(*) from public.nutrition_plans') >= 1);
  perform pg_temp.noter('D','D8. programmation : UPDATE accepté',
    pg_temp.ecrit(u_coach, format($q$update public.programs set name='D8' where id=%L$q$, p_prog)));
  perform pg_temp.noter('D','D9. programmation : INSERT … RETURNING accepté',
    pg_temp.ecrit(u_coach, format($q$insert into public.workout_sessions (program_id, program_week_id, day, name)
      values (%L,%L,'jeudi','D9') returning id$q$, p_prog, w_sem)));
  perform pg_temp.noter('D','D10. fiche élève : UPDATE accepté',
    pg_temp.ecrit(u_coach, format($q$update public.students set first_name='D10' where id=%L$q$, e_aff)));
  -- ⚠️ CE QU'IL N'A PAS, ET NE DOIT PAS RECEVOIR : les surfaces d'administration.
  perform pg_temp.noter('D','D11. PARAMÈTRES (coaches) : AUCUNE ligne — réservé à is_admin()',
    pg_temp.lire(u_coach,'select count(*) from public.coaches') = 0);
  perform pg_temp.noter('D','D12. création d''un coach : REFUSÉE',
    not pg_temp.ecrit(u_coach, $q$insert into public.coaches (user_id,email,name,role,status,specialty)
      values (null,'mx.d12@test.local','D12','assistant','actif','-') returning id$q$));
  perform pg_temp.noter('D','D13. création d''une offre d''abonnement : REFUSÉE',
    not pg_temp.ecrit(u_coach, $q$insert into public.subscription_templates (name,amount_cents,currency,billing_interval,is_active)
      values ('D13',100,'eur','monthly',true) returning id$q$));
  perform pg_temp.noter('D','D14. il ne s''octroie pas de permission de collaborateur',
    not pg_temp.ecrit(u_coach, format($q$insert into public.collaborateur_permissions (collaborateur_id,categorie,niveau,accorde_par)
      values (%L,'entrainement','ecriture',%L) returning id$q$,
      '00000000-0000-4000-8000-0000000a0104'::uuid, '00000000-0000-4000-8000-0000000a0103'::uuid)));
end $$;


-- ── E. LE COLLABORATEUR EN LECTURE : IL VOIT SON ÉLÈVE, IL N'ÉCRIT RIEN ──
do $$
declare
  u_clec constant uuid := '00000000-0000-4000-8000-0000000a0004';
  e_aff  constant uuid := '00000000-0000-4000-8000-0000000a0201';
  e_hors constant uuid := '00000000-0000-4000-8000-0000000a0202';
  p_prog constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem  constant uuid := '00000000-0000-4000-8000-0000000a0401';
begin
  perform pg_temp.devenir(u_clec);
  perform pg_temp.noter('E','E1. is_admin() est FAUX', not coalesce(public.is_admin(), false));
  perform pg_temp.noter('E','E2. est_staff_global() est FAUX', not coalesce(public.est_staff_global(), false));
  reset role;
  perform pg_temp.noter('E','E3. quatre catégories en LECTURE',
    pg_temp.lire(u_clec,'select count(*) from public.categories_lecture()') = 4);
  perform pg_temp.noter('E','E4. AUCUNE en écriture',
    pg_temp.lire(u_clec,'select count(*) from public.categories_ecriture()') = 0);
  perform pg_temp.noter('E','E5. il voit SON élève, et lui seul',
    pg_temp.lire(u_clec,'select count(*) from public.students') = 1);
  perform pg_temp.noter('E','E6. l''élève hors périmètre lui est invisible',
    pg_temp.lire(u_clec, format($q$select count(*) from public.students where id = %L$q$, e_hors)) = 0);
  perform pg_temp.noter('E','E7. fiche de son élève : lisible',
    pg_temp.lire(u_clec,'select count(*) from public.student_profiles_lisible') = 1);
  -- ⚠️ AUCUNE ÉCRITURE, Y COMPRIS PAR APPEL DIRECT : ce sont ici des requêtes
  -- SQL nues, sans interface — exactement ce que ferait un appel PostgREST.
  perform pg_temp.noter('E','E8. programme : UPDATE REFUSÉ',
    not pg_temp.ecrit(u_clec, format($q$update public.programs set name='E8' where id=%L$q$, p_prog)));
  perform pg_temp.noter('E','E9. séance : INSERT REFUSÉ',
    not pg_temp.ecrit(u_clec, format($q$insert into public.workout_sessions (program_id, program_week_id, day, name)
      values (%L,%L,'vendredi','E9') returning id$q$, p_prog, w_sem)));
  perform pg_temp.noter('E','E10. fiche de SON élève : UPDATE REFUSÉ (lecture seule)',
    not pg_temp.ecrit(u_clec, format($q$update public.students set first_name='E10' where id=%L$q$, e_aff)));
  perform pg_temp.noter('E','E11. plan nutrition : UPDATE REFUSÉ',
    not pg_temp.ecrit(u_clec, $q$update public.nutrition_plans set name='E11' where student_id is not null$q$));
  -- Même précaution qu'en F7 : c'est la valeur qui tranche, pas le row_count.
  perform pg_temp.ecrit(u_clec, format($q$update public.students set coach_id = %L where id = %L$q$,
    '00000000-0000-4000-8000-0000000a0104'::uuid, e_aff));
  perform pg_temp.noter('E','E12. il ne modifie pas l''affectation principale de l''élève',
    (select coach_id from public.students where id = e_aff) = '00000000-0000-4000-8000-0000000a0103'::uuid);
  perform pg_temp.noter('E','E13. il ne s''accorde pas une permission d''écriture',
    not pg_temp.ecrit(u_clec, format($q$update public.collaborateur_permissions set niveau='ecriture'
      where collaborateur_id = %L$q$, '00000000-0000-4000-8000-0000000a0104'::uuid)));
  perform pg_temp.noter('E','E14. il ne s''affecte pas un élève de plus',
    not pg_temp.ecrit(u_clec, format($q$insert into public.collaborateur_eleves (collaborateur_id, student_id, affecte_par)
      values (%L,%L,%L) returning id$q$,
      '00000000-0000-4000-8000-0000000a0104'::uuid, e_hors, '00000000-0000-4000-8000-0000000a0103'::uuid)));
end $$;


-- ── F. LE COLLABORATEUR EN ÉCRITURE : DANS SON PÉRIMÈTRE, ET PAS AU-DELÀ ──
do $$
declare
  u_cecr constant uuid := '00000000-0000-4000-8000-0000000a0005';
  e_aff  constant uuid := '00000000-0000-4000-8000-0000000a0201';
  e_hors constant uuid := '00000000-0000-4000-8000-0000000a0202';
  p_prog constant uuid := '00000000-0000-4000-8000-0000000a0301';
  w_sem  constant uuid := '00000000-0000-4000-8000-0000000a0401';
begin
  perform pg_temp.noter('F','F1. quatre catégories en écriture',
    pg_temp.lire(u_cecr,'select count(*) from public.categories_ecriture()') = 4);
  perform pg_temp.noter('F','F2. il voit SON élève, et lui seul',
    pg_temp.lire(u_cecr,'select count(*) from public.students') = 1);
  perform pg_temp.noter('F','F3. fiche de son élève : UPDATE ACCEPTÉ (c''est son droit)',
    pg_temp.ecrit(u_cecr, format($q$update public.students set first_name='F3' where id=%L$q$, e_aff)));
  perform pg_temp.noter('F','F4. séance d''entraînement : INSERT … RETURNING ACCEPTÉ',
    pg_temp.ecrit(u_cecr, format($q$insert into public.workout_sessions (program_id, program_week_id, day, name)
      values (%L,%L,'samedi','F4') returning id$q$, p_prog, w_sem)));
  perform pg_temp.noter('F','F5. plan nutrition de son élève : UPDATE ACCEPTÉ',
    pg_temp.ecrit(u_cecr, $q$update public.nutrition_plans set name='F5' where student_id is not null$q$));
  -- …ET LE PÉRIMÈTRE TIENT.
  perform pg_temp.noter('F','F6. élève hors périmètre : UPDATE REFUSÉ',
    not pg_temp.ecrit(u_cecr, format($q$update public.students set first_name='F6' where id=%L$q$, e_hors)));
  /*
   * ⚠️ ON MESURE LA VALEUR, PAS LE NOMBRE DE LIGNES TOUCHÉES. Le déclencheur
   * `protect_students_ownership` ne LÈVE pas : il recopie l'ancienne valeur.
   * L'UPDATE rend donc « 1 ligne modifiée », et un contrôle qui s'en
   * contenterait conclurait à une fuite là où il n'y en a pas — c'est
   * exactement ce qu'a fait la première version de ce contrôle.
   */
  perform pg_temp.ecrit(u_cecr, format($q$update public.students set coach_id = %L where id = %L$q$,
    '00000000-0000-4000-8000-0000000a0105'::uuid, e_aff));
  perform pg_temp.noter('F','F7. affectation principale de son élève : la valeur n''a PAS changé',
    (select coach_id from public.students where id = e_aff) = '00000000-0000-4000-8000-0000000a0103'::uuid);
  perform pg_temp.ecrit(u_cecr, format($q$update public.students set status = 'pause' where id = %L$q$, e_aff));
  perform pg_temp.noter('F','F7b. statut de son élève : la valeur n''a PAS changé',
    (select status from public.students where id = e_aff) = 'active');
  perform pg_temp.ecrit(u_cecr, format($q$update public.collaborateur_permissions set niveau='ecriture', categorie='entrainement'
    where collaborateur_id = %L$q$, '00000000-0000-4000-8000-0000000a0105'::uuid));
  perform pg_temp.noter('F','F8. ses propres permissions : les quatre catégories restent intactes',
    (select count(*) from public.collaborateur_permissions
      where collaborateur_id = '00000000-0000-4000-8000-0000000a0105'::uuid) = 4);
  perform pg_temp.ecrit(u_cecr, format($q$update public.coaches set role='admin' where id = %L$q$,
    '00000000-0000-4000-8000-0000000a0105'::uuid));
  perform pg_temp.noter('F','F9. il ne se donne pas une fiche admin',
    (select role from public.coaches where id = '00000000-0000-4000-8000-0000000a0105'::uuid) = 'collaborateur');
  perform pg_temp.ecrit(u_cecr, format($q$update public.profiles set role='admin' where user_id = %L$q$, u_cecr));
  perform pg_temp.noter('F','F10. il ne devient pas administrateur dans profiles',
    (select role from public.profiles where user_id = u_cecr) = 'coach');
end $$;


-- ── G. LES RUBRIQUES GLOBALES RESTENT FERMÉES AUX DEUX COLLABORATEURS ─────
do $$
declare
  u_clec constant uuid := '00000000-0000-4000-8000-0000000a0004';
  u_cecr constant uuid := '00000000-0000-4000-8000-0000000a0005';
  r record;
  v_n int;
  v_total int := 0;
begin
  for r in select unnest(array['payments','stripe_payments','subscriptions','billing_customers',
                               'email_logs','notification_campaigns','notification_campaign_targets',
                               'newsletter_subscribers','subscription_templates','coaches']) as t
  loop
    v_n := pg_temp.lire(u_cecr, format('select count(*) from public.%I', r.t));
    if v_n <> 0 then v_total := v_total + 1; raise warning '  %.% rend % ligne(s)', 'public', r.t, v_n; end if;
    v_n := pg_temp.lire(u_clec, format('select count(*) from public.%I', r.t));
    if v_n <> 0 then v_total := v_total + 1; raise warning '  %.% rend % ligne(s) (lecture)', 'public', r.t, v_n; end if;
  end loop;
  perform pg_temp.noter('G','G1. dix surfaces globales et administratives : AUCUNE ligne pour les deux collaborateurs', v_total = 0);

  -- La protection tarifaire de P13-B/10 tient toujours.
  perform pg_temp.noter('G','G2. les trois colonnes d''attribution d''offre restent refusées',
    pg_temp.lire(u_cecr,'select count(assigned_stripe_plan) from public.student_profiles') = -1);
  perform pg_temp.noter('G','G3. la fonction d''attribution ne leur rend rien',
    pg_temp.lire(u_cecr,'select count(*) from public.attribution_offre_eleve()') = 0);
  perform pg_temp.noter('G','G4. …et l''administrateur, lui, la lit toujours',
    pg_temp.lire('00000000-0000-4000-8000-0000000a0001','select count(*) from public.attribution_offre_eleve()') >= 1);
  perform pg_temp.noter('G','G5. l''administrateur SANS FICHE la lit aussi',
    pg_temp.lire('00000000-0000-4000-8000-0000000a0002','select count(*) from public.attribution_offre_eleve()') >= 1);
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
  (select count(*) from public.coaches where email like 'mx.%@test.local') as coachs_restants,
  (select count(*) from auth.users where email like 'mx.%@test.local')     as comptes_restants,
  (select count(*) from public.collaborateur_permissions)                  as permissions_restantes;
