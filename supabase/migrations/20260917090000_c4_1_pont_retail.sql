-- ============================================================================
-- Migration 20260917090000 — COURSES C4.1 : LE PONT CIQUAL → PRODUITS RÉELS.
-- (chantier pivot Open Prices)
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION AJOUTE, ET RIEN D'AUTRE
-- ────────────────────────────────────────────────────────────────────────────
-- UNE table de cinq colonnes : `food_catalog_retail_review`. Elle porte l'état
-- de CURATION des aliments génériques qui n'ont encore AUCUN produit rapproché.
--
-- Elle n'existe que parce que `food_products` ne peut pas porter cette
-- information : un aliment sans produit n'a AUCUNE ligne dans `food_products`,
-- donc aucun endroit où écrire « celui-ci est hors périmètre » ou « celui-ci
-- est une forme cuite ». C'est le seul manque mesuré ; c'est le seul comblé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ CE QUE CETTE TABLE NE STOCKE JAMAIS : L'ÉTAT « MATCHED »
-- ────────────────────────────────────────────────────────────────────────────
-- Le CHECK sur `status` interdit littéralement la valeur 'matched', et ce n'est
-- pas une précaution de style : c'est l'invariant central de ce lot.
--
-- Le rapprochement réel se DÉRIVE, et d'une seule source :
--
--     un aliment est rapproché  ⇔  ∃ food_products.food_id = <aliment>
--
-- Stocker un second 'matched' ici créerait une seconde vérité — et le jour où
-- les deux divergeraient, c'est la table de curation qu'on croirait, parce
-- qu'elle est plus lisible. Le fait constaté doit toujours l'emporter sur la
-- note d'intention.
--
-- ⚠️ ET LA CONDITION CANONIQUE EST `food_id IS NOT NULL`, JAMAIS `match_status`.
-- La contrainte `food_products_match_coherent` de la migration 20260903090000
-- n'est écrite que dans UN sens (`food_id is null or match_status <> 'unmatched'`)
-- — délibérément, pour que le `on delete set null` de `food_catalog` puisse
-- vider `food_id` sans violer la contrainte. L'état
-- `match_status = 'manual'` AVEC `food_id IS NULL` est donc parfaitement LÉGAL :
-- il veut dire « ce rapprochement a existé, l'aliment générique a disparu ».
-- Un tel produit n'est PAS rapproché. Le lire comme un match ferait remonter un
-- produit orphelin dans les courses d'un élève.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE TOUCHE PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - `food_products` : ni colonne, ni contrainte, ni index, ni policy, ni
--     GRANT. Sa serrure — `revoke all from authenticated` puis `grant select`
--     seul — reste exactement celle de septembre. C4.1 écrit `food_id` par la
--     route serveur avec le client service_role, c'est-à-dire par le chemin qui
--     existe DÉJÀ pour remplir cette table. Aucune RPC `security definer`
--     n'est créée : elle serait le premier chemin d'écriture cliente vers un
--     cache global, donc exactement ce que cette serrure interdit ;
--   - `food_catalog` : aucune colonne ajoutée. Y ranger un état de curation
--     commerciale imposerait d'ouvrir un privilège d'écriture sur le
--     référentiel nutritionnel central, lu par tous les élèves ;
--   - `shopping_lists`, `shopping_list_items`, `food_price_estimates`,
--     `planned_meals`, `consumed_meals` : rien. C4.1 ne calcule aucun prix et
--     n'affiche aucun montant ;
--   - AUCUNE colonne `purchase_ciqual_code`, AUCUN `yield_ratio`. La
--     redirection cru→cuit et le facteur de quantité arriveront ENSEMBLE, le
--     jour où une source citable existera. Poser l'une sans l'autre donnerait
--     un pont vers le bon produit avec la mauvaise quantité — un prix faux d'un
--     facteur 2 à 3, affirmé avec aplomb.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ── 1. LA TABLE ───────────────────────────────────────────────────────────
create table if not exists public.food_catalog_retail_review (
  -- Clé primaire = l'aliment. UNE décision par aliment, pas un journal : la
  -- dernière décision remplace la précédente, et `reviewed_at` dit quand.
  --
  -- `on delete cascade` — et non `set null` comme ailleurs — parce qu'une
  -- décision de curation SUR un aliment n'a aucun sens sans lui. Ce n'est pas
  -- une donnée d'élève qu'on protège, c'est une note de travail.
  catalog_food_id uuid primary key
    references public.food_catalog (id) on delete cascade,

  status text not null,

  -- Le POURQUOI, en clair, pour l'administrateur suivant. Facultatif, mais
  -- jamais vide : une chaîne blanche serait une note qu'on croit avoir écrite.
  note text,

  -- Qui a décidé. NULLABLE et `on delete set null`, sur le modèle de
  -- `notification_campaigns.created_by` (migration 20260828090000) : supprimer
  -- un compte administrateur ne doit pas être bloqué par une note de curation,
  -- et ne doit pas non plus effacer la décision. On perd l'auteur, pas le fait.
  reviewed_by uuid references auth.users (id) on delete set null,

  reviewed_at timestamptz not null default now(),

  -- ── ÉTATS IMPOSSIBLES ───────────────────────────────────────────────────

  -- ⚠️ LA CONTRAINTE LA PLUS IMPORTANTE DE CETTE MIGRATION.
  -- 'matched' est ABSENT de cette liste, et son absence est le contrat : cette
  -- table ne décrit QUE des aliments sans produit rapproché. L'état « rapproché »
  -- se dérive de `food_products.food_id`, et de nulle part ailleurs.
  --
  --   'unsupported'        — hors périmètre : famille trop large, plat composite,
  --                          ou trou de taxonomie OFF (aucune catégorie ne porte
  --                          de code Ciqual pour cet aliment) ;
  --   'needs_raw_redirect' — forme CUITE. Le rayon ne vend pas de riz cuit. Sortir
  --                          du flux tant qu'aucun facteur de rendement sourcé
  --                          n'existe : sans lui, on saurait quoi acheter mais pas
  --                          combien ;
  --   'needs_review'       — des candidats existent, aucun n'a encore été validé.
  constraint food_catalog_retail_review_status_check
    check (status in ('unsupported', 'needs_raw_redirect', 'needs_review')),

  constraint food_catalog_retail_review_note_non_vide
    check (note is null or length(btrim(note)) > 0)
);

