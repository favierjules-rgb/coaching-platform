-- ============================================================================
-- Migration 20260813090000 — lecture élève des recettes, et cloisonnement des
-- coachs entre eux (chantier feat/student-nutrition-recipes, PR C — lot 4/4).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. `public.current_coach_id()` — le coach RATTACHÉ au compte connecté.
--   B. Les trois policies « staff » des recettes deviennent :
--        administrateur → tout ;
--        coach          → SES recettes uniquement.
--   C. Trois policies de LECTURE élève, chacune ré-exprimant la chaîne
--      ENTIÈRE : recette active ∧ coach du plan assigné à CET élève.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA CHAÎNE D'AUTORISATION, ET POURQUOI ELLE PASSE PAR LE PLAN
-- ────────────────────────────────────────────────────────────────────────────
--        élève courant  (current_student_id())
--     → nutrition_plans.student_id
--     → nutrition_plans.coach_id
--     → nutrition_recipes.coach_id
--     ∧ nutrition_recipes.status = 'active'
--
-- `students.coach_id` n'est PAS utilisé, et ce n'est pas un détail :
-- `students_update_self_or_staff` (baseline:3020) est un `for update` SANS
-- `with check`. Avant la migration 20260810090000, un élève pouvait donc
-- réécrire son propre `coach_id` et, si la visibilité s'y appuyait, choisir
-- quel catalogue il consulte. Le trigger `protect_students_ownership` ferme
-- désormais cette porte — mais la règle reste : la source de vérité du coach
-- autorisé est `nutrition_plans.coach_id`, colonne sur laquelle un élève n'a
-- AUCUN droit d'écriture.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CHAQUE ENFANT RÉ-EXPRIME TOUT
-- ────────────────────────────────────────────────────────────────────────────
-- La clé primaire de `nutrition_recipe_tags` est `(recipe_id, kind, value)`.
-- Une policy enfant « plus simple » — par exemple `using (true)` ou un filtre
-- sur `kind` seul — permettrait `GET /rest/v1/nutrition_recipe_tags?select=*`
-- et livrerait l'énumération complète des identifiants de recettes AVEC leur
-- profil allergène, sans jamais lire `nutrition_recipes`. Les ingrédients
-- livreraient en prime les macros pour 100 g.
--
-- Une policy parent ne protège JAMAIS ses enfants : PostgreSQL évalue chaque
-- table indépendamment. Les trois prédicats ci-dessous sont donc identiques
-- mot pour mot, à la jointure de rattachement près.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - aucune policy d'ÉCRITURE élève : SELECT et rien d'autre ;
--   - aucun accès aux recettes `draft` ni `archived` ;
--   - aucun accès aux recettes d'un autre coach ;
--   - aucune dépendance à une donnée que l'élève contrôle (ses allergies, son
--     régime) : le profil alimentaire affine un ensemble déjà autorisé, il ne
--     détermine jamais cet ensemble ;
--   - aucune modification de schéma, aucune donnée touchée.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PRÉ-CONTRÔLE — personne ne doit perdre l'accès à ses propres recettes
-- ────────────────────────────────────────────────────────────────────────────
-- Le cloisonnement par coach s'appuie sur `coaches.user_id`. Si une recette
-- appartient à un coach dont la fiche n'est rattachée à aucun compte auth, ce
-- coach ne pourrait plus la modifier — seuls les administrateurs le
-- pourraient. On refuse d'appliquer la migration dans ce cas plutôt que de
-- verrouiller quelqu'un en silence.
do $$
declare
  v_liste text;
begin
  select string_agg(distinct c.name || ' (' || c.id::text || ')', ', ') into v_liste
    from public.nutrition_recipes r
    join public.coaches c on c.id = r.coach_id
   where c.user_id is null;

  if v_liste is not null then
    raise exception
      'MIGRATION IMPOSSIBLE : ces coachs possèdent des recettes mais leur fiche n''est rattachée à aucun compte (coaches.user_id est null) : %. Rattache-les avant de rejouer, sinon ils perdraient l''accès à leurs propres recettes.',
      v_liste;
  end if;

  raise notice 'Pré-contrôle : tous les coachs propriétaires de recettes sont rattachés à un compte.';
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- A. `current_coach_id()`
-- ────────────────────────────────────────────────────────────────────────────
-- `security definer` pour la même raison que `current_student_id()`
-- (baseline:62-70) : la policy de `coaches` est elle-même restrictive, et une
-- fonction `invoker` ne pourrait pas lire la ligne dont elle a besoin pour
-- décider. `search_path` fixé, propriétaire postgres, EXECUTE minimal.
--
-- `order by created_at, id limit 1` : `coaches.user_id` n'est pas unique.
-- Sans ordre total, deux fiches rattachées au même compte rendraient un
-- résultat non déterministe — le défaut exact que `current_student_id()`
-- porte encore (aucun `limit 1`, aucune unicité sur `students.user_id`).
create or replace function public.current_coach_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.coaches c
   where c.user_id = auth.uid()
   order by c.created_at, c.id
   limit 1;
$$;

alter function public.current_coach_id() owner to postgres;

comment on function public.current_coach_id() is
  'Identifiant du coach rattaché au compte connecté (coaches.user_id = auth.uid()), ou NULL. Miroir de current_student_id() côté staff. Déterministe : ordre total sur (created_at, id). Retourne NULL pour un élève, un anonyme et un compte non rattaché — donc toute policy « colonne = current_coach_id() » est fausse pour eux, jamais vraie.';

