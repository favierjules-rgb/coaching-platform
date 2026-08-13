-- ═══════════════════════════════════════════════════════════════════════════
-- ALIMENTS A5 — LES FAVORIS D'UN ÉLÈVE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE TABLE, ALORS QUE LES RÉCENTS N'EN ONT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- Un récent est un FAIT déjà écrit : il se déduit du journal. Un favori est une
-- INTENTION, que rien n'écrit ailleurs — « je mange ça souvent, garde-le sous la
-- main ». Elle doit survivre à la fermeture de l'application et suivre l'élève
-- d'un appareil à l'autre : `localStorage` la perdrait au premier changement de
-- téléphone, et la rendrait invisible depuis l'ordinateur.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'UN FAVORI N'EST PAS
-- ────────────────────────────────────────────────────────────────────────────
-- Ce n'est pas un instantané. Contrairement à `meal_entries`, un favori ne fige
-- aucune macro : il POINTE vers une source vivante, et c'est tout l'intérêt —
-- si la fiche produit est corrigée, le favori mènera à la fiche corrigée.
--
-- C'est la raison du `on delete cascade` ci-dessous, exactement inverse du
-- `on delete set null` d'A1/A3 : une entrée de journal doit SURVIVRE à la
-- disparition de sa source, sinon on réécrit l'histoire ; un raccourci vers une
-- source disparue ne mène plus nulle part, et le garder violerait d'ailleurs la
-- contrainte de cible unique.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.food_favorites (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.students (id) on delete cascade,

  -- LES DEUX CIBLES POSSIBLES, et exactement une par ligne.
  --
  -- Les aliments SAISIS À LA MAIN (`source_type = 'free'`) n'ont délibérément
  -- pas de cible ici : ils n'ont pas d'identité stable — deux « Sandwich
  -- maison » saisis à deux semaines d'intervalle sont deux textes libres, pas
  -- deux occurrences du même aliment. Les mettre en favori demanderait de
  -- recopier leurs macros, c'est-à-dire de créer un second catalogue privé.
  -- C'est un chantier, pas une case à cocher.
  catalog_food_id uuid references public.food_catalog (id) on delete cascade,
  product_id      uuid references public.food_products (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- Écrite par COMPTAGE, comme `meal_entries_source_unique` en A3 : l'intention
  -- reste lisible le jour où une troisième cible arriverait, là où trois
  -- disjonctions devraient être relues entièrement.
  --
  -- `= 1` et non `<= 1` : ici, contrairement à `meal_entries`, un favori SANS
  -- cible n'a aucun sens. L'instantané d'A1 pouvait perdre son pointeur et
  -- rester valide ; un raccourci sans destination, non.
  constraint food_favorites_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id is null then 0 else 1 end) = 1
  )
);

