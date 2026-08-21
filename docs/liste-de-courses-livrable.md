# COURSES C1 — PARCOURS 1 À 7 JOURS + PRÉFÉRENCES + GÉNÉRATION

> **Révision 2** — correction produit : **aucune durée par défaut** (§1 bis), extension future « Reprendre ma semaine passée » documentée (§11 bis), transfert Mac **préparé** (§12).

**Périmètre** : implémentation C1 seule.
**Aucune migration. Aucun `db push`. Aucun commit. Aucun push. Aucun transfert Mac.**
Tout ce qui suit vit dans le conteneur, sur l'arbre `/root/miroir`.

---

## 0. AVERTISSEMENT PRÉALABLE — L'ANCIEN C1 EST TOUJOURS PHYSIQUEMENT LÀ

L'ancien chantier abandonné **existe encore dans le conteneur** (il n'a jamais été transféré sur le Mac, jamais supprimé du miroir) :

```
app/(student)/courses/page.tsx      lib/courses/{agregation,besoins,selection,periode,preferences}.ts
hooks/useCourses.ts                 components/student/Courses{Liste,Parcours}.tsx
scripts/tests/courses-c1{,-ui}.mts  docs/courses-c1-{audit,corrections,livrable}.md
package.json : "test:courses-c1", "test:courses-c1-ui"
```

**Rien de tout cela n'a été lu pour concevoir C1, importé, copié ni modifié.** Le nouveau code porte volontairement d'AUTRES noms (`liste-de-courses`, `ListeDeCourses*`, `repas-planifies`), pour qu'aucune liste blanche de transfert ne puisse jamais confondre les deux. Le test `C1-20 / NC-01` le prouve sur les huit fichiers neufs.

**Deux exceptions de lecture, assumées et signalées :**

1. §3 demandait de *constater* la valeur par défaut du produit sans reprendre le code. Constat : `hooks/useCourses.ts:157` → `useState(3)`. **Ce défaut est explicitement écarté** (voir §1 bis) : C1 n'en a aucun. J'ai aussi constaté que l'ancien parcours comptait les jours **en arrière** (`useCourses.ts:60` : `for (let i = nbJours - 1; i >= 0; i -= 1)`), soit une période *finissant* aujourd'hui. C1 fait l'inverse, conformément à §4.
2. Le grep de vérification d'absence d'import.

**Conséquence à connaître** : l'écran nutrition ne pointe plus vers `/courses`. Les deux suites abandonnées passent donc de vertes à **43/44** et **15/16** :

```
courses-c1     → not ok 44 - C1-SUP. moteur pur, aucune migration, dépouillement honnête
courses-c1-ui  → not ok  1 - C1-UI-01. les sept durées sont proposées
```

**Je ne les ai pas touchées.** Les réparer aurait voulu dire remettre l'entrée vers `/courses`, c'est-à-dire ressusciter le parcours interdit. Elles mesurent du code mort ; leur rouge est le signal correct.

---

## 1. FICHIERS

### Créés — 9

| Fichier | Lignes | Rôle |
|---|---:|---|
| `lib/nutrition/periode-courses.ts` | 154 | durée 1..7 → dates réelles, nom de jour, libellé de période |
| `lib/nutrition/liste-de-courses.ts` | 225 | **moteur d'agrégation pur** : clé, somme, couleur, provenance, format |
| `lib/nutrition/repas-de-la-periode.ts` | 237 | croisement plan × période, options autorisées, identités |
| `lib/supabase/repas-planifies.ts` | 245 | lecteur `planned_meals` / `planned_meal_items` par période, hydratation |
| `hooks/useListeDeCourses.ts` | 207 | orchestration : lire → croiser → agréger, + le geste C0 |
| `components/student/ListeDeCoursesHighlightLink.tsx` | 63 | la carte bleue |
| `components/student/ListeDeCoursesParcours.tsx` | 566 | les quatre écrans |
| `app/(student)/nutrition/courses/page.tsx` | 76 | la route |
| `scripts/tests/liste-de-courses-c1.mts` | 816 | la suite C1 (29 tests) |

### Modifiés — 5

