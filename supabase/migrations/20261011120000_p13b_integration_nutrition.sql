-- ════════════════════════════════════════════════════════════════════════════
-- P13-B / 4 — LE CŒUR NUTRITION ENTRE DANS LE MODÈLE DE CATÉGORIES
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE DÉFAUT CORRIGÉ, MESURÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Un collaborateur avec `nutrition / ecriture`, EXPLICITEMENT AFFECTÉ à un
-- élève, obtenait zéro plan. Vérifié sur PostgreSQL 16 avec les trois
-- migrations P13-B appliquées :
--
--   staff_role()                      → collaborateur
--   categories_ecriture()             → {nutrition}
--   student_ids_nutrition_ecriture()  → {son élève}        ← le modèle marche
--   nutrition_plan_ids_geres()        → {}                 ← la porte est fermée
--   select count(*) from nutrition_plans → 0
--
-- La cause : les huit tables du cœur nutrition n'opposent pas les ensembles
-- du modèle, mais les ensembles de PROPRIÉTÉ de P13-A —
-- `nutrition_plan_ids_geres()` et ses dérivés, qui reposent tous sur
-- `is_coach_of_student()` → `students.coach_id = current_coach_id()`. Un
-- collaborateur ne vaut JAMAIS `students.coach_id` : c'est la décision
-- d'architecture de P13-B (option B, le coach principal ne change pas), et
-- c'est précisément pour cela que l'affectation explicite existe.
--
-- La migration 20261011100000 l'annonçait : « les 8 tables du cœur nutrition
-- n'apparaissent pas ici, leur intégration se fait dans la migration suivante,
-- avec les fonctions ». La migration de durcissement n'a traité que le trigger
-- `protect_nutrition_days_coach_columns` et les quatre RPC de calendrier. Le
-- reste manquait. Cette migration le livre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DE NOUVELLES FONCTIONS, ET PAS UNE EXTENSION DES ANCIENNES
-- ────────────────────────────────────────────────────────────────────────────
-- `nutrition_plan_ids_geres()` est un ensemble UNIQUE, opposé à la fois en
-- lecture et en écriture par des policies `FOR ALL`. Y ajouter la portée du
-- collaborateur aurait accordé l'écriture en même temps que la lecture, donc
-- rendu le niveau `lecture` inopérant — l'inverse de ce que le modèle promet.
--
-- Les anciennes fonctions ne sont donc NI MODIFIÉES NI SUPPRIMÉES : elles
-- restent la définition de la PROPRIÉTÉ (`food_lists`, `nutrition_recipes`,
-- `can_manage_*` continuent de s'en servir, inchangés). Dix fonctions neuves
-- portent la portée par NIVEAU, et ce sont elles que les policies opposent.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI N'EST PAS ACCORDÉ, ET C'EST VOLONTAIRE
-- ────────────────────────────────────────────────────────────────────────────
--  1. LES PLANS MODÈLES (`nutrition_plans.student_id is null`). Ils
--     n'appartiennent à aucun élève, donc aucune affectation ne les atteint.
--     Leur branche est réservée à `est_staff_global()` — admin de cabinet ou
--     coach autonome. Avant cette migration un collaborateur pouvait même en
--     CRÉER un (la policy d'insert ne demandait que
--     `coach_id = current_coach_id()`, vrai pour lui) : c'est fermé ici.
--  2. LA SUPPRESSION D'UN PLAN D'ÉLÈVE. Elle n'était permise à AUCUN coach —
--     seul l'administrateur y touche. La règle est reprise telle quelle : le
--     niveau `ecriture` ne l'élargit pas.
--  3. LE CATALOGUE DU COACH (`food_lists`, `food_catalog`, `food_aliases`,
--     `nutrition_recipes` et leurs filles). Ces tables sont la bibliothèque
--     PERSONNELLE d'un coach, clé `coach_id = current_coach_id()`. Un
--     collaborateur n'y voit donc que ses propres lignes, et la catégorie
--     `nutrition` ne lui ouvre pas celles du coach principal. Rien n'est
--     touché ici : ce sont des tables de propriété, pas de suivi d'élève.
--  4. LE JOURNAL DE L'ÉLÈVE écrit par l'élève lui-même. Les policies
--     `*_own_student` et les huit RPC `SECURITY DEFINER` du journal
--     (`ajouter_aliment_*`, `enregistrer_repas_*`, `modifier_quantite_entree`,
--     `supprimer_*`) sont gardées par `current_student_id()`, qui vaut NULL
--     pour un collaborateur : aucune de ces voies ne lui est ouverte, et
--     aucune n'est modifiée.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI NE CHANGE PAS POUR LES AUTRES RÔLES
-- ────────────────────────────────────────────────────────────────────────────
-- ADMINISTRATEUR : les policies `*_manage_admin` (`is_admin()`, FOR ALL) ne
-- sont pas touchées, et la garde `not (select public.is_admin()) and …` est
-- conservée sur chaque policy réécrite — c'est le court-circuit mesuré en
-- P13-A (9,9 ms/ligne contre 46), il n'est pas défait.
--
-- COACH AUTONOME (assistant) : `student_ids_nutrition_<niveau>()` lui rend
-- `student_ids_portee()` ∩ les quatre catégories, soit les élèves dont il est
-- le coach principal — le même ensemble que `student_ids_geres()`, à une
-- différence près, déjà en vigueur partout ailleurs depuis P13-B :
-- `current_staff_id()` exige `coaches.status = 'actif'` là où
-- `current_coach_id()` ne l'exigeait pas. Une fiche désactivée perd donc sa
-- portée, ici comme sur `students` depuis 20261011100000.
--
-- ÉLÈVE : aucune policy `*_own_student` / `*_select_assigned` n'est touchée.
--
-- ⚠️ AUCUNE MIGRATION P13-A N'EST MODIFIÉE. Celles-ci sont appliquées en
-- production ; cette migration pose de nouvelles fonctions et REMPLACE des
-- policies par des policies plus étroites, ce qui est l'unique geste possible
-- sans réécrire une migration jouée.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. UNE RÉGRESSION RÉVÉLÉE PAR LA CHECKLIST P13-A ───────────────────────
--
-- Mesurée en appliquant la section 1 ci-dessous sur une base locale, puis en
-- rejouant `supabase/tests/nutrition_isolation_multi_coachs_checklist.sql` :
-- 22 contrôles rouges, tous de la même famille —
--
--     C1. le coach B ne LIT PAS le plan de l'élève de A      → ÉCHEC
--     D1. le coach B ne MODIFIE PAS le plan de l'élève de A   → ÉCHEC
--
-- Deux coachs AUTONOMES avaient cessé d'être cloisonnés, ce qui est
-- exactement la garantie que P13-A existait pour poser.
--
-- LA CAUSE, ET ELLE N'EST PAS DANS LA NUTRITION :
--
--     alter table public.coaches … column role … default 'admin'
--
-- `coaches.role` a pour DÉFAUT `'admin'`. Toute fiche créée sans préciser le
-- rôle — la checklist P13-A le fait, et toute ligne de production antérieure
-- au formulaire d'ajout aussi — porte donc l'étiquette `admin`. Or P13-B fait
-- de cette étiquette un POUVOIR : `student_ids_portee()` ouvre TOUS les
-- élèves dès que `staff_role() = 'admin'`.
--
-- La migration 20261011100000 avait déjà posé ce comportement sur `students`,
-- `programs`, `appointments` et le reste ; il n'était simplement visible par
-- aucune checklist, la seule qui teste deux coachs autonomes ne couvrant que
-- la nutrition. L'intégrer à la nutrition l'a rendu mesurable.
--
-- DEUX CORRECTIFS, ET LES DEUX SONT NÉCESSAIRES :
--
--  1. LA SOURCE. Une fiche ne doit plus NAÎTRE avec l'étiquette globale. Le
--     défaut passe à `'assistant'` — un coach autonome, ce que doit être une
--     fiche dont personne n'a choisi le rôle. Aucune ligne existante n'est
--     touchée (un DEFAULT ne s'applique qu'aux insertions futures) : les
--     données ne sont pas réécrites pour contourner une permission.
--
--  2. LA DÉFENSE EN PROFONDEUR, pour les lignes qui portent DÉJÀ `'admin'` en
--     production. Les droits GLOBAUX suivent désormais `public.is_admin()`,
--     c'est-à-dire `profiles.role = 'admin'` — la définition de
--     l'administrateur dans TOUT le reste du dépôt (les policies
--     `*_manage_admin`, `requireAdmin()`, les sept gardes applicatives). Une
--     fiche `coaches.role = 'admin'` dont le profil est `coach` redevient ce
--     qu'elle était avant P13-B : un coach autonome, borné à SES élèves.
--
-- Ce que cela préserve : l'administrateur réel (profil `admin` ET fiche
-- `admin`) garde ses droits globaux, l'assistant son périmètre, le
-- collaborateur ses affectations. Ce que cela ferme : l'élévation silencieuse
-- d'un coach ordinaire au rang d'administrateur de cabinet par le seul effet
-- d'un DEFAULT.
--
-- ⚠️ `student_ids_portee()` et `coach_ids_portee()` sont REDÉFINIES ICI, et
-- non modifiées dans la migration 20261011090000 : celle-ci est validée, et
-- une migration ne se réécrit pas. L'ordre d'application fait le reste.

