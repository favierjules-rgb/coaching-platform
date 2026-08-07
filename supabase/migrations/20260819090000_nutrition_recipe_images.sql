-- ============================================================================
-- PR E.1 — UNE photo principale par recette
-- ============================================================================
-- CE QUE CETTE MIGRATION GARANTIT, ET QUI NE DÉPEND D'AUCUN ÉCRAN
--
--   1. une recette porte AU PLUS une image, désignée par un CHEMIN STABLE
--      (`image_path`) — jamais une URL, encore moins une URL signée qui
--      expirerait dans la colonne ;
--   2. ce chemin ne peut désigner que le dossier de CETTE recette, chez SON
--      coach : la contrainte de table le vérifie ligne par ligne, sans passer
--      par la moindre fonction ;
--   3. l'objet Storage lui-même n'est écrivable que par le coach propriétaire
--      de la recette nommée dans le chemin — vérifié par une JOINTURE sur
--      `nutrition_recipes`, pas par une comparaison de chaînes ;
--   4. le poids et le type MIME sont plafonnés PAR LE BUCKET : un client
--      forgé qui contournerait l'optimisation du navigateur se heurte quand
--      même au refus de Storage ;
--   5. l'élève n'a AUCUN droit d'écriture, de suppression ni de listage sur
--      ce bucket. Il lit les photos par l'URL publique, comme n'importe quel
--      visiteur — et une photo de plat n'est pas une donnée d'élève.
--
-- CE QU'ELLE NE PRÉTEND PAS FAIRE
--
--   PostgreSQL et Storage ne partagent aucune transaction. Aucune fonction
--   ici ne peut donc « supprimer l'objet et la ligne atomiquement ». Le
--   modèle retenu assume cette absence et choisit, à chaque étape, l'ordre
--   qui ne peut jamais détruire la seule image valide :
--
--     remplacement : téléverser la NOUVELLE → committer en base → supprimer
--                    l'ancienne. Un échec après la première étape laisse un
--                    fichier orphelin (inerte) ; jamais une recette sans
--                    photo alors que le coach en avait une.
--     retrait      : committer NULL en base → supprimer l'objet. Un échec
--                    laisse un orphelin, jamais une référence cassée.
--     suppression  : supprimer la recette (autorité) → supprimer l'objet.
--
--   C'est pourquoi `set_nutrition_recipe_image` et `delete_nutrition_recipe`
--   RENDENT le chemin devenu inutile : le nettoyage est une conséquence
--   explicite, déclenchée après le commit, jamais un effet de bord espéré.
--
-- MIGRATIONS ANTÉRIEURES : aucune n'est modifiée. Les deux fonctions
-- redéfinies ici le sont par `create or replace`, comme 20260817090000 l'a
-- fait pour le blocage de suppression.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. LA COLONNE, ET LA FORME DU CHEMIN
-- ════════════════════════════════════════════════════════════════════════════
-- `image_path` est une référence, pas une adresse : l'URL publique se dérive
-- en une concaténation côté application, et le jour où le bucket change de
-- nom, aucune ligne n'est à réécrire.
--
-- LA CONTRAINTE EST LE CŒUR DE LA SÉCURITÉ DE CETTE COLONNE. Elle compare le
-- chemin aux DEUX identifiants de la ligne elle-même. Conséquence : même un
-- `update` direct sur la table — sans passer par la RPC, depuis n'importe
-- quel client — ne peut pas faire pointer une recette vers le dossier d'un
-- autre coach ou d'une autre recette. La règle ne dépend ni d'un trigger, ni
-- d'une fonction, ni d'un écran.
--
-- Le nom de fichier est un UUID : ni nom d'origine, ni horodatage, ni rien
-- qui vienne du poste du coach. Cela ferme d'un seul coup la traversée de
-- répertoire (`..`), les caractères de contrôle, et la fuite de métadonnées
-- par le nom du fichier.

alter table public.nutrition_recipes
  add column if not exists image_path text;

alter table public.nutrition_recipes
  drop constraint if exists nutrition_recipes_image_path_shape;

alter table public.nutrition_recipes
  add constraint nutrition_recipes_image_path_shape check (
    image_path is null
    or image_path ~ (
      '^recipes/' || coach_id::text || '/' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    )
  );

