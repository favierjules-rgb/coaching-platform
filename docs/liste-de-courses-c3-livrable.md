# COURSES C3 — BUDGET ET ESTIMATION DE COÛT

## 1. L'audit (§1) — page blanche, mais pas sans conventions

**Rien n'existait.** Zéro table `price`, `budget`, `retailer`, `merchant`, `store`, `promotion`
dans les 81 migrations. Zéro colonne prix dans le domaine nutrition.

**Open Food Facts n'a aucun prix exploitable — mesuré.** `OFF_FIELDS` demande 14 champs, aucun
n'est un prix. En production : 82 produits, 27 payloads hydratés, **0 contenant une clé
`%price%` / `%prix%` / `%cost%`**. Les prix communautaires vivent dans *Open Prices*, un projet
et une API séparés, non connectés. **Aucun prix n'est deviné depuis Internet.**

**Une donnée voisine existe et servira à C4** : `food_products.net_quantity` / `net_unit` — le
conditionnement. C3 ne s'en sert pas ; C4 en aura besoin.

## 2. Les conventions reprises, pas inventées

| point | convention constatée | source |
|---|---|---|
| Monnaie | `*_cents integer check (>= 0)` | `subscription_templates.amount_cents`, `stripe_payments` |
| Doctrine entière | « un pourcentage stocké en flottant rend impossible toute comparaison fiable » | `lib/nutrition/basis-points.ts` |
| Contre-exemple | `monthly_price_euros numeric`, `paid_amount_euros numeric` — l'ancien socle facturation, qui doit faire `Math.round((t-p)*100)/100` pour s'en sortir | `schema.sql:387-407` |
| Identité polymorphe | deux FK nullables + CHECK par comptage | `planned_meal_items_cible_unique` |
| Unicité sur nullable | deux index **partiels** | `food_favorites_*_unique` |
| Propriété d'une donnée globale | `owner_coach_id` nullable + `select_global` / `manage_own_coach` / `manage_admin` | `food_catalog` |
| Recherche d'aliment | `FoodSearchPicker` rend une `CibleAliment` (identité XOR) | N1.2 |

## 3. Budget et prix — deux concepts, deux endroits

```
shopping_lists.budget_cents integer null
  check (null or (>= 0 and <= 100000))        -- 1 000 €, garde-fou d'absurdité
  grant update (budget_cents) to authenticated -- LA serrure
  policy for update on current_student_id()

shopping_list_items.estimated_price_cents integer null
  check (null or (source='manual' and 0 <= x <= 100000))
  écrit par la RPC definir_prix_article_manuel

food_price_estimates (catalog_food_id XOR product_id, price_cents, quantity, unit,
                      source, status, observed_on)
  check unit in ('g','ml','piece') · quantity > 0 · price_cents >= 0
  unique partiel (catalog_food_id, unit) where status='active' and catalog_food_id is not null
  unique partiel (product_id,      unit) where status='active' and product_id      is not null
  select : tout élève, ACTIFS seulement · insert/update/delete : is_admin() seul
```

**Pourquoi des prix globaux et pas `owner_coach_id`** : la production compte 3 330 aliments dont
**0 privé de coach**. Recopier le modèle de `food_catalog` doublerait les index partiels et
ajouterait une règle de priorité à tester, pour une couche sans utilisateur. `owner_coach_id`
s'ajoutera en une migration additive le jour où un second coach le demandera.

**Pourquoi le prix d'un article manuel n'est PAS dans `food_price_estimates`** : un article
manuel n'a **aucune identité** — c'est le contrat de C2. Il ne peut pas entrer dans une table
dont la clé est une identité. Son prix est une propriété de la ligne, et il est **forfaitaire**
(« papier toilette 4,50 € »), jamais mis au prorata.

**Pourquoi une RPC pour ce prix** : le privilège d'`update` du client est réduit à `checked`.
L'élargir à `estimated_price_cents` l'ouvrirait **aussi aux lignes PLAN** — un grant de colonne
ne sait pas dire « seulement quand `source = manual` ». La RPC préserve la serrure de C2 intacte.

## 4. Le calcul, et son arrondi

```
coût_ligne = round( besoin / quantité_de_référence × price_cents )
total      = Σ des lignes ARRONDIES
```

**Arrondi au centime, par ligne, `Math.round`** (demi supérieur ; tous les termes sont positifs,
donc déterministe). Le total est la **somme des lignes arrondies**, et non l'arrondi de la somme
exacte : un élève qui additionne les lignes affichées doit retrouver le nombre affiché.

⚠️ L'exemple de l'énoncé §11 donne « 318,5 cents » — c'est la valeur **avant** arrondi. La ligne
vaut **319**.

**Aucune conversion.** Un besoin en g avec un prix en ml n'est pas estimable — et le résultat
n'est **pas zéro**, c'est `null` avec la raison `unite_differente`. Zéro serait un coût ; `null`
est une absence, et l'écran doit les distinguer.

**Estimation proportionnelle, et l'écran le dit** : « Estimation basée sur les quantités
nécessaires, sans tenir compte des conditionnements ». 1 274 g de riz à 2,50 €/kg comptent pour
3,19 €, alors qu'il faudra deux paquets. Taire l'approximation la ferait passer pour un devis.

## 5. Un défaut trouvé en écrivant les tests

