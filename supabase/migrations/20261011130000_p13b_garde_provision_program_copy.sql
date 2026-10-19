-- ════════════════════════════════════════════════════════════════════════════
-- P13-B / 5 — LA DERNIÈRE PORTE : provision_program_copy
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE DÉFAUT CORRIGÉ, MESURÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Revue finale du 11/10/2026. Un collaborateur SANS aucune permission et SANS
-- aucune affectation — à qui la RLS ne montre ni élève ni programme — appelle
-- `provision_program_copy` et obtient :
--
--   programmes créés pour un élève NON affecté : 1
--   affectations créées                        : 1
--
-- La fonction est `SECURITY DEFINER` : elle écrit HORS RLS. Sa garde
-- d'autorisation acceptait `profiles.role in ('service','admin','coach')` —
-- la bonne règle AVANT P13-B, quand `coach` désignait un staff global. P13-B
-- a fait de `profiles.role = 'coach'` la valeur de TOUT le staff non
-- administrateur, collaborateurs inclus (décision fondatrice : sept gardes
-- applicatives en dépendent, et aucune ne devait changer de verdict).
--
-- Le balayage de la revue a montré que c'est la SEULE fonction dans ce cas :
-- sur les 22 fonctions `SECURITY DEFINER` qui écrivent et sont appelables par
-- `authenticated`, 18 sont gardées par `current_student_id()` (NULL pour un
-- collaborateur), 3 par le rôle et la catégorie P13-B, et celle-ci par
-- l'ancienne règle. Aucune policy du schéma n'oppose plus
-- `is_coach_or_admin()`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI EST FAIT, ET CE QUI NE L'EST PAS
-- ────────────────────────────────────────────────────────────────────────────
-- SEULE la garde change. Le corps fonctionnel de la copie — programme,
-- semaines, séances, blocs, exercices, prescriptions, RPE recommandé,
-- verrou advisory, idempotence par session d'achat, affectation finale — est
-- repris OCTET POUR OCTET, par SUBSTITUTION sur la définition en place :
-- c'est la technique déjà employée par la migration 20261011110000 pour les
-- deux longues fonctions `enforce_*`, et elle évite de recopier 200 lignes
-- qui ont été modifiées trois fois depuis leur création (20260801120000,
-- puis 20260802190000 pour les prescriptions, puis 20260803190000 pour le
-- RPE).
--
-- La substitution est GARDÉE : si le motif n'apparaît pas exactement une
-- fois, la migration échoue au lieu de réécrire quelque chose d'inattendu.
--
-- ⚠️ AUCUNE MIGRATION DÉJÀ VALIDÉE N'EST MODIFIÉE. Ni les trois de P13-A, ni
-- les quatre de P13-B, ni les trois qui définissent cette fonction.
-- `create or replace` conserve le propriétaire et les privilèges ; ils sont
-- malgré tout réaffirmés plus bas plutôt que supposés.
--
-- ⚠️ CE QUE CELA RESSERRE POUR UN COACH AUTONOME. Avant ce correctif, tout
-- compte `profiles.role = 'coach'` pouvait copier un programme vers
-- N'IMPORTE QUEL élève, y compris celui d'un autre coach. Après, il est borné
-- à sa portée — la même règle que `students`, `programs`, `appointments` et
-- le cœur nutrition appliquent déjà depuis P13-A/P13-B. C'est un alignement,
-- pas une invention ; il est signalé ici parce qu'il change un comportement
-- existant.
--
-- ⚠️ CE QUI N'EST PAS TOUCHÉ : le chemin `service_role` (webhook Stripe,
-- cron) garde exactement son comportement, la RLS n'est ni désactivée ni
-- contournée ailleurs, la signature et les droits `EXECUTE` sont inchangés,
-- et aucune donnée n'est réécrite.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. LA GARDE, PAR SUBSTITUTION SUR LA DÉFINITION EN PLACE ───────────────
do $g$
declare
  v_def text;
  v_n int;
  v_motif constant text := $motif$  -- Autorisation : service_role (webhook) ou staff authentifié.
  -- Le profil se résout par user_id (jamais par id) — correctif 20260801210000.
  select coalesce(
    (select p.role::text from public.profiles p where p.user_id = auth.uid() limit 1),
    case when auth.role() = 'service_role' then 'service' end
  ) into v_role;
  if v_role is null or v_role not in ('service', 'admin', 'coach') then
    raise exception 'provision_program_copy : accès refusé' using errcode = 'insufficient_privilege';
  end if;