comment on column public.nutrition_recipes.image_path is
  'Chemin de l''unique photo principale dans le bucket Storage « recipe-images », ou NULL. JAMAIS une URL : l''adresse publique se dérive côté application. Forme imposée par la contrainte nutrition_recipes_image_path_shape : recipes/<coach_id>/<recipe_id>/<uuid>.webp|jpg, où coach_id et recipe_id sont ceux de CETTE ligne — un update direct ne peut donc pas viser le dossier d''un autre coach.';


-- ════════════════════════════════════════════════════════════════════════════
-- B. LE BUCKET — LES LIMITES SONT POSÉES ICI, PAS DANS LE NAVIGATEUR
-- ════════════════════════════════════════════════════════════════════════════
-- LECTURE PUBLIQUE, ASSUMÉE. Une photo de plat est produite par le coach pour
-- illustrer une recette de son catalogue. Elle ne contient aucune donnée
-- d'élève : ni identifiant, ni mesure, ni plan, ni nom. Le chemin lui-même ne
-- porte que deux UUID techniques (coach, recette) — jamais un `student_id`.
-- La rendre privée imposerait une URL signée par image, avec expiration à
-- gérer, un aller-retour supplémentaire à chaque affichage et une
-- incompatibilité avec le cache de `next/image` — pour protéger une
-- information qui n'est pas confidentielle. C'est le même arbitrage que le
-- bucket « banners » (01_post_baseline_storage.sql), et il reste NETTEMENT
-- séparé de « documents » et « progress-photos », qui restent privés parce
-- qu'ils portent, eux, des données d'élève.
--
-- LES DEUX PLAFONDS SONT LA VRAIE VALIDATION. Le navigateur redimensionne et
-- ré-encode avant d'envoyer, mais un client forgé peut évidemment sauter
-- cette étape : `file_size_limit` et `allowed_mime_types` sont donc posés sur
-- le bucket, où Storage les applique quel que soit l'appelant.
--
--   1 048 576 octets — une photo optimisée à 1400 px de côté long pèse 150 à
--   350 Ko en WebP. Le mégaoctet laisse une marge confortable tout en
--   refusant, d'emblée, la photo de téléphone brute de 5 à 15 Mo.
--
--   image/webp et image/jpeg — et RIEN d'autre. image/svg+xml est exclu
--   explicitement : un SVG est un document XML qui peut porter du script, et
--   servi depuis un bucket public il s'exécuterait dans l'origine du domaine
--   de Storage. Aucun besoin d'illustration ne justifie ce risque. Le JPEG
--   n'est là que comme repli documenté pour les navigateurs sans
--   `canvas.toBlob('image/webp')` ; les deux formats sont matriciels et
--   n'exécutent rien.
--
-- `on conflict do update` plutôt que `do nothing` : si le bucket a été créé à
-- la main au tableau de bord, sans plafond, cette migration les POSE. Une
-- migration qui se tairait devant un bucket préexistant laisserait la
-- protection au hasard de l'historique.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
-- C. LE PRÉDICAT D'APPARTENANCE — ÉCRIT UNE FOIS, UTILISÉ QUATRE FOIS
-- ════════════════════════════════════════════════════════════════════════════
-- Les quatre policies ci-dessous partagent exactement la même question :
-- « ce chemin désigne-t-il une recette que l'appelant a le droit de gérer ? »
-- L'écrire quatre fois garantirait qu'un jour trois versions coexistent.
--
-- CE QUE LA FONCTION VÉRIFIE, DANS L'ORDRE
--   1. la FORME : trois segments de dossier, le premier valant « recipes ».
--      Un chemin plus court ou plus long est refusé avant toute lecture ;
--   2. l'EXISTENCE de la recette nommée au troisième segment ;
--   3. que le coach nommé au deuxième segment est BIEN le propriétaire de
--      cette recette. C'est le point que réclamait le cahier des charges :
--      on ne se contente pas de comparer la chaîne du dossier au coach
--      appelant, on demande à la base si la recette lui appartient
--      réellement. Un coach ne peut donc pas déposer un fichier sous
--      « recipes/<son id>/<recette d'un autre>/… » ;
--   4. que l'appelant est cet même coach, ou un administrateur — la règle
--      déjà en vigueur sur `nutrition_recipes` (20260813090000), reprise
--      telle quelle plutôt que réinventée.
--
-- `security invoker` : la sous-requête est elle-même soumise à la RLS de
-- `nutrition_recipes`. La fonction ne peut donc rien révéler que l'appelant
-- ne puisse déjà lire — elle ne fabrique aucun privilège.
--
-- Comparaisons en TEXTE et non en uuid : un segment qui n'est pas un uuid
-- (« ../../etc ») ferait échouer un cast avec une erreur, là où une
-- comparaison textuelle répond simplement « faux ».