alter table public.coaches alter column role set default 'assistant';

comment on column public.coaches.role is
  'P13-B : admin (administrateur de cabinet) | assistant (coach autonome) | collaborateur (portée explicite). DÉFAUT = assistant depuis la migration 20261011120000 : une fiche ne naît pas avec l''étiquette globale. Les droits globaux suivent profiles.role = admin (public.is_admin()), pas cette colonne.';

create or replace function public.student_ids_portee() returns setof uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  -- L'ADMINISTRATEUR est traité ICI, et non dans chaque policy. Mettre
  -- `is_admin() or …` dans les 72 policies aurait imposé un OR à chacune, et
  -- la mesure de P13-A a montré que le planificateur place volontiers les
  -- sous-plans hachés AVANT l'InitPlan de `is_admin()` dans un OR : le
  -- court-circuit n'a pas lieu et l'ensemble est construit pour rien.
  --
  -- ⚠️ `public.is_admin()` et NON `staff_role() = 'admin'` : voir la section 0.
  select s.id from public.students s
   where public.is_admin()
  union
  -- Le coach AUTONOME, quelle que soit l'étiquette de sa fiche. Une fiche
  -- `admin` qui n'est pas l'administrateur applicatif est un coach autonome,
  -- et c'est ce qui rétablit le cloisonnement mesuré par P13-A.
  select s.id
    from public.students s
   where not public.is_admin()
     and public.staff_role() in ('admin','assistant')
     and s.coach_id is not null
     and s.coach_id = public.current_staff_id()
  union
  select a.student_id
    from public.collaborateur_eleves a
   where public.staff_role() = 'collaborateur'
     and a.collaborateur_id = public.current_staff_id();
