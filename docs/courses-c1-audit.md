# COURSES — C1 — AUDIT AVANT CODE

**Aucun code écrit. Aucune migration. STOP demandé après audit, et respecté.**
Toutes les structures ci-dessous sont lues sur la base locale reconstruite
(baseline + 45 migrations post-baseline) et sur le code, pas sur la mémoire.

---

## ⚠️ LE FAIT QUI GOUVERNE TOUT LE LOT

**Le plan du coach ne contient AUCUNE identité alimentaire.**

```ts
export interface PrescribedFoodItem {
  readonly name: string;      // « 150 g fromage blanc »
  readonly quantity: string;  // texte libre, souvent vide
}
```

`meals.items` est du `jsonb` contenant ces deux chaînes. Pas de
`catalog_food_id`, pas de `product_id`, pas de quantité numérique, pas d'unité.
La quantité est fréquemment **dans le libellé** (« 150 g fromage blanc »), et
certaines lignes sont des respirations de mise en page (« PROTÉINES », `name`
vide) — c'est le correctif « retours à la ligne » d'un lot antérieur.

**Conséquence directe :** on ne peut pas dériver une liste de courses des repas
prescrits. Le §11 exige « ne jamais consolider uniquement par nom » ; or le plan
n'offre *que* des noms. Il faut donc passer par ce qui porte une identité — et
c'est ce que décrit le §11 ci-dessous.

Ce point n'invalide pas C1. Il en fixe l'architecture, et il change le
découpage : la question n'est pas « comment agréger le plan », c'est « comment
produire des aliments identifiés qui satisfont les cibles du plan ».

---

## 1. Modèle exact utilisé pour les jours

| table | ce qu'elle porte |
|---|---|
| `nutrition_days` | `plan_id`, `day` (**texte** : `monday`…), `profile_key`, `target` (jsonb), `status`, `week_start_date` |
| `meals` | `nutrition_day_id`, `slot`, `name`, `items` (jsonb), `macros` (jsonb), `coach_notes` |

**Le plan n'a pas de dates.** `nutrition_days.day` est un **jour-type**
(`monday`…`sunday`), et `week_start_date` — bien que présent en colonne —
n'est référencé **nulle part** dans le code applicatif (`grep` : zéro
occurrence hors migrations).

Le pont jour-type → date existe déjà et a été posé en A5.6/A5.7 :
`getCurrentWeekDates()` puis `datesParJour`, et `semaineContenant` /
`decalerSemaine` dans `lib/nutrition/historique.ts`. **C1 doit réutiliser ce
pont**, sans quoi il créerait un second calendrier qui divergerait d'un jour.

**Pour le §1 (durée 1 → 7 jours, départ décalable)** : la période est une liste
de dates ISO, et chaque date se projette sur son jour-type par
`WEEKDAY_KEYS[index]`. Une période de 3 jours à cheval sur deux semaines
(samedi → lundi) reste donc parfaitement définie — c'est un point à tester
explicitement, il n'est couvert par aucun test existant.

---

## 2. Source exacte des objectifs

Chaîne mesurée, **sans aucune moyenne** :

```
nutrition_days.profile_key
        ↓
nutrition_plan_profiles  (daily_calories, protein_bp, carb_bp, fat_bp)
        ↓  computeDailyMacroTargets
cibles du JOUR  (kcal, P, G, L en grammes)
        ↓  nutrition_meal_slot_targets (slot, enabled, protein_bp, carb_bp, fat_bp)
        ↓  computeMealDistribution
cibles du CRÉNEAU
```

Deux jours de profils différents ont donc des cibles différentes, et
`dailyTargetsByWeekday` les rend déjà jour par jour — c'est ce qu'A5.6 affiche.
Le §1 (« ne jamais calculer moyenne × nombre de jours ») est donc satisfaisable
**sans nouvelle formule** : il suffit de boucler sur les dates.

Les proportions sont en **basis points** (`*_bp`, 10 000 = 100 %), jamais en
pourcentages flottants — convention à respecter.

---

## 3. Source exacte des repas

Deux chemins **très inégaux**, et c'est le nœud de C1 :

