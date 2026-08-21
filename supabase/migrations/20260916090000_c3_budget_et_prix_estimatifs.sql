-- ═══════════════════════════════════════════════════════════════════════════
-- COURSES C3 — LE BUDGET D'UNE LISTE, ET L'ESTIMATION DE SON COÛT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEUX CONCEPTS, DEUX ENDROITS — ET ILS NE SE MÉLANGENT JAMAIS
-- ────────────────────────────────────────────────────────────────────────────
--   LE BUDGET   appartient à une LISTE, donc à un élève et à une période.
--               « Budget pour cette liste : 60 € ». C'est une INTENTION.
--   LE PRIX     appartient à une IDENTITÉ alimentaire, et à personne d'autre.
--               « Riz basmati : 2,49 € les 1 000 g ». C'est une OBSERVATION.
--
-- Les confondre donnerait une colonne « prix » sur la liste de courses, et il
-- deviendrait impossible de répondre à la question « combien coûte le riz ? »
-- autrement qu'en fouillant les listes de tout le monde.
--
-- ────────────────────────────────────────────────────────────────────────────
-- TOUT EN CENTIMES ENTIERS. JAMAIS UN FLOTTANT.
-- ────────────────────────────────────────────────────────────────────────────
-- Ce n'est pas une préférence, c'est la doctrine déjà écrite du projet.
-- `lib/nutrition/basis-points.ts` la formule pour les pourcentages :
--
--     « Un pourcentage stocké en flottant rend impossible toute comparaison
--       fiable : 0.1 + 0.2 !== 0.3 »
--
-- et `subscription_templates.amount_cents integer check (>= 0)` l'applique
-- déjà à la monnaie. Les colonnes `*_euros numeric` de l'ancien socle
-- facturation sont l'exemple à ne pas suivre : `lib/payments.ts` doit y faire
-- `Math.round((total - paid) * 100) / 100` pour s'en sortir.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE C3 NE FAIT PAS, ET QUI APPARTIENT À C4
-- ────────────────────────────────────────────────────────────────────────────
-- Aucun magasin, aucune enseigne, aucune latitude, aucune promotion, aucune
-- disponibilité, aucun conditionnement. L'estimation de C3 est PROPORTIONNELLE :
-- 1 274 g de riz à 2,50 € le kilo valent 3,19 €, et non « deux paquets à 5 € ».
-- Le nombre de paquets demande `food_products.net_quantity` — qui existe déjà,
-- et que C4 exploitera.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LE BUDGET — UNE COLONNE SUR LA LISTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ADDITIF ET NULLABLE. C2 est en production : la colonne arrive à `null`
-- sur les listes existantes, et `null` veut dire « aucun budget », jamais
-- « budget de zéro ». Ce sont deux états différents à l'écran, et la base doit
-- pouvoir les distinguer.
alter table public.shopping_lists
  add column if not exists budget_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shopping_lists_budget_check') then
    alter table public.shopping_lists
      add constraint shopping_lists_budget_check
      check (
        budget_cents is null
        or (budget_cents >= 0 and budget_cents <= 100000)
      );
  end if;
end $$;

comment on column public.shopping_lists.budget_cents is
  'COURSES C3 — le budget que l''élève se fixe pour CETTE liste, en CENTIMES ENTIERS (6000 = 60,00 €). null = aucun budget, ce qui n''est PAS un budget de zéro. Plafond à 100 000 centimes (1 000 €) : garde-fou d''absurdité pour une liste de 1 à 7 jours, qui attrape la faute de frappe « 6000 » saisie pour 60,00 €. Le budget est une INTENTION de l''élève ; il n''a aucun rapport avec les prix, qui vivent dans food_price_estimates.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE PRIX ESTIMÉ D'UN ARTICLE MANUEL — SUR LA LIGNE, ET NULLE PART AILLEURS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ POURQUOI PAS DANS `food_price_estimates` ? Parce qu'un article MANUEL n'a