$$;

create or replace function public.coach_ids_portee() returns setof uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.id from public.coaches c
   where public.is_admin()
  union
  select public.current_staff_id()
   where not public.is_admin()
     and public.staff_role() in ('admin','assistant')
  union
  select distinct s.coach_id
    from public.collaborateur_eleves a
    join public.students s on s.id = a.student_id
   where public.staff_role() = 'collaborateur'
     and a.collaborateur_id = public.current_staff_id()
     and s.coach_id is not null;
$$;

-- Les droits d'exécution ont été posés par la migration 20261011090000 et
-- survivent à `create or replace` ; on les réaffirme plutôt que de les
-- supposer.
do $$
declare f text;
begin
  foreach f in array array['student_ids_portee','coach_ids_portee'] loop
    execute format('alter function public.%I() owner to postgres', f);
    execute format('revoke all on function public.%I() from public', f);
    execute format('revoke all on function public.%I() from anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;


-- ── 1. LES ENSEMBLES PAR NIVEAU ────────────────────────────────────────────
-- Dix fonctions, générées par boucle pour que `lecture` et `ecriture` ne
-- puissent pas diverger autrement que par le niveau. Sans argument : hissées
-- en InitPlan, évaluées UNE FOIS par instruction (leçon chiffrée de P13-A :
-- 5,6 ms contre 1 786 ms pour la même règle prise ligne par ligne).
--
-- `search_path = public, pg_temp` avec pg_temp EN DERNIER : non listé, il est
-- consulté EN PREMIER et un objet temporaire peut masquer les tables lues ici.
do $$
declare n text;
begin
  foreach n in array array['lecture','ecriture'] loop
    execute format($g$
      create or replace function public.nutrition_plan_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        -- Plan d'élève : la portée suit l'élève ET la catégorie nutrition.
        -- C'est ce terme qui ouvre enfin le plan au collaborateur affecté, et
        -- qui le referme dès qu'une des deux conditions manque.
        select p.id from public.nutrition_plans p
         where p.student_id is not null
           and p.student_id in (select public.student_ids_nutrition_%1$s())
        union
        -- Plan modèle : aucun élève, donc aucune affectation. Propriété seule,
        -- et réservée au staff global.
        select p.id from public.nutrition_plans p
         where p.student_id is null
           and p.coach_id is not null
           and p.coach_id = public.current_coach_id()
           and public.est_staff_global();
      $body$;

      create or replace function public.nutrition_plan_profile_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select pr.id from public.nutrition_plan_profiles pr
         where pr.plan_id in (select public.nutrition_plan_ids_%1$s());
      $body$;

      create or replace function public.nutrition_day_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select d.id from public.nutrition_days d
         where d.plan_id in (select public.nutrition_plan_ids_%1$s());
      $body$;

      create or replace function public.meal_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select m.id from public.meals m
         where m.nutrition_day_id in (select public.nutrition_day_ids_%1$s());
      $body$;

      create or replace function public.meal_choice_slot_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select s.id from public.meal_choice_slots s
         where s.meal_id in (select public.meal_ids_%1$s());
      $body$;
    $g$, n);
  end loop;
end $$;

-- Droits d'exécution : retirés à `public` et à `anon`, accordés au seul rôle
-- `authenticated`. `anon` possède le droit TEMP et peut appeler une fonction
-- exposée : lui laisser EXECUTE donnerait à un appelant NON AUTHENTIFIÉ la
-- liste des identifiants de plans d'un coach via `/rest/v1/rpc/…`.
do $$
declare f text;
begin
  foreach f in array array[
    'nutrition_plan_ids_lecture','nutrition_plan_ids_ecriture',
    'nutrition_plan_profile_ids_lecture','nutrition_plan_profile_ids_ecriture',
    'nutrition_day_ids_lecture','nutrition_day_ids_ecriture',
    'meal_ids_lecture','meal_ids_ecriture',
    'meal_choice_slot_ids_lecture','meal_choice_slot_ids_ecriture'
  ] loop
    execute format('alter function public.%I() owner to postgres', f);
    execute format('revoke all on function public.%I() from public', f);
    execute format('revoke all on function public.%I() from anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;


-- ── 2bis. REJOUABILITÉ ─────────────────────────────────────────────────────
-- Chaque `create policy` ci-dessous porte un nom NEUF (une par commande, là
-- où il y avait un `FOR ALL`). Un second passage de cette migration — sur une
-- base locale reconstruite, ou après un correctif — échouerait donc sur
-- « policy already exists » alors que le `drop policy if exists` ne visait que
-- l'ANCIEN nom. On dépose d'abord les nouveaux noms, nommément : aucune
-- policy étrangère n'est touchée.
do $$
declare r record;
begin
  for r in select * from (values
    ('nutrition_plans_select_own_coach', 'nutrition_plans'),
    ('nutrition_plans_insert_own_coach', 'nutrition_plans'),
    ('nutrition_plans_update_own_coach', 'nutrition_plans'),
    ('nutrition_plans_delete_own_coach', 'nutrition_plans'),
    ('nutrition_plan_profiles_select_own_coach', 'nutrition_plan_profiles'),
    ('nutrition_plan_profiles_insert_own_coach', 'nutrition_plan_profiles'),
    ('nutrition_plan_profiles_update_own_coach', 'nutrition_plan_profiles'),
    ('nutrition_plan_profiles_delete_own_coach', 'nutrition_plan_profiles'),
    ('nutrition_meal_slot_targets_select_own_coach', 'nutrition_meal_slot_targets'),
    ('nutrition_meal_slot_targets_insert_own_coach', 'nutrition_meal_slot_targets'),
    ('nutrition_meal_slot_targets_update_own_coach', 'nutrition_meal_slot_targets'),
    ('nutrition_meal_slot_targets_delete_own_coach', 'nutrition_meal_slot_targets'),
    ('nutrition_days_select_own_coach', 'nutrition_days'),
    ('nutrition_days_insert_own_coach', 'nutrition_days'),
    ('nutrition_days_update_own_coach', 'nutrition_days'),
    ('nutrition_days_delete_own_coach', 'nutrition_days'),
    ('meals_select_own_coach', 'meals'),
    ('meals_insert_own_coach', 'meals'),
    ('meals_update_own_coach', 'meals'),
    ('meals_delete_own_coach', 'meals'),
    ('meal_choice_slots_select_own_coach', 'meal_choice_slots'),
    ('meal_choice_slots_insert_own_coach', 'meal_choice_slots'),
    ('meal_choice_slots_update_own_coach', 'meal_choice_slots'),
    ('meal_choice_slots_delete_own_coach', 'meal_choice_slots'),
    ('meal_choice_options_select_own_coach', 'meal_choice_options'),
    ('meal_choice_options_insert_own_coach', 'meal_choice_options'),
    ('meal_choice_options_update_own_coach', 'meal_choice_options'),
    ('meal_choice_options_delete_own_coach', 'meal_choice_options'),
    ('nutrition_daily_logs_select_own_coach', 'nutrition_daily_logs'),
    ('nutrition_daily_logs_insert_own_coach', 'nutrition_daily_logs'),
    ('nutrition_daily_logs_update_own_coach', 'nutrition_daily_logs'),
    ('nutrition_daily_logs_delete_own_coach', 'nutrition_daily_logs'),
    ('consumed_meals_select_own_coach', 'consumed_meals'),
    ('meal_entries_select_own_coach', 'meal_entries'),
    ('planned_meals_select_own_coach', 'planned_meals'),
    ('planned_meal_items_select_own_coach', 'planned_meal_items'),
    ('planned_meal_skipped_slots_select_own_coach', 'planned_meal_skipped_slots')
  ) as v(nom, table_cible) loop
    execute format('drop policy if exists %I on public.%I', r.nom, r.table_cible);
  end loop;
end $$;


-- ── 2. `nutrition_plans` : QUATRE POLICIES, QUATRE RÈGLES ──────────────────
-- Les commandes étaient DÉJÀ séparées ici (P13-A) ; ce qui change est
-- l'ensemble opposé, et la fermeture du plan modèle au collaborateur.
--
-- INSERT et le `with check` d'UPDATE s'expriment sur les COLONNES de la ligne
-- proposée, pas sur `id in (…)` : à l'insertion la ligne n'existe pas encore,
-- et à la mise à jour c'est la ligne APRÈS modification qui doit rester dans
-- la portée — sans quoi on pourrait déplacer un plan vers un élève hors
-- portée.
drop policy if exists "nutrition_plans_select_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_select_own_coach"
  on public.nutrition_plans for select to authenticated
  using ((not (select public.is_admin())) and id in (select public.nutrition_plan_ids_lecture()));

drop policy if exists "nutrition_plans_insert_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_insert_own_coach"
  on public.nutrition_plans for insert to authenticated
  with check (
    (not (select public.is_admin()))
    and (
      (student_id is not null and student_id in (select public.student_ids_nutrition_ecriture()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id())
          and public.est_staff_global())
    )
  );

drop policy if exists "nutrition_plans_update_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_update_own_coach"
  on public.nutrition_plans for update to authenticated
  using ((not (select public.is_admin())) and id in (select public.nutrition_plan_ids_ecriture()))
  with check (
    (not (select public.is_admin()))
    and (
      (student_id is not null and student_id in (select public.student_ids_nutrition_ecriture()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id())
          and public.est_staff_global())
    )
  );

-- DELETE : LA RÈGLE EST REPRISE SANS ÊTRE ÉLARGIE. Supprimer le plan d'un
-- élève n'était permis à aucun coach — seul l'administrateur le fait, par sa
-- policy `*_manage_admin`. Le niveau `ecriture` n'y change rien.
drop policy if exists "nutrition_plans_delete_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_delete_own_coach"
  on public.nutrition_plans for delete to authenticated
  using (
    (not (select public.is_admin()))
    and student_id is null
    and coach_id is not null
    and coach_id = (select public.current_coach_id())
    and public.est_staff_global()
  );


-- ── 3. LA CASCADE DU PLAN ──────────────────────────────────────────────────
-- Cinq tables suspendues au plan par une chaîne d'identifiants. Chaque
-- policy `FOR ALL` est scindée en quatre : SELECT sur l'ensemble de LECTURE,
-- INSERT/UPDATE/DELETE sur celui d'ÉCRITURE. Une permission `lecture` ne peut
-- donc plus produire une écriture, ce qu'un `FOR ALL` unique autorisait.

drop policy if exists "nutrition_plan_profiles_manage_own_coach" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_select_own_coach"
  on public.nutrition_plan_profiles for select to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_lecture()));
