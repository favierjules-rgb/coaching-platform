-- ============================================================================
-- Migration 20260903090000 — ALIMENTS A3, PHASE 3A : LES PRODUITS COMMERCIAUX.
-- (chantier feat/aliments-a2-meal-tracking)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE TABLE SÉPARÉE DE food_catalog
-- ────────────────────────────────────────────────────────────────────────────
-- Ciqual décrit des ALIMENTS GÉNÉRIQUES : « Banane, chair sans peau, crue ».
-- Open Food Facts décrit des PRODUITS INDUSTRIELS identifiés par un code-barres :
-- « Nutella, Ferrero, pot de 400 g ». Ce ne sont pas deux remplissages de la
-- même table, ce sont deux natures d'objet :
--
--   - un produit a un GTIN, une marque, une quantité nette, une image, une
--     liste d'ingrédients, des allergènes déclarés. Un aliment générique n'a
--     rien de tout cela ;
--   - un produit vient d'une base COLLABORATIVE, incomplète et mouvante, qu'on
--     interroge par le réseau et qu'on met en cache. Ciqual arrive par
--     migration, figé, exhaustif sur son périmètre ;
--   - un produit disparaît, change de recette, se fait corriger par un
--     contributeur. Les mélanger ferait entrer cette instabilité dans le
--     catalogue global lu par tous les élèves.
--
-- `food_id` est là pour RAPPROCHER un jour un produit de son aliment générique
-- (« Nutella » → « Pâte à tartiner aux noisettes et au cacao »). Ce
-- rapprochement n'est pas fait dans cette phase : la colonne existe, elle
-- reste NULL, et `match_status` dit explicitement qu'aucun rapprochement n'a
-- été tenté. Une colonne qui ment par défaut serait pire que pas de colonne.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE TABLE EST : UN CACHE, PAS UNE AUTORITÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Chaque ligne est une COPIE datée de ce qu'Open Food Facts disait au moment
-- de `source_fetched_at`. Elle n'est l'autorité de rien :
--
--   - elle ne dicte AUCUNE ligne de `meal_entries` déjà saisie — le contrat
--     d'instantané d'A1 vaut ici exactement comme pour Ciqual : rafraîchir un
--     produit ne réécrit pas l'histoire alimentaire d'un élève ;
--   - elle peut être vidée sans perte : le prochain scan la repeuple.
--
-- La fraîcheur (TTL 30 jours) est décidée par la couche serveur, PAS ici. Une
-- seconde définition du délai en SQL serait une seconde vérité, qui finirait
-- par diverger de la première. La base stocke la DATE ; le code décide ce
-- qu'« ancien » veut dire, en un seul endroit (lib/open-food-facts/constantes).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE colonne de calories. Les kcal SETH restent 4×P + 4×G + 9×L,
--     dérivées à la lecture. `energy-kcal_100g` d'OFF n'entre pas en base
--     comme autorité — au mieux il survit dans `source_payload`, pour l'audit ;
--   - AUCUNE densité. Un produit en `ml` reste en `ml` : rien ici ne convertit
--     un millilitre en gramme, et la Phase A2.1 a déjà prouvé que la chaîne
--     complète respecte ce contrat ;
--   - AUCUN jugement sur les allergènes. `allergens_declared` est une reprise
--     DÉCLARATIVE de ce qu'OFF publie. Aucune notion de « compatible »,
--     « sûr », « à éviter » : ce serait un conseil médical, et ce produit n'en
--     donne pas ;
--   - AUCUNE image copiée. On garde une URL, pas un octet : l'image appartient
--     à OFF sous CC BY-SA, et la recopier dans notre Storage créerait une
--     œuvre dérivée à rediffuser sous la même licence ;
--   - AUCUN appel réseau. Une migration ne parle à personne. Le réseau vit
--     dans la couche serveur, et nulle part ailleurs.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ── 1. LA TABLE ───────────────────────────────────────────────────────────
create table if not exists public.food_products (
  id uuid primary key default gen_random_uuid(),

  -- ── IDENTITÉ ────────────────────────────────────────────────────────────
  -- Le GTIN est une CHAÎNE, et ce n'est pas un détail de typage : un EAN-13
  -- comme '0000000000017' vaut 17 en numérique, et l'écrire en `bigint`
  -- perdrait les zéros de tête — c'est-à-dire l'identité du produit. Un
  -- code-barres ne s'additionne pas ; il se lit caractère par caractère.
  gtin text not null,

  brand text,
  product_name text not null,

  -- Quantité nette du conditionnement (« pot de 400 g »). Facultative, et
  -- elle le restera : OFF rend très souvent une chaîne vide. Absente veut dire
  -- INCONNUE, jamais zéro.
  net_quantity numeric,
  net_unit text,

  -- ── NUTRITION ───────────────────────────────────────────────────────────
  -- L'unité de référence des trois macros : « pour 100 g » ou « pour 100 ml ».
  -- Aucune conversion de l'une vers l'autre n'existe ni n'existera sans
  -- densité réelle, et nous n'en inventons pas.
  nutrition_unit text not null default 'g',

  -- NOT NULL, à dessein. Une ligne de cette table est, par construction,
  -- CONSOMMABLE : la couche serveur refuse un produit dont OFF ne publie pas
  -- les trois macros (erreur métier PRODUCT_NUTRITION_INCOMPLETE) et ne
  -- l'enregistre pas. Les rendre nullables aurait laissé entrer des lignes
  -- inutilisables qu'il aurait fallu re-filtrer partout — et aurait invité,
  -- un jour de fatigue, à remplacer un NULL par 0. Une macro absente est
  -- INCONNUE ; 0 explicite est une valeur, et il est accepté.
  protein_per_100 numeric not null,
  carb_per_100 numeric not null,
  fat_per_100 numeric not null,

  -- ── DESCRIPTIF, sans autorité ───────────────────────────────────────────
  image_url text,
  ingredients_text text,
  -- Reprise brute des tags OFF ('en:milk', 'en:nuts'…). DÉCLARATIF.
  allergens_declared text[],

  -- ── RAPPROCHEMENT AVEC LE CATALOGUE GÉNÉRIQUE (préparé, pas utilisé) ────
  food_id uuid references public.food_catalog (id) on delete set null,
  match_status text not null default 'unmatched',
  match_score numeric,

  -- ── PROVENANCE ET FRAÎCHEUR ─────────────────────────────────────────────
  -- Mêmes noms que `food_catalog` (migration 20260902090000) : un lecteur qui
  -- connaît l'une lit l'autre sans réapprendre le vocabulaire.
  source text not null default 'open_food_facts',
  -- La sous-version d'API épinglée qui a fourni la ligne — 'v3.4'. Elle est
  -- ici pour qu'un changement de version se VOIE en base : le jour où l'on
  -- passera à v4, les lignes anciennes diront de quel schéma elles viennent.
  source_version text,
  -- La réponse OFF telle que reçue (champs restreints). Sert l'audit et rien
  -- d'autre : aucune lecture applicative ne doit y puiser une valeur, sinon le
  -- schéma d'OFF redeviendrait notre schéma.
  source_payload jsonb,
  source_fetched_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── ÉTATS IMPOSSIBLES ───────────────────────────────────────────────────

  -- FORME du code-barres. Les longueurs légitimes sont GTIN-8, GTIN-12 (UPC-A),
  -- GTIN-13 (EAN-13) et GTIN-14. Rien d'autre n'est un code-barres produit.
  --
  -- ⚠️ La CLÉ DE CONTRÔLE n'est délibérément PAS vérifiée. Elle attraperait
  -- des fautes de frappe, mais Open Food Facts contient de vrais produits dont
  -- le code imprimé ne la respecte pas — les refuser rendrait un produit REEL
  -- inajoutable, ce qui est un défaut plus grave qu'un appel réseau perdu.
  -- Le lookup répond de toute façon PRODUCT_NOT_FOUND sur un code inventé.
  constraint food_products_gtin_forme
    check (gtin ~ '^[0-9]{8}$' or gtin ~ '^[0-9]{12,14}$'),

  constraint food_products_nutrition_unit_check
    check (nutrition_unit in ('g', 'ml')),

  -- Une macro NÉGATIVE n'existe pas. La contrainte ne dit rien de zéro : un
  -- produit à 0 g de lipides est parfaitement réel.
  constraint food_products_macros_positives
    check (protein_per_100 >= 0 and carb_per_100 >= 0 and fat_per_100 >= 0),

  -- Quantité nette : présente et positive, ou absente. Jamais zéro (un
  -- conditionnement de 0 g n'existe pas), jamais une unité sans nombre.
  constraint food_products_net_quantity_paire
    check ((net_quantity is null) = (net_unit is null)),
  constraint food_products_net_quantity_positive
    check (net_quantity is null or net_quantity > 0),
  constraint food_products_net_unit_check
    check (net_unit is null or net_unit in ('g', 'ml')),

  constraint food_products_match_status_check
    check (match_status in ('unmatched', 'auto', 'manual')),
  -- Un pointeur vers un aliment générique ne peut pas exister sans que le
  -- rapprochement soit déclaré, et réciproquement. Écrit dans les DEUX sens
  -- ici — contrairement à `meal_entries` — parce qu'aucun `on delete set null`
  -- ne s'applique… sauf justement celui de food_id. D'où la tolérance
  -- explicite ci-dessous : si l'aliment générique disparaît, le pointeur
  -- tombe à NULL et la ligne redevient simplement « non rapprochée ».
  constraint food_products_match_coherent
    check (food_id is null or match_status <> 'unmatched'),
  constraint food_products_match_score_borne
    check (match_score is null or (match_score >= 0 and match_score <= 1)),

  -- L'image reste une URL distante, et une URL sûre.
  constraint food_products_image_url_https
    check (image_url is null or image_url like 'https://%'),

  constraint food_products_source_non_vide
    check (
      length(btrim(source)) > 0
      and (source_version is null or length(btrim(source_version)) > 0)
    ),
  -- Un produit venu d'Open Food Facts doit dire de quelle version d'API il
  -- vient : c'est la seule trace qui permettra, plus tard, de reconnaître les
  -- lignes à rafraîchir après un changement de schéma. `is distinct from`
  -- plutôt que `<>` : avec `<>`, une source différente rendrait NULL, et un
  -- CHECK qui vaut NULL passe — vrai par accident au lieu de vrai par
  -- intention.
  constraint food_products_off_version_requise
    check (source is distinct from 'open_food_facts' or source_version is not null),

  constraint food_products_product_name_non_vide
    check (length(btrim(product_name)) > 0)
);

-- ── 2. IDENTITÉ : UN PRODUIT, UN GTIN ─────────────────────────────────────
-- Index unique TOTAL (et non partiel comme sur food_catalog) : ici, `gtin` est
-- NOT NULL, il n'y a donc pas de cas « sans identité » à épargner. C'est cet
-- index que l'`on conflict (gtin)` du rafraîchissement de cache infère : sans
-- lui, un second scan du même produit créerait un doublon au lieu de mettre la
-- ligne à jour.
create unique index if not exists food_products_gtin_unique
  on public.food_products (gtin);

-- Inventaire par référentiel et, surtout, balayage des lignes périmées :
-- « quels produits n'ont pas été rafraîchis depuis 30 jours ».
create index if not exists food_products_source_fetched_idx
  on public.food_products (source, source_fetched_at);

-- Rapprochements existants, quand il y en aura.
create index if not exists food_products_food_id_idx
  on public.food_products (food_id)
  where food_id is not null;

-- ── 3. meal_entries : LE POINTEUR DE PROVENANCE « produit » ───────────────
-- A1 avait déclaré `source_type = 'product'` dans son vocabulaire SANS
-- contrainte associée, et l'avait écrit noir sur blanc : « food_products
-- n'existe pas encore, et une contrainte qui référence le vide serait fausse
-- le jour où la table arrive ». Le jour est arrivé ; on pose la contrainte.
alter table public.meal_entries
  add column if not exists product_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'meal_entries_product_id_fkey'
       and conrelid = 'public.meal_entries'::regclass
  ) then
    -- `on delete set null`, comme food_id et recipe_id : le produit peut
    -- disparaître du cache — il DOIT pouvoir disparaître, c'est un cache —
    -- sans emporter l'entrée consommée. L'instantané reste exact, seul le
    -- lien vers la fiche est perdu. `on delete cascade` aurait effacé le
    -- repas d'un élève parce qu'on a vidé un cache : jamais.
    alter table public.meal_entries
      add constraint meal_entries_product_id_fkey
      foreign key (product_id) references public.food_products (id) on delete set null;
  end if;
