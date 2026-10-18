-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/11 — L'ADMINISTRATEUR RÉEL, PARTOUT OÙ IL MANQUAIT ENCORE        ║
-- ║ Migration ADDITIVE et CORRECTIVE. Aucune des dix précédentes n'est      ║
-- ║ modifiée : celle-ci redéfinit DEUX fonctions de catégorie et DEUX       ║
-- ║ fonctions de déclencheur, et rien d'autre.                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI A ÉTÉ MESURÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Un administrateur RÉEL — `profiles.role = 'admin'`, donc `is_admin()` vrai
-- et `est_staff_global()` vrai — mais SANS fiche `coaches` (ou dont la fiche
-- est inactive), dans une base portant les dix migrations P13-B :
--
--     is_admin()                        true
--     est_staff_global()                true      ← corrigé en 20261013100000
--     student_ids_portee()                 1      ← corrigé en 20261013100000
--     categories_lecture()                 0      ← JAMAIS CORRIGÉ
--     categories_ecriture()                0      ← JAMAIS CORRIGÉ
--     student_ids_suivi_eleve_lecture()    0
--
--     table student_profiles (fiches élèves)   0 ligne
--     table appointments (agenda)              0 ligne
--     table nutrition_plans                    0 ligne
--     table documents                          0 ligne
--     UPDATE students                          REFUSÉ
--
-- Soit : la fiche élève vide, l'agenda vide, la nutrition vide, les documents
-- vides, et l'impossibilité de modifier un élève — pour un administrateur.
--
-- ⚠️ ET DEUX DÉCLENCHEURS FAISAIENT LA MÊME ERREUR, EN PIRE : SANS RIEN DIRE.
-- Mesuré sur le même compte :
--
--     UPDATE students SET coach_id = …   « réussit », puis la valeur REVIENT
--     UPDATE students SET status   = …   « réussit », puis la valeur REVIENT
--     attribuer une offre à un élève     « réussit », puis la valeur REVIENT
--
-- `protect_students_ownership_columns` et
-- `protect_student_profiles_access_columns` recopient l'ancienne valeur au
-- lieu de lever : l'UPDATE rend « 1 ligne modifiée », l'interface affiche un
-- succès, et la modification n'a pas eu lieu. Un refus silencieux est plus
-- coûteux qu'un refus bruyant — c'est aussi ce qui a rendu ce défaut si
-- difficile à nommer depuis l'écran : « c'est comme si c'était en lecture
-- seule ».
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CAUSE, ET POURQUOI ELLE A SURVÉCU À LA MIGRATION 20261013100000
-- ════════════════════════════════════════════════════════════════════════════
-- Cette migration-là avait posé la bonne règle — « les droits GLOBAUX suivent
-- `public.is_admin()`, c'est-à-dire `profiles.role = 'admin'` » — et l'avait
-- appliquée à `est_staff_global()`, `student_ids_portee()` et
-- `coach_ids_portee()`.
--
-- Quatre endroits n'ont pas été relus à ce moment-là : les deux fonctions de
-- catégorie (20261011090000) et les deux déclencheurs de protection
-- (antérieurs à P13-B). Tous les quatre testent :
--
--     where public.staff_role() in ('admin', 'assistant')
--
-- c'est-à-dire `coaches.role` — l'étiquette de la FICHE, pas le rôle réel du
-- compte. Sans fiche active, `staff_role()` rend NULL, le `where` est faux, et
-- les deux fonctions ne rendent AUCUNE catégorie.
--
-- ⚠️ ET CE N'EST PAS UNE FUITE LOCALISÉE : vingt-deux fonctions de portée
-- s'enchaînent sur ces deux-là — `student_ids_<catégorie>_<niveau>()`,
-- `program_ids_lecture/ecriture()` — qui gardent elles-mêmes les policies de
-- `students`, `student_profiles`, `coach_notes`, `appointments`,
-- `nutrition_plans`, `documents`, `workout_*`, `training_*`. Une catégorie
-- absente les vide toutes d'un coup. C'est pour cette raison que le défaut se
-- présentait comme « des rubriques ont disparu » et « c'est en lecture
-- seule » plutôt que comme une erreur d'autorisation.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LE CORRECTIF
-- ════════════════════════════════════════════════════════════════════════════
-- `staff_role() in ('admin','assistant')` devient `est_staff_global()`, qui
-- est exactement `is_admin() OR staff_role() in ('admin','assistant')`. Le
-- staff global n'a donc plus qu'UNE définition dans tout le modèle, au lieu de
-- deux qui divergeaient.
--
-- ⚠️ CE QUE CELA N'ÉLARGIT PAS, ET LA CHECKLIST LE MESURE :
--   · un COLLABORATEUR : `is_admin()` est faux (son `profiles.role` vaut
--     'coach') et `staff_role()` vaut 'collaborateur' → la première branche
--     reste fausse, la seconde est inchangée. Ses catégories restent
--     exactement ses lignes de `collaborateur_permissions`, au niveau près ;
--   · un COACH AUTONOME : `staff_role() = 'assistant'` passait déjà par
--     l'ancienne branche. Verdict identique ;
--   · un COACH dont la fiche porte l'étiquette `admin` par l'effet de
--     l'ancien DEFAULT (voir 20261011120000) : `is_admin()` est faux, et
--     `staff_role() = 'admin'` le faisait DÉJÀ passer avant ce correctif.
--     Aucun changement — l'élévation que 20261011120000 a fermée l'était par
--     `student_ids_portee()`, qui borne la PORTÉE, et elle le reste ;
--   · un ÉLÈVE, un visiteur : `is_admin()` faux, `staff_role()` NULL. Rien.
--
-- Seul le compte dont `profiles.role = 'admin'` gagne quelque chose : les
-- quatre catégories, qu'il ait ou non une fiche `coaches`. C'est la règle
-- d'identification de l'administrateur déjà en vigueur partout ailleurs dans
-- le dépôt (`is_admin()`, les policies `*_manage_admin`, `requireAdmin()`).
--
-- ⚠️ `security definer` + `set search_path` CONSERVÉS À L'IDENTIQUE, ainsi que
-- `stable` et le type de retour : la checklist de sécurité J4
-- (« toute fonction SECURITY DEFINER exécutable par authenticated fixe son
-- search_path ») continue de passer, et aucun GRANT n'est touché.

