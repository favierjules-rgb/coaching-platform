# COURSES C1 — LIVRABLE

**Aucune migration. Aucun `db push`. Aucun merge. Non commité.**
C1 est un **moteur pur** : cinq modules sans React, sans Supabase, sans réseau.

---

## 1. Résultat C1.0 — mesuré sur la base de production, en lecture seule

| grandeur | valeur |
|---|---:|
| plans nutritionnels | **12** (aucun archivé) |
| jours de plan | 84 |
| repas prescrits | **296**, dont 240 avec des `items` |
| recettes | **17**, toutes `status = 'active'` |
| ingrédients de recette | 100, soit **5,9 par recette** |
| recettes **exploitables par le solver** | **17 / 17 (100 %)** |
| aliments Ciqual | 3 330 · produits : 69 |
| entrées de journal | 21 · favoris : 2 |

**Couverture par créneau** — et c'est le chiffre qui compte le plus :

| créneau | recettes |
|---|---:|
| petit-déjeuner | 3 |
| déjeuner | **1** |
| dîner | 3 |
| dessert | 4 |
| sans créneau (utilisables partout) | 6 |

**Risque d'agrégation, mesuré** : 100 ingrédients, **80 libellés distincts**,
**16 libellés présents dans plusieurs recettes**. Sans le regroupement par
libellé validé en décision 3, ces 16-là produiraient des doublons sur la liste.

Autres mesures : **1** ingrédient quantifiable (`unit_scalable`), **1** unité
libre, **0** ingrédient œuf, **8** ingrédients liés.

⚠️ **Une correction en cours de mesure.** Ma première requête comptait les
recettes `status = 'published'` et rendait **0** — le vocabulaire réel est
`active`. La mesure a corrigé la question ; sans elle, ce rapport aurait
annoncé « aucune recette exploitable ».

**Ce que cette mesure change, et ce qu'elle ne change pas.** Elle ne modifie pas
le contrat C1. Elle dit deux choses utiles : le solver couvre **100 %** des
recettes existantes, et le **déjeuner n'a qu'une recette** — sur sept jours,
elle reviendra forcément. Le moteur ne le corrige pas artificiellement : il
l'**annonce** (`variete_limitee`), parce que c'est l'état du catalogue, pas un
défaut d'algorithme.

---

## 2. Architecture finale

```
        PÉRIODE (1..7 dates, départ libre)
                    │
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
PLAN            ENVIES          HABITUDES / FAVORIS
(contrainte)    + exclusions    (A5.7 / A5)
   │                │                │
   └────────────────┴────────────────┘
                    ▼
   lib/courses/  — cinq modules PURS
   ├── periode.ts     dates réelles, cibles PROPRES à chaque jour
   ├── preferences.ts envies, exclusions, normalisation
   ├── selection.ts   score déterministe, pénalité de répétition plafonnée
   ├── besoins.ts     boucle jours × créneaux → buildRecipeTargetForMealSlot
   │                                          → solveRecipe (EXISTANT)
   └── agregation.ts  identité + unité, rayons, provenance
                    ▼
        ResultatCourses { dates, repas, lignes, avertissements }
```

---

## 3. Fichiers créés / modifiés

| fichier | état |
|---|---|
| `lib/courses/periode.ts` | **nouveau** |
| `lib/courses/preferences.ts` | **nouveau** |
| `lib/courses/selection.ts` | **nouveau** |
| `lib/courses/besoins.ts` | **nouveau** |
| `lib/courses/agregation.ts` | **nouveau** |
| `components/student/CoursesListe.tsx` | **nouveau** |
| `scripts/tests/courses-c1.mts` | **nouveau** |
| `package.json` | modifié (`test:courses-c1`) |

**Aucun fichier existant n'a été modifié.** Ni le plan, ni les recettes, ni le
solver, ni A5.7.

---

## 4. Moteur période

`construirePeriode(debut, nbJours)` → `{ debut, nbJours, dates[] }`, ou `null`.