| chemin | structure | exploitable pour des courses ? |
|---|---|---|
| **A. Repas prescrits à la main** (`meals.items`) | texte libre | **NON** — ni identité, ni quantité numérique, ni unité |
| **B. Recettes** (`nutrition_recipes` + `nutrition_recipe_ingredients`) | structuré, avec macros et bornes | **OUI** |

⚠️ **Et les deux ne sont PAS reliés.** `PrescribedMeal` ne porte aucun
`recipe_id` : rien, dans le modèle, ne dit qu'un repas prescrit « Pancakes
protéinés » correspond à la recette du même nom. Le §13 de ton cahier des
charges suppose ce lien (« si un repas utilise une recette ») — **il n'existe
pas aujourd'hui**.

C'est un choix à faire, et il est listé en §13 ci-dessous.

---

## 4. Fonctionnement actuel du solver

`lib/nutrition/recipe-solver.ts` — et c'est la **bonne nouvelle du lot** : le
moteur de C1 existe déjà, il est écrit, borné et testé (25 tests).

```ts
solveRecipe(recipe, { target: { proteinGrams, carbGrams, fatGrams } })
  → RecipeSolution {
      status: "exact" | "approximate" | "impossible",
      ingredients: SolvedIngredient[],   // grams, displayGrams, units,
                                         // unitLabel, eggCount, boundHit, pinned
      totals, deltas, warnings, determinism
    }
```

Il respecte `min_grams` / `max_grams`, gère les ingrédients **quantifiables**
(`unit_scalable`, `max_units`, `unit_name` → « 2 wraps (64 g) »), les **œufs**
(`egg`, `egg_grams`), et les ingrédients **liés** (`linked_to_ingredient_id`,
`link_ratio_bp`). Il conserve les décimales en interne et n'arrondit que pour
l'affichage (`displayGrams`, « jamais réinjecté dans un calcul »).

La chaîne complète est **déjà branchée côté élève** dans
`components/student/StudentAdaptiveRecipes.tsx` :

```
cibles par créneau → buildRecipeTargetForMealSlot → recipesForSlot → solveRecipe
```

**C1 = cette chaîne, exécutée sur N jours × M créneaux, puis agrégée.** C'est la
conclusion la plus importante après celle du §0.

---

## 5. Fonctionnement des recettes

`nutrition_recipe_ingredients` (21 colonnes) porte **ses propres macros** :
`protein_per_100g`, `carb_per_100g`, `fat_per_100g`, `reference_grams`,
`min_grams`, `max_grams`.

⚠️ **Aucune clé étrangère vers `food_catalog` ni `food_products`.** Vérifié :
zéro occurrence de `food_catalog` / `catalog_food_id` / `food_id` dans les six
migrations de recettes. Un ingrédient est identifié par son `id` (uuid **local à
la recette**) et son `name` (texte libre).

Et il n'existe **aucun référentiel canonique d'ingrédients** : la migration
`20260818090000_nutrition_recipe_catalog.sql` dit elle-même « aucun changement
de schéma : ni table, ni colonne ». Deux recettes qui utilisent « Riz basmati »
ont donc **deux `ingredient_id` différents** pour le même aliment réel.

C'est le principal risque d'agrégation de C1 — développé au §10.

---

## 6. Source des habitudes (A5.7)

Tout est en place, et **sans rien y ajouter** :

| besoin | fonction existante |
|---|---|
| lire une plage de dates | `readConsumedMeals(supabase, dates, cible)` |
| identité d'un aliment consommé | `identiteDeLEntree` → `catalog_food:<id>` \| `product:<id>` \| `free:<libellé normalisé>` |
| agréger une période | `agregerConsommation` → `LigneConsommee[]` |
| semaines | `semaineContenant`, `decalerSemaine` |

`agregerConsommation` rend exactement le contrat que le §11 demande :
`{ identity, sourceType, catalogFoodId?, productId?, nameSnapshot, quantityTotal, unit }`.

**Il a été écrit pour ça** — c'est le « contrat futur Courses » d'A5.7, et il est
déjà testé (HIST20 à HIST22 : additionne les identités identiques, ne fusionne
jamais deux GTIN, ne fusionne jamais deux `catalog_food`).