begin;

create or replace function public.categories_lecture()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- ⚠️ `est_staff_global()` ET NON `staff_role() in (…)` : l'administrateur
  -- réel est reconnu par `profiles.role`, pas par l'étiquette de sa fiche.
  -- `coalesce(…, false)` par principe — la fonction est déjà fail-closed,
  -- mais une branche de `where` qui vaut NULL se lit mal.
  select unnest(array['entrainement', 'suivi_eleve', 'agenda_communication', 'nutrition'])
   where coalesce(public.est_staff_global(), false)
  union
  select p.categorie
    from public.collaborateur_permissions p
   where public.staff_role() = 'collaborateur'
     and p.collaborateur_id = public.current_staff_id();
$fn$;

create or replace function public.categories_ecriture()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select unnest(array['entrainement', 'suivi_eleve', 'agenda_communication', 'nutrition'])
   where coalesce(public.est_staff_global(), false)
  union
  select p.categorie
    from public.collaborateur_permissions p
   where public.staff_role() = 'collaborateur'
     and p.collaborateur_id = public.current_staff_id()
     and p.niveau = 'ecriture';
$fn$;

comment on function public.categories_lecture() is
  'P13-B — catégories LISIBLES par l''appelant. Staff global (public.est_staff_global() : '
  'profiles.role = admin OU coaches.role in (admin, assistant)) → les quatre. '
  'Collaborateur → ses lignes de collaborateur_permissions, tous niveaux confondus '
  '(« écriture implique lecture » est tenu ici). Corrigée en 20261019090000 : elle '
  'testait coaches.role seul, et un administrateur sans fiche coaches perdait '
  'fiches élèves, agenda, nutrition et documents.';

