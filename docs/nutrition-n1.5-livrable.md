# N1.5 — Calcul global des quantités du repas après les choix élève

Branche `feat/nutrition-structured-meals`. **Aucune migration.** Aucun commit, aucun push,
aucun merge, aucun `db push`.

| | |
|---|---|
| Tests N1.5 | **44**, 0 échec |
| Contrôles négatifs | **15 / 15 discriminants**, restauration vérifiée par md5 |
| Contrôle du banc responsive | **1**, il bascule quand on l'abîme |
| Suites de non-régression | **15**, toutes vertes |
| `npx tsc --noEmit` | propre |
| `npx eslint .` | propre |
| Migration | **aucune**, et aucune n'était nécessaire |

---

## 1. Audit avant code — ce qui a été réutilisé, et ce qui ne pouvait pas l'être

**`lib/nutrition/recipe-solver.ts` — réutilisé pour les tolérances, PAS pour l'algèbre.**
`solveRecipe` résout un système **carré** : ses inconnues sont les trois ratios de groupe
(`protein` / `carbohydrate` / `fat`), toujours trois, appliqués à un `referenceGrams` posé par
l'auteur de la recette. `det2` / `det3` (Cramer) sont donc exactement le bon outil là-bas.

Ici les inconnues sont les **aliments**, et il y en a un, cinq ou dix. Une matrice 3×10 n'a pas
de déterminant : Cramer ne s'applique pas. Et il n'existe **aucun `referenceGrams`** — le coach
a donné une liste d'aliments, pas une recette. Ce qui a pu être repris tel quel :

- `determineStatus(deltas, target)` et ses trois constantes exportées
  (`EXACT_TOLERANCE_GRAMS = 0,5`, `APPROXIMATE_TOLERANCE_GRAMS = 5`,
  `APPROXIMATE_TOLERANCE_RATIO = 0,1`) — **importées, pas recopiées**. Deux tolérances
  différentes pour deux écrans du même produit auraient été un défaut ;
- `KCAL_PER_GRAM` de `macro-targets.ts` pour dériver les calories.

**La cible du repas — chemin existant, sans détour.** `slotMacrosForDay(week, day, slot)`
compose `computeDailyMacroTargets` puis `computeMealDistribution` ; `slotTargetForDay` délègue à
`buildRecipeTargetForMealSlot`, qui compose les deux mêmes fonctions. `StudentPrescribedWeek`
résolvait **déjà** cette valeur pour l'afficher en tête du repas (avec la règle héritée : un
repas antérieur au modèle v2 garde ses macros saisies à la main). N1.5 **reçoit cette
valeur-là**, il ne la recalcule pas — l'en-tête du repas et la ligne « CIBLE DU REPAS » ne
peuvent donc pas dire deux nombres différents.

**Les macros — `food_catalog` et `food_products`, mêmes colonnes, mêmes contraintes.**
`protein_per_100` / `carb_per_100` / `fat_per_100` sont `numeric not null`, `>= 0`, et
`nutrition_unit` est contraint à `('g','ml')` des deux côtés. PostgREST les rend en **chaîne** :
la conversion se fait une seule fois, à la lecture.

**Unités — mesuré, pas supposé.**

- `quantite_en_base_nutritionnelle` (migration 20260901090000) est la **seule** mécanique
  d'unité du dépôt. Elle accepte l'unité de l'aliment telle quelle, accepte la **pièce**
  uniquement si `piece_weight_g` est renseigné **et** que la nutrition est en grammes, et refuse
  tout le reste. Son commentaire le dit : « aucune conversion ml ↔ g n'est inventée ».
- `piece_weight_g` est **nul sur tout le catalogue global** : la migration Ciqual
  (20260902090100, 2 734 lignes) ne l'inclut même pas dans sa liste d'insertion, et aucun chemin
  ne l'écrit. **Vérifié par un test** (`N1.5-SOLVE-18`).
- Conséquence : N1.5 ne produit **jamais** de « pièce ». Il rend l'unité nutritionnelle de
  l'aliment (`g` ou `ml`) ; une unité hors vocabulaire ne se devine pas — l'option reste
  **nommable** mais devient **non calculable** (voir § 2 bis).
