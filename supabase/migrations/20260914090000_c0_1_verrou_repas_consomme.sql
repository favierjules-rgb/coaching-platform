-- ============================================================================
-- Migration 20260914090000 — C0.1 : UNE CONSOMMATION FIGE SA COMPOSITION.
-- (chantier feat/nutrition-structured-meals · Courses C0.1)
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE CORRIGE, ET COMMENT ON L'A SU
-- ────────────────────────────────────────────────────────────────────────────
-- Le banc de C0 (`supabase/tests/courses_c0_validation_checklist.sql`, contrôle
-- V-I) a MESURÉ, sur des données réelles, qu'un appel direct à
-- `enregistrer_repas_planifie` APRÈS consommation réécrivait sans résistance la
-- composition prévue :
--
--     planned_meal_items  →  999 g      (réécrit)
--     meal_entries        →  175 g      (inchangé)
--     consumed_meal_id    →  survit
--
-- Le planifié et le consommé divergeaient, en silence, et rien côté serveur ne
-- l'empêchait. C0 avait posé un garde-fou dans l'interface — mais un garde-fou
-- d'interface ne garde que l'interface.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA RÈGLE
-- ────────────────────────────────────────────────────────────────────────────
--   `planned_meals.consumed_meal_id IS NOT NULL`
--       ⟹ `enregistrer_repas_planifie` REFUSE, avec `REPAS_DEJA_CONSOMME`.
--
-- Une consommation enregistrée FIGE la composition planifiée correspondante.
-- Courses lira donc, pour un repas passé, ce qui a réellement été prévu — pas
-- une version réécrite après coup.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - aucune table, aucune colonne, aucune policy. Le verrou est une règle de
--     fonction, pas de schéma : la donnée qui le porte (`consumed_meal_id`)
--     existe depuis N1.1 ;
--   - elle ne touche AUCUNE autre RPC. `ouvrir_repas_prescrit`,
--     `ajouter_aliment_*`, `modifier_quantite_entree`, `supprimer_entree`,
--     `save_nutrition_plan_v2` sont inchangées — le contrôle `LOCK-10` le
--     vérifie sur leur définition en base ;
--   - elle ne rend PAS la validation obligatoire : « Enregistrer le repas »
--     sans validation préalable reste le parcours de N1.6B.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DEUX FONCTIONS SONT REPRODUITES, ET PAS UNE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ C'EST LE PIÈGE DE CE LOT. `enregistrer_repas_structure_consomme` appelait
-- `enregistrer_repas_planifie` EN PREMIER, puis constatait ensuite que le repas
-- était déjà enregistré pour rendre sa réponse idempotente. Poser le verrou
-- sans rien d'autre aurait donc fait lever `REPAS_DEJA_CONSOMME` au SECOND
-- enregistrement d'un même repas — c'est-à-dire cassé l'idempotence de N1.6B,
-- sur le chemin le plus banal qui soit : un double clic.
--
-- L'ordre est donc inversé dans la seconde fonction : on décide, PUIS on
-- délègue. Ce n'est pas une concession au verrou — l'ancien ordre avait un
-- défaut propre, que le verrou n'a fait que révéler : un second appel portant
-- des items DIFFÉRENTS réécrivait `planned_meal_items` avant de répondre
-- « déjà enregistré », et faisait diverger planifié et consommé par le chemin
-- NORMAL, sans appel direct ni intention hostile.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ORDRE DE ROLLOUT
-- ────────────────────────────────────────────────────────────────────────────
-- Cette migration est PUREMENT RESTRICTIVE sur un chemin que le runtime déployé
-- n'emprunte pas : aucun code en ligne n'appelle `enregistrer_repas_planifie`
-- seule aujourd'hui (C0 l'introduit, et C0 n'est pas déployé). Elle peut donc
-- s'appliquer AVANT le déploiement de C0, sans fenêtre de casse. L'inverse est
-- vrai aussi — mais déployer C0 d'abord laisserait le trou ouvert le temps du
-- déploiement, alors qu'appliquer la migration d'abord ne coûte rien.
--
--     1. appliquer CETTE migration      (base seule, aucun risque)
--     2. déployer le runtime C0         (les deux boutons)
--
-- ⚠️ ELLE EST POSTÉRIEURE AU CONTRACT (20260913090000), et c'est volontaire :
-- elle ne lit ni n'écrit `preferred_unit`, donc l'ordre EXPAND → DEPLOY →
-- CONTRACT n'est pas rouvert. Le contrôle `CONTRACT-07` a été adapté pour
-- l'exiger explicitement plutôt que de supposer que le CONTRACT reste éternel-
-- lement la dernière migration du dépôt.
-- ============================================================================

