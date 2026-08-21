# COURSES C2 — LA LISTE DE COURSES PERSISTANTE

## 1. L'audit préalable (§1), et ce qu'il a écarté

**Aucune table exploitable n'existait.** Recherche exhaustive sur les 81 migrations,
`supabase/schema.sql` et la base de production : aucun `shopping`, `grocery`, `checklist`,
`panier`, `liste_de_courses`.

Deux faux candidats, écartés explicitement :

| candidat | pourquoi il ne convient pas |
|---|---|
| `nutrition_plans.shopping_list jsonb` | Attachée à un PLAN, pas à (élève, période). Texte libre découpé sur des virgules → aucune identité, aucune unité, aucun état coché. C'est une note du COACH, pas une liste que l'élève coche. **0 plan sur 14 l'utilise en production.** Laissée strictement intacte. |
| `food_lists` / `food_list_items` | Listes d'aliments AUTORISÉS du coach (N1), rattachées à `coach_id`, sources des `meal_choice_slots`. Sens inverse de C2. |

## 2. Les conventions relevées, et suivies

| point | convention du projet | source |
|---|---|---|
| Table | anglais snake_case, enfant = parent + `_items` | `planned_meals` / `planned_meal_items` |
| Colonne date | `_on date` (date réelle), `_at timestamptz` | `planned_on`, `consumed_on` |
| Fonction | **français** | `enregistrer_repas_planifie` |
| Identité polymorphe | deux FK nullables + CHECK par comptage — jamais `identity_type`/`identity_id` | `planned_meal_items_cible_unique` |
| Unicité sur colonne nullable | deux index **partiels** (NULL ≠ NULL) | `food_favorites_food_unique` |
| Étanchéité parent/enfant | `unique (id, student_id)` + FK composite | `planned_meals_id_student_unique` |
| Identité utilisateur | `public.current_student_id()` et **rien d'autre** | `food_favorites`, `consumed_meals` |
| RPC | `security definer` + `set search_path = public`, `revoke all from public`, `revoke execute from anon`, `grant execute to authenticated, service_role`, `comment on function` | `enregistrer_repas_planifie` |
| Erreurs | `raise exception 'CODE' using errcode = '42501'` (droit) / `'22023'` (donnée) | 30 occurrences |
| Privilèges | `revoke all` **avant** les `grant` | `food_favorites` |

## 3. Le modèle

```
shopping_lists (student_id, starts_on, ends_on, created_at, updated_at)
  unique (student_id, starts_on, ends_on)   -- « générer » crée OU rouvre
  unique (id, student_id)                    -- support de la FK composite
  check  ends_on >= starts_on
  check  ends_on - starts_on <= 6            -- 1 à 7 jours

shopping_list_items (list_id, student_id, source, catalog_food_id, product_id,
                     label, quantity, unit, checked, created_at)
  FK composite (list_id, student_id) → shopping_lists (id, student_id)
  check  source in ('plan','manual')
  check  source='plan'   ⇒ exactement 1 cible ∧ quantity ∧ unit ∧ label is null
  check  source='manual' ⇒ 0 cible ∧ label non vide
  check  unit is null or unit in ('g','ml','piece')
  unique partiel (list_id, catalog_food_id, unit) where source='plan' and catalog_food_id is not null
  unique partiel (list_id, product_id,      unit) where source='plan' and product_id      is not null
```

Les deux index partiels sont **la clé d'agrégation C1 (`identité + unité`) traduite en
contrainte**. Un index unique ordinaire laisserait passer les doublons : NULL n'est jamais
égal à NULL.

## 4. §17 — pourquoi DEUX régimes d'écriture, et pas une RPC pour tout

Le critère du projet est constant (`food-favorites.ts` le documente) : RPC quand le serveur
ARBITRE ou quand l'ATOMICITÉ multi-lignes est en jeu, écriture directe sinon.

| opération | chemin | raison |
|---|---|---|
| Régénérer | RPC `regenerer_liste_de_courses` | trois verbes en une transaction |
| Modifier un article manuel | RPC `modifier_article_manuel` | le client n'a `update` que sur `checked` |
| Cocher / décocher | `update` direct | une colonne, une ligne, aucun arbitrage |
| Ajouter / supprimer un manuel | `insert` / `delete` directs | cantonnement à `source='manual'` par policy |

**La vraie serrure de §12 est un GRANT DE COLONNE**, pas une policy :
`grant update (checked) on shopping_list_items to authenticated`. Un
`update ... set quantity = 1` échoue sur un « permission denied for column » avant même que
la policy soit évaluée. Une policy ne sait pas parler de colonnes ; un privilège, si.

## 5. L'algorithme de régénération (§5), et son piège

Trois écritures, dans cet ordre, toutes limitées à `source = 'plan'` :

1. **DELETE** les lignes dont l'identité+unité a disparu du plan ;
2. **UPDATE** la quantité de celles qui restent — `checked` **n'apparaît pas dans le `set`** ;
3. **INSERT** les nouvelles, `checked = false`.

Les lignes MANUELLES ne sont touchées par aucune des trois.