- Bornes **1..7** fermes des deux côtés ; `0`, `8` et `1.5` sont refusés.
- Départ libre : `2026-08-17` + 7 → lundi 17 → dimanche 23.
- Traverse les mois, les années et le 29 février (testé).
- **Jamais `new Date("2026-08-14")`** : cette forme est interprétée en UTC et
  décalerait la période d'un jour à l'est de Greenwich. Découpage en Y/M/D puis
  construction locale, comme en A5.7.
- `2026-02-31` est **refusé** : `Date` le décalerait silencieusement au 3 mars.
- `jourTypeDe` applique la convention lundi-première (`(getDay() + 6) % 7`) :
  dimanche est le 7ᵉ jour, pas le premier.

`joursDeLaPeriode` rend, pour chaque date, **ses** cibles via
`dailyTargetsForDay` — donc `computeDailyMacroTargets`. Aucune formule réécrite.

---

## 5. Moteur préférences

Neuf catégories, suggestions rapides, recherche libre, « peu importe »
(= ne rien cocher), exclusions temporaires.

**Une préférence n'est pas un aliment.** Mesuré : « bœuf » recouvre 51 aliments
Ciqual dont les protéines vont de 17,2 à 39,2 g/100 g. Une envie est donc un
**filtre**, et le test C1-07 vérifie qu'aucune ligne générique « Bœuf » n'est
jamais créée — la ligne porte le libellé réel de l'ingrédient retenu.

**Correspondance par mot entier**, avec tolérance au pluriel simple. Une
comparaison par sous-chaîne ferait correspondre « riz » à « chorizo » : au mieux
ridicule, au pire un aliment exclu qui passe. `estExclu("Chorizo", ["riz"])` est
**faux**, et c'est testé.

**Les exclusions sont temporaires par construction** : elles vivent dans l'objet
passé en argument. Le moteur ne nomme ni `student_profiles`, ni allergie, ni
restriction — C1-09 le vérifie sur le source *et* sur l'objet, inchangé après
génération.

---

## 6. Moteur sélection de recettes

Score déterministe, sans apprentissage :

| signal | poids |
|---|---:|
| exclusion | **élimination** (`null`, pas un score bas) |
| envie satisfaite | +100 par ingrédient |
| favori | +30 |
| habitude | +10 (**présence**, pas volume) |
| répétition | −20, **plafonné à 3** |

Départage : score, puis nom en français, puis identifiant — même convention que
`recipesForSlot`, donc deux exécutions rendent la même liste.

**Le score regarde les INGRÉDIENTS, jamais le titre.** Une recette « Bowl du
sportif » contenant du poulet bat une « Poulet riz » qui n'en contiendrait pas.
Testé (C1-06).

**L'habitude compte pour sa présence, pas pour son volume** : sans ce
plafonnement, un aliment consommé quarante fois écraserait une envie explicite —
l'inverse exact de la hiérarchie du §6. Testé avec `habitudes: { poulet: 40 }`
contre `envies: ["boeuf"]` : le bœuf gagne.

**Le plafond de répétition est le cœur du §5**, et il porte les deux moitiés de
la règle : une envie unique (+100) l'emporte toujours sur la pénalité maximale
(−60), donc un élève qui ne veut que du poulet a du poulet **les sept jours**
(C1-14) ; et entre candidats à score égal, la pénalité crée la variété (C1-13).

---

## 7. Utilisation du solver

```ts
const cible = buildRecipeTargetForMealSlot(profil, slot);   // existant
const solution = solveRecipe(choisie.recette.recipe, { target: cible.target });
```

**Aucune formule de portion n'est réécrite.** C1-15 interdit `* 4`, `* 9`,
`/ 100`, `minGrams`, `maxGrams` et `referenceGrams` dans le moteur. Les bornes,
les unités quantifiables, les œufs et les ingrédients liés restent ceux du
solver.

C1-16 le prouve par le comportement : à cible constante de recette, une journée
à 3 000 kcal demande **400 g** de poulet là où une journée à 2 000 en demande
**255 g**.