create or replace function public.nutrition_recipe_image_owner_ok(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p_name is not null
     and array_length(storage.foldername(p_name), 1) = 3
     and (storage.foldername(p_name))[1] = 'recipes'
     and exists (
       select 1
         from public.nutrition_recipes r
        where r.id::text = (storage.foldername(p_name))[3]
          and r.coach_id::text = (storage.foldername(p_name))[2]
          and (public.is_admin() or r.coach_id = public.current_coach_id())
     );
$fn$;

alter function public.nutrition_recipe_image_owner_ok(text) owner to postgres;

comment on function public.nutrition_recipe_image_owner_ok(text) is
  'Vrai si le chemin Storage « recipes/<coach>/<recette>/<fichier> » désigne une recette RÉELLEMENT possédée par le coach nommé dans le chemin, et que l''appelant est ce coach ou un administrateur. Vérifie la forme, l''existence et l''appartenance par jointure — jamais une simple égalité de chaînes. security invoker : la RLS de nutrition_recipes s''applique à la sous-requête.';

revoke all on function public.nutrition_recipe_image_owner_ok(text) from public;
revoke execute on function public.nutrition_recipe_image_owner_ok(text) from anon;
grant execute on function public.nutrition_recipe_image_owner_ok(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- D. LES POLICIES STORAGE — QUATRE COMMANDES, QUATRE PRÉDICATS STRICTS
-- ════════════════════════════════════════════════════════════════════════════
-- `to authenticated` sur les quatre : `anon` ne peut jamais entrer dans ces
-- policies, quelle que soit l'évolution des grants par défaut.
--
-- INSERT porte un `with check` — la seule clause qu'une insertion consulte.
-- UPDATE porte `using` ET `with check` : sans le second, un coach pourrait
-- RENOMMER un objet qu'il possède vers le dossier d'un autre. Sans le
-- premier, il pourrait écraser l'objet d'autrui. Les deux sont nécessaires,
-- et c'est exactement ce que demandait le cahier des charges.
-- DELETE porte `using`.
--
-- SELECT n'est PAS un confort : sans lui, l'API Storage authentifiée ne
-- « voit » pas l'objet, et `remove()` rend `error: null` sans rien supprimer
-- (leçon écrite dans 01_post_baseline_storage.sql à propos de « banners » —
-- et défaut encore présent sur « program-covers », qui n'a toujours pas de
-- policy SELECT). `copy()` en a besoin aussi : la copie lit la source sous
-- RLS avant d'écrire la destination.
--
-- AUCUNE POLICY POUR L'ÉLÈVE, DÉLIBÉRÉMENT. La lecture publique passe par
-- `/object/public/…`, qui ne consulte pas la RLS. Un élève authentifié ne
-- peut donc ni lister le bucket, ni y écrire, ni y supprimer : il n'existe
-- aucune policy sous laquelle il puisse tomber.

drop policy if exists "recipe_images_select_owner_coach" on storage.objects;
create policy "recipe_images_select_owner_coach" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.nutrition_recipe_image_owner_ok(name)
  );

drop policy if exists "recipe_images_insert_owner_coach" on storage.objects;
create policy "recipe_images_insert_owner_coach" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recipe-images'
    and public.nutrition_recipe_image_owner_ok(name)
  );

drop policy if exists "recipe_images_update_owner_coach" on storage.objects;
create policy "recipe_images_update_owner_coach" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.nutrition_recipe_image_owner_ok(name)
  )
  with check (
    bucket_id = 'recipe-images'
    and public.nutrition_recipe_image_owner_ok(name)
  );

