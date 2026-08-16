-- ═══════════════════════════════════════════════════════════════════════════
-- N1.1 — LISTES DE CHOIX, SNAPSHOT DANS UN REPAS, ET REPAS PLANIFIÉ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION N'AJOUTE PAS, ET C'EST LE POINT LE PLUS IMPORTANT
-- ────────────────────────────────────────────────────────────────────────────
-- Aucune colonne de RÔLE nutritionnel. Nulle part. Ni sur une liste, ni sur une
-- occurrence, ni sur une option, ni sur un aliment planifié.
--
-- Une liste est un RANGEMENT : un nom libre choisi par le coach — « Protéines »,
-- « Fruits », « Petit-déjeuner », « Mes aliments préférés » — et des aliments
-- réels. Le nom ne participe à aucun calcul, et rien ne permet d'en déduire quoi
-- que ce soit : l'audit a mesuré que le brocoli est protéine-dominant en
-- calories, que le saumon et l'œuf sont lipide-dominants, et qu'une liste
-- nommée « Protéines » contenant saumon et œufs serait classée « lipides » par
-- n'importe quelle déduction automatique.
--
-- Le calcul des quantités ne lit donc QUE les aliments réellement sélectionnés,
-- et leurs vraies valeurs pour 100 g. Il vit dans un module pur, hors base.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE TOUCHE PAS
-- ────────────────────────────────────────────────────────────────────────────
-- Aucune table existante n'est modifiée. `meals`, `meals.items`,
-- `meals.coach_notes`, `consumed_meals`, `meal_entries`, `food_catalog`,
-- `food_products`, `nutrition_*` : intactes, colonne pour colonne.
--
-- Un repas est GUIDÉ si et seulement s'il possède au moins un
-- `meal_choice_slots`. Il n'y a donc aucun drapeau `is_structured` à maintenir
-- en cohérence, et les repas déjà en production — qui n'en ont aucun — passent
-- par le chemin actuel au bit près. C'est ce qui rend N1 strictement additif.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PLANIFIÉ ≠ CONSOMMÉ
-- ────────────────────────────────────────────────────────────────────────────
-- `consumed_meals` signifie « réellement mangé » : y écrire une date future
-- ferait compter le jour comme suivi dans l'historique A5.7, entrerait dans la
-- moyenne hebdomadaire, et le coach le verrait comme consommé.
--
-- `planned_meals` porte donc l'intention datée, séparément. Le lien entre les
-- deux est une colonne nullable, `consumed_meal_id`, remplie SEULEMENT le jour
-- où l'élève déclare avoir mangé. Il n'y a pas de colonne `status` : l'état se
-- DÉRIVE de la présence du lien, comme `aSaisie` se dérive de l'existence d'une
-- entrée dans A5.7. Un drapeau serait une seconde vérité à maintenir.
--
-- ⚠️ NE JAMAIS exécuter en Production sans runbook validé.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- A. LA BIBLIOTHÈQUE DU COACH
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.food_lists (
  id uuid primary key default gen_random_uuid(),

  -- `restrict`, comme `nutrition_recipes.coach_id` : on ne perd pas une
  -- bibliothèque en supprimant une ligne de `coaches`.
  coach_id uuid not null references public.coaches (id) on delete restrict,

  name text not null,

  -- Archivage, jamais suppression : une liste archivée sort du sélecteur et ne
  -- casse rien, puisque les repas déjà construits ne la lisent pas (voir B).
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint food_lists_name_not_blank check (length(btrim(name)) > 0)
);

-- ⚠️ AUCUNE UNICITÉ SUR LE NOM, ET C'EST DÉLIBÉRÉ. Un coach qui duplique
-- « Protéines » pour en faire une variante travaille quelques secondes avec deux
-- listes homonymes avant de renommer la copie. Une contrainte d'unicité
-- refuserait la duplication au moment précis où elle est utile.

create index if not exists food_lists_coach_idx
  on public.food_lists (coach_id, archived_at);

comment on table public.food_lists is
  'N1 — une liste de choix enregistrée par un coach. UN NOM LIBRE ET RIEN D''AUTRE : aucun rôle nutritionnel, aucune macro, aucune quantité, aucune règle. « Protéines », « Fruits », « Petit-déjeuner », « Mes aliments préférés » sont du rangement UX. Le nom ne participe à aucun calcul. Archivage par archived_at ; aucune suppression n''est nécessaire.';


