-- ============================================================================
-- Migration 20260904090000 — ALIMENTS A3, PHASE 4.1 : « VU » N'EST PAS « CONNU ».
-- (chantier feat/aliments-a2-meal-tracking)
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE DÉFAUT QUE CETTE MIGRATION CORRIGE
-- ────────────────────────────────────────────────────────────────────────────
-- La phase 4 a ajouté un second chemin d'arrivée dans `food_products` : la
-- recherche texte. Elle n'a pas ajouté de colonne, et c'est là qu'est l'erreur
-- — parce que les deux chemins ne rapportent PAS la même chose :
--
--   /api/v3.4/product/{gtin}     fiche COMPLÈTE : nutrition_data_per,
--                                product_quantity, ingredients_text, tout ;
--   Search-a-licious /search     P/G/L, un nom, une image. Et RIEN d'autre :
--                                mesuré le 13/08/2026, l'index ne porte pas
--                                les champs détaillés, même demandés.
--
-- `source_fetched_at` répondait donc à deux questions à la fois : « quand
-- a-t-on vu ce produit pour la dernière fois ? » et « quand a-t-on chargé sa
-- fiche complète ? ». Tant qu'un seul chemin existait, les deux réponses
-- coïncidaient. Depuis la phase 4, non — et le TTL de 30 jours, qui mesurait
-- la seconde, s'est mis à mesurer la première.
--
-- MESURÉ AVANT CORRECTION, sur le code de la phase 4 :
--
--   1. une recherche « boisson » trouve le GTIN 5449000000996 ;
--   2. le hit n'a pas de `nutrition_data_per` → l'unité conclut « g » PAR
--      DÉFAUT, ce qui est un repli, pas une observation ;
--   3. la ligne est écrite avec `source_fetched_at = maintenant` ;
--   4. un lookup GTIN immédiat juge la ligne FRAÎCHE et ne part pas :
--      ZÉRO appel à /api/v3.4/product/5449000000996 ;
--   5. l'élève voit « pour 100 g » là où la fiche dit « pour 100 ml »,
--      et il faudra attendre TRENTE JOURS pour que ça se corrige.
--
-- Et symétriquement : une fiche complète vieille de 29 jours voyait son
-- `source_fetched_at` réécrit par une simple recherche texte, donc son TTL
-- repartir pour trente jours — sans que la fiche ait été rechargée.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE COLONNE, ET PAS UN ARRANGEMENT DANS L'EXISTANT
-- ────────────────────────────────────────────────────────────────────────────
-- Deux replis sans migration ont été examinés et écartés :
--
--   - écrire une date SENTINELLE (epoch) dans `source_fetched_at` pour les
--     hits de recherche. Représentable — la colonne est NOT NULL, il faut donc
--     une valeur —, mais la base dirait « récupéré le 1ᵉʳ janvier 1970 ». Une
--     date qui ment, qu'il faudrait reconnaître de mémoire à chaque lecture ;
--
--   - se servir de `source_payload IS NOT NULL` comme marqueur d'hydratation,
--     puisque seul le lookup GTIN l'écrit. Cela fonctionne AUJOURD'HUI, par
--     accident d'implémentation. Le jour où l'on cesserait de conserver les
--     charges brutes — ou qu'on en conserverait pour les recherches — le cache
--     redeviendrait faux, en silence, et rien dans le schéma n'aurait prévenu.
--
-- La question posée est une question de FAIT — cette fiche a-t-elle été
-- chargée depuis l'endpoint produit, et quand ? Un fait mérite une colonne.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - elle ne touche à AUCUNE colonne existante : rien n'est renommé, rien ne
--     change de type, rien ne devient obligatoire ;
--   - elle ne supprime aucune donnée, et n'invalide aucun cache ;
--   - elle ne touche NI aux instantanés de `meal_entries`, NI à la moindre RPC.
--     Le contrat A1 vaut ici comme partout : rafraîchir une fiche ne réécrit
--     jamais ce qu'un élève a déjà mangé.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

alter table public.food_products
  add column if not exists detail_fetched_at timestamptz;

-- ── REPRISE DES LIGNES EXISTANTES ─────────────────────────────────────────
-- Avant cette migration, `source_payload` n'était écrit que par un chemin :
-- la route de lookup GTIN (`enregistrerProduit`, phase 3). L'écriture de
-- recherche (phase 4) ne l'a jamais renseigné — délibérément, une charge brute
-- de quarante fiches partielles n'ayant aucune valeur d'audit.
--
-- Une ligne qui porte une charge brute a donc bel et bien été hydratée, et sa
-- date d'hydratation est son `source_fetched_at`. Les autres — celles nées
-- d'une recherche — restent à NULL : « jamais hydratée », ce qui est
-- exactement la vérité.
--
-- On se sert ici de la corrélation qu'on a refusé d'ériger en règle
-- permanente : à titre de REPRISE ponctuelle, sur des lignes déjà écrites et
-- dont on connaît l'histoire, elle est exacte. Ce qui serait fragile, c'est
-- d'en dépendre pour les écritures FUTURES — et à partir de maintenant, plus
-- personne n'en dépend.
update public.food_products
   set detail_fetched_at = source_fetched_at
 where detail_fetched_at is null
   and source_payload is not null;

-- Balayage des fiches à réhydrater : « lesquelles n'ont jamais été chargées
-- en détail, ou l'ont été il y a trop longtemps ». NULLS FIRST parce que
-- « jamais » passe avant « il y a longtemps ».
create index if not exists food_products_detail_fetched_idx
  on public.food_products (detail_fetched_at nulls first);

comment on column public.food_products.detail_fetched_at is
  'Date du dernier chargement de la fiche COMPLÈTE depuis l''endpoint produit d''Open Food Facts. NULL = ce produit n''a jamais été hydraté : il vient d''une recherche texte, qui ne rapporte que P/G/L, un nom et une image. C''est CETTE colonne que le TTL de 30 jours mesure — pas source_fetched_at, qui dit seulement quand le produit a été vu pour la dernière fois, par n''importe quelle voie. Les deux ont coïncidé tant qu''un seul chemin existait ; depuis la recherche texte, les confondre fait qu''un résultat de recherche empêche le chargement de la vraie fiche pendant trente jours.';

comment on column public.food_products.source_fetched_at is
  'Date de la dernière OBSERVATION des teneurs, par n''importe quelle voie — lookup GTIN ou recherche texte. Ne dit RIEN de la complétude de la fiche : pour savoir si le détail a été chargé, et quand, c''est detail_fetched_at qu''il faut lire. La fraîcheur (TTL 30 jours) est décidée par la couche serveur, en un seul endroit : une seconde définition du délai en SQL serait une seconde vérité, qui finirait par diverger.';

comment on index public.food_products_detail_fetched_idx is
  'Balayage des fiches à (ré)hydrater. NULLS FIRST : une fiche jamais chargée en détail passe avant une fiche chargée il y a longtemps.';
