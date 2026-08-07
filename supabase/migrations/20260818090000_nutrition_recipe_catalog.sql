-- ============================================================================
-- Migration 20260818090000 — le CATALOGUE de recettes prêt pour la production.
-- (chantier feat/nutrition-recipe-catalog, PR E)
--
-- Deux fonctions, un seul et même problème : jusqu'ici, TOUTE création de
-- recette passait par `save_nutrition_recipe`, qui reçoit `coach_id` DANS la
-- charge utile et l'écrit tel quel. Tant qu'un coach remplissait un formulaire
-- pour lui-même, cela ne se voyait pas. Dès qu'on duplique en masse ou qu'on
-- importe un fichier, cela devient la faille : le navigateur choisit le
-- propriétaire des lignes qu'il crée.
--
-- Les deux fonctions ajoutées ici ne reçoivent JAMAIS de `coach_id` :
--
--   duplicate_nutrition_recipe(uuid)   → le propriétaire est LU sur la source
--   import_nutrition_recipes(jsonb)    → le propriétaire est `current_coach_id()`
--
-- Et la section C DURCIT le chemin manuel — `save_nutrition_recipe` — pour
-- qu'il applique exactement la même règle. Sans elle, la PR E aurait fermé
-- deux portes en en laissant une grande ouverte.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - aucun changement de schéma : ni table, ni colonne, ni contrainte, ni
--     index, ni policy, ni privilège de table. Le catalogue se contente du
--     modèle existant ;
--   - elle ne touche à AUCUNE fonction existante — `save_nutrition_recipe`,
--     `nutrition_recipe_blocking_issue`, `delete_nutrition_recipe` et tout le
--     cycle de vie des PR D restent exactement ce qu'ils sont ;
--   - elle ne modifie aucune donnée à son application ;
--   - elle ne rend visible aucune recette à un élève : une copie et une
--     recette importée naissent en BROUILLON, et la policy élève n'ouvre
--     que `active`.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. DUPLIQUER UNE RECETTE
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI CÔTÉ SERVEUR. La PR D dupliquait depuis le navigateur
-- (`duplicateRecipeForm`) : l'état du formulaire était recopié, les
-- identifiants d'ingrédients régénérés, le tout renvoyé à
-- `save_nutrition_recipe`. Trois faiblesses la rendaient impropre à un
-- catalogue de production :
--
--   1. LE CLIENT CHOISISSAIT LE PROPRIÉTAIRE — un payload forgé créait une
--      recette dans le catalogue d'un AUTRE coach ;
--   2. dupliquer exigeait d'avoir CHARGÉ la recette entière : impossible
--      depuis une liste de plusieurs centaines de lignes sans une requête par
--      carte ;
--   3. la copie dépendait de la fidélité de l'aller-retour base → formulaire
--      → base. Toute colonne oubliée par le formulaire était silencieusement
--      perdue.
--
-- Ici la copie ne quitte jamais la base : `insert … select` recopie les
-- colonnes une à une, et la fonction ne reçoit que l'identifiant de la source.
--
-- LE REMAPPAGE DES LIAISONS, SANS TABLE DE CORRESPONDANCE. Un ingrédient peut
-- être lié à un autre de la MÊME recette. Copier les identifiants tels quels
-- ferait pointer la copie vers l'original — la clé étrangère composite le
-- refuserait d'ailleurs. Plutôt que de tenir une correspondance ancien →
-- nouveau, on s'appuie sur un invariant qui existe déjà :
--
--     constraint nutrition_recipe_ingredients_position_unique
--       unique (recipe_id, position)
--
-- `position` identifie donc un ingrédient de façon unique DANS sa recette. La
-- copie conserve les positions ; les liaisons se traduisent « lié à
-- l'identifiant X » → « lié à la position P » → identifiant de la position P
-- dans la copie. Aucune structure temporaire, traduction exacte par
-- construction.