create table if not exists public.food_list_items (
  id uuid primary key default gen_random_uuid(),

  list_id uuid not null references public.food_lists (id) on delete cascade,

  position integer not null,

  -- ⚠️ EXACTEMENT UNE IDENTITÉ, ET ELLE VIENT DE LA BASE.
  --
  -- Il n'existe DÉLIBÉRÉMENT aucune colonne texte pouvant tenir lieu
  -- d'identité : « un aliment libre ne peut pas être une option structurée »
  -- est ici une propriété du schéma, pas une règle applicative qu'un futur
  -- correctif pourrait contourner.
  --
  -- `restrict` : un aliment cité dans la bibliothèque d'un coach ne disparaît
  -- pas en silence. `food_catalog.status = 'archived'` reste la voie de
  -- retrait, et elle n'est pas bloquée.
  catalog_food_id uuid references public.food_catalog (id) on delete restrict,
  product_id      uuid references public.food_products (id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint food_list_items_position_positive check (position >= 1),

  -- Écrite par COMPTAGE, comme `food_favorites_cible_unique` déjà en
  -- production : la même règle mérite la même forme.
  constraint food_list_items_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) = 1
  ),

  constraint food_list_items_position_unique unique (list_id, position)
);

-- ⚠️ INDEX PARTIELS, POUR LA RAISON HABITUELLE. En SQL, NULL n'est jamais égal
-- à NULL : un index (list_id, catalog_food_id, product_id) laisserait entrer
-- autant de doublons qu'on veut, silencieusement. Chaque index partiel ne voit
-- que les lignes dont sa colonne est renseignée, et compare donc deux valeurs
-- réelles.
create unique index if not exists food_list_items_food_unique
  on public.food_list_items (list_id, catalog_food_id)
  where catalog_food_id is not null;

create unique index if not exists food_list_items_product_unique
  on public.food_list_items (list_id, product_id)
  where product_id is not null;

comment on table public.food_list_items is
  'N1 — l''appartenance d''un aliment RÉEL à une liste du coach, et son ordre. Exactement une identité par ligne : un aliment du catalogue OU un produit. Aucune colonne texte ne peut tenir lieu d''identité, et aucune macro n''est recopiée : la liste ne porte aucune valeur nutritionnelle.';