| Fichier | Nature exacte de la modification |
|---|---|
| `app/(student)/nutrition/page.tsx` | la carte bleue est montée **immédiatement sous** `RecipesHighlightLink` ; l'ancienne entrée sobre « Mes courses » → `/courses` est **retirée** (elle menait au parcours interdit) ; deux imports `lucide-react` devenus inutiles sont retirés |
| `components/student/StudentMealChoices.tsx` | **une prop optionnelle** `misEnAvant`, défaut `null` : sans elle l'écran est celui de N1.4 au caractère près. Elle pose une étoile sur une option **déjà présente** ; elle ne filtre pas, ne réordonne pas, n'ajoute pas |
| `lib/nutrition/historique.ts` | **additif seul** : `ajouterJours`, `partiesDeDate`, et `MOIS_FR` désormais exporté (il était privé, il l'utilisait déjà). Aucune fonction existante n'a changé de sortie |
| `app/globals.css` | token `--info` (les deux thèmes) + `--color-info` ; le halo devient paramétré par `--halo-teinte` **dont le défaut est `var(--success)`** ; modificateur `.recettes-halo.halo-info` |
| `package.json` | **une ligne** : `"test:liste-de-courses"`. Ni `test:courses-c1`, ni `test:courses-c1-ui` — ils étaient déjà là, ils n'ont pas bougé |

### Non modifiés, alors qu'on aurait pu le croire

`components/student/RecipesHighlightLink.tsx` — **volontairement intact** (voir §7).
`public/sw.js`, toute migration, toute checklist SQL, `app/(student)/nutrition/[planId]/page.tsx`.

---

## 2. ARCHITECTURE DU PARCOURS

```
/nutrition                          [carte verte RECETTES]
                                    [carte bleue GÉNÉRER MA LISTE DE COURSE]  ← juste dessous
        │
        ▼
/nutrition/courses                  ← PAS /courses, PAS /nutrition/[planId]/courses
        │
        ├─ 1. DURÉE          « Pour combien de jours veux-tu générer ta liste ? »  1…7, AUCUN DÉFAUT
        ├─ 2. PRÉFÉRENCES    les options AUTORISÉES de la période, à marquer en favori
        ├─ 3. REPAS          chaque repas : « Prêt » ou « À COMPOSER » → StudentMealChoices (C0)
        └─ 4. LISTE          MA LISTE DE COURSE + période réelle en sous-titre
```

**Pourquoi `/nutrition/courses`** : une liste appartient à l'**élève** et à des **dates**, jamais à un plan. Si le coach remplace le plan en milieu de semaine, les repas déjà validés restent valides — leur `planned_on` ne bouge pas. Mettre `planId` dans l'URL aurait fabriqué une liste par plan, donc plusieurs listes pour une même semaine.

**État** : `etape` et `duree` vivent dans `ListeDeCoursesParcours`. Le retour recule d'un cran et **ne reperd jamais la durée** ; le retour de l'écran 1 sort vers `/nutrition`. Rien n'est écrit dans l'URL ni en base : aucun besoin de persistance n'est établi en C1.

**Un seul sélecteur d'aliments** : l'écran 3 monte `StudentMealChoices` — le composant de N1.4 / N1.5 / C0 — avec `occurrences`, `cible` et `validation` **identiques** à ceux de l'écran du plan. Aucune seconde interface, donc aucun second arrondi.

---

## 2 bis. LA DURÉE — AUCUNE VALEUR PAR DÉFAUT

> **« Aucun choix » et « le choix 3 » sont deux états différents.**
> Une case pré-cochée est une réponse que l'élève n'a pas donnée : il avance sans lire la question, et repart avec une liste pour une période que personne n'a choisie.

| Point | État |
|---|---|
| type de l'état | `DureeCourses \| null` |
| valeur initiale | `null` — `useState<DureeCourses \| null>(null)` |
| cases cochées à l'ouverture | **aucune** (mesuré sur le rendu : 7 radios, 0 `checked`) |
| bouton de continuation | **désactivé**, et il dit « Choisis une durée » |
| constante `DUREE_COURSES_PAR_DEFAUT` | **supprimée du module** — pas mise à `null` : retirée, pour qu'aucun appelant ne puisse la réimporter « pour initialiser proprement » |
| `construirePeriode(depart, null)` | rend **`null`** |

⚠️ **Le verrou n'est pas visuel.** `construirePeriode` rend `null` tant qu'aucune durée n'est choisie : il n'existe alors littéralement **aucune période** — pas de dates, donc aucune lecture, aucun repas, aucune liste. Le bouton grisé n'est que l'écho de cette absence, il n'en est pas la cause. Un sabotage qui force `desactive={false}` ne débloque donc rien : il rougit sur les deux.

**Les cinq tests demandés**

| Test | Ce qu'il mesure |
|---|---|
| **C1-DUREE-01** | état initial `null` ; constante retirée de tous les fichiers neufs ; aucun `useState(n)` ; **rendu réel** : 7 radios, 0 coché — plus la contre-épreuve (avec `duree=5`, exactement 1 coché, donc le test sait voir une coche) |
| **C1-DUREE-02** | attribut `disabled=""` présent avec `null`, absent avec une durée ; libellé « Choisis une durée » ; `construirePeriode(…, null) === null` ; `repasDeLaPeriode(week, null, …) === []` |
| **C1-DUREE-03** | 1 à 7 acceptés ; `periode.duree` et `periode.jours.length` exacts pour chacun |
| **C1-DUREE-04** | 0, −1, −7, 8, 9, 30, 365, 3.5, NaN, ±Infinity refusés ; ni `value="0"` ni `value="8"` dans le rendu |
| **C1-DUREE-05** | `reculer` et `avancer` ne contiennent **que** `setEtape` ; `setDuree` n'apparaît que 2 fois (déclaration + `onChoisir`) ; aucune `key` ne remonte l'écran de durée |

**Six contrôles négatifs dédiés, tous rouges** : retour d'un `useState(3)` · case pré-cochée via `duree ?? 3` · `desactive={false}` · repli à 3 dans `construirePeriode` · durée 8 rendue valide · `setDuree(null)` glissé dans `reculer`.

---

## 3. AUDIT DES PRÉFÉRENCES — LE RÉSULTAT EST UN **DEMI-STOP**

### 3.1 Ce qui existe et qui est UTILISABLE

**`public.food_favorites`** — migration `20260905090100_food_favorites.sql`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid | |
| `student_id` | uuid → `students(id)` on delete cascade | |
| `catalog_food_id` | uuid → `food_catalog(id)` | **XOR** avec `product_id` (`food_favorites_cible_unique`) |
| `product_id` | uuid → `food_products(id)` | |
| `created_at` | timestamptz | |

Index uniques partiels `(student_id, catalog_food_id)` et `(student_id, product_id)`.
RLS : `student_id = public.current_student_id()` en `for all`. Grants : `select, insert, delete` — **aucun `update`** : un favori s'ajoute et se retire.

**Reader / writer** : `lib/supabase/food-favorites.ts` → `listerFavoris`, `ajouterFavori`, `retirerFavori`, `cleFavori`, types `CibleFavori` / `FavoriEnregistre`.
**UI existante** : `hooks/useRaccourcisAliments.ts` (`estFavori`, `basculerFavori`, garde anti-double-tape), consommé par `AddFoodSheet.tsx` et `ConsumedMealSection.tsx`.

⚠️ **C'est exactement la bonne granularité** : `food_favorites` porte les **mêmes identités** que `meal_choice_options` (aliment du catalogue XOR produit). Une préférence peut donc désigner sans ambiguïté une option autorisée. **C1 la réutilise telle quelle** — aucun système parallèle, aucune nouvelle table, aucune migration.

### 3.2 Ce qui existe mais qui N'EST PAS utilisable ici

| Structure | Où | Pourquoi elle ne convient pas |
|---|---|---|
| `student_profiles.allergies`, `.intolerances`, `.disliked_foods` (jsonb), `.diet_type` (text) | `20260707102630_student_onboarding_columns.sql` | **texte libre, nullable**, saisi à l'onboarding. Le projet s'interdit explicitement de le comparer à un nom d'ingrédient — voir `lib/nutrition/recipe-matching.ts` : « Comparer « arachide » à un nom d'ingrédient produirait des faux négatifs — sur des ALLERGIES. » |
| `nutrition_recipe_tags (kind, value)` | `20260807090000_nutrition_recipes.sql` | vocabulaire **contrôlé** et correct (`allergen` / `intolerance` / `diet` / `excludes`), mais il étiquette des **RECETTES**, pas des aliments. Il n'existe aucune table équivalente pour `food_catalog`. |
| `food_products.allergens_declared text[]` | `20260903090000_food_products.sql` | reprise **déclarative** d'Open Food Facts, dont le commentaire de colonne dit : « Aucune interprétation : ni « sûr », ni « compatible », ni « à éviter ». » Et elle n'existe **que** pour les produits — `food_catalog` n'a **aucune** colonne d'allergène. |
| `StudentDietaryProfile` | `lib/nutrition/recipe-matching.ts` | travaille **uniquement** sur des clés contrôlées. La traduction texte libre → clés « appartient à la PR B et n'existe pas ici » (commentaire du fichier). |

### 3.3 Le STOP, et le modèle minimal proposé

> **Il n'existe aucune structure correcte pour exprimer une EXCLUSION (allergène, intolérance, régime, aliment refusé) au niveau d'un ALIMENT.**

Je **n'ai donc rien implémenté** de ce côté, et je n'ai créé aucune table. L'écran 2 ne propose que du **positif** (favoris A5), qui est adossé à une structure réelle.

**Modèle minimal proposé, pour arbitrage — NON implémenté :**

```sql
-- 1) Étiqueter les ALIMENTS du même vocabulaire contrôlé que les recettes.
create table public.food_catalog_tags (
  catalog_food_id uuid not null references public.food_catalog (id) on delete cascade,
  kind  text not null check (kind in ('allergen','intolerance','excludes')),
  value text not null,          -- MÊME contrainte CHECK que nutrition_recipe_tags
  primary key (catalog_food_id, kind, value)
);
-- (l'équivalent pour food_products peut se DÉRIVER de allergens_declared,
--  mais seulement avec une décision explicite : OFF est déclaratif.)

-- 2) Les contraintes de l'élève, EN CLÉS, décidées par le coach — jamais
--    devinées depuis le texte libre de l'onboarding.
create table public.student_dietary_constraints (
  student_id uuid not null references public.students (id) on delete cascade,
  kind  text not null check (kind in ('allergen','intolerance','diet','excludes')),
  value text not null,
  primary key (student_id, kind, value)
);
```

**Trois questions à trancher avant d'écrire une ligne de SQL** :
1. **Qui remplit `food_catalog_tags` ?** Le catalogue Ciqual fait des milliers de lignes. Sans réponse, la table reste vide et la règle ne protège personne.
2. **Une exclusion FILTRE-t-elle une option du coach, ou l'AVERTIT-elle seulement ?** Filtrer signifie qu'un élève peut se retrouver avec une occurrence sans aucune option choisissable. C'est une décision produit, pas technique.
3. **Une allergie non étiquetée est-elle un silence ou un risque ?** Si un aliment n'a pas de tag, l'absence d'alerte est indistinguable de « cet aliment est sûr ». C'est le point le plus dangereux.

**Rien n'a été fait dans cette direction. J'attends ton arbitrage.**

### 3.4 Ce que C1 fait réellement des préférences

```
préférence (food_favorites)
    → prédicat booléen `misEnAvant(cible) → boolean`
    → étoile posée SUR une option DÉJÀ dans occurrence.options
    → choix de l'élève, inchangé
```

`optionsAutoriseesDeLaPeriode(repas)` ne lit **que** `occurrences[].options`, c'est-à-dire le snapshot du coach. Un aliment ne peut pas entrer dans cette liste par un autre chemin — le test `C1-19` le mesure, et le contrôle négatif qui injecte un aliment hors snapshot rougit.

**Aucun élément de l'ancien système n'a été repris** : ni `lib/courses/preferences.ts`, ni SUGGESTIONS, ni rayons, ni classification banane/skyr, ni `plan_envies` / `plan_habitudes` / `plan_seul`. Le test `C1-20` cherche ces mots dans les huit fichiers neufs.

---

## 4. SOURCE DES DONNÉES

**Quatre requêtes, quelle que soit la période** (`lib/supabase/repas-planifies.ts`) :

| # | Table | Filtre |
|---|---|---|
| 1 | `planned_meals` | `.gte("planned_on", debut).lte("planned_on", fin)` |
| 2 | `planned_meal_items` | `.in("planned_meal_id", …).order("position")` |
| 3 | `food_catalog` | `.in("id", …)` — hydratation du nom |
| 4 | `food_products` | `.in("id", …)` — hydratation du nom |

Sept jours × six repas = **quatre** allers-retours, pas quarante-deux. Aucune requête n'est écrite à l'intérieur d'une boucle — `C1-11` le vérifie sur le texte du fichier.

**Ce que le lecteur ne lit PAS** : `consumed_meals`, `meal_entries`, `meal_choice_options`, `nutrition_days`. Le test énumère les `.from(...)` et compare la liste exacte.

**Aucune écriture** : le lecteur ne contient ni `.insert(`, ni `.update(`, ni `.upsert(`, ni `.delete(`, ni `.rpc(`.

**Pas de filtre `student_id` côté client** : la RLS de `planned_meals` / `planned_meal_items` restreint déjà à l'élève connecté, exactement comme `lireCompositionsValidees` (C0). L'écrire ici donnerait l'illusion que c'est le client qui protège la donnée.

**Champs préservés** : `catalogFoodId`, `productId` (bruts), `choiceSlotId`, `plannedMealId`, `plannedOn`, `mealId`, `slotKey`, `label`, `unit`, `quantity`, `position`. Le nom hydraté est ajouté **à côté**, jamais à la place.

**Nommage** : `food_catalog.name` ; `brand ? "Marque — Produit" : product_name` — la règle exacte de `readNutritionPlanV2Week`, reprise à l'identique.

**`ok: false` ≠ « rien de prévu »** : une lecture ratée affiche « Impossible de lire tes repas prévus », jamais « 21 repas restent à composer ».

### La période

`construirePeriode(depart, duree)` : `duree` ∈ 1..7 **strictement**, bornes **incluses**, `fin = debut + duree - 1`.
`null` pour 0, 8, 30, 3.5, `NaN` — **jamais de troncature silencieuse à 7**.

⚠️ **`nutrition_days.day` n'est jamais traité comme une date.** Le croisement va toujours **date réelle → nom de jour** (`jourDeLaDate`, qui passe par `semaineContenant`), jamais l'inverse. `lib/nutrition/periode-courses.ts` ne contient **aucun `new Date(`** : toute l'arithmétique passe par `ajouterJours` de `historique.ts`, qui possède déjà la convention (année/mois/jour reconstruits en heure locale). **Aucune nouvelle convention de fuseau.**

---

## 5. AGRÉGATION

```
clé = identity_type + identity_id + unit        →  catalog_food:UUID|g   product:UUID|ml
```

| Règle | Comportement mesuré |
|---|---|
| même identité + même unité | **additionnées** — 120 + 90 + 120 = 330 g, 3 sources |
| noms identiques, identités différentes | **2 lignes** — le nom n'entre pas dans la clé |
| `catalog_food:X` vs `product:X` (même UUID) | **2 lignes** |
| g / ml / piece | **3 lignes**, aucune conversion |
| quantité ≤ 0 ou non finie | écartée |

**Aucune conversion, nulle part** : le test cherche `densité`, `convertirUnit`, `toGrams`, `enGrammes` dans les huit fichiers neufs.

**Aucun solveur, aucune macro** : `solveMealChoices`, `meal-choice-solver`, `recipe-solver`, `preferredQuantity`, `preferred_quantity`, `minimumQuantity`, `proteinPer100`, `computeDailyMacroTargets` sont interdits dans les fichiers neufs (`C1-12`). Le moteur d'agrégation ignore jusqu'à l'existence d'un solveur.

**Les quantités viennent uniquement de `planned_meal_items.quantity` / `.unit`** — les entiers que l'élève a vus et validés.

**On n'additionne jamais les options d'une liste** : `NC-04` monte une occurrence à 2 options et vérifie que la composition validée n'en retient qu'**une**.

**Ordre d'affichage** : alphabétique sur le nom, départagé par la clé. C'est un ordre de **rendu** ; deux lignes de même nom restent deux lignes, simplement voisines.

### Couleurs

`meal_choice_slots.color_key` sert d'accent **seulement si toutes les sources d'une ligne sont d'accord**. Sinon `null` — deux couleurs ne se moyennent pas. Elle **n'entre pas dans la clé** : deux sources de couleurs différentes donnent toujours **une** ligne. Aucune agrégation par couleur, aucun rôle nutritionnel dérivé.
La couleur vient de la semaine **déjà chargée** (`couleursParOccurrence`) : pas de cinquième requête — le lecteur ne touche jamais `meal_choice_slots`.

---

## 6. PROVENANCE

Chaque `LigneDeCourses` porte `sources: readonly SourceDeLigne[]`, et chaque source porte `plannedOn`, `mealId`, `plannedMealId`, `choiceSlotId`, `quantity`, `unit`.

**La somme des sources EST la quantité affichée** — le test l'assert (`sources.reduce(+) === quantite`) : il n'existe aucune arithmétique cachée entre les deux.

⚠️ **Elle n'est pas persistée.** Elle vient déjà du planifié ; la recopier ailleurs créerait une seconde vérité à maintenir.

---

## 7. UI DU BOUTON BLEU

**Libellé exact** : `GÉNÉRER MA LISTE DE COURSE` (littéral majuscule dans le JSX, plus `uppercase` en CSS).
**Position** : immédiatement sous `<RecipesHighlightLink />`. Le test vérifie non seulement l'ordre, mais qu'**aucun composant ni lien ne s'intercale** entre les deux.

### La couleur

Il n'existait **aucun token bleu** dans `globals.css` (seulement `--destructive`, `--warning`, `--success`). Il existait en revanche un **mapping bleu partagé** : `COLOR_STYLES.blue` dans `lib/ui/color-keys.ts`, le seul vocabulaire de couleurs du projet.

J'ai donc ajouté `--info` **au même endroit que les trois autres accents sémantiques**, dans la **même famille Tailwind blue** que la clé `blue` du vocabulaire partagé, et **décliné comme `--success` l'est déjà** (400 en sombre, 600 en clair) :

```css
--info: #60a5fa;  /* sombre — blue-400, comme --success: #4ade80 = green-400 */
--info: #2563eb;  /* clair  — blue-600, comme --success: #16a34a = green-600 */
--color-info: var(--info);   /* exposé à Tailwind : bg-info, border-info, text-info */
```

Le composant n'écrit **aucune couleur littérale** — le test cherche `#rgb`, `rgba(`, `hsla(`.

### L'animation — factorisée là où elle coûte

`.recettes-halo` est devenue **paramétrée** :

```css
background: conic-gradient(from var(--recettes-halo-angle), …
  var(--halo-teinte, var(--success)) 72deg, …);
.recettes-halo.halo-info { --halo-teinte: var(--info); }
```

Le défaut reste `var(--success)` : **le bouton Recettes n'a pas changé d'un pixel**. Il n'existe qu'**une** `@keyframes`, qu'**une** déclaration `animation:`, qu'**une** `@property` d'angle — les tests comptent les occurrences. Le repli sous `prefers-reduced-motion` vaut donc pour les deux entrées, sans une ligne de plus.

### Ce que je n'ai PAS refactoré, et pourquoi

§1 proposait de rendre `RecipesHighlightLink` réutilisable. **Je ne l'ai pas fait, délibérément.** La suite `nutrition-v2-unified` (test 45 bis) lit les littéraux `border-success/50`, `bg-success/10`, `recettes-halo`, `href={\`/nutrition/${planId}/recettes\`}` **dans ce fichier précis**. Extraire un composant générique l'aurait vidé de ces chaînes, et il aurait fallu réécrire un test hors périmètre pour retrouver du vert — exactement ce que tu m'as interdit.

La factorisation porte donc sur ce qui **coûte à maintenir** (la règle CSS, ~30 lignes de conic-gradient) et pas sur quinze lignes de balisage. `RecipesHighlightLink.tsx` est **inchangé**, et le test 45 bis reste vert sans y toucher.

Structure commune vérifiée sur les deux composants : `min-h-[44px]`, `rounded-card`, `pressable`, `group`, `ArrowRight`, `transition-colors`, `recettes-halo`.

---

## 8. TESTS

`npm run test:liste-de-courses` → **35 réussis, 0 échec.**
Fichier : `scripts/tests/liste-de-courses-c1.mts` (1 006 lignes). Nom volontairement distinct de `courses-c1*.mts`.

| Test | Couverture |
|---|---|
| C1-01 | libellé exact ; sous Recettes ; **rien ne s'intercale** |
| C1-02 | `border-info/50` + `bg-info/10` + `text-info` ; token dans les deux thèmes ; aucune couleur en dur |
| C1-03 | même classe `recettes-halo` ; **une seule** keyframes / animation / `@property` ; structure commune (6 marqueurs) |
| C1-04 | `/nutrition/courses` existe ; aucun fichier neuf ne pointe vers `/courses` ni `[planId]/courses` |
| C1-05 | 1..7 acceptées ; 0, −1, 8, 30, 3.5, NaN, "3", null, undefined → `null` ; **aucune constante de défaut à valider** |
| C1-06 | lundi + 4 = L/M/M/J ; bornes incluses ; franchit mois et année ; libellés « Du lundi 17 au jeudi 20 août » |
| C1-07 | mercredi exclu d'une période de 2 jours ; composition d'une autre date ne rend pas prêt |
| C1-08 | les deux jours du plan présents, par leurs dates ; repas sans occurrence écarté |
| C1-09 | `pret` / `repasAComposer` exacts ; l'écran l'écrit ; bouton bloqué |
| C1-10 | `composition === null` pour un repas non validé |
| C1-11 | 4 tables exactes ; 0 écriture ; 0 requête dans une boucle |
| C1-12 | 9 symboles interdits, sur 8 fichiers |
| C1-13 / C1-14 | identités catalogue et produit distinctes ; clés exactes ; colonnes brutes préservées |
| C1-15 | 120+90+120 = 330, 3 sources |
| C1-15 bis | couleur unanime / divergente / partielle / absente ; la couleur n'agrège pas |
| C1-16 | même nom ≠ même ligne ; même UUID catalogue/produit ≠ même ligne |
| C1-17 | g/ml/piece → 3 lignes ; aucune densité, aucune conversion |
| C1-18 | provenance exacte ; somme des sources = quantité |
| C1-19 | options = snapshot seul ; prédicat booléen ; aucun `.filter`/`.sort` sur `occurrence.options` ; favoris A5 réutilisés |
| C1-20 | 5 chemins d'import + 6 mots de l'ancien vocabulaire, sur 8 fichiers |
| C1-21 | dernière migration = C0.1 ; **80** migrations |
| C1-22 | 3 noms de tables absents des migrations et du code ; cochage local ; hook sans écriture directe |
| C1-23 | `min-w-0`, `truncate`, `flex-shrink-0`, `whitespace-nowrap`, `tabular-nums`, repli 4→7 colonnes ; formats |
| C1-24 | toutes les cibles `pressable` ≥ 44 px ; radios natifs + fieldset/legend ; 3 `aria-*` ; focus visible sur **toutes** les cibles ; état écrit et pas seulement coloré |
| C1-SUP | identités résolues depuis le seul snapshot ; option inconnue → deux identités nulles |
| **C1-DUREE-01…05** | voir §2 bis — aucune durée par défaut, blocage tant que `null`, 1..7, refus hors bornes, choix conservé au retour |
| **C1-FUTUR** | « Reprendre ma semaine passée » n'est **pas** implémentée : 6 amorces de nom absentes des 8 fichiers neufs, `type Etape` toujours à quatre membres, et la documentation existe avec ses interdits |

### Suites rejouées (§24)

| Suite | Résultat |
|---|---|
| `test:courses-c0` | **16 / 16** |
| `nutrition-n1-6-enregistrement` | **14 / 14** |
| `nutrition-n1-5-quantites` | **112 / 112** |
| `nutrition-n1-4-choix-eleve` | **16 / 16** |
| `nutrition-contract-preferred-unit` | **6 / 6** |
| `nutrition-v2-unified` | **74 / 74** (dont 45 bis, le bouton Recettes) |
| `aliments-a5-coach` / `aliments-a5-history` | **11 / 11** et **26 / 26** |
| `npx tsc --noEmit` | **0 erreur** |
| `eslint app components hooks lib scripts` | **0 erreur, 0 avertissement** |
| diff-check (espaces finaux, CRLF, marqueurs de conflit) | **propre** sur les 14 fichiers |

`courses-c1` et `courses-c1-ui` : voir §0 — rouges attendus, non touchés.

---

## 9. CONTRÔLES NÉGATIFS

Chaque sabotage est appliqué **seul**, la suite est relancée, le fichier est restauré depuis une copie de référence et **son md5 revérifié**. Script : `/root/banc-c1/sabotages.py`.

| Contrôle négatif | Verdict | Test qui rougit |
|---|---|---|
| NC-01 · import de `@/lib/courses/agregation` | **ROUGE** | C1-20 / NC-01 |
| NC-02 · la clé d'agrégation devient dépendante du nom | **ROUGE** | C1-13/14 + C1-16 |
| NC-03 · `solveMealChoices` importé dans les courses | **ROUGE** | C1-12 |
| NC-04 · toutes les options d'une liste additionnées | **ROUGE** | C1-09/10 |
| NC-05 · `preferred_quantity` ajoutée à la quantité | **ROUGE** | C1-12 |
| NC-06 · la préférence FILTRE les options du snapshot | **ROUGE** | C1-19 |
| NC-07 · durée 8 acceptée | **ROUGE** | C1-05 + NC-07 |
| NC-08 · `new Date(...)` réintroduit dans le module période | **ROUGE** | NC-08 |
| NC-09 · le bouton passe au-dessus de Recettes | **ROUGE** | C1-01 + NC-09/10 |
| NC-10 · animation recopiée au lieu d'être partagée | **ROUGE** | C1-03 + NC-09/10 |
| C1-17 · fonction de conversion d'unité introduite | **ROUGE** | C1-17 |
| C1-21 · une migration ajoutée au dépôt | **ROUGE** | C1-21 |
| C1-22 · `shopping_list_state` mentionné | **ROUGE** | C1-22 |
| C1-11 · un `.update()` glissé dans le lecteur | **ROUGE** | C1-11 |
| C1-04 · retour de `href="/courses"` | **ROUGE** | C1-04 |
| C1-19 · un aliment injecté hors snapshot | **ROUGE** | C1-19 |

| **C1-DUREE-01** · retour d'un `useState(3)` | **ROUGE** | C1-DUREE-01 + C1-DUREE-05 |
| **C1-DUREE-01 bis** · case pré-cochée (`duree ?? 3`) | **ROUGE** | C1-DUREE-01 |
| **C1-DUREE-02** · `desactive={false}` | **ROUGE** | C1-DUREE-02 |
| **C1-DUREE-02 bis** · repli à 3 dans `construirePeriode` | **ROUGE** | C1-05 + C1-DUREE-02 |
| **C1-DUREE-04** · 8 devient une durée valide | **ROUGE** | C1-05 + C1-DUREE-01 |
| **C1-DUREE-05** · `setDuree(null)` glissé dans `reculer` | **ROUGE** | C1-DUREE-05 |

**21 sabotages, 21 rouges, 21 restaurations md5-identiques.**

---

## 10. RESPONSIVE

Banc : `/root/banc-c1` — **vrais composants** rendus en SSR, **vrai CSS Tailwind** du projet recompilé depuis `app/globals.css` (tokens `--info` compris, 136 595 octets), Chromium réel, `deviceScaleFactor: 2`.

Conditions volontairement dures : 7 jours × 3 repas = **21 repas** ; libellés d'occurrence à rallonge ; noms Ciqual complets (« Céréales de petit-déjeuner enrichies en vitamines et minéraux, aux pétales de maïs ») ; une marque interminable ; quantités à **quatre chiffres** (1 250 g, 3 980 g) ; trois unités.

| Écran | 375 | 390 | 430 | 768 | 1440 | cible la plus petite |
|---|---|---|---|---|---|---|
| 01 durée | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px (8 cibles) |
| 02 préférences | ✓ | ✓ | ✓ | ✓ | ✓ | 46 px (85 cibles) |
| 03 repas | ✓ | ✓ | ✓ | ✓ | ✓ | 46 px (22 cibles) |
| 04 liste | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px (5 cibles) |

`scrollWidth == clientWidth` partout ; **0 élément** dont le bord droit dépasse. Libellés attendus présents à 375 px sur les quatre écrans.

### Le banc est falsifiable — deux fois

1. Retrait de `min-w-0` / `truncate` / `flex-shrink-0` / `whitespace-nowrap` → **1 mesure rouge** : `scrollWidth 385/375`, la colonne quantité déborde à 375 px.
2. Remplacement de `truncate` par `whitespace-nowrap` sur les noms → **6 mesures rouges**.

Restauration vérifiée par md5 après chaque sabotage.

⚠️ **Limite honnête** : l'écran 3 est mesuré **occurrences repliées** (c'est son état au chargement). L'état déplié est celui de `StudentMealChoices`, déjà mesuré aux cinq largeurs par le banc C0.

