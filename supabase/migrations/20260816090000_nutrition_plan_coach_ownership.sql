-- ============================================================================
-- Migration 20260816090000 — le PROPRIÉTAIRE d'un plan alimentaire.
-- (chantier feat/nutrition-lifecycle, correctif du risque nº1 de la PR D)
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE DÉFAUT, REPRODUIT AVANT D'ÊTRE CORRIGÉ
-- ────────────────────────────────────────────────────────────────────────────
-- `nutrition_plans.coach_id` est nullable depuis l'origine, et AUCUN chemin
-- d'écriture ne la renseignait : ni `save_nutrition_plan_v2` (son INSERT ne
-- nomme pas la colonne), ni `assign_nutrition_plan`, ni la couche TypeScript.
--
-- Or la lecture élève des recettes, posée par la migration 20260813090000,
-- exige exactement l'inverse :
--
--     create policy "nutrition_recipes_select_student" … using (
--       status = 'active'
--       and exists (select 1 from public.nutrition_plans p
--                    where p.student_id = public.current_student_id()
--                      and p.coach_id is not null            ← ICI
--                      and p.coach_id = nutrition_recipes.coach_id))
--
-- `p.coach_id is not null` est donc TOUJOURS faux en conditions réelles. La
-- séquence complète a été rejouée sur un PostgreSQL réel — création du plan
-- par la RPC, assignation, publication d'une recette par le coach du même
-- cabinet — et l'élève obtenait :
--
--     plans visibles    = 1
--     recettes visibles = 0
--
-- Autrement dit : tout l'outil des recettes adaptatives était invisible pour
-- chaque élève réel, alors même que chaque écran, chaque solveur et chaque
-- test unitaire fonctionnait. Le trou était entre les deux.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UN TRIGGER, ET PAS UNE RETOUCHE DE LA RPC
-- ────────────────────────────────────────────────────────────────────────────
-- Trois raisons :
--
--   1. `save_nutrition_plan_v2` fait 557 lignes. La recopier en entier pour
--      ajouter une colonne à un INSERT, c'est 556 lignes de risque pour une
--      ligne de correction ;
--   2. ce n'est pas le seul chemin de création. Un import, un script de
--      maintenance ou une future RPC referaient la même omission — le trigger,
--      lui, est SOUS tous les chemins ;
--   3. la règle est une invariante de la table, pas une politique d'un
--      appelant. Elle appartient donc à la table.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA RÈGLE, ET CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- À la CRÉATION : le propriétaire est le coach de l'élève visé si le plan naît
-- déjà assigné, sinon le coach qui écrit (`current_coach_id()`).
--
-- À l'ASSIGNATION : un plan encore sans propriétaire en reçoit un — celui de
-- l'élève, sinon celui qui assigne. C'est ce qui RÉPARE les plans existants,
-- au moment où ils resservent, sans reprise en masse et sans rien deviner.
--
-- CE QU'ELLE NE FAIT JAMAIS :
--   - elle n'écrase JAMAIS un `coach_id` déjà renseigné. Un plan appartient à
--     qui il appartient, et la PR D fait reposer sur cette colonne le refus de
--     supprimer le plan d'un autre coach : la réécrire silencieusement
--     rendrait ce refus contournable ;
--   - elle ne se déclenche pas sur une simple modification. Sur UPDATE, elle
--     exige que `student_id` VIENNE de changer, ce qui l'exclut du chemin de
--     `nutrition_plans_coach_id_fkey` (ON DELETE SET NULL) : supprimer un
--     coach continue de détacher ses plans, sans qu'on les lui réattribue ;
--   - elle ne supprime, ne déplace et ne réécrit AUCUNE donnée existante.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AUCUNE REPRISE EN MASSE — CHOIX EXPLICITE
-- ────────────────────────────────────────────────────────────────────────────
-- Cette migration ne remplit PAS les plans déjà en base. Deviner leur
-- propriétaire à partir du seul coach du cabinet serait juste aujourd'hui et
-- faux le jour où un second coach existe — et cette colonne commande
-- désormais qui peut supprimer quoi. Un plan sans propriétaire n'ouvre aucun
-- catalogue : il ne casse donc rien, il se répare à sa prochaine assignation,
-- ou se supprime par le chemin livré en PR D.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