-- ═══════════════════════════════════════════════════════════════════════════
-- B. L'OCCURRENCE DANS UN REPAS — ET LE SNAPSHOT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA GARANTIE DE SNAPSHOT NE VIENT PAS D'UN DRAPEAU « COPIÉ »
-- ────────────────────────────────────────────────────────────────────────────
-- Elle vient de l'ABSENCE DE CHEMIN DE LECTURE. `meal_choice_options` porte ses
-- PROPRES lignes, écrites au moment où le coach ajoute la liste au repas. Aucune
-- requête servant à afficher ou à calculer un repas ne joint `food_lists` ni
-- `food_list_items`. Le lecteur d'un repas fait :
--
--     meals → meal_choice_slots → meal_choice_options → food_catalog / food_products
--
-- et s'arrête là. Ajouter « Crevettes » au modèle « Protéines » le 15 août ne
-- peut donc pas atteindre le repas construit le 1er août — il n'existe aucun
-- chemin par lequel l'information pourrait voyager.
--
-- `source_list_id` sert à UNE chose : écrire « issue de la liste Protéines »
-- dans l'écran du coach. Il est `on delete set null`, donc sa disparition
-- n'enlève AUCUNE option.
--
-- ⚠️ LA SEULE RÈGLE À TENIR DANS LE CODE : aucune requête d'affichage ou de
-- calcul d'un repas ne joint `food_list_items`. Elle est testée, et le test est
-- accompagné d'un contrôle négatif — sans lui, il serait vert sur une
-- implémentation cassée.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.meal_choice_slots (
  id uuid primary key default gen_random_uuid(),

  meal_id uuid not null references public.meals (id) on delete cascade,

  position integer not null,

  -- COPIÉ du nom de la liste au moment de l'ajout, puis indépendant : renommer
  -- le modèle ne renomme pas les repas déjà construits. Même règle que les
  -- options.
  label text not null,

  -- PROVENANCE SEULE. Jamais lu pour afficher ni pour calculer un repas.
  source_list_id uuid references public.food_lists (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meal_choice_slots_position_positive check (position >= 1),
  constraint meal_choice_slots_label_not_blank check (length(btrim(label)) > 0),

  constraint meal_choice_slots_position_unique unique (meal_id, position),

  -- Cible de la clé étrangère composite de `planned_meal_items` : elle garantit
  -- qu'un aliment planifié désigne une occurrence DE CE REPAS.
  constraint meal_choice_slots_id_meal_unique unique (id, meal_id)
);

-- ⚠️ AUCUNE UNICITÉ IMPLIQUANT `source_list_id`. La même liste doit pouvoir
-- être ajoutée deux fois, trois fois, dans le même repas — c'est ce qui permet
-- à l'élève de choisir Poulet dans la première occurrence et Œufs dans la
-- seconde. Une contrainte d'unicité ici casserait le cas d'usage central.

create index if not exists meal_choice_slots_meal_idx
  on public.meal_choice_slots (meal_id, position);

comment on table public.meal_choice_slots is
  'N1 — une occurrence de liste dans un repas prescrit : « à cet endroit, l''élève choisit un aliment ». Porte son propre libellé, copié du modèle et ensuite indépendant, et sa position. AUCUN rôle, AUCUNE contrainte nutritionnelle. La même liste peut apparaître plusieurs fois dans le même repas : aucune unicité ne l''en empêche. Un repas est guidé si et seulement s''il possède au moins une occurrence.';

comment on column public.meal_choice_slots.source_list_id is
  'PROVENANCE SEULE, pour afficher « issue de la liste X » au coach. AUCUNE lecture d''un repas ne doit passer par cette colonne : le snapshot des options vit dans meal_choice_options. on delete set null — la disparition du modèle n''enlève aucune option.';


create table if not exists public.meal_choice_options (
  id uuid primary key default gen_random_uuid(),

  slot_id uuid not null references public.meal_choice_slots (id) on delete cascade,

  position integer not null,

  -- Mêmes règles d'identité que `food_list_items`. Ces lignes sont une COPIE,
  -- pas une référence : il n'existe aucune clé étrangère vers
  -- `food_list_items`, et c'est exactement ce qui fait le snapshot.
  catalog_food_id uuid references public.food_catalog (id) on delete restrict,
  product_id      uuid references public.food_products (id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint meal_choice_options_position_positive check (position >= 1),

  constraint meal_choice_options_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) = 1
  ),

  constraint meal_choice_options_position_unique unique (slot_id, position),

  -- ────────────────────────────────────────────────────────────────────────
  -- DEUX UNIQUE NON PARTIELLES, ET C'EST UNE DÉCISION TECHNIQUE PRÉCISE
  -- ────────────────────────────────────────────────────────────────────────
  -- Ailleurs dans ce dépôt, l'unicité « une cible par parent » s'écrit avec des
  -- index PARTIELS. Ici, non : ces deux contraintes servent de CIBLE aux clés
  -- étrangères composites de `planned_meal_items`, et PostgreSQL exige qu'une
  -- clé étrangère référence une contrainte unique NON partielle.
  --
  -- Le comportement reste correct : une contrainte `unique` autorise autant de
  -- lignes NULL qu'on veut (deux NULL ne sont jamais égaux). Donc
  -- `unique (slot_id, catalog_food_id)` interdit deux fois le même aliment du
  -- catalogue dans une occurrence, sans limiter le nombre de produits.
  constraint meal_choice_options_food_unique unique (slot_id, catalog_food_id),
  constraint meal_choice_options_product_unique unique (slot_id, product_id)
);

create index if not exists meal_choice_options_slot_idx
  on public.meal_choice_options (slot_id, position);

comment on table public.meal_choice_options is
  'N1 — LE SNAPSHOT : les aliments autorisés pour UNE occurrence, copiés au moment où la liste est ajoutée au repas. Aucune clé étrangère vers food_list_items : c''est cette absence, et non un drapeau, qui garantit que modifier un modèle ne modifie jamais un repas déjà construit. Aucune macro n''est recopiée — l''option pointe vers un aliment vivant, comme un favori.';


