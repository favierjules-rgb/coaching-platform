-- ============================================================================
-- Migration 20260809090000 — save_nutrition_recipe : la charge utile ne touche
-- QUE ce qu'elle mentionne (chantier feat/nutrition-recipes-admin, PR B.1).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE CORRECTION
-- ────────────────────────────────────────────────────────────────────────────
-- La version 20260808090000 traitait « clé absente » et « clé présente à
-- null » comme équivalentes. Trois conséquences, toutes reproductibles :
--
--   1. `description = nullif(v_recipe->>'description', '')` écrasait la
--      description à chaque enregistrement d'une charge utile qui ne la
--      portait pas — alors que `name` et `source_key` étaient, eux, préservés
--      par un `coalesce`. Trois colonnes du même objet, deux sémantiques
--      opposées ;
--   2. `v_status := coalesce(nullif(v_recipe->>'status',''), 'draft')`
--      rétrogradait en brouillon toute recette modifiée par une charge utile
--      sans statut — y compris une recette ACTIVE ;
--   3. `coalesce(p_payload->'ingredients', '[]')` et l'équivalent pour
--      `tags` supprimaient tous les enfants quand la clé était absente.
--
-- Le chemin de réimport des fixtures empruntait les trois : réimporter en
-- mode « mettre à jour » remettait la recette en brouillon, effaçait sa
-- description et supprimait toutes ses étiquettes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE CONTRAT, DÉSORMAIS EXPLICITE
-- ────────────────────────────────────────────────────────────────────────────
--   - clé ABSENTE de la charge utile  → la colonne (ou la collection) n'est
--     PAS touchée ; sur une création, elle prend sa valeur par défaut ;
--   - clé PRÉSENTE, même à `null` ou `""` → la valeur est écrite, y compris
--     pour effacer volontairement.
--
-- `jsonb ? 'cle'` distingue les deux — `->>'cle'` ne le peut pas, puisqu'il
-- rend `null` dans les deux cas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEUXIÈME CORRECTION : `on conflict do update` borné à la recette
-- ────────────────────────────────────────────────────────────────────────────
-- Le contrôle d'appartenance (étape 3) LIT les lignes sans les verrouiller.
-- Entre cette lecture et l'écriture, un identifiant absent au moment du
-- contrôle pouvait exister, rattaché à une AUTRE recette, au moment de
-- l'`insert … on conflict` — qui écrasait alors nom, rôle et macros de
-- l'enfant d'autrui. Fenêtre étroite et peu exploitable (les UUID sont
-- aléatoires et générés côté client), mais l'exigence est formulée en
-- absolu : « empêcher toute suppression OU MODIFICATION d'un enfant d'une
-- autre recette ».
--
-- La clause `where nutrition_recipe_ingredients.recipe_id = v_recipe_id`
-- ferme la fenêtre. Un `do update` ainsi filtré ne lève pas : il ne fait
-- rien, silencieusement. Le contrôle d'intégrité ajouté après la boucle
-- (étape 6 bis) transforme ce silence en échec explicite.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - aucune modification de schéma : ni table, ni colonne, ni index, ni
--     contrainte. `source_key` et son index unique partiel restent ceux de
--     20260808090000 ;
--   - aucune donnée insérée, modifiée ou supprimée ;
--   - aucune autre fonction recréée ;
--   - aucune policy ajoutée, retirée ou modifiée ;
--   - aucune lecture élève introduite.
--
-- Elle est donc rejouable, et son annulation consiste à réappliquer
-- 20260808090000.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

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
  v_sync_ingredients boolean;
  v_sync_tags boolean;
  v_recipe_id uuid;
  v_coach_id uuid;
  v_status_demande text;
  v_status text;
  v_status_courant text;
  v_source_key text;
  v_ing jsonb;
  v_ids uuid[] := array[]::uuid[];
  v_intrus uuid;
  v_ecrits int;
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

  -- Clé ABSENTE = collection non touchée. Clé présente = synchronisation.
  v_sync_ingredients := p_payload ? 'ingredients';
  v_sync_tags := p_payload ? 'tags';
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
  v_status_demande := nullif(v_recipe->>'status', '');
  v_source_key := nullif(v_recipe->>'source_key', '');

  if v_coach_id is null then
    raise exception 'INVALID_PAYLOAD: coach_id est obligatoire';
  end if;
  if v_status_demande is not null and v_status_demande not in ('draft', 'active', 'archived') then
    raise exception 'INVALID_STATUS: %', v_status_demande;
  end if;

  -- ── 1. Structure des ingrédients, AVANT toute écriture ────────────────
  if v_sync_ingredients then
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
  end if;

  -- ── 2. Recette : création, ou mise à jour VERROUILLÉE ─────────────────
  if v_recipe_id is null then
    -- CRÉATION : une clé absente prend la valeur par défaut de la colonne.
    v_status := coalesce(v_status_demande, 'draft');

    insert into public.nutrition_recipes (coach_id, name, description, slot_key, status, source_key)
    values (
      v_coach_id,
      coalesce(v_recipe->>'name', ''),
      nullif(v_recipe->>'description', ''),
      nullif(v_recipe->>'slot_key', ''),
      -- Une création demandée en `active` est d'abord écrite en `draft` :
      -- l'activation n'est décidée qu'à l'étape 9, une fois les enfants
      -- écrits et la recette réellement validable.
      'draft',
      v_source_key
    )
    returning id into v_recipe_id;
  else
    select np.status into v_status_courant
      from public.nutrition_recipes np
     where np.id = v_recipe_id
       for update;
    if not found then
      raise exception 'RECIPE_NOT_FOUND: %', v_recipe_id using errcode = 'P0002';
    end if;

    -- MODIFICATION : le statut absent de la charge utile est CONSERVÉ.
    -- Sans cela, enregistrer une recette active sans mentionner son statut
    -- la rétrograderait en brouillon.
    v_status := coalesce(v_status_demande, v_status_courant, 'draft');

    update public.nutrition_recipes r set
      name = case when v_recipe ? 'name'
                  then coalesce(v_recipe->>'name', r.name)
                  else r.name end,
      description = case when v_recipe ? 'description'
                         then nullif(v_recipe->>'description', '')
                         else r.description end,
      slot_key = case when v_recipe ? 'slot_key'
                      then nullif(v_recipe->>'slot_key', '')
                      else r.slot_key end,
      source_key = coalesce(v_source_key, r.source_key),
      updated_at = now()
     where r.id = v_recipe_id;
  end if;

  if v_sync_ingredients then
    -- ── 3. APPARTENANCE : aucun enfant d'une AUTRE recette ──────────────
    -- Sans ce contrôle, un payload forgé déplacerait ou supprimerait
    -- l'ingrédient d'une autre recette.
    select i.id into v_intrus
      from public.nutrition_recipe_ingredients i
     where i.id = any(v_ids) and i.recipe_id <> v_recipe_id
     limit 1;
    if v_intrus is not null then
      raise exception 'INGREDIENT_FROM_ANOTHER_RECIPE: %', v_intrus using errcode = '42501';
    end if;

    -- ── 4. Retrait des enfants ABSENTS du payload ───────────────────────
    -- Les liaisons pointant vers un ingrédient retiré sont d'abord
    -- neutralisées. La clé étrangère est composite
    -- (linked_to_ingredient_id, recipe_id) et déclarée `on delete set null` :
    -- sans cette neutralisation, PostgreSQL tenterait de mettre `recipe_id`
    -- — colonne NOT NULL — à null, et la suppression échouerait. Le couple
    -- (parent, ratio) doit par ailleurs rester cohérent, sinon la contrainte
    -- CHECK `link_pair` refuserait un ratio orphelin.
    update public.nutrition_recipe_ingredients i
       set linked_to_ingredient_id = null, link_ratio_bp = null
     where i.recipe_id = v_recipe_id
       and i.linked_to_ingredient_id is not null
       and not (i.linked_to_ingredient_id = any(v_ids));

    delete from public.nutrition_recipe_ingredients i
     where i.recipe_id = v_recipe_id
       and not (i.id = any(v_ids));

    -- ── 5. Positions : décalage pour éviter les collisions ──────────────
    -- `unique (recipe_id, position)` interdit de renuméroter en place : deux
    -- lignes se croiseraient.
    update public.nutrition_recipe_ingredients i
       set position = i.position + 100000
     where i.recipe_id = v_recipe_id;

    -- ── 6. Écriture des ingrédients, SANS liaison ───────────────────────
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
        updated_at = now()
      -- Deuxième barrière, contre la course décrite en tête de fichier :
      -- une ligne rattachée à une AUTRE recette n'est jamais réécrite.
      where nutrition_recipe_ingredients.recipe_id = v_recipe_id;
    end loop;

    -- ── 6 bis. Le filtre ci-dessus ne lève pas : il ignore. ─────────────
    -- On vérifie donc que TOUS les identifiants cités appartiennent bien
    -- maintenant à cette recette. Sinon, l'écriture a été partiellement
    -- ignorée et la transaction doit échouer bruyamment.
    select count(*) into v_ecrits
      from public.nutrition_recipe_ingredients i
     where i.recipe_id = v_recipe_id and i.id = any(v_ids);
    if v_ecrits <> coalesce(array_length(v_ids, 1), 0) then
      raise exception 'INGREDIENT_FROM_ANOTHER_RECIPE: écriture ignorée pour au moins un ingrédient'
        using errcode = '42501';
    end if;

    -- ── 7. Seconde passe : les liaisons ─────────────────────────────────
    -- La clé étrangère composite exige que le parent existe DÉJÀ : impossible
    -- de poser les liens en une seule passe quand A référence B et que B est
    -- écrit après A.
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
  end if;

  -- ── 8. Étiquettes : synchronisation, si et seulement si mentionnées ───
  if v_sync_tags then
    delete from public.nutrition_recipe_tags t
     where t.recipe_id = v_recipe_id
       and not exists (
         select 1 from jsonb_array_elements(v_tags) e
          where e->>'kind' = t.kind and e->>'value' = t.value);

    insert into public.nutrition_recipe_tags (recipe_id, kind, value)
    select v_recipe_id, e->>'kind', e->>'value'
      from jsonb_array_elements(v_tags) e
    on conflict (recipe_id, kind, value) do nothing;
  end if;

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
  'Sauvegarde ATOMIQUE d''une recette : ligne principale, ingrédients et étiquettes écrits dans UNE transaction. La charge utile ne touche QUE ce qu''elle mentionne — une clé absente laisse la colonne ou la collection inchangée, une clé présente écrit sa valeur, y compris pour effacer. Contrôle d''appartenance (aucun enfant d''une autre recette, y compris contre une course sur l''upsert), écriture des liaisons en seconde passe (clé étrangère composite), et activation arbitrée par nutrition_recipe_blocking_issue — un refus annule tout et laisse l''ancienne version intacte. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. N''accepte AUCUNE quantité calculée : la liste de colonnes est explicite, une RecipeSolution n''a nulle part où être écrite.';

revoke all on function public.save_nutrition_recipe(jsonb) from public;
revoke execute on function public.save_nutrition_recipe(jsonb) from anon;
grant execute on function public.save_nutrition_recipe(jsonb) to authenticated;
