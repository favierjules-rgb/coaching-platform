-- ============================================================================
-- CHECKLIST SQL — SOCLE WEB PUSH
-- ============================================================================
-- À jouer sur une base LOCALE après `supabase/migrations/20260828090000_web_push_notifications.sql`.
-- Chaque bloc annonce le résultat ATTENDU : un « ERROR » attendu est un
-- succès, c'est la contrainte qui fait son travail.
--
--   T1  deux occurrences pour la même échéance      → refus   (ADMINPUSH10)
--   T2  deux appareils du même élève                → 2 envois (multi-appareils)
--   T3  le même appareil deux fois                  → refus   (ADMINPUSH10)
--   T4  destination externe                         → refus   (ADMINPUSH14)
--   T5  destination /entrainement/seance/<uuid>     → acceptée
--   T6  récurrence sans règle                       → refus
--   T7  programmation sans échéance                 → refus
--   T8  RLS active sur les cinq tables
--   T9  aucun droit pour `anon`
-- ============================================================================

\set ON_ERROR_STOP 0
-- Un utilisateur, deux appareils.
insert into auth.users (id, email) values ('11111111-1111-4111-8111-aaaaaaaaaaaa','eleve@example.com') on conflict do nothing;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('11111111-1111-4111-8111-aaaaaaaaaaaa','https://push.apple.com/iphone','k1','a1'),
  ('11111111-1111-4111-8111-aaaaaaaaaaaa','https://push.mozilla.com/ordi','k2','a2');
insert into public.notification_campaigns (title, body, target_kind, schedule_kind, recurrence, next_run_at)
  values ('Poids','Pense à renseigner ton poids.','all','recurring','{"freq":"weekly","weekdays":[1],"hour":8,"minute":0}','2026-08-17T06:00:00Z')
  returning id \gset camp_
insert into public.notification_occurrences (campaign_id, scheduled_for) values (:'camp_id','2026-08-17T06:00:00Z') returning id \gset occ_

\echo '── T1 : deux occurrences pour la MÊME échéance (attendu : refus) ──'
insert into public.notification_occurrences (campaign_id, scheduled_for) values (:'camp_id','2026-08-17T06:00:00Z');

\echo '── T2 : les DEUX appareils du même élève reçoivent (attendu : 2 lignes) ──'
insert into public.notification_deliveries (occurrence_id, user_id, subscription_id, status)
  select :'occ_id', s.user_id, s.id, 'envoyee' from public.push_subscriptions s;
select count(*) as envois from public.notification_deliveries where occurrence_id = :'occ_id';

\echo '── T3 : le MÊME appareil deux fois sur la même occurrence (attendu : refus) ──'
insert into public.notification_deliveries (occurrence_id, user_id, subscription_id)
  select :'occ_id', s.user_id, s.id from public.push_subscriptions s limit 1;

\echo '── T4 : destination externe (attendu : refus) ──'
insert into public.notification_campaigns (title, body, destination, target_kind, schedule_kind)
  values ('X','Y','https://evil.example/steal','all','now');

\echo '── T5 : destination séance valide (attendu : accepté) ──'
insert into public.notification_campaigns (title, body, destination, target_kind, schedule_kind)
  values ('OK','Y','/entrainement/seance/33333333-3333-4333-8333-777777777777','all','now');

\echo '── T6 : récurrence sans règle (attendu : refus) ──'
insert into public.notification_campaigns (title, body, target_kind, schedule_kind, next_run_at)
  values ('X','Y','all','recurring','2026-08-17T06:00:00Z');

\echo '── T7 : programmée sans échéance (attendu : refus) ──'
insert into public.notification_campaigns (title, body, target_kind, schedule_kind)
  values ('X','Y','all','once');

\echo '── T8 : RLS active sur les cinq tables ──'
select relname, relrowsecurity from pg_class
 where relname in ('push_subscriptions','notification_campaigns','notification_campaign_targets','notification_occurrences','notification_deliveries')
 order by 1;

\echo '── T9 : aucun droit pour anon ──'
select count(*) as droits_anon from information_schema.role_table_grants
 where grantee='anon' and table_name like 'notification%' or grantee='anon' and table_name='push_subscriptions';
