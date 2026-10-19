-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/10 — PAIEMENTS, EMAILS ET NOTIFICATIONS : AUCUNE INFORMATION      ║
-- ║ Migration ADDITIVE. Aucune des neuf précédentes n'est modifiée.         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- L'AUDIT, ET CE QU'IL A TROUVÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Mesuré sur PostgreSQL 16 local, dans la session d'un collaborateur disposant
-- des QUATRE catégories en écriture ET d'un élève affecté — le mieux doté qui
-- puisse exister. Quatorze tables des trois rubriques relues une par une :
--
--     payments 0 · payment_entries 0 · stripe_payments 0 · subscriptions 0
--     billing_customers 0 · billing_events 0
--     email_logs 0 · appointment_email_logs 0
--     notification_campaigns 0 · notification_deliveries 0
--     notification_occurrences 0 · push_subscriptions 0
--     ──────────────────────────────────────────────────────────────────
--     notification_campaign_targets  1   ← fuite
--     subscription_templates         3   ← fuite
--
-- Puis, le catalogue refermé, un second balayage — toutes les colonnes du
-- schéma évoquant un prix, un montant, une offre ou une facture — a trouvé la
-- fuite RÉSIDUELLE que le premier ne pouvait pas voir : trois colonnes
-- d'attribution de `student_profiles`, qui donnent l'offre de l'élève sans
-- passer par le catalogue (section 3).
--
-- ════════════════════════════════════════════════════════════════════════════
-- FUITE 1 — LES CIBLES DE CAMPAGNE
-- ════════════════════════════════════════════════════════════════════════════
-- `notification_campaign_targets` était gardée par
-- `student_ids_agenda_communication_{lecture,ecriture}()` : un collaborateur
-- ayant cette catégorie lisait les cibles des campagnes de ses élèves, et
-- pouvait en créer, modifier et supprimer. Or la campagne ELLE-MÊME
-- (`notification_campaigns`) lui est fermée par `est_staff_global()` : il
-- voyait donc les destinataires d'un envoi dont il ne peut pas voir l'objet.
--
-- La cible suit désormais sa campagne : `est_staff_global()`, le même verdict
-- que la table parente. Rien ne se perd côté application — les routes
-- `/api/admin/notifications/*` passent déjà par `requireStaff()`, qui refuse
-- tout collaborateur.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FUITE 2 — LE PRIX PAYÉ PAR L'ÉLÈVE, PAR UNE JOINTURE
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CELLE-CI NE SE VOIT PAS EN REGARDANT UNE TABLE À LA FOIS. Prises
-- séparément, les deux lectures sont légitimes :
--
--   · `student_profiles` est ouvert au collaborateur par `suivi_eleve`, et
--     porte `assigned_subscription_template_id` ;
--   · `subscription_templates` était lisible par TOUT appelant dès que
--     `is_active = true`, pour le parcours d'achat.
--
-- Jointes, elles donnent le prix de l'offre souscrite par un élève affecté.
-- Mesuré : « R / Offre Premium / 19900 » — 199,00 €, soit exactement ce que
-- la consigne interdit.
--
-- ⚠️ LE PARCOURS D'ACHAT N'EST PAS REFERMÉ. La branche ouverte est conservée
-- pour un visiteur ANONYME (la vitrine publique) et pour un ÉLÈVE connecté
-- (son espace et son achat) ; seuls les comptes authentifiés qui ne sont ni
-- l'un ni l'autre — c'est-à-dire les collaborateurs — en sortent.
--
-- ⚠️ FERMER LE CATALOGUE NE SUFFIT PAS, ET LA SECTION 3 EN TIRE LES
-- CONSÉQUENCES. Le catalogue reste public : un collaborateur déconnecté peut
-- toujours lire les prix affichés, puis les recouper avec ce qu'il a lu de
-- l'offre de son élève en étant connecté. Le chemin ne se referme donc pas
-- sur le catalogue — il se referme sur la RÉFÉRENCE, c'est-à-dire sur les
-- TROIS colonnes d'attribution de `student_profiles`. Une policy RLS ne sait
-- pas le faire (elle filtre des lignes, pas des colonnes) : c'est un
-- privilège de COLONNE, posé en section 3.