end $$;

-- Même SENS que les contraintes d'A1 : « pointeur présent ⇒ source_type
-- cohérent », et jamais l'implication inverse. Écrite dans l'autre sens, la
-- mise à NULL provoquée par `on delete set null` violerait la contrainte et
-- rendrait impossible la suppression d'un produit du cache.
alter table public.meal_entries
  drop constraint if exists meal_entries_product_id_coherent;
alter table public.meal_entries
  add constraint meal_entries_product_id_coherent
  check (product_id is null or source_type = 'product');

-- A1 avait posé `meal_entries_source_unique` sur deux pointeurs. Le troisième
-- arrive : l'invariant « jamais deux provenances à la fois » se réécrit pour
-- couvrir les trois. Formulé par comptage plutôt qu'en trois disjonctions,
-- pour que l'intention reste lisible si un quatrième pointeur arrivait.
alter table public.meal_entries
  drop constraint if exists meal_entries_source_unique;
alter table public.meal_entries
  add constraint meal_entries_source_unique
  check (
    (case when recipe_id is null then 0 else 1 end)
    + (case when food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) <= 1
  );

create index if not exists meal_entries_product_id_idx
  on public.meal_entries (product_id)
  where product_id is not null;

-- ── 4. RLS : LECTURE POUR TOUS, ÉCRITURE PAR PERSONNE ─────────────────────
-- Le cache produit est GLOBAL : il n'appartient à aucun élève, aucun coach.
-- Tout utilisateur authentifié peut le lire — c'est un référentiel public,
-- publié par Open Food Facts sous ODbL.
--
-- Il n'écrit PAS. Et comme partout dans ce lot, ce n'est pas une politique qui
-- le garantit mais un PRIVILÈGE : une policy dit quelles LIGNES, jamais
-- quelles VALEURS. Sans le `revoke`, un navigateur pourrait insérer un
-- « produit » à 0,1 g de lipides pour 100 g et le consommer ensuite via la
-- RPC — le serveur aurait calculé un instantané parfaitement exact à partir
-- d'une source fabriquée par le client.
--
-- Le remplissage du cache est donc fait côté serveur uniquement, par la route
-- de lookup, à partir de la réponse d'Open Food Facts — jamais à partir du
-- corps d'une requête navigateur, qui ne transporte qu'un GTIN.
alter table public.food_products enable row level security;