---

## 11 bis. EXTENSION FUTURE DOCUMENTÉE — « REPRENDRE MA SEMAINE PASSÉE »

**Documentée, NON implémentée.** Aucun écran, aucune migration, aucune logique de copie.
Document : **`docs/courses-reprendre-semaine-passee.md`**. Rappel ancré aussi dans `lib/supabase/repas-planifies.ts`, là où le code s'écrirait.

**Ce que l'architecture C1 prévoit déjà** — et qui n'aura donc pas à être réécrit :

| Brique | Pourquoi elle convient telle quelle |
|---|---|
| `lireRepasPlanifiesSurPeriode(supabase, debut, fin)` | ne connaît que **deux dates**. Lui passer la période précédente rend les choix et quantités réellement validés alors — mêmes identités, mêmes unités, mêmes `choice_slot_id` |
| `repasDeLaPeriode(week, periode, compositions)` | reçoit déjà une carte `${mealId}\|${date}` → composition. La reprise consistera à **fabriquer cette carte**, décalée |
| `agregerListeDeCourses` | ne sait pas d'où viennent ses items. Rien à changer |

Reste à écrire, le jour venu : **une projection** (décalage des dates, appariement des occurrences), **une garde** (snapshot actuel), **un écran**.

**Source future** : `planned_meals` + `planned_meal_items` de la période précédente. **Rien d'autre.**

