-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/7 — L'ADMINISTRATEUR RÉEL N'A PAS BESOIN D'UNE FICHE `coaches`    ║
-- ║ Migration ADDITIVE. Aucune des six précédentes n'est modifiée.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT, TEL QUE MESURÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Signalé le 13/10/2026 : « je n'arrive plus à enregistrer des modifications
-- sur mes programmes », avec le bandeau
--
--     « Une partie du programme n'a pas pu être enregistrée. Recharge la page
--       et vérifie le contenu avant de réessayer — n'enregistre pas
--       par-dessus. »
--
-- Ce message est `STRUCTURE_INCOMPLETE` (lib/admin-builder-save.ts), levé par
-- `updateProgram` quand `diffProgramStructure` n'a pas pu écrire toutes les
-- séances. Reproduit sur PostgreSQL 16 local, pour un compte
-- `profiles.role = 'admin'` SANS fiche `coaches` active :
--
--   staff_role()                          → NULL
--   est_staff_global()                    → NULL
--   is_admin()                            → true
--   programme dans program_ids_ecriture() → NON
--   lecture des semaines existantes       → 0   (il y en a 1)
--   insertion d'une semaine               → REFUS 42501
--
-- Le builder lit donc ZÉRO semaine, croit devoir toutes les créer, se fait
-- refuser, et déclare la structure incomplète. Aucune donnée n'est perdue —
-- c'est le garde-fou du 25/08 qui fait son travail — mais plus rien ne
-- s'enregistre.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CAUSE : DEUX SIGNAUX D'ADMINISTRATEUR, ET UN SEUL EST CONSULTÉ
-- ════════════════════════════════════════════════════════════════════════════
-- P13-B distingue, à juste titre, deux choses :
--
--   · `is_admin()`      — l'ADMINISTRATEUR RÉEL de la plateforme, porté par
--                         `profiles.role = 'admin'` ;
--   · `staff_role()`    — l'étiquette P13-B, lue dans `coaches.role`, et qui
--                         exige une fiche `coaches` au statut `actif`.
--
-- `est_staff_global()` ne regardait QUE le second :
--
--     select public.staff_role() in ('admin','assistant');
--
-- Un administrateur réel sans fiche `coaches` — ou dont la fiche est passée à
-- `inactif` — perd donc `est_staff_global()`, et avec lui les deux ensembles
-- `program_ids_lecture()` / `program_ids_ecriture()`, dont la branche
-- « programme modèle » (owner_student_id is null) repose dessus. C'est la
-- distinction que la migration 20261011130000 avait établie pour la garde de
-- `provision_program_copy` ; elle n'a pas été propagée ici.
--
-- ⚠️ ET LA FONCTION RENDAIT NULL, PAS false. `staff_role()` NULL donne
-- `null in ('admin','assistant')` = NULL. Les policies traitaient ce NULL
-- comme un refus, par chance et non par écrit : un `or` mal placé ailleurs
-- aurait pu en faire une autorisation.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CE CORRECTIF N'ÉLARGIT PAS
-- ════════════════════════════════════════════════════════════════════════════
-- `is_admin()` lit `profiles.role = 'admin'`. Depuis P13-B, un collaborateur
-- et un coach autonome portent `profiles.role = 'coach'` : aucun d'eux ne
-- devient « staff global » par cette correction. Le seul compte qui change de
-- verdict est celui qui est DÉJÀ administrateur de la plateforme et à qui il
-- manquait une ligne dans `coaches` — un compte à qui toutes les policies
-- `..._manage_admin` accordent déjà le même pouvoir, par ce même `is_admin()`.
--
-- Rien d'autre n'est touché : ni les ensembles par catégorie, ni les policies,
-- ni les gardes des fonctions SECURITY DEFINER. Une seule fonction change, et
-- toutes celles qui l'appellent en héritent.

begin;

create or replace function public.est_staff_global()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- ⚠️ FAIL-CLOSED. `coalesce(..., false)` sur les deux branches : une fiche
  -- absente rend NULL, et NULL ne doit jamais être lu comme « peut-être oui »
  -- par une policy qui l'enchaîne avec un `or`.
  select coalesce(public.is_admin(), false)
      or coalesce(public.staff_role() in ('admin', 'assistant'), false);
$fn$;

alter function public.est_staff_global() owner to postgres;
revoke all on function public.est_staff_global() from public;
revoke execute on function public.est_staff_global() from anon;
grant execute on function public.est_staff_global() to authenticated, service_role;

comment on function public.est_staff_global() is
  'Staff à portée globale : l''administrateur RÉEL (profiles.role = admin, '
  'via is_admin()) ou un staff dont coaches.role vaut admin/assistant sur une '
  'fiche active. P13-B/7 : is_admin() ajouté — un administrateur sans fiche '
  'coaches perdait les programmes modèles et ne pouvait plus enregistrer.';

-- ── VÉRIFICATION FINALE ───────────────────────────────────────────────────
do $g$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'est_staff_global';
  if v_def is null then
    raise exception 'P13-B/7 : public.est_staff_global() introuvable';
  end if;
  if position('is_admin' in v_def) = 0 then
    raise exception 'P13-B/7 : is_admin() n''est pas consulté — le défaut subsiste';
  end if;
  if position('staff_role' in v_def) = 0 then
    raise exception 'P13-B/7 : staff_role() a disparu — le coach autonome perdrait sa portée';
  end if;
  if (length(v_def) - length(replace(v_def, 'coalesce', ''))) / length('coalesce') < 2 then
    raise exception 'P13-B/7 : la fonction n''est pas fail-closed sur les NULL';
  end if;
  if not pg_catalog.obj_description(
       (select p.oid from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = 'est_staff_global'),
       'pg_proc') is not null then
    raise exception 'P13-B/7 : le commentaire explicatif manque';
  end if;
  if has_function_privilege(
       'anon',
       (select p.oid from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = 'est_staff_global'),
       'EXECUTE') then
    raise exception 'P13-B/7 : anon peut exécuter est_staff_global()';
  end if;
  raise notice 'P13-B/7 : est_staff_global() reconnaît l''administrateur réel, et est fail-closed.';
end $g$;

commit;