-- AUCUNE IDENTITÉ — c'est le contrat de C2, et la contrainte
-- `shopping_list_items_manual_check` l'impose. « Papier toilette » ne pointe ni
-- un aliment ni un produit : il ne peut pas entrer dans une table dont la clé
-- est précisément une identité. Son prix est donc une propriété de LA LIGNE.
--
-- ⚠️ ET SEULES LES LIGNES MANUELLES EN ONT UN. Une ligne PLAN tire son prix de
-- son identité : lui permettre une surcharge locale ouvrirait deux vérités
-- pour le même aliment, et il faudrait ensuite décider laquelle gagne.
alter table public.shopping_list_items
  add column if not exists estimated_price_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shopping_list_items_prix_manuel_check') then
    alter table public.shopping_list_items
      add constraint shopping_list_items_prix_manuel_check
      check (
        estimated_price_cents is null
        or (source = 'manual' and estimated_price_cents >= 0 and estimated_price_cents <= 100000)
      );
  end if;
end $$;

comment on column public.shopping_list_items.estimated_price_cents is
  'COURSES C3 — le prix estimé d''un article MANUEL, en centimes entiers. Toujours null sur une ligne PLAN : celle-ci tire son prix de son IDENTITÉ via food_price_estimates, et une surcharge locale créerait deux vérités pour le même aliment. Écrit par la RPC definir_prix_article_manuel, jamais par une écriture directe : le privilège d''update du client reste limité à `checked`.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LES PRIX ESTIMATIFS — UNE TABLE, DES IDENTITÉS, AUCUN MAGASIN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DES PRIX GLOBAUX, ET PAS UNE COLONNE `owner_coach_id`
-- ────────────────────────────────────────────────────────────────────────────
-- `food_catalog` porte le modèle « global OU privé à un coach » : la colonne
-- `owner_coach_id` nullable, et trois policies. La tentation serait de le
-- recopier ici.
--
-- ⚠️ LA MESURE DIT NON. En production, `food_catalog` compte 3 330 aliments,
-- dont ZÉRO privé de coach : la couche « par coach » n'a aucun utilisateur.
-- L'ajouter maintenant doublerait le nombre d'index partiels, introduirait une
-- règle de priorité (le prix du coach l'emporte-t-il sur le global ?) et une
-- famille de tests, pour un besoin que personne n'a exprimé.
--
-- Les prix de C3 sont donc GLOBAUX et administrés par l'admin, comme le
-- catalogue global. `owner_coach_id` s'ajoutera en une migration additive le
-- jour où un second coach le demandera — c'est exactement ce que C4 prévoit.
create table if not exists public.food_price_estimates (
  id uuid primary key default gen_random_uuid(),

  -- L'IDENTITÉ, en deux FK nullables et un CHECK par comptage — la forme du
  -- projet (`food_favorites_cible_unique`, `planned_meal_items_cible_unique`,
  -- `shopping_list_items_plan_check`), et jamais un couple
  -- `identity_type`/`identity_id` qui perdrait l'intégrité référentielle.
  --
  -- ⚠️ UN ALIMENT GÉNÉRIQUE ET UN PRODUIT COMMERCIAL NE FUSIONNENT PAS. « Riz »
  -- du catalogue Ciqual et « Riz Basmati Taureau Ailé 1 kg » sont deux choses
  -- que l'élève peut avoir dans sa liste, et qui n'ont pas le même prix.
  catalog_food_id uuid references public.food_catalog  (id) on delete cascade,
  product_id      uuid references public.food_products (id) on delete cascade,

  -- LE PRIX, ET LA QUANTITÉ QU'IL ACHÈTE.
  --
  -- ⚠️ ON NE PERSISTE PAS UN PRIX AU GRAMME. « 0,00249 €/g » est un flottant
  -- dont la précision se perd, et qui ne dit plus d'où il vient. On garde les
  -- DEUX nombres qu'un humain a lus sur une étiquette — 249 centimes pour
  -- 1 000 g — et le rapport se calcule au moment du besoin.
  price_cents integer not null,
  quantity    numeric not null,
  unit        text    not null,

  -- ⚠️ UNE SEULE VALEUR EN C3, ET C'EST VOULU. `manual_estimate` dit ce que
  -- c'est : un ordre de grandeur saisi à la main, pas un prix relevé en rayon.
  -- C4 ajoutera `store_observed` et ses colonnes d'enseigne ; la colonne existe
  -- dès maintenant pour que cet ajout soit additif, pas rétroactif.
  source text not null default 'manual_estimate',

  -- ⚠️ `archived` PLUTÔT QUE `delete`. Un prix retiré doit pouvoir être
  -- retrouvé : c'est ce qui permettra à C4 de raconter une évolution. Et c'est
  -- la convention de `food_catalog.status`.
  status text not null default 'active',

  -- La DATE à laquelle ce prix a été constaté. `date`, pas `timestamptz` :
  -- personne ne relève un prix à la seconde près, et la convention du projet
  -- est `_on date` pour une date réelle (`planned_on`, `consumed_on`).
  observed_on date not null default current_date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint food_price_estimates_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) = 1
  ),

  constraint food_price_estimates_price_check
    check (price_cents >= 0 and price_cents <= 100000),

  -- ⚠️ STRICTEMENT POSITIVE. Une quantité de référence nulle rendrait le
  -- rapport `besoin / quantité` infini, et l'estimation absurde sans erreur.
  constraint food_price_estimates_quantity_check
    check (quantity > 0),

  -- ⚠️ LES TROIS MÊMES UNITÉS QUE PARTOUT AILLEURS. Un prix « au kg » se saisit
  -- comme « 249 centimes pour 1000 g » : la donnée métier reste en grammes,
  -- l'affichage fait ce qu'il veut. Aucune conversion n'existe dans ce projet.
  constraint food_price_estimates_unit_check
    check (unit in ('g', 'ml', 'piece')),

  constraint food_price_estimates_source_check
    check (source in ('manual_estimate')),

  constraint food_price_estimates_status_check
    check (status in ('active', 'archived'))
);

