-- ============================================================================
-- Migration 20260912090000 — N1.6B : ENREGISTRER LE REPAS STRUCTURÉ.
-- (chantier feat/nutrition-structured-meals)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Depuis N1.5.3, l'élève voit ses quantités — toujours, même hors cible. Il
-- lui restait à les recopier À LA MAIN, une par une, dans « Ce que j'ai
-- mangé ». Cinq aliments, cinq recherches, cinq saisies de grammes, et autant
-- d'occasions de se tromper sur un nombre que l'écran affichait déjà.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CE LOT N'INVENTE PAS, ET C'EST L'ESSENTIEL
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ LA VALIDATION EXISTE DÉJÀ, ENTIÈREMENT. `enregistrer_repas_planifie`,
-- livrée en N1.1 et JAMAIS BRANCHÉE (0 ligne en production, 0 appelant
-- TypeScript), fait déjà : appartenance du repas à un plan assigné, exclusion
-- des plans « prochain », un choix par occurrence, aucune occurrence en double,
-- aucune occurrence étrangère, TOUTES les occurrences couvertes, option
-- appartenant au SNAPSHOT de son occurrence, identité unique catalogue OU
-- produit, unité convertible — le tout en transaction, et idempotent par
-- `on conflict (student_id, planned_on, meal_id)`.
--
-- La nouvelle RPC l'APPELLE. Elle ne recopie pas une ligne de ces contrôles :
-- deux validations parallèles divergeraient au premier ajout de règle.
--
-- ⚠️ ET LE MODÈLE DE CONSOMMATION EST CELUI D'A5, PAS UN SECOND. Mêmes tables
-- (`consumed_meals`, `meal_entries`), même helper de conversion d'unité
-- (`quantite_en_base_nutritionnelle`), même formule de macros
-- (`round(base × pour100 / 100, 4)`), même conteneur ouvert par
-- `ouvrir_repas_prescrit`. Le bouton est un RACCOURCI de saisie, pas un
-- deuxième journal alimentaire.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE CLIENT N'ENVOIE JAMAIS UNE MACRO
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ INVARIANT A5, CONSERVÉ MOT POUR MOT. Le client envoie l'IDENTITÉ, la
-- QUANTITÉ ENTIÈRE AFFICHÉE et l'UNITÉ. Le serveur recharge la source et
-- calcule. Si l'écran dit « Poulet 163 g », la base enregistre 163 — jamais
-- 162,6, jamais 164 : la quantité n'est pas recalculée, elle est TRANSMISE.
--
-- Les macros, elles, sont recalculées côté serveur avec la même formule que le
-- solveur (`pour100 × q / 100`), arrondie à 4 décimales. Écart maximal cumulé
-- sur cinq aliments : 2,5 × 10⁻⁴ g — quatre ordres de grandeur sous le gramme
-- affiché.
--
-- ────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCE : UNE COLONNE QUI ATTENDAIT DEPUIS N1.1
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `planned_meals.consumed_meal_id` EXISTE DEPUIS N1.1 ET N'A JAMAIS ÉTÉ
-- REMPLIE. C'est le crochet laissé pour exactement ce lot. Premier clic : elle
-- passe de `null` au conteneur ouvert. Second clic : elle est non nulle, la
-- RPC rend le même conteneur et n'insère RIEN.
--
-- ⚠️ ET LA GARANTIE EST EN BASE, PAS DANS UN BOUTON DÉSACTIVÉ. Deux clics
-- concurrents sérialisent sur `planned_meals_unique` : le second attend le
-- premier, puis lit le lien déjà posé. Un `for update` explicite le dit dans le
-- code plutôt que de le laisser deviner.
--
-- ⚠️ ET ELLE SURVIT À LA SUPPRESSION D'UNE ENTRÉE. Effacer une ligne dans
-- « Ce que j'ai mangé » ne réarme pas le bouton : la prescription a été
-- enregistrée, c'est un fait daté. L'élève corrige sa consommation avec les
-- outils A5, comme pour n'importe quel aliment.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - ELLE NE SUPPRIME NI NE REMPLACE AUCUNE ENTRÉE EXISTANTE. Un café et un
--     dessert déjà saisis survivent : `ouvrir_repas_prescrit` ne crée que si
--     rien n'existe, et la RPC n'écrit que des `insert` ;
--   - ELLE NE SYNCHRONISE RIEN. Changer ses choix après coup ne réécrit pas la
--     consommation : prescription ≠ consommation, depuis A5 ;
--   - ELLE NE TOUCHE PAS `ajouter_aliment_catalogue`. L'ajout manuel continue
--     d'exiger un aliment ACTIF (§ ci-dessous) ;
--   - ELLE N'AJOUTE AUCUNE COLONNE, AUCUNE TABLE, AUCUNE POLICY ;
--   - ELLE NE BLOQUE JAMAIS SUR LE STATUT NUTRITIONNEL. `exact`, `approché` et
--     `impossible` s'enregistrent : l'élève décide de ce qu'il mange.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. `enregistrer_repas_planifie` — UNE SEULE LIGNE CHANGE
-- ────────────────────────────────────────────────────────────────────────────
-- Le retrait de `status = 'active'` sur le chemin structuré, et rien d'autre.
-- La justification complète est dans le corps de la fonction, à l'endroit
-- exact du changement.