Pour le §8 (7 jours puis 28 jours) : `readConsumedMeals` accepte une liste de
dates **arbitraire**, donc les deux fenêtres sont deux appels. Coût mesuré en
A5.7 : **0,33 ms** pour une semaine, index en tête. Une fenêtre de 28 jours
reste une requête bornée.

⚠️ Une limite à connaître : `agregerConsommation` regroupe les aliments
**saisis à la main** (`free`) sur leur libellé normalisé. C'est sûr pour eux —
ils n'ont pas d'identifiant — mais cela veut dire qu'une habitude « free » n'est
pas un aliment achetable identifié. Pour C1, les habitudes exploitables sont
donc celles de type `catalog_food` et `product`.

---

## 7. Identité alimentaire disponible

**Trois espaces d'identité coexistent, et aucun n'est celui d'un autre.**

| source | identité | achetable ? |
|---|---|---|
| `food_catalog` | `id` (uuid) + `source` (`ciqual`…), `name` unique | générique |
| `food_products` | `id` + **`gtin`** + `brand` + `product_name` | **oui, précis** |
| `meal_entries` | `catalog_food_id` \| `product_id` (instantané figé) | oui |
| `food_favorites` | pointe vers `catalog_food_id` \| `product_id` | oui |
| `nutrition_recipe_ingredients` | `id` **local à la recette** + `name` | **non identifié** |
| `meals.items` | *rien* — texte libre | **non identifié** |

Les quatre premières lignes sont utilisables telles quelles. Les deux dernières
sont le problème de C1.

---

## 8. Unités disponibles

| table | unités autorisées | contrainte lue en base |
|---|---|---|
| `food_catalog.nutrition_unit` | `g`, `ml` | `CHECK (nutrition_unit = ANY (ARRAY['g','ml']))` |
| `food_products.nutrition_unit` | `g`, `ml` | idem |
| `meal_entries.unit` | `g`, `ml`, `piece`, `portion` | `CHECK (unit = ANY (ARRAY['g','ml','piece','portion']))` |
| ingrédient de recette | grammes, plus `unit_name` libre si `unit_scalable` | `unit_scalable or (max_units is null and unit_name is null)` |

Le §12 (« g ≠ ml, jamais de conversion implicite ») est déjà la règle du
produit : `agregerConsommation` met **l'unité dans la clé** d'agrégation, et
HIST16 le prouve (200 g et 200 ml du même produit = deux lignes).

⚠️ Un écart à traiter : les recettes ont une unité **libre** (`unit_name` :
« wrap », « tranche »…), alors que `meal_entries` a un vocabulaire **fermé** de
quatre valeurs. C1 devra décider comment une sortie « 2 wraps » cohabite avec un
`piece`. Ce n'est pas bloquant, mais ça ne doit pas se décider par accident.

---

## 9. Moteur pur sans migration : **OUI**

Tout ce que C1 lit existe et est lisible par l'élève :

- plan, profils, cibles de créneau, jours → déjà lus par l'écran nutrition ;
- recettes + ingrédients → déjà lus par `StudentAdaptiveRecipes` ;
- historique → `readConsumedMeals`, A5.7 ;
- favoris → `listerFavoris`, A5.

Et tout ce que C1 produit est **calculable** : la liste est une fonction pure de
(période, plan, recettes, historique, préférences).

Les **préférences** et **exclusions temporaires** (§2, §7) n'ont pas à être
persistées en C1 : le §7 dit lui-même qu'une exclusion « concerne uniquement
cette génération ». Un état React le porte, et rien ne survit à la fermeture —
ce qui est exactement le comportement demandé.

**Aucune migration n'est donc nécessaire pour C1.** Le §17 est satisfait.

La persistance deviendra nécessaire au moment où l'un de ces besoins arrivera —
et pas avant : historique des listes, cases cochées, modification après
génération, partage, budget. C'est le lot C2 ou C3, pas C1.

---

## 10. Risques d'agrégation — mesurés

### 10.a — Le risque réel n'est pas la collision de noms, c'est la variance

Mesuré sur les 3 330 aliments Ciqual de la base :

```
aliments_total | libelles_distincts | collisions
          3330 |               3330 |          0
```

**Zéro collision exacte.** Agréger deux aliments Ciqual par leur nom complet ne
les fusionnerait donc pas à tort.