`formaterMontant` s'appuyait d'abord sur `formatDecimalFr(cents / 100, 2)`. Le test a montré que
ce formateur **supprime les zéros de fin** : 5 340 centimes s'affichaient « 53,4 € », et 700
« 7 € ». Corrigé en arithmétique **entière pure** — `Math.trunc(abs / 100)` et `abs % 100`,
séparateur de milliers par `formatIntegerFr`. Aucun flottant, même pour afficher.

## 6. Résultats

| | |
|---|---|
| `test:liste-de-courses-c3` | **52 / 52** (C3-01→52, dont 14 issus de l'audit adverse) |
| `supabase/tests/courses_c3_budget_checklist.sql` | **69 contrôles, 0 échec**, Z vert, rejouable |
| Contrôles négatifs SQL | **10 / 10** rougissent où attendu |
| Responsive 6 états × 6 largeurs | **36 / 36** — sabotage → 24 rouges |

## 6 bis. Les défauts trouvés par l'audit adverse, et leurs corrections

| # | défaut | correction |
|---|---|---|
| **D-1** | un `price_cents` négatif produisait un coût **négatif** — une ligne qui *diminuait* l'estimation, en silence | garde `priceCents < 0` dans `calculerCoutLigne` → non estimable (C3-39) |
| **D-2** | au-delà de `Number.MAX_SAFE_INTEGER`, le coût devenait **arbitraire** sans le dire | garde `Number.isSafeInteger` → non estimable (C3-40) |
| **D-3** | un **coach** atteignait la page des prix et y voyait un formulaire dont chaque bouton échouait | `requireAdmin()` neuf dans `guards.ts` ; la RLS n'a **pas** été élargie (C3-50) |
| **D-4** | « Budget restant : 6,60 € » affirmé alors que 5 articles sur 20 n'avaient pas de prix | le libellé porte la réserve : « Budget restant estimé sur 15 / 20 articles » (C3-48, C3-49) |
| **D-5** | « Reste estimé » se confondait avec « Budget restant », deux lignes plus haut | renommé **« Reste à acheter »** ; les deux notions sont explicitées en commentaire (C3-47) |
| **D-6** | le rapport disait « rien à réécrire » pour C4 | corrigé §7 : la clé d'unicité `(identité, unité)` devra évoluer |

## 7. Ce que C3 ne fait pas, et comment il prépare C4

Aucun magasin, aucune enseigne, aucune latitude, aucune promotion, aucune disponibilité, aucun
conditionnement — vérifié par balayage sur les six fichiers du lot, code dépouillé de sa prose.

⚠️ **Correction d'une phrase du premier rapport.** Il disait « rien à réécrire ». C'est faux sur
un point précis, et il vaut mieux le dire maintenant que le découvrir en C4 :

> **La clé d'unicité du prix actif — `(identité, unité)` — NE SURVIVRA PAS à l'arrivée des
> magasins.** Elle n'admet qu'un seul prix actif par identité et par unité ; dès que le même riz
> aura un prix chez deux enseignes, ces deux prix seront actifs en même temps et l'index les
> refusera. C4 devra donc faire évoluer les deux index partiels vers
> `(identité, unité, store_id)` — ou introduire une notion de portée de prix.
>
> C'est une **migration additive et évolutive**, pas une réécriture du modèle : les colonnes, les
> contraintes de contrat et la RLS restent. Mais ce n'est pas « rien ». Aucun `store_id` n'est
> ajouté maintenant : l'anticiper sans magasin donnerait une colonne nulle partout et un index
> qui ne garantirait plus rien.

Le reste s'ajoute effectivement sans rien réécrire :

| C4 devra ajouter | point d'accroche déjà en place |
|---|---|
| enseigne, magasin, prix observé | `food_price_estimates.source` — `check in ('manual_estimate')` s'étend en une ligne |
| prix par coach | `owner_coach_id` nullable + une policy, sur le modèle `food_catalog` |
| historique des prix | `status = 'archived'` : rien n'est jamais supprimé, `observed_on` date chaque relevé |
| conditionnement, nombre de paquets | `food_products.net_quantity` / `net_unit`, déjà peuplés |
| latitude, longitude, distance | table `stores` neuve, référencée par une colonne nullable |

## 8. Limites assumées

- **L'estimation utilise les prix ACTUELS** (§23). Une liste d'hier se rechiffre au prix
  d'aujourd'hui. C4 pourra figer un instantané à la génération ; C3 ne le fait pas, et le
  documente plutôt que de le laisser croire.
- **Le total est dérivé, jamais persisté** (§19) : il ne peut donc pas devenir périmé, au prix
  d'un recalcul à chaque affichage — négligeable sur vingt lignes.
- **`publierPrix` fait deux écritures sans transaction.** Si la seconde échoue, l'identité se
  retrouve *sans prix actif*, donc « non estimée » — un état que l'écran affiche honnêtement.
  On dégrade vers l'absence, jamais vers l'ambiguïté (deux prix actifs, que l'index refuse).
- **Un coach atteint la page admin des prix** (`requireAdminOrCoach` garde la section), mais la
  policy `is_admin()` lui refuse l'écriture, avec un message qui le dit. C'est la doctrine C0.1 :
  une garde cliente ne suffit jamais, le serveur tranche.