CREATE OR REPLACE FUNCTION public.enregistrer_repas_planifie(p_meal_id uuid, p_planned_on date, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student uuid;
  v_meal record;
  v_cible record;
  v_cible_trouvee boolean;
  v_planned uuid;
  v_item jsonb;
  v_slots_envoyes uuid[];
  v_position integer := 0;
  v_slot uuid;
  v_food uuid;
  v_product uuid;
  v_quantity numeric;
  v_unit text;
  v_aliment record;
  v_poids_piece numeric;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  if p_planned_on is null then
    raise exception 'DATE_MANQUANTE' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_INVALIDES' using errcode = '22023';
  end if;

  -- Le repas doit appartenir à un plan RÉELLEMENT ASSIGNÉ à cet élève. C'est ce
  -- contrôle, et lui seul, qui empêche de planifier à partir du plan d'un autre.
  --
  -- ⚠️ `status <> 'prochain'` EST LA MÊME CONDITION QUE LA LECTURE. Les policies
  -- `meals_select_self_or_assigned` et `meal_choice_slots_select_assigned`
  -- excluent les plans « prochain ». Sans cette ligne, une fonction
  -- `security definer` — qui ignore la RLS par construction — permettrait de
  -- planifier un repas que l'élève ne peut même pas afficher.
  select m.id, m.slot, m.name
    into v_meal
    from public.meals m
    join public.nutrition_days d on d.id = m.nutrition_day_id
    join public.nutrition_plans p on p.id = d.plan_id
   where m.id = p_meal_id
     and p.student_id = v_student
     and p.status <> 'prochain';
  if not found then
    raise exception 'REPAS_PRESCRIT_INACCESSIBLE' using errcode = '42501';
  end if;

  -- ⚠️ LA PLANIFICATION N'EXISTE QUE POUR UN REPAS GUIDÉ. Un repas sans
  -- occurrence garde le fonctionnement libre actuel, qui passe par A5. Ouvrir
  -- la planification à un repas sans liste créerait un second chemin pour la
  -- même chose, et `choice_slot_id not null` serait alors intenable.
  if not exists (select 1 from public.meal_choice_slots s where s.meal_id = p_meal_id) then
    raise exception 'REPAS_SANS_LISTE' using errcode = '22023';
  end if;

  -- ────────────────────────────────────────────────────────────────────────
  -- TOUTES LES OCCURRENCES, EXACTEMENT UNE FOIS CHACUNE
  -- ────────────────────────────────────────────────────────────────────────
  -- Comparaison d'ENSEMBLES, jamais de nombres : une occurrence omise et une
  -- autre citée deux fois donnent le même total, et un compteur ne verrait
  -- rien. L'ordre des quatre refus va du plus précis au plus général, pour que
  -- le motif rendu soit celui qui aide.
  v_slots_envoyes := array(
    select nullif(x ->> 'slot_id', '')::uuid from jsonb_array_elements(p_items) x);

  if array_position(v_slots_envoyes, null) is not null then
    raise exception 'OCCURRENCE_MANQUANTE' using errcode = '22023';
  end if;

  -- ⚠️ `coalesce(..., 0)` N'EST PAS DÉCORATIF. `array_length` d'un tableau VIDE
  -- rend NULL, pas 0 ; sans le coalesce, `NULL is distinct from 0` est vrai et
  -- un envoi vide serait refusé pour « occurrence en double ». Le motif serait
  -- faux, et le test qui vérifie le motif l'a montré.
  if coalesce(array_length(v_slots_envoyes, 1), 0) is distinct from
     (select count(distinct u)::int from unnest(v_slots_envoyes) u) then
    raise exception 'OCCURRENCE_EN_DOUBLE' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_slots_envoyes) u
     where u not in (select s.id from public.meal_choice_slots s where s.meal_id = p_meal_id)
  ) then
    raise exception 'OCCURRENCE_HORS_REPAS' using errcode = '42501';
  end if;

  -- Un tableau vide passe les trois contrôles précédents sans rien prouver :
  -- c'est celui-ci qui le refuse, parce qu'il reste des occurrences non
  -- couvertes.
  if exists (
    select 1 from public.meal_choice_slots s
     where s.meal_id = p_meal_id
       and s.id <> all (coalesce(v_slots_envoyes, array[]::uuid[]))
  ) then
    raise exception 'CHOIX_INCOMPLET' using errcode = '22023';
  end if;

  select * into v_cible from public.cible_creneau_du_repas(p_meal_id);
  v_cible_trouvee := found;

  insert into public.planned_meals (
    student_id, planned_on, meal_id, slot_key, label,
    target_kcal, target_protein_g, target_carb_g, target_fat_g
  ) values (
    v_student, p_planned_on, p_meal_id, v_meal.slot,
    coalesce(nullif(btrim(coalesce(v_meal.name, '')), ''), v_meal.slot),
    case when v_cible_trouvee then v_cible.target_kcal end,
    case when v_cible_trouvee then v_cible.target_protein_g end,
    case when v_cible_trouvee then v_cible.target_carb_g end,
    case when v_cible_trouvee then v_cible.target_fat_g end
  )
  on conflict (student_id, planned_on, meal_id) do update
    set updated_at = now(),
        label = excluded.label,
        slot_key = excluded.slot_key,
        target_kcal = excluded.target_kcal,
        target_protein_g = excluded.target_protein_g,
        target_carb_g = excluded.target_carb_g,
        target_fat_g = excluded.target_fat_g
  returning id into v_planned;

  -- REMPLACEMENT INTÉGRAL. Tout ce qui précède disparaît avant d'écrire.
  delete from public.planned_meal_items where planned_meal_id = v_planned;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_position := v_position + 1;

    v_slot     := nullif(v_item ->> 'slot_id', '')::uuid;
    v_food     := nullif(v_item ->> 'catalog_food_id', '')::uuid;
    v_product  := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit     := v_item ->> 'unit';

    if (case when v_food is null then 0 else 1 end)
     + (case when v_product is null then 0 else 1 end) <> 1 then
      raise exception 'IDENTITE_INVALIDE' using errcode = '22023';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
    end if;

    -- L'appartenance de l'occurrence au repas a déjà été établie plus haut, sur
    -- l'ENSEMBLE des occurrences envoyées : la revérifier ici serait du code
    -- inatteignable.

    -- L'aliment doit appartenir au SNAPSHOT de cette occurrence.
    if not exists (
      select 1 from public.meal_choice_options o
       where o.slot_id = v_slot
         and o.catalog_food_id is not distinct from v_food
         and o.product_id is not distinct from v_product
    ) then
      raise exception 'CHOIX_HORS_LISTE' using errcode = '42501';
    end if;

    -- L'unité doit être convertible POUR CET ALIMENT — sinon la quantité
    -- planifiée ne pourrait jamais devenir une consommation. On réutilise le
    -- helper d'A2 : il lève lui-même PIECE_SANS_POIDS ou UNITE_INCOMPATIBLE.
    if v_food is not null then
      -- ⚠️ N1.6B — `status = 'active'` A ÉTÉ RETIRÉ ICI, ET SEULEMENT ICI.
      -- Un aliment ARCHIVÉ après la construction du plan reste affiché à
      -- l'élève (le lecteur de semaine ne filtre pas le statut, délibérément :
      -- « un aliment archivé après coup doit garder son nom à l'écran »), il
      -- reste calculé par le solveur — et il échouait donc à l'enregistrement,
      -- avec ALIMENT_INACCESSIBLE, sur un repas parfaitement affiché. Le plan
      -- constitue un SNAPSHOT HISTORIQUE VALIDE : l'aliment était actif quand
      -- le coach l'a prescrit.
      --
      -- ⚠️ L'EXCEPTION N'APPARTIENT QU'À CE CHEMIN, et il est étroit : repas
      -- assigné à l'élève + occurrence de ce repas + option appartenant au
      -- SNAPSHOT de l'occurrence. `ajouter_aliment_catalogue` — l'ajout manuel
      -- A5, où l'élève choisit librement dans le catalogue — continue d'exiger
      -- `status = 'active'` et n'est PAS touchée par ce lot.
      --
      -- ⚠️ `owner_coach_id is null` RESTE, LUI. Ce n'est pas du cycle de vie
      -- mais de la visibilité : un aliment privé de coach n'est lisible par
      -- aucun élève (policy `food_catalog_select_global`), et cette fonction
      -- étant `security definer`, retirer la garde ouvrirait un accès que la
      -- RLS refuse.
      select f.nutrition_unit, f.piece_weight_g into v_aliment
        from public.food_catalog f
       where f.id = v_food and f.owner_coach_id is null;
      if not found then
        raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
      end if;
      perform public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_aliment.nutrition_unit, v_aliment.piece_weight_g);
    else
      select p.nutrition_unit,
             case when p.net_unit = 'g' and p.nutrition_unit = 'g'
                  then p.net_quantity else null end as piece_weight_g
        into v_aliment
        from public.food_products p
       where p.id = v_product;
      if not found then
        raise exception 'PRODUIT_INACCESSIBLE' using errcode = '42501';
      end if;
      perform public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_aliment.nutrition_unit, v_aliment.piece_weight_g);
    end if;

    insert into public.planned_meal_items (
      planned_meal_id, student_id, choice_slot_id, position,
      catalog_food_id, product_id, quantity, unit
    ) values (
      v_planned, v_student, v_slot, v_position,
      v_food, v_product, v_quantity, v_unit
    );
  end loop;

  return v_planned;