**Interdits** : `consumed_meals` · `meal_entries` · parcours de toutes les `meal_choice_options` · `preferred_quantity` · toute reconstruction **par nom**.

**La règle qui décide de tout** : un choix repris doit **encore exister** dans les `meal_choice_options` du plan **actuellement autorisé**, pour l'occurrence visée. Sinon il n'est **pas** réinjecté silencieusement — l'occurrence reste « À COMPOSER » et l'élève est prévenu.
⚠️ Ce n'est pas une protection : la base refuserait déjà l'écriture (clés étrangères composites `planned_meal_items_option_autorisee_food` / `..._product`). C'est une question **d'interface** — le dire dans une phrase plutôt que d'échouer sous ses yeux.

**Quatre points à arbitrer avant d'écrire une ligne** : quelle est « la semaine précédente correspondante » (7 jours glissants ou semaine calendaire) · que faire d'une semaine partiellement validée · la reprise écrit-elle ou propose-t-elle · interaction avec le verrou C0.1 (`REPAS_DEJA_CONSOMME`).

Le test **C1-FUTUR** vérifie qu'aucune ligne n'a commencé à être écrite.

---

## 12. TRANSFERT MAC — PRÉPARÉ, NON EXÉCUTÉ

**État du Mac (lecture seule)** : branche `feat/nutrition-structured-meals`, HEAD `ceeabb0`, **arbre propre**, 80 migrations, dernière = `20260914090000_c0_1_verrou_repas_consomme.sql` — identique au conteneur.

