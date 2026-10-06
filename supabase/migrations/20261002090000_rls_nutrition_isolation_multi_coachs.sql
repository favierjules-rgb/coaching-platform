-- ════════════════════════════════════════════════════════════════════════════
-- P13-A — ISOLATION RLS DU CŒUR NUTRITION ENTRE COACHS
-- ════════════════════════════════════════════════════════════════════════════
--
-- LE PROBLÈME CORRIGÉ
-- ───────────────────
-- Les huit tables du « cœur nutrition » portaient chacune une policy de
-- gestion unique, `FOR ALL`, dont le prédicat était `is_coach_or_admin()`
-- SEUL. Cette fonction ne répond qu'à « cet utilisateur est-il coach ou
-- admin ? » — elle ne distingue PAS deux coachs. Conséquence : tout coach
-- pouvait lire, créer, modifier et supprimer les données nutritionnelles des
-- élèves de TOUT autre coach.
--
-- Ce n'était pas une faille d'isolation inter-élèves (un élève restait
-- cloisonné par `current_student_id()`), mais bien une absence totale de
-- cloisonnement inter-coachs. La checklist du dépôt le constatait déjà
-- explicitement : supabase/tests/nutrition_security_matrix_checklist.sql,
-- contrôles G6 à G9 (« La colonne qui permettrait de le corriger EXISTE déjà
-- (students.coach_id) mais aucune policy ne s'en sert »).
--
-- LA RÈGLE DE PROPRIÉTÉ RETENUE
-- ─────────────────────────────
-- Elle n'est pas inventée ici : c'est celle que le dépôt applique DÉJÀ au
-- catalogue de recettes (`nutrition_recipes_manage_own_coach` /
-- `nutrition_recipes_select_student`, migrations 20260813090000 et
-- 20260815090000) et aux listes d'aliments (`food_lists_manage_own_coach`).
-- On l'étend au cœur nutrition, sans en changer la forme :
--
--   1. L'ÉLÈVE D'ABORD. Un plan porteur d'un `student_id` appartient au coach
--      de CET élève — `students.coach_id`, via `is_coach_of_student()`. Cette
--      fonction existe déjà et exige `students.coach_id IS NOT NULL` : un
--      élève sans coach n'est donc visible d'AUCUN coach, seulement de
--      l'administrateur. C'est voulu.
--
--   2. `nutrition_plans.coach_id` NE PRIME JAMAIS SUR L'ÉLÈVE. Dès qu'un plan
--      porte un `student_id`, la propriété est tranchée par l'élève seul. Si
--      les deux colonnes divergent (il existe aujourd'hui 1 plan dans ce cas),
--      c'est `students.coach_id` qui gagne. Opposer `coach_id` en OU aurait
--      rouvert exactement le contournement que ce chantier ferme : un coach
--      inscrit sur un plan atteindrait l'élève d'un autre coach.
--
--   3. LE PLAN MODÈLE. Un plan SANS `student_id` n'a pas d'élève pour porter
--      la propriété : elle reste limitée au coach propriétaire,
--      `coach_id = current_coach_id()`, avec `coach_id IS NOT NULL` explicite.
--      Le trigger `nutrition_plans_fill_coach_id` (20260816090000) renseigne
--      cette colonne à l'insertion ; les 31 plans existants en ont un.
--
--   4. LES TABLES FILLES suivent leur plan, de proche en proche. Aucune ne
--      porte de `coach_id` propre et TOUTES leurs clés parentes sont NOT NULL
--      (vérifié) : il n'existe donc aucune ligne orpheline par laquelle
--      s'échapper.
--
--   5. L'ADMINISTRATEUR garde un accès global, porté par une policy distincte
--      et nommée, `<table>_manage_admin`.
--
--   6. L'ÉLÈVE garde exactement les accès qu'il avait. Les policies
--      `_select_self_or_assigned`, `_select_assigned` et
--      `nutrition_days_update_self` ne sont PAS touchées par cette migration.
--
-- POURQUOI DES FONCTIONS PLUTÔT QUE DES `EXISTS` RECOPIÉS
-- ───────────────────────────────────────────────────────
-- La chaîne plan → jour → repas → créneau → option fait quatre niveaux. Écrite
-- à la main dans chaque policy, la règle serait recopiée sept fois et une
-- divergence future passerait inaperçue. Trois fonctions la portent une seule
-- fois. Elles sont SECURITY DEFINER comme les cinq fonctions de décision
-- existantes (`is_coach_of_student`, `current_coach_id`, …) : sans cela, la
-- lecture de `nutrition_plans` à l'intérieur de la policy d'une table fille
-- serait elle-même filtrée par les policies de `nutrition_plans`, et la
-- propriété deviendrait dépendante de la visibilité.
--
-- LE search_path DE CES TROIS FONCTIONS : `public, pg_temp`
-- ────────────────────────────────────────────────────────
-- `pg_temp` est écrit EXPLICITEMENT, et EN DERNIER. Ce n'est pas un détail de
-- style : c'est la recommandation de PostgreSQL pour toute fonction SECURITY
-- DEFINER, et elle corrige un contresens facile.
--
-- Écrire `set search_path = 'public'` ne retire PAS `pg_temp` du chemin. Le
-- schéma temporaire n'est jamais absent : quand il n'est pas listé,
-- PostgreSQL le cherche EN PREMIER — avant même `pg_catalog` — pour les noms
-- de RELATIONS et de TYPES. Un `set search_path = ''` ne change rien à cela
-- pour la même raison. La seule façon de le reléguer est de le nommer, et de
-- le nommer en dernier.
--
-- L'exposition est RÉELLE, pas théorique : `authenticated` et `anon` ont le
-- droit TEMP sur cette base (vérifié). N'importe quel porteur de jeton peut
-- donc faire `create temp table nutrition_plans (...)`. Sous l'ancienne
-- déclaration, une fonction SECURITY DEFINER — qui s'exécute avec les droits
-- de `postgres` — aurait pu résoudre un nom de relation non qualifié vers
-- cette table hostile, et rendre `true` sur des données fabriquées par
-- l'appelant : l'autorisation elle-même devenait falsifiable.
--
-- En revanche, le vecteur symétrique est déjà fermé : ni `authenticated` ni
-- `anon` n'ont le droit CREATE sur le schéma `public` (vérifié), donc aucun
-- objet hostile ne peut y être déposé pour détourner un opérateur ou une
-- fonction. C'est pourquoi `public` peut rester dans le chemin sans risque,
-- là où `pg_temp` devait être relégué.
--
-- DEUXIÈME RIDEAU, INDÉPENDANT DU search_path : chaque relation et chaque
-- fonction appelée dans ces trois corps est QUALIFIÉE (`public.nutrition_plans`,
-- `public.is_coach_of_student`, …). Une référence qualifiée ignore le
-- search_path par construction. Les deux protections sont cumulées à dessein :
-- la qualification protège même si le search_path est modifié plus tard, et
-- `pg_temp` en dernier protège les noms qu'on ne qualifie pas — opérateurs,
-- types — et tout ajout futur dans ces corps. Un test vérifie les deux.
--
-- ATTENTION — POURQUOI `nutrition_plans` N'UTILISE PAS CES FONCTIONS
-- ──────────────────────────────────────────────────────────────────
-- Un `WITH CHECK` doit juger la ligne APRÈS écriture. Une fonction qui
-- relirait `public.nutrition_plans` verrait le snapshot d'avant l'instruction,
-- donc les ANCIENNES valeurs — et validerait un `UPDATE … SET student_id =
-- <élève d'un autre coach>` sur la foi de l'ancien propriétaire. Les policies
-- de `nutrition_plans` nomment donc ses colonnes DIRECTEMENT. Pour les tables
-- filles le piège n'existe pas : la fonction y lit le plan PARENT, qui n'est
-- pas la ligne écrite.
--
-- LE DELETE DIRECT
-- ────────────────
-- `delete_nutrition_plan` (20260817090000) est `SECURITY INVOKER` et délègue
-- sa règle à `nutrition_plan_deletion_block`, qui oppose le propriétaire ET
-- refuse un plan encore affecté à un élève. Mais cette règle ne vivait que
-- DANS la RPC : un `DELETE FROM public.nutrition_plans WHERE id = …` envoyé
-- directement depuis un navigateur ne rencontrait que
-- `nutrition_plans_manage_staff`, c'est-à-dire `is_coach_or_admin()`. Les deux
-- protections étaient donc contournables d'une seule requête.
--
-- La policy `nutrition_plans_delete_own_coach` les porte désormais toutes les
-- deux au niveau de la base : propriété ET `student_id IS NULL`. Un DELETE
-- direct ne peut plus rien faire de plus que la RPC n'autorisait. L'admin
-- conserve son accès global via `nutrition_plans_manage_admin` — la RPC, elle,
-- continue de lui refuser un plan affecté, ce qui est sa règle métier et reste
-- inchangé.
--
-- AUCUNE RPC N'EST SUPPRIMÉE NI RÉÉCRITE. C'est inutile : toutes les RPC
-- nutrition de ce domaine sont `SECURITY INVOKER` (`prosecdef = false`,
-- vérifié) — elles s'exécutent avec les droits de l'appelant, donc la RLS
-- s'applique DANS leur corps. Corriger les policies les corrige du même coup.
--
-- PÉRIMÈTRE — CE QUE CETTE MIGRATION NE FAIT PAS
-- ──────────────────────────────────────────────
-- Pas de changement de schéma. Aucun grant modifié (`anon` n'a déjà AUCUN
-- droit sur ces huit tables ; `authenticated` garde les siens, car Postgres
-- vérifie les privilèges AVANT les policies et les révoquer casserait le
-- coach avant toute policy). Pas de correction de données. Pas de
-- `current_student_id()`. Pas de `students.coach_id IS NULL` à rattraper. Pas
-- d'autre domaine RLS. Ces points relèvent de P13-B/C/D.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. LA RÈGLE DE PROPRIÉTÉ, ÉCRITE UNE SEULE FOIS ────────────────────────

-- Le plan lui-même. L'administrateur n'est VOLONTAIREMENT pas traité ici :
-- son accès est porté par les policies `_manage_admin`, ce qui laisse cette
-- fonction ne répondre qu'à une seule question — « ce coach-ci possède-t-il
-- ce plan-là ? » — et la rend lisible d'un coup d'œil.
create or replace function public.can_manage_nutrition_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.nutrition_plans p
     where p.id = p_plan_id
       and (
         -- Plan affecté : la propriété suit l'élève, puis SON coach.
         (p.student_id is not null and public.is_coach_of_student(p.student_id))
         -- Plan modèle : propriété limitée au coach propriétaire.
         or (p.student_id is null
             and p.coach_id is not null
             and p.coach_id = public.current_coach_id())
       )
  );
$$;

comment on function public.can_manage_nutrition_plan(uuid) is
  'P13-A. Vrai si le coach courant possède ce plan nutritionnel : par l''élève affecté (students.coach_id) si le plan en a un, sinon par nutrition_plans.coach_id. N''inclut PAS l''administrateur, traité par les policies _manage_admin.';

-- Un jour de plan. Niveau intermédiaire, pour que `meals` n'ait pas à joindre
-- deux tables dans son prédicat.
create or replace function public.can_manage_nutrition_day(p_day_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.nutrition_days d
     where d.id = p_day_id
       and public.can_manage_nutrition_plan(d.plan_id)
  );
$$;

comment on function public.can_manage_nutrition_day(uuid) is
  'P13-A. Propriété d''un jour de plan, héritée de son plan parent.';

-- Un repas prescrit.
create or replace function public.can_manage_meal(p_meal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.meals m
     where m.id = p_meal_id
       and public.can_manage_nutrition_day(m.nutrition_day_id)
  );
$$;

comment on function public.can_manage_meal(uuid) is
  'P13-A. Propriété d''un repas prescrit, héritée de son jour puis de son plan.';

-- Ces fonctions sont SECURITY DEFINER : on retire le droit d'exécution au
-- public et à `anon` avant de le rendre au seul rôle qui en a besoin, comme
-- le fait déjà le dépôt (20260726220000, 20261001090000).
revoke all on function public.can_manage_nutrition_plan(uuid) from public;
revoke all on function public.can_manage_nutrition_plan(uuid) from anon;
grant execute on function public.can_manage_nutrition_plan(uuid) to authenticated;

revoke all on function public.can_manage_nutrition_day(uuid) from public;
revoke all on function public.can_manage_nutrition_day(uuid) from anon;
grant execute on function public.can_manage_nutrition_day(uuid) to authenticated;

revoke all on function public.can_manage_meal(uuid) from public;
revoke all on function public.can_manage_meal(uuid) from anon;
grant execute on function public.can_manage_meal(uuid) to authenticated;


-- ── 2. nutrition_plans ─────────────────────────────────────────────────────
-- Quatre policies de staff au lieu d'une seule `FOR ALL`, parce que le DELETE
-- doit être PLUS strict que les trois autres commandes : il exige en plus
-- qu'aucun élève ne soit affecté, ce que `FOR ALL` ne permet pas d'exprimer.

drop policy if exists "nutrition_plans_manage_staff" on public.nutrition_plans;
drop policy if exists "nutrition_plans_manage_admin" on public.nutrition_plans;
drop policy if exists "nutrition_plans_select_own_coach" on public.nutrition_plans;
drop policy if exists "nutrition_plans_insert_own_coach" on public.nutrition_plans;
drop policy if exists "nutrition_plans_update_own_coach" on public.nutrition_plans;
drop policy if exists "nutrition_plans_delete_own_coach" on public.nutrition_plans;

create policy "nutrition_plans_manage_admin"
  on public.nutrition_plans for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nutrition_plans_select_own_coach"
  on public.nutrition_plans for select to authenticated
  using (
    (student_id is not null and public.is_coach_of_student(student_id))
    or (student_id is null
        and coach_id is not null
        and coach_id = public.current_coach_id())
  );

-- À l'insertion, le trigger `nutrition_plans_fill_coach_id` a déjà renseigné
-- `coach_id` quand il était nul. Le prédicat juge donc la ligne telle qu'elle
-- sera écrite : un coach ne peut ni créer un plan pour l'élève d'un autre, ni
-- créer un plan modèle au nom d'un autre coach.
create policy "nutrition_plans_insert_own_coach"
  on public.nutrition_plans for insert to authenticated
  with check (
    (student_id is not null and public.is_coach_of_student(student_id))
    or (student_id is null
        and coach_id is not null
        and coach_id = public.current_coach_id())
  );

-- USING ferme la réécriture de `coach_id` : on ne peut pas s'approprier une
-- ligne qu'on n'a pas le droit de voir. WITH CHECK ferme la réécriture de
-- `student_id` : la ligne d'arrivée doit elle aussi nous appartenir.
create policy "nutrition_plans_update_own_coach"
  on public.nutrition_plans for update to authenticated
  using (
    (student_id is not null and public.is_coach_of_student(student_id))
    or (student_id is null
        and coach_id is not null
        and coach_id = public.current_coach_id())
  )
  with check (
    (student_id is not null and public.is_coach_of_student(student_id))
    or (student_id is null
        and coach_id is not null
        and coach_id = public.current_coach_id())
  );

-- Le DELETE direct, ramené à ce que la RPC autorisait déjà : son propre plan,
-- et seulement s'il n'est affecté à personne.
create policy "nutrition_plans_delete_own_coach"
  on public.nutrition_plans for delete to authenticated
  using (
    student_id is null
    and coach_id is not null
    and coach_id = public.current_coach_id()
  );


-- ── 3. nutrition_days ──────────────────────────────────────────────────────

drop policy if exists "nutrition_days_manage_staff" on public.nutrition_days;
drop policy if exists "nutrition_days_manage_admin" on public.nutrition_days;
drop policy if exists "nutrition_days_manage_own_coach" on public.nutrition_days;

create policy "nutrition_days_manage_admin"
  on public.nutrition_days for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- WITH CHECK interdit de déplacer un jour vers le plan d'un autre coach.
create policy "nutrition_days_manage_own_coach"
  on public.nutrition_days for all to authenticated
  using (public.can_manage_nutrition_plan(plan_id))
  with check (public.can_manage_nutrition_plan(plan_id));


-- ── 4. nutrition_plan_profiles ─────────────────────────────────────────────

drop policy if exists "nutrition_plan_profiles_manage_staff" on public.nutrition_plan_profiles;
drop policy if exists "nutrition_plan_profiles_manage_admin" on public.nutrition_plan_profiles;
drop policy if exists "nutrition_plan_profiles_manage_own_coach" on public.nutrition_plan_profiles;

create policy "nutrition_plan_profiles_manage_admin"
  on public.nutrition_plan_profiles for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nutrition_plan_profiles_manage_own_coach"
  on public.nutrition_plan_profiles for all to authenticated
  using (public.can_manage_nutrition_plan(plan_id))
  with check (public.can_manage_nutrition_plan(plan_id));


-- ── 5. nutrition_meal_slot_targets ─────────────────────────────────────────
-- Rattachée au plan par `profile_id` → `nutrition_plan_profiles.plan_id`.

drop policy if exists "nutrition_meal_slot_targets_manage_staff" on public.nutrition_meal_slot_targets;
drop policy if exists "nutrition_meal_slot_targets_manage_admin" on public.nutrition_meal_slot_targets;
drop policy if exists "nutrition_meal_slot_targets_manage_own_coach" on public.nutrition_meal_slot_targets;

create policy "nutrition_meal_slot_targets_manage_admin"
  on public.nutrition_meal_slot_targets for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nutrition_meal_slot_targets_manage_own_coach"
  on public.nutrition_meal_slot_targets for all to authenticated
  using (exists (
    select 1 from public.nutrition_plan_profiles pr
     where pr.id = nutrition_meal_slot_targets.profile_id
       and public.can_manage_nutrition_plan(pr.plan_id)))
  with check (exists (
    select 1 from public.nutrition_plan_profiles pr
     where pr.id = nutrition_meal_slot_targets.profile_id
       and public.can_manage_nutrition_plan(pr.plan_id)));


-- ── 6. meals ───────────────────────────────────────────────────────────────

drop policy if exists "meals_manage_staff" on public.meals;
drop policy if exists "meals_manage_admin" on public.meals;
drop policy if exists "meals_manage_own_coach" on public.meals;

create policy "meals_manage_admin"
  on public.meals for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "meals_manage_own_coach"
  on public.meals for all to authenticated
  using (public.can_manage_nutrition_day(nutrition_day_id))
  with check (public.can_manage_nutrition_day(nutrition_day_id));


-- ── 7. meal_choice_slots ───────────────────────────────────────────────────
-- Cette table portait DÉJÀ, dans son WITH CHECK, une opposition de propriété
-- sur `source_list_id` (un coach ne pouvait pas puiser dans la liste
-- d'aliments d'un autre). Cette garde est CONSERVÉE telle quelle ; sa branche
-- `is_admin()` migre simplement dans la policy admin.

drop policy if exists "meal_choice_slots_manage_staff" on public.meal_choice_slots;
drop policy if exists "meal_choice_slots_manage_admin" on public.meal_choice_slots;
drop policy if exists "meal_choice_slots_manage_own_coach" on public.meal_choice_slots;

create policy "meal_choice_slots_manage_admin"
  on public.meal_choice_slots for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "meal_choice_slots_manage_own_coach"
  on public.meal_choice_slots for all to authenticated
  using (public.can_manage_meal(meal_id))
  with check (
    public.can_manage_meal(meal_id)
    and (
      source_list_id is null
      or exists (
        select 1 from public.food_lists fl
         where fl.id = meal_choice_slots.source_list_id
           and fl.coach_id = public.current_coach_id())
    )
  );


-- ── 8. meal_choice_options ─────────────────────────────────────────────────

drop policy if exists "meal_choice_options_manage_staff" on public.meal_choice_options;
drop policy if exists "meal_choice_options_manage_admin" on public.meal_choice_options;
drop policy if exists "meal_choice_options_manage_own_coach" on public.meal_choice_options;

create policy "meal_choice_options_manage_admin"
  on public.meal_choice_options for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "meal_choice_options_manage_own_coach"
  on public.meal_choice_options for all to authenticated
  using (exists (
    select 1 from public.meal_choice_slots s
     where s.id = meal_choice_options.slot_id
       and public.can_manage_meal(s.meal_id)))
  with check (exists (
    select 1 from public.meal_choice_slots s
     where s.id = meal_choice_options.slot_id
       and public.can_manage_meal(s.meal_id)));


-- ── 9. nutrition_daily_logs ────────────────────────────────────────────────
-- L'ancienne policy unique mélangeait l'élève et le staff dans un seul OU :
-- `student_id = current_student_id() OR is_coach_or_admin()`. On la remplace
-- par trois policies nommées. L'accès de l'ÉLÈVE est reporté à l'identique —
-- c'est la même expression, isolée ; seule la branche staff est resserrée.
--
-- La propriété passe par l'ÉLÈVE du journal, pas par le plan : les deux
-- coïncident sur les 9 lignes existantes (vérifié : aucune ligne dont l'élève
-- diffère de celui du plan), et router par l'élève évite qu'un plan modèle
-- serve de passerelle vers le journal d'un élève d'un autre coach.

drop policy if exists "nutrition_daily_logs_student_or_staff" on public.nutrition_daily_logs;
drop policy if exists "nutrition_daily_logs_manage_admin" on public.nutrition_daily_logs;
drop policy if exists "nutrition_daily_logs_manage_own_student" on public.nutrition_daily_logs;
drop policy if exists "nutrition_daily_logs_manage_own_coach" on public.nutrition_daily_logs;

create policy "nutrition_daily_logs_manage_admin"
  on public.nutrition_daily_logs for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nutrition_daily_logs_manage_own_student"
  on public.nutrition_daily_logs for all to authenticated
  using (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

create policy "nutrition_daily_logs_manage_own_coach"
  on public.nutrition_daily_logs for all to authenticated
  using (public.is_coach_of_student(student_id))
  with check (public.is_coach_of_student(student_id));


-- ── 10. CE QUI N'EST PAS TOUCHÉ, ET POURQUOI ───────────────────────────────
-- Les policies de LECTURE ÉLÈVE restent intactes, à l'identique :
--   nutrition_plans_select_self_or_assigned, nutrition_days_select_self_or_assigned,
--   nutrition_days_update_self, nutrition_plan_profiles_select_assigned,
--   nutrition_meal_slot_targets_select_assigned, meals_select_self_or_assigned,
--   meal_choice_slots_select_assigned, meal_choice_options_select_assigned.
-- Elles sont déjà cloisonnées par `current_student_id()` et constituent le
-- modèle de référence du domaine. Les policies étant combinées en OU, les
-- resserrages ci-dessus ne leur retirent rien.
--
-- `nutrition_plan_deletion_block` et `delete_nutrition_plan` ne sont pas
-- modifiées : leur règle est désormais DOUBLÉE au niveau de la base, elle
-- n'est pas déplacée. La RPC continue de rendre les motifs lisibles
-- (`assigned`, `forbidden`, `used_in_history`) que l'interface affiche, ce
-- qu'une policy ne sait pas faire — une policy ne peut que rendre la ligne
-- invisible.
