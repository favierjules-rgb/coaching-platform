-- ============================================================================
-- Migration 20260808090000 — écriture ATOMIQUE d'une recette
-- (chantier feat/nutrition-recipes-admin, PR B).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Une recette, c'est UNE ligne principale, N ingrédients et M étiquettes.
-- `supabase-js` n'offre aucune transaction multi-requêtes : une suite
-- d'`insert()/update()/delete()` depuis le navigateur peut laisser une recette
-- à moitié enregistrée — ingrédients écrits, étiquettes manquantes, ou pire :
-- une recette passée `active` alors que ses ingrédients n'ont pas été écrits.
--
-- C'est le même raisonnement que `save_nutrition_plan_v2` (20260804090000) et
-- `assign_nutrition_plan` (20260806090000) : ce qui doit être atomique vit
-- dans UNE fonction PostgreSQL, appelée par un unique `supabase.rpc(...)`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. ajoute `nutrition_recipes.source_key` + un index unique PARTIEL
--      `(coach_id, source_key) where source_key is not null` — l'identité
--      technique stable d'une recette importée, qui rend l'import rejouable
--      sans doublon ;
--   B. crée `public.save_nutrition_recipe(p_payload jsonb)` : création ou
--      modification d'une recette AVEC ses enfants, dans UNE transaction.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE donnée insérée. Les 11 fixtures restent des fixtures ; leur
--     import est MANUEL, déclenché par le staff depuis l'interface ;
--   - AUCUNE suppression définitive de recette : `archived` est un statut,
--     pas un `delete` ;
--   - AUCUNE table de portion calculée. Une `RecipeSolution` n'a nulle part
--     où être écrite, et la RPC refuse tout champ qu'elle ne connaît pas ;
--   - AUCUNE policy de lecture élève ajoutée — décision de la PR A,
--     inchangée ici ;
--   - AUCUNE modification des tables de plans v1 ou v2.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI `source_key` PLUTÔT QUE LE NOM
-- ────────────────────────────────────────────────────────────────────────────
-- Audit fait avant d'écrire : les 11 fixtures POSSÈDENT une clé technique
-- stable (`Recipe.id` — `proto-13`, `proto-15`, `derive-1g`…), distincte du
-- nom affiché (« Bol Riz Poulet Curry »). Mais `nutrition_recipes` n'avait
-- aucune colonne pour la conserver, et ces identifiants ne sont pas des
-- UUID : ils ne peuvent donc pas servir de clé primaire.
--
-- `source_key` porte cette identité sous la forme `fixture:<cle_technique>`.
-- Conséquence directe : réimporter ne crée jamais de doublon, et une recette
-- SAISIE À LA MAIN portant le même nom qu'une fixture n'est jamais touchée —
-- elle a `source_key = null`, donc elle n'est jamais reconnue comme fixture.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. Identité technique stable d'une recette importée
-- ────────────────────────────────────────────────────────────────────────────
alter table public.nutrition_recipes
  add column if not exists source_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'nutrition_recipes_source_key_format'
       and conrelid = 'public.nutrition_recipes'::regclass
  ) then
    alter table public.nutrition_recipes
      add constraint nutrition_recipes_source_key_format
      check (source_key is null or source_key ~ '^[a-z][a-z0-9_]{0,31}:[A-Za-z0-9_.:-]{1,64}$');
  end if;
end $$;

-- Index unique PARTIEL : les recettes saisies à la main (`source_key is null`)
-- ne sont pas contraintes, et il peut y en avoir autant qu'on veut.
create unique index if not exists nutrition_recipes_source_key_unique
  on public.nutrition_recipes (coach_id, source_key)
  where source_key is not null;

comment on column public.nutrition_recipes.source_key is
  'Identité TECHNIQUE stable d''une recette importée, sous la forme « <espace>:<cle> » — par exemple « fixture:proto-13 ». null = recette saisie à la main. Elle rend l''import rejouable sans doublon, et garantit qu''une recette manuelle portant le même NOM qu''une fixture n''est jamais touchée. Ne JAMAIS déduire l''identité d''une recette depuis son nom affiché.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. save_nutrition_recipe — écriture atomique