$motif$;
  v_neuf  constant text := $neuf$  -- ── AUTORISATION (P13-B/5, 11/10/2026) ──────────────────────────────────
  -- L'ancienne garde lisait `profiles.role in ('service','admin','coach')`.
  -- Elle était juste avant P13-B — `coach` y désignait un staff forcément
  -- global. Depuis P13-B, `profiles.role` vaut 'coach' pour TOUT le staff non
  -- administrateur, collaborateurs compris : la garde laissait donc un
  -- collaborateur SANS permission ni affectation créer un programme et une
  -- affectation pour n'importe quel élève, hors RLS (cette fonction est
  -- SECURITY DEFINER). Mesuré sur PostgreSQL 16 local : élèves visibles 0,
  -- programmes visibles 0, catégories {} — et la copie créée quand même.
  --
  -- Quatre chemins, dans cet ordre, et rien d'autre :
  --   1. `service_role` — webhook Stripe et cron. Inchangé.
  --   2. l'ADMINISTRATEUR RÉEL, par `public.is_admin()` (profiles.role =
  --      'admin'), et non par l'étiquette `coaches.role` ni par le simple
  --      fait d'être 'coach'.
  --   3. tout autre appelant doit avoir l'élève dans
  --      `public.student_ids_entrainement_ecriture()` — l'intersection de sa
  --      PORTÉE et de la catégorie `entrainement` au niveau `ecriture`. Pour
  --      un coach autonome c'est l'ensemble de SES élèves ; pour un
  --      collaborateur, l'affectation explicite ET la permission, les deux
  --      étant nécessaires puisque l'ensemble est construit par leur
  --      intersection (migration 20261011090000).
  --   4. tout le reste est refusé.
  --
  -- FAIL-CLOSED SUR LES NULL. `x in (select …)` vaut NULL — et non false —
  -- quand `x` est NULL : un `elsif NULL then` ne prend pas la branche, mais
  -- on ne s'en remet pas à cette subtilité. `p_student_id is null` est refusé
  -- explicitement AVANT, et le test d'appartenance est enveloppé dans
  -- `coalesce(…, false)`. Un identifiant inconnu n'appartient à aucun
  -- ensemble : il tombe dans le même refus.
  v_role := coalesce(public.staff_role(), 'inconnu');
  if coalesce(auth.role(), '') = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'provision_program_copy : accès refusé' using errcode = 'insufficient_privilege';
  elsif coalesce(public.is_admin(), false) then
    null;
  elsif p_student_id is null then
    raise exception 'provision_program_copy : accès refusé' using errcode = 'insufficient_privilege';
  elsif coalesce(
          p_student_id in (select public.student_ids_entrainement_ecriture()),
          false
        ) then
    null;
  else
    raise exception 'provision_program_copy : accès refusé' using errcode = 'insufficient_privilege';
  end if;

$neuf$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'provision_program_copy'
     and pg_get_function_identity_arguments(p.oid) = 'p_program_id uuid, p_student_id uuid, p_checkout_session_id text';
  if v_def is null then
    raise exception 'P13-B/5 : public.provision_program_copy(uuid, uuid, text) introuvable — correctif à revoir';
  end if;

  -- La migration est REJOUABLE : si la nouvelle garde est déjà en place, il
  -- n'y a rien à faire, et surtout rien à réécrire.
  if position(v_neuf in v_def) > 0 then
    raise notice 'P13-B/5 : garde déjà en place, rien à faire';
    return;
  end if;

  v_n := (length(v_def) - length(replace(v_def, v_motif, ''))) / length(v_motif);
  if v_n <> 1 then
    raise exception
      'P13-B/5 : la garde attendue apparaît % fois (1 requise) — la fonction a changé depuis la revue, correctif à revoir', v_n;
  end if;

  execute replace(v_def, v_motif, v_neuf);
end $g$;


-- ── 2. PROPRIÉTAIRE ET DROITS, RÉAFFIRMÉS ──────────────────────────────────
-- `create or replace` les conserve ; on ne le suppose pas. Mêmes règles qu'en
-- 20260801120000 et 20260801210000 : ni PUBLIC, ni `anon`.
alter function public.provision_program_copy(uuid, uuid, text) owner to postgres;
revoke all on function public.provision_program_copy(uuid, uuid, text) from public;
revoke execute on function public.provision_program_copy(uuid, uuid, text) from anon;
grant execute on function public.provision_program_copy(uuid, uuid, text) to authenticated, service_role;

comment on function public.provision_program_copy(uuid, uuid, text) is
  'Copie individuelle d''un programme, transactionnelle et idempotente. Autorisation (P13-B/5) : service_role, ou public.is_admin(), ou élève appartenant à public.student_ids_entrainement_ecriture() — pour un collaborateur, affectation explicite ET permission entrainement/ecriture. Les deux sont nécessaires.';


-- ── 3. LA GARDE DE LA MIGRATION ────────────────────────────────────────────
-- Si l'ancienne règle revenait, ou si la nouvelle n'était pas en place, la
-- migration refuse de passer pour verte.
do $g$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'provision_program_copy';

  if position($x$not in ('service', 'admin', 'coach')$x$ in v_def) > 0 then
    raise exception 'P13-B/5 : l''ancienne garde profiles.role in (admin, coach) est encore en place';
  end if;
  if position('student_ids_entrainement_ecriture' in v_def) = 0 then
    raise exception 'P13-B/5 : la nouvelle garde n''oppose pas la portée entrainement/ecriture';
  end if;
  if position('public.is_admin()' in v_def) = 0 then
    raise exception 'P13-B/5 : les droits globaux ne suivent pas public.is_admin()';
  end if;
  if position('coalesce(' in v_def) = 0 then
    raise exception 'P13-B/5 : le test d''appartenance n''est pas fail-closed sur les NULL';
  end if;
  -- Le corps fonctionnel est intact : ces quatre marqueurs viennent des trois
  -- migrations qui ont construit la copie, et aucun ne doit avoir disparu.
  if position('pg_advisory_xact_lock' in v_def) = 0
     or position('source_checkout_session_id' in v_def) = 0
     or position('training_prescriptions' in v_def) = 0
     or position('recommended_rpe' in v_def) = 0 then
    raise exception 'P13-B/5 : le corps de la copie a été altéré par la substitution';
  end if;
  -- Et personne d'autre que authenticated et service_role ne l'exécute.
  if (select has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p where p.pronamespace='public'::regnamespace
         and p.proname='provision_program_copy') then
    raise exception 'P13-B/5 : anon peut exécuter provision_program_copy';
  end if;
end $g$;
