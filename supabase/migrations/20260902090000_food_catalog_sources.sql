-- ============================================================================
-- Migration 20260902090000 — ALIMENTS A3, PHASE 2A : LA PROVENANCE D'UN ALIMENT.
-- (chantier feat/aliments-a2-meal-tracking)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DEUX COLONNES
-- ────────────────────────────────────────────────────────────────────────────
-- `food_catalog` (A1) sait dire « Banane, chair sans peau, crue, 1,06 g de
-- protéines pour 100 g ». Elle ne sait pas dire D'OÙ ça vient.
--
-- Sans cette provenance, un import Ciqual ne peut pas être REJOUÉ : à la
-- deuxième exécution, rien ne permettrait de reconnaître une ligne déjà
-- importée, et le catalogue doublerait. Le nom ne suffit pas — un coach peut
-- créer « Banane » à la main, et l'Anses peut renommer un aliment d'un
-- millésime à l'autre sans changer son identifiant.
--
--   source          le FOURNISSEUR, stable dans le temps      'ciqual'
--   source_ref      l'identifiant de l'objet CHEZ LUI          l'`alim_code` Anses
--   source_version  le millésime qui a fourni la valeur ACTIVE '2025'
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI LA VERSION EST À PART DE L'IDENTITÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Première version de ce schéma : `source = 'ciqual_2025'`. L'import 2025
-- était bien idempotent, mais l'identité portait le millésime — et une future
-- Ciqual 2027 serait arrivée avec `source = 'ciqual_2027'` sur le MÊME
-- `alim_code`. La clé d'unicité aurait alors vu deux objets différents, et
-- créé une seconde ligne au lieu de mettre à jour la première. Le catalogue
-- aurait doublé à chaque millésime, et l'ancienne ligne serait restée en
-- place, périmée, indiscernable de la neuve.
--
-- L'identité est donc `(source, source_ref)` — le fournisseur et son
-- identifiant, tous deux stables — et le millésime est une PROPRIÉTÉ de la
-- ligne, qui change quand la valeur change :
--
--   ('ciqual', '13005', '2025')   →   ('ciqual', '13005', '2027')
--   même ligne, même identifiant food_catalog, teneurs mises à jour.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - elle N'IMPORTE AUCUNE DONNÉE. Les 3 330 aliments Ciqual arrivent par la
--     migration suivante (20260902090100), générée depuis le jeu versionné ;
--   - elle ne touche NI A1 NI A2 : aucune migration déjà appliquée n'est
--     réécrite, aucune RPC n'est modifiée. Un aliment Ciqual est un
--     `catalog_food` global ordinaire, et `ajouter_aliment_catalogue` (A2) le
--     consomme tel quel, sans une ligne de code en plus ;
--   - elle n'ajoute AUCUNE colonne de calories. Les kcal SETH restent
--     4×P + 4×G + 9×L, dérivées, jamais stockées ;
--   - aucune table de produits, aucun GTIN, aucun appel réseau.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

alter table public.food_catalog
  add column if not exists source text;
alter table public.food_catalog
  add column if not exists source_ref text;
alter table public.food_catalog
  add column if not exists source_version text;

-- Les deux vont ENSEMBLE ou pas du tout. Une `source` sans `source_ref` serait
-- inutilisable pour un upsert ; une `source_ref` sans `source` serait un
-- identifiant sans référentiel. Les aliments existants — ceux qu'un coach ou
-- un administrateur a saisis à la main — gardent les deux à NULL, et la
-- contrainte les accepte : c'est le cas « pas de source externe ».
alter table public.food_catalog
  drop constraint if exists food_catalog_source_paire;
alter table public.food_catalog
  add constraint food_catalog_source_paire
  check ((source is null) = (source_ref is null));

alter table public.food_catalog
  drop constraint if exists food_catalog_source_non_vide;
alter table public.food_catalog
  add constraint food_catalog_source_non_vide
  check (
    (source is null or length(btrim(source)) > 0)
    and (source_ref is null or length(btrim(source_ref)) > 0)
    and (source_version is null or length(btrim(source_version)) > 0)
  );

