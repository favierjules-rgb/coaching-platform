-- ============================================================================
-- Migration 20260919090000 — COURSES C4.3c : OPENSTREETMAP DEVIENT L'ANNUAIRE.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE FAIT MESURÉ QUI JUSTIFIE CE LOT
-- ────────────────────────────────────────────────────────────────────────────
-- Mesuré le 19/08/2026 sur l'API de production Open Prices, ville de Toulon
-- (~180 000 habitants) :
--
--     GET /api/v1/locations?osm_address_city__like=Toulon
--                          &osm_address_country__like=France
--     → total = 2
--         · Relay      shop=newsagent    (écarté, à juste titre : pas alimentaire)
--         · Naturalia  shop=supermarket  (price_count = 1)
--
-- Un magasin, un relevé. Open Prices est une excellente source de PRIX ; ce
-- n'est pas un annuaire de magasins. C4.3a et C4.3b s'en servaient pourtant
-- comme tel, et un élève toulonnais ne pouvait donc choisir qu'un seul commerce.
--
-- La découverte passe désormais par OpenStreetMap, dont Open Prices recopie
-- déjà les identifiants. Open Prices reste la source de prix, atteinte par un
-- PONT EXACT — `GET /api/v1/locations/osm/{TYPE}/{ID}` — et ce pont devient
-- FACULTATIF.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION FAIT, ET RIEN D'AUTRE
-- ────────────────────────────────────────────────────────────────────────────
--   1. `op_location_id` devient NULLABLE ;
--   2. deux colonnes de métadonnées d'enseigne, nullables.
--
-- Aucune table. Aucune suppression. `student_selected_store` n'est pas touchée
-- — elle ne référence que `stores.id`, et n'a jamais connu `op_location_id`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ POURQUOI UN SEUL `ALTER` SUFFIT — VÉRIFIÉ SUR UN POSTGRESQL 16 RÉEL
-- ────────────────────────────────────────────────────────────────────────────
-- Une première rédaction voulait aussi refaire l'unicité et le CHECK. C'était
-- FAUX, et deux mesures l'ont montré. Définitions réellement déployées, lues
-- dans `pg_constraint` :
--
--     stores_op_location_id_key      UNIQUE (op_location_id)
--     stores_op_location_id_positif  CHECK  ((op_location_id > 0))
--
--   · L'unicité est un UNIQUE ORDINAIRE, pas `NULLS NOT DISTINCT`. PostgreSQL
--     y considère donc deux NULL comme DISTINCTS : plusieurs magasins sans pont
--     cohabitent sans collision. Mesuré : deux insertions à NULL passent, et
--     deux insertions au MÊME identifiant non nul sont toujours refusées
--     (« duplicate key value violates unique constraint »).
--
--   · Le CHECK accepte déjà NULL. `NULL > 0` vaut UNKNOWN, et un CHECK n'échoue
--     que sur FALSE — jamais sur UNKNOWN. Mesuré.
--
-- Dropper puis recréer l'un ou l'autre aurait été du bruit à haut risque sur
-- une table partagée : une fenêtre sans contrainte, un nom d'index à deviner,
-- et un rollback plus difficile. On ne touche donc qu'à ce qui doit changer.
--
-- ⚠️ ROLLBACK : re-poser `NOT NULL` exigera qu'AUCUN magasin sans pont
-- n'existe. Dès la première sélection d'un magasin OSM non couvert par Open
-- Prices, cette migration devient irréversible sans suppression de données.
-- C'est dit ici plutôt que découvert plus tard.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ── 1. LE PONT OPEN PRICES DEVIENT FACULTATIF ─────────────────────────────
--
-- ⚠️ C'EST LE CŒUR DU LOT, ET C'EST UNE LIGNE. `op_location_id` cesse d'être
-- l'identité du magasin pour redevenir ce qu'il est : un POINTEUR vers une
-- fiche Open Prices, quand elle existe.
--
-- L'identité canonique était déjà la bonne depuis C4.2 —
-- `stores_osm_identite_unique (osm_type, osm_id)` — et elle ne bouge pas.
alter table public.stores
  alter column op_location_id drop not null;