⚠️ **`.git/index.lock` est présent** (`.git/index.lock`, 0 octet, 16 août). Conformément à la consigne, **je ne l'ai pas supprimé depuis le pont** — je le signale seulement. `git status --short` fonctionne malgré lui (il ne parvient simplement pas à le retirer en fin d'opération).

✅ **Le Mac ne contient AUCUN fichier de l'ancien chantier Courses** — vérifié : `app/(student)/courses`, `lib/courses`, `hooks/useCourses.ts`, `components/student/Courses*.tsx`, `scripts/tests/courses-c1*.mts`, `docs/courses-c1-*.md` sont tous absents. La dérive n'a jamais été transférée.

✅ **Aucun fichier C1 n'existe encore sur le Mac** : les 11 créations sont bien des créations.

### Liste blanche — 15 chemins, contrôlée

Le contrôle anti-ancien-C1 est passé sur la liste elle-même : **0 correspondance** avec `(student)/courses`, `lib/courses/`, `hooks/useCourses.ts`, `components/student/Courses*`, `scripts/tests/courses-c1*`, `docs/courses-c1-*`, `public/sw.js`, `package.json`, `supabase/migrations/`.

> ⚠️ **Ce contrôle a servi.** Il a rejeté mon propre livrable, initialement nommé `docs/courses-c1-parcours-livrable.md`, qui tombait sous le motif interdit `docs/courses-c1-*.md`. Il a été **renommé `docs/liste-de-courses-livrable.md`** pour que la liste blanche reste sans ambiguïté.

