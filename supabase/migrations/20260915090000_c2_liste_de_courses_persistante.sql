-- ═══════════════════════════════════════════════════════════════════════════
-- COURSES C2 — LA LISTE DE COURSES PERSISTANTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DEUX TABLES NEUVES, ET PAS UNE COLONNE EXISTANTE
-- ────────────────────────────────────────────────────────────────────────────
-- `nutrition_plans.shopping_list jsonb` existe depuis l'origine. Elle N'EST PAS
-- réutilisée ici, et ce n'est pas un oubli :
--
--   • Elle est attachée à un PLAN, pas à un couple (élève, période). Deux
--     périodes de courses sur le même plan écraseraient la même ligne.
--   • C'est du TEXTE LIBRE découpé sur des virgules (`shoppingList.split(",")`
--     dans `NutritionPlanBuilder`). Aucune identité, donc aucune agrégation
--     possible autrement que par NOM — ce que C1 interdit formellement.
--   • Aucune unité, donc aucune clé `identité + unité`.
--   • Aucun état coché, aucune ligne, aucun identifiant : c'est un tableau de
--     chaînes.
--   • C'est une note du COACH vers l'élève. C2 est une liste que l'ÉLÈVE coche.
--
-- Elle est laissée STRICTEMENT INTACTE par cette migration : ni lue, ni écrite,
-- ni supprimée. Sa dépréciation éventuelle est un autre chantier.
--
-- ⚠️ `food_lists` / `food_list_items` NE SONT PAS NON PLUS DES LISTES DE
-- COURSES. Ce sont les listes d'aliments AUTORISÉS du coach (N1), rattachées à
-- `coach_id`, sources des `meal_choice_slots`. Le mot « liste » est déjà pris
-- dans ce domaine avec un sens inverse — d'où les noms anglais `shopping_*`,
-- qui ne peuvent se confondre avec aucun d'eux à la lecture d'un `\dt`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LES DEUX ORIGINES D'UNE LIGNE, ET POURQUOI ELLES NE SE MÉLANGENT JAMAIS
-- ────────────────────────────────────────────────────────────────────────────
-- `source = 'plan'`   — issue de l'agrégation C1. Elle a une IDENTITÉ (aliment
--                       du catalogue XOR produit) et une UNITÉ. Elle est écrite
--                       et réécrite par la seule RPC de régénération. L'élève
--                       n'en modifie QUE la case cochée.
-- `source = 'manual'` — saisie par l'élève. Elle n'a AUCUNE identité : elle
--                       n'est pas cherchée dans `food_catalog`, et ne doit pas
--                       l'être. C'est un libellé, éventuellement une quantité.
--                       Elle survit à toutes les régénérations.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA LISTE — UN ÉLÈVE, UNE PÉRIODE RÉELLE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ DES DATES, PAS DES NOMS DE JOUR. `nutrition_days.day` est un nom de jour
-- anglais : il dit ce qui est prescrit « un lundi », jamais QUEL lundi. Une
-- liste de courses porte sur un intervalle réel — c'est la même règle que
-- `planned_meals.planned_on`, et la seule qui permette de rouvrir la bonne
-- liste la semaine suivante.
create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.students (id) on delete cascade,

  starts_on date not null,
  ends_on   date not null,

  created_at timestamptz not null default now(),
  -- Écrite EXPLICITEMENT par la RPC, sans trigger. `set_updated_at()` existe
  -- dans le projet, mais il se déclenche sur tout `update` — or la RPC est le
  -- SEUL écrivain de cette table (aucun privilège `update` n'est accordé à
  -- `authenticated`). Un trigger n'aurait ici rien à intercepter, et masquerait
  -- le fait que la date de dernière régénération est une donnée, pas un effet
  -- de bord.
  updated_at timestamptz not null default now(),

  constraint shopping_lists_periode_check check (ends_on >= starts_on),

  -- 1 à 7 jours — la borne de `DUREES_COURSES` côté client, redite ici parce
  -- qu'une contrainte cliente n'est pas une contrainte.
  constraint shopping_lists_duree_check check (ends_on - starts_on <= 6),

  -- « GÉNÉRER MA LISTE » CRÉE OU OUVRE (§13). C'est cette contrainte qui rend
  -- l'opération idempotente : un second appel sur la même période retombe sur
  -- la même ligne, au lieu d'empiler des listes jumelles invisibles.
  constraint shopping_lists_unique unique (student_id, starts_on, ends_on),

  -- Support de la FK COMPOSITE des lignes. Même technique que
  -- `planned_meals_id_student_unique` : elle permet à l'enfant de porter son
  -- `student_id` et de le garantir ÉGAL à celui du parent, donc à sa policy
  -- d'être une comparaison de colonne au lieu d'une sous-requête.
  constraint shopping_lists_id_student_unique unique (id, student_id)
);