drop policy if exists "food_products_select_all" on public.food_products;
create policy "food_products_select_all" on public.food_products
  for select to authenticated
  using (true);

-- L'ordre compte : `revoke all` PRÉCÈDE le grant, sinon un privilège hérité
-- d'un `grant` antérieur (ou du rôle `public`) survivrait au durcissement.
revoke all on table public.food_products from public;
revoke all on table public.food_products from anon;
revoke all on table public.food_products from authenticated;

-- SELECT SEUL. Pas d'insert, pas d'update, pas de delete : la liste est
-- exhaustive à dessein, et l'absence des trois autres verbes est le cœur de
-- cette migration.
grant select on table public.food_products to authenticated;
grant all on table public.food_products to service_role;

-- ── 5. `updated_at` : même déclencheur que partout ailleurs ───────────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.food_products';
    execute 'create trigger set_updated_at before update on public.food_products
             for each row execute function public.set_updated_at()';
  end if;
end $$;

-- ── 6. DOCUMENTATION EN BASE ──────────────────────────────────────────────
comment on table public.food_products is
  'CACHE local des produits industriels d''Open Food Facts, identifiés par code-barres. Ce n''est PAS un référentiel d''autorité : chaque ligne est une copie datée (source_fetched_at), et la vider n''a aucun effet sur les meal_entries déjà saisies, qui sont des instantanés indépendants depuis A1. Aucune calorie stockée : les kcal SETH restent 4×P + 4×G + 9×L, dérivées.';
