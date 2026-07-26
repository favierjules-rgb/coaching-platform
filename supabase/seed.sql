-- ============================================================================
-- SEED SYNTHÉTIQUE — tests locaux de delete_unused_subscription_template
-- ============================================================================
-- INSERT UNIQUEMENT. Aucun CREATE / ALTER / DROP / DELETE / UPDATE / TRUNCATE.
-- Toutes les données sont fictives. Emails exclusivement en @example.test.
-- UUID et identifiants Stripe déterministes (aucun gen_random_uuid(), aucun
-- random(), aucun now() dans les valeurs identifiantes).
-- Rejouable après chaque `db reset` : chaque INSERT est protégé par
-- ON CONFLICT (id) DO NOTHING (tous les id sont explicites).
--
-- Colonnes, contraintes CHECK, UNIQUE et FK conformes à
-- 20260724000000_baseline_remote_schema.sql.
--
-- ⚠️ NOTE SCHÉMA : `students.status` a pour DEFAULT 'actif', mais son CHECK
--    n'autorise que 'active' / 'paused' / 'completed'. La valeur est donc
--    toujours fournie explicitement ici ('active').
--
-- ⚠️ AUTH : aucune ligne `auth.users` ni `public.profiles` n'est créée.
--    Raison : `coaches.user_id` et `students.user_id` sont NULLABLE, donc
--    aucune FK ne l'exige. `profiles.user_id` est NOT NULL vers auth.users,
--    mais `profiles` n'intervient dans aucune vérification de la RPC.
--    Inventer les colonnes de `auth.users` serait risqué (schéma exclu du
--    dump). Voir seed-manifest.md § « Décisions humaines ».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. COMPTES SYNTHÉTIQUES
-- ---------------------------------------------------------------------------
-- Admin (coaches.role = 'admin') et coach assistant (coaches.role = 'assistant').
insert into public.coaches (id, user_id, name, email, role, status, specialty)
values
  ('11111111-1111-4111-8111-111111111111', null, 'Admin Test',
   'admin@example.test', 'admin', 'actif', 'Direction'),
  ('22222222-2222-4222-8222-222222222222', null, 'Coach Test',
   'coach@example.test', 'assistant', 'actif', 'Préparation physique')
on conflict (id) do nothing;

-- Élèves rattachés au coach assistant.
insert into public.students
  (id, user_id, coach_id, first_name, last_name, email, phone, status, access_type)
values
  ('33333333-3333-4333-8333-333333333331', null,
   '22222222-2222-4222-8222-222222222222',
   'Eleve', 'Un', 'eleve1@example.test', '', 'active', 'coaching'),
  ('33333333-3333-4333-8333-333333333332', null,
   '22222222-2222-4222-8222-222222222222',
   'Eleve', 'Deux', 'eleve2@example.test', '', 'active', 'coaching'),
  ('33333333-3333-4333-8333-333333333333', null,
   '22222222-2222-4222-8222-222222222222',
   'Eleve', 'Trois', 'eleve3@example.test', '', 'active', 'coaching')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. MODÈLES D'ABONNEMENT
-- ---------------------------------------------------------------------------
-- T1  inutilisé, Product NON partagé, Price actif        -> RPC: deleted
-- T3  attribué via assigned_subscription_template_id     -> RPC: in_use
-- T4  attribué via assigned_stripe_price_id (texte)      -> RPC: in_use
-- T5  référencé par subscriptions.stripe_price_id        -> RPC: in_use
-- T6  référencé par subscriptions + stripe_payments      -> RPC: in_use
-- T7  Product PARTAGÉ avec T8, sinon inutilisé           -> RPC: deleted
-- T8  Product PARTAGÉ avec T7, sinon inutilisé           -> RPC: deleted
-- T9  inutilisé, Price déjà inactif localement           -> RPC: deleted
-- (T2 : volontairement NON inséré — voir seed-manifest.md, cas not_found)
insert into public.subscription_templates
  (id, name, description, amount_cents, currency, billing_interval,
   duration_months, stripe_product_id, stripe_price_id, is_active, created_by)