create index if not exists shopping_lists_student_idx
  on public.shopping_lists (student_id, starts_on desc);

comment on table public.shopping_lists is
  'COURSES C2 — la liste de courses persistante d''un élève pour une PÉRIODE RÉELLE (1 à 7 jours). Une seule liste par (élève, début, fin) : « générer » crée ou rouvre, jamais ne duplique. N''a AUCUN rapport avec nutrition_plans.shopping_list (note libre du coach, autre maille, sans identité ni unité) ni avec food_lists (listes d''aliments autorisés du coach). Écrite exclusivement par regenerer_liste_de_courses : aucun privilège insert/update/delete n''est accordé à authenticated.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LES LIGNES — DEUX ORIGINES, DEUX CONTRATS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),

  list_id    uuid not null,
  -- Redondant AVEC INTENTION : c'est lui qui rend la policy directe. La FK
  -- composite ci-dessous interdit qu'il diverge de celui de la liste.
  student_id uuid not null,

  source text not null,

  -- L'IDENTITÉ, pour les lignes PLAN uniquement. Deux FK nullables et un CHECK
  -- par comptage — la forme du projet (`food_favorites_cible_unique`,
  -- `planned_meal_items_cible_unique`), et non un couple
  -- `identity_type`/`identity_id` qui perdrait l'intégrité référentielle.
  --
  -- `on delete cascade`, comme un favori et à l'inverse d'une entrée de
  -- journal : une ligne de courses n'est pas un fait historique à préserver,
  -- c'est un pointeur vers une source vivante dont on affiche le nom. Un
  -- pointeur mort n'a aucun libellé à montrer.
  catalog_food_id uuid references public.food_catalog  (id) on delete cascade,
  product_id      uuid references public.food_products (id) on delete cascade,

  -- Le libellé, pour les lignes MANUAL uniquement.
  --
  -- ⚠️ UNE LIGNE PLAN N'EN A PAS, ET N'EN AURA PAS. Son nom vient de
  -- l'HYDRATATION de sa source au moment de l'affichage — figer un libellé ici
  -- ferait diverger la liste de courses du reste de l'application le jour où
  -- une fiche est corrigée. C'est la règle « snapshot vs hydratation » du
  -- projet, appliquée dans le sens hydratation.
  label text,

  quantity numeric,
  unit     text,

  checked boolean not null default false,

  created_at timestamptz not null default now(),

  -- LA FK COMPOSITE. `(list_id, student_id)` doit exister TEL QUEL dans
  -- `shopping_lists (id, student_id)` : une ligne ne peut donc pas prétendre
  -- appartenir à l'élève A tout en pointant la liste de l'élève B.
  constraint shopping_list_items_same_student
    foreign key (list_id, student_id)
    references public.shopping_lists (id, student_id)
    on delete cascade,

  constraint shopping_list_items_source_check
    check (source in ('plan', 'manual')),

  -- ⚠️ TROIS UNITÉS, ET AUCUNE DÉDUCTION. Les mêmes que
  -- `planned_meal_items_unit_check`. `null` est permis : un article manuel peut
  -- n'avoir aucune unité, et il est FORMELLEMENT INTERDIT de lui en inventer
  -- une à partir de son nom (§21 — pas de « jus ⇒ ml », pas de « sauce ⇒ ml »).
  constraint shopping_list_items_unit_check
    check (unit is null or unit in ('g', 'ml', 'piece')),

  constraint shopping_list_items_quantity_check
    check (quantity is null or quantity > 0),

  -- LE CONTRAT D'UNE LIGNE PLAN : exactement une cible, une quantité, une
  -- unité. Sans les trois, elle ne peut ni s'agréger ni s'afficher.
  constraint shopping_list_items_plan_check check (
    source <> 'plan' or (
      (case when catalog_food_id is null then 0 else 1 end)
      + (case when product_id is null then 0 else 1 end) = 1
      and quantity is not null
      and unit is not null
      and label is null
    )
  ),

  -- LE CONTRAT D'UNE LIGNE MANUAL : un libellé non vide, AUCUNE cible.
  --
  -- ⚠️ C'EST CETTE CONTRAINTE QUI REND §10 INFRANCHISSABLE. Un article saisi à
  -- la main ne peut pas se voir attacher un aliment du catalogue, même par une
  -- écriture directe malveillante : la base la refuse.
  constraint shopping_list_items_manual_check check (
    source <> 'manual' or (
      catalog_food_id is null
      and product_id is null
      and label is not null
      and length(btrim(label)) > 0
    )
  )
);

