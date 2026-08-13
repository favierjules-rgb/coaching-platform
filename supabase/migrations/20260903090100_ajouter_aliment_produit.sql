-- ============================================================================
-- Migration 20260903090100 — ALIMENTS A3, PHASE 3B : CONSOMMER UN PRODUIT.
-- (chantier feat/aliments-a2-meal-tracking)
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE MÊME CONTRAT DE SÉCURITÉ QU'A2, MOT POUR MOT
-- ────────────────────────────────────────────────────────────────────────────
-- `ajouter_aliment_produit` est le jumeau d'`ajouter_aliment_catalogue`, et
-- c'est voulu : un produit industriel n'est pas un cas particulier de
-- sécurité, c'est une source de plus. Les quatre invariants sont identiques.
--
--   1. LE CLIENT N'ENVOIE AUCUNE MACRO. Il envoie un repas, un produit, une
--      quantité, une unité. Le serveur charge `food_products`, convertit et
--      fige l'instantané. Ce n'est pas une politesse : `revoke insert, update,
--      delete on meal_entries from authenticated` (A2) a retiré au navigateur
--      tout autre chemin d'écriture ;
--   2. LE CLIENT N'ENVOIE AUCUN `student_id`. Il est dérivé de
--      `current_student_id()`, comme partout ;
--   3. LE REPAS VISÉ DOIT ÊTRE CELUI DE L'APPELANT, vérifié avant toute
--      écriture ;
--   4. LE PRODUIT DOIT EXISTER EN BASE. La RPC ne va JAMAIS sur le réseau —
--      ni pour chercher un produit, ni pour le rafraîchir. Une fonction SQL
--      qui appellerait Open Food Facts rendrait l'ajout d'un aliment
--      dépendant de la disponibilité d'un tiers, et bloquerait une
--      transaction sur un timeout HTTP. Le réseau vit dans la couche serveur,
--      en amont, et n'entre jamais dans une transaction.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA PIÈCE = LE CONDITIONNEMENT, ET SEULEMENT S'IL EST DÉCLARÉ EN GRAMMES
-- ────────────────────────────────────────────────────────────────────────────
-- `quantite_en_base_nutritionnelle` (A2) n'accepte la pièce que si l'appelant
-- dit ce qu'elle pèse. Pour un produit, ce poids existe parfois : c'est la
-- quantité nette du conditionnement — « barre de 40 g ». On la passe telle
-- quelle quand elle est déclarée EN GRAMMES et que la nutrition est en
-- grammes ; sinon on passe NULL, et la pièce est refusée par le helper.
--
-- Ce n'est PAS une invention de densité : `net_quantity` est une valeur lue
-- chez la source, pas une estimation. Un produit liquide dont la nutrition est
-- « pour 100 ml » et le conditionnement « 500 ml » n'a pas de pièce en
-- grammes, et n'en aura pas — il faudrait une densité, et nous n'en inventons
-- aucune.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