-- `source_version` n'est PAS obligatoire en général : une future source
-- pourrait n'avoir aucune notion de millésime, ou versionner par date. Elle
-- l'est en revanche pour Ciqual, dont chaque table porte une année et dont
-- l'exploitation demande de savoir laquelle a fourni la valeur affichée.
--
-- `is distinct from` plutôt que `<>` : avec `<>`, une ligne sans source rendrait
-- NULL, et un CHECK qui vaut NULL passe — la contrainte serait vraie par
-- accident plutôt que par intention.
alter table public.food_catalog
  drop constraint if exists food_catalog_ciqual_version_requise;
alter table public.food_catalog
  add constraint food_catalog_ciqual_version_requise
  check (source is distinct from 'ciqual' or source_version is not null);

-- ── LA CLÉ DE L'IMPORT IDEMPOTENT ─────────────────────────────────────────
-- Index unique PARTIEL : il ne contraint que les lignes qui ont réellement une
-- source. Un index total interdirait plus d'une ligne sans source, ce qui
-- casserait tous les aliments saisis à la main d'un coup — PostgreSQL ne
-- considère pas deux NULL comme égaux dans un index B-tree ordinaire, mais la
-- clause partielle rend l'intention explicite plutôt qu'implicite.
--
-- C'est cet index que l'`on conflict (source, source_ref)` de la migration de
-- données infère : sans lui, l'upsert échouerait.
--
-- ⚠️ `source_version` n'en fait DÉLIBÉRÉMENT pas partie. L'y ajouter
-- recréerait exactement le défaut qu'on corrige : ('ciqual','13005','2027')
-- ne serait plus en conflit avec ('ciqual','13005','2025'), et l'import
-- créerait un doublon au lieu de mettre à jour.
create unique index if not exists food_catalog_source_unique
  on public.food_catalog (source, source_ref)
  where source is not null;

-- Recherche et inventaire par référentiel.
create index if not exists food_catalog_source_idx
  on public.food_catalog (source)
  where source is not null;

comment on column public.food_catalog.source is
  'FOURNISSEUR d''origine de la ligne, stable dans le temps : ''ciqual'' pour la table de composition de l''Anses, NULL pour un aliment saisi à la main par un coach ou un administrateur. Ne porte JAMAIS de millésime — celui-ci vit dans source_version, pour que l''identité d''un aliment survive à un changement de version. Va toujours de pair avec source_ref.';
comment on column public.food_catalog.source_version is
  'Millésime du jeu de données qui a fourni les teneurs ACTUELLEMENT actives — ''2025'' pour la table Ciqual 2025. C''est une propriété de la ligne, pas une partie de son identité : un réimport en 2027 met cette colonne à jour sans créer de nouvelle ligne. NULL est permis pour une source qui n''a pas de notion de version, mais interdit pour Ciqual.';
comment on column public.food_catalog.source_ref is
  'Identifiant de la ligne CHEZ SA SOURCE — pour Ciqual, l''`alim_code` officiel. C''est la moitié de la clé d''upsert : un réimport reconnaît la ligne et la met à jour au lieu de la dupliquer. Un `alim_code` est stable d''un millésime à l''autre, contrairement au nom.';
comment on constraint food_catalog_source_paire on public.food_catalog is
  'source et source_ref sont indissociables. Les aliments saisis à la main gardent les deux à NULL.';
comment on constraint food_catalog_ciqual_version_requise on public.food_catalog is
  'Une ligne Ciqual doit dire de quel millésime viennent ses teneurs. La contrainte ne vise QUE Ciqual : une future source pourra n''avoir aucune version.';
comment on index public.food_catalog_source_unique is
  'Index PARTIEL sur (source, source_ref) — SANS source_version. N''impose l''unicité qu''aux lignes issues d''un référentiel, et c''est lui que l''on conflict infère lors d''un réimport. Y ajouter le millésime ferait qu''une nouvelle version créerait un doublon au lieu de mettre à jour.';