create policy "nutrition_plan_profiles_insert_own_coach"
  on public.nutrition_plan_profiles for insert to authenticated
  with check ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));
create policy "nutrition_plan_profiles_update_own_coach"
  on public.nutrition_plan_profiles for update to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()))
  with check ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));
create policy "nutrition_plan_profiles_delete_own_coach"
  on public.nutrition_plan_profiles for delete to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));

drop policy if exists "nutrition_meal_slot_targets_manage_own_coach" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_select_own_coach"
  on public.nutrition_meal_slot_targets for select to authenticated
  using ((not (select public.is_admin())) and profile_id in (select public.nutrition_plan_profile_ids_lecture()));
create policy "nutrition_meal_slot_targets_insert_own_coach"
  on public.nutrition_meal_slot_targets for insert to authenticated
  with check ((not (select public.is_admin())) and profile_id in (select public.nutrition_plan_profile_ids_ecriture()));
create policy "nutrition_meal_slot_targets_update_own_coach"
  on public.nutrition_meal_slot_targets for update to authenticated
  using ((not (select public.is_admin())) and profile_id in (select public.nutrition_plan_profile_ids_ecriture()))
  with check ((not (select public.is_admin())) and profile_id in (select public.nutrition_plan_profile_ids_ecriture()));
create policy "nutrition_meal_slot_targets_delete_own_coach"
  on public.nutrition_meal_slot_targets for delete to authenticated
  using ((not (select public.is_admin())) and profile_id in (select public.nutrition_plan_profile_ids_ecriture()));