- `g` et `ml` ne sont **jamais additionnés** — et il n'y avait rien à additionner : ce qui se
  cumule, ce sont les **macros**, toutes en grammes.

**Rien de ce qui était interdit n'a été réintroduit** : ni `role`, ni `referenceGrams`, ni
logique `protein`/`carbohydrate`/`fat`, ni portion coach implicite. Deux tests le vérifient par
le code **et** par le comportement (`N1.5-SOLVE-15/16`).

---

## 2. Le critère mathématique, écrit noir sur blanc

Pour N aliments choisis, avec qᵢ la quantité de l'aliment i :

```
Σ Pᵢ/100 × qᵢ = P cible
Σ Gᵢ/100 × qᵢ = G cible          qᵢ ≥ 0
Σ Lᵢ/100 × qᵢ = L cible
```

Trois équations, N inconnues. **Sur-déterminé** quand N < 3, **sous-déterminé** quand N > 3. Il
faut donc un critère valable dans les deux cas, et c'est celui-ci :

> **la solution de norme minimale parmi celles qui minimisent l'écart à la cible** — la
> pseudo-inverse de Moore-Penrose, q = A⁺b. En français : approcher la cible du mieux possible ;
> à égalité d'approche, prendre les quantités les plus petites et les mieux réparties.

Pourquoi celui-là : il est **unique** (donc déterministe), il ne privilégie **aucun** aliment
(donc il ne réintroduit pas de rôle par la bande), et il traite N = 1 comme N = 10 sans cas
particulier. « Le premier aliment absorbe tout » dépendrait de l'ordre du coach ; « parts
égales » ignorerait la cible.

**Comment il est calculé.** Les trois lignes de A vivent dans ℝᴺ. On en extrait une base
orthonormée u₁…u_r par Gram-Schmidt (r = rang ≤ 3). La solution de norme minimale n'a aucune
composante hors de cet espace — toute composante orthogonale augmenterait ‖q‖ sans changer Aq.
On cherche donc q = Σ c_j u_j, ce qui ramène le problème à `R·c = b` avec `R[k][j] = ⟨a_k, u_j⟩`,
système 3×r minuscule : résolution directe (Gauss, pivot partiel) quand r = 3, moindres carrés
par équations normales quand r < 3. Coût O(3N), aucune bibliothèque ajoutée.