-- ═══════════════════════════════════════════════════════════════════════════
-- C. LE REPAS PLANIFIÉ DE L'ÉLÈVE
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.planned_meals (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.students (id) on delete cascade,

  planned_on date not null,

  meal_id uuid not null references public.meals (id) on delete cascade,

  -- Figés à la création, comme `consumed_meals` le fait déjà : le repas planifié
  -- reste lisible et explicable même si le coach modifie le plan ensuite.
  slot_key text not null,
  label text not null,

  -- La cible du créneau, figée elle aussi. NULLABLE : un créneau dont la part
  -- n'est pas réglée n'a PAS d'objectif — il n'en a pas zéro. C'est la règle
  -- déjà appliquée par `ouvrir_repas_prescrit`.
  target_kcal      numeric,
  target_protein_g numeric,
  target_carb_g    numeric,
  target_fat_g     numeric,

  -- ⚠️ PAS DE COLONNE `status`. L'état « planifié » contre « mangé » se DÉRIVE
  -- de la présence de ce lien. Un drapeau serait une seconde vérité, qu'il
  -- faudrait maintenir d'accord avec les faits — exactement ce qu'A5.7 évite
  -- avec `aSaisie`.
  consumed_meal_id uuid references public.consumed_meals (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planned_meals_label_not_blank check (length(btrim(label)) > 0),

  constraint planned_meals_slot_key_check check (
    slot_key in ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert')
  ),

  constraint planned_meals_targets_non_negative check (
    coalesce(target_kcal, 0) >= 0
    and coalesce(target_protein_g, 0) >= 0
    and coalesce(target_carb_g, 0) >= 0
    and coalesce(target_fat_g, 0) >= 0
  ),

  -- Un seul repas planifié par élève, par date, par repas prescrit. C'est la
  -- copie exacte de `consumed_meals_prescribed_unique`, et c'est elle qui rend
  -- l'enregistrement IDEMPOTENT : deux appuis sur le bouton ne créent pas deux
  -- repas.
  constraint planned_meals_unique unique (student_id, planned_on, meal_id),

  -- Cible de la clé étrangère composite de `planned_meal_items` : un aliment
  -- planifié ne peut pas changer d'élève.
  constraint planned_meals_id_student_unique unique (id, student_id)
);

create index if not exists planned_meals_student_date_idx
  on public.planned_meals (student_id, planned_on);

comment on table public.planned_meals is
  'N1 — un repas CHOISI par l''élève pour une date, avant de l''avoir mangé. Distinct de consumed_meals, qui signifie « réellement mangé » : écrire une date future dans consumed_meals ferait compter le jour comme suivi dans l''historique A5.7 et entrerait dans la moyenne hebdomadaire. Aucune colonne de statut : l''état se dérive de consumed_meal_id, renseigné le jour où l''élève déclare avoir mangé.';


create table if not exists public.planned_meal_items (
  id uuid primary key default gen_random_uuid(),

  planned_meal_id uuid not null,
  student_id uuid not null,

  -- ────────────────────────────────────────────────────────────────────────
  -- `not null`, ET C'EST CE QUI FERME LE TROU
  -- ────────────────────────────────────────────────────────────────────────
  -- Les deux clés étrangères composites ci-dessous sont en `match simple` — le
  -- défaut : si UNE de leurs colonnes est NULL, la vérification est SAUTÉE.
  -- Un `choice_slot_id` nullable rouvrirait donc exactement la porte que ces
  -- clés ferment : il suffirait de l'omettre pour planifier n'importe quel
  -- aliment hors des listes du coach.
  --
  -- `not null` + la contrainte « exactement une identité » garantissent qu'une
  -- des deux clés composites est TOUJOURS active, sur toutes les lignes.
  --
  -- Conséquence assumée du `cascade` : si le coach retire une occurrence du
  -- repas, les aliments que l'élève avait planifiés pour elle disparaissent —
  -- le choix n'existe plus. Le repas planifié, lui, survit.
  choice_slot_id uuid not null references public.meal_choice_slots (id) on delete cascade,

  position integer not null,

  catalog_food_id uuid references public.food_catalog (id) on delete restrict,
  product_id      uuid references public.food_products (id) on delete restrict,

  quantity numeric not null,

  -- ⚠️ `portion` EST EXCLUE, contrairement à `meal_entries`. La mesure a montré
  -- qu'aucune conversion serveur ne la traite : `quantite_en_base_nutritionnelle`
  -- lève `UNITE_INCOMPATIBLE`. L'admettre ici créerait une quantité planifiée
  -- qui ne pourrait JAMAIS devenir une consommation.
  unit text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planned_meal_items_position_positive check (position >= 1),
  constraint planned_meal_items_quantity_positive check (quantity > 0),
  constraint planned_meal_items_unit_check check (unit in ('g', 'ml', 'piece')),

  constraint planned_meal_items_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) = 1
  ),

  constraint planned_meal_items_position_unique unique (planned_meal_id, position),

  -- ────────────────────────────────────────────────────────────────────────
  -- UNE OCCURRENCE = UNE LISTE DÉROULANTE = UN SEUL ALIMENT
  -- ────────────────────────────────────────────────────────────────────────
  -- Côté élève, une occurrence est un « Choisir un aliment » : elle rend UN
  -- choix, jamais deux. Sans cette contrainte, rien n'empêcherait d'écrire deux
  -- aliments pour la même liste — et l'écran, qui n'en affiche qu'un, cacherait
  -- le second tout en le laissant peser sur les courses et sur le calcul.
  --
  -- La RPC vérifie la même chose pour rendre un message lisible ; c'est cette
  -- contrainte qui est le rempart.
  constraint planned_meal_items_un_choix_par_occurrence
    unique (planned_meal_id, choice_slot_id),

  -- Copie de `meal_entries_consumed_meal_same_student` : un aliment planifié ne
  -- peut pas changer d'élève, et la base le refuse plutôt que de faire confiance
  -- à une policy.
  constraint planned_meal_items_same_student
    foreign key (planned_meal_id, student_id)
    references public.planned_meals (id, student_id) on delete cascade,

  -- ────────────────────────────────────────────────────────────────────────
  -- L'ALIMENT CHOISI DOIT APPARTENIR AU SNAPSHOT DE SON OCCURRENCE
  -- ────────────────────────────────────────────────────────────────────────
  -- Déclaratif, sans trigger et sans RPC : la base refuse un aliment hors
  -- liste. La RPC d'écriture vérifie la même chose pour rendre un message
  -- lisible, mais elle n'est pas le dernier rempart — la contrainte l'est.
  constraint planned_meal_items_option_autorisee_food
    foreign key (choice_slot_id, catalog_food_id)
    references public.meal_choice_options (slot_id, catalog_food_id) on delete cascade,

  constraint planned_meal_items_option_autorisee_product
    foreign key (choice_slot_id, product_id)
    references public.meal_choice_options (slot_id, product_id) on delete cascade
);