-- « Tous les aliments à traiter, par famille » — l'écran de curation ne lit
-- jamais la table entière, il lit un statut.
create index if not exists food_catalog_retail_review_status_idx
  on public.food_catalog_retail_review (status);

-- ── 2. RLS : LECTURE ADMIN, ÉCRITURE PERSONNE ─────────────────────────────
-- Même doctrine que `food_products`, et pour la même raison : une policy dit
-- quelles LIGNES, jamais quelles VALEURS. C'est le PRIVILÈGE qui ferme
-- l'écriture, et le refus tombe avant toute évaluation de policy.
--
-- ⚠️ LECTURE RÉSERVÉE À L'ADMIN, à la différence de `food_products` qui est un
-- référentiel public. Cet état sert la curation interne. L'élève, lui, voit
-- l'ABSENCE de prix — doctrine de couverture honnête de C3 — jamais sa cause
-- interne : savoir que « le poivron cuit attend un facteur de rendement » ne
-- l'aide pas à faire ses courses.
alter table public.food_catalog_retail_review enable row level security;

drop policy if exists "food_catalog_retail_review_select_admin"
  on public.food_catalog_retail_review;
create policy "food_catalog_retail_review_select_admin"
  on public.food_catalog_retail_review
  for select to authenticated
  using (public.is_admin());

-- L'ordre compte : `revoke all` PRÉCÈDE le grant, sinon un privilège hérité du
-- rôle `public` survivrait au durcissement.
revoke all on table public.food_catalog_retail_review from public;
revoke all on table public.food_catalog_retail_review from anon;
revoke all on table public.food_catalog_retail_review from authenticated;

-- SELECT SEUL, et encore : filtré par la policy `is_admin()`. Pas d'insert,
-- pas d'update, pas de delete. La liste est exhaustive à dessein.
grant select on table public.food_catalog_retail_review to authenticated;
grant all on table public.food_catalog_retail_review to service_role;

-- ── 3. DOCUMENTATION EN BASE ──────────────────────────────────────────────
comment on table public.food_catalog_retail_review is
  'COURSES C4.1 — état de CURATION des aliments génériques SANS produit rapproché. Ne contient AUCUN prix, AUCUN code produit, AUCUNE donnée Open Food Facts : c''est un carnet de décisions humaines. ⚠️ N''a PAS d''état « matched » : le rapprochement réel se dérive de food_products.food_id, seule source de vérité. Écriture réservée à service_role, via la route serveur d''administration.';
comment on column public.food_catalog_retail_review.catalog_food_id is
  'L''aliment générique concerné, et la clé primaire : UNE décision courante par aliment, pas un journal. `on delete cascade` — une note de curation sur un aliment disparu n''a pas de sens.';
comment on column public.food_catalog_retail_review.status is
  '''unsupported'' (hors périmètre : famille trop large, plat composite, ou aucune catégorie OFF portant un code Ciqual) · ''needs_raw_redirect'' (forme CUITE : le rayon ne la vend pas, et aucun facteur de rendement sourcé n''existe encore) · ''needs_review'' (candidats trouvés, aucun validé). ⚠️ ''matched'' est INTERDIT par le CHECK : il se dérive de food_products.food_id.';
comment on column public.food_catalog_retail_review.note is
  'Le POURQUOI de la décision, pour l''administrateur suivant. Facultatif, jamais vide : une chaîne blanche serait une note qu''on croit avoir écrite.';
comment on column public.food_catalog_retail_review.reviewed_by is
  'Qui a décidé. NULLABLE : supprimer un compte administrateur ne doit ni être bloqué par une note de curation, ni effacer la décision. On perd l''auteur, pas le fait.';
comment on column public.food_catalog_retail_review.reviewed_at is
  'Quand la décision courante a été prise. Réécrit à chaque nouvelle décision sur le même aliment.';