create or replace function public.ajouter_aliment_produit(
  p_consumed_meal_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit text
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_produit record;
  v_poids_piece numeric;
  v_base numeric;
  v_libelle text;
  v_id uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  if not exists (select 1 from public.consumed_meals m
                  where m.id = p_consumed_meal_id and m.student_id = v_student) then
    raise exception 'REPAS_INACCESSIBLE' using errcode = '42501';
  end if;

  -- Le cache produit est GLOBAL : pas de propriétaire à vérifier, pas de
  -- statut à filtrer. Une ligne de food_products est par construction
  -- consommable — la couche serveur a refusé les produits incomplets avant de
  -- les enregistrer.
  select p.id, p.product_name, p.brand, p.nutrition_unit,
         p.net_quantity, p.net_unit,
         p.protein_per_100, p.carb_per_100, p.fat_per_100
    into v_produit
    from public.food_products p
   where p.id = p_product_id;
  if not found then
    raise exception 'PRODUIT_INACCESSIBLE' using errcode = '42501';
  end if;

  -- La pièce n'existe que si le conditionnement est déclaré dans la même
  -- unité que la nutrition, et en grammes — la seule que le helper accepte.
  v_poids_piece := case
    when v_produit.net_unit = 'g' and v_produit.nutrition_unit = 'g'
      then v_produit.net_quantity
    else null
  end;

  v_base := public.quantite_en_base_nutritionnelle(
    p_quantity, p_unit, v_produit.nutrition_unit, v_poids_piece);

  -- Le libellé est FIGÉ ici, marque comprise : c'est ce que l'élève lira dans
  -- six mois, même si le produit change de nom chez la source ou disparaît du
  -- cache. Un instantané ne suit pas sa source, son nom non plus.
  v_libelle := case
    when v_produit.brand is not null and length(btrim(v_produit.brand)) > 0
      then btrim(v_produit.brand) || ' — ' || v_produit.product_name
    else v_produit.product_name
  end;

  insert into public.meal_entries (
    student_id, consumed_meal_id, source_type, food_id, product_id,
    label, quantity, unit, protein_g, carb_g, fat_g
  ) values (
    v_student, p_consumed_meal_id, 'product', null, v_produit.id,
    v_libelle, p_quantity, p_unit,
    round(v_base * v_produit.protein_per_100 / 100, 4),
    round(v_base * v_produit.carb_per_100 / 100, 4),
    round(v_base * v_produit.fat_per_100 / 100, 4)
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

alter function public.ajouter_aliment_produit(uuid, uuid, numeric, text) owner to postgres;
comment on function public.ajouter_aliment_produit(uuid, uuid, numeric, text) is
  'Ajoute un PRODUIT INDUSTRIEL (food_products) à un repas de l''élève. Contrat identique à ajouter_aliment_catalogue : le client n''envoie ni student_id ni macro, le serveur charge la fiche, convertit la quantité et fige l''instantané. N''appelle JAMAIS le réseau — le produit doit déjà être en cache. La pièce n''est acceptée que si la quantité nette est déclarée en grammes : aucune densité n''est inventée.';
revoke all on function public.ajouter_aliment_produit(uuid, uuid, numeric, text) from public;
revoke execute on function public.ajouter_aliment_produit(uuid, uuid, numeric, text) from anon;
grant execute on function public.ajouter_aliment_produit(uuid, uuid, numeric, text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- LA CORRECTION DE QUANTITÉ DOIT CONNAÎTRE LES PRODUITS
-- ────────────────────────────────────────────────────────────────────────────
-- `modifier_quantite_entree` (A2) avait deux branches : `catalog_food`, qui
-- RECHARGE la source et recalcule ; et tout le reste, qui met l'instantané à
-- l'échelle par simple règle de trois.
--
-- Une entrée `product` tombait dans « tout le reste ». C'était correct tant
-- qu'aucune entrée `product` ne pouvait exister ; ça cesse de l'être à la
-- ligne du dessus. Le contrat A1 est explicite : une CORRECTION VOLONTAIRE
-- écrit un nouvel instantané calculé depuis la source ACTUELLE. Laisser la
-- règle de trois aurait fait d'un produit un aliment manuel déguisé : la
-- correction aurait perpétué d'anciennes teneurs au lieu de relire la fiche.
--
-- On ajoute donc la branche manquante, en la calquant sur `catalog_food`.
-- Le reste de la fonction est inchangé, à la lettre.
create or replace function public.modifier_quantite_entree(
  p_entry_id uuid,
  p_quantity numeric,
  p_unit text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_entree record;
  v_food record;
  v_produit record;
  v_poids_piece numeric;
  v_base numeric;
  v_libelle text;
begin
  v_student := public.current_student_id();
  select e.id, e.source_type, e.food_id, e.product_id,
         e.protein_g, e.carb_g, e.fat_g, e.quantity
    into v_entree
    from public.meal_entries e
   where e.id = p_entry_id and e.student_id = v_student;
  if not found then
    raise exception 'ENTREE_INACCESSIBLE' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
  end if;

  if v_entree.source_type = 'catalog_food' then
    select f.nutrition_unit, f.piece_weight_g,
           f.protein_per_100, f.carb_per_100, f.fat_per_100, f.name
      into v_food
      from public.food_catalog f
     where f.id = v_entree.food_id and f.owner_coach_id is null and f.status = 'active';
    if not found then
      -- L'aliment a disparu ou a été archivé : on ne devine pas, on refuse.
      raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
    end if;
    v_base := public.quantite_en_base_nutritionnelle(
      p_quantity, p_unit, v_food.nutrition_unit, v_food.piece_weight_g);
    update public.meal_entries
       set quantity = p_quantity, unit = p_unit, label = v_food.name,
           protein_g = round(v_base * v_food.protein_per_100 / 100, 4),
           carb_g    = round(v_base * v_food.carb_per_100 / 100, 4),
           fat_g     = round(v_base * v_food.fat_per_100 / 100, 4)
     where id = p_entry_id;

  elsif v_entree.source_type = 'product' then
    select p.product_name, p.brand, p.nutrition_unit,
           p.net_quantity, p.net_unit,
           p.protein_per_100, p.carb_per_100, p.fat_per_100
      into v_produit
      from public.food_products p
     where p.id = v_entree.product_id;
    if not found then
      -- Le produit a été purgé du cache : la source ACTUELLE n'existe plus,
      -- et il n'y a rien à recharger. On refuse plutôt que de retomber en
      -- silence sur la règle de trois — l'élève peut toujours supprimer la
      -- ligne et rescanner. L'instantané déjà posé, lui, reste intact.
      raise exception 'PRODUIT_INACCESSIBLE' using errcode = '42501';
    end if;
    v_poids_piece := case
      when v_produit.net_unit = 'g' and v_produit.nutrition_unit = 'g'
        then v_produit.net_quantity
      else null
    end;
    v_base := public.quantite_en_base_nutritionnelle(
      p_quantity, p_unit, v_produit.nutrition_unit, v_poids_piece);
    v_libelle := case
      when v_produit.brand is not null and length(btrim(v_produit.brand)) > 0
        then btrim(v_produit.brand) || ' — ' || v_produit.product_name
      else v_produit.product_name
    end;
    update public.meal_entries
       set quantity = p_quantity, unit = p_unit, label = v_libelle,
           protein_g = round(v_base * v_produit.protein_per_100 / 100, 4),
           carb_g    = round(v_base * v_produit.carb_per_100 / 100, 4),
           fat_g     = round(v_base * v_produit.fat_per_100 / 100, 4)
     where id = p_entry_id;

  else
    -- Aliment manuel : la référence pour 100 est celle de l'entrée elle-même,
    -- reconstituée depuis l'instantané précédent. Aucune source externe
    -- n'existe, et le client n'en fournit pas de nouvelle ici.
    if v_entree.quantity is null or v_entree.quantity <= 0 then
      raise exception 'ENTREE_SANS_REFERENCE' using errcode = '22023';
    end if;
    if p_unit <> (select unit from public.meal_entries where id = p_entry_id) then
      raise exception 'UNITE_INCOMPATIBLE' using errcode = '22023';
    end if;
    update public.meal_entries
       set quantity = p_quantity,
           protein_g = round(v_entree.protein_g / v_entree.quantity * p_quantity, 4),
           carb_g    = round(v_entree.carb_g    / v_entree.quantity * p_quantity, 4),
           fat_g     = round(v_entree.fat_g     / v_entree.quantity * p_quantity, 4)
     where id = p_entry_id;
  end if;
end;
$fn$;

alter function public.modifier_quantite_entree(uuid, numeric, text) owner to postgres;
comment on function public.modifier_quantite_entree(uuid, numeric, text) is
  'Corrige la quantité d''une entrée. Pour un aliment du catalogue ET pour un produit, le serveur RECHARGE la source et recalcule tout : le nouvel instantané reflète la source au moment de la correction. Pour un aliment manuel, la référence est l''instantané précédent ramené à la nouvelle quantité — aucune source externe n''existe. Une source disparue fait échouer la correction ; elle ne fait jamais deviner.';
revoke all on function public.modifier_quantite_entree(uuid, numeric, text) from public;
revoke execute on function public.modifier_quantite_entree(uuid, numeric, text) from anon;
grant execute on function public.modifier_quantite_entree(uuid, numeric, text) to authenticated, service_role;