create index if not exists planned_meal_items_meal_idx
  on public.planned_meal_items (planned_meal_id, position);

-- Courses lira ces lignes par aliment : « combien de poulet cette semaine ».
create index if not exists planned_meal_items_food_idx
  on public.planned_meal_items (catalog_food_id)
  where catalog_food_id is not null;

create index if not exists planned_meal_items_product_idx
  on public.planned_meal_items (product_id)
  where product_id is not null;

comment on table public.planned_meal_items is
  'N1 — un aliment choisi par l''élève et sa quantité CALCULÉE, pour un repas planifié. AUCUNE MACRO n''y est stockée : elles se dérivent de l''identité et de la quantité, et les figer ici créerait une seconde vérité nutritionnelle. C''est aussi ce qui rend la ligne inoffensive — l''élève n''écrit qu''un choix et un nombre de grammes. Deux clés étrangères composites garantissent que l''aliment appartient au snapshot de son occurrence.';

comment on column public.planned_meal_items.choice_slot_id is
  'not null, et c''est ce qui ferme le trou du `match simple` : une clé étrangère composite dont une colonne est NULL n''est pas vérifiée. Un choice_slot_id nullable permettrait donc de planifier n''importe quel aliment en l''omettant.';


-- ═══════════════════════════════════════════════════════════════════════════
-- D. LA CIBLE D'UN REPAS PRESCRIT — UN SEUL CALCUL, NOMMÉ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CE CALCUL EXISTE DÉJÀ, EN LIGNE, DANS `ouvrir_repas_prescrit`. Il est
-- extrait ici parce que la RPC de planification en a besoin exactement à
-- l'identique, et que deux copies divergeraient un jour — donnant à l'élève
-- deux cibles différentes pour le même repas selon l'écran.
--
-- `ouvrir_repas_prescrit` n'est PAS modifiée par cette migration : toucher une
-- RPC de production dépasse le périmètre de N1.1. La checklist SQL de ce lot
-- vérifie donc, sur une même donnée, que les deux chemins rendent les MÊMES
-- nombres — la duplication devient un invariant testé au lieu d'un risque muet.
--
-- Deux étages de points de base, et surtout PAS UN SEUL :
--   grammes_jour    = daily_calories × profil.<macro>_bp / 10000 ÷ kcal_par_g
--   grammes_créneau = grammes_jour   × créneau.<macro>_bp / 10000
--   kcal            = 4·P + 4·G + 9·L   (jamais une somme de points de base)
-- Aucun arrondi : le moteur n'en fait pas, il n'arrondit qu'à l'affichage.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cible_creneau_du_repas(p_meal_id uuid)
returns table (
  slot text,
  display_order integer,
  target_protein_g numeric,
  target_carb_g numeric,
  target_fat_g numeric,
  target_kcal numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    m.slot,
    t.display_order,
    pr.daily_calories * pr.protein_bp / 10000.0 / 4 * t.protein_bp / 10000.0,
    pr.daily_calories * pr.carb_bp    / 10000.0 / 4 * t.carb_bp    / 10000.0,
    pr.daily_calories * pr.fat_bp     / 10000.0 / 9 * t.fat_bp     / 10000.0,
    (pr.daily_calories * pr.protein_bp / 10000.0 / 4 * t.protein_bp / 10000.0) * 4
    + (pr.daily_calories * pr.carb_bp  / 10000.0 / 4 * t.carb_bp    / 10000.0) * 4
    + (pr.daily_calories * pr.fat_bp   / 10000.0 / 9 * t.fat_bp     / 10000.0) * 9
  from public.meals m
  join public.nutrition_days d on d.id = m.nutrition_day_id
  join public.nutrition_plan_profiles pr
    on pr.plan_id = d.plan_id and pr.profile_key = d.profile_key
  join public.nutrition_meal_slot_targets t
    on t.profile_id = pr.id and t.slot = m.slot and t.enabled
  where m.id = p_meal_id;
$fn$;

comment on function public.cible_creneau_du_repas(uuid) is
  'N1 — la cible P/G/L/kcal d''un repas prescrit, dérivée du profil du jour puis de la part du créneau. Miroir exact du calcul en ligne d''ouvrir_repas_prescrit, et de computeDailyMacroTargets + computeMealDistribution côté client. Rend zéro ligne si le créneau est désactivé ou le profil incomplet : un créneau sans part n''a PAS d''objectif, il n''en a pas zéro. security definer parce que la RLS de meals filtrerait un invoker coach.';

revoke all on function public.cible_creneau_du_repas(uuid) from public;
revoke execute on function public.cible_creneau_du_repas(uuid) from anon;
grant execute on function public.cible_creneau_du_repas(uuid) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- E. ENREGISTRER UN REPAS PLANIFIÉ — UNE SEULE TRANSACTION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ REMPLACEMENT INTÉGRAL, PAS UNE SÉRIE DE CORRECTIFS. Le client envoie
-- l'état complet du repas ; la fonction efface les aliments précédents et écrit
-- les nouveaux. Une suite d'appels indépendants laisserait, au premier réseau
-- coupé, un repas moitié ancien moitié nouveau — et l'élève ferait ses courses
-- avec.
--
-- Ce que la fonction vérifie, dans l'ordre :
--   1. l'élève est connu ;
--   2. la date est fournie ;
--   3. le repas appartient à un plan RÉELLEMENT ASSIGNÉ à cet élève, ET
--      LISIBLE par lui — `status <> 'prochain'`, exactement comme la policy de
--      lecture de `meals` et de `meal_choice_slots` ;
--   4. le repas est guidé (au moins une occurrence) ;
--   5. aucune occurrence n'est omise, ni citée deux fois : l'ensemble des
--      occurrences envoyées est EXACTEMENT celui du repas ;
--   6. chaque aliment appartient au snapshot de SON occurrence ;
--   7. l'unité est convertible pour cet aliment.
--
-- ⚠️ LE POINT 5 COMPARE DES ENSEMBLES, PAS DES NOMBRES. Un doublon accompagné
-- d'une occurrence omise donne le même total : compter ne verrait rien.
--
-- Les points 5 et 6 sont AUSSI garantis par des contraintes — l'unicité
-- `(planned_meal_id, choice_slot_id)` et les clés étrangères composites. La
-- fonction les vérifie d'abord pour rendre un message lisible ; la base reste le
-- dernier rempart, y compris si un jour un autre chemin d'écriture apparaît.
--
-- ⚠️ EN V1, TOUTE OCCURRENCE EST OBLIGATOIRE. Il n'existe aucune notion de liste
-- facultative : quatre listes dans un repas, c'est quatre choix. Le jour où le
-- facultatif arrivera, ce sera une colonne sur `meal_choice_slots` et une
-- condition ici — pas un assouplissement silencieux.
--
-- ⚠️ AUCUNE MACRO N'EST CALCULÉE ICI, et aucune n'est stockée. Les quantités
-- viennent du module de composition, côté client ; elles ne sont pas des
-- valeurs nutritionnelles mais un choix. Les macros ne seront calculées, par le
-- serveur et depuis la source, qu'au moment du « j'ai mangé » — par les RPC A5
-- existantes, inchangées.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.enregistrer_repas_planifie(
  p_meal_id uuid,
  p_planned_on date,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
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
      select f.nutrition_unit, f.piece_weight_g into v_aliment
        from public.food_catalog f
       where f.id = v_food and f.owner_coach_id is null and f.status = 'active';
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
$fn$;

comment on function public.enregistrer_repas_planifie(uuid, date, jsonb) is
  'N1 — enregistre ou remplace INTÉGRALEMENT un repas planifié, en une transaction. Vérifie l''élève, la date, l''appartenance du repas à un plan assigné ET lisible (status <> prochain), le caractère guidé du repas, puis que l''ensemble des occurrences envoyées est EXACTEMENT celui du repas — comparaison d''ensembles et non de nombres, car un doublon plus une omission donnent le même total. Vérifie enfin l''appartenance de chaque aliment au snapshot de son occurrence et la convertibilité de l''unité. En V1 toute occurrence est obligatoire : quatre listes, quatre choix. N''écrit AUCUNE macro et n''écrit JAMAIS dans consumed_meals : planifier n''est pas consommer.';

revoke all on function public.enregistrer_repas_planifie(uuid, date, jsonb) from public;
revoke execute on function public.enregistrer_repas_planifie(uuid, date, jsonb) from anon;
grant execute on function public.enregistrer_repas_planifie(uuid, date, jsonb) to authenticated, service_role;


create or replace function public.supprimer_repas_planifie(p_planned_meal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  delete from public.planned_meals
   where id = p_planned_meal_id and student_id = v_student;

  if not found then
    raise exception 'REPAS_PLANIFIE_INACCESSIBLE' using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.supprimer_repas_planifie(uuid) is
  'N1 — annule un repas planifié. Les aliments suivent par cascade. Sans cette fonction, l''élève ne pourrait jamais revenir sur une planification, puisqu''il n''a aucun privilège DELETE direct.';

revoke all on function public.supprimer_repas_planifie(uuid) from public;
revoke execute on function public.supprimer_repas_planifie(uuid) from anon;
grant execute on function public.supprimer_repas_planifie(uuid) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- F. RLS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.food_lists          enable row level security;
alter table public.food_list_items     enable row level security;
alter table public.meal_choice_slots   enable row level security;
alter table public.meal_choice_options enable row level security;
alter table public.planned_meals       enable row level security;
alter table public.planned_meal_items  enable row level security;

-- ── LA BIBLIOTHÈQUE : LE COACH PROPRIÉTAIRE, ET PERSONNE D'AUTRE ──────────
--
-- ⚠️ AUCUNE POLICY ÉLÈVE ICI, ET C'EST STRUCTUREL. L'élève ne lit JAMAIS un
-- modèle : il ne lit que les options copiées dans son repas. La garantie de
-- snapshot est ainsi doublée d'une garantie de sécurité — même une erreur de
-- code ne pourrait pas faire fuiter la bibliothèque d'un coach.

drop policy if exists "food_lists_manage_own_coach" on public.food_lists;
create policy "food_lists_manage_own_coach" on public.food_lists
  for all to authenticated
  using      (coach_id = public.current_coach_id())
  with check (coach_id = public.current_coach_id());

drop policy if exists "food_lists_manage_admin" on public.food_lists;
create policy "food_lists_manage_admin" on public.food_lists
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "food_list_items_manage_own_coach" on public.food_list_items;
create policy "food_list_items_manage_own_coach" on public.food_list_items
  for all to authenticated
  using (exists (
    select 1 from public.food_lists l
     where l.id = food_list_items.list_id and l.coach_id = public.current_coach_id()))
  with check (exists (
    select 1 from public.food_lists l
     where l.id = food_list_items.list_id and l.coach_id = public.current_coach_id()));

drop policy if exists "food_list_items_manage_admin" on public.food_list_items;
create policy "food_list_items_manage_admin" on public.food_list_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── LES OCCURRENCES : MÊME RÈGLE QUE `meals`, DONT ELLES SONT UN PROLONGEMENT ──
--
-- La condition de lecture élève est la COPIE EXACTE de
-- `meals_select_self_or_assigned`, `status <> 'prochain'` compris : un plan
-- « prochain » ne doit pas fuiter, ici pas plus qu'ailleurs.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ L'ÉCRITURE COACH EST GLOBALE, ET CE N'EST PAS UNE DÉCISION DE N1
-- ────────────────────────────────────────────────────────────────────────────
-- `is_coach_or_admin()` ne vérifie AUCUNE appartenance : c'est un simple
-- contrôle de rôle sur `profiles`. Un coach peut donc écrire les occurrences de
-- n'importe quel plan, y compris ceux d'un autre coach.
--
-- C'est EXACTEMENT la règle déjà en vigueur sur toute la chaîne de prescription,
-- vérifiée policy par policy :
--
--     nutrition_plans_manage_staff   ALL  is_coach_or_admin()
--     nutrition_days_manage_staff    ALL  is_coach_or_admin()
--     meals_manage_staff             ALL  is_coach_or_admin()
--
-- Les occurrences sont un prolongement de `meals` : leur donner une règle plus
-- stricte créerait une incohérence — un coach pourrait supprimer le repas d'un
-- confrère mais pas ses listes de choix. La bibliothèque, elle, est un
-- catalogue POSSÉDÉ, et suit donc l'autre convention du dépôt, celle de
-- `nutrition_recipes_manage_own_coach` : propriétaire uniquement.
--
-- Un test épingle cette équivalence : le jour où `meals` sera restreint aux
-- élèves d'un coach, il rougira et forcera à restreindre ces tables aussi.

drop policy if exists "meal_choice_slots_manage_staff" on public.meal_choice_slots;
create policy "meal_choice_slots_manage_staff" on public.meal_choice_slots
  for all to authenticated
  using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "meal_choice_slots_select_assigned" on public.meal_choice_slots;
create policy "meal_choice_slots_select_assigned" on public.meal_choice_slots
  for select to authenticated
  using (exists (
    select 1
      from public.meals m
      join public.nutrition_days d on d.id = m.nutrition_day_id
      join public.nutrition_plans p on p.id = d.plan_id
     where m.id = meal_choice_slots.meal_id
       and p.student_id = public.current_student_id()
       and p.status <> 'prochain'));

drop policy if exists "meal_choice_options_manage_staff" on public.meal_choice_options;
create policy "meal_choice_options_manage_staff" on public.meal_choice_options
  for all to authenticated
  using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "meal_choice_options_select_assigned" on public.meal_choice_options;
create policy "meal_choice_options_select_assigned" on public.meal_choice_options
  for select to authenticated
  using (exists (
    select 1
      from public.meal_choice_slots s
      join public.meals m on m.id = s.meal_id
      join public.nutrition_days d on d.id = m.nutrition_day_id
      join public.nutrition_plans p on p.id = d.plan_id
     where s.id = meal_choice_options.slot_id
       and p.student_id = public.current_student_id()
       and p.status <> 'prochain'));

-- ── LE REPAS PLANIFIÉ : L'ÉLÈVE LIT LE SIEN, LE COACH LE LIT AUSSI ────────
--
-- ⚠️ AUCUNE POLICY D'ÉCRITURE, ET AUCUN PRIVILÈGE D'ÉCRITURE (voir G). Le seul
-- chemin est la RPC. Une policy `for all` ouvrirait un second chemin où
-- l'appartenance de l'aliment au snapshot ne serait plus vérifiée avec un
-- message lisible — la clé étrangère la refuserait, mais l'élève verrait une
-- erreur de contrainte au lieu d'un refus explicite.

drop policy if exists "planned_meals_select_own_student" on public.planned_meals;
create policy "planned_meals_select_own_student" on public.planned_meals
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "planned_meals_select_own_coach" on public.planned_meals;
create policy "planned_meals_select_own_coach" on public.planned_meals
  for select to authenticated
  using (public.is_coach_of_student(student_id));

drop policy if exists "planned_meals_manage_admin" on public.planned_meals;
create policy "planned_meals_manage_admin" on public.planned_meals
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "planned_meal_items_select_own_student" on public.planned_meal_items;
create policy "planned_meal_items_select_own_student" on public.planned_meal_items
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "planned_meal_items_select_own_coach" on public.planned_meal_items;
create policy "planned_meal_items_select_own_coach" on public.planned_meal_items
  for select to authenticated
  using (public.is_coach_of_student(student_id));

drop policy if exists "planned_meal_items_manage_admin" on public.planned_meal_items;
create policy "planned_meal_items_manage_admin" on public.planned_meal_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════════
-- G. PRIVILÈGES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une policy dit quelles LIGNES sont visibles, jamais quelles VALEURS peuvent
-- être écrites. C'est le privilège qui décide du verbe — et c'est lui qui rend
-- la RPC incontournable pour la planification.
--
-- L'ordre compte : `revoke all` PRÉCÈDE les grants, sinon un privilège hérité
-- des réglages par défaut (dont TRUNCATE, qui contourne la RLS) survivrait.

revoke all on table public.food_lists          from public, anon, authenticated;
revoke all on table public.food_list_items     from public, anon, authenticated;
revoke all on table public.meal_choice_slots   from public, anon, authenticated;
revoke all on table public.meal_choice_options from public, anon, authenticated;
revoke all on table public.planned_meals       from public, anon, authenticated;
revoke all on table public.planned_meal_items  from public, anon, authenticated;

-- Le coach construit sa bibliothèque et les repas : quatre verbes, filtrés par
-- la RLS.
grant select, insert, update, delete on table public.food_lists          to authenticated;
grant select, insert, update, delete on table public.food_list_items     to authenticated;
grant select, insert, update, delete on table public.meal_choice_slots   to authenticated;
grant select, insert, update, delete on table public.meal_choice_options to authenticated;

-- ⚠️ LE REPAS PLANIFIÉ EST EN LECTURE SEULE POUR LE NAVIGATEUR. Même doctrine
-- que `consumed_meals` et `meal_entries`, pour une raison différente mais aussi
-- forte : l'écriture doit être un REMPLACEMENT INTÉGRAL et transactionnel.
-- Laisser passer un `insert` isolé, c'est autoriser un repas moitié ancien
-- moitié nouveau.
grant select on table public.planned_meals      to authenticated;
grant select on table public.planned_meal_items to authenticated;

grant all on table public.food_lists          to service_role;
grant all on table public.food_list_items     to service_role;
grant all on table public.meal_choice_slots   to service_role;
grant all on table public.meal_choice_options to service_role;
grant all on table public.planned_meals       to service_role;
grant all on table public.planned_meal_items  to service_role;