-- ============================================================================
-- §A — `enregistrer_repas_planifie` : LE VERROU.
-- ============================================================================

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
  v_existant uuid;
  v_consumed_existant uuid;
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

  -- ── C0.1 — LE VERROU : UNE CONSOMMATION FIGE SA COMPOSITION ─────────────
  -- ⚠️ ON REGARDE AVANT D'ÉCRIRE, PAS APRÈS. Le refus intervient avant
  -- l'`upsert` de `planned_meals` ET avant le `delete` des items : en cas de
  -- refus, rien n'a bougé — ni `updated_at`, ni les cibles, ni un seul item.
  --
  -- ⚠️ `for update` PARCE QUE LA DÉCISION EST UNE COURSE. Sans verrou de
  -- ligne, deux appels concurrents pourraient lire `consumed_meal_id` nul tous
  -- les deux et réécrire la composition d'un repas en cours de consommation.
  --
  -- POURQUOI CE VERROU EXISTE : sans lui, un appel direct APRÈS consommation
  -- réécrivait `planned_meal_items` pendant que `meal_entries` gardait
  -- l'ancienne composition. Mesuré : planifié 999 g, consommé 175 g, et rien
  -- pour l'empêcher. Une consommation enregistrée FIGE désormais le planifié
  -- correspondant — c'est aussi ce qui garantit à Courses qu'un repas passé ne
  -- change plus rétroactivement de composition.
  select pm.id, pm.consumed_meal_id into v_existant, v_consumed_existant
    from public.planned_meals pm
   where pm.student_id = v_student
     and pm.planned_on = p_planned_on
     and pm.meal_id = p_meal_id
   for update;

  if v_existant is not null and v_consumed_existant is not null then
    raise exception 'REPAS_DEJA_CONSOMME' using errcode = '42501';
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
$function$;


-- ============================================================================
-- §B — `enregistrer_repas_structure_consomme` : DÉCIDER, PUIS DÉLÉGUER.
-- ============================================================================

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


-- ⚠️ LES DROITS SONT REPOSÉS, PAS SUPPOSÉS. `create or replace` conserve les
-- privilèges existants, mais les réécrire rend la garantie lisible et survit à
-- une reproduction future qui les oublierait.
revoke all on function public.enregistrer_repas_planifie(uuid, date, jsonb) from public;
revoke execute on function public.enregistrer_repas_planifie(uuid, date, jsonb) from anon;
grant execute on function public.enregistrer_repas_planifie(uuid, date, jsonb) to authenticated, service_role;

revoke all on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) from public;
revoke execute on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) from anon;
grant execute on function public.enregistrer_repas_structure_consomme(uuid, date, jsonb) to authenticated, service_role;

comment on function public.enregistrer_repas_planifie(uuid, date, jsonb) is
  'N1.1 — écrit la composition PRÉVUE d''un repas structuré (planned_meals + planned_meal_items). Refuse depuis C0.1 (2026-09-14) si le repas est DÉJÀ CONSOMMÉ : REPAS_DEJA_CONSOMME. Une consommation enregistrée fige sa composition planifiée, sans quoi planifié et consommé pouvaient diverger en silence.';