Mais ce n'est pas le danger. Le danger est qu'un nom **court** — celui qu'un
élève tape, celui qu'un ingrédient de recette porte — ne désigne aucun aliment
précis :

| tête de libellé | variantes Ciqual | protéines /100 g |
|---|---:|---|
| bœuf | **51** | **17,2 → 39,2 g** |
| porc | 32 | 4,5 → 36,9 g |
| yaourt ou lait fermenté | 30 | 2,5 → 5,0 g |
| veau | 26 | 16,7 → 37,4 g |
| agneau | 24 | 15,4 → 35,2 g |

Une préférence « Bœuf » (§2, ton exemple exact) recouvre **51 aliments** dont
les protéines varient d'un facteur **2,3**. Choisir la mauvaise variante fausse
les macros de la journée du simple au double.

**Conséquence pour C1 :** une préférence n'est pas un aliment, c'est un
**filtre**. Elle doit sélectionner parmi des aliments déjà identifiés
(favoris, récents, ingrédients de recette), jamais servir à en inventer un.

### 10.b — Les ingrédients de recette n'ont pas d'identité partagée

Deux recettes utilisant « Riz basmati » donnent deux `ingredient_id`. Agréger
sur `ingredient_id` produirait **deux lignes de riz** dans la liste ; agréger
sur le `name` violerait le §11.

Trois options, à trancher (voir §13) :

| option | effet | coût |
|---|---|---|
| **A. Deux lignes assumées** | « Riz basmati 300 g » + « Riz basmati 200 g » | nul, mais la liste est mauvaise |
| **B. Regrouper par nom normalisé, à l'intérieur des recettes seulement** | une ligne « Riz basmati 500 g » | faible, et le périmètre est étroit et documenté |
| **C. Référentiel canonique d'ingrédients** | vraie identité partagée | **migration + chantier de mapping** |

Mon avis : **B pour C1**, avec la règle écrite noir sur blanc — le regroupement
par libellé normalisé s'applique **uniquement** aux ingrédients de recette,
qui n'ont par construction aucun identifiant, exactement comme
`agregerConsommation` le fait déjà pour les aliments `free`. C n'est pas un
sujet de C1.

---

## 11. Architecture proposée pour C1

```
                    PÉRIODE (1..7 dates ISO, départ libre)
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   PLAN (contrainte)   PRÉFÉRENCES (envies)   HABITUDES (A5.7)
   cibles par jour     + exclusions           7 j, puis 28 j
   et par créneau      temporaires            catalog_food / product
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              ▼
              lib/courses/besoins.ts        ← NOUVEAU, module FEUILLE
              (ni React, ni Supabase, ni réseau)
                              │
              pour chaque date × chaque créneau activé :
                 buildRecipeTargetForMealSlot   (existant)
                 choisirRecette(candidates, préférences, exclusions, habitudes)
                 solveRecipe                    (existant)
                              ▼
                    SolvedIngredient[] × N jours
                              ▼
              agregerBesoins()  ← clé = identité + unité, jamais le nom seul
                              ▼
                    DemandeAlimentaire (sortie C1)
```

**Sortie proposée** — volontairement proche de `LigneConsommee` d'A5.7, pour ne
pas créer un second vocabulaire :

```ts
interface LigneCourses {
  readonly identity: string;         // "catalog_food:<id>" | "product:<id>"
                                     // | "recipe_ingredient:<nom normalisé>"
  readonly source: "catalog_food" | "product" | "recipe_ingredient";
  readonly catalogFoodId?: string;
  readonly productId?: string;
  readonly gtin?: string;
  readonly nameSnapshot: string;
  readonly quantityTotal: number;
  readonly unit: "g" | "ml" | "piece" | "portion" | string; // unit_name libre
  readonly categorie: CategorieCourses;
  readonly origines: readonly string[];  // les dates/créneaux qui l'ont produite
}
```

`origines` n'est pas décoratif : c'est ce qui permettra plus tard d'expliquer
« pourquoi ce poulet est sur ma liste », et de retirer un jour sans tout
recalculer.

**Priorité d'application**, telle que ton §4 la fixe — je la reprends sans la
modifier : sécurité/restrictions → plan → préférences → habitudes → générique.
Le point à garder ferme : **une préférence ne change jamais une cible**. Elle ne
peut qu'orienter le choix d'une recette ou d'un aliment à cible constante.