⚠️ **Une limite du solver à connaître** : un ingrédient de rôle `free` reçoit
**0 g** — il n'est pas quantifié. Il n'apparaît donc pas sur la liste de
courses. C'est le comportement voulu du solver (assaisonnements, salade), mais
cela veut dire qu'un aliment saisi en `free` dans une recette ne sera jamais
acheté. À surveiller lors de la saisie des recettes.

---

## 8. Agrégateur courses

Clé = **identité + unité**. Priorité d'identité :

1. `catalog_food_id` → `catalog_food:<id>`
2. `product_id` → `product:<id>`
3. libellé normalisé → `recipe_ingredient:<libellé>` — **uniquement** pour les
   ingrédients de recette

Le **type est en préfixe** : un même `uuid` dans deux tables reste deux choses
(C1-22).

**Le niveau 3 est borné et ne contamine rien.** Un `catalog_food` ou un
`product` ne descend jamais au libellé, même identique — C1-23 le vérifie
explicitement, et C1-21 garde le pire cas : deux GTIN, même libellé au mot près,
**deux lignes**.

Tri déterministe : rayon, quantité décroissante, libellé, identité.

---

## 9. Gestion des unités

| cas | résultat |
|---|---|
| g + g | additionné |
| ml + ml | additionné |
| pièce + pièce | additionné |
| **g + ml** | **deux lignes** — jamais fusionnées |
| 2 wraps + 4 wraps | **6 wraps** |
| 2 wraps + 64 g | **deux lignes** |

Aucune densité, aucun facteur, aucune conversion dans le code — C1-20 interdit
`densite`, `density`, `convert`, `1.03`, `mlVersG`. Les unités libres de recette
(« wrap », « tranche ») sont conservées telles quelles et ramenées au singulier
pour que l'agrégation colle (`uniteDepuisLibelle("2 wraps (64 g)")` → `wrap`).

---

## 10. Provenance

Chaque ligne conserve d'où vient chaque gramme :

```
Poulet — 600 g
  vendredi · déjeuner · Poulet riz : 180 g
  samedi   · dîner    · Poulet riz : 220 g
  dimanche · déjeuner · Poulet riz : 200 g
```

C1-29 vérifie que **la somme des provenances est exactement la quantité** — si
elle divergeait, la ligne mentirait sur son origine, et C2 ne pourrait pas
retirer un jour sans tout recalculer.

---

## 11. Exemple concret — 1 jour

```
COURSES · 1 JOUR · le 14 août
 PROTÉINES     Oeufs 350 g · Boeuf 5 % 349 g
 FÉCULENTS     Pates 220 g · Flocons d'avoine 134 g
 AUTRES        Huile colza 31 g
 (2 repas retenus)
```

---

## 12. Exemple concret — 3 jours

```
COURSES · 3 JOURS · du 14 au 16 août
 PROTÉINES     Oeufs 1 033 g · Boeuf 5 % 698 g · Poulet 420 g
 FÉCULENTS     Riz basmati 600 g · Pates 440 g · Flocons d'avoine 426 g
 AUTRES        Huile colza 62 g · Beurre de cacahuète 60 g · Huile olive 48 g
 (6 repas retenus · variete_limitee)
```

Le poulet **et** le bœuf apparaissent : la pénalité de répétition a fait varier
les déjeuners sans qu'aucune envie ne soit exprimée.

---

## 13. Exemple concret — 7 jours

```
COURSES · 7 JOURS · du 14 au 20 août
 PROTÉINES     Oeufs 2 714 g · Boeuf 5 % 1 570 g · Poulet 1 078 g
 FÉCULENTS     Riz basmati 1 714 g · Flocons d'avoine 1 040 g · Pates 990 g
 AUTRES        Huile colza 140 g · Huile olive 124 g
 (14 repas retenus)
```

Les quantités ne sont **pas** celles d'un jour × 7 : les jours alternent deux
profils (2 400 / 3 000 kcal), et chaque date a été résolue séparément.

---

## 14. Tests C1 — 31 tests, 0 échec