revoke all on function public.current_coach_id() from public;
revoke execute on function public.current_coach_id() from anon;
grant execute on function public.current_coach_id() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- B. Gestion : l'administrateur voit tout, le coach ne voit que le sien
-- ────────────────────────────────────────────────────────────────────────────
-- `is_coach_or_admin()` ne distingue pas les coachs entre eux : elle répond
-- `true` pour n'importe lequel. Les trois policies « manage_staff » de
-- 20260807090000 accordaient donc à tout le staff la gestion de toutes les
-- recettes. On les remplace par deux policies par table.
drop policy if exists "nutrition_recipes_manage_staff" on public.nutrition_recipes;
drop policy if exists "nutrition_recipe_ingredients_manage_staff" on public.nutrition_recipe_ingredients;
drop policy if exists "nutrition_recipe_tags_manage_staff" on public.nutrition_recipe_tags;

-- Administrateur : tout, sur les trois tables.
create policy "nutrition_recipes_manage_admin" on public.nutrition_recipes
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nutrition_recipe_ingredients_manage_admin" on public.nutrition_recipe_ingredients
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nutrition_recipe_tags_manage_admin" on public.nutrition_recipe_tags
  for all using (public.is_admin()) with check (public.is_admin());

-- Coach : ses recettes, et leurs enfants.
create policy "nutrition_recipes_manage_own_coach" on public.nutrition_recipes
  for all
  using (coach_id = public.current_coach_id())
  with check (coach_id = public.current_coach_id());

create policy "nutrition_recipe_ingredients_manage_own_coach" on public.nutrition_recipe_ingredients
  for all
  using (
    exists (
      select 1 from public.nutrition_recipes r
       where r.id = nutrition_recipe_ingredients.recipe_id
         and r.coach_id = public.current_coach_id()
    )
  )
  with check (
    exists (
      select 1 from public.nutrition_recipes r
       where r.id = nutrition_recipe_ingredients.recipe_id
         and r.coach_id = public.current_coach_id()
    )
  );

create policy "nutrition_recipe_tags_manage_own_coach" on public.nutrition_recipe_tags
  for all
  using (
    exists (
      select 1 from public.nutrition_recipes r
       where r.id = nutrition_recipe_tags.recipe_id
         and r.coach_id = public.current_coach_id()
    )
  )
  with check (
    exists (
      select 1 from public.nutrition_recipes r
       where r.id = nutrition_recipe_tags.recipe_id
         and r.coach_id = public.current_coach_id()
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- C. Lecture élève — la chaîne entière, trois fois
-- ────────────────────────────────────────────────────────────────────────────
-- `current_student_id()` vaut NULL pour un coach, un administrateur, un
-- anonyme et un authentifié sans fiche `students`. `p.student_id = NULL` est
-- NULL, donc faux : aucune de ces trois policies ne peut leur ouvrir quoi que
-- ce soit. C'est ce qui rend sûr le fait de ne PAS ajouter de clause `TO`.
create policy "nutrition_recipes_select_student" on public.nutrition_recipes
  for select
  using (
    status = 'active'
    and exists (
      select 1 from public.nutrition_plans p
       where p.student_id = public.current_student_id()
         and p.coach_id is not null
         and p.coach_id = nutrition_recipes.coach_id
    )
  );

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
         and p.coach_id is not null
    )
  );

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
         and p.coach_id is not null
    )
  );

comment on table public.nutrition_recipes is
  'Recette adaptative d''un coach. LECTURE ÉLÈVE : uniquement les recettes `active` du coach de son plan assigné (nutrition_plans.coach_id) — jamais un brouillon, jamais une archive, jamais le catalogue d''un autre coach. ÉCRITURE : le coach propriétaire, ou un administrateur. Aucune quantité calculée n''est stockée ici ni ailleurs.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. Privilèges : l'élève lit, il n'écrit pas
-- ────────────────────────────────────────────────────────────────────────────
-- Les quatre droits restent nécessaires au rôle `authenticated`, que coach et
-- élève partagent ; c'est la RLS qui sépare. TRUNCATE reste retiré (posé par
-- 20260807090000, réaffirmé ici pour que la migration soit auto-suffisante).
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'nutrition_recipes', 'nutrition_recipe_ingredients', 'nutrition_recipe_tags'
  ] loop
    execute format('revoke all on table public.%I from public', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('revoke all on table public.%I from authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Contrôle final
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_manquantes text;
begin
  select string_agg(attendue, ', ') into v_manquantes
    from unnest(array[
      'nutrition_recipes_select_student',
      'nutrition_recipe_ingredients_select_student',
      'nutrition_recipe_tags_select_student',
      'nutrition_recipes_manage_admin',
      'nutrition_recipes_manage_own_coach',
      'nutrition_recipe_ingredients_manage_admin',
      'nutrition_recipe_ingredients_manage_own_coach',
      'nutrition_recipe_tags_manage_admin',
      'nutrition_recipe_tags_manage_own_coach'
    ]) as attendue
   where not exists (select 1 from pg_policy where polname = attendue);

  if v_manquantes is not null then
    raise exception 'MIGRATION IMPOSSIBLE : policies absentes : %', v_manquantes;
  end if;

  -- Aucune policy « staff global » ne doit subsister sur les recettes.
  if exists (
    select 1 from pg_policy
     where polname in ('nutrition_recipes_manage_staff',
                       'nutrition_recipe_ingredients_manage_staff',
                       'nutrition_recipe_tags_manage_staff')
  ) then
    raise exception 'MIGRATION IMPOSSIBLE : une policy staff globale subsiste sur les recettes.';
  end if;

  raise notice 'Lecture élève et cloisonnement coach posés : 9 policies actives sur les trois tables.';
end $$;
