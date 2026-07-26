-- =====================================================================
-- Correctifs de sécurité pré-production — C-1 (élévation de privilèges)
-- et H-3 (fuite d'annuaire). Audit du 26/07/2026, phase 2.
--
-- Migration ADDITIVE : aucune donnée n'est lue, modifiée ni supprimée.
-- Vérification préalable (lecture seule) : 1 profil admin, 1 profil student,
-- tous deux cohérents avec leur fiche métier — aucune trace d'exploitation.
--
-- ---------------------------------------------------------------------
-- Règle métier appliquée (arbitrage Jules, 26/07/2026)
-- ---------------------------------------------------------------------
--   role     : modifiable UNIQUEMENT par un véritable administrateur
--              (jamais un coach, jamais un élève) ou par le service role ;
--   user_id  : IMMUABLE pour tout utilisateur authentifié, administrateur
--              compris — seul le service role peut le fixer, lors du
--              provisionnement d'un compte ;
--   autres   : chacun modifie les champs ordinaires de son propre profil,
--              et le staff ceux des élèves qu'il gère (règles existantes).
--
-- `public.is_coach_or_admin()` n'est volontairement PAS réutilisée pour
-- autoriser un changement de rôle : elle englobe les coachs, ce qui leur
-- permettrait de se promouvoir mutuellement administrateurs. Une fonction
-- dédiée `public.is_admin()` est introduite pour cette décision.
--
-- ---------------------------------------------------------------------
-- C-1 — Un élève pouvait se promouvoir administrateur
-- ---------------------------------------------------------------------
-- La policy `profiles_update_self_or_admin` autorise un utilisateur à mettre
-- à jour SA ligne (`user_id = auth.uid()`). Elle n'avait pas de `WITH CHECK`
-- et aucun trigger ne protégeait les colonnes sensibles — alors que
-- `student_profiles` disposait déjà, elle, d'un `protect_access_columns`.
--
-- Comme `public.is_coach_or_admin()` décide de TOUS les droits en lisant
-- `profiles.role`, il suffisait d'un `update profiles set role = 'admin'`
-- sur sa propre ligne pour obtenir un accès complet aux données de tous les
-- élèves (santé, notes du coach, paiements, Storage privé).
--
-- Une policy ne peut pas comparer l'ancienne et la nouvelle valeur d'une
-- colonne : la protection réelle est donc portée par un trigger, le
-- `WITH CHECK` ne servant qu'à empêcher de déplacer une ligne hors de son
-- périmètre (défense en profondeur).
--
-- ---------------------------------------------------------------------
-- H-3 — Tout élève connecté lisait l'annuaire complet
-- ---------------------------------------------------------------------
-- `profiles_select_authenticated` (`using (auth.role() = 'authenticated')`)
-- annulait la policy fine voisine : les policies permissives se combinent en
-- OU. Elle avait DÉJÀ été supprimée par la migration
-- 20260713055337_harden_profiles_rls_and_security_definer_functions, qui est
-- bien appliquée en production — la policy a donc été recréée à la main dans
-- le tableau de bord Supabase depuis. On la resupprime ici, et le test SQL
-- `scripts/sql/profiles-security-tests.sql` échouera si elle réapparaît.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vérification d'administration, distincte de is_coach_or_admin()
-- ---------------------------------------------------------------------
-- SECURITY DEFINER est nécessaire ici : la fonction est appelée depuis un
-- trigger et depuis des policies sur `public.profiles` elle-même. En
-- SECURITY INVOKER, sa lecture serait filtrée par les policies de cette même
-- table — dépendance circulaire, et réponse dépendante du contexte
-- d'appel. Le corps se limite à une seule lecture, sans paramètre : aucune
-- donnée de l'appelant n'y entre, donc aucune surface d'injection.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'Vrai si l''appelant est administrateur (jamais coach). Décide des changements de rôle — correctif C-1 (audit 26/07/2026).';

-- Permissions minimales : révocation du GRANT PUBLIC implicite, puis
-- attribution explicite. `anon` n'a aucune raison d'interroger cette
-- fonction : sans session, elle renverrait toujours false, mais l'exposer
-- ajouterait une entrée inutile à la surface RPC publique.
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Protection des colonnes sensibles de profiles
-- ---------------------------------------------------------------------
create or replace function public.protect_profiles_role_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Contexte non-utilisateur : service role (routes serveur
  -- d'administration, webhook Stripe, provisionnement) et opérations de
  -- maintenance exécutées sans session (migrations, tâches planifiées).
  -- `auth.uid()` est alors NULL : aucun utilisateur authentifié n'est
  -- concerné, et la policy RLS a déjà écarté `anon` en amont.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- (1) `user_id` est IMMUABLE pour tout utilisateur authentifié, y compris
  -- un administrateur : le rattachement d'un profil à un compte auth se fait
  -- à la création, côté serveur. Le déplacer reviendrait à s'approprier le
  -- profil d'autrui, ou à faire porter le sien par un autre compte.
  if new.user_id is distinct from old.user_id then
    raise exception
      'Le compte rattaché à un profil ne peut pas être modifié (profil %).', old.id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- (2) `role` : seul un véritable administrateur peut le changer. Un coach
  -- gère les élèves mais ne distribue pas les privilèges.
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception
      'Modification du rôle interdite (profil %). Seul un administrateur peut changer un rôle.',
      old.id
      using errcode = '42501';
  end if;

  -- (3) Les autres colonnes restent régies par les policies existantes.
  return new;
end;
$$;

comment on function public.protect_profiles_role_column() is
  'Refuse toute modification de profiles.user_id par un utilisateur authentifié, et de profiles.role par un non-administrateur. Correctif C-1 (audit 26/07/2026).';

-- Fonction de trigger uniquement : jamais appelée directement en RPC.
revoke execute on function public.protect_profiles_role_column() from public;
revoke execute on function public.protect_profiles_role_column() from anon;

drop trigger if exists protect_role_column on public.profiles;
create trigger protect_role_column
  before update on public.profiles
  for each row
  execute function public.protect_profiles_role_column();

-- ---------------------------------------------------------------------
-- 3. WITH CHECK explicite sur la policy de mise à jour
-- ---------------------------------------------------------------------
-- Une policy ne voit que la ligne RÉSULTANTE : elle ne peut pas comparer
-- l'ancien et le nouveau rôle. Son rôle ici est d'empêcher qu'une ligne
-- sorte du périmètre de l'appelant ; l'interdiction de promotion est portée
-- par le trigger ci-dessus.
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update
  using (user_id = auth.uid() or public.is_coach_or_admin())
  with check (user_id = auth.uid() or public.is_coach_or_admin());

-- ---------------------------------------------------------------------
-- 4. Lecture des profils : strictement le sien, ou tout pour le staff (H-3)
-- ---------------------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on public.profiles;

-- La policy conservée depuis juillet contenait `or role in ('coach','admin')`,
-- une clause qui ne dépend d'AUCUNE authentification : les lignes du staff —
-- nom, prénom, email, téléphone — étaient lisibles par n'importe qui, y
-- compris sans session, via /rest/v1/profiles. Défaut mis en évidence par le
-- test SQL « anonyme ne lit aucun profil » (scripts/sql/profiles-security-tests.sql).
--
-- L'intention d'origine (« afficher le nom du coach à l'élève ») ne justifie
-- pas d'ouvrir la ligne entière : elle est désormais servie par la RPC
-- `public.get_my_coach_public_profile()` ci-dessous, qui ne renvoie que
-- l'identité minimale. Vérification faite, aucun code ne lisait le nom du
-- coach depuis `profiles` : il vient de la table `coaches`
-- (lib/supabase/appointments.ts, getPrimaryCoachInfo).
drop policy if exists "profiles_select_self_or_staff" on public.profiles;
create policy "profiles_select_self_or_staff" on public.profiles
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_or_admin()
  );

-- `to authenticated` ferme la porte au rôle `anon` au niveau de la policy.
-- On retire en plus ses privilèges de table : défense en profondeur, et le
-- moindre privilège appliqué à la lettre.
--
-- Audit des usages avant révocation (aucun flux anonyme ne lit `profiles`) :
--   - components/auth/LoginForm.tsx        : après signInWithPassword, session établie ;
--   - components/auth/ResetPasswordForm.tsx: après getUser(), donc authentifié ;
--   - lib/supabase/auth.ts                 : getCurrentUserRole, authentifié ;
--   - lib/supabase/coaches.ts              : espace admin ;
--   - *-provisioning.ts                    : client service role, non concerné.
revoke all on table public.profiles from anon;

-- ---------------------------------------------------------------------
-- 5. Identité publique du coach, sans ouvrir la table profiles
-- ---------------------------------------------------------------------
-- Besoin métier : un élève doit pouvoir afficher le nom de SON coach.
-- Réponse : une fonction qui expose le strict nécessaire, plutôt qu'une
-- policy qui donnerait accès à des lignes entières.
--
-- Ce qu'elle garantit :
--   - l'appelant est identifié par `auth.uid()`, jamais par un paramètre
--     (aucun identifiant à falsifier, donc aucun IDOR possible) ;
--   - l'association élève → coach est vérifiée en base (students.coach_id) ;
--   - seules l'identité minimale et la spécialité sortent — jamais email,
--     téléphone, rôle, statut ni note privée ;
--   - `anon` ne peut pas l'exécuter.
--
-- SECURITY DEFINER est nécessaire : la fonction lit `public.coaches`, dont
-- la policy de lecture serait sinon appliquée à l'élève. C'est justement
-- l'intérêt — elle sert de guichet contrôlé, et ne renvoie que les colonnes
-- énumérées ci-dessous.
create or replace function public.get_my_coach_public_profile()
returns table (
  coach_id uuid,
  first_name text,
  last_name text,
  specialty text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id                                                  as coach_id,
    split_part(coalesce(c.name, ''), ' ', 1)              as first_name,
    nullif(trim(substr(coalesce(c.name, ''), strpos(coalesce(c.name, ''), ' ') + 1)), '') as last_name,
    c.specialty
  from public.students s
  join public.coaches c on c.id = s.coach_id
  where s.user_id = auth.uid()
    and auth.uid() is not null
  limit 1;
$$;

comment on function public.get_my_coach_public_profile() is
  'Identité minimale du coach associé à l''élève appelant (jamais email, téléphone ni rôle). Remplace la lecture directe de profiles ET de coaches — audit 26/07/2026.';

-- Permissions minimales : révocation du GRANT PUBLIC implicite, puis
-- attribution explicite aux seuls rôles concernés. `anon` est exclu.
revoke execute on function public.get_my_coach_public_profile() from public;
revoke execute on function public.get_my_coach_public_profile() from anon;
grant execute on function public.get_my_coach_public_profile() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. H-3 (suite) — la table coaches était lisible par tout compte connecté
-- ---------------------------------------------------------------------
-- Contrôle local du 26/07/2026 : la policy `coaches_select_authenticated`
-- existe toujours, en `TO public` avec `using (auth.role() = 'authenticated')`.
-- Tout élève connecté lisait donc la table `coaches` ENTIÈRE — nom, email,
-- téléphone, statut, notes internes — via /rest/v1/coaches. Fermer `profiles`
-- sans fermer `coaches` n'aurait rien réglé : la fuite passait simplement par
-- l'autre table.
--
-- Audit des consommateurs de `public.coaches` avant restriction :
--
--   ESPACE ÉLÈVE (seul cas à migrer)
--     - app/(student)/rendez-vous/page.tsx → getPrimaryCoachInfo, client
--       navigateur avec la session de l'élève. Bascule sur la RPC
--       `get_my_coach_public_profile()` dans le même commit.
--
--   CALENDRIER / RENDEZ-VOUS
--     - app/admin/calendrier/page.tsx → getPrimaryCoachInfo, session
--       admin/coach : couvert par is_coach_or_admin().
--     - app/api/email/appointment-notification/route.ts → adminSupabase
--       (service role), non soumis à la RLS.
--     - app/api/cron/appointment-reminders/route.ts → service role.
--     - lib/email/recompose.ts (renvoi d'email depuis /admin/emails) →
--       service role.
--
--   ESPACE COACH / ADMIN
--     - lib/supabase/coaches.ts (getCoaches, ensureSelfCoachRow, updateCoach)
--       via hooks/useSupabaseCoaches → /admin/parametres, session staff.
--     - app/api/admin/subscription-templates/route.ts → sessionSupabase,
--       route déjà réservée admin/coach.
--
--   PROVISIONNEMENT SERVEUR
--     - lib/supabase/coach-student-provisioning.ts (resolveCoachId) et
--       lib/supabase/coach-account-provisioning.ts : appelés avec
--       createSupabaseAdminClient(), donc service role.
--
-- Conclusion : aucun flux légitime ne nécessite qu'un élève lise `coaches`.
drop policy if exists "coaches_select_authenticated" on public.coaches;
drop policy if exists "coaches_select_staff" on public.coaches;
create policy "coaches_select_staff" on public.coaches
  for select
  to authenticated
  using (public.is_coach_or_admin());

-- SELECT reste accordé à `authenticated` : ce sont les coachs et les admins
-- qui en ont besoin, et c'est la RLS ci-dessus — non le privilège de table —
-- qui écarte les élèves. Le retirer casserait l'espace d'administration.
--
-- `anon` en revanche n'a aucun usage : aucune page publique ne lit `coaches`
-- (vérifié sur app/, components/ et hooks/ — les seuls appels partent de
-- l'espace élève, de l'espace admin ou du serveur).
revoke all on table public.coaches from anon;
