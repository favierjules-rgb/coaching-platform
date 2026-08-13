-- ============================================================================
-- Migration 20260831090000 — ALIMENTS A1, FONDATIONS DATA.
-- (chantier feat/aliments-a1)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- L'audit A0 a établi qu'AUCUNE représentation d'un aliment consommé n'existe
-- dans ce schéma. `meals.items` est du texte libre saisi par le coach (3 451
-- entrées, `quantity` vide sur toutes) ; `solveRecipe` n'est jamais persisté ;
-- `nutrition_daily_logs` n'enregistre que quatre nombres par JOUR, et ne peut
-- même pas exister sans plan assigné (`nutrition_plan_id` NOT NULL).
--
-- Cette migration pose les trois tables de base — et rien d'autre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. `public.food_slug(text)`            — normalisation DÉTERMINISTE, sans
--      aucune extension (pg_trgm et unaccent ne sont pas installées, et ce
--      chantier n'a pas de raison d'en installer une) ;
--   B. `public.is_coach_of_student(uuid)`  — la relation coach ↔ élève, qui
--      n'existait NULLE PART dans ce schéma ;
--   C. `public.food_catalog`               — l'aliment CANONIQUE, hybride :
--      `owner_coach_id is null` = aliment global SETH, sinon aliment privé.
--      Porte `piece_weight_g` (nullable), qui PRÉPARE la conversion
--      pièce → grammes sans qu'aucun code de ce lot ne la lise ;
--   D. `public.food_aliases`               — les autres noms d'un aliment ;
--   E. `public.meal_entries`               — la consommation réelle, repas par
--      repas, avec un INSTANTANÉ INDÉPENDANT DE SA SOURCE ;
--   F. la RLS des trois tables, STRICTE (décision Q1 du 10/08/2026).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE donnée insérée. Pas un aliment, pas un alias, pas une entrée.
--     Les 80 noms d'ingrédients existants ne sont PAS repris : un référentiel
--     rempli par heuristique serait faux et invisible ;
--   - AUCUNE modification de `nutrition_daily_logs` — ni colonne, ni policy,
--     ni RPC, ni couche TypeScript. Elle reste l'outil 1, telle quelle. Le
--     plan de convergence est écrit dans docs/, pas exécuté ici, et il n'y a
--     AUCUNE double écriture : `meal_entries` vit à côté, sans lien ;
--   - AUCUNE colonne `food_id` sur `nutrition_recipe_ingredients`. Les trois
--     RPC d'écriture (`save_nutrition_recipe`, `duplicate_nutrition_recipe`,
--     `import_nutrition_recipes`) font DELETE-ALL puis INSERT avec une liste
--     de 18 colonnes nommées : une colonne ajoutée aujourd'hui serait effacée
--     à la sauvegarde suivante, sans erreur ni test rouge. Reporté au chantier
--     INGREDIENT CATALOG LINKAGE, distinct de DATA CLEANUP ;
--   - AUCUNE table `food_products`, aucun GTIN, aucun scanner, aucun appel
--     réseau, aucune extension PostgreSQL ajoutée ;
--   - AUCUNE modification du moteur nutrition. `recipe-solver.ts` ne lit pas
--     `food_catalog`, et les macros d'ingrédient restent sa seule autorité.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DÉCISION — RLS STRICTE, ET POURQUOI ELLE S'ÉCARTE DU RESTE DU SCHÉMA
-- ────────────────────────────────────────────────────────────────────────────
-- Vingt tables élève de ce schéma utilisent le même moule :
--     using (student_id = public.current_student_id() or public.is_coach_or_admin())
-- `is_coach_or_admin()` ne distingue pas les coachs entre eux. Appliqué à
-- `meal_entries`, ce moule donnerait à TOUT futur coach le journal alimentaire
-- de TOUS les élèves. C'est refusé ici (décision du 10/08/2026).
--
-- La lecture coach passe donc par `is_coach_of_student()`, adossée à
-- `students.coach_id`. Conséquence MESURÉE et VOULUE : les élèves dont
-- `students.coach_id` est NULL (2 sur 7 au 10/08/2026) ne sont lisibles par
-- AUCUN coach. Ils restent lisibles par eux-mêmes et par l'administrateur.
-- Aucun rattachement automatique n'est fait ici : deviner un propriétaire,
-- c'est se tromper le jour où un second coach existe — même raisonnement que
-- la migration 20260816090000.
--
-- Le coach a la LECTURE, jamais l'écriture : un journal alimentaire est la
-- parole de l'élève. Seuls l'élève et l'administrateur écrivent.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DÉCISION — `to authenticated` EXPLICITE SUR LE CATALOGUE
-- ────────────────────────────────────────────────────────────────────────────
-- La migration 20260807090000 explique pourquoi ses policies n'ont pas de
-- clause `TO` : leurs prédicats (`… = current_student_id()`) sont FAUX pour
-- `anon`, donc la clause serait décorative.
--
-- Ici, le prédicat de lecture du catalogue global est `owner_coach_id is null`
-- — il est VRAI pour n'importe qui, `anon` compris. Le seul rempart serait
-- alors le privilège, ce qui fait dépendre la confidentialité d'un `grant`
-- plutôt que d'une policy. La clause `to authenticated` est donc posée
-- explicitement sur toutes les policies de `food_catalog` et `food_aliases`.
-- Ce n'est pas une incohérence de style : c'est la même règle appliquée à un
-- prédicat de forme différente.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. `food_slug(text)` — normalisation déterministe, sans extension
-- ────────────────────────────────────────────────────────────────────────────
-- `pg_trgm`, `unaccent` et `citext` ne sont PAS installées sur le projet
-- distant (vérifié le 10/08/2026 : `installed_version` null pour les trois).
-- Ce chantier ne livre aucune recherche floue : en installer une « pour plus
-- tard » ajouterait une dépendance de production que rien n'exercerait.
--
-- La normalisation est donc bâtie sur des fonctions du noyau, toutes
-- `immutable` : `replace`, `translate`, `regexp_replace`, `btrim`.
-- Être `immutable` est ce qui autorise la COLONNE GÉNÉRÉE plus bas — et une
-- colonne générée ne peut pas se désynchroniser, contrairement à une valeur
-- calculée côté application (le défaut de `newsletter_subscribers.normalized_email`).
--
-- ⚠️ PAS DE `lower()`, ET C'EST DÉLIBÉRÉ. `lower()` est déclarée `immutable`
-- par PostgreSQL, mais son résultat dépend de la COLLATION de la base : sur
-- une base en locale C, `lower('Œ')` rend `'Œ'` inchangé, et le caractère est
-- ensuite balayé par le nettoyage — « Œuf entier » devenait « uf-entier ».
-- Mesuré sur PostgreSQL 16, pas supposé. Une colonne générée figée sur une
-- normalisation dépendante de la locale serait fausse dès qu'un
-- environnement diffère. Le repli de casse est donc fait par `translate()`
-- sur l'alphabet ASCII, qui ne consulte aucune collation, et les ligatures
-- comme les accents sont traités DANS LES DEUX CASSES.
--
-- ⚠️ RÈGLE D'EXPLOITATION : cette fonction est référencée par deux colonnes
-- générées. PostgreSQL empêche son DROP, mais PAS son `create or replace` —
-- et un remplacement NE RECALCULE PAS les lignes existantes. Toute évolution
-- de la normalisation doit donc passer par une migration qui remplace la
-- fonction ET réécrit les colonnes concernées dans la même transaction.
create or replace function public.food_slug(p_texte text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          translate(
            translate(
              replace(replace(replace(replace(replace(p_texte,
                'Œ', 'oe'), 'œ', 'oe'), 'Æ', 'ae'), 'æ', 'ae'), 'ß', 'ss'),
              'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
              'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy'
            ),
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'abcdefghijklmnopqrstuvwxyz'
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      ),
      '-'
    ),
    ''
  );