comment on function public.categories_ecriture() is
  'P13-B — catégories où l''appelant peut ÉCRIRE. Staff global → les quatre. '
  'Collaborateur → ses permissions de niveau ecriture uniquement. Corrigée en '
  '20261019090000, même cause que categories_lecture().';

-- ── LES DEUX DÉCLENCHEURS DE PROTECTION ───────────────────────────────────
--
-- ⚠️ CORPS REPRIS À L'IDENTIQUE, UNE SEULE LIGNE CHANGE DANS CHACUN : le test
-- du staff propriétaire. Les colonnes protégées, l'ordre, le court-circuit
-- `service_role` et le comportement « recopier l'ancienne valeur » sont
-- conservés tels quels — ce n'est pas le lot où l'on change la façon de
-- refuser, c'est le lot où l'on cesse de refuser à l'administrateur.

create or replace function public.protect_students_ownership_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- Contexte non-utilisateur : rien à protéger.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Le staff PROPRIÉTAIRE gère ses élèves : rattachement, accès et statut lui
  -- appartiennent. Un collaborateur n'est pas propriétaire.
  --
  -- ⚠️ `est_staff_global()` ET NON `staff_role() in (…)`. Testée sur la seule
  -- étiquette de la fiche, cette condition excluait l'administrateur RÉEL sans
  -- fiche `coaches` : il ne pouvait ni réaffecter un élève à un autre coach,
  -- ni le mettre en pause — et l'écran lui annonçait un succès.
  if coalesce(public.est_staff_global(), false) then
    return new;
  end if;

  -- Ni un élève, ni un collaborateur ne choisit le coach d'une fiche, son
  -- type d'accès, son statut, ni le compte auth auquel elle est rattachée.
  new.coach_id := old.coach_id;
  new.access_type := old.access_type;
  new.status := old.status;
  new.user_id := old.user_id;

  return new;
end;
$fn$;

create or replace function public.protect_student_profiles_access_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- ⚠️ MÊME CORRECTION, MÊME RAISON. L'administrateur réel sans fiche
  -- `coaches` ne pouvait pas attribuer d'offre à un élève : la valeur était
  -- recopiée en silence. Les SEPT colonnes protégées sont inchangées, et un
  -- collaborateur reste incapable d'y toucher — `est_staff_global()` est faux
  -- pour lui, quelles que soient ses catégories.
  if not coalesce(public.est_staff_global(), false) then
    new.billing_access_mode := old.billing_access_mode;
    new.assigned_stripe_plan := old.assigned_stripe_plan;
    new.assigned_stripe_price_id := old.assigned_stripe_price_id;
    new.access_note := old.access_note;
    new.access_updated_at := old.access_updated_at;
    new.access_updated_by := old.access_updated_by;
    new.assigned_subscription_template_id := old.assigned_subscription_template_id;
  end if;
  return new;
end;
$fn$;