comment on column public.food_products.gtin is
  'Code-barres, en CHAÎNE — jamais en numérique : un EAN-13 à zéros de tête perdrait son identité en bigint. Stocké tel qu''il a été interrogé, sans « réparation » : un code invalide est refusé avant tout appel réseau, pas corrigé.';
comment on column public.food_products.nutrition_unit is
  'Base des trois macros : ''g'' ou ''ml''. Aucune conversion entre les deux n''existe — elle demanderait une densité, et nous n''en inventons pas.';
comment on column public.food_products.protein_per_100 is
  'Protéines pour 100 g/ml. NOT NULL : une ligne de cette table est par construction consommable. Un produit dont Open Food Facts ne publie pas les trois macros est refusé par la couche serveur (PRODUCT_NUTRITION_INCOMPLETE) et n''arrive jamais ici — une absence n''est JAMAIS remplacée par zéro, tandis qu''un zéro explicite est une valeur valide.';
comment on column public.food_products.allergens_declared is
  'Reprise DÉCLARATIVE des tags d''allergènes publiés par Open Food Facts. Aucune interprétation : ni « sûr », ni « compatible », ni « à éviter ». Ce produit ne donne pas de conseil médical.';
comment on column public.food_products.image_url is
  'URL DISTANTE de l''image OFF. Aucune copie dans notre Storage : l''image est sous CC BY-SA, et la recopier créerait une œuvre dérivée soumise au partage à l''identique.';