-- ────────────────────────────────────────────────────────────────────────────
-- CHARGE UTILE ATTENDUE :
--   {
--     "recipe": { "id": uuid|null, "coach_id": uuid, "name": text,
--                 "description": text|null, "slot_key": text|null,
--                 "status": text, "source_key": text|null },
--     "ingredients": [ { "id": uuid, "position": int, "name": text,
--                        "role": text, "protein_per_100g": num, … } ],
--     "tags": [ { "kind": text, "value": text } ]
--   }
--
-- Le CLIENT génère les UUID des nouveaux ingrédients AVANT la sauvegarde :
-- sans cela, `linked_to_ingredient_id` ne pourrait pas désigner un autre
-- ingrédient du même payload.
--
-- ORDRE DES ÉCRITURES, et pourquoi il est ce qu'il est :
--   1. verrouillage de la recette existante ;
--   2. contrôle d'APPARTENANCE : tout identifiant d'ingrédient cité doit être
--      soit nouveau, soit déjà rattaché à CETTE recette. Un identifiant
--      appartenant à une AUTRE recette fait échouer la transaction — sans ce
--      contrôle, un payload forgé pourrait déplacer ou supprimer l'ingrédient
--      d'autrui ;
--   3. suppression des enfants absents du payload ;
--   4. décalage des positions conservées (+100000) : `unique (recipe_id,
--      position)` interdit de renuméroter en place, deux lignes se
--      croiseraient ;
--   5. écriture des ingrédients avec `linked_to_ingredient_id = null` : la
--      clé étrangère composite exige que le parent existe déjà ;
--   6. seconde passe : pose des liaisons ;
--   7. synchronisation des étiquettes ;
--   8. si `status = 'active'` : `nutrition_recipe_blocking_issue()` doit
--      rendre `null`, sinon exception — donc ROLLBACK complet, et l'ancienne
--      version reste intacte.
create or replace function public.save_nutrition_recipe(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  c_roles constant text[] := array['protein', 'carbohydrate', 'fat', 'fixed', 'free'];
  v_recipe jsonb;
  v_ingredients jsonb;
  v_tags jsonb;
  v_recipe_id uuid;
  v_coach_id uuid;
  v_status text;
  v_source_key text;
  v_ing jsonb;
  v_ids uuid[] := array[]::uuid[];
  v_intrus uuid;
  v_issue text;
  v_row record;
  v_nb_ing int;
  v_nb_tags int;
begin
  -- ── 0. Autorisation ───────────────────────────────────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: objet JSON attendu';
  end if;

  v_recipe := p_payload->'recipe';
  v_ingredients := coalesce(p_payload->'ingredients', '[]'::jsonb);
  v_tags := coalesce(p_payload->'tags', '[]'::jsonb);

  if v_recipe is null or jsonb_typeof(v_recipe) <> 'object' then
    raise exception 'INVALID_PAYLOAD: recipe manquant';
  end if;
  if jsonb_typeof(v_ingredients) <> 'array' then
    raise exception 'INVALID_PAYLOAD: ingredients doit être un tableau';
  end if;
  if jsonb_typeof(v_tags) <> 'array' then
    raise exception 'INVALID_PAYLOAD: tags doit être un tableau';
  end if;

  v_recipe_id := nullif(v_recipe->>'id', '')::uuid;
  v_coach_id := nullif(v_recipe->>'coach_id', '')::uuid;
  v_status := coalesce(nullif(v_recipe->>'status', ''), 'draft');
  v_source_key := nullif(v_recipe->>'source_key', '');

  if v_coach_id is null then
    raise exception 'INVALID_PAYLOAD: coach_id est obligatoire';
  end if;
  if v_status not in ('draft', 'active', 'archived') then
    raise exception 'INVALID_STATUS: %', v_status;
  end if;

  -- ── 1. Structure des ingrédients, AVANT toute écriture ────────────────
  for v_ing in select * from jsonb_array_elements(v_ingredients) loop
    if nullif(v_ing->>'id', '') is null then
      raise exception 'INVALID_INGREDIENT: chaque ingrédient doit porter un identifiant (le client les génère)';
    end if;
    if (v_ing->>'role') is null or not ((v_ing->>'role') = any(c_roles)) then
      raise exception 'INVALID_ROLE: %', coalesce(v_ing->>'role', '(null)');
    end if;
    if (v_ing->>'id')::uuid = any(v_ids) then
      raise exception 'DUPLICATE_INGREDIENT_ID: %', v_ing->>'id';
    end if;
    v_ids := array_append(v_ids, (v_ing->>'id')::uuid);
  end loop;

  -- ── 2. Recette : création, ou mise à jour VERROUILLÉE ─────────────────
  if v_recipe_id is null then
    insert into public.nutrition_recipes (coach_id, name, description, slot_key, status, source_key)
    values (
      v_coach_id,
      coalesce(v_recipe->>'name', ''),
      nullif(v_recipe->>'description', ''),
      nullif(v_recipe->>'slot_key', ''),
      -- Une création demandée en `active` est d'abord écrite en `draft` :
      -- l'activation n'est décidée qu'à l'étape 8, une fois les enfants
      -- écrits et la recette réellement validable.
      'draft',
      v_source_key
    )
    returning id into v_recipe_id;
  else
    perform 1 from public.nutrition_recipes np
      where np.id = v_recipe_id for update;
    if not found then
      raise exception 'RECIPE_NOT_FOUND: %', v_recipe_id using errcode = 'P0002';
    end if;

    update public.nutrition_recipes r set
      name = coalesce(v_recipe->>'name', r.name),
      description = nullif(v_recipe->>'description', ''),
      slot_key = nullif(v_recipe->>'slot_key', ''),
      source_key = coalesce(v_source_key, r.source_key),
      updated_at = now()
     where r.id = v_recipe_id;
  end if;

  -- ── 3. APPARTENANCE : aucun enfant d'une AUTRE recette ────────────────
  -- Sans ce contrôle, un payload forgé déplacerait ou supprimerait
  -- l'ingrédient d'une autre recette.
  select i.id into v_intrus
    from public.nutrition_recipe_ingredients i
   where i.id = any(v_ids) and i.recipe_id <> v_recipe_id
   limit 1;
  if v_intrus is not null then
    raise exception 'INGREDIENT_FROM_ANOTHER_RECIPE: %', v_intrus using errcode = '42501';
  end if;

  -- ── 4. Retrait des enfants ABSENTS du payload ─────────────────────────
  -- Les liaisons pointant vers un ingrédient retiré sont d'abord neutralisées :
  -- la clé étrangère est en `on delete set null`, mais le couple
  -- (parent, ratio) doit rester cohérent — sinon la contrainte CHECK
  -- `link_pair` échouerait sur un ratio orphelin.
  update public.nutrition_recipe_ingredients i
     set linked_to_ingredient_id = null, link_ratio_bp = null
   where i.recipe_id = v_recipe_id
     and i.linked_to_ingredient_id is not null
     and not (i.linked_to_ingredient_id = any(v_ids));

  delete from public.nutrition_recipe_ingredients i
   where i.recipe_id = v_recipe_id
     and not (i.id = any(v_ids));

  -- ── 5. Positions : décalage pour éviter les collisions ────────────────
  update public.nutrition_recipe_ingredients i
     set position = i.position + 100000
   where i.recipe_id = v_recipe_id;

  -- ── 6. Écriture des ingrédients, SANS liaison ─────────────────────────
  for v_ing in select * from jsonb_array_elements(v_ingredients) loop
    insert into public.nutrition_recipe_ingredients (
      id, recipe_id, position, name, role,
      protein_per_100g, carb_per_100g, fat_per_100g, reference_grams,
      min_grams, max_grams, unit_scalable, max_units, unit_name,
      fixed_label, egg, egg_grams, linked_to_ingredient_id, link_ratio_bp
    ) values (
      (v_ing->>'id')::uuid,
      v_recipe_id,
      coalesce((v_ing->>'position')::integer, 1),
      coalesce(v_ing->>'name', ''),
      v_ing->>'role',
      coalesce((v_ing->>'protein_per_100g')::numeric, 0),
      coalesce((v_ing->>'carb_per_100g')::numeric, 0),
      coalesce((v_ing->>'fat_per_100g')::numeric, 0),
      coalesce((v_ing->>'reference_grams')::numeric, 0),
      (v_ing->>'min_grams')::numeric,
      (v_ing->>'max_grams')::numeric,
      coalesce((v_ing->>'unit_scalable')::boolean, false),
      (v_ing->>'max_units')::integer,
      nullif(v_ing->>'unit_name', ''),
      nullif(v_ing->>'fixed_label', ''),
      coalesce((v_ing->>'egg')::boolean, false),
      (v_ing->>'egg_grams')::numeric,
      null,
      null
    )
    on conflict (id) do update set
      position = excluded.position,
      name = excluded.name,
      role = excluded.role,
      protein_per_100g = excluded.protein_per_100g,
      carb_per_100g = excluded.carb_per_100g,
      fat_per_100g = excluded.fat_per_100g,
      reference_grams = excluded.reference_grams,
      min_grams = excluded.min_grams,
      max_grams = excluded.max_grams,
      unit_scalable = excluded.unit_scalable,
      max_units = excluded.max_units,
      unit_name = excluded.unit_name,
      fixed_label = excluded.fixed_label,
      egg = excluded.egg,
      egg_grams = excluded.egg_grams,
      linked_to_ingredient_id = null,
      link_ratio_bp = null,
      updated_at = now();
  end loop;

  -- ── 7. Seconde passe : les liaisons ───────────────────────────────────
  -- La clé étrangère composite (linked_to_ingredient_id, recipe_id) exige que
  -- le parent existe DÉJÀ : impossible de poser les liens en une seule passe
  -- quand A référence B et que B est écrit après A.
  for v_ing in select * from jsonb_array_elements(v_ingredients) loop
    if nullif(v_ing->>'linked_to_ingredient_id', '') is not null then
      update public.nutrition_recipe_ingredients i set
        linked_to_ingredient_id = (v_ing->>'linked_to_ingredient_id')::uuid,
        link_ratio_bp = (v_ing->>'link_ratio_bp')::integer,
        updated_at = now()
       where i.id = (v_ing->>'id')::uuid
         and i.recipe_id = v_recipe_id;
    end if;
  end loop;

  -- ── 8. Étiquettes : synchronisation ───────────────────────────────────
  delete from public.nutrition_recipe_tags t
   where t.recipe_id = v_recipe_id
     and not exists (
       select 1 from jsonb_array_elements(v_tags) e
        where e->>'kind' = t.kind and e->>'value' = t.value);

  insert into public.nutrition_recipe_tags (recipe_id, kind, value)
  select v_recipe_id, e->>'kind', e->>'value'
    from jsonb_array_elements(v_tags) e
  on conflict (recipe_id, kind, value) do nothing;

  -- ── 9. Activation : la BASE est l'arbitre ─────────────────────────────
  -- La validation TypeScript donne un retour immédiat à l'écran ; c'est
  -- celle-ci qui fait foi. Un refus lève, donc annule TOUTE la transaction :
  -- l'ancienne version de la recette reste intacte, y compris ses enfants.
  if v_status = 'active' then
    v_issue := public.nutrition_recipe_blocking_issue(v_recipe_id);
    if v_issue is not null then
      raise exception 'RECIPE_NOT_ACTIVABLE: %', v_issue using errcode = '23514';
    end if;
  end if;

  update public.nutrition_recipes r
     set status = v_status, updated_at = now()
   where r.id = v_recipe_id;

  -- ── 10. Retour canonique ──────────────────────────────────────────────
  select r.id, r.coach_id, r.name, r.description, r.slot_key, r.status, r.source_key, r.updated_at
    into v_row
    from public.nutrition_recipes r where r.id = v_recipe_id;

  select count(*) into v_nb_ing
    from public.nutrition_recipe_ingredients i where i.recipe_id = v_recipe_id;
  select count(*) into v_nb_tags
    from public.nutrition_recipe_tags t where t.recipe_id = v_recipe_id;

  return jsonb_build_object(
    'recipe', jsonb_build_object(
      'id', v_row.id,
      'coach_id', v_row.coach_id,
      'name', v_row.name,
      'description', v_row.description,
      'slot_key', v_row.slot_key,
      'status', v_row.status,
      'source_key', v_row.source_key,
      'updated_at', v_row.updated_at
    ),
    'ingredient_count', v_nb_ing,
    'tag_count', v_nb_tags,
    'blocking_issue', public.nutrition_recipe_blocking_issue(v_recipe_id)
  );
end;
$fn$;

alter function public.save_nutrition_recipe(jsonb) owner to postgres;

comment on function public.save_nutrition_recipe(jsonb) is
  'Sauvegarde ATOMIQUE d''une recette : ligne principale, ingrédients et étiquettes écrits dans UNE transaction. Contrôle d''appartenance (aucun enfant d''une autre recette), écriture des liaisons en seconde passe (clé étrangère composite), et activation arbitrée par nutrition_recipe_blocking_issue — un refus annule tout et laisse l''ancienne version intacte. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. N''accepte AUCUNE quantité calculée : une RecipeSolution n''a pas de place dans la charge utile.';

revoke all on function public.save_nutrition_recipe(jsonb) from public;
revoke execute on function public.save_nutrition_recipe(jsonb) from anon;
grant execute on function public.save_nutrition_recipe(jsonb) to authenticated;