-- ────────────────────────────────────────────────────────────────────────────
-- UNICITÉ DES LIGNES PLAN — DEUX INDEX PARTIELS, ET C'EST LA MÊME DÉCISION
-- QU'EN A5
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ LA FORME NATURELLE NE MARCHERAIT PAS :
--
--     create unique index on shopping_list_items (list_id, catalog_food_id, product_id, unit);
--
-- En SQL, NULL n'est jamais égal à NULL : deux lignes (liste, banane, NULL, g)
-- seraient considérées comme DIFFÉRENTES, et une régénération concurrente
-- pourrait doubler chaque ligne sans qu'aucune erreur ne le signale. L'élève
-- verrait « Banane 300 g » deux fois, et rien n'expliquerait pourquoi.
--
-- Deux index PARTIELS n'ont pas ce défaut : chacun ne voit que les lignes dont
-- sa colonne est renseignée, et compare donc deux valeurs réelles.
--
-- ⚠️ `unit` FAIT PARTIE DE LA CLÉ, et ce n'est pas un détail. C'est la clé
-- d'agrégation de C1 mot pour mot (`identité + unité`). 200 g de tomates et
-- 2 pièces de tomates sont DEUX lignes, parce que les additionner exigerait une
-- conversion que personne n'a le droit de décider.
create unique index if not exists shopping_list_items_plan_food_unique
  on public.shopping_list_items (list_id, catalog_food_id, unit)
  where source = 'plan' and catalog_food_id is not null;

create unique index if not exists shopping_list_items_plan_product_unique
  on public.shopping_list_items (list_id, product_id, unit)
  where source = 'plan' and product_id is not null;

-- L'unique requête de l'écran : « les lignes de cette liste ».
create index if not exists shopping_list_items_list_idx
  on public.shopping_list_items (list_id, source, created_at);

comment on table public.shopping_list_items is
  'COURSES C2 — une ligne de liste de courses. source=''plan'' : issue de l''agrégation C1, porte une IDENTITÉ (aliment XOR produit) et une UNITÉ, son libellé vient de l''hydratation et n''est PAS stocké, seule sa case cochée est modifiable par l''élève. source=''manual'' : saisie libre, porte un libellé et AUCUNE identité — elle n''est jamais cherchée dans food_catalog — et survit à toutes les régénérations. L''unicité (liste, identité, unité) est portée par deux index partiels : un index unique ordinaire laisserait passer les doublons, NULL n''étant jamais égal à NULL.';