end;
$function$


;

-- ────────────────────────────────────────────────────────────────────────────
-- B. LA RPC DE PONT — planification VALIDÉE → consommation A5
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.enregistrer_repas_structure_consomme(
  p_meal_id uuid,
  p_consumed_on date,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_planned := public.enregistrer_repas_planifie(p_meal_id, p_consumed_on, p_items);

  -- ── 2. LE LIEN DE CONSOMMATION EST-IL DÉJÀ POSÉ ? ──────────────────────
  -- ⚠️ `for update` PLUTÔT QUE DE SE FIER AU VERROU HÉRITÉ. Il l'est déjà de
  -- fait ; l'écrire rend la garantie lisible et la protège d'une réécriture
  -- future de la fonction appelée.
  select pm.consumed_meal_id into v_consumed
    from public.planned_meals pm
   where pm.id = v_planned
   for update;

  v_deja := v_consumed is not null;

  if v_deja then
    -- ⚠️ IDEMPOTENT, ET SILENCIEUX. Second clic, double clic, rejeu réseau :
    -- on rend le conteneur existant et on n'insère RIEN. Dupliquer cinq
    -- aliments dans le journal d'un élève serait la faute la plus coûteuse de
    -- ce lot — 55 entrées réelles existent déjà en production.
    return jsonb_build_object(
      'planned_meal_id', v_planned,
      'consumed_meal_id', v_consumed,
      'deja_enregistre', true,
      'entrees_creees', 0
    );
  end if;

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
$function$;

comment on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) is
  'N1.6B — copie la proposition structurée AFFICHÉE (identités snapshotées + quantités entières) dans « Ce que j''ai mangé ». Délègue TOUTE la validation à enregistrer_repas_planifie (repas assigné, un choix par occurrence, option du snapshot, unité convertible) plutôt que de la recopier, puis ouvre le conteneur A5 par ouvrir_repas_prescrit et insère les meal_entries avec la formule d''A5. Le client n''envoie JAMAIS de macro : le serveur recharge la source et calcule. IDEMPOTENTE par planned_meals.consumed_meal_id — second appel : 0 entrée créée, même conteneur rendu. N''efface ni ne remplace aucune entrée existante. Une erreur sur un item annule tout. security invoker non : security definer, avec la garde current_student_id() et celles héritées de la fonction appelée.';

-- ⚠️ L'ORDRE COMPTE : `revoke all` PRÉCÈDE les grants, sinon un privilège
-- hérité de `public` survivrait au revoke ciblé.
revoke all on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) from public;
revoke execute on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) from anon;
grant execute on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) to authenticated, service_role;
