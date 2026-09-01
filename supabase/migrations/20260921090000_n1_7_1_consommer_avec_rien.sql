-- ============================================================================
-- Migration 20260921090000 — N1.7.1 : CONSOMMER UN REPAS DONT UNE LISTE EST
-- À « RIEN ».
-- (chantier feat/listes-ignorables — correctif de N1.7)
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE DÉFAUT, MESURÉ SUR LA PREVIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Un élève écarte « Sucrants » d'un petit-déjeuner, les quantités des trois
-- autres aliments se calculent correctement, « Valider mes choix » fonctionne
-- — et « ENREGISTRER LE REPAS » échoue avec CHOIX_INCOMPLET.
--
-- La cause n'était pas dans cette fonction mais dans son APPELANT : le client
-- retirait l'occurrence écartée de `p_items` avant l'appel, en croyant qu'une
-- absence n'avait rien à faire dans une déclaration de consommation. Or
-- `enregistrer_repas_structure_consomme` DÉLÈGUE à `enregistrer_repas_planifie`
-- en lui passant `p_items` tel quel — c'est écrit dans son propre commentaire :
-- « ON NE RECOPIE PAS UN SEUL DE SES CONTRÔLES ». Et celle-ci exige toutes les
-- occurrences du repas, exactement une fois chacune.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI LE CORRECTIF CLIENT NE SUFFISAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ RENVOYER L'OCCURRENCE SANS TOUCHER À CETTE FONCTION AURAIT SEULEMENT
-- CHANGÉ LE MOTIF DE L'ERREUR. Après la délégation, cette fonction reboucle
-- ELLE-MÊME sur `p_items` pour créer les `meal_entries` d'A5. Un item écarté
-- n'a ni `catalog_food_id` ni `product_id` : il tombait dans la branche
-- « produit », `where p.id = null` ne trouvait rien, et la fonction levait
-- PRODUIT_INACCESSIBLE. D'où cette migration.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION FAIT, ET RIEN D'AUTRE
-- ────────────────────────────────────────────────────────────────────────────
-- Un seul `continue`, en tête de la boucle des entrées. Le corps est celui de
-- 20260914090000 mot pour mot ; aucune autre ligne ne change.
--
--   - AUCUNE TABLE créée, altérée ou supprimée ;
--   - AUCUNE COLONNE, AUCUNE CONTRAINTE, AUCUNE POLICY touchée ;
--   - AUCUNE SIGNATURE modifiée — `(uuid, date, jsonb)`, comme avant ;
--   - `enregistrer_repas_planifie` N'EST PAS redonnée : elle sait déjà traiter
--     `"ignore": true` depuis N1.7, et la redonner ici risquerait d'écraser sa
--     version par une copie périmée ;
--   - AUCUN BACKFILL : les repas déjà consommés ne contiennent aucune
--     occurrence écartée, la table étant vide à ce jour.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. `enregistrer_repas_structure_consomme` — SAUTER LES OCCURRENCES ÉCARTÉES
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enregistrer_repas_structure_consomme(p_meal_id uuid, p_consumed_on date, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student uuid;
  v_planned uuid;
  v_consumed uuid;
  v_deja boolean;
  v_item jsonb;
  v_food uuid;
  v_product uuid;
  v_quantity numeric;
  v_unit text;
  v_base numeric;
  v_src record;
  v_creees integer := 0;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  -- ── 1. TOUTE LA VALIDATION, PAR LA FONCTION QUI LA PORTE DÉJÀ ──────────
  -- ⚠️ ON NE RECOPIE PAS UN SEUL DE SES CONTRÔLES. `enregistrer_repas_planifie`
  -- vérifie l'appartenance du repas au plan assigné de CET élève, exclut les
  -- plans « prochain », exige un choix par occurrence sans doublon ni intrus,
  -- exige que TOUTES les occurrences soient couvertes, exige que chaque aliment
  -- appartienne au SNAPSHOT de son occurrence, exige une identité unique, et
  -- exige une unité convertible. Elle lève ses propres motifs — CHOIX_INCOMPLET,
  -- CHOIX_HORS_LISTE, OCCURRENCE_HORS_REPAS… — et ils remontent tels quels.
  --
  -- ⚠️ ET ELLE POSE LE VERROU. Son `on conflict (student_id, planned_on,
  -- meal_id) do update` prend un verrou de ligne tenu jusqu'au commit : deux
  -- clics concurrents se sérialisent ICI, avant même de regarder le lien de
  -- consommation.
  -- ── C0.1 — L'IDEMPOTENCE SE DÉCIDE AVANT DE DÉLÉGUER ────────────────────
  -- ⚠️ CET ORDRE A CHANGÉ, ET IL LE FALLAIT. N1.6B appelait d'abord
  -- `enregistrer_repas_planifie`, PUIS constatait que le repas était déjà
  -- enregistré. Depuis que cette RPC refuse d'écrire un repas consommé, ce
  -- premier appel lèverait `REPAS_DEJA_CONSOMME` au second enregistrement —
  -- et casserait l'idempotence promise par N1.6B.
  --
  -- ⚠️ ET CE N'EST PAS QU'UNE ADAPTATION AU VERROU : l'ancien ordre avait un
  -- défaut. Un second appel portant des items DIFFÉRENTS réécrivait
  -- `planned_meal_items` avant de répondre « déjà enregistré » — le planifié
  -- divergeait du consommé, en silence, par le chemin NORMAL. Décider d'abord
  -- supprime ce cas.
  --
  -- ⚠️ `for update` SUR LA LIGNE EXISTANTE, quand elle existe. La décision est
  -- prise sous verrou ; si aucune ligne n'existe encore, il n'y a rien à
  -- verrouiller et c'est l'unicité (élève, date, repas) qui sérialise.
  select pm.id, pm.consumed_meal_id into v_planned, v_consumed
    from public.planned_meals pm
   where pm.student_id = v_student
     and pm.planned_on = p_consumed_on
     and pm.meal_id = p_meal_id
   for update;

  v_deja := v_consumed is not null;

  if v_deja then
    -- ⚠️ IDEMPOTENT, ET SILENCIEUX. Second clic, double clic, rejeu réseau :
    -- on rend le conteneur existant et on n'insère RIEN.
    return jsonb_build_object(
      'planned_meal_id', v_planned,
      'consumed_meal_id', v_consumed,
      'deja_enregistre', true,
      'entrees_creees', 0
    );
  end if;

  -- Pas encore consommé : la composition prévue est (ré)écrite normalement,
  -- et c'est elle qui valide identités, unités et appartenance au snapshot.
  v_planned := public.enregistrer_repas_planifie(p_meal_id, p_consumed_on, p_items);

  -- ── 3. LE CONTENEUR A5, PAR LA FONCTION QUI LE SAIT DÉJÀ ───────────────
  -- ⚠️ `ouvrir_repas_prescrit` NE CRÉE QUE SI RIEN N'EXISTE. Si l'élève a
  -- déjà noté un café dans ce repas, elle rend SON conteneur, et le café
  -- reste. Elle fige aussi la cible du créneau, exactement comme lors d'un
  -- ajout manuel : aucune règle nutritionnelle n'est dupliquée ici.
  v_consumed := public.ouvrir_repas_prescrit(p_meal_id, p_consumed_on);

  -- ── 4. LES ENTRÉES, DANS LES TABLES D'A5 ───────────────────────────────
  -- ⚠️ MÊME FORMULE QUE `ajouter_aliment_catalogue`, AU CARACTÈRE PRÈS :
  -- `quantite_en_base_nutritionnelle` puis `round(base × pour100 / 100, 4)`.
  -- Ce n'est pas un second modèle de calcul, c'est le même appliqué ici parce
  -- que l'exception « aliment archivé » du § A ne peut pas passer par la RPC
  -- manuelle — qui doit, elle, continuer de refuser.
  --
  -- ⚠️ L'IDENTITÉ EST PRÉSERVÉE. Un aliment du catalogue reste
  -- `source_type = 'catalog_food'` avec son `food_id` ; un produit reste
  -- `'product'` avec son `product_id`. Jamais de conversion en `'free'` pour
  -- simplifier : l'élève doit pouvoir corriger, dupliquer et retrouver son
  -- aliment comme n'importe quel autre.
  for v_item in select * from jsonb_array_elements(p_items) loop
    -- ════════════════════════════════════════════════════════════════════
    -- N1.7.1 — UNE OCCURRENCE ÉCARTÉE NE SE MANGE PAS
    -- ════════════════════════════════════════════════════════════════════
    -- ⚠️ ELLE EST DANS `p_items`, ET ELLE DOIT Y ÊTRE. `enregistrer_repas_planifie`,
    -- appelée juste au-dessus, exige TOUTES les occurrences du repas : la
    -- retirer côté client faisait lever CHOIX_INCOMPLET — le défaut constaté
    -- sur la Preview. Elle est donc citée, et c'est ICI qu'on la saute.
    --
    -- ⚠️ SANS CE `continue`, L'ERREUR CHANGE MAIS NE DISPARAÎT PAS. Un item
    -- écarté n'a ni `catalog_food_id` ni `product_id` : il tomberait dans la
    -- branche « produit » ci-dessous, `p.id = null` ne trouverait rien, et la
    -- fonction lèverait PRODUIT_INACCESSIBLE.
    --
    -- ⚠️ ET `v_creees` N'EST PAS INCRÉMENTÉ. Le compte rendu à l'écran est
    -- celui des entrées RÉELLEMENT créées ; y faire figurer une absence
    -- annoncerait un aliment que l'élève ne trouverait nulle part.
    if coalesce((v_item ->> 'ignore')::boolean, false) then
      continue;
    end if;

    v_food     := nullif(v_item ->> 'catalog_food_id', '')::uuid;
    v_product  := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit     := v_item ->> 'unit';

    if v_food is not null then
      select f.name, f.nutrition_unit, f.piece_weight_g,
             f.protein_per_100, f.carb_per_100, f.fat_per_100
        into v_src
        from public.food_catalog f
       where f.id = v_food and f.owner_coach_id is null;
      if not found then
        raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
      end if;

      v_base := public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_src.nutrition_unit, v_src.piece_weight_g);

      insert into public.meal_entries (
        student_id, consumed_meal_id, source_type, food_id,
        label, quantity, unit, protein_g, carb_g, fat_g
      ) values (
        v_student, v_consumed, 'catalog_food', v_food,
        v_src.name, v_quantity, v_unit,
        round(v_base * v_src.protein_per_100 / 100, 4),
        round(v_base * v_src.carb_per_100 / 100, 4),
        round(v_base * v_src.fat_per_100 / 100, 4)
      );
    else
      select coalesce(nullif(btrim(coalesce(p.brand, '') || ' — ' || coalesce(p.product_name, '')), '— '),
                      p.product_name) as name,
             p.nutrition_unit,
             case when p.net_unit = 'g' and p.nutrition_unit = 'g' then p.net_quantity else null end as piece_weight_g,
             p.protein_per_100, p.carb_per_100, p.fat_per_100
        into v_src
        from public.food_products p
       where p.id = v_product;
      if not found then
        raise exception 'PRODUIT_INACCESSIBLE' using errcode = '42501';
      end if;

      v_base := public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_src.nutrition_unit, v_src.piece_weight_g);

      insert into public.meal_entries (
        student_id, consumed_meal_id, source_type, product_id,
        label, quantity, unit, protein_g, carb_g, fat_g
      ) values (
        v_student, v_consumed, 'product', v_product,
        v_src.name, v_quantity, v_unit,
        round(v_base * v_src.protein_per_100 / 100, 4),
        round(v_base * v_src.carb_per_100 / 100, 4),
        round(v_base * v_src.fat_per_100 / 100, 4)
      );
    end if;

    v_creees := v_creees + 1;
  end loop;

  -- ── 5. LE LIEN, POSÉ EN DERNIER ────────────────────────────────────────
  -- ⚠️ APRÈS LES ENTRÉES, ET DANS LA MÊME TRANSACTION. Le poser avant ferait
  -- qu'un échec au 4ᵉ aliment laisserait un repas marqué « enregistré » sans
  -- l'être. Ici, une erreur sur n'importe quel item annule TOUT : les entrées,
  -- le lien, et jusqu'au `planned_meal` lui-même.
  update public.planned_meals
     set consumed_meal_id = v_consumed,
         updated_at = now()
   where id = v_planned;

  return jsonb_build_object(
    'planned_meal_id', v_planned,
    'consumed_meal_id', v_consumed,
    'deja_enregistre', false,
    'entrees_creees', v_creees
  );
end;
$function$
;