drop policy if exists "nutrition_days_manage_own_coach" on public.nutrition_days;
create policy "nutrition_days_select_own_coach"
  on public.nutrition_days for select to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_lecture()));
create policy "nutrition_days_insert_own_coach"
  on public.nutrition_days for insert to authenticated
  with check ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));
create policy "nutrition_days_update_own_coach"
  on public.nutrition_days for update to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()))
  with check ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));
create policy "nutrition_days_delete_own_coach"
  on public.nutrition_days for delete to authenticated
  using ((not (select public.is_admin())) and plan_id in (select public.nutrition_plan_ids_ecriture()));

drop policy if exists "meals_manage_own_coach" on public.meals;
create policy "meals_select_own_coach"
  on public.meals for select to authenticated
  using ((not (select public.is_admin())) and nutrition_day_id in (select public.nutrition_day_ids_lecture()));
create policy "meals_insert_own_coach"
  on public.meals for insert to authenticated
  with check ((not (select public.is_admin())) and nutrition_day_id in (select public.nutrition_day_ids_ecriture()));
create policy "meals_update_own_coach"
  on public.meals for update to authenticated
  using ((not (select public.is_admin())) and nutrition_day_id in (select public.nutrition_day_ids_ecriture()))
  with check ((not (select public.is_admin())) and nutrition_day_id in (select public.nutrition_day_ids_ecriture()));