-- ────────────────────────────────────────────────────────────────────────────
-- UN SEUL PRIX ACTIF PAR (IDENTITÉ, UNITÉ) — DEUX INDEX PARTIELS, ENCORE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ MÊME PIÈGE QU'EN A5 ET EN C2, MÊME PARADE. Un index
-- `unique (catalog_food_id, product_id, unit)` laisserait passer autant de
-- doublons qu'on voudrait sur les lignes produit : NULL n'est jamais égal à
-- NULL, donc deux lignes (NULL, skyr, g) sont vues comme différentes. Deux
-- index PARTIELS ne comparent que des valeurs réelles.
--
-- ⚠️ ET L'UNITÉ FAIT PARTIE DE LA CLÉ. Un aliment peut légitimement avoir un
-- prix au gramme ET un prix à la pièce (les œufs), et ce sont deux prix, pas
-- deux versions du même.
create unique index if not exists food_price_estimates_food_actif_unique
  on public.food_price_estimates (catalog_food_id, unit)
  where status = 'active' and catalog_food_id is not null;

create unique index if not exists food_price_estimates_product_actif_unique
  on public.food_price_estimates (product_id, unit)
  where status = 'active' and product_id is not null;

-- La requête de l'écran budget : « les prix actifs de ces identités-là ».
create index if not exists food_price_estimates_actifs_idx
  on public.food_price_estimates (status, unit);

comment on table public.food_price_estimates is
  'COURSES C3 — un prix ESTIMATIF pour une identité alimentaire, en centimes entiers, pour une quantité de référence et son unité (249 centimes / 1000 g). Exactement UNE cible par ligne : un aliment du catalogue OU un produit commercial, jamais les deux, jamais par nom. Un seul prix ACTIF par (identité, unité), garanti par deux index partiels — un index unique ordinaire laisserait passer les doublons produit, NULL n''étant jamais égal à NULL. Prix GLOBAUX, administrés par l''admin : la production ne compte aucun aliment privé de coach, donc aucune couche par coach n''est créée ici. Aucun magasin, aucune promotion, aucun conditionnement : c''est le périmètre de C4.';

comment on column public.food_price_estimates.quantity is
  'La quantité que ce prix achète, dans l''unité de la ligne. On garde price_cents ET quantity plutôt qu''un prix unitaire au gramme : un flottant €/g perd sa précision et ne dit plus d''où il vient. Le rapport se calcule au moment du besoin, et jamais entre unités différentes.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LE PRIX D'UN ARTICLE MANUEL — UNE RPC, POUR LA MÊME RAISON QU'EN C2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le privilège d'`update` accordé à `authenticated` sur `shopping_list_items`