| md5 (conteneur) | Chemin | Nature |
|---|---|---|
| `09d9b61935f4` | `lib/nutrition/periode-courses.ts` | créé |
| `9dc67cc33aed` | `lib/nutrition/liste-de-courses.ts` | créé |
| `9776d33f12a7` | `lib/nutrition/repas-de-la-periode.ts` | créé |
| `8749f6c97c8c` | `lib/supabase/repas-planifies.ts` | créé |
| `50651db5fc48` | `hooks/useListeDeCourses.ts` | créé |
| `9d5611bba401` | `components/student/ListeDeCoursesHighlightLink.tsx` | créé |
| `a6ce8286b2ad` | `components/student/ListeDeCoursesParcours.tsx` | créé |
| `04635ed989e5` | `app/(student)/nutrition/courses/page.tsx` | créé |
| `a8212040eb36` | `scripts/tests/liste-de-courses-c1.mts` | créé |
| `435f759f6bbb` | `docs/courses-reprendre-semaine-passee.md` | créé |
| `3a35dce0f9cf` | `docs/liste-de-courses-livrable.md` | créé (ce fichier) |
| `d390d21a90f3` | `app/(student)/nutrition/page.tsx` | modifié — carte bleue sous Recettes, retrait de l'entrée `/courses` |
| `853776636cc7` | `components/student/StudentMealChoices.tsx` | modifié — prop optionnelle `misEnAvant`, défaut `null` |
| `2a91760604dd` | `lib/nutrition/historique.ts` | modifié — additif : `ajouterJours`, `partiesDeDate`, `MOIS_FR` exporté |
| `e20e184563bb` | `app/globals.css` | modifié — token `--info`, halo paramétré par `--halo-teinte` |