create policy "meals_delete_own_coach"
  on public.meals for delete to authenticated
  using ((not (select public.is_admin())) and nutrition_day_id in (select public.nutrition_day_ids_ecriture()));

-- `meal_choice_slots` : le `with check` porte UNE CONDITION DE PLUS, reprise
-- mot pour mot. Une liste d'aliments citée comme source doit appartenir à
-- celui qui écrit (`food_lists.coach_id = current_coach_id()`). C'est une
-- restriction, elle n'est pas relâchée — conséquence assumée : un
-- collaborateur ne peut citer que SES propres listes, pas celles du coach
-- principal, puisque le catalogue reste une table de propriété.
drop policy if exists "meal_choice_slots_manage_own_coach" on public.meal_choice_slots;
create policy "meal_choice_slots_select_own_coach"
  on public.meal_choice_slots for select to authenticated
  using ((not (select public.is_admin())) and meal_id in (select public.meal_ids_lecture()));
create policy "meal_choice_slots_insert_own_coach"
  on public.meal_choice_slots for insert to authenticated
  with check (
    (not (select public.is_admin()))
    and meal_id in (select public.meal_ids_ecriture())
    and (source_list_id is null
         or exists (select 1 from public.food_lists fl
                     where fl.id = source_list_id
                       and fl.coach_id = (select public.current_coach_id())))
  );
create policy "meal_choice_slots_update_own_coach"
  on public.meal_choice_slots for update to authenticated
  using ((not (select public.is_admin())) and meal_id in (select public.meal_ids_ecriture()))
  with check (
    (not (select public.is_admin()))
    and meal_id in (select public.meal_ids_ecriture())
    and (source_list_id is null
         or exists (select 1 from public.food_lists fl
                     where fl.id = source_list_id
                       and fl.coach_id = (select public.current_coach_id())))
  );
create policy "meal_choice_slots_delete_own_coach"
  on public.meal_choice_slots for delete to authenticated
  using ((not (select public.is_admin())) and meal_id in (select public.meal_ids_ecriture()));

drop policy if exists "meal_choice_options_manage_own_coach" on public.meal_choice_options;
create policy "meal_choice_options_select_own_coach"
  on public.meal_choice_options for select to authenticated
  using ((not (select public.is_admin())) and slot_id in (select public.meal_choice_slot_ids_lecture()));
create policy "meal_choice_options_insert_own_coach"
  on public.meal_choice_options for insert to authenticated
  with check ((not (select public.is_admin())) and slot_id in (select public.meal_choice_slot_ids_ecriture()));
create policy "meal_choice_options_update_own_coach"
  on public.meal_choice_options for update to authenticated
  using ((not (select public.is_admin())) and slot_id in (select public.meal_choice_slot_ids_ecriture()))
  with check ((not (select public.is_admin())) and slot_id in (select public.meal_choice_slot_ids_ecriture()));