begin;

-- ── 1. notification_campaign_targets : la cible suit sa campagne ──────────
drop policy if exists notification_campaign_targets_staff_select on public.notification_campaign_targets;
create policy notification_campaign_targets_staff_select
  on public.notification_campaign_targets for select
  using (coalesce(public.est_staff_global(), false));

drop policy if exists notification_campaign_targets_staff_insert on public.notification_campaign_targets;
create policy notification_campaign_targets_staff_insert
  on public.notification_campaign_targets for insert
  with check (coalesce(public.est_staff_global(), false));

drop policy if exists notification_campaign_targets_staff_update on public.notification_campaign_targets;
create policy notification_campaign_targets_staff_update
  on public.notification_campaign_targets for update
  using (coalesce(public.est_staff_global(), false))
  with check (coalesce(public.est_staff_global(), false));

drop policy if exists notification_campaign_targets_staff_delete on public.notification_campaign_targets;
create policy notification_campaign_targets_staff_delete
  on public.notification_campaign_targets for delete
  using (coalesce(public.est_staff_global(), false));

-- ── 2. subscription_templates : le catalogue, mais pas pour un collaborateur
--
-- ⚠️ DEUX FONCTIONS INTERMÉDIAIRES, ET VOICI CE QU'ELLES ÉVITENT. Une policy
-- évaluée pour un visiteur ANONYME ne peut pas appeler `current_student_id()`,
-- `est_staff_global()` ni lire `student_profiles` : P13-B a retiré à `anon`
-- l'EXECUTE de ces fonctions. Une première version de ce correctif tombait en
-- « permission denied for function student_ids_suivi_eleve_lecture ».
--
-- ⚠️ MESURÉ AUSSI : `anon` NE LISAIT DÉJÀ PAS CETTE TABLE AVANT CE LOT. Dans
-- l'état livré, la policy voisine `subscription_templates_manage_staff_select`
-- appelle `is_admin()` directement, et `anon` échoue dessus — la lecture
-- anonyme était donc déjà refusée, et le parcours d'achat public passe par une
-- route serveur en `service_role` (app/api/public/programs/[programId]/
-- checkout). Ce correctif ne retire donc rien à la vitrine publique ; la
-- branche « anonyme » ci-dessous est conservée par exactitude de la règle, et
-- pour qu'elle reste juste si ces droits changent un jour.
--
-- Les deux fonctions sont SECURITY DEFINER : leurs appels internes se font
-- avec les droits du propriétaire, et `anon` peut donc les exécuter sans rien
-- gagner d'autre — elles ne rendent qu'un booléen et l'identifiant de l'offre
-- de l'appelant lui-même. PostgreSQL ne garantit pas l'ordre d'évaluation
-- d'un `or` : on ne peut pas compter sur un court-circuit pour éviter un
-- appel interdit, d'où l'encapsulation plutôt qu'un simple réordonnancement.

create or replace function public.peut_voir_catalogue_offres()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- Visiteur anonyme (vitrine publique), élève connecté (son achat),
  -- administrateur de cabinet ou coach autonome. Un collaborateur n'est
  -- aucun des quatre — et aucune catégorie ne peut l'y faire entrer.
  select coalesce(auth.role(), '') <> 'authenticated'
      or public.current_student_id() is not null
      or coalesce(public.est_staff_global(), false)
      or coalesce(public.is_admin(), false);
$fn$;
alter function public.peut_voir_catalogue_offres() owner to postgres;
revoke all on function public.peut_voir_catalogue_offres() from public;
grant execute on function public.peut_voir_catalogue_offres() to anon, authenticated, service_role;

