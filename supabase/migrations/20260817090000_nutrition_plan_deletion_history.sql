-- ============================================================================
-- Migration 20260817090000 — la SEULE condition bloquant la suppression d'un
-- plan est un élève ACTUELLEMENT affecté.
-- (chantier feat/nutrition-lifecycle, correctif de règle métier)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE MIGRATION CORRECTIVE, ET PAS UNE RETOUCHE DE 20260815090000
-- ────────────────────────────────────────────────────────────────────────────
-- 20260815090000 et 20260816090000 sont DÉJÀ APPLIQUÉES en Production
-- (`db push --linked --dry-run` répond « Remote database is up to date »).
-- Elles sont donc IMMUABLES : les modifier laisserait le dépôt et la base
-- distante raconter deux histoires différentes, et la prochaine reconstruction
-- locale ne reproduirait plus l'état réel. Toute évolution passe désormais par
-- une migration NOUVELLE.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI CHANGE, ET POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- 20260815090000 refusait la suppression d'un plan dès qu'une journée de suivi
-- s'y rattachait. À l'usage, c'était trop restrictif : un plan sans aucun élève
-- affecté, dont il ne reste qu'un historique devenu sans objet, ne pouvait plus
-- être supprimé — seulement archivé.
--
-- LA RÈGLE DEVIENT :
--
--     un plan alimentaire peut être supprimé définitivement
--     SI ET SEULEMENT SI aucun élève n'y est actuellement affecté.
--
-- Les journées de suivi ne bloquent plus. Elles n'existent que par le plan
-- (`nutrition_daily_logs.nutrition_plan_id` est NOT NULL) et ne sont
-- référencées par aucune autre table : elles sont donc supprimées AVEC lui,
-- explicitement et en étant comptées, pour que le nombre annoncé à l'écran
-- avant le clic soit celui réellement effacé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI EST SUPPRIMÉ, CE QUI NE L'EST JAMAIS
-- ────────────────────────────────────────────────────────────────────────────
-- Carte des clés étrangères pointant vers `nutrition_plans`, relevée sur la
-- base réelle avant d'écrire cette migration :
--
--   nutrition_daily_logs.nutrition_plan_id   NOT NULL   ON DELETE CASCADE
--   nutrition_days.plan_id                   NOT NULL   ON DELETE CASCADE
--     └─ meals.nutrition_day_id                         ON DELETE CASCADE
--   nutrition_plan_profiles.plan_id          NOT NULL   ON DELETE CASCADE
--     └─ nutrition_meal_slot_targets.profile_id         ON DELETE CASCADE
--
-- Les cinq colonnes sont NOT NULL : aucune de ces lignes ne peut survivre au
-- plan autrement qu'en orpheline. Aucune table ne référence
-- `nutrition_daily_logs`. Les cinq sont donc supprimées, chacune NOMMÉE et
-- COMPTÉE — jamais laissée à la cascade, qui effacerait sans rien dire.
--
-- JAMAIS TOUCHÉS : `students` et `auth.users` ne sont que la CIBLE de clés
-- sortantes, rien ici ne les atteint ; et chaque `delete` est borné par
-- l'identifiant du plan, de ses jours ou de ses profils — les données d'un
-- AUTRE plan sont hors de portée par construction.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - elle ne supprime AUCUNE donnée à son application : elle ne fait que
--     remplacer deux fonctions ;
--   - elle ne touche ni au schéma, ni aux policies, ni aux privilèges, ni aux
--     triggers, ni à `delete_nutrition_recipe` — dont la règle (« supprimable
--     tant qu'aucun élève ne peut l'atteindre ») était déjà la bonne ;
--   - elle ne recopie pas 20260815090000 : seules les DEUX fonctions dont le
--     comportement change sont réémises, en `create or replace`.
--
-- Elle est rejouable, et son annulation consiste à réappliquer les deux
-- définitions de 20260815090000.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE MOTIF DE BLOCAGE — le journal quotidien n'en fait plus partie
-- ════════════════════════════════════════════════════════════════════════════
-- Signature, volatilité, sécurité, propriétaire et privilèges INCHANGÉS : seul
-- le corps évolue, donc `nutrition_lifecycle_overview` et la modale héritent
-- de la nouvelle règle sans être modifiées. Une seule définition de la règle,
-- toujours.

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

  -- ── Le journal quotidien NE BLOQUE PAS ────────────────────────────────
  -- RÈGLE MÉTIER, posée explicitement : un plan est supprimable dès qu'aucun
  -- élève n'y est ACTUELLEMENT affecté. Les journées de suivi déjà
  -- enregistrées n'ont plus de sujet une fois le plan disparu — elles
  -- n'existent que par lui (`nutrition_plan_id` est NOT NULL) et ne sont
  -- référencées par aucune autre table. Elles partent donc AVEC le plan,
  -- explicitement, dans `delete_nutrition_plan` — et l'interface l'annonce
  -- avant le clic.
  --
  -- Ce n'est PAS une cascade subie : la clé étrangère est certes en CASCADE,
  -- mais la fonction de suppression nomme la table et compte ses lignes, pour
  -- que le nombre affiché à l'écran soit celui réellement supprimé.

  -- ── Référence protégée INCONNUE ───────────────────────────────────────
  -- `delete_nutrition_plan` énumère à la main les tables filles. Si une clé
  -- étrangère vers `nutrition_plans` apparaissait sans que cette liste soit
  -- mise à jour, la suppression laisserait des orphelins ou échouerait au
  -- milieu. On refuse alors, plutôt que d'improviser.
  if exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f'
       and c.confrelid = 'public.nutrition_plans'::regclass
       and t.relname not in ('nutrition_days', 'nutrition_plan_profiles', 'nutrition_daily_logs')
  ) then
    return 'used_in_history';
  end if;

  return null;