**Vérification croisée** : à N = 3 avec un système inversible, cette méthode coïncide avec
Cramer — `N1.5-SOLVE-01` le montre sur une cible **construite à la main** (ce qu'apportent
exactement 150 g de poulet + 200 g de riz + 10 g d'huile), et le solveur retrouve 150 / 200 / 10.

**La non-négativité.** Une quantité négative n'est **ni affichée, ni prise en valeur absolue, ni
masquée** : elle déclenche une nouvelle résolution. « −40 g d'huile » veut dire « les autres
aliments en apportent déjà trop » ; on fige donc l'huile à 0, on la retire de l'ensemble actif,
et on **recalcule tout le reste** sous cette contrainte. On répète jusqu'à admissibilité. Le plus
négatif d'abord ; à égalité stricte, le plus petit index — critère **total**, donc reproductible.
Chaque tour retire une variable : la terminaison est bornée par N.

**Réserve honnête, et elle est écrite dans le module** : cet ensemble actif ne réadmet jamais une
variable écartée (borne basse comme borne haute). C'est l'algorithme demandé au §6 et il rend toujours une solution admissible ;
il ne garantit pas d'être l'optimum global d'un NNLS complet dans les cas pathologiques. Sur les
trois bancs de mesure, résoudre en écartant *seulement* l'huile ou *seulement* l'œuf donne
exactement le même résultat que l'algorithme livré — donc aucune perte mesurée ici, mais je ne
l'écris pas comme une garantie.

---

## 2 bis. Les garde-fous de faisabilité (correction du 15/08/2026)

### Pourquoi

Sans borne, le solveur atteignait la cible du banc B « exactement » en empilant **1 074 g de
brocoli**. La combinaison était mauvaise, et le résultat le **cachait**. Deux plafonds ont donc
été ajoutés — **uniquement dans le solveur**, sans migration :

```
MAX_SOLIDE_G   = 300
MAX_LIQUIDE_ML = 500
```

### Ce qu'ils ne sont pas

Ni une portion recommandée, ni un minimum, ni un rôle, ni un `referenceGrams`, ni une propriété
nutritionnelle de l'aliment. **L'audit a établi qu'aucune donnée de portion n'existe dans ce
schéma** : `serving_size` est demandé à OFF mais n'a **aucune colonne** (il ne survit que dans
`source_payload`, dont la lecture applicative est interdite, et c'est du texte libre) ; « portion »
est une unité de saisie **non convertible**, déjà documentée comme telle ; `piece_weight_g` est
**nulle sur les 2 734 lignes Ciqual** ; `min_grams` / `max_grams` n'existent que sur
`nutrition_recipe_ingredients`, **sans jointure** vers `food_catalog` (la migration 20260831090000
a refusé délibérément d'ajouter `food_id` à cette table) ; `net_quantity` est la taille du
**conditionnement**, pas une portion, et seulement pour les produits ; le dataset Ciqual normalisé
ne porte que code, nom, groupe, trois macros et kcal.

Ce sont donc des **garde-fous produit assumés**, et ils sont documentés comme tels dans le module.

### L'algorithme

Une seule boucle, deux bornes, même mécanique :

1. résoudre globalement sur les variables libres ;
2. si une quantité est négative → la figer à **0** ;
3. sinon si une quantité dépasse son plafond → la figer à **la borne** ;
4. dans les deux cas : **recalculer le résidu**, puis **re-résoudre les variables restantes** ;
5. répéter jusqu'à stabilisation ;
6. juger `exact` / `approximate` / `impossible` sur les **quantités finales affichées**.

**⚠️ Figer n'est pas retirer.** Une variable figée à sa borne **continue d'apporter ses macros** :
le résidu est la cible **moins** ce que les aliments figés apportent déjà. On lui retire sa liberté
mathématique, pas sa nourriture. (À zéro, cet apport vaut zéro — le cas négatif est donc un cas
particulier de celui-ci, pas une mécanique à part.)

Le résidu **n'est pas rabattu à zéro** : un résidu négatif signifie que les aliments figés
dépassent déjà la cible, et l'écarter ferait disparaître ce dépassement du verdict final.

L'ordre est total (plus grande violation, puis plus petit index), donc reproductible. Chaque tour
fige une variable : la terminaison est bornée par N.

### Solide ou liquide — l'unité est lue, jamais devinée

La sémantique réutilisée est **exactement** celle du catalogue et d'A5 : `nutrition_unit`,
contrainte `in ('g','ml')` sur `food_catalog` comme sur `food_products`, et employée telle quelle
par `quantite_en_base_nutritionnelle`. `g → 300`, `ml → 500`. Aucune autre notion d'unité n'est
introduite.

**Unité indéterminable — comportement retenu, et il consiste à ne pas calculer.** La couche
d'hydratation refuse de rendre des macros pour une ligne dont `nutrition_unit` sort du
vocabulaire : l'option reste **affichée et nommée**, mais devient **non calculable**, et le repas
entier affiche l'état explicite prévu plutôt qu'une quantité. Supposer le gramme donnerait des
macros « pour 100 g » à un aliment qui n'est peut-être pas compté ainsi — et appliquerait en plus
le garde-fou à la mauvaise échelle. Épinglé par `N1.5-19`, et le contrôle négatif NCB5 le confirme.
Le repli du solveur
(plafond le plus strict, 300) n'est donc atteignable que par une entrée fabriquée à la main ; il
choisit délibérément la valeur la plus **stricte**, parce qu'un garde-fou qui, dans le doute,
prend la valeur la plus permissive n'en est pas un.

**Pièces** : inchangé. `piece_weight_g` étant inexploitable, on reste dans l'unité nutritionnelle
de l'aliment, conformément au contrat N1.5 existant.

### L'effet, mesuré

| banc | avant borne | après borne |
|---|---|---|
| **A** poulet | exact — 131/59/206/42/9 | **exact — 131/59/206/42/9, identique** |
| **B** saumon | exact — 116/0/46/**1 074**/0 | **impossible** — 185/0/168/**300**/0 |
| **C** sans huile | exact — 89/163/204/40 | **exact — 89/163/204/40, identique** |

**Le plafond ne répare pas le repas : il rend son échec lisible.** Les repas qui tenaient déjà
sous les bornes sortent **inchangés**, et aucun aliment n'y est plafonné. Seul celui qui trichait
change de verdict — et il en change par les **tolérances existantes**, pas par une règle nouvelle :
l'écart lipides (+6,5 g) franchit le plus grand de 5 g et 10 % de 20 g. L'élève ne voit donc
**aucune quantité** sur ce repas, surtout pas « 300 g de brocoli ».

Balayage : **1 792 quantités** vérifiées sur 127 combinaisons × 4 cibles — aucune au-dessus de son
plafond, aucune en dessous de zéro.

---

## 3. Arrondi puis recalcul — l'ordre compte

L'arrondi n'entre **jamais** dans le calcul : `quantity` garde ses décimales de bout en bout, et
`displayQuantity` est arrondie **une seule fois, à la fin**.

Puis les macros sont **recalculées sur les quantités arrondies**. C'est la seule façon que le
« RÉSULTAT » affiché corresponde aux grammes affichés : garder les macros exactes ferait lire à
l'élève un total que ses propres quantités ne produisent pas. **Le statut est jugé sur ce même
total** — un repas peut donc être « exact » avant arrondi et « approché » après, et c'est la
vérité qu'il faut dire. `N1.5-SOLVE-14` et `N1.5-18` l'épinglent ligne par ligne.

**Tolérances** (héritées de `recipe-solver`, importées) : `exact` si **chaque** macro est à moins
de 0,5 g — donc invisible au gramme affiché ; `approximate` si chacune reste sous le plus grand
de 5 g et 10 % de sa cible ; `impossible` sinon. Aucune comparaison par `===` : on juge des
écarts, jamais une égalité flottante.

---

## 4. Hydratation nutritionnelle — deux requêtes, pas une de plus

**Décision** : les macros voyagent **avec le nom**, dans la même requête, plutôt que dans une
couche de résolution séparée. Elles viennent de la même ligne, elles ont la même durée de vie, et
les lire séparément aurait doublé les allers-retours pour rien. `lireLibelles` sélectionne
désormais `nutrition_unit, protein_per_100, carb_per_100, fat_per_100` en plus du libellé, et
`ChoiceOption` gagne un champ `nutrition`.

- **Toujours deux requêtes pour toute la semaine**, quel que soit le nombre d'options
  (`N1.5-06/07` le mesure sur un client qui journalise ses requêtes).
- **`nutrition` a le même statut que `displayName` : hydratation, jamais donnée métier.**
  `toWeekSavePayload` n'émet que `catalog_food_id` / `product_id` — inchangé.
- **`food_lists` / `food_list_items` ne sont lues nulle part** (`N1.5-09/25`). C'est la garantie
  d'instantané elle-même, et N1.5 ne la touche pas d'un octet.
- **Une macro absente est INCONNUE, pas zéro.** Les trois colonnes sont `not null` ; ce cas ne
  peut venir que d'une base non migrée. Y répondre par 0 ferait passer un aliment inconnu pour un
  aliment sans calories, et fausserait les quantités de **tous** les autres. On rend `null` :
  l'option reste affichable, mais pas calculable.

`optionCalculable` répond à une question différente d'`optionExploitable` : « peut-on la
**calculer** ? » contre « peut-on la **nommer**, donc la proposer ? ». Elles répondent aujourd'hui
ensemble, mais les confondre ferait dépendre un calcul de la présence d'un libellé — une
coïncidence, pas une règle.

---

## 5. Ce que l'élève voit

Le calcul est **dérivé**, jamais stocké : `selection → choixResolus → aliments → solveMealChoices`,
dans un seul `useMemo`, sans `useState<Solution>` et sans `useEffect`. Il n'existe donc aucun
chemin par lequel une quantité pourrait survivre au choix qui l'a produite.

`calculDuRepas` rend **quatre états**, et c'est une fonction pure — donc testable sans simuler un
clic :

| état | ce qui s'affiche |
|---|---|
| `incomplet` | rien. 2 choix sur 5, ce n'est pas « deux cinquièmes du repas » : c'est rien |
| `sans-cible` | rien. Profil introuvable ou créneau désactivé : il n'y a rien à viser |
| `non-calculable` | une phrase : un aliment de la composition n'est plus disponible |
| `calcule` | la section « QUANTITÉS POUR TON REPAS » |

Dans le cas `calcule` : les lignes **dans l'ordre des occurrences du coach** (ni par quantité, ni
alphabétique, ni ordre de résolution), chacune avec son unité propre ; puis « CIBLE DU REPAS » et
« RÉSULTAT ».

- **approché** → une phrase, pas une erreur technique : « Cette combinaison approche au mieux les
  objectifs de ce repas. » Les quantités restent affichées — approché, ce n'est pas raté.
- **impossible** → **aucune quantité**. Des grammes accompagnés d'un avertissement seraient
  recopiés et suivis quand même. On dit que la combinaison ne permet pas d'atteindre les
  objectifs, et on invite à modifier un choix. La cible reste dite ; le « RÉSULTAT » disparaît,
  puisqu'il n'y a pas de quantités qui le produisent.
- Aucun jargon n'atteint l'écran : ni `approximate`, ni `delta`, ni code d'avertissement
  (`N1.5-16` le vérifie mot par mot).

**Aucune persistance, et aucun faux bouton.** Pas de `consumed_meals`, pas de `meal_entries`, pas
de `planned_meals`, pas de `ouvrir_repas_prescrit`, pas de RPC, pas d'import Supabase, pas
d'historique. Il n'y a pas de bouton « ENREGISTRER » : il n'y a encore rien à enregistrer.
Un rafraîchissement repart sans sélection, donc sans quantité — assumé, et documenté.

**A5 n'est pas touchée** : « CE QUE J'AI MANGÉ » et « AJOUTER UN ALIMENT » restent exactement où
elles étaient, de l'autre côté de la frontière en pointillés. Aucun choix calculé n'est converti
en consommation.

---

## 6. Tests — 34, et ce qu'ils prouvent

**Solveur (18)** — exact à 3 aliments vérifiable à la main ; N = 1, 2, 4, 5, 10 rendent tous une
réponse ; déterminisme à 10 aliments ; le négatif déclenche la re-résolution (cas **construit**
pour que le négatif soit certain : −3 g d'huile calculables de tête) ; **aucune quantité négative
sur un balayage des 127 combinaisons non vides de 7 aliments × 4 cibles = 508 résolutions** ;
aucun NaN ni Infinity sur sept entrées dégénérées ; **100 résolutions consécutives strictement
identiques** ; permuter l'entrée permute la sortie ; deux occurrences du même aliment restent deux
variables (et la somme des deux vaut ce qu'une seule vaudrait) ; zéro est un résultat légitime ;
impossible identifié ; approché identifié ; arrondi puis recalcul ; aucun rôle ; aucun
`referenceGrams` ; g/ml sans addition ; pièce jamais produite.

**Bornes (10, § 2 bis)** — 1 074 g de brocoli n'est plus productible ; aucun solide > 300 g et
aucun liquide > 500 ml sur 1 792 quantités balayées ; une borne atteinte **re-résout réellement**
les autres (le saumon passe de 116 à 185 g, le riz de 46 à 168 g) ; les macros d'un aliment
plafonné **restent dans le résidu** (prouvé en comparant au même repas où le brocoli est
réellement absent) ; les bancs A et C sont **strictement inchangés** ; le banc B devient
honnêtement `impossible` et n'affiche aucune quantité ; aucun rôle, aucun `referenceGrams`, aucun
minimum par catégorie ; la borne ne vient d'aucune table ; déterminisme conservé sur 3 × 100
exécutions ; le plafond liquide est bien 500 et non 300 (le lait sort à plus de 300 ml, donc le
test discrimine).

**Intégration (16)** — rien avant la fin des choix ; le dernier choix déclenche ; changer un choix
change **les autres lignes** ; la cible est celle du créneau du jour, au bit près ; ordre du coach
à l'écran ; macros réelles côté catalogue **et** côté produit, `numeric` en chaîne compris ;
identité introuvable → aucun calcul truqué ; bibliothèque jamais lue ; aucune écriture d'aucune
sorte ; repas sans occurrence rendu vide à l'octet près ; deux occurrences identiques calculées
séparément et **affichées en deux lignes** ; rafraîchissement sans quantité ; les trois messages
d'écran.

### Une ligne mesurée inatteignable, gardée quand même — et dite

Le `Math.max(0, …)` final n'est **pas** ce qui garantit la non-négativité : la boucle l'assure déjà
avant d'en sortir. Vérifié en le supprimant entièrement — **aucun test ne rougit**. Il reste comme
protection contre l'affichage d'un « −0 » d'arrondi, et le module dit exactement cela plutôt que de
se présenter comme le filet de sécurité qu'il n'est pas.

### Un défaut trouvé par les tests, pas par la relecture

`Infinity × 0 / 100` vaut `NaN` en JavaScript. Une entrée aberrante était correctement bornée à
une quantité de 0 — mais l'apport en macros de cette quantité nulle ressortait `NaN`, se propageait
au total, puis au statut. Corrigé : un apport dont la macro n'est pas finie vaut 0, ce qui est la
seule lecture cohérente d'un aliment qu'on a refusé de calculer.

---

## 7. Contrôles négatifs — 10 / 10 discriminants

Chaque sabotage a été appliqué dans du **code réel** (jamais dans un commentaire — leçon de
N1.4), la suite relancée, le rouge observé, puis le fichier restauré et **son md5 comparé**.

| # | sabotage | rouges |
|---|---|---:|
| NC1 | réintroduire un rôle nutritionnel | 8 |
| NC2 | réintroduire une quantité de référence | 9 |
| NC3 | calculer chaque occurrence indépendamment | 5 |
| NC4 | autoriser une quantité négative | 2 |
| NC5 | arrondir à chaque passe | 1 |
| NC6 | dédupliquer deux occurrences du même aliment | 1 |
| NC7 | lire `food_list_items` | 1 |
| NC8 | déclencher le calcul avec N−1 choix | 1 |
| NC9 | écrire dans `consumed_meals` | 1 |
| NC10 | changer un choix sans recalculer les autres | 3 |
| NCB1 | `MAX_SOLIDE_G` remis à `Infinity` | 6 |
| NCB2 | plafonner **sans** re-résoudre | 2 |
| NCB3 | exclure les macros de l'aliment figé du résidu | 1 |
| NCB4 | appliquer 300 aux liquides au lieu de 500 | 2 |
| NCB5 | deviner le gramme sur une unité hors vocabulaire | 1 |

Suite verte avant et après la série. Restauration md5 : 15 / 15.

**Un cinquième sabotage de borne n'a PAS discriminé, et je le dis** : remplacer le `Math.max(0, …)`
final par `Math.abs(…)` ne fait rougir aucun test. Ce n'est pas une faiblesse des tests — c'est que
la boucle garantit déjà la non-négativité en amont, ce qui rend cette ligne équivalente à
l'identité. Mesuré, expliqué, et écrit dans le module.

---

## 8. Bancs de mesure — aucun résultat écrit en dur

Cible commune P 55 g · G 60 g · L 20 g. **Ces nombres ne sont assertés nulle part** : les tests
n'imposent que des propriétés (non-négativité, ordre, cohérence des macros affichées). Figer
« 131 g de poulet » ferait passer un test au vert pour la seule raison qu'on aurait recopié la
sortie du jour.

| banc | statut | résultat mesuré |
|---|---|---|
| **A** poulet, œuf, riz, brocoli, huile | exact | 131 g / 59 g / 206 g / 42 g / **9 g** |
| **B** saumon à la place du poulet | exact | 116 g / **0 g** / 46 g / **1 074 g** / **0 g** |
| **C** sans huile | exact | 89 g / 163 g / 204 g / 40 g |

**Le banc B répond à la question posée, et il en soulève une autre.** L'huile tombe bien à 0 —
le saumon apporte déjà les lipides. L'œuf aussi. Mais la cible reste atteinte **exactement** au
prix de **1 074 g de brocoli** : avec un saumon gras, on ne peut en manger que 116 g sans dépasser
les 20 g de lipides, et il faut alors trouver 31 g de protéines dans des aliments très dilués —
le brocoli est le seul candidat, et il arrive avec ses glucides. C'est mathématiquement juste et
nutritionnellement absurde.

**Je ne l'ai pas maquillé, et je ne l'ai pas corrigé de moi-même** : le §9 interdit explicitement
tout minimum artificiel, et par symétrie un **maximum** par aliment est une décision produit, pas
une initiative de solveur. C'est le seul point de N1.5 qui appelle un arbitrage.

**Performance** : 100 résolutions de 10 aliments en **5,3 ms** (0,05 ms par résolution). Aucune
bibliothèque d'algèbre ajoutée.

---

## 9. Responsive — mesuré, composition COMPLÉTÉE

La section n'existe qu'une fois toutes les occurrences choisies : le banc **clique réellement**
chaque occurrence puis sa première option, vérifie que les quantités sont apparues, et mesure
ensuite. Il inspecte aussi les conteneurs qui **avalent** un débordement — `overflow-y:auto`
force `overflow-x:auto`, et un tel conteneur défile lui-même en laissant
`documentElement.scrollWidth` menteur.

Décor : blocs de **1, 5 et 10 occurrences**, un libellé de 51 caractères, un nom d'aliment de
83 caractères, un nom **insécable** de 74 caractères, des unités `g` et `ml`.

| viewport | `clientWidth` | `scrollWidth` | écart | lignes rendues | blocs `impossible` |
|---:|---:|---:|---:|---:|---:|
| 375 | 375 | 375 | **0** | 15 | 2 |
| 390 | 390 | 390 | **0** | 15 | 2 |
| 430 | 430 | 430 | **0** | 15 | 2 |
| 768 | 768 | 768 | **0** | 15 | 2 |
| 1440 | 1440 | 1440 | **0** | 15 | 2 |

Re-mesuré **après** l'ajout des bornes. Les deux branches d'affichage — liste de quantités **et**
message d'impossibilité — sont donc mesurées aux cinq largeurs.

**Le banc discrimine** : un `div` de 2 400 px le fait basculer en `DÉBORDE` aux deux largeurs
testées (`main` : client 375 / scroll 2 416, et client 1 200 / scroll 2 488) — et il le voit
**uniquement** parce qu'il inspecte les conteneurs : `documentElement.scrollWidth` était resté à
375 et 1 440. La mesure du seul document aurait dit « 0 px » et se serait trompée.

---

## 10. Non-régression

| suite | résultat |
|---|---|
| `nutrition-n1-4` | 16 / 0 |
| `nutrition-n1-3` | 23 / 0 |
| `nutrition-n1-listes` | 34 / 0 |
| `aliments-a5` | 26 / 0 |
| `aliments-a5-history` | 26 / 0 |
| `aliments-a5-coach` | 11 / 0 |
| `nutrition-plan-v2-builder` | 72 / 0 |
| `nutrition-recipes` | 45 / 0 |
| `nutrition-recipes-admin` | 65 / 0 |
| `nutrition-single-assigned-plan` | 28 / 0 |
| `nutrition-v2-unified` | 74 / 0 |
| `security-hardening` | 31 / 0 |
| `nutrition-recipe-solver` | 25 / 0 |
| `nutrition-macro-targets` | 15 / 0 |
| `nutrition-meal-distribution` | 23 / 0 |

`npx tsc --noEmit` propre. `npx eslint .` propre.

---

## 11. Fichiers

**Nouveaux**

- `lib/nutrition/meal-choice-solver.ts` — le solveur, pur
- `scripts/tests/nutrition-n1-5-quantites.mts` — 34 tests
- `docs/nutrition-n1.5-livrable.md` — ce document

**Modifiés**

- `lib/nutrition/meal-choice-selection.ts` — `optionCalculable`, `alimentsPourLeSolveur`,
  `calculDuRepas`
- `lib/nutrition/plan-v2-week.ts` — type `OptionNutrition`, champ `ChoiceOption.nutrition`
- `lib/supabase/nutrition-week.ts` — les macros hydratées dans les **mêmes** deux requêtes
- `components/student/StudentMealChoices.tsx` — section « QUANTITÉS POUR TON REPAS »
- `components/student/StudentPrescribedWeek.tsx` — passe la cible **déjà résolue** du repas
- `package.json` — **une seule** entrée ajoutée : `test:nutrition-n1-5`

**Supprimés après usage** : `app/mesure-n1-5/page.tsx` et `scripts/dev/mesure-n1-5.mjs` (bancs).

**Aucune migration.** Rien dans N1.5 n'écrit, ne change de schéma, ni ne demande une colonne
nouvelle : les macros existaient déjà, dans des colonnes `not null`, lues par identité.