create or replace function public.offre_de_l_eleve_connecte()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- L'offre souscrite par L'APPELANT lui-même, et personne d'autre : la
  -- clause `student_id = current_student_id()` ne peut désigner qu'une seule
  -- fiche, celle de l'élève connecté. Rend zéro ligne pour tout le reste.
  select sp.assigned_subscription_template_id
    from public.student_profiles sp
   where sp.student_id = public.current_student_id()
     and sp.assigned_subscription_template_id is not null;
$fn$;
alter function public.offre_de_l_eleve_connecte() owner to postgres;
revoke all on function public.offre_de_l_eleve_connecte() from public;
grant execute on function public.offre_de_l_eleve_connecte() to anon, authenticated, service_role;

-- La règle d'origine était `is_active = true OR is_admin() OR <offre de
-- l'élève connecté>`. Les trois termes sont conservés ; seul le premier est
-- borné, et il l'est par ce que l'appelant EST, jamais par une catégorie —
-- aucun réglage de `collaborateur_permissions` ne peut donc le rouvrir.
drop policy if exists subscription_templates_select_active_or_staff on public.subscription_templates;
create policy subscription_templates_select_active_or_staff
  on public.subscription_templates for select
  using (
    (is_active = true and public.peut_voir_catalogue_offres())
    or id in (select public.offre_de_l_eleve_connecte())
  );

-- ── 2b. coach_unavailabilities : agenda_communication n'est pas amputée ───
-- ⚠️ DÉFAUT DÉCOUVERT EN VÉRIFIANT LA NON-RÉGRESSION. La migration
-- 20261013090000 avait donné à `coach_availabilities` une clause de PORTÉE
-- (`coach_ids_portee()` + catégorie), parce qu'un collaborateur ne possède
-- aucun créneau : il travaille sur les élèves d'un autre coach. La même
-- clause manquait à `coach_unavailabilities`, dont la policy exige
-- `coach_id = current_staff_id()`.
--
-- Conséquence mesurée : un collaborateur avec `agenda_communication / lecture`
-- voyait les rendez-vous de son élève mais AUCUNE indisponibilité du coach —
-- il pouvait donc proposer un créneau déjà bloqué. La consigne demande
-- justement que les rendez-vous et événements autorisés continuent de
-- fonctionner.
--
-- ⚠️ LECTURE SEULEMENT. La suppression et la modification restent réservées
-- au propriétaire du créneau : voir un empêchement n'est pas le lever.
drop policy if exists coach_unavailabilities_select_portee on public.coach_unavailabilities;
create policy coach_unavailabilities_select_portee
  on public.coach_unavailabilities for select
  using (
    coach_id is not null
    and coach_id in (select public.coach_ids_portee())
    and coalesce('agenda_communication' in (select public.categories_lecture()), false)
  );