comment on column public.shopping_list_items.unit is
  'g, ml ou piece — les mêmes que planned_meal_items, ou null pour un article manuel sans unité. AUCUNE unité n''est jamais déduite d''un nom : ni « jus ⇒ ml », ni « sauce ⇒ ml », ni aucune autre heuristique. Deux unités différentes pour la même identité font DEUX lignes.';

comment on column public.shopping_list_items.label is
  'Le libellé d''un article MANUEL, et de lui seul. Une ligne PLAN a label null : son nom est hydraté depuis food_catalog / food_products à l''affichage, pour qu''une fiche corrigée corrige aussi la liste de courses.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA RÉGÉNÉRATION — TRANSACTIONNELLE, ET IDEMPOTENTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE RPC ICI, ALORS QUE COCHER N'EN A PAS
-- ────────────────────────────────────────────────────────────────────────────
-- Le critère du projet est constant : RPC quand le serveur ARBITRE ou quand
-- l'ATOMICITÉ multi-lignes est en jeu, écriture directe sinon (c'est ce que
-- `lib/supabase/food-favorites.ts` documente en toutes lettres).
--
-- Régénérer, c'est trois verbes en une transaction : supprimer ce qui a
-- disparu, mettre à jour ce qui reste, insérer ce qui est nouveau. PostgREST ne
-- sait pas les enchaîner sans risque : un échec entre le `delete` et l'`insert`
-- laisserait une liste amputée, et l'élève ferait ses courses avec un trou.
--
-- Cocher, à l'inverse, c'est une colonne sur une ligne. Une RPC y serait « une
-- surface à maintenir sans contrepartie ». Elle passe donc en écriture directe,
-- verrouillée par un GRANT DE COLONNE — voir la section 6.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE FONCTION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ ELLE N'AGRÈGE RIEN. L'agrégation est faite par `agregerListeDeCourses`
-- (C1), et il n'en existe qu'une. La réécrire ici en SQL créerait un SECOND
-- MOTEUR : deux implémentations d'une même règle finissent toujours par
-- diverger, et la divergence serait invisible. Elle reçoit le résultat déjà
-- agrégé, et le VÉRIFIE.
--
-- ⚠️ ELLE NE CONVERTIT AUCUNE UNITÉ. Ni g↔kg, ni ml↔L, ni pièce↔g.
--
-- ⚠️ ELLE NE TOUCHE JAMAIS UNE LIGNE MANUELLE. Aucune de ses trois écritures
-- n'a de portée hors de `source = 'plan'`.
create or replace function public.regenerer_liste_de_courses(
  p_starts_on date,
  p_ends_on   date,
  p_lignes    jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_list    uuid;
  v_ligne   jsonb;
  v_food    uuid;
  v_product uuid;
  v_unit    text;
  v_quantity numeric;
  v_vues    text[] := '{}';
  v_cle     text;
  v_touchees integer;
  v_total    integer := 0;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  if p_starts_on is null or p_ends_on is null then
    raise exception 'PERIODE_MANQUANTE' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'PERIODE_INVALIDE' using errcode = '22023';
  end if;
  if p_ends_on - p_starts_on > 6 then
    raise exception 'PERIODE_TROP_LONGUE' using errcode = '22023';
  end if;

  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'LIGNES_INVALIDES' using errcode = '22023';
  end if;

  -- ────────────────────────────────────────────────────────────────────────
  -- VALIDATION LIGNE À LIGNE, AVANT LA MOINDRE ÉCRITURE
  -- ────────────────────────────────────────────────────────────────────────
  -- Tout est vérifié d'abord, et la transaction n'écrit qu'ensuite : un refus
  -- au dixième article ne doit pas laisser les neuf premiers en base.
  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_food     := nullif(v_ligne ->> 'catalog_food_id', '')::uuid;
    v_product  := nullif(v_ligne ->> 'product_id', '')::uuid;
    v_unit     := v_ligne ->> 'unit';
    v_quantity := nullif(v_ligne ->> 'quantity', '')::numeric;

    -- EXACTEMENT une cible. Zéro (une ligne fantôme) et deux (une ligne
    -- ambiguë) sont refusées par le même test.
    if (case when v_food is null then 0 else 1 end)
     + (case when v_product is null then 0 else 1 end) <> 1 then
      raise exception 'IDENTITE_INVALIDE' using errcode = '22023';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
    end if;

    if v_unit is null or v_unit not in ('g', 'ml', 'piece') then
      raise exception 'UNITE_INVALIDE' using errcode = '22023';
    end if;

    -- ⚠️ DOUBLON DANS LA CHARGE UTILE. Deux lignes de même identité ET même
    -- unité sont un défaut d'agrégation en amont, pas une donnée à absorber :
    -- les laisser passer ferait échouer l'`insert` sur l'index unique avec un
    -- « 23505 » illisible, ou pire, ferait gagner la dernière en silence.
    v_cle := coalesce(v_food::text, '') || '|' || coalesce(v_product::text, '') || '|' || v_unit;
    if v_cle = any (v_vues) then
      raise exception 'LIGNE_EN_DOUBLE' using errcode = '22023';
    end if;
    v_vues := array_append(v_vues, v_cle);

    -- ⚠️ LE VERROU DE §4 : L'ALIMENT DOIT AVOIR ÉTÉ RÉELLEMENT PLANIFIÉ.
    --
    -- `security definer` ignore la RLS par construction. Sans ce contrôle, un
    -- appel forgé ferait entrer dans la liste un aliment que le coach n'a
    -- jamais autorisé — exactement ce que C1 rend impossible côté client.
    --
    -- On vérifie l'APPARTENANCE (identité + unité présentes dans les repas
    -- planifiés de CET élève sur CETTE période), jamais la quantité : recalculer
    -- la somme ici serait le second moteur qu'on refuse.
    if not exists (
      select 1
        from public.planned_meal_items i
        join public.planned_meals m on m.id = i.planned_meal_id
       where m.student_id = v_student
         and m.planned_on between p_starts_on and p_ends_on
         and i.unit = v_unit
         and (
           (v_food    is not null and i.catalog_food_id = v_food)
        or (v_product is not null and i.product_id      = v_product)
         )
    ) then
      raise exception 'LIGNE_HORS_PLANIFICATION' using errcode = '42501';
    end if;
  end loop;

  -- ────────────────────────────────────────────────────────────────────────
  -- CRÉER OU ROUVRIR (§13)
  -- ────────────────────────────────────────────────────────────────────────
  -- `on conflict` sur `(student_id, starts_on, ends_on)` : deux appels
  -- concurrents ne peuvent pas fabriquer deux listes jumelles — c'est la
  -- contrainte qui arbitre, pas un `select` suivi d'un `insert` qui aurait une
  -- fenêtre entre les deux.
  -- ⚠️ `do update set updated_at = shopping_lists.updated_at` — UNE ÉCRITURE
  -- QUI N'ÉCRIT RIEN, et c'est exactement ce qu'on veut. `do nothing` ne rend
  -- aucune ligne, donc aucun `id` ; et poser `now()` ici ferait mentir la
  -- colonne : ROUVRIR une liste n'est pas la MODIFIER. `updated_at` n'est
  -- avancée qu'à la fin, et seulement si le contenu a réellement bougé.
  insert into public.shopping_lists (student_id, starts_on, ends_on)
  values (v_student, p_starts_on, p_ends_on)
  on conflict (student_id, starts_on, ends_on)
    do update set updated_at = public.shopping_lists.updated_at
  returning id into v_list;

  -- ────────────────────────────────────────────────────────────────────────
  -- 1/3 — CE QUI A DISPARU DU PLAN S'EN VA
  -- ────────────────────────────────────────────────────────────────────────
  -- ⚠️ `is not distinct from`, JAMAIS `=`. Une ligne « produit » a
  -- `catalog_food_id is null` des deux côtés : avec `=`, la comparaison rendrait
  -- NULL, le `not exists` serait donc vrai, et TOUTES les lignes produit
  -- seraient supprimées puis réinsérées — en perdant leur case cochée à chaque
  -- régénération. C'est le piège le plus coûteux de cette migration.
  delete from public.shopping_list_items i
   where i.list_id = v_list
     and i.source = 'plan'
     and not exists (
       select 1
         from jsonb_to_recordset(p_lignes)
              as l(catalog_food_id uuid, product_id uuid, quantity numeric, unit text)
        where l.unit = i.unit
          and l.catalog_food_id is not distinct from i.catalog_food_id
          and l.product_id      is not distinct from i.product_id
     );
  get diagnostics v_touchees = row_count;
  v_total := v_total + v_touchees;

  -- ────────────────────────────────────────────────────────────────────────
  -- 2/3 — CE QUI RESTE VOIT SA QUANTITÉ CORRIGÉE, ET GARDE SA CASE
  -- ────────────────────────────────────────────────────────────────────────
  -- ⚠️ `checked` N'APPARAÎT PAS DANS LE `set`. C'est tout le contrat de §5 :
  -- l'élève qui a déjà coché « Poulet » pendant ses courses ne doit pas voir la
  -- case se rouvrir parce qu'un repas a été recomposé ailleurs.
  --
  -- ⚠️ `is distinct from` DANS LE `where` : une quantité inchangée n'écrit rien.
  -- C'est ce qui rend un second appel identique VRAIMENT idempotent — zéro
  -- ligne touchée, et non « le même résultat après réécriture ».
  update public.shopping_list_items i
     set quantity = l.quantity
    from jsonb_to_recordset(p_lignes)
         as l(catalog_food_id uuid, product_id uuid, quantity numeric, unit text)
   where i.list_id = v_list
     and i.source = 'plan'
     and l.unit = i.unit
     and l.catalog_food_id is not distinct from i.catalog_food_id
     and l.product_id      is not distinct from i.product_id
     and i.quantity is distinct from l.quantity;
  get diagnostics v_touchees = row_count;
  v_total := v_total + v_touchees;

  -- ────────────────────────────────────────────────────────────────────────
  -- 3/3 — CE QUI EST NOUVEAU ARRIVE NON COCHÉ
  -- ────────────────────────────────────────────────────────────────────────
  insert into public.shopping_list_items
    (list_id, student_id, source, catalog_food_id, product_id, quantity, unit, checked)
  select v_list, v_student, 'plan', l.catalog_food_id, l.product_id, l.quantity, l.unit, false
    from jsonb_to_recordset(p_lignes)
         as l(catalog_food_id uuid, product_id uuid, quantity numeric, unit text)
   where not exists (
     select 1
       from public.shopping_list_items i
      where i.list_id = v_list
        and i.source = 'plan'
        and i.unit = l.unit
        and i.catalog_food_id is not distinct from l.catalog_food_id
        and i.product_id      is not distinct from l.product_id
   );
  get diagnostics v_touchees = row_count;
  v_total := v_total + v_touchees;

  -- ────────────────────────────────────────────────────────────────────────
  -- `updated_at` NE MENT PAS
  -- ────────────────────────────────────────────────────────────────────────
  -- Elle n'avance QUE si une ligne a bougé. Une régénération à l'identique —
  -- le cas le plus fréquent, puisque l'élève rouvre son écran — ne touche
  -- rien, et la colonne doit le dire. Une date de « dernière modification »
  -- qui avance sans modification est une information fausse : elle ferait
  -- croire à un changement, et rendrait impossible de savoir quand la liste a
  -- réellement changé pour la dernière fois.
  if v_total > 0 then
    update public.shopping_lists set updated_at = now() where id = v_list;
  end if;

  return v_list;