$$;

alter function public.food_slug(text) owner to postgres;

comment on function public.food_slug(text) is
  'Normalisation DÉTERMINISTE d''un nom d''aliment : ligatures développées dans les deux casses (Œ/œ→oe, Æ/æ→ae, ß→ss), accents latins retirés dans les deux casses par translate(), repli de casse ASCII par translate() — JAMAIS lower(), dont le résultat dépend de la collation de la base — puis tout le reste réduit à des tirets simples et tirets de bord supprimés. Rend NULL pour une chaîne sans aucun caractère alphanumérique. immutable et strict, et indépendante de la collation : c''est ce qui rend sûre son utilisation dans une colonne générée. N''utilise AUCUNE extension : pg_trgm et unaccent ne sont pas installées, et ce chantier n''a aucune raison d''en installer une.';

revoke all on function public.food_slug(text) from public;
revoke execute on function public.food_slug(text) from anon;
grant execute on function public.food_slug(text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- B. `is_coach_of_student(uuid)` — la relation coach ↔ élève
-- ────────────────────────────────────────────────────────────────────────────
-- Elle n'existait nulle part : aucune fonction, aucune policy du schéma ne
-- joignait `students.coach_id` à `current_coach_id()`. C'est la brique qui
-- rend la lecture coach de `meal_entries` réellement restrictive.
--
-- `security definer` pour la même raison que `current_coach_id()` : la policy
-- de `students` filtrerait la lecture d'un appelant `invoker`, et la fonction
-- répondrait alors faux pour de mauvaises raisons. Le corps ne fait qu'une
-- lecture, ne prend qu'un uuid, et ne renvoie qu'un booléen : aucune donnée
-- n'en sort qui ne soit déjà connue de l'appelant.
--
-- `s.coach_id is not null` est logiquement redondant (NULL n'est jamais égal
-- à quoi que ce soit) mais écrit quand même — c'est la forme retenue par la
-- migration 20260813090000, et elle rend la règle lisible sans raisonner sur
-- la logique ternaire.
--
-- Elle renvoie FAUX — jamais NULL, jamais vrai — pour : un élève, un anonyme,
-- un compte sans fiche coach, un coach non rattaché à cet élève, un élève
-- dont `coach_id` est NULL. Ce dernier cas est VOULU (voir l'en-tête).
create or replace function public.is_coach_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.students s
     where s.id = p_student_id
       and s.coach_id is not null
       and s.coach_id = public.current_coach_id()
  );
$$;

alter function public.is_coach_of_student(uuid) owner to postgres;

comment on function public.is_coach_of_student(uuid) is
  'Vrai si le compte connecté est le coach RATTACHÉ à cet élève (students.coach_id = current_coach_id()). Faux pour un élève, un anonyme, un administrateur sans fiche coach, un coach tiers, et pour tout élève dont coach_id est NULL — ce dernier cas est un choix explicite : aucun rattachement n''est deviné. Ne remplace pas is_admin(), qui reste le chemin d''accès global.';

revoke all on function public.is_coach_of_student(uuid) from public;
revoke execute on function public.is_coach_of_student(uuid) from anon;
grant execute on function public.is_coach_of_student(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- C. `food_catalog` — l'aliment canonique, hybride
-- ────────────────────────────────────────────────────────────────────────────
-- AUCUNE COLONNE DE CALORIES. C'est une contrainte de conception, pas un
-- oubli : l'énergie est une FONCTION des macros (4 / 4 / 9 kcal par gramme,
-- KCAL_PER_GRAM dans lib/nutrition/macro-targets.ts). La stocker créerait une
-- seconde source de vérité qui dériverait au premier arrondi. C'est
-- exactement le défaut de `nutrition_daily_logs.calories`, qu'on ne reproduit
-- pas.
--
-- Les macros sont POUR 100 UNITÉS NUTRITIONNELLES — 100 g ou 100 ml selon
-- `nutrition_unit`. Le suffixe `_per_100` (et non `_per_100g`, celui de
-- `nutrition_recipe_ingredients`) dit exactement cela : l'unité est portée
-- par une colonne, pas par un nom de colonne.
create table if not exists public.food_catalog (
  id uuid primary key default gen_random_uuid(),

  -- NULL = aliment GLOBAL SETH. Sinon : aliment PRIVÉ de ce coach.
  -- `on delete restrict` : supprimer un coach ne doit jamais emporter
  -- silencieusement son référentiel, ni transformer ses aliments privés en
  -- aliments globaux (ce que ferait `set null` — une élévation de portée
  -- par effet de bord).
  owner_coach_id uuid references public.coaches (id) on delete restrict,

  name text not null,
  slug text generated always as (public.food_slug(name)) stored,

  nutrition_unit text not null default 'g',

  protein_per_100 numeric not null,
  carb_per_100 numeric not null,
  fat_per_100 numeric not null,

  -- ── LE POIDS D'UNE PIÈCE — POSÉ MAINTENANT, EXPLOITÉ PLUS TARD ────────
  -- « 1 banane » n'est pas convertible en macros tant que rien ne dit ce
  -- que pèse une banane. Cette colonne le dira : 1 banane ≈ 120 g.
  --
  -- Elle est NULLABLE et le restera : la plupart des aliments n'ont pas de
  -- pièce naturelle (riz, huile, fromage blanc), et un défaut inventé serait
  -- pire que l'absence. NULL veut dire « cet aliment ne se compte pas en
  -- pièces », pas « on ne sait pas encore ».
  --
  -- A1 ne livre AUCUN moteur de conversion : rien dans ce lot ne lit cette
  -- colonne. Elle est posée ici parce que l'ajouter plus tard imposerait une
  -- migration de plus sur une table déjà en production, alors qu'une colonne
  -- nullable sur une table vide ne coûte rien aujourd'hui.
  piece_weight_g numeric,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint food_catalog_name_not_blank
    check (length(btrim(name)) > 0),
  -- Un nom entièrement fait de ponctuation produirait un slug vide : la
  -- ligne est refusée plutôt que rangée sous une clé inexploitable.
  constraint food_catalog_slug_not_empty
    check (slug is not null),
  constraint food_catalog_nutrition_unit_check
    check (nutrition_unit in ('g', 'ml')),
  constraint food_catalog_macros_non_negative
    check (protein_per_100 >= 0 and carb_per_100 >= 0 and fat_per_100 >= 0),
  constraint food_catalog_status_check
    check (status in ('active', 'archived')),
  -- Un poids de pièce nul ou négatif n'est pas une pièce. NULL reste permis :
  -- c'est la valeur qui dit « cet aliment ne se compte pas en pièces ».
  constraint food_catalog_piece_weight_positive
    check (piece_weight_g is null or piece_weight_g > 0)
);

-- Unicité du slug, dans DEUX espaces de noms disjoints. Deux index PARTIELS
-- plutôt qu'un seul index sur (owner_coach_id, slug) : ce dernier ne
-- contraindrait rien côté global, puisque NULL n'entre pas en collision avec
-- NULL dans un index unique.
create unique index if not exists food_catalog_slug_global_unique
  on public.food_catalog (slug) where owner_coach_id is null;

create unique index if not exists food_catalog_slug_coach_unique
  on public.food_catalog (owner_coach_id, slug) where owner_coach_id is not null;

create index if not exists food_catalog_owner_status_idx
  on public.food_catalog (owner_coach_id, status);

comment on table public.food_catalog is
  'Aliment CANONIQUE, référentiel hybride. owner_coach_id NULL = aliment GLOBAL SETH (écriture administrateur uniquement) ; owner_coach_id renseigné = aliment PRIVÉ d''un coach, strictement isolé. Macros pour 100 unités nutritionnelles. AUCUNE colonne de calories : l''énergie reste dérivée du 4/4/9, jamais stockée.';
comment on column public.food_catalog.owner_coach_id is
  'NULL = aliment global SETH. Un coach ne peut JAMAIS modifier un aliment global ni s''approprier celui d''un autre coach : la policy exige owner_coach_id = current_coach_id().';
comment on column public.food_catalog.slug is
  'Colonne GÉNÉRÉE depuis name par public.food_slug(). Elle ne peut pas être désynchronisée, contrairement à une valeur calculée côté application. Unique par espace de noms : globalement pour les aliments SETH, par coach pour les aliments privés.';
comment on column public.food_catalog.nutrition_unit is
  'Unité des macros : g ou ml. Les colonnes _per_100 valent donc « pour 100 g » ou « pour 100 ml ». Le vocabulaire s''étend par MIGRATION, jamais par saisie.';
comment on column public.food_catalog.piece_weight_g is
  'Poids d''UNE pièce en grammes — 1 banane ≈ 120. NULL = cet aliment ne se compte pas en pièces (riz, huile…), et ce n''est pas une lacune. AUCUN code d''ALIMENTS A1 ne lit cette colonne : elle prépare la conversion pièce → grammes du lot qui livrera la saisie élève, et elle est posée maintenant parce qu''une colonne nullable sur une table vide ne coûte rien, contrairement à une migration de plus sur une table peuplée.';
comment on column public.food_catalog.protein_per_100 is
  'Protéines pour 100 unités nutritionnelles. Aucune colonne de calories n''existe : kcal = 4·protéines + 4·glucides + 9·lipides, calculé à la lecture.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. `food_aliases` — les autres noms du même aliment
-- ────────────────────────────────────────────────────────────────────────────
-- La recherche de ce lot est une ÉGALITÉ sur `alias_normalise`, servie par un
-- index btree. Pas de similarité, pas de distance d'édition : `pg_trgm` n'est
-- pas installée et A1 ne livre aucun écran de recherche. Le jour où le flou
-- sera nécessaire, il viendra avec l'écran qui l'exige — et la décision
-- d'installer l'extension sera prise là, avec un usage réel en face.
create table if not exists public.food_aliases (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.food_catalog (id) on delete cascade,
  alias text not null,
  alias_normalise text generated always as (public.food_slug(alias)) stored,
  created_at timestamptz not null default now(),

  constraint food_aliases_alias_not_blank
    check (length(btrim(alias)) > 0),
  constraint food_aliases_normalise_not_empty
    check (alias_normalise is not null),
  -- Deux graphies qui se normalisent pareil (« Fromage blanc 0% » et
  -- « fromage-blanc 0 % ») sont le MÊME alias : la contrainte porte donc sur
  -- la forme normalisée, jamais sur la saisie.
  constraint food_aliases_unique_par_aliment
    unique (food_id, alias_normalise)
);

create index if not exists food_aliases_normalise_idx
  on public.food_aliases (alias_normalise);

comment on table public.food_aliases is
  'Autres noms d''un aliment du catalogue. La visibilité est HÉRITÉE de food_catalog : les policies interrogent la table parente, elle-même sous RLS, donc un alias d''un aliment invisible est invisible. Recherche par ÉGALITÉ sur alias_normalise (index btree) : aucune recherche floue dans ce lot, aucune extension installée.';
comment on column public.food_aliases.alias_normalise is
  'Colonne GÉNÉRÉE par public.food_slug(alias). Deux aliments DIFFÉRENTS peuvent porter le même alias normalisé — ce n''est pas interdit ici. La règle de résolution (privé du coach prioritaire sur global) est APPLICATIVE et appartient au lot qui livrera la recherche.';

-- ────────────────────────────────────────────────────────────────────────────
-- E. `meal_entries` — la consommation réelle
-- ────────────────────────────────────────────────────────────────────────────
-- DISTINCTE de `meals`. `meals` est la PRESCRIPTION du coach, attachée à un
-- `nutrition_day` d'un plan, en texte libre. `meal_entries` est ce que
-- l'élève a RÉELLEMENT mangé, chiffré, attaché à l'élève et à une date.
--
-- AUCUN `nutrition_plan_id`. C'est le point qui distingue cette table de
-- `nutrition_daily_logs`, dont la colonne `nutrition_plan_id` est NOT NULL :
-- là-bas, un élève sans plan assigné ne peut RIEN enregistrer. Ici, on mange
-- qu'un plan existe ou non.
--
-- ────────────────────────────────────────────────────────────────────────
-- L'INSTANTANÉ EST INDÉPENDANT DE SA SOURCE — CE N'EST PAS UNE LIGNE FIGÉE
-- ────────────────────────────────────────────────────────────────────────
-- `label`, `quantity`, `unit`, `protein_g`, `carb_g` et `fat_g` sont STOCKÉS,
-- jamais dérivés à la lecture. C'est là, et seulement là, que se joue le gel :
--
--   lundi     l'élève enregistre « Banane, 120 g » → macros écrites en dur ;
--   vendredi  le coach corrige les macros de « Banane » dans food_catalog ;
--   résultat  l'entrée de lundi est STRICTEMENT inchangée.
--
-- Aucune jointure, aucune vue, aucun trigger ne va rechercher la valeur
-- courante de l'aliment. Les clés étrangères sont en `on delete set null` :
-- même supprimé du référentiel, l'aliment laisse la ligne consommée exacte.
--
-- CE QUI RESTE PERMIS, ET QUI DOIT L'ÊTRE : l'élève corrige sa propre saisie.
-- « 120 g » au lieu de « 150 g » se répare par un UPDATE, pas par une
-- suppression suivie d'une nouvelle recherche. L'application recalcule alors
-- VOLONTAIREMENT les macros depuis la source au moment de la correction, et
-- écrit le nouvel instantané — qui redevient aussitôt indépendant des
-- changements futurs.
--
-- Une première version de cette migration posait un trigger qui refusait
-- toute modification de ces six colonnes. Il confondait deux règles : « la
-- ligne ne suit pas sa source » (voulue) et « la ligne ne bouge jamais »
-- (non voulue, et mauvaise UX). Il a été retiré.
--
-- ────────────────────────────────────────────────────────────────────────
-- CE QUE LE SCHÉMA NE GARANTIT PAS, ET POURQUOI C'EST ASSUMÉ ICI
-- ────────────────────────────────────────────────────────────────────────
-- La base ne vérifie pas que `protein_g` corresponde à `quantity` × les
-- macros de `food_id`. Elle ne le peut pas : une contrainte CHECK ne fait
-- pas de sous-requête. Le point important est que ce n'est PAS une
-- régression introduite par l'UPDATE — l'INSERT présentait exactement la
-- même liberté depuis le début. Autoriser la correction n'ouvre aucune porte
-- que la création ne laissait pas déjà ouverte.
--
-- La cohérence appartient donc au chemin d'écriture, et c'est le lot A2 qui
-- le livrera : une RPC `security definer` qui reçoit (food_id, quantity,
-- unit) et CALCULE les macros côté serveur, plutôt que de les recevoir. Le
-- client cesse alors de pouvoir les fabriquer, pour l'UPDATE comme pour
-- l'INSERT. Le schéma posé ici ne l'empêche en rien — c'est sa seule
-- obligation à ce stade.
create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.students (id) on delete cascade,
  consumed_on date not null,

  -- Créneau v2, ou NULL pour une consommation hors créneau (grignotage,
  -- saisie rétroactive). Aligné sur MEAL_SLOT_KEYS de
  -- lib/nutrition/meal-distribution.ts, comme nutrition_recipes.slot_key.
  slot_key text,

  source_type text not null,

  -- Pointeurs de PROVENANCE, jamais d'autorité. `set null` : la source peut
  -- disparaître, l'instantané reste.
  recipe_id uuid references public.nutrition_recipes (id) on delete set null,
  food_id uuid references public.food_catalog (id) on delete set null,

  -- ── L'INSTANTANÉ, GELÉ ────────────────────────────────────────────────
  label text not null,
  quantity numeric not null,
  unit text not null,
  protein_g numeric not null,
  carb_g numeric not null,
  fat_g numeric not null,
  -- ──────────────────────────────────────────────────────────────────────

  note text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meal_entries_label_not_blank
    check (length(btrim(label)) > 0),
  constraint meal_entries_quantity_positive
    check (quantity > 0),
  constraint meal_entries_macros_non_negative
    check (protein_g >= 0 and carb_g >= 0 and fat_g >= 0),
  constraint meal_entries_unit_check
    check (unit in ('g', 'ml', 'piece', 'portion')),
  constraint meal_entries_slot_key_check
    check (slot_key is null or slot_key in
      ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert')),

  -- Le vocabulaire complet est déclaré MAINTENANT : `product` existera au
  -- lot produits, et l'écrire ici évite une migration de contrainte le jour
  -- où la table arrive.
  constraint meal_entries_source_type_check
    check (source_type in ('recipe', 'catalog_food', 'product', 'free')),

  -- ── ÉTATS IMPOSSIBLES ─────────────────────────────────────────────────
  -- Contrainte écrite dans le SENS QUI SURVIT à `on delete set null` : on
  -- interdit un pointeur INCOHÉRENT avec le type de source, on n'EXIGE pas
  -- un pointeur présent. Écrire « source_type = 'recipe' ⇒ recipe_id not
  -- null » rendrait impossible la suppression d'une recette : la mise à NULL
  -- violerait la contrainte et la transaction échouerait. L'instantané reste
  -- l'autorité, le pointeur reste facultatif.
  constraint meal_entries_recipe_id_coherent
    check (recipe_id is null or source_type = 'recipe'),
  constraint meal_entries_food_id_coherent
    check (food_id is null or source_type = 'catalog_food'),
  -- Corollaire structurel : jamais deux provenances à la fois. Redondant
  -- avec les deux contraintes ci-dessus (un source_type unique), écrit quand
  -- même pour que l'invariant survive à une future valeur de vocabulaire.
  constraint meal_entries_source_unique
    check (recipe_id is null or food_id is null)
);

create index if not exists meal_entries_student_date_idx
  on public.meal_entries (student_id, consumed_on);

create index if not exists meal_entries_food_id_idx
  on public.meal_entries (food_id) where food_id is not null;

create index if not exists meal_entries_recipe_id_idx
  on public.meal_entries (recipe_id) where recipe_id is not null;

comment on table public.meal_entries is
  'Consommation RÉELLE d''un élève, aliment par aliment. Distincte de `meals` (prescription du coach, texte libre) et de `nutrition_daily_logs` (quatre nombres par jour, qui EXIGE un plan assigné). Aucun nutrition_plan_id ici : on mange qu''un plan existe ou non. label / quantity / unit / protein_g / carb_g / fat_g forment un INSTANTANÉ INDÉPENDANT DE SA SOURCE : corriger ou supprimer l''aliment d''origine ne réécrit JAMAIS une entrée existante. L''élève garde en revanche le droit de corriger sa propre saisie par UPDATE — l''application recalcule alors les macros depuis la source et écrit un nouvel instantané, lui-même indépendant de la suite.';
comment on column public.meal_entries.source_type is
  'Provenance : recipe | catalog_food | product | free. `product` est déclaré d''avance mais sans contrainte associée : food_products n''existe pas encore, et une contrainte qui référence le vide serait fausse le jour où la table arrive.';
comment on column public.meal_entries.food_id is
  'Pointeur de PROVENANCE vers food_catalog, jamais d''autorité. on delete set null : l''aliment peut disparaître du référentiel, la ligne consommée reste exacte.';
comment on column public.meal_entries.quantity is
  'Quantité consommée, dans `unit`. Modifiable par son propriétaire : une correction de saisie passe par UPDATE, et l''application recalcule les macros depuis la source dans la même opération. Ce qui est gelé, c''est le lien vers la source — pas la ligne.';
comment on constraint meal_entries_recipe_id_coherent on public.meal_entries is
  'État impossible interdit dans le sens qui SURVIT à on delete set null : un pointeur incohérent avec source_type est refusé, mais un pointeur absent est toléré. L''implication inverse rendrait la suppression d''une recette impossible.';

-- ── AUCUN trigger de gel : le nettoyage d'une version précédente ──────────
-- Une première rédaction posait `meal_entries_freeze_snapshot()`, un trigger
-- BEFORE UPDATE qui refusait toute modification des six colonnes de
-- l'instantané. Il est retiré, et le `drop` ci-dessous existe pour que la
-- migration soit correcte même rejouée sur une base où il aurait été posé.
-- La règle du gel porte sur la SOURCE, jamais sur la ligne : voir l'en-tête
-- de la section E.
drop trigger if exists meal_entries_freeze_snapshot on public.meal_entries;
drop function if exists public.meal_entries_freeze_snapshot();

-- ────────────────────────────────────────────────────────────────────────────
-- F. Sécurité — RLS stricte, gabarit v2, correctif TRUNCATE
-- ────────────────────────────────────────────────────────────────────────────
alter table public.food_catalog enable row level security;
alter table public.food_aliases enable row level security;
alter table public.meal_entries enable row level security;

-- ── food_catalog ──────────────────────────────────────────────────────────
-- Lecture du GLOBAL : tout compte authentifié. C'est le référentiel SETH,
-- il n'a pas de secret — mais il n'est pas public pour autant, d'où le
-- `to authenticated` (voir l'en-tête).
drop policy if exists "food_catalog_select_global" on public.food_catalog;
create policy "food_catalog_select_global" on public.food_catalog
  for select to authenticated
  using (owner_coach_id is null);

-- Aliment PRIVÉ : son propriétaire, et lui seul, en lecture comme en
-- écriture. `current_coach_id()` vaut NULL pour un élève et pour un
-- administrateur sans fiche coach : le prédicat est alors faux, jamais vrai.
drop policy if exists "food_catalog_manage_own_coach" on public.food_catalog;
create policy "food_catalog_manage_own_coach" on public.food_catalog
  for all to authenticated
  using      (owner_coach_id is not null and owner_coach_id = public.current_coach_id())
  with check (owner_coach_id is not null and owner_coach_id = public.current_coach_id());

-- Administrateur : tout, y compris le catalogue global. C'est le SEUL
-- chemin d'écriture du global — un coach qui tenterait d'insérer une ligne
-- avec owner_coach_id NULL échoue sur le `with check` ci-dessus, et l'élève
-- n'a aucune policy d'écriture du tout.
drop policy if exists "food_catalog_manage_admin" on public.food_catalog;
create policy "food_catalog_manage_admin" on public.food_catalog
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── food_aliases ──────────────────────────────────────────────────────────
-- La visibilité est HÉRITÉE : les sous-requêtes ci-dessous portent sur
-- `food_catalog`, elle-même sous RLS et évaluée en `invoker`. Un alias dont
-- l'aliment est invisible est donc invisible, sans avoir à redire la règle.
drop policy if exists "food_aliases_select_visible" on public.food_aliases;
create policy "food_aliases_select_visible" on public.food_aliases
  for select to authenticated
  using (exists (select 1 from public.food_catalog f where f.id = food_aliases.food_id));

drop policy if exists "food_aliases_manage_own_coach" on public.food_aliases;
create policy "food_aliases_manage_own_coach" on public.food_aliases
  for all to authenticated
  using (exists (
    select 1 from public.food_catalog f
     where f.id = food_aliases.food_id
       and f.owner_coach_id is not null
       and f.owner_coach_id = public.current_coach_id()))
  with check (exists (
    select 1 from public.food_catalog f
     where f.id = food_aliases.food_id
       and f.owner_coach_id is not null
       and f.owner_coach_id = public.current_coach_id()));

drop policy if exists "food_aliases_manage_admin" on public.food_aliases;
create policy "food_aliases_manage_admin" on public.food_aliases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── meal_entries ──────────────────────────────────────────────────────────
-- L'élève : CRUD complet, sur ses entrées, et rien d'autre.
drop policy if exists "meal_entries_crud_own_student" on public.meal_entries;
create policy "meal_entries_crud_own_student" on public.meal_entries
  for all to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

-- Le coach : LECTURE SEULE, et seulement de SES élèves rattachés.
-- Pas de policy d'écriture : un journal alimentaire est la parole de l'élève.
drop policy if exists "meal_entries_select_own_coach" on public.meal_entries;
create policy "meal_entries_select_own_coach" on public.meal_entries
  for select to authenticated
  using (public.is_coach_of_student(student_id));

-- L'administrateur : accès global, selon la convention du schéma.
drop policy if exists "meal_entries_manage_admin" on public.meal_entries;
create policy "meal_entries_manage_admin" on public.meal_entries
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Privilèges ────────────────────────────────────────────────────────────
-- `revoke all … from authenticated` PRÉCÈDE le grant : sans lui, les
-- privilèges par défaut de Supabase laisseraient TRUNCATE — qui contourne la
-- RLS — à tout compte authentifié. Même correctif qu'en 20260807090000.
revoke all on table public.food_catalog from public;
revoke all on table public.food_catalog from anon;
revoke all on table public.food_catalog from authenticated;
revoke all on table public.food_aliases from public;
revoke all on table public.food_aliases from anon;
revoke all on table public.food_aliases from authenticated;
revoke all on table public.meal_entries from public;
revoke all on table public.meal_entries from anon;
revoke all on table public.meal_entries from authenticated;

grant select, insert, update, delete on table public.food_catalog to authenticated;
grant select, insert, update, delete on table public.food_aliases to authenticated;
grant select, insert, update, delete on table public.meal_entries to authenticated;

grant all on table public.food_catalog to service_role;
grant all on table public.food_aliases to service_role;
grant all on table public.meal_entries to service_role;

-- ── `updated_at` : même déclencheur que partout ailleurs ──────────────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.food_catalog';
    execute 'create trigger set_updated_at before update on public.food_catalog
             for each row execute function public.set_updated_at()';
    execute 'drop trigger if exists set_updated_at on public.meal_entries';
    execute 'create trigger set_updated_at before update on public.meal_entries
             for each row execute function public.set_updated_at()';
  end if;
end $$;