-- ── 3. LA FUITE RÉSIDUELLE DE PRIX : TROIS COLONNES, PAS UNE ──────────────
--
-- ⚠️ CE QUE LA SECTION 2 NE FERMAIT PAS. Fermer le catalogue au collaborateur
-- CONNECTÉ ne lui retire pas la RÉFÉRENCE de l'offre de son élève :
-- `student_profiles` lui reste ouvert par `suivi_eleve`, et c'est normal — il
-- y lit la physiologie, les objectifs et les préférences alimentaires de
-- l'élève dont il a la charge. Il suffisait donc de lire la référence
-- connecté, puis de lire les prix autrement — vitrine publique, session
-- déconnectée, capture d'écran d'un devis — et de recouper les deux.
--
-- ⚠️ ET LA RÉFÉRENCE N'EST PAS UNE COLONNE, MAIS TROIS. Balayage de TOUTES
-- les colonnes du schéma dont le nom évoque un prix, un montant, une offre,
-- un abonnement ou une facture, exécuté dans la session d'un collaborateur
-- disposant des QUATRE catégories en écriture et d'un élève affecté. Trois
-- seulement rendaient une valeur, les trois sur la même table :
--
--     student_profiles.assigned_subscription_template_id  →  l'identifiant
--     student_profiles.assigned_stripe_plan               →  « Offre Sonde »
--     student_profiles.assigned_stripe_price_id           →  « price_sonde_199 »
--
-- Tout le reste était déjà fermé (payments, stripe_payments, subscriptions,
-- billing_customers, billing_events, email_logs : zéro ligne). Et
-- `assigned_stripe_plan` est le NOM de l'offre, recopié du catalogue : il
-- suffit à lui seul, sans aucun identifiant technique, pour lire le prix sur
-- la vitrine publique. Fermer le seul `assigned_subscription_template_id`
-- aurait donc laissé la fuite ouverte.
--
-- ⚠️ UNE POLICY RLS NE SAIT PAS FAIRE ÇA. Elle filtre des LIGNES, pas des
-- colonnes, et la ligne, le collaborateur en a besoin. La protection est donc
-- posée là où PostgreSQL sait la poser : le privilège de COLONNE. C'est la
-- granularité la plus fine disponible — trois colonnes, deux rôles.
--
-- ⚠️ POURQUOI « REVOKE » SUR LA TABLE D'ABORD. Un privilège de table implique
-- toutes ses colonnes : `revoke select (colonne)` est un no-op tant que le
-- rôle garde `select` sur la table entière. L'ordre est imposé — retirer la
-- table, puis rendre colonne par colonne tout le reste. La liste est
-- CONSTRUITE depuis le catalogue au moment de l'application, jamais recopiée
-- à la main : une colonne ajoutée plus tard par une autre migration ne peut
-- pas être oubliée ici, et la vérification finale le contrôle.
--
-- ⚠️ ET POURQUOI UNE VUE. Trois lectures légitimes font `select *` sur cette
-- table (lib/supabase/students.ts ×2, lib/supabase/physiologie.ts), dont une
-- délibérément, « pour rendre ce qui existe quel que soit l'état de la
-- migration ». Or `select *` exige le privilège sur TOUTES les colonnes : il
-- tomberait en 42501, pour l'administrateur comme pour l'élève.
-- `student_profiles_lisible` rend exactement les mêmes colonnes moins les
-- trois, et `security_invoker = true` est ce qui compte ici : la vue
-- s'évalue avec les droits ET la RLS de l'APPELANT. Sans cette option elle
-- s'évaluerait avec ceux de son propriétaire et contournerait la RLS — la
-- vérification finale refuse l'application si l'option a disparu.
--
-- ⚠️ CE QUI N'EST PAS TOUCHÉ, ET C'EST VOLONTAIRE :
--   · `service_role` garde la table entière — les webhooks Stripe
--     (app/api/stripe/webhook, qui ne lit aucune de ces trois colonnes), les
--     routes serveur et la vitrine publique ne changent pas d'un octet ;
--   · aucune donnée n'est déplacée ni supprimée : l'historique reste dans
--     `student_profiles`, à sa place, avec sa clé étrangère vers
--     `subscription_templates` ;
--   · le déclencheur `protect_access_columns` — qui interdit déjà l'ÉCRITURE
--     de ces colonnes à quiconque n'est pas `admin`/`assistant` — est
--     conservé tel quel : la fuite était en LECTURE, l'écriture était déjà
--     fermée (vérifié en base) ;
--   · l'élève, l'administrateur et le coach autonome continuent de lire
--     l'attribution, par la fonction d'accès ci-dessous.