⚠️ **Le piège le plus coûteux est `=` au lieu de `is not distinct from`.** Une ligne PRODUIT
a `catalog_food_id is null` des deux côtés : avec `=`, la comparaison rend NULL, le
`not exists` devient vrai, et **toutes** les lignes sont supprimées puis réinsérées à chaque
régénération — en perdant leur case cochée, sans qu'aucune erreur ne le signale. Le contrôle
négatif NC-1 rejoue exactement ce défaut et le fait rougir sur trois assertions
indépendantes (LAB-09, LAB-12, LAB-15).

L'idempotence est prouvée par les `xmin` : un second appel identique ne réécrit **aucune**
ligne (garde `i.quantity is distinct from l.quantity`), et non « produit le même résultat
après réécriture ».

## 6. §4 — le verrou d'appartenance

`security definer` ignore la RLS par construction. La RPC vérifie donc que chaque couple
(identité, unité) reçu **a réellement été planifié par cet élève sur cette période**
(`planned_meal_items` ⋈ `planned_meals`), et refuse sinon avec `LIGNE_HORS_PLANIFICATION`.

Elle vérifie l'**appartenance**, jamais la quantité : recalculer la somme côté serveur serait
le second moteur que le projet refuse. L'agrégation reste `agregerListeDeCourses`, et il n'en
existe qu'une.

## 7. §21 — aucune heuristique d'unité

Trois unités (`g`, `ml`, `piece`), ou `null` pour un article manuel. Aucune n'est déduite d'un
nom : ni « jus ⇒ ml », ni « sauce ⇒ ml », ni aucune autre. Aucune conversion : ni g↔kg, ni
ml↔L, ni pièce↔g. `kg` envoyé à la RPC est un **refus** (`UNITE_INVALIDE`), pas une
conversion. Le test C2-28 balaie les cinq fichiers du lot, commentaires retirés.

## 8. §14 — la détection de changement

Signature canonique : `identité|unité=quantité`, trié, joint. Trois champs seulement.

- Un **libellé** qui change ne déclenche rien (C2-11) — sinon une correction du catalogue
  ferait clignoter « METTRE À JOUR » sans qu'aucune donnée n'ait bougé.
- L'**ordre** de lecture n'a aucune influence (C2-12).
- Les **articles manuels** ne comptent pas (C2-13).
- Les quantités sont normalisées en chaîne : `300` et `300.0` sont la même quantité.

Ouvrir l'écran ne déclenche **aucune** écriture (§13, prouvé par C2-29 : l'effet de montage
du hook ne contient pas `regenerer`).

## 9. Ce qui n'est pas fait, et pourquoi

Hors périmètre C2, et **non implémenté** : budget, prix, magasin, localisation, promotions,
reprise de la semaine passée, optimisation commerciale. Aucun de ces mots n'apparaît dans le
code du lot.

Reste à faire, porté au chantier suivant :
- l'unification de `identitesDeChoix` (dupliquée entre `repas-de-la-periode.ts` et l'écran du
  plan) — déjà signalée en C1 ;
- la dépréciation éventuelle de `nutrition_plans.shopping_list`, qui est un chantier à part.

## 10. `updated_at` — audité, puis rendu véridique

À la première écriture, la colonne avançait à **chaque** régénération, y compris à l'identique.
C'était une information fausse : une date de « dernière modification » qui bouge sans
modification fait croire à un changement, et rend impossible de savoir quand la liste a
réellement changé pour la dernière fois.

Trois corrections :

1. `on conflict … do update set updated_at = shopping_lists.updated_at` — **rouvrir** une liste
   n'est pas la **modifier**. L'écriture est un no-op qui sert uniquement à obtenir l'`id`
   (`do nothing` ne rend aucune ligne).
2. Les trois écritures de réconciliation comptent leurs lignes (`get diagnostics`), et
   `updated_at` n'avance que si le total est non nul.
3. La colonne est **affichée** (« modifiée le 4 mars ») : une colonne maintenue mais jamais lue
   serait à supprimer, et celle-ci mérite d'être lue.

Prouvé au banc par `LAB-15b` (régénération identique → `updated_at` inchangée) et `LAB-15c`
(quantité modifiée → `updated_at` avance). Le contrôle négatif NC-1 les fait rougir.

## 11. Les tests voisins, adaptés SANS être affaiblis

Cinq assertions historiques reposaient sur un **compte** de migrations (`80`). C2 en ajoute une.
Remonter le compte à `81` aurait détruit la garantie : « 81 migrations » est satisfait par
n'importe quelle 81ᵉ migration.

`scripts/tests/contrat-migrations.mts` remplace le compte par **sept vérifications** :
identité exacte de la migration autorisée, ordre C0.1 → C2, horodatage réel, unicité de la
migration de courses, absence d'intruse depuis C0.1, empreinte figée des 79 migrations
antérieures (anti-antidatage), et rejet des noms non horodatés.

Un sixième test — `C1-22` — était un **faux vert** : il cherchait `shopping_lists` dans les
*noms de fichiers* de migration, et la migration C2 s'appelle `…_c2_liste_de_courses_…`. Il
aurait continué d'affirmer « aucun état n'est persisté » alors que c'était devenu faux. Il
cherche désormais dans le **contenu** des migrations.