create or replace function public.nutrition_plans_fill_coach_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- Un propriétaire déjà désigné ne se discute pas.
  if new.coach_id is not null then
    return new;
  end if;

  -- 1. Le coach de l'élève concerné. C'est la relation la plus SÛRE : elle
  --    est écrite à la création de l'élève (students.coach_id) et c'est elle
  --    que la lecture élève des recettes interroge en bout de chaîne.
  if new.student_id is not null then
    select s.coach_id
      into new.coach_id
      from public.students s
     where s.id = new.student_id;
  end if;

  -- 2. À défaut, le coach qui écrit. Un plan créé sans élève appartient à
  --    celui qui le construit — et `current_coach_id()` rend NULL pour un
  --    administrateur sans fiche coach, auquel cas le plan reste sans
  --    propriétaire plutôt que d'en recevoir un inventé.
  if new.coach_id is null then
    new.coach_id := public.current_coach_id();
  end if;

  return new;
end;
$fn$;

alter function public.nutrition_plans_fill_coach_id() owner to postgres;

comment on function public.nutrition_plans_fill_coach_id() is
  'Trigger BEFORE INSERT / BEFORE UPDATE OF student_id : renseigne nutrition_plans.coach_id quand il est vide — coach de l''élève visé, sinon coach appelant. N''écrase jamais un propriétaire existant, ne se déclenche pas hors création ou (ré)assignation, n''écrit aucune autre colonne. security invoker, search_path vide.';

revoke all on function public.nutrition_plans_fill_coach_id() from public;
revoke execute on function public.nutrition_plans_fill_coach_id() from anon;
revoke execute on function public.nutrition_plans_fill_coach_id() from authenticated;

drop trigger if exists nutrition_plans_fill_coach_id on public.nutrition_plans;
create trigger nutrition_plans_fill_coach_id
  before insert on public.nutrition_plans
  for each row
  execute function public.nutrition_plans_fill_coach_id();

-- Sur UPDATE, la condition `WHEN` restreint le déclenchement au moment où
-- l'élève change RÉELLEMENT : le plan vient d'être assigné, ou réassigné. Une
-- modification de nom, de statut ou d'objectifs ne réveille rien, et le
-- détachement provoqué par la suppression d'un coach non plus.
drop trigger if exists nutrition_plans_fill_coach_id_on_assign on public.nutrition_plans;
create trigger nutrition_plans_fill_coach_id_on_assign
  before update of student_id on public.nutrition_plans
  for each row
  when (new.student_id is not null and new.student_id is distinct from old.student_id)
  execute function public.nutrition_plans_fill_coach_id();

comment on column public.nutrition_plans.coach_id is
  'Coach propriétaire du plan. Renseigné automatiquement par le trigger nutrition_plans_fill_coach_id (migration 20260816090000) à la création et à la (ré)assignation, jamais écrasé ensuite. Commande DEUX règles : la lecture élève du catalogue de recettes (policy nutrition_recipes_select_student) et le refus de supprimer le plan d''un autre coach (nutrition_plan_deletion_block).';

-- ────────────────────────────────────────────────────────────────────────────
-- Vérification à l'application
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.nutrition_plans'::regclass
       and tgname = 'nutrition_plans_fill_coach_id'
       and not tgisinternal
  ) then
    raise exception 'le trigger de création n''a pas été posé';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.nutrition_plans'::regclass
       and tgname = 'nutrition_plans_fill_coach_id_on_assign'
       and not tgisinternal
  ) then
    raise exception 'le trigger d''assignation n''a pas été posé';
  end if;

  -- La policy que ce correctif débloque doit toujours exiger la colonne :
  -- si elle changeait, ce trigger n'aurait plus d'objet et il faudrait le
  -- reconsidérer plutôt que le laisser écrire dans le vide.
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.nutrition_recipes'::regclass
       and polname = 'nutrition_recipes_select_student'
       and pg_get_expr(polqual, polrelid) like '%coach_id%'
  ) then
    raise exception 'la lecture élève des recettes ne dépend plus de coach_id : ce trigger est à revoir';
  end if;
end;
$$;