*(les md5 de ce tableau seront recalculés au moment du transfert : ce fichier se modifie lui-même en les écrivant)*

### `package.json` — édition CHIRURGICALE, jamais copié

**Une seule ligne à ajouter**, à la suite de `"test:courses-c0"` :

```json
"test:liste-de-courses": "npx tsx scripts/tests/liste-de-courses-c1.mts"
```

⚠️ Le `package.json` du conteneur **ne doit pas être copié** : il porte `test:courses-c1` et `test:courses-c1-ui`, absents du Mac. L'édition se fait **sur place**, sur le fichier du Mac.

### Procédure prévue

1. archive **liste blanche uniquement** (`tar -czf … -T liste-blanche.txt`), jamais de `rsync` global, jamais de dossier parent ;
2. `mkdir -p` des deux dossiers neufs (`app/(student)/nutrition/courses`) ;
3. `tar -xzf … --overwrite` sur le Mac ;
4. édition chirurgicale d'une ligne de `package.json`, puis preuve par `grep` : `test:liste-de-courses` **une fois**, `test:courses-c1` et `test:courses-c1-ui` **zéro fois** ;
5. **md5 croisé** conteneur ↔ Mac sur les 15 chemins — 15/15 attendus ;
6. `git status --short` (attendu : 11 `??` + 4 `M` + `package.json` `M`) et `git diff --check` ;
7. contrôle : 80 migrations, aucun fichier `courses-c1` créé ;
8. sur le Mac : `npx tsc --noEmit`, `npx eslint`, puis les suites `test:liste-de-courses`, `test:courses-c0`, `test:nutrition-n1-6-*`, `n1-5`, `n1-4`, `contract`.