comment on column public.food_products.food_id is
  'Rapprochement éventuel avec l''aliment GÉNÉRIQUE correspondant de food_catalog. Non utilisé en Phase 3 : reste NULL, avec match_status = ''unmatched''. on delete set null — si l''aliment générique disparaît, le produit redevient simplement non rapproché.';
comment on column public.food_products.match_status is
  'unmatched (aucun rapprochement tenté — la valeur par défaut, et la seule utilisée en Phase 3) | auto | manual. Une colonne qui mentirait par défaut serait pire que pas de colonne.';
comment on column public.food_products.source_version is
  'Sous-version d''API Open Food Facts épinglée qui a fourni la ligne — ''v3.4''. Permettra de reconnaître les lignes à rafraîchir le jour d''un changement de schéma. Le champ schema_version renvoyé par OFF n''est PAS utilisé : il a cessé d''être publié, et la garantie tient à l''URL épinglée, vérifiée par la présence effective de nutriments.*_100g.';
comment on column public.food_products.source_payload is
  'Réponse OFF telle que reçue (champs restreints), pour l''AUDIT uniquement. Aucune lecture applicative ne doit y puiser une valeur : sinon le schéma d''Open Food Facts redeviendrait le nôtre.';
comment on column public.food_products.source_fetched_at is
  'Date de la copie. La FRAÎCHEUR (TTL 30 jours) est décidée par la couche serveur, en un seul endroit : une seconde définition du délai en SQL serait une seconde vérité, qui finirait par diverger.';
comment on constraint food_products_gtin_forme on public.food_products is
  'GTIN-8, GTIN-12, GTIN-13 ou GTIN-14. La clé de contrôle n''est délibérément pas vérifiée : Open Food Facts contient de vrais produits dont le code imprimé ne la respecte pas, et les refuser rendrait un produit réel inajoutable.';
comment on constraint food_products_match_coherent on public.food_products is
  'Un pointeur vers un aliment générique implique un rapprochement déclaré. L''implication inverse n''est pas exigée, pour que on delete set null puisse ramener la ligne à l''état non rapproché.';
comment on column public.meal_entries.product_id is
  'Pointeur de PROVENANCE vers food_products, jamais d''autorité — comme food_id et recipe_id. on delete set null : le cache produit peut être vidé, l''entrée consommée reste exacte.';
comment on constraint meal_entries_source_unique on public.meal_entries is
  'Jamais deux provenances à la fois, sur les trois pointeurs (recette, aliment de catalogue, produit). Écrit par comptage pour rester lisible si un quatrième arrivait.';
