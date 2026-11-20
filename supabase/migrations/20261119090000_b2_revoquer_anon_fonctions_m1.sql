-- ============================================================================
-- B2 — RÉVOCATION DE `anon` SUR LES TROIS FONCTIONS AJOUTÉES PAR M1
--
-- ----------------------------------------------------------------------------
-- CE QUI A ÉTÉ MESURÉ, LE 19/11/2026, SUR LA PRODUCTION
-- ----------------------------------------------------------------------------
-- `proacl` des trois fonctions créées par 20261115090000 :
--
--   calendar_has_conflict_pour_coach : postgres=X | anon=X | authenticated=X | service_role=X
--   reserver_creneau_eleve           : postgres=X | anon=X | authenticated=X | service_role=X
--   creer_rendez_vous_staff          : postgres=X | anon=X | authenticated=X | service_role=X
--
-- À comparer avec deux fonctions de 20260726121000, qui n'ont PAS `anon` :
--
--   cancel_appointment_atomic        : postgres=X |          authenticated=X | service_role=X
--   calendar_has_conflict            : postgres=X |                            service_role=X
--
-- ⚠️ `revoke all … from public` NE RETIRE PAS `anon`. C'est la cause exacte, et
-- elle est vérifiable : Supabase pose des privilèges par défaut qui accordent
-- EXECUTE NOMMÉMENT à `anon`, `authenticated` et `service_role` sur toute
-- fonction créée dans `public`. Un privilège nommé n'est pas le privilège
-- `PUBLIC` ; le révoquer demande de le nommer. M1 n'écrit que le `revoke … from
-- public` puis le `grant` : il manque la ligne du milieu, celle que
-- 20260726121000 écrit pour chacune de ses six fonctions.
--
--   revoke all     on function … from public;
--   revoke execute on function … from anon;      <-- celle-ci
--   grant  execute on function … to authenticated;
--
-- ⚠️ POURQUOI `create_appointment_atomic`, RECRÉÉE PAR M1, Y A ÉCHAPPÉ.
-- `create or replace function` CONSERVE l'ACL existante. Cette fonction
-- existait déjà, `anon` en était déjà révoqué par 20260726121000, et le
-- remplacement n'y a rien changé. Les trois fonctions ci-dessus, elles, étaient
-- NOUVELLES : elles ont reçu les privilèges par défaut à la création.
--
-- ----------------------------------------------------------------------------
-- CE QUE `anon` POUVAIT EN FAIRE — mesuré, pas supposé
-- ----------------------------------------------------------------------------
-- `reserver_creneau_eleve` et `creer_rendez_vous_staff` : RIEN. Sous `anon`,
-- `auth.uid()` rend NULL (mesuré : `set local role anon; select auth.uid() is
-- null` → true), donc `current_student_id()` et `current_staff_id()` rendent
-- NULL et les deux fonctions lèvent `calendar_student_required` /
-- `calendar_staff_required` AVANT toute écriture. Le privilège était une
-- faiblesse de défense en profondeur, pas une brèche.
--
-- `calendar_has_conflict_pour_coach` : une FUITE D'INFORMATION RÉELLE. Elle ne
-- lit aucune session — elle répond sur le `p_coach_id` reçu. Mesuré sous `anon` :
--
--   set local role anon;
--   select public.calendar_has_conflict_pour_coach(
--            '<un coach_id>'::uuid, now(), now() + interval '1 hour');
--   -- → false
--
-- Un appelant anonyme connaissant un `coach_id` sondait donc l'occupation d'un
-- coach, créneau par créneau. C'est exactement ce que 20260726121000 avait
-- fermé sur `calendar_has_conflict`, en révoquant `anon` ET `authenticated`.
--
-- ----------------------------------------------------------------------------
-- POURQUOI `authenticated` EST AUSSI RETIRÉ DE LA FONCTION DE CONFLIT
-- ----------------------------------------------------------------------------
-- Ce n'est pas un durcissement d'opportunité : c'est l'intention ÉCRITE de M1,
-- que son code n'a pas atteinte. Commentaire de 20261115090000, l. 222-225 :
--
--   « elle n'est exécutable que par `service_role` et le propriétaire,
--     exactement comme `calendar_has_conflict` (mesuré : `proacl` sans
--     `authenticated`). Les RPC qui l'appellent étant elles aussi
--     `SECURITY DEFINER`, l'appel interne passe. »
--
-- Et c'est vérifiable côté code : relevé du 19/11/2026, la recherche de
-- `calendar_has_conflict_pour_coach` dans `app/`, `lib/` et `components/` rend
-- ZÉRO occurrence. Ses seuls appelants sont `reserver_creneau_eleve` (M1 l. 409),
-- `creer_rendez_vous_staff` (M1 l. 560) et `reschedule_appointment_atomic`
-- (M1 l. 737) — toutes trois `SECURITY DEFINER`, donc exécutées avec les droits
-- du PROPRIÉTAIRE : l'appel interne ne consulte pas l'ACL de l'appelant.
-- Retirer `authenticated` ne casse donc aucun parcours.
--
-- ----------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ----------------------------------------------------------------------------
--   • elle ne touche AUCUN corps de fonction — pas un seul `create or replace` ;
--   • elle ne touche AUCUNE donnée ;
--   • elle ne retire RIEN à `service_role` ;
--   • elle ne retire RIEN à `authenticated` sur les deux RPC de réservation,
--     appelées depuis le navigateur (`lib/supabase/appointments.ts` l. 784 et
--     l. 823, via `createSupabaseBrowserClient`, donc sous `authenticated`).
--
-- Ce qu'elle fait en plus depuis le 19/11/2026 : elle retire EXECUTE à `PUBLIC`
-- sur les trois fonctions (section 0), pour ne plus dépendre de M1 sur ce
-- point. `PUBLIC` n'est pas un rôle nommé : le retirer ne retire rien à
-- `authenticated` ni à `service_role`, qui tiennent leur privilège en propre.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. `PUBLIC` D'ABORD — SANS QUOI LES RÉVOCATIONS NOMMÉES NE SUFFISENT PAS
--
-- ⚠️ MESURÉ LE 19/11/2026, ET C'EST LA RAISON DE CETTE SECTION. Sur une base
-- où `PUBLIC` conserve EXECUTE (l'ACL s'y lit `=X/postgres`, grantee vide),
-- `has_function_privilege('anon', …)` répond VRAI malgré un
-- `revoke execute … from anon` : le privilège vient de `PUBLIC`, pas du rôle.
-- La garde d'arrivée de cette migration refusait donc de passer —
-- comportement correct, mais la migration se bloquait sur un acquis qu'elle
-- n'avait pas posé elle-même.
--
-- M1 écrit bien ce `revoke all … from public`, et la production le porte (son
-- `proacl` relevé ne contient aucune entrée `PUBLIC`). Mais en dépendre sans
-- l'écrire rend cette migration tributaire d'une autre. Les trois lignes
-- ci-dessous la rendent AUTONOME : sans effet là où M1 a déjà fait le travail,
-- décisives partout ailleurs.
-- ----------------------------------------------------------------------------
revoke execute on function public.calendar_has_conflict_pour_coach(
  uuid, timestamptz, timestamptz, uuid, uuid
) from public;

revoke execute on function public.reserver_creneau_eleve(
  uuid, timestamptz, timestamptz, text
) from public;

revoke execute on function public.creer_rendez_vous_staff(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) from public;

-- ----------------------------------------------------------------------------
-- 1. `calendar_has_conflict_pour_coach` — ni `anon`, ni `authenticated`
-- ----------------------------------------------------------------------------
revoke execute on function public.calendar_has_conflict_pour_coach(
  uuid, timestamptz, timestamptz, uuid, uuid
) from anon;

revoke execute on function public.calendar_has_conflict_pour_coach(
  uuid, timestamptz, timestamptz, uuid, uuid
) from authenticated;

-- ----------------------------------------------------------------------------
-- 2. `reserver_creneau_eleve` — `anon` seulement ; `authenticated` CONSERVÉ
-- ----------------------------------------------------------------------------
revoke execute on function public.reserver_creneau_eleve(
  uuid, timestamptz, timestamptz, text
) from anon;

-- ----------------------------------------------------------------------------
-- 3. `creer_rendez_vous_staff` — `anon` seulement ; `authenticated` CONSERVÉ
--
-- ⚠️ SIGNATURE RELEVÉE, PAS DEVINÉE. `pg_get_function_identity_arguments` du
-- 19/11/2026 rend les dix paramètres dans cet ordre :
--   p_student_id uuid, p_title text, p_description text, p_appointment_type text,
--   p_start_at timestamptz, p_end_at timestamptz, p_location text,
--   p_meeting_url text, p_ics_uid text, p_status text
-- `p_status` porte un défaut `'confirmed'`, qui ne fait pas partie de l'identité
-- de la fonction et n'a donc pas à être répété ici.
-- ----------------------------------------------------------------------------
revoke execute on function public.creer_rendez_vous_staff(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) from anon;

-- ----------------------------------------------------------------------------
-- 4. GARDE D'ARRIVÉE — la migration refuse de passer si l'ACL n'est pas celle
--    qu'elle annonce. Un `revoke` silencieusement sans effet ne doit pas se
--    solder par un succès.
-- ----------------------------------------------------------------------------
do $$
declare
  v_conflit constant text := 'public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid)';
  v_eleve   constant text := 'public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text)';
  v_staff   constant text := 'public.creer_rendez_vous_staff(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text)';
begin
  -- `anon` n'exécute plus aucune des trois.
  if has_function_privilege('anon', v_conflit, 'EXECUTE') then
    raise exception 'B2 : anon execute encore %', v_conflit;
  end if;
  if has_function_privilege('anon', v_eleve, 'EXECUTE') then
    raise exception 'B2 : anon execute encore %', v_eleve;
  end if;
  if has_function_privilege('anon', v_staff, 'EXECUTE') then
    raise exception 'B2 : anon execute encore %', v_staff;
  end if;

  -- `authenticated` perd la fonction de conflit et GARDE les deux parcours.
  if has_function_privilege('authenticated', v_conflit, 'EXECUTE') then
    raise exception 'B2 : authenticated execute encore %', v_conflit;
  end if;
  if not has_function_privilege('authenticated', v_eleve, 'EXECUTE') then
    raise exception 'B2 : authenticated a PERDU % — la reservation eleve est cassee', v_eleve;
  end if;
  if not has_function_privilege('authenticated', v_staff, 'EXECUTE') then
    raise exception 'B2 : authenticated a PERDU % — la creation staff est cassee', v_staff;
  end if;

  -- `service_role` garde tout : rien ne lui a été retiré.
  if not has_function_privilege('service_role', v_conflit, 'EXECUTE') then
    raise exception 'B2 : service_role a PERDU %', v_conflit;
  end if;
  if not has_function_privilege('service_role', v_eleve, 'EXECUTE') then
    raise exception 'B2 : service_role a PERDU %', v_eleve;
  end if;
  if not has_function_privilege('service_role', v_staff, 'EXECUTE') then
    raise exception 'B2 : service_role a PERDU %', v_staff;
  end if;
end $$;