do $c$
declare
  v_cols text;
  v_sensibles constant text[] :=
    array['assigned_subscription_template_id', 'assigned_stripe_plan', 'assigned_stripe_price_id'];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'student_profiles'
     and not (column_name = any (v_sensibles));

  if v_cols is null then
    raise exception 'P13-B/10 : student_profiles introuvable — la liste des colonnes à rendre est vide';
  end if;

  -- 1. La table entière part. 2. Tout sauf les trois colonnes revient.
  execute 'revoke select on public.student_profiles from authenticated, anon';
  execute format('grant select (%s) on public.student_profiles to authenticated, anon', v_cols);

  -- 3. `select *` reste possible, sur les colonnes non sensibles seulement.
  execute 'drop view if exists public.student_profiles_lisible';
  execute format(
    'create view public.student_profiles_lisible with (security_invoker = true) as select %s from public.student_profiles',
    v_cols);
  execute 'alter view public.student_profiles_lisible owner to postgres';
  execute 'grant select on public.student_profiles_lisible to authenticated, anon, service_role';
end $c$;

comment on view public.student_profiles_lisible is
  'P13-B/10 — `student_profiles` moins les trois colonnes d''attribution d''offre, '
  'devenues illisibles pour `authenticated`/`anon` (privilège de colonne) afin qu''un '
  'collaborateur ne puisse pas déduire le prix payé par son élève. '
  '`security_invoker = true` : droits et RLS de l''APPELANT, jamais du propriétaire. '
  'Les lectures `select *` de l''application passent par ici ; l''attribution elle-même '
  'se lit par public.attribution_offre_eleve().';