-- ────────────────────────────────────────────────────────────────────────────
-- UNICITÉ ÉLÈVE + CIBLE — DEUX INDEX PARTIELS, ET C'EST UNE DÉCISION
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ LE PIÈGE ÉVITÉ ICI EST SILENCIEUX. La forme naturelle serait :
--
--     create unique index on food_favorites (student_id, catalog_food_id, product_id);
--
-- Elle ne marcherait PAS. En SQL, NULL n'est jamais égal à NULL : deux lignes
-- (élève, banane, NULL) sont considérées comme DIFFÉRENTES par un index unique,
-- et l'élève pourrait mettre la banane en favori autant de fois qu'il tape sur
-- l'étoile. Rien ne le signalerait — ni erreur, ni doublon visible avant
-- l'affichage de la liste.
--
-- Deux index PARTIELS n'ont pas ce défaut : chacun ne voit que les lignes dont
-- sa colonne est renseignée, et compare donc deux valeurs réelles.
--
-- (PostgreSQL 15 offre `nulls not distinct`, mais il faudrait alors se reposer
-- sur une option dont l'oubli, dans une future migration, réintroduirait le
-- trou. Deux index partiels disent la règle sans dépendre d'un réglage.)
create unique index if not exists food_favorites_food_unique
  on public.food_favorites (student_id, catalog_food_id)
  where catalog_food_id is not null;

create unique index if not exists food_favorites_product_unique
  on public.food_favorites (student_id, product_id)
  where product_id is not null;

-- L'unique requête de lecture de l'écran : « mes favoris, les plus récents
-- d'abord ». Deux colonnes, dans l'ordre où elles sont utilisées.
create index if not exists food_favorites_student_idx
  on public.food_favorites (student_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — L'ÉLÈVE, ET PERSONNE D'AUTRE
-- ────────────────────────────────────────────────────────────────────────────
alter table public.food_favorites enable row level security;

drop policy if exists "food_favorites_crud_own_student" on public.food_favorites;
create policy "food_favorites_crud_own_student" on public.food_favorites
  for all to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

drop policy if exists "food_favorites_manage_admin" on public.food_favorites;
create policy "food_favorites_manage_admin" on public.food_favorites
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ⚠️ AUCUNE POLICY COACH, ET C'EST DÉLIBÉRÉ.
--
-- Le coach n'a pas besoin de MODIFIER les favoris de son élève — c'était la
-- demande. Il n'a pas besoin de les LIRE non plus : un favori est une
-- préférence personnelle, pas une donnée de suivi. Ce que le coach doit voir,
-- c'est ce qui a été mangé, et `meal_entries` le lui donne déjà.
--
-- Une policy de lecture s'ajoute en une ligne le jour où elle sera voulue.
-- L'inverse — retirer une exposition déjà en production — est une correction,
-- pas un ajout.

-- ────────────────────────────────────────────────────────────────────────────
-- PRIVILÈGES — PAS D'UPDATE, ET CE N'EST PAS UN OUBLI
-- ────────────────────────────────────────────────────────────────────────────
-- Une policy dit quelles LIGNES sont visibles, jamais quelles VALEURS peuvent
-- être écrites. C'est le privilège qui décide du verbe.
--
-- Un favori s'AJOUTE et se RETIRE ; il n'a rien à modifier. Retirer `update` du
-- vocabulaire rend structurellement impossible qu'un jour une ligne soit
-- déplacée d'un élève à un autre par un simple `update student_id` — un chemin
-- que la policy `with check` bloquerait, mais qu'il vaut mieux ne pas ouvrir du
-- tout.
--
-- L'ordre compte : `revoke all` PRÉCÈDE les grants, sinon un privilège hérité
-- des réglages par défaut (dont TRUNCATE, qui contourne la RLS) survivrait.
revoke all on table public.food_favorites from public;
revoke all on table public.food_favorites from anon;
revoke all on table public.food_favorites from authenticated;

grant select, insert, delete on table public.food_favorites to authenticated;
grant all on table public.food_favorites to service_role;

comment on table public.food_favorites is
  'ALIMENTS A5 — les aliments qu''un élève garde sous la main. Exactement UNE cible par ligne : un aliment générique du catalogue, OU un produit commercial. Les aliments saisis à la main en sont volontairement exclus : ils n''ont pas d''identité stable. Un favori n''est PAS un instantané — il pointe vers une source vivante, d''où le `on delete cascade`, inverse du `on delete set null` de meal_entries. Aucun privilège UPDATE : un favori s''ajoute et se retire. Aucune policy coach : c''est une préférence personnelle, pas une donnée de suivi.';

comment on constraint food_favorites_cible_unique on public.food_favorites is
  'Exactement une cible, jamais zéro et jamais deux. Écrite par comptage pour rester lisible si une troisième cible arrivait. `= 1` et non `<= 1` : un raccourci sans destination n''a pas de sens, contrairement à un instantané qui a perdu son pointeur.';

comment on index public.food_favorites_food_unique is
  'Un aliment du catalogue ne peut être mis en favori qu''UNE fois par élève. Index PARTIEL et non composite à trois colonnes : en SQL, NULL n''est jamais égal à NULL, et un index (student_id, catalog_food_id, product_id) laisserait donc passer autant de doublons qu''on veut, silencieusement.';