-- est volontairement réduit à la SEULE colonne `checked` : c'est cette serrure,
-- et pas une policy, qui rend §12 de C2 infranchissable.
--
-- ⚠️ L'ÉLARGIR À `estimated_price_cents` ROUVRIRAIT CETTE SERRURE POUR TOUTES
-- LES LIGNES, y compris les lignes PLAN — un privilège de colonne ne sait pas
-- dire « seulement quand source = manual ». On passe donc par une RPC, comme
-- `modifier_article_manuel` dont celle-ci est le jumeau.
create or replace function public.definir_prix_article_manuel(
  p_item_id     uuid,
  p_price_cents integer
) returns void
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

  -- `null` EFFACE le prix. C'est un geste légitime : l'élève s'est trompé, ou
  -- ne veut plus compter cet article. Ce n'est pas « prix de zéro ».
  if p_price_cents is not null and (p_price_cents < 0 or p_price_cents > 100000) then
    raise exception 'PRIX_INVALIDE' using errcode = '22023';
  end if;

  update public.shopping_list_items
     set estimated_price_cents = p_price_cents
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

comment on function public.definir_prix_article_manuel(uuid, integer) is
  'COURSES C3 — pose ou efface (null) le prix estimé d''un article MANUEL de l''élève connecté, en centimes entiers. Refuse une ligne PLAN comme la ligne d''un autre élève, avec le même message. Existe parce que le privilège d''update du client est limité à la colonne `checked` : l''élargir à estimated_price_cents l''ouvrirait aussi aux lignes PLAN, qu''un grant de colonne ne sait pas distinguer.';

revoke all     on function public.definir_prix_article_manuel(uuid, integer) from public;
revoke execute on function public.definir_prix_article_manuel(uuid, integer) from anon;
grant  execute on function public.definir_prix_article_manuel(uuid, integer) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS — QUI LIT LES PRIX, QUI LES ÉCRIT, QUI POSE UN BUDGET
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.food_price_estimates enable row level security;

-- ⚠️ TOUT ÉLÈVE LIT LES PRIX ACTIFS, ET C'EST NORMAL : ce sont des ordres de
-- grandeur publics, pas des données personnelles. Les prix ARCHIVÉS, eux, ne
-- sortent pas — un prix retiré n'a plus à apparaître dans une estimation.
drop policy if exists "food_price_estimates_select_actifs" on public.food_price_estimates;
create policy "food_price_estimates_select_actifs" on public.food_price_estimates
  for select to authenticated
  using (status = 'active');

-- ⚠️ L'ADMIN, ET LUI SEUL, ÉCRIT. C'est le même chemin que le catalogue global
-- (`food_catalog_manage_admin`) : un prix est une donnée partagée par tous les
-- élèves, et un élève qui pourrait l'écrire modifierait le budget des autres.
drop policy if exists "food_price_estimates_manage_admin" on public.food_price_estimates;
create policy "food_price_estimates_manage_admin" on public.food_price_estimates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ⚠️ AUCUNE POLICY COACH, ET C'EST DÉLIBÉRÉ — voir le commentaire de la table :
-- la production ne compte aucun aliment privé de coach. Le jour où un coach
-- devra poser ses propres prix, une colonne `owner_coach_id` et une policy
-- s'ajouteront ensemble, sans rien réécrire.

-- LE BUDGET — l'élève écrit le sien, et rien d'autre.
--
-- ⚠️ C2 N'ACCORDAIT AUCUN DROIT D'ÉCRITURE SUR `shopping_lists` : la table est
-- écrite par la seule RPC de régénération. Cette policy et le grant ci-dessous
-- ouvrent EXACTEMENT une colonne, pas une de plus.
drop policy if exists "shopping_lists_update_budget_own_student" on public.shopping_lists;
create policy "shopping_lists_update_budget_own_student" on public.shopping_lists
  for update to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PRIVILÈGES — LE GRANT DE COLONNE, ENCORE, ET POUR LA MÊME RAISON
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `grant update (budget_cents)` ET RIEN D'AUTRE. Un
-- `update shopping_lists set starts_on = …` échoue sur un « permission denied
-- for column » AVANT que la policy soit évaluée. Sans ce grant de colonne, la
-- policy `for update` ci-dessus autoriserait l'élève à déplacer les dates de sa
-- liste — donc à faire pointer une liste vers une période qu'il n'a pas
-- planifiée.
--
-- ⚠️ `updated_at` N'EST PAS DANS LE GRANT, ET C'EST IMPORTANT. C2 vient de
-- rendre cette colonne véridique : elle date le dernier changement du CONTENU
-- de la liste. Poser un budget ne change aucune ligne, et ne doit donc pas la
-- faire avancer.
grant update (budget_cents) on table public.shopping_lists to authenticated;

revoke all on table public.food_price_estimates from public, anon, authenticated;
grant select on table public.food_price_estimates to authenticated;
grant all    on table public.food_price_estimates to service_role;