end;
$fn$;

alter function public.nutrition_plan_deletion_block(uuid) owner to postgres;

comment on function public.nutrition_plan_deletion_block(uuid) is
  'NULL si le plan peut être supprimé définitivement, sinon le motif : not_found | forbidden | assigned | used_in_history. Depuis 20260817090000, LA SEULE condition métier bloquante est l''affectation d''un élève : les journées de suivi déjà enregistrées ne bloquent plus, elles sont supprimées avec le plan. « used_in_history » ne subsiste que comme garde-fou d''évolution du schéma. Lecture seule, stable, security invoker, search_path vide. Règle UNIQUE, partagée par l''aperçu, la modale et delete_nutrition_plan.';


-- ════════════════════════════════════════════════════════════════════════════
-- B. LA SUPPRESSION — le journal part avec le plan, explicitement
-- ════════════════════════════════════════════════════════════════════════════
-- Deux différences avec 20260815090000 :
--   1. `nutrition_daily_logs` est supprimée comme les quatre autres tables
--      filles, nommée et comptée, et le total remonte dans `deleted` ;
--   2. le filet de sécurité ne guette plus l'apparition d'une journée de suivi
--      mais celle d'une AFFECTATION — c'est désormais la seule chose qui
--      puisse invalider la décision entre le verrouillage et l'écriture.
--      `PLAN_ASSIGNED_APPEARED` annule alors toute la transaction : les jours,
--      les repas et le journal reviennent avec elle.

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

  -- Le journal quotidien de ce plan. Il est supprimé EXPLICITEMENT, et non
  -- laissé à la CASCADE, pour deux raisons : le compte remonté à l'écran est
  -- alors celui réellement supprimé, et le `where` nommé prouve qu'aucune
  -- ligne d'un autre plan n'est atteinte.
  with supprimes as (
    delete from public.nutrition_daily_logs l
     where l.nutrition_plan_id = p_plan_id
    returning 1
  )
  select count(*) into v_logs from supprimes;

  -- ── 5. Filet de sécurité ──────────────────────────────────────────────
  -- La règle a déclaré le plan libre de tout élève. On le revérifie APRÈS
  -- verrouillage, juste avant la suppression : si une affectation était
  -- apparue entre-temps, toute la transaction est annulée — les jours, les
  -- repas et le journal reviennent avec elle.
  if exists (
    select 1 from public.nutrition_plans np
     where np.id = p_plan_id and np.student_id is not null
  ) then
    raise exception 'PLAN_ASSIGNED_APPEARED: %', p_plan_id using errcode = '23503';
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
      'profiles', v_profiles,
      'daily_logs', v_logs
    )
  );
end;
$fn$;

alter function public.delete_nutrition_plan(uuid) owner to postgres;

comment on function public.delete_nutrition_plan(uuid) is
  'Suppression DÉFINITIVE d''un plan alimentaire, en UNE transaction : verrouillage de la ligne, recalcul du motif de blocage (nutrition_plan_deletion_block), puis suppression explicite des repas, jours, cibles de créneau, profils et journées de suivi — chaque table nommée et comptée, jamais par CASCADE aveugle. Depuis 20260817090000, SEULE condition bloquante : un élève actuellement affecté. Ne touche NI students, NI auth.users, NI la moindre ligne d''un autre plan. Retour structuré { ok, reason: assigned|used_in_history|forbidden|not_found, deleted, dependencies }. security invoker, search_path vide, EXECUTE réservé à authenticated.';


-- ────────────────────────────────────────────────────────────────────────────
-- Vérification à l'application
-- ────────────────────────────────────────────────────────────────────────────
-- Les deux fonctions doivent conserver EXACTEMENT leurs conventions : une
-- élévation de privilège introduite par inadvertance ici contournerait la RLS
-- sur cinq tables.
do $$
declare
  v_nb int;
begin
  select count(*) into v_nb
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname in ('nutrition_plan_deletion_block', 'delete_nutrition_plan')
     and p.prosecdef = false
     and r.rolname = 'postgres'
     and 'search_path=""' = any(p.proconfig);
  if v_nb <> 2 then
    raise exception 'les deux fonctions doivent rester security invoker, search_path vide, owner postgres (trouvé : %)', v_nb;
  end if;

  if has_function_privilege('anon', 'public.delete_nutrition_plan(uuid)', 'execute')
     or has_function_privilege('anon', 'public.nutrition_plan_deletion_block(uuid)', 'execute') then
    raise exception 'anon ne doit exécuter aucune de ces deux fonctions';
  end if;

  -- La liste des tables filles énumérées par `delete_nutrition_plan` doit
  -- couvrir TOUTES les clés étrangères pointant vers `nutrition_plans`. Une
  -- table ajoutée depuis laisserait des orphelins.
  if exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where c.contype = 'f'
       and c.confrelid = 'public.nutrition_plans'::regclass
       and t.relname not in ('nutrition_days', 'nutrition_plan_profiles', 'nutrition_daily_logs')
  ) then
    raise exception 'une table inconnue référence nutrition_plans : mets delete_nutrition_plan à jour avant d''appliquer cette migration';
  end if;
end;
$$;