**Rien de tout cela n'a été exécuté.** Aucun octet n'a été écrit sur le Mac.

---

## 13. CE QUI RESTE POUR C2

1. **Persistance de la liste** — `shopping_lists` / `shopping_list_items` / `shopping_list_state`. Le cochage de C1 est **local** et le dit à l'écran (« Le cochage n'est pas enregistré : il disparaîtra si tu quittes cet écran »). Rien à migrer avant que le besoin soit établi.
2. **Les exclusions alimentaires** — le STOP de §3.3, avec ses trois questions ouvertes. C'est le point le plus important, et le plus sensible : il touche des allergies.
3. **Unifier `resoudreIdentites`** — il en existe aujourd'hui **deux** implémentations identiques : celle en ligne dans `app/(student)/nutrition/[planId]/page.tsx` et `identitesDeChoix` dans `lib/nutrition/repas-de-la-periode.ts`. Je ne les ai pas fusionnées parce que `courses-c0-validation.mts:140-142` lit le code **littéral** de la page ; les unifier obligeait à réécrire ce test hors périmètre. À faire en C2, **avec** la mise à jour du test dans le même lot.
4. **Point de départ de la période** — C1 part toujours d'aujourd'hui. §4 laissait ouverte « la date sélectionnée » ; aucun sélecteur de date n'existe encore dans ce parcours.
5. **Repas sans occurrence de liste** — ils sont écartés du parcours (ils ne peuvent produire aucun `planned_meal_item`). Si un plan mélange repas structurés et repas libres, l'élève n'a aujourd'hui aucun moyen de mettre les seconds en courses.
6. **Ménage de l'ancien C1** — les fichiers du §0 restent dans le conteneur, et leurs deux suites sont rouges. Les supprimer (code, tests, docs, deux scripts npm) est un lot à part entière, à décider explicitement.
7. **Unité `piece`** — la base l'accepte (`planned_meal_items_unit_check`), `ItemChoixAValider.unit` est typé `"g" | "ml"`. L'agrégation et l'affichage la gèrent déjà ; le chemin d'écriture, non.

---

## RAPPEL FINAL

Aucune migration (80, la dernière reste `20260914090000_c0_1_verrou_repas_consomme.sql`).
Aucun `db push`. Aucun commit. Aucun push. Aucun transfert Mac.
Aucun fichier de l'ancien chantier Courses lu pour concevoir, importé, copié ou modifié.