**Modules envisagés** (tous purs, tous testables sans base) :

| fichier | rôle |
|---|---|
| `lib/courses/periode.ts` | 1..7 jours, départ libre, projection date → jour-type |
| `lib/courses/preferences.ts` | envies, « peu importe », exclusions temporaires |
| `lib/courses/besoins.ts` | la boucle jours × créneaux, l'appel au solver |
| `lib/courses/agregation.ts` | identité + unité, catégories, tri |
| `hooks/useCourses.ts` | état UI, lecture des recettes/habitudes/favoris |
| `components/student/Courses*.tsx` | les trois écrans (durée, envies, liste) |

---

## 12. Migrations proposées : **AUCUNE**

Pour C1, aucune. Justifié au §9.

**Deux réserves honnêtes**, à trancher avant C2 et non pendant C1 :

1. **Le lien repas prescrit ↔ recette n'existe pas** (§3). Si tu veux que C1
   décompose les repas que le coach a réellement écrits, il faudra une colonne
   `meals.recipe_id` — donc une migration. Tant que C1 propose des recettes
   *compatibles avec les cibles* plutôt que *celles du plan*, aucune migration.
   **C'est la décision la plus structurante du lot, et elle t'appartient.**
2. **Le référentiel canonique d'ingrédients** (option C du §10.b) : hors C1.

---

## 13. Découpage des phases proposé

| phase | contenu | migration |
|---|---|---|
| **C1.0** | Mesures manquantes sur données réelles : combien d'élèves ont un plan à recettes vs à repas manuels ; combien de recettes par créneau ; taux de collision des noms d'ingrédients entre recettes | non |
| **C1.1** | `lib/courses/periode.ts` — durée 1..7, départ libre, dates réelles, projection sur les jours-types. Tests C1-1, C1-2, C1-3, C1-18 | non |
| **C1.2** | `lib/courses/besoins.ts` — boucle jours × créneaux, cibles propres à chaque date, appel au solver existant. Tests C1-4, C1-15, C1-16, C1-17 | non |
| **C1.3** | `lib/courses/agregation.ts` — identité + unité, catégories. Tests C1-9 à C1-12, C1-19 | non |
| **C1.4** | Préférences, « peu importe », exclusions temporaires, habitudes A5.7. Tests C1-5 à C1-8, C1-13, C1-14, C1-20 | non |
| **C1.5** | Les trois écrans + le mode de génération (§9 de ton cahier) | non |

Les tests C1-1 à C1-20 que tu listes sont tous réalisables sans base, sauf
C1-16 et C1-17 (« ne modifie jamais le plan / l'historique ») qui se prouvent
mieux **en base**, comme HIST19 : par les privilèges, pas par la relecture du
code. Le module Courses n'important aucune fonction d'écriture, la garantie sera
structurelle *et* exécutée.

---

## Ce que je n'ai PAS pu mesurer

Je le dis plutôt que de le laisser croire :

- **Combien de plans réels utilisent des recettes** plutôt que des repas
  manuels. La base locale ne contient aucun plan ni aucune recette — seulement
  les 3 330 aliments Ciqual. C'est la mesure n°1 de la phase C1.0, et elle
  décide de l'utilité réelle de C1 : si la quasi-totalité des plans sont écrits
  à la main, C1 produira surtout des propositions, pas la décomposition du plan
  existant.
- **Le taux de collision des noms d'ingrédients entre recettes** — même raison.

---

## Les trois décisions que j'attends de toi

1. **Repas prescrits à la main** : C1 propose-t-il des recettes compatibles avec
   les cibles (aucune migration), ou veux-tu à terme relier un repas prescrit à
   une recette (migration `meals.recipe_id`) ?
2. **Ingrédients de recette** : option **B** (regroupement par libellé normalisé,
   limité aux ingrédients de recette et documenté comme tel) — d'accord ?
3. **Unités de recette libres** (« 2 wraps ») : sortie telle quelle dans la
   liste, ou conversion en grammes avec l'unité d'origine en second ?

**STOP. Aucun code C1 avant ta validation.**