-- L'attribution reste lisible par CEUX QUI Y ONT DROIT, et par eux seuls :
-- l'élève pour lui-même (son espace, son parcours d'achat Stripe),
-- l'administrateur et le coach autonome pour la facturation. Un
-- collaborateur n'est ni l'un ni l'autre : la fonction ne lui rend aucune
-- ligne, quelles que soient ses catégories.
create or replace function public.attribution_offre_eleve(p_student_id uuid default null)
returns table (eleve_id uuid, offre_id uuid, offre_nom text, offre_prix_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- ⚠️ FAIL-CLOSED. `current_student_id()` rend NULL pour un non-élève :
  -- `sp.student_id = NULL` vaut NULL, donc PAS vrai — jamais « toutes les
  -- lignes ». `est_staff_global()` est enveloppé dans `coalesce(..., false)`
  -- pour la même raison.
  select sp.student_id,
         sp.assigned_subscription_template_id,
         sp.assigned_stripe_plan,
         sp.assigned_stripe_price_id
    from public.student_profiles sp
   where (p_student_id is null or sp.student_id = p_student_id)
     and (sp.student_id = public.current_student_id()
          or coalesce(public.est_staff_global(), false)
          -- ⚠️ ET `service_role`, SANS QUOI DEUX PARCOURS TOMBENT. L'email
          -- d'attribution d'offre (app/api/email/subscription-assigned) lit la
          -- fiche avec le client d'administration : `est_staff_global()` y est
          -- faux (aucun `auth.uid()`), et le nom de l'offre disparaîtrait du
          -- message. Le signal est le claim du JETON, pas `current_user` : dans
          -- une fonction SECURITY DEFINER, `current_user` est le PROPRIÉTAIRE
          -- (postgres), jamais le rôle de l'appelant.
          or coalesce(auth.role(), '') = 'service_role');
$fn$;
alter function public.attribution_offre_eleve(uuid) owner to postgres;
-- ⚠️ `revoke all … from public` NE SUFFIT PAS. Supabase pose un
-- `alter default privileges … grant all on functions to anon, authenticated,
-- service_role` : toute fonction nouvelle naît exécutable par `anon`, par un
-- privilège qui lui est accordé NOMMÉMENT et qu'un revoke sur `public` ne
-- touche pas. Mesuré : la vérification finale a refusé l'application.
revoke all on function public.attribution_offre_eleve(uuid) from public, anon, authenticated, service_role;
grant execute on function public.attribution_offre_eleve(uuid) to authenticated, service_role;

-- Le garde-fou de suppression d'une offre doit compter les élèves qui la
-- portent — un compte, jamais une valeur. Réservé au staff global, et il
-- LÈVE au lieu de rendre zéro : un zéro silencieux ferait croire qu'une
-- offre encore attribuée est libre de toute référence.
create or replace function public.compte_attributions_offre(
  p_template_id uuid,
  p_stripe_price_id text default null
)
returns table (par_modele integer, par_prix integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_modele integer := 0;
  v_prix integer := 0;
begin
  -- ⚠️ `service_role` EST ADMIS ICI PAR NÉCESSITÉ MESURÉE.
  -- `delete_unused_subscription_template` est accordée à `service_role` SEUL
  -- (migration 20260724214500) et la route de suppression l'appelle avec le
  -- client d'administration. Sans cette branche, supprimer une offre tombait
  -- en 42501 — régression constatée en base avant correction.
  if not (coalesce(public.est_staff_global(), false)
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'compte_attributions_offre : réservé à l''administrateur, au coach autonome et au serveur'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_modele
    from public.student_profiles sp
   where p_template_id is not null
     and sp.assigned_subscription_template_id = p_template_id;

  select count(*) into v_prix
    from public.student_profiles sp
   where p_stripe_price_id is not null
     and sp.assigned_stripe_price_id = p_stripe_price_id;

  return query select v_modele, v_prix;
end $fn$;
alter function public.compte_attributions_offre(uuid, text) owner to postgres;
revoke all on function public.compte_attributions_offre(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.compte_attributions_offre(uuid, text) to authenticated, service_role;

-- ⚠️ LA RPC DE SUPPRESSION DOIT SUIVRE. `delete_unused_subscription_template`
-- (migration 20260724214500) est SECURITY INVOKER — c'est ce qui fait que la
-- suppression reste soumise à la RLS — et elle interrogeait DEUX des trois
-- colonnes devenues illisibles. Sans ce réalignement, elle tomberait en
-- 42501 pour l'administrateur lui-même. Le corps est repris à l'identique :
-- seuls les deux comptes passent désormais par la fonction d'accès. La
-- migration d'origine n'est pas modifiée ; celle-ci la remplace.
create or replace function public.delete_unused_subscription_template(p_template_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_price_id text;
  v_attributions record;
  v_students_by_template integer := 0;
  v_students_by_price integer := 0;
  v_subscriptions integer := 0;
  v_payments integer := 0;
begin
  -- 1. Verrouiller la ligne cible (bloque toute suppression/màj concurrente).
  select t.stripe_price_id
    into v_price_id
    from public.subscription_templates t
   where t.id = p_template_id
     for update;

  -- 2. Modèle inexistant → réponse contrôlée (idempotent).
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- 3. Revérifier TOUTES les références dans la même transaction.
  select a.par_modele, a.par_prix
    into v_attributions
    from public.compte_attributions_offre(p_template_id, v_price_id) a;
  v_students_by_template := coalesce(v_attributions.par_modele, 0);
  v_students_by_price := coalesce(v_attributions.par_prix, 0);

  if v_price_id is not null then
    select count(*) into v_subscriptions
      from public.subscriptions s
     where s.stripe_price_id = v_price_id;

    select count(*) into v_payments
      from public.stripe_payments p
      join public.subscriptions s
        on s.stripe_subscription_id = p.stripe_subscription_id
     where s.stripe_price_id = v_price_id;
  end if;

  -- 4. Une seule référence bloquante ⇒ on ne supprime rien.
  if v_students_by_template > 0
     or v_students_by_price > 0
     or v_subscriptions > 0
     or v_payments > 0 then
    return jsonb_build_object(
      'result', 'in_use',
      'references', jsonb_build_object(
        'studentsByTemplateId', v_students_by_template,
        'studentsByPriceId', v_students_by_price,
        'subscriptions', v_subscriptions,
        'payments', v_payments
      )
    );
  end if;

  -- 5. Réellement inutilisé → suppression dans la même transaction.
  delete from public.subscription_templates where id = p_template_id;

  return jsonb_build_object('result', 'deleted');
end;
$fn$;


-- ── 4. VÉRIFICATION FINALE ────────────────────────────────────────────────
do $g$
declare v_n int;
begin
  -- Les cibles de campagne ne dépendent plus d'une catégorie.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_campaign_targets'
     and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'student_ids_agenda_communication';
  if v_n <> 0 then
    raise exception 'P13-B/10 : % policy(ies) de notification_campaign_targets dépendent encore d''une catégorie', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_campaign_targets'
     and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'est_staff_global';
  if v_n <> 4 then
    raise exception 'P13-B/10 : les 4 policies de notification_campaign_targets ne sont pas toutes alignées (% sur 4)', v_n;
  end if;

  -- Le catalogue reste ouvert à l'anonyme et à l'élève, par des fonctions
  -- que `anon` a le droit d'exécuter.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname = 'subscription_templates_select_active_or_staff'
     and qual ~ 'peut_voir_catalogue_offres' and qual ~ 'offre_de_l_eleve_connecte';
  if v_n <> 1 then
    raise exception 'P13-B/10 : la policy du catalogue a perdu le parcours élève ou le visiteur anonyme';
  end if;
  for v_n in select 1 from unnest(array['peut_voir_catalogue_offres','offre_de_l_eleve_connecte']) f
              where not has_function_privilege('anon', ('public.'||f||'()')::regprocedure, 'EXECUTE')
  loop
    raise exception 'P13-B/10 : anon ne peut pas exécuter une fonction de la policy du catalogue — la règle serait fausse pour un visiteur';
  end loop;

  -- Et le collaborateur garde les indisponibilités du coach de ses élèves.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'coach_unavailabilities'
     and policyname = 'coach_unavailabilities_select_portee'
     and qual ~ 'coach_ids_portee' and qual ~ 'categories_lecture';
  if v_n <> 1 then
    raise exception 'P13-B/10 : la clause de portée des indisponibilités manque — agenda_communication serait amputée';
  end if;

  -- ── Section 3 : les trois colonnes d'attribution sont illisibles. ─────
  for v_n in
    select 1 from unnest(array['assigned_subscription_template_id',
                               'assigned_stripe_plan',
                               'assigned_stripe_price_id']) col
     cross join unnest(array['authenticated','anon']) r
     where has_column_privilege(r, 'public.student_profiles', col, 'SELECT')
  loop
    raise exception 'P13-B/10 : une colonne d''attribution d''offre reste lisible — la fuite de prix n''est pas fermée';
  end loop;

  -- …et TOUTES les autres le sont restées, pour les deux rôles. Un oubli
  -- ici casserait la fiche élève entière, pas seulement la facturation.
  select count(*) into v_n
    from information_schema.columns c
   cross join unnest(array['authenticated','anon']) r
   where c.table_schema = 'public'
     and c.table_name = 'student_profiles'
     and c.column_name <> all (array['assigned_subscription_template_id',
                                     'assigned_stripe_plan',
                                     'assigned_stripe_price_id'])
     and not has_column_privilege(r, 'public.student_profiles', c.column_name, 'SELECT');
  if v_n <> 0 then
    raise exception 'P13-B/10 : % colonne(s) non sensible(s) de student_profiles ont perdu la lecture', v_n;
  end if;

  -- `service_role` garde la table entière : webhooks et routes serveur.
  for v_n in
    select 1 from unnest(array['assigned_subscription_template_id',
                               'assigned_stripe_plan',
                               'assigned_stripe_price_id']) col
     where not has_column_privilege('service_role', 'public.student_profiles', col, 'SELECT')
  loop
    raise exception 'P13-B/10 : service_role a perdu une colonne d''attribution — webhooks et facturation serveur tomberaient';
  end loop;

  -- La vue existe, expose exactement les bonnes colonnes, et s'évalue avec
  -- les droits de l'APPELANT. Sans security_invoker elle contournerait la RLS.
  if to_regclass('public.student_profiles_lisible') is null then
    raise exception 'P13-B/10 : la vue student_profiles_lisible manque — les lectures `select *` tomberaient en 42501';
  end if;
  select count(*) into v_n
    from pg_class c
   where c.oid = 'public.student_profiles_lisible'::regclass
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'off') in ('true','on');
  if v_n <> 1 then
    raise exception 'P13-B/10 : student_profiles_lisible n''est pas en security_invoker — elle contournerait la RLS de l''appelant';
  end if;
  select count(*) into v_n
    from information_schema.columns v
   where v.table_schema = 'public' and v.table_name = 'student_profiles_lisible'
     and v.column_name = any (array['assigned_subscription_template_id',
                                    'assigned_stripe_plan',
                                    'assigned_stripe_price_id']);
  if v_n <> 0 then
    raise exception 'P13-B/10 : la vue de lecture expose une colonne d''attribution';
  end if;
  select count(*) into v_n
    from information_schema.columns t
   where t.table_schema = 'public' and t.table_name = 'student_profiles'
     and t.column_name <> all (array['assigned_subscription_template_id',
                                     'assigned_stripe_plan',
                                     'assigned_stripe_price_id'])
     and not exists (select 1 from information_schema.columns v
                      where v.table_schema = 'public'
                        and v.table_name = 'student_profiles_lisible'
                        and v.column_name = t.column_name);
  if v_n <> 0 then
    raise exception 'P13-B/10 : % colonne(s) de student_profiles manquent à la vue de lecture', v_n;
  end if;

  -- Les deux fonctions d'accès existent, en SECURITY DEFINER, et `anon` n'y
  -- a RIEN : aucune policy ne les appelle pour un visiteur.
  for v_n in
    select 1 from unnest(array['attribution_offre_eleve','compte_attributions_offre']) f
     where not exists (select 1 from pg_proc p
                        where p.pronamespace = 'public'::regnamespace
                          and p.proname = f and p.prosecdef)
  loop
    raise exception 'P13-B/10 : une fonction d''accès à l''attribution manque ou n''est pas SECURITY DEFINER';
  end loop;
  if has_function_privilege('anon', 'public.attribution_offre_eleve(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.compte_attributions_offre(uuid, text)'::regprocedure, 'EXECUTE') then
    raise exception 'P13-B/10 : anon peut exécuter une fonction d''attribution d''offre';
  end if;
  if not has_function_privilege('authenticated', 'public.attribution_offre_eleve(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'P13-B/10 : authenticated ne peut plus lire son attribution — l''élève perdrait son parcours d''achat';
  end if;

  -- Les deux fonctions reconnaissent le serveur : sans cette branche, l'email
  -- d'attribution et la suppression d'offre tombaient en 42501.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('attribution_offre_eleve', 'compte_attributions_offre')
     and pg_get_functiondef(p.oid) ~ 'service_role';
  if v_n <> 2 then
    raise exception 'P13-B/10 : une fonction d''attribution ne reconnaît pas service_role — email d''offre ou suppression d''offre tomberait';
  end if;

  -- Et la RPC de suppression n'interroge plus les colonnes directement.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'delete_unused_subscription_template'
     and pg_get_functiondef(p.oid) ~ 'compte_attributions_offre';
  if v_n <> 1 then
    raise exception 'P13-B/10 : delete_unused_subscription_template lit encore les colonnes d''attribution — elle tomberait en 42501';
  end if;

  raise notice 'P13-B/10 : cibles de campagne, catalogue d''offres et colonnes d''attribution fermés au collaborateur ; vitrine publique, élève, administrateur et coach autonome préservés.';
end $g$;

commit;