values
  ('a0000001-0000-4000-8000-000000000001', 'T1 Inutilise',
   'Aucune reference — suppression attendue', 1900, 'eur', 'monthly', null,
   'prod_TEST_solo_t1', 'price_TEST_t1_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000003-0000-4000-8000-000000000003', 'T3 Attribue par template_id',
   'Eleve Un attribue via assigned_subscription_template_id', 2900, 'eur',
   'monthly', null, 'prod_TEST_solo_t3', 'price_TEST_t3_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000004-0000-4000-8000-000000000004', 'T4 Attribue par price_id',
   'Eleve Deux attribue via assigned_stripe_price_id uniquement', 3900, 'eur',
   'monthly', null, 'prod_TEST_solo_t4', 'price_TEST_t4_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000005-0000-4000-8000-000000000005', 'T5 Abonnement lie',
   'Reference par subscriptions.stripe_price_id', 4900, 'eur', 'monthly', null,
   'prod_TEST_solo_t5', 'price_TEST_t5_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000006-0000-4000-8000-000000000006', 'T6 Abonnement et paiement',
   'Reference par subscriptions puis stripe_payments', 5900, 'eur', 'monthly',
   null, 'prod_TEST_solo_t6', 'price_TEST_t6_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000007-0000-4000-8000-000000000007', 'T7 Product partage A',
   'Partage prod_TEST_shared avec T8 — Product NON archivable', 6900, 'eur',
   'monthly', null, 'prod_TEST_shared', 'price_TEST_t7_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000008-0000-4000-8000-000000000008', 'T8 Product partage B',
   'Partage prod_TEST_shared avec T7 — Product NON archivable', 7900, 'eur',
   'yearly', 12, 'prod_TEST_shared', 'price_TEST_t8_active', true,
   '11111111-1111-4111-8111-111111111111'),

  ('a0000009-0000-4000-8000-000000000009', 'T9 Price deja inactif',
   'Modele archive localement, Price cote Stripe deja inactif', 900, 'eur',
   'one_time', null, 'prod_TEST_solo_t9', 'price_TEST_t9_inactive', false,
   '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. PROFILS ÉLÈVES (vecteurs d'attribution)
-- ---------------------------------------------------------------------------
-- Eleve Un  : attribué via assigned_subscription_template_id -> bloque T3
-- Eleve Deux: attribué via assigned_stripe_price_id seul     -> bloque T4
-- Eleve Trois: aucune attribution (porte les abonnements/paiements)
insert into public.student_profiles
  (id, student_id, billing_access_mode, assigned_stripe_plan,
   assigned_stripe_price_id, assigned_subscription_template_id, access_note)
values
  ('44444444-4444-4444-8444-444444444441',
   '33333333-3333-4333-8333-333333333331', 'subscription_required',
   'T3 Attribue par template_id', 'price_TEST_t3_active',
   'a0000003-0000-4000-8000-000000000003',
   'Seed synthetique — cas in_use par template_id'),

  ('44444444-4444-4444-8444-444444444442',
   '33333333-3333-4333-8333-333333333332', 'subscription_required',
   null, 'price_TEST_t4_active', null,
   'Seed synthetique — cas in_use par price_id seul'),

  ('44444444-4444-4444-8444-444444444443',
   '33333333-3333-4333-8333-333333333333', 'subscription_required',
   null, null, null,
   'Seed synthetique — aucun modele attribue')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. CLIENT STRIPE SYNTHÉTIQUE
-- ---------------------------------------------------------------------------
insert into public.billing_customers
  (id, student_id, stripe_customer_id, email)
values
  ('55555555-5555-4555-8555-555555555553',
   '33333333-3333-4333-8333-333333333333',
   'cus_TEST_eleve3', 'eleve3@example.test')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. ABONNEMENTS
-- ---------------------------------------------------------------------------
-- sub_TEST_005 -> price de T5 (bloque T5)
-- sub_TEST_006 -> price de T6 (bloque T6, et porte le paiement ci-dessous)
insert into public.subscriptions
  (id, student_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
   stripe_product_id, plan_name, status, cancel_at_period_end, amount_cents,
   currency)
values
  ('66666666-6666-4666-8666-666666666665',
   '33333333-3333-4333-8333-333333333333', 'cus_TEST_eleve3',
   'sub_TEST_005', 'price_TEST_t5_active', 'prod_TEST_solo_t5',
   'T5 Abonnement lie', 'active', false, 4900, 'eur'),

  ('66666666-6666-4666-8666-666666666666',
   '33333333-3333-4333-8333-333333333333', 'cus_TEST_eleve3',
   'sub_TEST_006', 'price_TEST_t6_active', 'prod_TEST_solo_t6',
   'T6 Abonnement et paiement', 'active', false, 5900, 'eur')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. PAIEMENT
-- ---------------------------------------------------------------------------
-- Rattaché à sub_TEST_006 : seul lien possible vers un modèle, car
-- stripe_payments n'a ni FK vers subscriptions ni colonne prix/produit.
insert into public.stripe_payments
  (id, student_id, stripe_customer_id, stripe_payment_intent_id,
   stripe_invoice_id, stripe_subscription_id, amount_cents, currency, status)
values
  ('77777777-7777-4777-8777-777777777776',
   '33333333-3333-4333-8333-333333333333', 'cus_TEST_eleve3',
   'pi_TEST_006', 'in_TEST_006', 'sub_TEST_006', 5900, 'eur', 'succeeded')
on conflict (id) do nothing;
