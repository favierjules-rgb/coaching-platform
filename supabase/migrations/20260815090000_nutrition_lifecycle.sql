-- ============================================================================
-- Migration 20260815090000 — CYCLE DE VIE des plans alimentaires et des
-- recettes : publication, archivage, et suppression définitive SÛRE.
-- (chantier feat/nutrition-lifecycle, PR D)
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI EXISTAIT DÉJÀ, ET QUI N'EST DONC PAS RECRÉÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Les TROIS STATUTS demandés existent déjà des deux côtés :
--
--   nutrition_plans.status   : 'prochain' | 'actif' | 'ancien'
--                              ↳ contrainte nutrition_plans_status_check
--                              ↳ traduits en Brouillon / Actif / Archivé par
--                                STATUS_DB_TO_APP (lib/supabase/nutrition.ts)
--   nutrition_recipes.status : 'draft' | 'active' | 'archived'
--                              ↳ contrainte nutrition_recipes_status_check
--                              ↳ 'active' EST l'état « publiée »
--
-- Aucune colonne de statut n'est donc ajoutée, aucune valeur n'est renommée,
-- aucune contrainte CHECK n'est réécrite : renommer 'active' en 'published'
-- serait une migration de données destructrice pour un gain nul, et casserait
-- les trois policies élèves qui comparent littéralement `status = 'active'`.
-- La CARTOGRAPHIE proposée dans la demande est donc déjà en place :
--   recette active → publiée ; recette inactive → brouillon ou archivée ;
--   plan utilisable → actif ; autre plan → brouillon, sauf archive prouvée.
--
-- N'existaient PAS, et sont créés ici :
--   1. la DATE d'archivage (aucune colonne ne la portait) ;
--   2. l'interdiction, côté base, d'assigner un plan brouillon ou archivé ;
--   3. l'invisibilité d'un brouillon pour l'élève (la RLS ne regardait que
--      `student_id`, jamais le statut) ;
--   4. tout chemin de suppression définitive — il n'en existait AUCUN, ni en
--      SQL, ni en TypeScript, pour aucune des sept tables du domaine ;
--   5. la lecture agrégée qui alimente les compteurs de l'interface.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI LA SUPPRESSION DOIT ÊTRE UNE FONCTION, ET PAS UN `.delete()`
-- ────────────────────────────────────────────────────────────────────────────
-- Trois clés étrangères pointent vers `nutrition_plans`, toutes en CASCADE :
--
--   nutrition_daily_logs.nutrition_plan_id  → CASCADE   ← LE JOURNAL DE L'ÉLÈVE
--   nutrition_days.plan_id                  → CASCADE   → meals CASCADE
--   nutrition_plan_profiles.plan_id         → CASCADE   → slot_targets CASCADE
--
-- Un `delete from nutrition_plans` détruirait donc SILENCIEUSEMENT tout le
-- suivi quotidien de l'élève — exactement la « suppression en cascade
-- incontrôlée » à proscrire. La policy `nutrition_plans_manage_staff` est un
-- `for all` : le privilège DELETE est déjà accordé à `authenticated`. Rien,
-- aujourd'hui, n'empêche un appel direct depuis le navigateur.
--
-- La protection ne peut donc pas vivre dans l'interface. Elle vit ici :
--   - `nutrition_plan_deletion_block()` / `nutrition_recipe_deletion_block()`
--     calculent le motif de blocage, en lecture seule ;
--   - `delete_nutrition_plan()` / `delete_nutrition_recipe()` les rappellent
--     APRÈS avoir verrouillé la ligne, DANS la même transaction, puis
--     suppriment les enfants un par un, explicitement, en comptant.
--
-- Le booléen calculé par le navigateur n'est jamais reçu, jamais lu, jamais
-- accordé le moindre crédit : les deux fonctions ne prennent qu'un `uuid`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - elle ne supprime AUCUNE donnée : pas un plan, pas une recette, pas un
--     repas, pas un jour, pas une ligne de journal ;
--   - elle ne modifie aucune formule nutritionnelle et ne touche pas au
--     solveur de recettes ;
--   - elle ne change ni `save_nutrition_plan_v2`, ni `save_nutrition_recipe`,
--     ni `nutrition_plan_v2_blocking_issue`, ni `unassign_nutrition_plan` ;
--   - elle n'accorde aucun privilège nouveau à `anon`.
--
-- Elle est rejouable : tout est `create or replace` / `if not exists` /
-- `drop policy if exists` + `create policy`.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. LA DATE D'ARCHIVAGE
-- ════════════════════════════════════════════════════════════════════════════
-- Demandée par l'interface d'administration (« statut, date d'archivage »).
-- Nullable : elle n'a de sens que pour une ressource archivée, et `null` dit
-- exactement « celle-ci ne l'est pas ». Aucun DEFAULT : une valeur par défaut
-- ferait croire que tout a été archivé à la date de la migration.

alter table public.nutrition_plans
  add column if not exists archived_at timestamp with time zone;

alter table public.nutrition_recipes
  add column if not exists archived_at timestamp with time zone;

comment on column public.nutrition_plans.archived_at is
  'Date d''archivage (statut ''ancien''). NULL pour un brouillon ou un plan actif. Maintenue par le trigger nutrition_plans_archived_at : jamais saisie à la main.';

comment on column public.nutrition_recipes.archived_at is
  'Date d''archivage (statut ''archived''). NULL pour un brouillon ou une recette publiée. Maintenue par le trigger nutrition_recipes_archived_at : jamais saisie à la main.';

-- ── Reprise des données existantes ──────────────────────────────────────────
-- Une ressource DÉJÀ archivée reçoit `updated_at` : c'est la meilleure
-- approximation disponible de la date à laquelle elle l'a été, et c'est une
-- valeur réelle plutôt qu'une invention. Rien d'autre n'est touché : le
-- `where` exclut tout ce qui n'est pas archivé, et `archived_at is null`
-- rend l'instruction idempotente.
update public.nutrition_plans
   set archived_at = updated_at
 where status = 'ancien'
   and archived_at is null;

update public.nutrition_recipes
   set archived_at = updated_at
 where status = 'archived'
   and archived_at is null;

-- ── Le maintien automatique ─────────────────────────────────────────────────
-- POURQUOI UN TRIGGER plutôt qu'une écriture dans les RPC : le statut d'un
-- plan est modifié par `updateNutritionPlanStatus` (un UPDATE direct), celui
-- d'une recette par `save_nutrition_recipe`, et rien n'interdit un troisième
-- chemin demain. Une seule règle, posée sous tous les chemins d'écriture, ne
-- peut pas être oubliée.
--
-- La valeur qui signifie « archivé » diffère d'une table à l'autre ('ancien'
-- contre 'archived') : elle est passée en argument du trigger plutôt que
-- codée en dur, ce qui évite deux fonctions jumelles.
create or replace function public.nutrition_touch_archived_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_archive constant text := tg_argv[0];
begin
  if new.status = v_archive then
    -- Entrée en archive : on date, une seule fois. Un archivage déjà daté
    -- conserve sa date d'origine — ré-enregistrer une recette archivée ne
    -- doit pas repousser sa date d'archivage.
    if new.archived_at is null then
      new.archived_at := now();
    end if;
  else
    -- Sortie d'archive (restauration) : la date n'a plus d'objet. La laisser
    -- ferait apparaître « archivée le … » sur une ressource restaurée.
    new.archived_at := null;
  end if;
  return new;
end;
$fn$;

alter function public.nutrition_touch_archived_at() owner to postgres;

comment on function public.nutrition_touch_archived_at() is
  'Trigger BEFORE INSERT/UPDATE : date l''entrée en archive et efface la date à la sortie. La valeur de statut signifiant « archivé » est passée en TG_ARGV[0] (''ancien'' pour nutrition_plans, ''archived'' pour nutrition_recipes). security invoker, search_path vide, ne lit aucune table.';

revoke all on function public.nutrition_touch_archived_at() from public;
revoke execute on function public.nutrition_touch_archived_at() from anon;
revoke execute on function public.nutrition_touch_archived_at() from authenticated;

drop trigger if exists nutrition_plans_archived_at on public.nutrition_plans;
create trigger nutrition_plans_archived_at
  before insert or update on public.nutrition_plans
  for each row
  execute function public.nutrition_touch_archived_at('ancien');

drop trigger if exists nutrition_recipes_archived_at on public.nutrition_recipes;
create trigger nutrition_recipes_archived_at
  before insert or update on public.nutrition_recipes
  for each row
  execute function public.nutrition_touch_archived_at('archived');


-- ════════════════════════════════════════════════════════════════════════════
-- B. UN BROUILLON N'EST JAMAIS VISIBLE PAR L'ÉLÈVE
-- ════════════════════════════════════════════════════════════════════════════
-- Jusqu'ici, la seule condition de lecture élève était `student_id =
-- current_student_id()`. Un plan encore en brouillon mais déjà assigné était
-- donc entièrement visible : objectifs, sept jours, repas prescrits.
--
-- Un plan ARCHIVÉ, lui, reste lisible : « conservé pour les élèves déjà
-- assignés » est explicitement demandé, et retirer la lecture ferait
-- disparaître l'historique sous les pieds de l'élève.
--
-- Chaque policy est recréée à l'IDENTIQUE, à la seule addition de la clause
-- de statut. Aucune autre condition n'est ajoutée, retirée ou réordonnée.

drop policy if exists "nutrition_plans_select_self_or_assigned" on public.nutrition_plans;
create policy "nutrition_plans_select_self_or_assigned" on public.nutrition_plans
  for select
  using (
    student_id = public.current_student_id()
    and status <> 'prochain'
  );

drop policy if exists "nutrition_days_select_self_or_assigned" on public.nutrition_days;
create policy "nutrition_days_select_self_or_assigned" on public.nutrition_days
  for select
  using (
    exists (
      select 1 from public.nutrition_plans p
       where p.id = nutrition_days.plan_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  );

-- L'élève VALIDE ses journées (outil 1). Sur un plan encore en brouillon,
-- cette écriture n'a pas lieu d'être : il ne devrait même pas savoir que le
-- plan existe.
drop policy if exists "nutrition_days_update_self" on public.nutrition_days;
create policy "nutrition_days_update_self" on public.nutrition_days
  for update
  using (
    exists (
      select 1 from public.nutrition_plans p
       where p.id = nutrition_days.plan_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  )
  with check (
    exists (
      select 1 from public.nutrition_plans p
       where p.id = nutrition_days.plan_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  );

drop policy if exists "meals_select_self_or_assigned" on public.meals;
create policy "meals_select_self_or_assigned" on public.meals
  for select
  using (
    exists (
      select 1
        from public.nutrition_days d
        join public.nutrition_plans p on p.id = d.plan_id
       where d.id = meals.nutrition_day_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  );

drop policy if exists "nutrition_plan_profiles_select_assigned" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_select_assigned" on public.nutrition_plan_profiles
  for select
  using (
    exists (
      select 1 from public.nutrition_plans p
       where p.id = nutrition_plan_profiles.plan_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  );

drop policy if exists "nutrition_meal_slot_targets_select_assigned" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_select_assigned" on public.nutrition_meal_slot_targets
  for select
  using (
    exists (
      select 1
        from public.nutrition_plan_profiles pr
        join public.nutrition_plans p on p.id = pr.plan_id
       where pr.id = nutrition_meal_slot_targets.profile_id
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
    )
  );

-- ── Le catalogue de recettes suit la même règle ─────────────────────────────
-- L'accès élève à une recette passe par le plan assigné (migration
-- 20260813090000). Si ce plan est un brouillon, il n'ouvre rien : ni le plan,
-- ni le catalogue du coach qui le porte. La condition `status = 'active'` sur
-- la recette elle-même est CONSERVÉE telle quelle — un brouillon ou une
-- archive de recette n'a jamais été lisible, et ne le devient pas.

drop policy if exists "nutrition_recipes_select_student" on public.nutrition_recipes;
create policy "nutrition_recipes_select_student" on public.nutrition_recipes
  for select
  using (
    status = 'active'
    and exists (
      select 1 from public.nutrition_plans p
       where p.student_id = public.current_student_id()
         and p.status <> 'prochain'
         and p.coach_id is not null
         and p.coach_id = nutrition_recipes.coach_id
    )
  );

drop policy if exists "nutrition_recipe_ingredients_select_student" on public.nutrition_recipe_ingredients;
create policy "nutrition_recipe_ingredients_select_student" on public.nutrition_recipe_ingredients
  for select
  using (
    exists (
      select 1
        from public.nutrition_recipes r
        join public.nutrition_plans p on p.coach_id = r.coach_id
       where r.id = nutrition_recipe_ingredients.recipe_id
         and r.status = 'active'
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
         and p.coach_id is not null
    )
  );

drop policy if exists "nutrition_recipe_tags_select_student" on public.nutrition_recipe_tags;
create policy "nutrition_recipe_tags_select_student" on public.nutrition_recipe_tags
  for select
  using (
    exists (
      select 1
        from public.nutrition_recipes r
        join public.nutrition_plans p on p.coach_id = r.coach_id
       where r.id = nutrition_recipe_tags.recipe_id
         and r.status = 'active'
         and p.student_id = public.current_student_id()
         and p.status <> 'prochain'
         and p.coach_id is not null
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- C. UN PLAN NON ACTIF N'EST PAS ASSIGNABLE
-- ════════════════════════════════════════════════════════════════════════════
-- « Archivé : … n'est plus assignable à de nouveaux élèves. » Masquer le plan
-- dans le sélecteur ne suffit pas : `assign_nutrition_plan` est accordée à
-- `authenticated` et s'appelle en une ligne depuis la console du navigateur.
--
-- La fonction est recréée à l'IDENTIQUE de 20260806090000, à une seule
-- addition près : le contrôle de statut, placé dans l'étape 2 — donc AVANT
-- toute écriture, comme tous les autres refus. Un refus ne modifie aucune
-- ligne et laisse le plan précédent de l'élève exactement en place.
--
-- Deux codes DISTINCTS de `PLAN_NOT_ASSIGNABLE` : ce dernier signale une
-- répartition incomplète, et son message français parle de protéines et de
-- glucides. Le réutiliser ici afficherait un contresens au coach.

create or replace function public.assign_nutrition_plan(p_plan_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_plan record;
  v_issue text;
  v_retires uuid[] := array[]::uuid[];
  v_row record;
begin
  -- ── 0. Autorisation ───────────────────────────────────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_plan_id is null or p_student_id is null then
    raise exception 'INVALID_ARGUMENT: p_plan_id et p_student_id sont obligatoires';
  end if;

  -- ── 1. VERROUILLAGE ───────────────────────────────────────────────────
  perform 1
     from public.nutrition_plans np
    where np.id = p_plan_id or np.student_id = p_student_id
    order by np.id
      for update;

  -- ── 2. VALIDATION COMPLÈTE, AVANT TOUTE ÉCRITURE ──────────────────────
  select np.id, np.name, np.status, np.student_id, np.nutrition_model_version
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  if not found then
    raise exception 'PLAN_NOT_FOUND: %', p_plan_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'STUDENT_NOT_FOUND: %', p_student_id using errcode = 'P0002';
  end if;

  -- ── 2 bis. LE STATUT (ajout PR D) ─────────────────────────────────────
  -- Seul un plan ACTIF est assignable. Réassigner le plan que l'élève a déjà
  -- reste idempotent quel que soit son statut : sans cette exception, un plan
  -- archivé alors qu'il était assigné deviendrait impossible à ré-enregistrer
  -- pour son propre élève.
  if v_plan.status <> 'actif' and v_plan.student_id is distinct from p_student_id then
    if v_plan.status = 'prochain' then
      raise exception 'PLAN_STATUS_DRAFT: %', p_plan_id using errcode = '23514';
    else
      raise exception 'PLAN_STATUS_ARCHIVED: %', p_plan_id using errcode = '23514';
    end if;
  end if;

  -- Plan v2 : validation canonique. Plan v1 : règles actuelles inchangées.
  if v_plan.nutrition_model_version = 2 then
    v_issue := public.nutrition_plan_v2_blocking_issue(p_plan_id);
    if v_issue is not null then
      raise exception 'PLAN_NOT_ASSIGNABLE: %', v_issue using errcode = '23514';
    end if;
  end if;

  -- ── 3. RETRAIT des autres plans de cet élève ──────────────────────────
  for v_row in
    update public.nutrition_plans np
       set student_id = null,
           updated_at = now()
     where np.student_id = p_student_id
       and np.id <> p_plan_id
    returning np.id
  loop
    v_retires := array_append(v_retires, v_row.id);
  end loop;

  -- ── 4. ASSIGNATION du plan choisi ─────────────────────────────────────
  update public.nutrition_plans np
     set student_id = p_student_id,
         updated_at = now()
   where np.id = p_plan_id
     and (np.student_id is distinct from p_student_id);

  -- ── 5. Retour canonique ───────────────────────────────────────────────
  select np.id, np.name, np.status, np.student_id, np.nutrition_model_version
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  return jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'status', v_plan.status,
      'student_id', v_plan.student_id,
      'nutrition_model_version', v_plan.nutrition_model_version
    ),
    'unassigned_plan_ids', to_jsonb(v_retires),
    'assigned', true
  );
end;
$fn$;

alter function public.assign_nutrition_plan(uuid, uuid) owner to postgres;

comment on function public.assign_nutrition_plan(uuid, uuid) is
  'Assignation ATOMIQUE d''un plan nutritionnel à un élève : verrouillage, validation complète AVANT toute écriture (statut ACTIF obligatoire depuis la PR D, puis répartition v2 complète), retrait des autres plans de l''élève, puis assignation — dans UNE transaction. Idempotente, y compris sur un plan archivé déjà assigné à cet élève. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. Point d''écriture UNIQUE de nutrition_plans.student_id.';

revoke all on function public.assign_nutrition_plan(uuid, uuid) from public;
revoke execute on function public.assign_nutrition_plan(uuid, uuid) from anon;
grant execute on function public.assign_nutrition_plan(uuid, uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- D. LE MOTIF DE BLOCAGE D'UNE SUPPRESSION — LECTURE SEULE
-- ════════════════════════════════════════════════════════════════════════════
-- Une seule définition de la règle, appelée à trois endroits : l'aperçu qui
-- alimente l'interface, la modale de confirmation, et la suppression
-- elle-même. Impossible que l'écran et la base ne disent pas la même chose.
--
-- Retourne NULL quand la suppression est permise, sinon l'un de :
--   'not_found'       la ressource n'existe pas (ou la RLS la masque)
--   'forbidden'       elle appartient à un autre coach
--   'assigned'        un élève y est rattaché — directement ou non
--   'used_in_history' un historique protégé la référence

create or replace function public.nutrition_plan_deletion_block(p_plan_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_plan record;
begin
  if p_plan_id is null then
    return 'not_found';
  end if;

  select np.id, np.coach_id, np.student_id
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  if not found then
    return 'not_found';
  end if;

  -- ── Propriété ─────────────────────────────────────────────────────────
  -- LE MODÈLE RÉEL : `nutrition_plans.coach_id` est nullable et AUCUN chemin
  -- d'écriture applicatif ne la renseigne (ni save_nutrition_plan_v2, ni
  -- assign_nutrition_plan). Sur un plan sans coach, il n'existe donc pas de
  -- propriétaire à opposer : la règle retombe sur la policy en vigueur —
  -- `nutrition_plans_manage_staff`, c'est-à-dire tout coach ou administrateur.
  -- Inventer une propriété absente du modèle rendrait tous les plans
  -- existants indéboulonnables. Dès que la colonne EST renseignée, elle est
  -- opposée strictement.
  if not public.is_coach_or_admin() then
    return 'forbidden';
  end if;
  if v_plan.coach_id is not null
     and not public.is_admin()
     and v_plan.coach_id is distinct from public.current_coach_id() then
    return 'forbidden';
  end if;

  -- ── Affectation ───────────────────────────────────────────────────────
  -- `nutrition_plans.student_id` est la source de vérité de l'affectation
  -- nutritionnelle (la table `assignments` ne sert qu'aux programmes et ne
  -- porte aucune clé étrangère vers ce domaine).
  if v_plan.student_id is not null then
    return 'assigned';
  end if;

  -- ── Historique protégé ────────────────────────────────────────────────
  -- Le journal quotidien de l'élève. Sa clé étrangère est en CASCADE : sans
  -- ce contrôle, supprimer le plan effacerait un suivi que personne n'a
  -- demandé à effacer. On ne supprime JAMAIS ces lignes pour rendre la
  -- suppression possible — on refuse la suppression.
  if exists (
    select 1 from public.nutrition_daily_logs l
     where l.nutrition_plan_id = p_plan_id
  ) then
    return 'used_in_history';
  end if;

  return null;
end;
$fn$;

alter function public.nutrition_plan_deletion_block(uuid) owner to postgres;

comment on function public.nutrition_plan_deletion_block(uuid) is
  'NULL si le plan peut être supprimé définitivement, sinon le motif : not_found | forbidden | assigned | used_in_history. Lecture seule, stable, security invoker, search_path vide. Règle UNIQUE, partagée par l''aperçu, la modale et delete_nutrition_plan.';

revoke all on function public.nutrition_plan_deletion_block(uuid) from public;
revoke execute on function public.nutrition_plan_deletion_block(uuid) from anon;
grant execute on function public.nutrition_plan_deletion_block(uuid) to authenticated;


create or replace function public.nutrition_recipe_deletion_block(p_recipe_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_recipe record;
begin
  if p_recipe_id is null then
    return 'not_found';
  end if;

  select r.id, r.coach_id, r.status
    into v_recipe
    from public.nutrition_recipes r
   where r.id = p_recipe_id;

  if not found then
    return 'not_found';
  end if;

  -- ── Propriété ─────────────────────────────────────────────────────────
  -- Ici, contrairement aux plans, la propriété EXISTE vraiment :
  -- `nutrition_recipes.coach_id` est NOT NULL et la policy
  -- `nutrition_recipes_manage_own_coach` s'y appuie déjà. On l'oppose donc
  -- strictement : le catalogue d'un coach n'appartient qu'à lui.
  if not public.is_coach_or_admin() then
    return 'forbidden';
  end if;
  if not public.is_admin()
     and v_recipe.coach_id is distinct from public.current_coach_id() then
    return 'forbidden';
  end if;

  -- ── Un élève peut-il encore l'atteindre ? ─────────────────────────────
  -- IL N'EXISTE AUCUNE RELATION DIRECTE recette ↔ élève dans ce modèle, et
  -- on n'en invente pas : `meals` ne porte aucune colonne `recipe_id`, et
  -- aucune quantité calculée n'est persistée. L'accès élève passe
  -- EXCLUSIVEMENT par la policy `nutrition_recipes_select_student`.
  --
  -- Le prédicat ci-dessous en est la COPIE EXACTE, débarrassée du seul
  -- `current_student_id()` (on demande « un élève », pas « cet élève-là »).
  -- Les deux ne peuvent donc pas diverger : si la policy n'ouvre rien, la
  -- suppression n'est pas bloquée ; si elle ouvre, la suppression est
  -- bloquée.
  if v_recipe.status = 'active' and exists (
    select 1 from public.nutrition_plans p
     where p.student_id is not null
       and p.status <> 'prochain'
       and p.coach_id is not null
       and p.coach_id = v_recipe.coach_id
  ) then
    return 'assigned';
  end if;

  -- ── Historique protégé ────────────────────────────────────────────────
  -- Aucune table ne conserve la trace d'une recette consommée : l'outil des
  -- recettes adaptatives est éphémère, par construction. Le contrôle
  -- ci-dessous n'est donc jamais vrai aujourd'hui — il est là pour que
  -- l'ajout futur d'une clé étrangère vers `nutrition_recipes` bloque la
  -- suppression au lieu de la casser en silence. La section I vérifie à
  -- l'application de la migration que cette hypothèse est exacte.
  if exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f'
       and c.confrelid = 'public.nutrition_recipes'::regclass
       and t.relname not in ('nutrition_recipe_ingredients', 'nutrition_recipe_tags')
  ) then
    return 'used_in_history';
  end if;

  return null;
end;
$fn$;

alter function public.nutrition_recipe_deletion_block(uuid) owner to postgres;

comment on function public.nutrition_recipe_deletion_block(uuid) is
  'NULL si la recette peut être supprimée définitivement, sinon le motif : not_found | forbidden | assigned | used_in_history. « assigned » reprend mot pour mot le prédicat de la policy nutrition_recipes_select_student : une recette qu''un élève peut encore atteindre par un plan assigné n''est pas supprimable. Lecture seule, stable, security invoker, search_path vide.';

revoke all on function public.nutrition_recipe_deletion_block(uuid) from public;
revoke execute on function public.nutrition_recipe_deletion_block(uuid) from anon;
grant execute on function public.nutrition_recipe_deletion_block(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LA SUPPRESSION DÉFINITIVE D'UN PLAN
-- ════════════════════════════════════════════════════════════════════════════
-- CINQ vérifications dans la MÊME transaction, dans cet ordre :
--   1. l'appelant est authentifié et coach ou administrateur ;
--   2. il est propriétaire, ou administrateur ;
--   3. aucun élève n'est affecté ;
--   4. aucun historique protégé ne référence le plan ;
--   5. les clés étrangères permettent réellement la suppression — vérifié
--      non pas en pariant, mais en supprimant les enfants un par un et en
--      laissant la base lever si l'un d'eux résiste.
--
-- La ligne est VERROUILLÉE avant les contrôles : une assignation concurrente
-- attend, puis trouve un plan déjà supprimé (elle lève PLAN_NOT_FOUND) ;
-- l'inverse est impossible.

create or replace function public.delete_nutrition_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_plan record;
  v_block text;
  v_meals int := 0;
  v_days int := 0;
  v_slots int := 0;
  v_profiles int := 0;
  v_logs int := 0;
begin
  -- ── 1. Authentification et rôle ───────────────────────────────────────
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_authenticated');
  end if;
  if not public.is_coach_or_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_staff');
  end if;

  if p_plan_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 2. VERROUILLAGE, puis relecture ───────────────────────────────────
  select np.id, np.name, np.status, np.student_id, np.coach_id
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 3. LA RÈGLE, RECALCULÉE ICI ───────────────────────────────────────
  -- Elle n'est jamais reçue de l'appelant : la fonction ne prend qu'un uuid.
  -- Un navigateur qui appellerait directement cette RPC obtient donc
  -- exactement le même verdict que celui affiché à l'écran.
  v_block := public.nutrition_plan_deletion_block(p_plan_id);
  if v_block is not null then
    select count(*) into v_logs
      from public.nutrition_daily_logs l
     where l.nutrition_plan_id = p_plan_id;
    return jsonb_build_object(
      'ok', false,
      'reason', v_block,
      'plan_id', p_plan_id,
      'dependencies', jsonb_build_object(
        'assigned_students', case when v_plan.student_id is null then 0 else 1 end,
        'daily_logs', v_logs
      )
    );
  end if;

  -- ── 4. SUPPRESSION EXPLICITE, ENFANT PAR ENFANT ───────────────────────
  -- On n'attend rien de la CASCADE : chaque table est nommée, comptée, et
  -- l'ordre respecte le RESTRICT de `nutrition_days_profile_fkey` (les jours
  -- partent AVANT les profils qu'ils référencent). Une table oubliée ferait
  -- lever la base au lieu de disparaître en silence.
  with supprimes as (
    delete from public.meals m
     where m.nutrition_day_id in (
       select d.id from public.nutrition_days d where d.plan_id = p_plan_id
     )
    returning 1
  )
  select count(*) into v_meals from supprimes;

  with supprimes as (
    delete from public.nutrition_days d where d.plan_id = p_plan_id returning 1
  )
  select count(*) into v_days from supprimes;

  with supprimes as (
    delete from public.nutrition_meal_slot_targets t
     where t.profile_id in (
       select pr.id from public.nutrition_plan_profiles pr where pr.plan_id = p_plan_id
     )
    returning 1
  )
  select count(*) into v_slots from supprimes;

  with supprimes as (
    delete from public.nutrition_plan_profiles pr where pr.plan_id = p_plan_id returning 1
  )
  select count(*) into v_profiles from supprimes;

  -- ── 5. Filet de sécurité ──────────────────────────────────────────────
  -- Le journal a déjà été déclaré vide par la règle. On le revérifie APRÈS
  -- verrouillage : si une ligne était apparue entre-temps, la transaction
  -- est annulée entièrement plutôt que de la laisser partir en CASCADE.
  if exists (
    select 1 from public.nutrition_daily_logs l where l.nutrition_plan_id = p_plan_id
  ) then
    raise exception 'PLAN_HISTORY_APPEARED: %', p_plan_id using errcode = '23503';
  end if;

  delete from public.nutrition_plans np where np.id = p_plan_id;

  if not found then
    -- La policy a laissé lire mais pas supprimer : on refuse explicitement
    -- plutôt que de renvoyer un succès qui n'a rien supprimé.
    raise exception 'PLAN_DELETE_REFUSED: %', p_plan_id using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan_id', p_plan_id,
    'name', v_plan.name,
    'deleted', jsonb_build_object(
      'meals', v_meals,
      'days', v_days,
      'meal_slot_targets', v_slots,
      'profiles', v_profiles
    )
  );
end;
$fn$;

alter function public.delete_nutrition_plan(uuid) owner to postgres;

comment on function public.delete_nutrition_plan(uuid) is
  'Suppression DÉFINITIVE d''un plan alimentaire, en UNE transaction : verrouillage de la ligne, recalcul du motif de blocage (nutrition_plan_deletion_block), puis suppression explicite des repas, jours, cibles de créneau et profils — jamais par CASCADE aveugle. Ne supprime JAMAIS une affectation ni une ligne de nutrition_daily_logs : leur présence refuse la suppression. Retour structuré { ok, reason: assigned|used_in_history|forbidden|not_found, dependencies }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.delete_nutrition_plan(uuid) from public;
revoke execute on function public.delete_nutrition_plan(uuid) from anon;
grant execute on function public.delete_nutrition_plan(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- F. LA SUPPRESSION DÉFINITIVE D'UNE RECETTE
-- ════════════════════════════════════════════════════════════════════════════
-- Même architecture. Les liaisons entre ingrédients (`linked_to_ingredient_id`
-- → `ON DELETE SET NULL` sur une colonne `recipe_id` NOT NULL) sont d'abord
-- neutralisées, exactement comme le fait déjà `save_nutrition_recipe` — sans
-- quoi la suppression des ingrédients échouerait sur la contrainte.

create or replace function public.delete_nutrition_recipe(p_recipe_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_recipe record;
  v_block text;
  v_ingredients int := 0;
  v_tags int := 0;
  v_eleves int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_authenticated');
  end if;
  if not public.is_coach_or_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_staff');
  end if;

  if p_recipe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.id, r.name, r.status, r.coach_id
    into v_recipe
    from public.nutrition_recipes r
   where r.id = p_recipe_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_block := public.nutrition_recipe_deletion_block(p_recipe_id);
  if v_block is not null then
    select count(distinct p.student_id) into v_eleves
      from public.nutrition_plans p
     where p.student_id is not null
       and p.status <> 'prochain'
       and p.coach_id is not null
       and p.coach_id = v_recipe.coach_id;
    return jsonb_build_object(
      'ok', false,
      'reason', v_block,
      'recipe_id', p_recipe_id,
      'dependencies', jsonb_build_object('students_with_access', v_eleves)
    );
  end if;

  -- Les liaisons d'abord : `ON DELETE SET NULL` sur une colonne NOT NULL ne
  -- peut pas s'appliquer. Même précaution que save_nutrition_recipe.
  update public.nutrition_recipe_ingredients i
     set linked_to_ingredient_id = null,
         link_ratio_bp = null
   where i.recipe_id = p_recipe_id
     and i.linked_to_ingredient_id is not null;

  with supprimes as (
    delete from public.nutrition_recipe_tags t where t.recipe_id = p_recipe_id returning 1
  )
  select count(*) into v_tags from supprimes;

  with supprimes as (
    delete from public.nutrition_recipe_ingredients i where i.recipe_id = p_recipe_id returning 1
  )
  select count(*) into v_ingredients from supprimes;

  delete from public.nutrition_recipes r where r.id = p_recipe_id;

  if not found then
    raise exception 'RECIPE_DELETE_REFUSED: %', p_recipe_id using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'recipe_id', p_recipe_id,
    'name', v_recipe.name,
    'deleted', jsonb_build_object('ingredients', v_ingredients, 'tags', v_tags)
  );
end;
$fn$;

alter function public.delete_nutrition_recipe(uuid) owner to postgres;

comment on function public.delete_nutrition_recipe(uuid) is
  'Suppression DÉFINITIVE d''une recette, en UNE transaction : verrouillage, recalcul du motif de blocage (nutrition_recipe_deletion_block), neutralisation des liaisons entre ingrédients, puis suppression explicite des étiquettes et des ingrédients. Refusée tant qu''un élève peut atteindre la recette par un plan assigné, et pour la recette d''un autre coach. Retour structuré { ok, reason: assigned|used_in_history|forbidden|not_found, dependencies }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.delete_nutrition_recipe(uuid) from public;
revoke execute on function public.delete_nutrition_recipe(uuid) from anon;
grant execute on function public.delete_nutrition_recipe(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- G. L'APERÇU DU CYCLE DE VIE — UNE SEULE REQUÊTE
-- ════════════════════════════════════════════════════════════════════════════
-- Les compteurs de l'interface (élèves affectés, statut, date d'archivage,
-- supprimable ou non, motif) sont calculés ICI, en un aller-retour, pour
-- toutes les ressources à la fois. Appeler `*_deletion_block` par ligne
-- depuis le navigateur serait exactement le N+1 à éviter.
--
-- `security invoker` : la RLS s'applique, donc un coach n'obtient que ce
-- qu'il a déjà le droit de lire. L'aperçu ne révèle rien de neuf.

create or replace function public.nutrition_lifecycle_overview()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_plans jsonb;
  v_recipes jsonb;
begin
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x->>'id'), '[]'::jsonb)
    into v_plans
    from (
      select jsonb_build_object(
               'id', np.id,
               'status', np.status,
               'archived_at', np.archived_at,
               'assigned_students', case when np.student_id is null then 0 else 1 end,
               'daily_logs', coalesce(l.n, 0),
               'deletion_block', public.nutrition_plan_deletion_block(np.id)
             ) as x
        from public.nutrition_plans np
        left join lateral (
          select count(*)::int as n
            from public.nutrition_daily_logs dl
           where dl.nutrition_plan_id = np.id
        ) l on true
    ) s;

  select coalesce(jsonb_agg(x order by x->>'id'), '[]'::jsonb)
    into v_recipes
    from (
      select jsonb_build_object(
               'id', r.id,
               'status', r.status,
               'archived_at', r.archived_at,
               -- Nombre d'élèves pouvant ACTUELLEMENT y accéder. Fiable :
               -- c'est le prédicat de la policy élève, au `current_student_id`
               -- près. Zéro dès que la recette n'est pas publiée.
               'students_with_access', case
                 when r.status <> 'active' then 0
                 else coalesce(a.n, 0)
               end,
               'deletion_block', public.nutrition_recipe_deletion_block(r.id)
             ) as x
        from public.nutrition_recipes r
        left join lateral (
          select count(distinct p.student_id)::int as n
            from public.nutrition_plans p
           where p.student_id is not null
             and p.status <> 'prochain'
             and p.coach_id is not null
             and p.coach_id = r.coach_id
        ) a on true
    ) s;

  return jsonb_build_object('plans', v_plans, 'recipes', v_recipes);
end;
$fn$;

alter function public.nutrition_lifecycle_overview() owner to postgres;

comment on function public.nutrition_lifecycle_overview() is
  'Aperçu du cycle de vie, en UN aller-retour : pour chaque plan et chaque recette visibles par l''appelant — statut, date d''archivage, nombre d''élèves concernés, et motif de blocage de suppression recalculé côté serveur. Évite le N+1. stable, security invoker (la RLS s''applique), search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated.';

revoke all on function public.nutrition_lifecycle_overview() from public;
revoke execute on function public.nutrition_lifecycle_overview() from anon;
grant execute on function public.nutrition_lifecycle_overview() to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- H. LES HYPOTHÈSES, VÉRIFIÉES À L'APPLICATION
-- ════════════════════════════════════════════════════════════════════════════
-- Les deux fonctions de suppression énumèrent les tables enfants à la main.
-- Une clé étrangère ajoutée demain sans mettre ces fonctions à jour les
-- rendrait fausses en silence. Ces contrôles transforment ce risque en échec
-- immédiat, au moment de l'application de la migration.

do $$
declare
  v_inattendu text;
begin
  -- Références vers nutrition_plans
  select string_agg(t.relname, ', ' order by t.relname)
    into v_inattendu
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
   where c.contype = 'f'
     and c.confrelid = 'public.nutrition_plans'::regclass
     and t.relname not in ('nutrition_days', 'nutrition_plan_profiles', 'nutrition_daily_logs');

  if v_inattendu is not null then
    raise exception
      'delete_nutrition_plan ne connaît pas ces tables référençant nutrition_plans : %. Mets la fonction à jour avant d''appliquer cette migration.',
      v_inattendu;
  end if;

  -- Références vers nutrition_recipes
  select string_agg(t.relname, ', ' order by t.relname)
    into v_inattendu
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
   where c.contype = 'f'
     and c.confrelid = 'public.nutrition_recipes'::regclass
     and t.relname not in ('nutrition_recipe_ingredients', 'nutrition_recipe_tags');

  if v_inattendu is not null then
    raise exception
      'delete_nutrition_recipe ne connaît pas ces tables référençant nutrition_recipes : %. Mets la fonction à jour avant d''appliquer cette migration.',
      v_inattendu;
  end if;
end;
$$;