drop policy if exists "recipe_images_delete_owner_coach" on storage.objects;
create policy "recipe_images_delete_owner_coach" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.nutrition_recipe_image_owner_ok(name)
  );


-- ════════════════════════════════════════════════════════════════════════════
-- E. POSER OU RETIRER LA PHOTO — UNE SEULE PORTE
-- ════════════════════════════════════════════════════════════════════════════
-- Le navigateur ne peut pas écrire `image_path` directement : la policy
-- `nutrition_recipes_manage_own_coach` l'autoriserait sur SA recette, mais la
-- contrainte de forme (§A) refuserait tout chemin étranger. Cette RPC existe
-- pour une autre raison : RENDRE L'ANCIEN CHEMIN.
--
-- Sans elle, le navigateur devrait relire la recette avant d'écrire pour
-- savoir quel fichier nettoyer — deux allers-retours, et une fenêtre pendant
-- laquelle un autre onglet peut avoir changé la photo. Ici, le verrou
-- `for update`, la lecture de l'ancien chemin et l'écriture du nouveau vivent
-- dans LA MÊME transaction : le chemin rendu est exactement celui qui vient
-- d'être remplacé, jamais un autre.
--
-- `p_image_path` est REVALIDÉ ici en plus de la contrainte de table. Non par
-- superstition : la contrainte rend une erreur PostgreSQL brute (23514), que
-- l'interface ne saurait traduire. La RPC répond `{ ok:false,
-- reason:'invalid_path' }`, un refus lisible — et la contrainte reste le
-- dernier mot pour tout chemin d'écriture qui ne passerait pas par ici.

create or replace function public.set_nutrition_recipe_image(
  p_recipe_id uuid,
  p_image_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_recipe record;
  v_attendu text;
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

  -- ── 2. La recette, LUE SOUS RLS et VERROUILLÉE ────────────────────────
  -- La recette d'un autre coach est introuvable, pas « interdite » :
  -- l'appelant n'apprend pas qu'elle existe.
  select r.id, r.coach_id, r.image_path
    into v_recipe
    from public.nutrition_recipes r
   where r.id = p_recipe_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 3. Propriété, opposée explicitement ───────────────────────────────
  if not public.is_admin()
     and v_recipe.coach_id is distinct from public.current_coach_id() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── 4. Le chemin, reconstruit puis comparé ────────────────────────────
  -- Le préfixe n'est pas « vérifié » : il est RECONSTRUIT à partir de la
  -- ligne lue, puis comparé. Un chemin qui ne s'y conforme pas est refusé
  -- sans que la fonction ait à énumérer les façons de tricher.
  if p_image_path is not null then
    v_attendu := 'recipes/' || v_recipe.coach_id::text || '/' || v_recipe.id::text || '/';
    if left(p_image_path, length(v_attendu)) is distinct from v_attendu
       or substring(p_image_path from length(v_attendu) + 1)
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$' then
      return jsonb_build_object(
        'ok', false,
        'reason', 'invalid_path',
        'recipe_id', p_recipe_id
      );
    end if;
  end if;

  -- ── 5. L'écriture, et l'ancien chemin rendu ───────────────────────────
  -- `image_path` est la SEULE colonne touchée : poser une photo ne peut ni
  -- publier une recette, ni modifier un ingrédient, ni changer un statut.
  update public.nutrition_recipes r
     set image_path = p_image_path
   where r.id = p_recipe_id;

  return jsonb_build_object(
    'ok', true,
    'recipe_id', p_recipe_id,
    'image_path', p_image_path,
    -- Le fichier devenu inutile. NULL si la recette n'en avait pas, et NULL
    -- aussi lorsque le chemin est inchangé : rien à nettoyer dans ce cas.
    'previous_path',
      case when v_recipe.image_path is distinct from p_image_path
           then v_recipe.image_path else null end
  );
end;
$fn$;

alter function public.set_nutrition_recipe_image(uuid, text) owner to postgres;

comment on function public.set_nutrition_recipe_image(uuid, text) is
  'Pose (ou retire, avec NULL) l''unique photo d''une recette, et REND le chemin devenu inutile pour que l''appelant supprime l''objet APRÈS le commit — PostgreSQL et Storage ne partageant aucune transaction. Le préfixe attendu est reconstruit depuis la ligne verrouillée puis comparé : aucun chemin étranger n''est acceptable, et la contrainte nutrition_recipes_image_path_shape reste le dernier mot. Ne touche QUE la colonne image_path. Retour { ok, image_path, previous_path } ou { ok:false, reason: forbidden|not_found|invalid_path }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.set_nutrition_recipe_image(uuid, text) from public;
revoke execute on function public.set_nutrition_recipe_image(uuid, text) from anon;
grant execute on function public.set_nutrition_recipe_image(uuid, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- F. DUPLIQUER — LA COPIE NAÎT SANS PHOTO, ET REÇOIT LA SIENNE
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI LA COPIE NE PARTAGE PAS LE FICHIER. Réutiliser le même
-- `image_path` pour deux recettes créerait un couplage invisible : retirer la
-- photo de la copie supprimerait l'objet, et l'original afficherait une image
-- cassée. La règle demandée est donc tenue au niveau du modèle, pas de
-- l'usage — et la contrainte de forme (§A) l'impose de toute façon, puisque
-- le chemin contient l'identifiant de la recette : la copie NE PEUT PAS
-- porter le chemin de l'original.
--
-- La fonction rend `source_image_path` : l'appelant copie ensuite l'objet
-- vers le dossier de la copie (`storage.copy()`, qui lit la source sous la
-- policy SELECT du §D et écrit sous la policy INSERT), puis appelle
-- `set_nutrition_recipe_image`. Si cette suite échoue, la copie existe sans
-- photo — un défaut visible et réparable en un clic, jamais une image
-- partagée entre deux recettes.
--
-- SEULE MODIFICATION par rapport à 20260818090000 : `image_path` est ajoutée
-- à la lecture de la source et au retour. L'insertion l'omet volontairement,
-- donc la copie naît à NULL. Tout le reste est inchangé, à la ligne près.

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
  select r.id, r.coach_id, r.name, r.description, r.slot_key, r.image_path
    into v_source
    from public.nutrition_recipes r
   where r.id = p_recipe_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── 3. Propriété, opposée explicitement ───────────────────────────────
  if not public.is_admin()
     and v_source.coach_id is distinct from public.current_coach_id() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── 4. La copie ───────────────────────────────────────────────────────
  -- `image_path` est ABSENTE de la liste des colonnes : la copie naît sans
  -- photo, et ne peut structurellement pas porter le chemin de l'original.
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
    -- La photo de la SOURCE, pour que l'appelant en fasse une copie
    -- INDÉPENDANTE dans le dossier de la nouvelle recette. La copie, elle,
    -- vient de naître sans photo.
    'source_image_path', v_source.image_path,
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
  'Duplique une recette et TOUS ses enfants en UNE transaction : ingrédients (positions conservées, liaisons traduites par position), étiquettes. Ne reçoit QUE l''identifiant de la source — le propriétaire est LU sur elle, jamais fourni par l''appelant, et la copie naît toujours en ''draft'' avec source_key nulle. La copie naît SANS photo : le chemin de la source est rendu (source_image_path) pour que l''appelant en fasse une copie indépendante, aucun fichier n''étant jamais partagé entre deux recettes. La recette d''un autre coach est introuvable (RLS), et la propriété est revérifiée explicitement. Retour structuré { ok, recipe_id, source_image_path, copied } ou { ok:false, reason: forbidden|not_found }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.duplicate_nutrition_recipe(uuid) from public;
revoke execute on function public.duplicate_nutrition_recipe(uuid) from anon;
grant execute on function public.duplicate_nutrition_recipe(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- G. SUPPRIMER — LA LIGNE D'ABORD, LE FICHIER ENSUITE
-- ════════════════════════════════════════════════════════════════════════════
-- L'ORDRE N'EST PAS ARBITRAIRE. La base est l'autorité : tant que la ligne
-- existe, la photo doit exister aussi. Supprimer le fichier en premier
-- ouvrirait une fenêtre pendant laquelle une recette bien vivante afficherait
-- une image cassée — et un échec de la suppression en base rendrait cette
-- fenêtre définitive. Dans l'ordre retenu, le pire cas est un objet orphelin :
-- invisible, sans effet, et supprimable plus tard.
--
-- SEULE MODIFICATION par rapport à 20260815090000 : `image_path` est lue avec
-- la recette et rendue dans la réponse. Les règles de blocage, le
-- verrouillage, la neutralisation des liaisons et les compteurs sont
-- identiques, à la ligne près.
--
-- ARCHIVER NE SUPPRIME RIEN. Aucune autre fonction ne touche à `image_path` :
-- l'archivage, la publication et la dépublication ne passent que par
-- `save_nutrition_recipe`, qui n'écrit jamais cette colonne. Une recette
-- archivée conserve donc sa photo, et la retrouve intacte à la restauration.

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

  select r.id, r.name, r.status, r.coach_id, r.image_path
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
    -- L'objet Storage à retirer APRÈS le commit. NULL si la recette n'avait
    -- pas de photo.
    'image_path', v_recipe.image_path,
    'deleted', jsonb_build_object('ingredients', v_ingredients, 'tags', v_tags)
  );
end;
$fn$;

alter function public.delete_nutrition_recipe(uuid) owner to postgres;

comment on function public.delete_nutrition_recipe(uuid) is
  'Suppression DÉFINITIVE d''une recette, en UNE transaction : verrouillage, recalcul du motif de blocage (nutrition_recipe_deletion_block), neutralisation des liaisons entre ingrédients, puis suppression explicite des étiquettes et des ingrédients. Refusée tant qu''un élève peut atteindre la recette par un plan assigné, et pour la recette d''un autre coach. Rend image_path : l''objet Storage est retiré par l''appelant APRÈS le commit, la base restant l''autorité. Retour structuré { ok, reason, image_path, dependencies }. security invoker, search_path vide, EXECUTE réservé à authenticated.';

revoke all on function public.delete_nutrition_recipe(uuid) from public;
revoke execute on function public.delete_nutrition_recipe(uuid) from anon;
grant execute on function public.delete_nutrition_recipe(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- H. CONTRÔLE FINAL — LA MIGRATION SE RELIT ELLE-MÊME
-- ════════════════════════════════════════════════════════════════════════════
-- Une migration qui pose des règles de sécurité doit échouer bruyamment si
-- l'une d'elles manque, plutôt que de laisser croire qu'elle est en place.

do $$
declare
  v_manquant text := '';
  v_bucket record;
begin
  -- La colonne et sa contrainte
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipes'
       and column_name = 'image_path'
  ) then
    v_manquant := v_manquant || ' colonne image_path;';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipes'::regclass
       and conname = 'nutrition_recipes_image_path_shape'
  ) then
    v_manquant := v_manquant || ' contrainte de forme du chemin;';
  end if;

  -- Le bucket et SES PLAFONDS — un bucket sans limite serait pire que pas
  -- de bucket du tout : la protection semblerait posée.
  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_bucket
    from storage.buckets b where b.id = 'recipe-images';
  if not found then
    v_manquant := v_manquant || ' bucket recipe-images;';
  else
    if v_bucket.file_size_limit is null or v_bucket.file_size_limit > 1048576 then
      v_manquant := v_manquant || ' plafond de taille du bucket;';
    end if;
    if v_bucket.allowed_mime_types is null
       or 'image/svg+xml' = any(v_bucket.allowed_mime_types)
       or not ('image/webp' = any(v_bucket.allowed_mime_types)) then
      v_manquant := v_manquant || ' liste MIME du bucket;';
    end if;
  end if;

  -- Les quatre policies, une par commande
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'recipe_images_%') <> 4 then
    v_manquant := v_manquant || ' policies storage (4 attendues);';
  end if;

  -- Les trois fonctions redéfinies ou créées
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_nutrition_recipe_image'
  ) then
    v_manquant := v_manquant || ' set_nutrition_recipe_image;';
  end if;

  if v_manquant <> '' then
    raise exception 'MIGRATION INCOMPLÈTE :%', v_manquant;
  end if;
end $$;