create policy "meal_choice_options_delete_own_coach"
  on public.meal_choice_options for delete to authenticated
  using ((not (select public.is_admin())) and slot_id in (select public.meal_choice_slot_ids_ecriture()));


-- ── 4. LE JOURNAL ALIMENTAIRE DE L'ÉLÈVE ───────────────────────────────────
-- `nutrition_daily_logs` n'est pas suspendue au plan mais à l'ÉLÈVE : la
-- portée est donc directement `student_ids_nutrition_<niveau>()`.
--
-- La policy de l'élève (`*_manage_own_student`) n'est pas touchée : son
-- journal reste à lui. Le coach pouvait déjà l'écrire (`FOR ALL`) ; le
-- collaborateur reçoit le même pouvoir, mais découpé par niveau — une
-- permission `lecture` ne permet plus d'y écrire, ce que le `FOR ALL`
-- autorisait.
drop policy if exists "nutrition_daily_logs_manage_own_coach" on public.nutrition_daily_logs;
create policy "nutrition_daily_logs_select_own_coach"
  on public.nutrition_daily_logs for select to authenticated
  using ((not (select public.is_admin())) and student_id in (select public.student_ids_nutrition_lecture()));
create policy "nutrition_daily_logs_insert_own_coach"
  on public.nutrition_daily_logs for insert to authenticated
  with check ((not (select public.is_admin())) and student_id in (select public.student_ids_nutrition_ecriture()));
create policy "nutrition_daily_logs_update_own_coach"
  on public.nutrition_daily_logs for update to authenticated
  using ((not (select public.is_admin())) and student_id in (select public.student_ids_nutrition_ecriture()))
  with check ((not (select public.is_admin())) and student_id in (select public.student_ids_nutrition_ecriture()));
create policy "nutrition_daily_logs_delete_own_coach"
  on public.nutrition_daily_logs for delete to authenticated
  using ((not (select public.is_admin())) and student_id in (select public.student_ids_nutrition_ecriture()));


-- ── 5. LES TABLES DÉPENDANTES, EN LECTURE SEULE ────────────────────────────
-- Ce que l'élève a réellement mangé. Le coach n'y a QUE la lecture (aucune
-- policy d'écriture : c'est l'élève qui saisit, par les RPC gardées par
-- `current_student_id()`). Cette lecture passait par `is_coach_of_student()`
-- ÉVALUÉ LIGNE PAR LIGNE ; elle devient ensembliste et suit la catégorie.
--
-- Aucune policy d'écriture n'est créée ici : le niveau `ecriture` n'ouvre pas
-- ce que le coach principal lui-même n'a pas.
drop policy if exists "consumed_meals_select_own_coach" on public.consumed_meals;
create policy "consumed_meals_select_own_coach"
  on public.consumed_meals for select to authenticated
  using (student_id in (select public.student_ids_nutrition_lecture()));

drop policy if exists "meal_entries_select_own_coach" on public.meal_entries;
create policy "meal_entries_select_own_coach"
  on public.meal_entries for select to authenticated
  using (student_id in (select public.student_ids_nutrition_lecture()));

drop policy if exists "planned_meals_select_own_coach" on public.planned_meals;
create policy "planned_meals_select_own_coach"
  on public.planned_meals for select to authenticated
  using (student_id in (select public.student_ids_nutrition_lecture()));

drop policy if exists "planned_meal_items_select_own_coach" on public.planned_meal_items;
create policy "planned_meal_items_select_own_coach"
  on public.planned_meal_items for select to authenticated
  using (student_id in (select public.student_ids_nutrition_lecture()));

drop policy if exists "planned_meal_skipped_slots_select_own_coach" on public.planned_meal_skipped_slots;
create policy "planned_meal_skipped_slots_select_own_coach"
  on public.planned_meal_skipped_slots for select to authenticated
  using (student_id in (select public.student_ids_nutrition_lecture()));