create or replace function public.duplicate_nutrition_recipe(p_recipe_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_source record;
  v_new_id uuid;
  v_ingredients int := 0;
  v_tags int := 0;
  v_liaisons int := 0;
begin
  -- ── 1. Authentification et rôle ───────────────────────────────────────
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_authenticated');
  end if;
  if not public.is_coach_or_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_staff');
  end if;
  if p_recipe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 2. La source, LUE SOUS RLS ────────────────────────────────────────
  -- `security invoker` : la policy `nutrition_recipes_manage_own_coach` ne
  -- rend que les recettes du coach appelant (ou toutes, pour un admin). La
  -- recette d'un autre coach est donc INTROUVABLE — pas « interdite » :
  -- l'appelant n'apprend même pas qu'elle existe.
  select r.id, r.coach_id, r.name, r.description, r.slot_key
    into v_source
    from public.nutrition_recipes r
   where r.id = p_recipe_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 3. Propriété, opposée explicitement ───────────────────────────────
  -- La RLS suffirait. On le revérifie tout de même : le jour où une policy
  -- s'élargirait, cette fonction ne deviendrait pas silencieusement un moyen
  -- de copier le catalogue d'autrui.
  if not public.is_admin()
     and v_source.coach_id is distinct from public.current_coach_id() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── 4. La copie ───────────────────────────────────────────────────────
  -- LE PROPRIÉTAIRE VIENT DE LA SOURCE, jamais de l'appelant : dupliquer ne
  -- déplace pas une recette d'un catalogue à l'autre, même pour un admin.
  -- STATUT « draft » EN DUR : dupliquer ne publie jamais, quel que soit le
  -- statut de l'original.
  -- `source_key` est volontairement laissée NULLE : c'est l'identité d'une
  -- fixture importée, et son index unique partiel refuserait un doublon.
  insert into public.nutrition_recipes (coach_id, name, description, slot_key, status, source_key)
  values (
    v_source.coach_id,
    left(v_source.name || ' — copie', 120),
    v_source.description,
    v_source.slot_key,
    'draft',
    null
  )
  returning id into v_new_id;

  -- ── 5. Les ingrédients, colonne par colonne, SANS les liaisons ────────
  -- Les liaisons sont posées à l'étape suivante : à cet instant, les
  -- ingrédients cibles n'existent pas encore tous, et la clé étrangère
  -- composite refuserait une référence en avant.
  with copies as (
    insert into public.nutrition_recipe_ingredients (
      recipe_id, position, name, role,
      protein_per_100g, carb_per_100g, fat_per_100g,
      reference_grams, min_grams, max_grams,
      unit_scalable, max_units, unit_name, fixed_label,
      egg, egg_grams,
      linked_to_ingredient_id, link_ratio_bp
    )
    select
      v_new_id, i.position, i.name, i.role,
      i.protein_per_100g, i.carb_per_100g, i.fat_per_100g,
      i.reference_grams, i.min_grams, i.max_grams,
      i.unit_scalable, i.max_units, i.unit_name, i.fixed_label,
      i.egg, i.egg_grams,
      null, null
      from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
     order by i.position
    returning 1
  )
  select count(*) into v_ingredients from copies;

  -- ── 6. Les liaisons, traduites PAR POSITION ───────────────────────────
  with retablies as (
    update public.nutrition_recipe_ingredients cible
       set linked_to_ingredient_id = parent_copie.id,
           link_ratio_bp = source.link_ratio_bp
      from public.nutrition_recipe_ingredients source
      join public.nutrition_recipe_ingredients parent_source
        on parent_source.id = source.linked_to_ingredient_id
      join public.nutrition_recipe_ingredients parent_copie
        on parent_copie.recipe_id = v_new_id
       and parent_copie.position = parent_source.position
     where source.recipe_id = p_recipe_id
       and source.linked_to_ingredient_id is not null
       and cible.recipe_id = v_new_id
       and cible.position = source.position
    returning 1
  )
  select count(*) into v_liaisons from retablies;

  -- ── 7. Les étiquettes ─────────────────────────────────────────────────
  with copies as (
    insert into public.nutrition_recipe_tags (recipe_id, kind, value)
    select v_new_id, t.kind, t.value
      from public.nutrition_recipe_tags t
     where t.recipe_id = p_recipe_id
    returning 1
  )
  select count(*) into v_tags from copies;

  -- ── 8. Filet : la copie doit être COMPLÈTE ────────────────────────────
  -- Un ingrédient perdu en route donnerait une recette qui se comporte
  -- différemment de l'original dans le solveur — exactement ce qu'une
  -- duplication ne doit jamais faire. On préfère annuler.
  if v_ingredients <> (
    select count(*) from public.nutrition_recipe_ingredients where recipe_id = p_recipe_id
  ) then
    raise exception 'DUPLICATE_INCOMPLETE_INGREDIENTS: % copiés', v_ingredients using errcode = '23503';
  end if;
  if v_liaisons <> (
    select count(*) from public.nutrition_recipe_ingredients
     where recipe_id = p_recipe_id and linked_to_ingredient_id is not null
  ) then
    raise exception 'DUPLICATE_INCOMPLETE_LINKS: % rétablies', v_liaisons using errcode = '23503';
  end if;

  return jsonb_build_object(
    'ok', true,
    'recipe_id', v_new_id,
    'source_recipe_id', p_recipe_id,
    'name', left(v_source.name || ' — copie', 120),
    'status', 'draft',
    'copied', jsonb_build_object(
      'ingredients', v_ingredients,
      'links', v_liaisons,
      'tags', v_tags
    )
  );
end;
$fn$;

alter function public.duplicate_nutrition_recipe(uuid) owner to postgres;

comment on function public.duplicate_nutrition_recipe(uuid) is
  'Duplique une recette et TOUS ses enfants en UNE transaction : ingrédients (positions conservées, liaisons traduites par position), étiquettes. Ne reçoit QUE l''identifiant de la source — le propriétaire est LU sur elle, jamais fourni par l''appelant, et la copie naît toujours en ''draft'' avec source_key nulle. La recette d''un autre coach est introuvable (RLS), et la propriété est revérifiée explicitement. Retour structuré { ok, recipe_id, copied } ou { ok:false, reason: forbidden|not_found }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.duplicate_nutrition_recipe(uuid) from public;
revoke execute on function public.duplicate_nutrition_recipe(uuid) from anon;
grant execute on function public.duplicate_nutrition_recipe(uuid) to authenticated;




-- ════════════════════════════════════════════════════════════════════════════
-- B. IMPORTER UN LOT DE RECETTES
-- ════════════════════════════════════════════════════════════════════════════
-- UNE SEULE TRANSACTION POUR TOUT LE LOT. C'est la différence avec l'import de
-- fixtures (`importNutritionRecipeFixtures`), qui fait N appels indépendants et
-- l'assume : pour des recettes de démonstration, un échec isolé est sans
-- conséquence. Pour un fichier de cinquante vraies recettes, un catalogue à
-- moitié écrit est bien pire qu'un import refusé — on ne saurait plus ce qui
-- est passé. Une fonction plpgsql EST une transaction : la moindre exception
-- annule l'intégralité du lot.
--
-- LE PROPRIÉTAIRE N'EST PAS DANS LA CHARGE UTILE. `current_coach_id()` le
-- détermine, et un `coach_id` qui traînerait dans le JSON est purement ignoré —
-- il n'est lu nulle part ci-dessous. C'est ce qui rend l'injection impossible,
-- et non une validation côté navigateur.
--
-- LE STATUT EST IMPOSÉ À 'draft'. Il n'est pas lu du payload non plus : un
-- import ne publie jamais, quoi qu'annonce le fichier.
--
-- LA VALIDATION FINE N'EST PAS ICI. Les contraintes de table (rôle admis,
-- macros positives, nom non vide, unicité des positions, couple liaison/part)
-- rejettent déjà toute ligne incohérente, et leur violation annule le lot.
-- L'analyse préalable côté navigateur sert à EXPLIQUER les erreurs avant
-- d'écrire, pas à les empêcher : c'est la base qui tranche.
--
-- Forme attendue :
--   { "recipes": [ { "name", "description", "slot_key",
--                    "tags": [{"kind","value"}],
--                    "ingredients": [ { "position", "name", "role",
--                                       "protein_per_100g", "carb_per_100g",
--                                       "fat_per_100g", "reference_grams",
--                                       "min_grams", "max_grams",
--                                       "unit_scalable", "max_units",
--                                       "unit_name", "fixed_label",
--                                       "egg", "egg_grams",
--                                       "linked_to_position", "link_ratio_bp" } ] } ] }