-- ── VÉRIFICATION ──────────────────────────────────────────────────────────
do $g$
declare v_n int;
begin
  for v_n in
    select 1 from unnest(array['categories_lecture', 'categories_ecriture']) f
     where not exists (
       select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = f
          and p.prosecdef
          and pg_get_functiondef(p.oid) ~ 'est_staff_global'
          and p.proconfig::text ~ 'search_path')
  loop
    raise exception 'P13-B/11 : une fonction de catégorie ne reconnaît pas l''administrateur réel, ou a perdu son search_path';
  end loop;

  -- La branche collaborateur n'a pas bougé : les deux fonctions continuent de
  -- lire `collaborateur_permissions`, et seule celle d'écriture filtre le niveau.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('categories_lecture', 'categories_ecriture')
     and pg_get_functiondef(p.oid) ~ 'collaborateur_permissions'
     and pg_get_functiondef(p.oid) ~ 'staff_role\(\) = ''collaborateur''';
  if v_n <> 2 then
    raise exception 'P13-B/11 : la branche collaborateur a été perdue — le cloisonnement serait rouvert ou cassé';
  end if;

  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'categories_ecriture'
     and pg_get_functiondef(p.oid) ~ 'niveau = ''ecriture''';
  if v_n <> 1 then
    raise exception 'P13-B/11 : categories_ecriture() ne filtre plus le niveau — un collaborateur en lecture pourrait écrire';
  end if;

  -- Les deux déclencheurs reconnaissent l'administrateur réel, et protègent
  -- toujours les mêmes colonnes.
  for v_n in
    select 1 from unnest(array['protect_students_ownership_columns',
                               'protect_student_profiles_access_columns']) f
     where not exists (
       select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = f
          and p.prosecdef
          and pg_get_functiondef(p.oid) ~ 'est_staff_global'
          -- ⚠️ ON DÉPOUILLE LES COMMENTAIRES AVANT DE MESURER. Le corps
          -- EXPLIQUE qu'il n'emploie plus `staff_role() in (…)` : chercher
          -- cette tournure telle quelle faisait échouer la vérification sur
          -- sa propre explication.
          and regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
              !~ 'staff_role\(\) in')
  loop
    raise exception 'P13-B/11 : un déclencheur de protection ne reconnaît pas l''administrateur réel';
  end loop;

  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'protect_students_ownership_columns'
     and pg_get_functiondef(p.oid) ~ 'new\.coach_id := old\.coach_id'
     and pg_get_functiondef(p.oid) ~ 'new\.access_type := old\.access_type'
     and pg_get_functiondef(p.oid) ~ 'new\.status := old\.status'
     and pg_get_functiondef(p.oid) ~ 'new\.user_id := old\.user_id';
  if v_n <> 1 then
    raise exception 'P13-B/11 : protect_students_ownership_columns ne protège plus les quatre colonnes de propriété';
  end if;

  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'protect_student_profiles_access_columns'
     and pg_get_functiondef(p.oid) ~ 'new\.assigned_subscription_template_id := old\.assigned_subscription_template_id'
     and pg_get_functiondef(p.oid) ~ 'new\.assigned_stripe_plan := old\.assigned_stripe_plan'
     and pg_get_functiondef(p.oid) ~ 'new\.assigned_stripe_price_id := old\.assigned_stripe_price_id'
     and pg_get_functiondef(p.oid) ~ 'new\.billing_access_mode := old\.billing_access_mode';
  if v_n <> 1 then
    raise exception 'P13-B/11 : protect_student_profiles_access_columns ne protège plus les colonnes d''attribution';
  end if;

  -- Les deux déclencheurs sont toujours POSÉS sur leur table.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.students'::regclass and tgname = 'protect_students_ownership'
                    and not tgisinternal)
     or not exists (select 1 from pg_trigger
                     where tgrelid = 'public.student_profiles'::regclass and tgname = 'protect_access_columns'
                       and not tgisinternal) then
    raise exception 'P13-B/11 : un déclencheur de protection a été décroché de sa table';
  end if;

  -- Et `anon` n'a toujours rien.
  for v_n in
    select 1 from unnest(array['categories_lecture()', 'categories_ecriture()']) f
     where has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE')
  loop
    raise exception 'P13-B/11 : anon a récupéré l''EXECUTE d''une fonction de catégorie';
  end loop;

  raise notice 'P13-B/11 : l''administrateur réel retrouve ses quatre catégories, la réaffectation, le statut et l''attribution d''offre ; le collaborateur garde exactement les siennes.';
end $g$;

commit;