-- ── 6. LE PROPRIÉTAIRE D'UN PLAN NE SE CHOISIT PAS ─────────────────────────
-- `nutrition_plans_fill_coach_id` remplissait `coach_id` depuis
-- `students.coach_id` — le coach PRINCIPAL, donc jamais le collaborateur :
-- c'était déjà juste. Mais il s'arrêtait net si `coach_id` arrivait déjà
-- renseigné (« un propriétaire déjà désigné ne se discute pas »), ce qui
-- laissait un collaborateur s'inscrire propriétaire du plan d'un élève en
-- passant simplement la colonne.
--
-- Le comportement est conservé mot pour mot pour le staff global et le
-- service role ; pour les autres, le propriétaire d'un plan D'ÉLÈVE est
-- FORCÉ à `students.coach_id`. Même discipline que
-- `protect_students_ownership_columns` : on ne refuse pas l'écriture, on
-- ignore la colonne qui ne lui appartient pas.
create or replace function public.nutrition_plans_fill_coach_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Un propriétaire déjà désigné ne se discute pas…
  if new.coach_id is not null then
    -- …sauf s'il est désigné par quelqu'un qui n'est pas propriétaire. Un
    -- collaborateur ne choisit pas à qui appartient le plan de l'élève.
    if auth.uid() is not null
       and coalesce(auth.role(), '') <> 'service_role'
       and not public.est_staff_global()
       and new.student_id is not null then
      select s.coach_id into new.coach_id
        from public.students s
       where s.id = new.student_id;
    end if;
    return new;
  end if;

  -- 1. Le coach de l'élève concerné. C'est la relation la plus SÛRE : elle
  --    est écrite à la création de l'élève (students.coach_id).
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
$$;

alter function public.nutrition_plans_fill_coach_id() owner to postgres;
revoke all on function public.nutrition_plans_fill_coach_id() from public;
revoke all on function public.nutrition_plans_fill_coach_id() from anon;
revoke all on function public.nutrition_plans_fill_coach_id() from authenticated;

comment on function public.nutrition_plans_fill_coach_id() is
  'P13-B/4. Propriétaire d''un plan : students.coach_id pour un plan d''élève, l''auteur pour un plan modèle. Un appelant non staff global ne peut pas désigner le propriétaire d''un plan d''élève.';


-- Le trigger ci-dessus ne couvre que l'INSERT et la RÉAFFECTATION
-- (`before update of student_id`). Un simple `update nutrition_plans set
-- coach_id = <moi>` passait donc à côté : la ligne restait accessible par son
-- `student_id`, aucun droit n'était gagné, mais le propriétaire affiché
-- devenait faux. On ferme la colonne plutôt que de l'espérer non écrite.
--
-- Même forme que `protect_students_ownership_columns` : on ne refuse pas
-- l'écriture, on ignore la colonne qui n'appartient pas à l'appelant.
create or replace function public.protect_nutrition_plans_owner_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.est_staff_global() then
    return new;
  end if;
  -- Ni un élève, ni un collaborateur ne choisit à qui appartient un plan.
  new.coach_id := old.coach_id;
  return new;
end;
$$;

alter function public.protect_nutrition_plans_owner_columns() owner to postgres;
revoke all on function public.protect_nutrition_plans_owner_columns() from public;
revoke all on function public.protect_nutrition_plans_owner_columns() from anon;
revoke all on function public.protect_nutrition_plans_owner_columns() from authenticated;

drop trigger if exists protect_nutrition_plans_owner on public.nutrition_plans;
create trigger protect_nutrition_plans_owner
  before update on public.nutrition_plans
  for each row execute function public.protect_nutrition_plans_owner_columns();


-- ── 8. LA GARDE DE LA MIGRATION ────────────────────────────────────────────
-- Si une policy des huit tables du cœur nutrition opposait encore un ensemble
-- de PROPRIÉTÉ, le collaborateur resterait dehors sans que rien ne le dise.
-- La migration refuse alors de passer pour verte.
do $$
declare v_restes text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into v_restes
    from pg_policies
   where schemaname = 'public'
     and tablename in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                       'nutrition_meal_slot_targets','meals','meal_choice_slots',
                       'meal_choice_options','nutrition_daily_logs',
                       'consumed_meals','meal_entries','planned_meals',
                       'planned_meal_items','planned_meal_skipped_slots')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~
         '(nutrition_plan_ids_geres|nutrition_day_ids_geres|meal_ids_geres|meal_choice_slot_ids_geres|nutrition_plan_profile_ids_geres|student_ids_geres|is_coach_of_student)';
  if v_restes is not null then
    raise exception
      'P13-B/4 : policies encore fondées sur la propriété P13-A, le collaborateur resterait exclu : %', v_restes;
  end if;

  -- Et aucune policy `FOR ALL` ne doit subsister sur ces tables côté coach :
  -- c'est elle qui faisait d'une permission `lecture` un droit d'écriture.
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into v_restes
    from pg_policies
   where schemaname = 'public'
     and tablename in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                       'nutrition_meal_slot_targets','meals','meal_choice_slots',
                       'meal_choice_options','nutrition_daily_logs')
     and cmd = 'ALL'
     and policyname not like '%manage_admin%'
     and policyname not like '%own_student%';
  if v_restes is not null then
    raise exception
      'P13-B/4 : policies FOR ALL restantes côté coach, le niveau lecture y serait inopérant : %', v_restes;
  end if;
end $$;