`npm run test:courses-c1` — C1-01..C1-30 + C1-SUP. Le moteur étant pur, **tout
est exécuté** : période, préférences, sélection, **vrai solver**, agrégation.

Deux tests ont été **corrigés par la mesure**, et c'est la partie utile :

- **C1-16** comparait le riz entre deux jours. Le riz sature son `maxGrams` les
  deux jours — ses quantités sont donc légitimement **égales**, et l'asserter
  faisait échouer un solver parfaitement correct. Le test compare désormais un
  ingrédient qui peut varier, et le dit.
- **C1-16 (bis)** supposait la même recette les deux jours ; la pénalité de
  variété en choisissait une autre. Le test force donc une envie, sinon il
  comparait deux plats au lieu de deux cibles.

---

## 15. Contrôles négatifs — huit, exécutés puis restaurés

| cassé volontairement | rouges |
|---|---:|
| moyenne journée × N | **1** |
| préférence utilisée comme identité | **4** |
| fusion de GTIN différents | **2** |
| fusion g / ml | **2** |
| parser `meals.items` comme identité fiable | **1** |
| modifier le plan du coach | **1** |
| ignorer les exclusions | **2** |
| supprimer la pénalité de répétition | **1** |

```
RESTAURATION VÉRIFIÉE : aucun écart
# pass 31 # fail 0
```

---

## 16. Non-régression — 592 tests, 0 échec

| suite | | suite | |
|---|---|---|---|
| `aliments-a1` | 16 / 0 | `nutrition-recipe-solver` | 25 / 0 |
| `aliments-a2` | 42 / 0 | `nutrition-recipes` | 45 / 0 |
| `aliments-a3` | 19 / 0 | `nutrition-recipes-admin` | 65 / 0 |
| `aliments-a3-ui` | 25 / 0 | `nutrition-recipe-images` | 46 / 0 |
| `aliments-a3-search` | 36 / 0 | `nutrition-macro-targets` | 15 / 0 |
| `aliments-a4-scan` | 25 / 0 | `nutrition-meal-distribution` | 23 / 0 |
| `aliments-a4-ui` | 30 / 0 | `nutrition-plan-v2-guards` | 18 / 0 |
| `aliments-a5` | 26 / 0 | `nutrition-plan-v2-builder` | 72 / 0 |
| `aliments-a5-jour` | 16 / 0 | `nutrition-single-assigned-plan` | 28 / 0 |
| `aliments-a5-history` | 26 / 0 | `nutrition-v2-unified` | 74 / 0 |
| `aliments-a5-coach` | 11 / 0 | `nutrition-linebreaks-rpe-halves` | 14 / 0 |
| `aliments-a5-responsive` | 17 / 0 | `security-hardening` | 31 / 0 |
| **`courses-c1`** | **31 / 0** | | |

Le solver et les recettes sont inclus délibérément : C1 les consomme.

---

## 17. `tsc`

```
npx tsc --noEmit    → exit 0
```

## 18. `eslint`

```
npx eslint .        → exit 0
```

## 19. `git diff --check`

À exécuter sur le Mac après transfert — le miroir du conteneur n'est pas un
dépôt git.

## 20. `git status`

Les huit fichiers du §3, non commités, rien de stagé, aucun merge.

**Rappel** : `cd ~/Documents/coaching-platform && rm -f .git/index.lock` avant
ton commit (le pont ne peut pas supprimer de fichiers).

---

## Ce qu'il reste à décider pour C2

1. **Le déjeuner n'a qu'une recette en production.** Le moteur le signale
   (`variete_limitee`) mais ne peut pas l'inventer. Enrichir le catalogue est un
   travail de contenu, pas de code.
2. **Les ingrédients `free` ne sont jamais quantifiés** (0 g par le solver) :
   ils n'apparaissent pas sur la liste. À trancher — soit c'est voulu
   (assaisonnements), soit certains ingrédients sont mal typés.
3. **La persistance** (cases cochées, liste gardée, partage, budget) reste hors
   C1, comme validé au §C1.10.
