-- ============================================================================
-- VÉRIFICATION DU SEED — LECTURE SEULE
-- ============================================================================
-- Uniquement des SELECT. Aucun INSERT/UPDATE/DELETE/DDL.
-- N'APPELLE PAS la RPC delete_unused_subscription_template.
-- À exécuter après `supabase db reset` + chargement de seed.sql.
-- ============================================================================

\echo '=== 1. COMPTES SYNTHÉTIQUES ==='
select id, name, email, role, status
  from public.coaches
 where id in ('11111111-1111-4111-8111-111111111111',
              '22222222-2222-4222-8222-222222222222')
 order by role;
-- attendu : 2 lignes (admin actif, assistant actif)

select id, first_name, last_name, email, status, access_type, coach_id
  from public.students
 where id::text like '33333333-3333-4333-8333-3333333333%'
 order by email;
-- attendu : 3 lignes, status='active', coach_id = coach assistant

\echo '=== 2. MODÈLES CRÉÉS ==='
select id, name, amount_cents, currency, billing_interval,
       stripe_product_id, stripe_price_id, is_active
  from public.subscription_templates
 where id::text like 'a000000%-0000-4000-8000-%'
 order by id;
-- attendu : 8 lignes (T1, T3..T9) ; T9 is_active = false

\echo '=== 3. RELATIONS D''UTILISATION (par modèle) ==='
select t.id,
       t.name,
       (select count(*) from public.student_profiles sp
         where sp.assigned_subscription_template_id = t.id)   as eleves_par_template,
       (select count(*) from public.student_profiles sp
         where sp.assigned_stripe_price_id = t.stripe_price_id) as eleves_par_price,
       (select count(*) from public.subscriptions s
         where s.stripe_price_id = t.stripe_price_id)          as abonnements,
       (select count(*) from public.stripe_payments p
          join public.subscriptions s2
            on s2.stripe_subscription_id = p.stripe_subscription_id
         where s2.stripe_price_id = t.stripe_price_id)         as paiements
  from public.subscription_templates t
 where t.id::text like 'a000000%-0000-4000-8000-%'
 order by t.id;
-- attendu :
--   T1 -> 0,0,0,0   (deleted)
--   T3 -> 1,1,0,0   (in_use : template_id ET price_id recopié)
--   T4 -> 0,1,0,0   (in_use : price_id seul)
--   T5 -> 0,0,1,0   (in_use : abonnement)
--   T6 -> 0,0,1,1   (in_use : abonnement + paiement)
--   T7 -> 0,0,0,0   (deleted, Product partagé)
--   T8 -> 0,0,0,0   (deleted, Product partagé)
--   T9 -> 0,0,0,0   (deleted, Price déjà inactif)

\echo '=== 4. PARTAGE DE PRODUCT STRIPE ==='
select stripe_product_id, count(*) as nb_modeles
  from public.subscription_templates
 where id::text like 'a000000%-0000-4000-8000-%'
 group by stripe_product_id
 order by nb_modeles desc, stripe_product_id;
-- attendu : prod_TEST_shared = 2 (T7+T8) ; tous les autres = 1

\echo '=== 5. SUBSCRIPTIONS ==='
select id, student_id, stripe_subscription_id, stripe_price_id,
       stripe_product_id, status, amount_cents, currency
  from public.subscriptions
 where stripe_subscription_id in ('sub_TEST_005', 'sub_TEST_006')
 order by stripe_subscription_id;
-- attendu : 2 lignes, status='active'

\echo '=== 6. PAIEMENTS ==='
select id, student_id, stripe_invoice_id, stripe_subscription_id,
       stripe_payment_intent_id, amount_cents, currency, status
  from public.stripe_payments
 where stripe_invoice_id = 'in_TEST_006';
-- attendu : 1 ligne rattachée à sub_TEST_006

\echo '=== 7. IDENTIFIANTS STRIPE (préfixes de test uniquement) ==='
select 'subscription_templates.product' as source, stripe_product_id as valeur
  from public.subscription_templates where id::text like 'a000000%'
union all
select 'subscription_templates.price', stripe_price_id
  from public.subscription_templates where id::text like 'a000000%'
union all
select 'subscriptions.subscription', stripe_subscription_id
  from public.subscriptions where stripe_subscription_id like 'sub_TEST%'
union all
select 'subscriptions.customer', stripe_customer_id
  from public.subscriptions where stripe_subscription_id like 'sub_TEST%'
union all
select 'stripe_payments.invoice', stripe_invoice_id
  from public.stripe_payments where stripe_invoice_id like 'in_TEST%'
union all
select 'billing_customers.customer', stripe_customer_id
  from public.billing_customers where stripe_customer_id like 'cus_TEST%'
 order by 1, 2;
-- attendu : uniquement des valeurs prod_TEST_*, price_TEST_*, sub_TEST_*,
--           in_TEST_*, cus_TEST_* — aucune valeur live

\echo '=== 7bis. AUCUN IDENTIFIANT STRIPE NON-TEST ==='
select count(*) as identifiants_suspects
  from public.subscription_templates
 where (stripe_product_id is not null and stripe_product_id not like 'prod_TEST_%')
    or (stripe_price_id   is not null and stripe_price_id   not like 'price_TEST_%');
-- attendu : 0

\echo '=== 8. AUCUN EMAIL HORS @example.test ==='
select 'coaches' as source, count(*) as hors_example_test
  from public.coaches where email not like '%@example.test'
union all
select 'students', count(*)
  from public.students where email not like '%@example.test'
union all
select 'billing_customers', count(*)
  from public.billing_customers where email not like '%@example.test';
-- attendu : 0 partout (si la base ne contient que le seed)

\echo '=== 9. NOMBRE DE LIGNES ATTENDU PAR TABLE (lignes du seed) ==='
select 'coaches'               as table_name, count(*) as lignes, 2 as attendu
  from public.coaches               where id::text like '11111111%' or id::text like '22222222%'
union all
select 'students', count(*), 3
  from public.students              where id::text like '33333333-3333-4333-8333-3333333333%'
union all
select 'student_profiles', count(*), 3
  from public.student_profiles      where id::text like '44444444-4444-4444-8444-44444444444%'
union all
select 'subscription_templates', count(*), 8
  from public.subscription_templates where id::text like 'a000000%-0000-4000-8000-%'
union all
select 'billing_customers', count(*), 1
  from public.billing_customers     where stripe_customer_id = 'cus_TEST_eleve3'
union all
select 'subscriptions', count(*), 2
  from public.subscriptions         where stripe_subscription_id like 'sub_TEST_%'
union all
select 'stripe_payments', count(*), 1
  from public.stripe_payments       where stripe_invoice_id like 'in_TEST_%'
 order by table_name;
-- attendu : colonne "lignes" == colonne "attendu" sur chaque ligne

\echo '=== 10. UUID DU CAS not_found (doit être ABSENT) ==='
select count(*) as doit_etre_zero
  from public.subscription_templates
 where id = 'a0000002-0000-4000-8000-000000000002';
-- attendu : 0 — cet UUID n'est jamais inséré (cas RPC "not_found")

\echo '=== 11. INTÉGRITÉ DES FK DU SEED ==='
select sp.student_id, sp.assigned_subscription_template_id,
       t.name as modele_attribue
  from public.student_profiles sp
  left join public.subscription_templates t
    on t.id = sp.assigned_subscription_template_id
 where sp.id::text like '44444444-4444-4444-8444-44444444444%'
 order by sp.id;
-- attendu : 3 lignes ; seule celle d'Eleve Un a un modèle attribué (T3)