end;
$fn$;

comment on function public.regenerer_liste_de_courses(date, date, jsonb) is
  'COURSES C2 — crée ou rouvre la liste de courses de l''élève pour une période réelle, puis la réconcilie avec l''agrégation C1 reçue : les lignes PLAN disparues sont supprimées, celles qui restent voient leur quantité corrigée EN GARDANT leur case cochée, les nouvelles arrivent non cochées. Les lignes MANUAL ne sont jamais touchées. N''agrège rien et ne convertit aucune unité : elle VÉRIFIE que chaque couple (identité, unité) a réellement été planifié sur la période, et refuse sinon avec LIGNE_HORS_PLANIFICATION. Idempotente : un second appel identique n''écrit aucune ligne.';

revoke all     on function public.regenerer_liste_de_courses(date, date, jsonb) from public;
revoke execute on function public.regenerer_liste_de_courses(date, date, jsonb) from anon;
grant  execute on function public.regenerer_liste_de_courses(date, date, jsonb) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. MODIFIER UN ARTICLE MANUEL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pourquoi une RPC pour ça, alors qu'un `update` direct suffirait ? Parce que
-- le privilège d'`update` accordé à `authenticated` est volontairement réduit à
-- LA SEULE COLONNE `checked` (section 6). C'est ce grant qui rend §12
-- infranchissable — un privilège ne se contourne pas, là où une policy ne sait
-- pas parler de colonnes.
--
-- La contrepartie est ce petit passage obligé pour l'édition d'un article
-- manuel. Il coûte quinze lignes, et il vaut mieux que la solution inverse :
-- ouvrir `update (label, quantity, unit)` à tout le monde, puis compter sur un
-- trigger pour l'interdire aux lignes PLAN.
create or replace function public.modifier_article_manuel(
  p_item_id  uuid,
  p_label    text,
  p_quantity numeric,
  p_unit     text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_label   text;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  v_label := btrim(coalesce(p_label, ''));
  if v_label = '' then
    raise exception 'LIBELLE_MANQUANT' using errcode = '22023';
  end if;

  if p_quantity is not null and p_quantity <= 0 then
    raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
  end if;

  -- ⚠️ AUCUNE UNITÉ N'EST DÉDUITE DU LIBELLÉ (§21). Si l'élève n'en donne pas,
  -- la ligne n'en a pas. « Jus d'orange » ne devient pas des millilitres.
  if p_unit is not null and p_unit not in ('g', 'ml', 'piece') then
    raise exception 'UNITE_INVALIDE' using errcode = '22023';
  end if;

  update public.shopping_list_items
     set label    = v_label,
         quantity = p_quantity,
         unit     = p_unit
   where id = p_item_id
     and student_id = v_student
     and source = 'manual';

  -- Une ligne PLAN, ou la ligne d'un autre élève, tombe ici — et le refus est
  -- le même dans les deux cas, pour ne pas révéler laquelle des deux c'était.
  if not found then
    raise exception 'ARTICLE_MANUEL_INTROUVABLE' using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.modifier_article_manuel(uuid, text, numeric, text) is
  'COURSES C2 — modifie le libellé, la quantité et l''unité d''un article MANUEL de l''élève connecté. Refuse une ligne PLAN comme la ligne d''un autre élève, avec le même message. N''invente jamais d''unité à partir du libellé.';

revoke all     on function public.modifier_article_manuel(uuid, text, numeric, text) from public;
revoke execute on function public.modifier_article_manuel(uuid, text, numeric, text) from anon;
grant  execute on function public.modifier_article_manuel(uuid, text, numeric, text) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS — L'ÉLÈVE, ET PERSONNE D'AUTRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ AUCUNE POLICY COACH, ET C'EST DÉLIBÉRÉ — exactement le raisonnement de
-- `food_favorites`. Une liste de courses est une affaire personnelle : elle dit
-- ce qu'un élève va acheter, pas ce qu'il a mangé. Ce que le coach doit suivre,
-- `consumed_meals` le lui donne déjà. Une policy de lecture s'ajoute en une
-- ligne le jour où elle sera voulue ; retirer une exposition déjà en production
-- est une correction, pas un ajout.
--
-- ⚠️ `public.current_student_id()` ET RIEN D'AUTRE. C'est le helper unique du
-- projet (`food_favorites`, `planned_meals`, `consumed_meals`, policies
-- storage). Aucune seconde logique d'identité n'est introduite ici.
alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;

drop policy if exists "shopping_lists_select_own_student" on public.shopping_lists;
create policy "shopping_lists_select_own_student" on public.shopping_lists
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "shopping_lists_manage_admin" on public.shopping_lists;
create policy "shopping_lists_manage_admin" on public.shopping_lists
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "shopping_list_items_select_own_student" on public.shopping_list_items;
create policy "shopping_list_items_select_own_student" on public.shopping_list_items
  for select to authenticated
  using (student_id = public.current_student_id());

-- ⚠️ `source = 'manual'` DANS LE `with check` : un élève ne peut PAS insérer
-- une ligne PLAN par écriture directe, même sur sa propre liste. Les lignes
-- PLAN n'ont qu'une provenance possible, la RPC de régénération.
drop policy if exists "shopping_list_items_insert_manual_own_student" on public.shopping_list_items;
create policy "shopping_list_items_insert_manual_own_student" on public.shopping_list_items
  for insert to authenticated
  with check (student_id = public.current_student_id() and source = 'manual');

-- L'`update` porte sur les DEUX origines — cocher une ligne PLAN est le geste
-- central de l'écran. C'est le GRANT DE COLONNE de la section 6 qui limite ce
-- geste à `checked`, pas cette policy : une policy ne sait pas parler de
-- colonnes.
drop policy if exists "shopping_list_items_update_own_student" on public.shopping_list_items;
create policy "shopping_list_items_update_own_student" on public.shopping_list_items
  for update to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

-- ⚠️ SEULE UNE LIGNE MANUELLE SE SUPPRIME (§11). Une ligne PLAN ne disparaît
-- que parce que le plan a changé — c'est la régénération qui l'enlève, jamais
-- un geste de l'élève. Sinon la liste mentirait sur ce qu'il faut acheter.
drop policy if exists "shopping_list_items_delete_manual_own_student" on public.shopping_list_items;
create policy "shopping_list_items_delete_manual_own_student" on public.shopping_list_items
  for delete to authenticated
  using (student_id = public.current_student_id() and source = 'manual');

drop policy if exists "shopping_list_items_manage_admin" on public.shopping_list_items;
create policy "shopping_list_items_manage_admin" on public.shopping_list_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PRIVILÈGES — LE GRANT DE COLONNE EST LA VRAIE SERRURE DE §12
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une policy dit quelles LIGNES sont visibles ; elle ne sait pas dire quelles
-- COLONNES sont écrivables. C'est le privilège qui le dit — et PostgreSQL sait
-- le faire à la colonne près.
--
-- `grant update (checked)` : un élève peut cocher et décocher, et RIEN d'autre.
-- Un `update ... set quantity = 1` sur une ligne PLAN échoue sur un
-- « permission denied for column », avant même que la policy soit évaluée. Ce
-- n'est pas une règle applicative qu'on pourrait oublier de rappeler dans un
-- écran : c'est une porte fermée.
--
-- ⚠️ L'ORDRE COMPTE : `revoke all` PRÉCÈDE les grants, sinon un privilège
-- hérité des réglages par défaut (dont TRUNCATE, qui contourne la RLS)
-- survivrait.
revoke all on table public.shopping_lists      from public, anon, authenticated;
revoke all on table public.shopping_list_items from public, anon, authenticated;

-- La liste elle-même est en LECTURE SEULE pour l'élève : sa création et sa date
-- de régénération sont l'affaire de la RPC.
grant select on table public.shopping_lists to authenticated;

grant select, insert, delete on table public.shopping_list_items to authenticated;
grant update (checked)       on table public.shopping_list_items to authenticated;

grant all on table public.shopping_lists      to service_role;
grant all on table public.shopping_list_items to service_role;