-- ── 2. L'IDENTITÉ D'ENSEIGNE, TELLE QU'OSM LA PUBLIE ──────────────────────
--
-- ⚠️ MÉTADONNÉES, PAS IDENTITÉ. Ces deux colonnes ne participent à AUCUNE
-- contrainte d'unicité, et c'est le point : plusieurs centaines de magasins
-- Lidl partagent `Q151954`. Une unicité ici interdirait le deuxième Lidl de
-- France.
--
-- ⚠️ POURQUOI WIKIDATA PLUTÔT QUE LE NOM. `brand:wikidata` est documenté par
-- OpenStreetMap comme l'identifiant STABLE d'une enseigne, justement pour
-- qu'un consommateur de données puisse reconnaître une chaîne « without
-- incorrectly branding other uses of "KFC" that have nothing to do with fried
-- chicken ». Comparer des noms — `name.includes("Lidl")` — marcherait sur les
-- exemples qu'on a sous les yeux et échouerait sur le reste du pays.
--
-- ⚠️ ET OPEN PRICES NE LES PUBLIE PAS. Sa fiche Location expose `osm_brand`
-- en texte libre, sans identifiant Wikidata. Ces colonnes ne peuvent donc être
-- remplies que par la découverte OSM — c'est une raison de plus pour que la
-- découverte y passe.
--
-- ⚠️ AUCUNE TABLE D'ENSEIGNE N'EST CRÉÉE, et aucun prix d'enseigne n'est
-- calculé. C4.3c PERSISTE de quoi rendre un repli enseigne possible un jour ;
-- il ne l'implémente pas, et rien ici ne le suppose.
alter table public.stores
  add column if not exists brand_wikidata text,
  add column if not exists operator_wikidata text;

-- ⚠️ FORME, PAS EXISTENCE. Un identifiant Wikidata est un `Q` suivi d'un entier
-- sans zéro de tête (`Q42`, `Q151954`). Nous validons cette FORME et rien de
-- plus : vérifier que l'item existe demanderait un appel réseau depuis une
-- contrainte, ce qu'aucune base ne doit faire. Une chaîne vide est refusée —
-- elle serait un identifiant qu'on croit avoir.
alter table public.stores
  add constraint stores_brand_wikidata_forme
    check (brand_wikidata is null or brand_wikidata ~ '^Q[1-9][0-9]*$'),
  add constraint stores_operator_wikidata_forme
    check (operator_wikidata is null or operator_wikidata ~ '^Q[1-9][0-9]*$');

-- ── 3. DOCUMENTATION EN BASE ──────────────────────────────────────────────
comment on column public.stores.op_location_id is
  'COURSES C4.3c — pointeur FACULTATIF vers la fiche Open Prices de ce magasin (`/api/v1/locations/osm/{type}/{id}`), ou NULL quand Open Prices ne connaît pas encore ce commerce. ⚠️ CE N''EST PLUS L''IDENTITÉ DU MAGASIN : celle-ci est (osm_type, osm_id). Un magasin sans pont est parfaitement valide et sélectionnable — il n''a simplement aucun prix observé disponible. L''unicité reste TOTALE sur les valeurs non nulles ; PostgreSQL considère deux NULL comme distincts.';
comment on column public.stores.brand_wikidata is
  'COURSES C4.3c — `brand:wikidata` d''OpenStreetMap (ex. ''Q151954''), identifiant STABLE de l''enseigne. MÉTADONNÉE : jamais unique, des centaines de magasins d''une même enseigne la partagent. Sert à préparer un futur repli de prix par enseigne — que C4.3c n''implémente PAS. Absent d''Open Prices, qui ne publie que `osm_brand` en texte libre.';
comment on column public.stores.operator_wikidata is
  'COURSES C4.3c — `operator:wikidata` d''OpenStreetMap : qui EXPLOITE le point de vente, distinct de la marque (un franchisé n''est pas l''enseigne). Même statut que brand_wikidata : métadonnée, jamais une identité.';
