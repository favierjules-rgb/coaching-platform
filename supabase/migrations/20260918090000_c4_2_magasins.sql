-- ============================================================================
-- Migration 20260918090000 — COURSES C4.2 : LE MODÈLE DU MAGASIN,
-- ET LE MAGASIN CHOISI PAR L'ÉLÈVE.
--
-- ⚠️ CET HORODATAGE EST UN COMPTEUR D'ORDRE, PAS UNE DATE. `supabase db push`
-- applique les fichiers dans l'ORDRE LEXICOGRAPHIQUE de leur nom : `20260918…`
-- suit `20260917…` (C4.1) pour cette seule raison. Le dépôt porte déjà vingt
-- migrations « dans le futur ». Renommer pour « corriger la date » casserait
-- l'ordre d'application et donc la reconstruction d'une base neuve.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION AJOUTE, ET RIEN D'AUTRE
-- ────────────────────────────────────────────────────────────────────────────
-- DEUX tables, et deux seulement :
--
--   `stores`                  le référentiel canonique LOCAL et MINIMAL des
--                             magasins physiques. Un miroir d'IDENTITÉ, pas
--                             une copie d'Open Prices ;
--   `student_selected_store`  « cet élève a actuellement choisi ce magasin ».
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ CE QUE CETTE MIGRATION NE CONTIENT PAS, ET POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUN montant, AUCUNE monnaie, AUCUNE remise. Un relevé daté appartient
--     à C4.4, dans sa propre table, avec le magasin dans sa clé ;
--
--   - AUCUNE notion de disponibilité, de stock ou d'inventaire. Ce n'est pas
--     un report : la donnée N'EXISTE PAS. Audit du 17/08/2026 sur les quatre
--     modèles du backend Open Prices (Location 23 champs, Price 28, Proof 26,
--     Product 26) et sur son API.md : zéro occurrence. Open Prices publie des
--     OBSERVATIONS DE PRIX DATÉES — un fait au passé — jamais un état de
--     rayon au présent. En dériver une disponibilité (« il y a un relevé
--     récent, donc c'est en stock ») reviendrait à inventer une donnée et à
--     l'afficher avec l'aplomb d'un fait ;
--
--   - AUCUN compteur de relevés. Il sert à CLASSER des résultats de recherche,
--     pas à décrire un magasin choisi : il appartient à la découverte (C4.3),
--     de façon transitoire ;
--
--   - AUCUNE colonne d'ordre, de favori, d'état actif ni d'historique. « Un
--     seul magasin » est ici une CLÉ PRIMAIRE, pas une règle applicative.
--     Le multi-magasins viendra avec la comparaison qui le justifie ;
--
--   - AUCUNE coordonnée d'ÉLÈVE, nulle part. La position d'une personne ne
--     s'écrit dans aucune table de ce dépôt. Les seules coordonnées ici sont
--     celles d'un commerce, c'est-à-dire d'un lieu public ;
--
--   - AUCUN appel réseau, AUCUNE synchronisation, AUCUNE tâche planifiée.
--     C4.2 ne parle à personne. La façon dont un magasin ENTRE réellement
--     dans `stores` est le sujet entier de C4.3a.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ── 1. LE RÉFÉRENTIEL CANONIQUE DES MAGASINS ──────────────────────────────
--
-- ⚠️ L'IDENTITÉ EST EMPRUNTÉE, JAMAIS FABRIQUÉE — c'est la décision centrale
-- de ce lot. Nous n'inventons ni slug, ni « nom normalisé », ni couple
-- (enseigne, ville). Deux clés naturelles cohabitent, et chacune répond à une
-- question différente :
--
--   `op_location_id`        l'identifiant d'Open Prices. C'est LUI que
--                           `GET /api/v1/prices?location_id=…` attend : sans
--                           lui, C4.4 n'a aucun moyen de demander les relevés
--                           d'un magasin ;
--   (`osm_type`, `osm_id`)  l'identité OpenStreetMap, c'est-à-dire l'identité
--                           de l'amont de l'amont. C'est la contrainte
--                           d'unicité que porte le modèle `Location`
--                           lui-même, et elle a son endpoint de résolution
--                           dédié. Si Open Prices fusionne un jour deux
--                           enregistrements en double, `op_location_id` peut
--                           changer ; le couple OSM, lui, ne bouge pas.
create table if not exists public.stores (
  -- Clé interne, et RIEN D'AUTRE : une cible de clé étrangère stable, qui ne
  -- dépend d'aucune décision d'un tiers. Ce n'est pas une identité.
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ `bigint`, PAS `integer`. Le modèle amont ne déclare pas sa clé primaire :
  -- elle est produite par `DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"`,
  -- c'est-à-dire un entier 64 bits. La rétrécir à 32 bits ici marcherait
  -- aujourd'hui — les identifiants observés sont de l'ordre du millier — et
  -- casserait le jour où l'amont dépasse 2 147 483 647, avec un débordement
  -- silencieux à l'insertion. Une identité empruntée se recopie à l'identique.
  op_location_id bigint not null unique,

  -- `NODE` | `WAY` | `RELATION` — les trois seules valeurs qu'OpenStreetMap
  -- connaisse, et celles que l'amont énumère. Bornées par un CHECK plutôt que
  -- par un type énuméré, comme partout ailleurs dans ce dépôt.
  osm_type text not null,
  -- `PositiveBigIntegerField` en amont : `bigint` ici, jamais `integer`. Les
  -- identifiants OSM ont dépassé la limite des entiers 32 bits.
  osm_id bigint not null,

  -- ── CE QUI SERT À RECONNAÎTRE LE MAGASIN À L'ÉCRAN ──────────────────────
  --
  -- ⚠️ AUCUNE de ces colonnes n'entre dans une contrainte d'identité, et c'est
  -- délibéré. L'enseigne est nulle pour beaucoup de commerces réels, et deux
  -- magasins d'une même enseigne dans une même ville sont DEUX magasins.
  -- Faire porter l'identité au nom fusionnerait deux commerces distincts.

  -- NOT NULL, alors que le champ amont est nullable : un magasin sans nom est
  -- inchoisissable, il n'a rien à afficher dans une liste. La contrainte
  -- énonce donc un périmètre — nous ne persistons que des magasins
  -- choisissables — et c'est à la découverte d'écarter les autres AVANT
  -- l'insertion, pas à l'écran de composer avec un trou.
  name text not null,
  brand text,
  city text,
  postcode text,
  country_code text,

  -- Les coordonnées DU COMMERCE, au format EXACT de l'amont
  -- (`DecimalField(max_digits=11, decimal_places=7)`). Un flottant
  -- réintroduirait une dérive binaire sur une donnée qui est, chez la source,
  -- décimale. Elles sont ici parce que la découverte les reçoit déjà et que
  -- les redemander coûterait un aller-retour réseau pour une donnée figée.
  lat numeric(11,7) not null,
  lon numeric(11,7) not null,

  -- Quand ce magasin est entré dans notre référentiel.
  --
  -- ⚠️ PAS de `updated_at`, et ce n'est pas un oubli. RIEN ne modifie une ligne
  -- de cette table en C4.2 : la colonne ne pourrait que mentir, en affichant
  -- une fraîcheur qu'aucune écriture n'a produite. C'est la synchronisation de
  -- C4.3 qui aura une date à écrire, et elle la posera elle-même.
  created_at timestamptz not null default now(),

  -- ── ÉTATS IMPOSSIBLES ────────────────────────────────────────────────────
  constraint stores_osm_identite_unique unique (osm_type, osm_id),
  constraint stores_osm_type_check
    check (osm_type in ('NODE', 'WAY', 'RELATION')),
  constraint stores_op_location_id_positif check (op_location_id > 0),
  constraint stores_osm_id_positif check (osm_id > 0),
  -- Un nom blanc serait un nom qu'on croit avoir.
  constraint stores_name_non_vide check (length(btrim(name)) > 0),
  constraint stores_country_code_iso
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint stores_lat_bornee check (lat >= -90 and lat <= 90),
  constraint stores_lon_bornee check (lon >= -180 and lon <= 180)
);


-- ── 2. LE MAGASIN CHOISI PAR L'ÉLÈVE ──────────────────────────────────────
--
-- ⚠️ LA CLÉ PRIMAIRE EST L'INVARIANT DU LOT. `student_id` SEUL en clé primaire
-- signifie « au plus un magasin par élève », et le dit à PostgreSQL plutôt
-- qu'à une relecture. Une clé composite `(student_id, store_id)` autoriserait
-- N lignes et obligerait à écrire du code défensif pour garantir qu'il n'y en
-- a qu'une : une contrainte ne s'oublie pas, un `if` si.
--
-- Changer de magasin n'est donc pas « ajouter » : c'est un `update`, ou un
-- `insert … on conflict (student_id) do update`. Il n'y a jamais deux lignes.
create table if not exists public.student_selected_store (
  -- `on delete cascade` — la donnée appartient à l'élève et part avec lui,
  -- exactement comme `shopping_lists`.
  student_id uuid primary key references public.students (id) on delete cascade,

  -- ⚠️ `on delete restrict`, et NON `cascade` ni `set null` : on ne supprime
  -- pas un magasin que quelqu'un a choisi. Un ménage de référentiel ne doit
  -- pas effacer silencieusement le choix d'un élève ; il doit échouer et se
  -- faire remarquer.
  store_id uuid not null references public.stores (id) on delete restrict,

  -- ⚠️ `updated_at`, ET C'EST LE TRIGGER DU DÉPÔT QUI L'ÉCRIT — pas le client.
  --
  -- Cette colonne s'appelait `selected_at` et prétendait, en commentaire, être
  -- « réécrite à chaque changement de magasin ». C'était FAUX : rien ne
  -- l'imposait. Un `update … set store_id = …` sans nommer la colonne laissait
  -- la vieille date en place, et les tests ne le voyaient pas parce qu'ils
  -- écrivaient eux-mêmes `selected_at = now()`. Une date dont la véracité
  -- dépend de la discipline de l'appelant est une date qui finira par mentir.
  --
  -- Le nom `updated_at` n'est pas cosmétique : `public.set_updated_at()`
  -- affecte littéralement `new.updated_at`. Utiliser le mécanisme du dépôt
  -- IMPOSE ce nom ; écrire un second `set_selected_at()` aurait dupliqué une
  -- fonction existante pour une seule table. Neuf tables portent déjà ce
  -- trigger (`food_products`, `food_catalog`, `consumed_meals`,
  -- `meal_entries`, `nutrition_recipes`, …).
  --
  -- Comme `store_id` est la SEULE colonne modifiable de cette table,
  -- « dernière modification » et « date du choix courant » sont ici la même
  -- chose — et cette équivalence est structurelle, pas une convention d'usage.
  updated_at timestamptz not null default now()
);

-- La colonne référençante d'une clé étrangère n'est pas indexée
-- automatiquement par PostgreSQL, et le `restrict` ci-dessus la parcourt à
-- chaque tentative de suppression d'un magasin.
create index if not exists student_selected_store_store_id_idx
  on public.student_selected_store (store_id);

-- ⚠️ LE TRIGGER EST LA MOITIÉ DE LA SERRURE TEMPORELLE, ET IL EST CELUI DU
-- DÉPÔT — installé par le gabarit gardé déjà employé par `food_products`,
-- `food_catalog`, `consumed_meals`, `nutrition_recipes` et cinq autres tables.
-- Aucune fonction n'est créée ici.
--
-- Il ne se contente pas de dispenser l'appelant d'y penser : comme il est
-- `before update` et qu'il ÉCRASE `new.updated_at`, une tentative de
-- falsification — `update … set updated_at = '2020-01-01'` — est réécrite à
-- `now()`. La date ne peut donc pas mentir, même écrite de mauvaise foi.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.student_selected_store';
    execute 'create trigger set_updated_at before update on public.student_selected_store
             for each row execute function public.set_updated_at()';
  end if;
end $$;


-- ── 3. RLS ET PRIVILÈGES — DEUX SERRURES DIFFÉRENTES ──────────────────────
--
-- Les deux tables sont protégées, mais PAS de la même façon, parce qu'elles ne
-- craignent pas la même chose :
--
--   `stores`                  n'est le secret de personne — un commerce est un
--                             lieu public. Ce qu'il ne faut pas, c'est qu'un
--                             navigateur puisse y ÉCRIRE : un élève capable
--                             d'insérer un magasin pourrait en fabriquer un
--                             faux et s'y rattacher ;
--   `student_selected_store`  est une donnée personnelle. Où quelqu'un fait
--                             ses courses ne regarde que lui.
alter table public.stores enable row level security;
alter table public.student_selected_store enable row level security;

-- ── 3a. `stores` : TOUT LE MONDE LIT, PERSONNE N'ÉCRIT ────────────────────
--
-- ⚠️ MÊME DOCTRINE QUE `food_products` (migration 20260903090000), et pour la
-- même raison : une policy dit quelles LIGNES sont visibles, jamais quelles
-- VALEURS peuvent être écrites. C'est le PRIVILÈGE qui ferme l'écriture, et
-- son refus tombe AVANT toute évaluation de policy. Aucune capacité neuve
-- n'est inventée : le remplissage passera par le serveur avec `service_role`,
-- c'est-à-dire par le chemin qui existe déjà pour les référentiels externes.
drop policy if exists "stores_select_authenticated" on public.stores;
create policy "stores_select_authenticated" on public.stores
  for select to authenticated
  using (true);

-- L'ordre compte : `revoke all` PRÉCÈDE le grant, sinon un privilège hérité du
-- rôle `public` survivrait au durcissement.
revoke all on table public.stores from public;
revoke all on table public.stores from anon;
revoke all on table public.stores from authenticated;

-- SELECT SEUL. La liste est exhaustive à dessein : pas d'insert, pas d'update,
-- pas de delete, pas même pour un administrateur — le référentiel se remplit
-- depuis le serveur, jamais depuis un navigateur.
grant select on table public.stores to authenticated;
grant all on table public.stores to service_role;

-- ── 3b. `student_selected_store` : L'ÉLÈVE, ET PERSONNE D'AUTRE ───────────
--
-- ⚠️ `public.current_student_id()` ET RIEN D'AUTRE. C'est le helper unique du
-- projet (`food_favorites`, `planned_meals`, `consumed_meals`,
-- `shopping_lists`). Aucune seconde logique d'identité n'est introduite.
--
-- ⚠️ AUCUNE POLICY POUR LE COACH, exactement comme `shopping_lists`, et pour
-- le même motif : le lieu où un élève fait ses courses n'est pas un fait
-- d'entraînement. Ce que le coach doit suivre, `consumed_meals` le lui donne
-- déjà. Une policy de lecture s'ajoute en une ligne le jour où elle sera
-- voulue ; retirer une exposition déjà en production est une correction.
drop policy if exists "student_selected_store_select_own_student"
  on public.student_selected_store;
create policy "student_selected_store_select_own_student"
  on public.student_selected_store
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "student_selected_store_insert_own_student"
  on public.student_selected_store;
create policy "student_selected_store_insert_own_student"
  on public.student_selected_store
  for insert to authenticated
  with check (student_id = public.current_student_id());

-- Changer de magasin est un `update` de la ligne existante : c'est le geste
-- courant de cet écran, et le `with check` interdit de le détourner pour
-- écrire dans la ligne de quelqu'un d'autre.
drop policy if exists "student_selected_store_update_own_student"
  on public.student_selected_store;
create policy "student_selected_store_update_own_student"
  on public.student_selected_store
  for update to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

drop policy if exists "student_selected_store_delete_own_student"
  on public.student_selected_store;
create policy "student_selected_store_delete_own_student"
  on public.student_selected_store
  for delete to authenticated
  using (student_id = public.current_student_id());

-- La capacité d'administration EXISTE DÉJÀ dans le dépôt et sert ici telle
-- quelle — aucune n'est créée pour l'occasion.
drop policy if exists "student_selected_store_manage_admin"
  on public.student_selected_store;
create policy "student_selected_store_manage_admin"
  on public.student_selected_store
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.student_selected_store from public;
revoke all on table public.student_selected_store from anon;
revoke all on table public.student_selected_store from authenticated;

-- ⚠️ LE GRANT DE COLONNE PORTE SUR L'INSERT **ET** SUR L'UPDATE — la doctrine
-- de `grant update (checked)` de C2 et `grant update (budget_cents)` de C3,
-- appliquée aux DEUX verbes d'écriture.
--
-- Restreindre le seul `update` ne suffisait pas, et c'était un vrai trou :
-- `grant insert` au niveau de la TABLE autorise l'écriture de TOUTES les
-- colonnes. Un élève pouvait donc poser lui-même la date à l'insertion —
-- `insert … (student_id, store_id, updated_at) values (…, '2000-01-01')` —
-- sur SA propre ligne, donc sans jamais heurter la RLS. Le trigger ne
-- l'attrapait pas non plus : il est `before UPDATE`, il ne voit pas les
-- insertions. L'invariant « la date vient de la base » était vrai à la mise à
-- jour et faux à la création.
--
-- Nommer les colonnes ferme la porte au bon endroit : `updated_at` n'est
-- accordée à `authenticated` NI en insertion NI en modification, donc sa seule
-- provenance possible pour un client est le DEFAULT, puis le trigger. Une
-- policy ne sait pas parler de colonnes ; un privilège, si.
grant select, delete       on table public.student_selected_store to authenticated;
grant insert (student_id, store_id) on table public.student_selected_store to authenticated;
grant update (store_id)    on table public.student_selected_store to authenticated;

-- `service_role` garde `grant all`, et c'est normal : c'est le rôle serveur de
-- confiance, celui des routes d'administration et des tâches de maintenance.
-- L'invariant que ce lot défend porte sur le CLIENT, pas sur lui.
grant all on table public.student_selected_store to service_role;


-- ── 4. DOCUMENTATION EN BASE ──────────────────────────────────────────────
comment on table public.stores is
  'COURSES C4.2 — référentiel canonique LOCAL et MINIMAL des magasins physiques. Miroir d''IDENTITÉ, jamais une copie du référentiel amont : on ne persiste que ce qui identifie et ce qui permet de reconnaître un magasin à l''écran. Ne contient AUCUN montant, AUCUNE remise, AUCUN compteur de relevés et AUCUNE notion de disponibilité — cette dernière n''existe tout simplement pas chez la source, qui publie des observations datées et non un état de rayon. Écriture réservée à service_role.';
comment on column public.stores.id is
  'Clé interne, et rien d''autre : une cible de clé étrangère stable qui ne dépend d''aucune décision d''un tiers. Ce n''est PAS une identité.';
comment on column public.stores.op_location_id is
  'Identifiant du lieu chez Open Prices. C''est lui qu''attend la lecture des relevés par magasin : sans lui, le lot des prix n''aurait aucun moyen d''interroger la source. ⚠️ `bigint` et non `integer` : la clé primaire amont est un BigAutoField, donc 64 bits. Rétrécir une identité empruntée est un débordement en attente.';
comment on column public.stores.osm_type is
  '''NODE'' | ''WAY'' | ''RELATION'' — les trois seules valeurs d''OpenStreetMap, telles que la source les énumère.';
comment on column public.stores.osm_id is
  'Identifiant OpenStreetMap. `bigint` et non `integer` : ces identifiants ont dépassé la limite des entiers 32 bits. Avec osm_type, il forme l''identité de l''amont de l''amont — celle qui survit à une fusion d''enregistrements en double chez la source.';
comment on column public.stores.name is
  'Le nom affiché, repris de la source. NOT NULL alors que la source l''autorise vide : un magasin sans nom est inchoisissable. C''est à la découverte d''écarter ces cas AVANT insertion.';
comment on column public.stores.brand is
  'L''enseigne, quand la source la connaît — souvent NULL, y compris pour de vrais commerces. ⚠️ N''entre dans AUCUNE contrainte d''identité : deux magasins d''une même enseigne dans une même ville sont DEUX magasins.';
comment on column public.stores.lat is
  'Latitude DU COMMERCE — un lieu public. Format identique à celui de la source, decimal et non flottant. ⚠️ Aucune coordonnée d''utilisateur n''est stockée ici, ni dans aucune autre table de ce dépôt.';
comment on column public.stores.lon is
  'Longitude DU COMMERCE. Voir la remarque de la colonne précédente.';
comment on column public.stores.created_at is
  'Entrée dans notre référentiel. Il n''y a délibérément pas de colonne de mise à jour : rien ne modifie une ligne à ce stade, et une telle colonne ne pourrait qu''afficher une fraîcheur qu''aucune écriture n''a produite.';

comment on table public.student_selected_store is
  'COURSES C4.2 — « cet élève a actuellement choisi ce magasin ». ⚠️ La clé primaire est l''élève SEUL : « au plus un magasin actif » est une contrainte de base de données, pas une règle applicative. Changer de magasin est une mise à jour de la ligne, jamais un ajout. Aucun ordre, aucun favori, aucun historique : tout cela appartiendrait à la comparaison entre magasins, qui n''existe pas encore.';
comment on column public.student_selected_store.student_id is
  'L''élève, et la clé primaire. `on delete cascade` : la donnée lui appartient et part avec lui.';
comment on column public.student_selected_store.store_id is
  'Le magasin choisi. `on delete restrict` : on ne supprime pas un magasin que quelqu''un a choisi — un ménage de référentiel doit échouer bruyamment plutôt qu''effacer un choix en silence.';
comment on column public.student_selected_store.updated_at is
  'Date du choix courant. ⚠️ L''INVARIANT PORTE SUR LE CLIENT : un rôle `authenticated` ne peut pas fabriquer cette date. À l''INSERT, ses privilèges de colonne ne couvrent que `student_id` et `store_id` — la valeur vient donc obligatoirement du DEFAULT `now()`. À l''UPDATE, ils ne couvrent que `store_id`, et c''est le trigger `set_updated_at` du dépôt qui réécrit la date. Comme `store_id` est la seule colonne qu''un client puisse modifier, « dernière modification » et « date du choix » sont ici la même chose. `service_role`, rôle serveur de confiance, conserve `grant all` : l''invariant ne prétend rien sur lui.';