create or replace function public.import_nutrition_recipes(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  c_roles constant text[] := array['protein', 'carbohydrate', 'fat', 'fixed', 'free'];
  v_coach uuid;
  v_recettes jsonb;
  v_recette jsonb;
  v_ing jsonb;
  v_tag jsonb;
  v_new_id uuid;
  v_nom text;
  v_creees jsonb := '[]'::jsonb;
  v_nb_ing int;
  v_total_ing int := 0;
begin
  -- ── 1. Authentification, rôle, propriétaire ───────────────────────────
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_authenticated');
  end if;
  if not public.is_coach_or_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'not_staff');
  end if;

  -- LE SERVEUR DÉTERMINE LE PROPRIÉTAIRE. Un administrateur sans fiche coach
  -- n'importe pas : mieux vaut un refus clair qu'un catalogue sans
  -- propriétaire, que la lecture élève n'ouvrirait jamais.
  v_coach := public.current_coach_id();
  if v_coach is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'detail', 'no_coach_profile');
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: objet JSON attendu';
  end if;
  v_recettes := p_payload->'recipes';
  if v_recettes is null or jsonb_typeof(v_recettes) <> 'array' then
    raise exception 'INVALID_PAYLOAD: recipes doit être un tableau';
  end if;
  if jsonb_array_length(v_recettes) = 0 then
    return jsonb_build_object('ok', true, 'created', '[]'::jsonb, 'count', 0);
  end if;
  -- Garde-fou : un fichier démesuré tiendrait un verrou trop longtemps.
  if jsonb_array_length(v_recettes) > 200 then
    raise exception 'IMPORT_TOO_LARGE: % recettes (200 maximum par lot)', jsonb_array_length(v_recettes);
  end if;

  -- ── 2. Le lot, recette par recette, dans LA MÊME transaction ──────────
  for v_recette in select * from jsonb_array_elements(v_recettes) loop
    v_nom := btrim(coalesce(v_recette->>'name', ''));
    if v_nom = '' then
      raise exception 'INVALID_RECIPE: une recette sans nom';
    end if;

    insert into public.nutrition_recipes (coach_id, name, description, slot_key, status, source_key)
    values (
      v_coach,
      v_nom,
      nullif(btrim(coalesce(v_recette->>'description', '')), ''),
      nullif(v_recette->>'slot_key', ''),
      'draft',   -- IMPOSÉ, jamais lu du fichier
      null       -- réservé aux fixtures : une recette importée n'en porte pas
    )
    returning id into v_new_id;

    -- Les ingrédients, SANS les liaisons : à cet instant, les suivants
    -- n'existent pas encore et la clé étrangère composite refuserait une
    -- référence en avant.
    v_nb_ing := 0;
    for v_ing in select * from jsonb_array_elements(coalesce(v_recette->'ingredients', '[]'::jsonb)) loop
      if (v_ing->>'role') is null or not ((v_ing->>'role') = any(c_roles)) then
        raise exception 'INVALID_ROLE: % (recette « % »)', coalesce(v_ing->>'role', '(null)'), v_nom;
      end if;
      insert into public.nutrition_recipe_ingredients (
        recipe_id, position, name, role,
        protein_per_100g, carb_per_100g, fat_per_100g,
        reference_grams, min_grams, max_grams,
        unit_scalable, max_units, unit_name, fixed_label,
        egg, egg_grams
      ) values (
        v_new_id,
        (v_ing->>'position')::int,
        btrim(coalesce(v_ing->>'name', '')),
        v_ing->>'role',
        coalesce((v_ing->>'protein_per_100g')::numeric, 0),
        coalesce((v_ing->>'carb_per_100g')::numeric, 0),
        coalesce((v_ing->>'fat_per_100g')::numeric, 0),
        coalesce((v_ing->>'reference_grams')::numeric, 0),
        (v_ing->>'min_grams')::numeric,
        (v_ing->>'max_grams')::numeric,
        coalesce((v_ing->>'unit_scalable')::boolean, false),
        (v_ing->>'max_units')::int,
        nullif(btrim(coalesce(v_ing->>'unit_name', '')), ''),
        nullif(btrim(coalesce(v_ing->>'fixed_label', '')), ''),
        coalesce((v_ing->>'egg')::boolean, false),
        (v_ing->>'egg_grams')::numeric
      );
      v_nb_ing := v_nb_ing + 1;
    end loop;

    -- Les liaisons, désignées PAR POSITION — le fichier ne manipule aucun
    -- identifiant, et n'a donc aucun moyen d'en désigner un hors de sa
    -- propre recette.
    for v_ing in select * from jsonb_array_elements(coalesce(v_recette->'ingredients', '[]'::jsonb)) loop
      if (v_ing->>'linked_to_position') is not null then
        update public.nutrition_recipe_ingredients cible
           set linked_to_ingredient_id = parent.id,
               link_ratio_bp = (v_ing->>'link_ratio_bp')::int
          from public.nutrition_recipe_ingredients parent
         where cible.recipe_id = v_new_id
           and cible.position = (v_ing->>'position')::int
           and parent.recipe_id = v_new_id
           and parent.position = (v_ing->>'linked_to_position')::int;
        if not found then
          raise exception 'INVALID_LINK: position % introuvable dans « % »',
            v_ing->>'linked_to_position', v_nom;
        end if;
      end if;
    end loop;

    -- Les étiquettes. Le vocabulaire contrôlé est vérifié par la contrainte
    -- `nutrition_recipe_tags_value_check` : une valeur inconnue annule le lot.
    for v_tag in select * from jsonb_array_elements(coalesce(v_recette->'tags', '[]'::jsonb)) loop
      insert into public.nutrition_recipe_tags (recipe_id, kind, value)
      values (v_new_id, v_tag->>'kind', v_tag->>'value')
      on conflict (recipe_id, kind, value) do nothing;
    end loop;

    v_total_ing := v_total_ing + v_nb_ing;
    v_creees := v_creees || jsonb_build_object('recipe_id', v_new_id, 'name', v_nom, 'ingredients', v_nb_ing);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', v_creees,
    'count', jsonb_array_length(v_creees),
    'ingredients', v_total_ing
  );
end;
$fn$;

alter function public.import_nutrition_recipes(jsonb) owner to postgres;

comment on function public.import_nutrition_recipes(jsonb) is
  'Importe un LOT de recettes en UNE seule transaction : la moindre erreur annule tout, jamais de catalogue à moitié écrit. Le propriétaire est current_coach_id() — un coach_id présent dans la charge utile est purement ignoré. Le statut est imposé à ''draft'' : un import ne publie jamais. Les liaisons entre ingrédients sont désignées par POSITION, de sorte qu''un fichier ne peut référencer aucun identifiant hors de sa propre recette. 200 recettes maximum par lot. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.import_nutrition_recipes(jsonb) from public;
revoke execute on function public.import_nutrition_recipes(jsonb) from anon;
grant execute on function public.import_nutrition_recipes(jsonb) to authenticated;



-- ════════════════════════════════════════════════════════════════════════════
-- C. LE CHEMIN MANUEL : le propriétaire n'est plus choisi par le navigateur
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI CLOCHAIT. `save_nutrition_recipe` (20260809090000) lisait
-- `coach_id` DANS la charge utile et l'écrivait tel quel à la création :
--
--     v_coach_id := nullif(v_recipe->>'coach_id', '')::uuid;
--     if v_coach_id is null then raise 'coach_id est obligatoire'; end if;
--     insert into public.nutrition_recipes (coach_id, …) values (v_coach_id, …)
--
-- Deux conséquences, l'une théorique, l'autre déjà réelle :
--
--   1. UN ADMINISTRATEUR pouvait créer une recette dans le catalogue de
--      n'importe quel coach. La policy `nutrition_recipes_manage_admin` a pour
--      `with check` un simple `is_admin()` : elle ne contraint pas la valeur ;
--   2. et sans même parler d'attaque, `useCurrentCoachId` (côté navigateur)
--      RETOMBE sur « le premier coach du cabinet » quand le compte connecté
--      n'a pas de fiche coach. Une recette pouvait donc être attribuée au
--      mauvais propriétaire par simple repli d'interface.
--
-- Un coach ordinaire, lui, était déjà contraint : le `with check` de
-- `nutrition_recipes_manage_own_coach` impose `coach_id = current_coach_id()`.
-- Mais faire reposer une règle de propriété sur le fait qu'une policy
-- l'intercepte, c'est la laisser à la portée du premier élargissement de
-- policy. La règle appartient à la fonction.
--
-- LA RÈGLE, DÉSORMAIS :
--
--     CRÉATION      → coach_id = public.current_coach_id()
--                     Refus explicite si le compte n'a pas de fiche coach.
--     MODIFICATION  → coach_id = celui de la ligne existante, lu sous verrou
--                     et jamais réécrit.
--
-- Et surtout : `coach_id` n'est plus LU du payload. Il n'y a donc plus de
-- valeur cliente à ignorer, à valider ou à refuser — le chemin n'existe plus.
--
-- LE RESTE DE LA FONCTION EST INCHANGÉ, à l'octet près : doctrine de la charge
-- utile partielle (clé absente = colonne non touchée), contrôle
-- d'appartenance des ingrédients, `on conflict` borné à la recette, activation
-- soumise à `nutrition_recipe_blocking_issue`, retour canonique. Seuls les
-- trois emplacements où `coach_id` était décidé ont bougé.
--
-- LES TROIS CHEMINS D'ÉCRITURE APPLIQUENT MAINTENANT LA MÊME RÈGLE :
--   save_nutrition_recipe      → current_coach_id() / propriétaire existant
--   duplicate_nutrition_recipe → propriétaire de la source
--   import_nutrition_recipes   → current_coach_id()
-- Aucun ne reçoit de propriétaire, aucun ne peut en recevoir.

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
  v_status_demande := nullif(v_recipe->>'status', '');
  v_source_key := nullif(v_recipe->>'source_key', '');

  -- `v_recipe->>'coach_id'` N'EST PLUS LU. Nulle part. Le propriétaire est
  -- déterminé plus bas, par la base : à la création depuis l'utilisateur
  -- authentifié, à la modification depuis la ligne existante. Un `coach_id`
  -- resté dans la charge utile est donc inerte — il n'y a plus rien à
  -- « refuser », puisqu'il n'existe plus de chemin pour l'écouter.
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
    -- ── CRÉATION : LE SERVEUR DÉSIGNE LE PROPRIÉTAIRE ──────────────────
    -- `current_coach_id()` résout la fiche coach de l'utilisateur connecté
    -- (coaches.user_id = auth.uid()). C'est la MÊME résolution que celle des
    -- policies de lecture élève, donc une recette créée ici est visible par
    -- les élèves du coach qui l'a créée — et par personne d'autre.
    --
    -- UN ADMINISTRATEUR SANS FICHE COACH NE CRÉE PAS. Ce n'est pas un oubli :
    -- `nutrition_recipes.coach_id` est NOT NULL, et la lecture élève exige
    -- `p.coach_id = r.coach_id`. Une recette sans propriétaire réel serait
    -- invisible de tous, y compris de son auteur. Mieux vaut un refus clair
    -- qu'une ligne morte dans le catalogue.
    v_coach_id := public.current_coach_id();
    if v_coach_id is null then
      raise exception 'NO_COACH_PROFILE: aucune fiche coach rattachée à ce compte' using errcode = '42501';
    end if;

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
    -- ── MODIFICATION : LE PROPRIÉTAIRE EST CELUI DE LA LIGNE ───────────
    -- On lit `coach_id` en même temps que le statut, sous verrou. Il n'est
    -- ensuite JAMAIS réécrit : l'`update` ci-dessous ne nomme pas la colonne.
    -- Un coach ne peut donc pas s'approprier la recette d'un autre, et un
    -- administrateur qui corrige une recette ne se l'attribue pas.
    --
    -- LA RECETTE D'UN AUTRE COACH EST INTROUVABLE, pas « interdite » :
    -- `security invoker` fait jouer `nutrition_recipes_manage_own_coach`, qui
    -- ne rend pas la ligne. `RECIPE_NOT_FOUND` ne révèle donc même pas son
    -- existence.
    select np.status, np.coach_id
      into v_status_courant, v_coach_id
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
  'Enregistre une recette ET ses enfants en UNE transaction. Depuis 20260818090000, `coach_id` n''est plus lu de la charge utile : à la CRÉATION le propriétaire est public.current_coach_id() (refus NO_COACH_PROFILE si le compte n''a pas de fiche coach), à la MODIFICATION c''est celui de la ligne existante, lu sous verrou et jamais réécrit — un coach ne peut pas s''approprier la recette d''un autre, un administrateur qui corrige ne se l''attribue pas. Doctrine de charge utile partielle inchangée : une clé absente ne touche à rien. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated.';

revoke all on function public.save_nutrition_recipe(jsonb) from public;
revoke execute on function public.save_nutrition_recipe(jsonb) from anon;
grant execute on function public.save_nutrition_recipe(jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Vérification à l'application
-- ────────────────────────────────────────────────────────────────────────────
-- Le remappage des liaisons repose ENTIÈREMENT sur l'unicité de
-- (recipe_id, position). Si cette contrainte disparaissait, la traduction
-- deviendrait ambiguë et la copie pourrait lier le mauvais ingrédient.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipe_ingredients'::regclass
       and conname = 'nutrition_recipe_ingredients_position_unique'
  ) then
    raise exception 'duplicate_nutrition_recipe s''appuie sur l''unicité (recipe_id, position) : contrainte absente';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipe_ingredients'::regclass
       and conname = 'nutrition_recipe_ingredients_link_same_recipe'
  ) then
    raise exception 'la clé étrangère composite garantissant qu''une liaison reste dans la recette a disparu';
  end if;
end;
$$;
