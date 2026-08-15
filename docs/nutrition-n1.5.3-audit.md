# N1.5.3 — AUDIT : meilleure solution faisable + explication des écarts

Branche `feat/nutrition-structured-meals`. **Aucun code, aucune migration, aucun commit, aucun
push, aucun `db push`.** Tout ce qui suit est mesuré sur bancs exécutés, avec des valeurs Ciqual
réelles lues dans la base locale.

> **La conclusion qui change le périmètre du lot, et il faut la lire en premier :**
> le solveur produit **déjà** des quantités quand le statut est `impossible` — l'écran les
> masque. **Mais ces quantités ne sont pas la meilleure solution faisable, et elles en sont très
> loin.** Sur le banc C, le solveur laisse le riz à **0 g** alors qu'il manque **110 g de
> glucides** ; la meilleure solution faisable met le riz à 300 g et ramène l'écart à **1 g**.
> N1.5.3 n'est donc **pas** un lot purement UI, contrairement à l'hypothèse de ton §20.

---

## 1. Cause exacte de la disparition des quantités

Elle tient en dix lignes, dans **`components/student/StudentMealChoices.tsx`**, fonction
`QuantitesDuRepas` :

```tsx
const impossible = solution.status === "impossible";       // l. 183
{impossible ? (
  <p>Cette combinaison ne permet pas d'atteindre les objectifs…</p>   // l. 194-198
) : (
  <ul>{solution.items.map(…)}</ul>                          // l. 200-214
)}
…
{!impossible && (                                           // l. 222
  <dt>Résultat</dt><dd>{ligneMacros(solution.actual)}</dd>
)}
```

Le ternaire **remplace** la liste des grammes par un paragraphe, et la ligne « RÉSULTAT »
disparaît. La décision est documentée en tête de la fonction :

> « ON N'AFFICHE JAMAIS UNE QUANTITÉ QUI MENT […] des quantités accompagnées d'un avertissement
> seraient recopiées et suivies quand même. »

C'est un choix produit assumé, pas un bug. Ton retour terrain l'invalide, et il suffit de le
retirer.

**Et le solveur, lui, n'a rien supprimé.** `composer()` construit `items` (avec
`displayQuantity`, `minQuantity`, `maxQuantity`), `actual`, `delta` et `status` **dans tous les
cas** ; `status` est calculé **à la fin**, à partir de `delta`, et ne conditionne rien en amont.
Mesuré directement :

```
solveMealChoices([A 25/0/6, B 2/16/0.2], P55 G93 L32)
→ impossible   A 214 g · B 300 g   actual {P 59.5, G 48, L 13.4}   delta {…}
```

Les quatre champs que ton §3 demande **existent déjà**. Aucune structure nouvelle n'est requise
côté solveur pour les faire remonter.

Le seul autre chemin qui supprime les quantités est `calculDuRepas` (`meal-choice-selection.ts`)
via ses états `incomplet` / `sans-cible` / `non-calculable` — et ce sont exactement les
exceptions structurelles de ton §3. **Rien à changer là.**

---

## 2. Le vrai défaut : le point rendu n'est pas l'optimum de la boîte

`solveMealChoices` fait, à chaque tour : résoudre → figer **la pire violation** à sa borne →
recalculer le résidu → re-résoudre. **Il ne relâche jamais une variable figée.**

C'est un « clamp-and-resolve », pas un ensemble actif certifié. Il manque l'**étape de
relâchement** (le test de faisabilité duale : si le gradient à une borne indique que rentrer dans
la boîte ferait baisser l'erreur, la variable doit être relâchée).

J'ai mesuré les conditions KKT au point rendu, avant arrondi :

```
BANC A · petit déjeuner        statut exact        résidu 0.000000
   Flocons d'avoine      149.3  libre     grad  -0.000
   Beurre de cacahuète     0.0  PLANCHER  grad  -0.000
   Fromage blanc           160.2 libre    grad  -0.000
   Œuf cru               206.8  libre     grad  -0.000
   Sirop d'agave           0.0  PLANCHER  grad  -0.000

BANC B · bœuf & patate douce   statut impossible   résidu 80.912879
   Boeuf 5% cuit         207.5  libre     grad   0.000
   Patate douce cuite      0.0  PLANCHER  grad -25.628   ⚠️ RELÂCHER AURAIT AMÉLIORÉ
   Sauce tomate          300.0  PLAFOND   grad  -7.529
   Poivron rouge           0.0  PLANCHER  grad  -9.347   ⚠️ RELÂCHER AURAIT AMÉLIORÉ
   Jus multifruit          0.0  PLANCHER  grad -17.647   ⚠️ RELÂCHER AURAIT AMÉLIORÉ

BANC C · poulet & riz          statut impossible   résidu 111.344027
   Poulet rôti           251.3  libre     grad   0.000
   Riz basmati cuit        0.0  PLANCHER  grad -72.118   ⚠️ RELÂCHER AURAIT AMÉLIORÉ
   Sauce soja              0.0  PLANCHER  grad  -2.958   ⚠️ RELÂCHER AURAIT AMÉLIORÉ
   Carotte crue            0.0  PLANCHER  grad -11.258   ⚠️ RELÂCHER AURAIT AMÉLIORÉ
   Jus d'orange          500.0  PLAFOND   grad -21.100
```

**Lecture.** Au plancher, l'optimalité exige un gradient **≥ 0**. Sur les bancs B et C, trois
variables sont figées à 0 avec un gradient **fortement négatif** : les augmenter réduirait
strictement l'erreur macro. Le riz à `grad −72` est le cas d'école — 110 g de glucides manquants,
et la principale source de glucides du repas laissée à zéro.

**Sur le banc A, tous les gradients sont nuls et le résidu vaut 0 : le point EST optimal.** Aucun
relâchement n'est possible. C'est la garantie que corriger le solveur ne peut pas abîmer le cas
terrain déjà validé — ce n'est pas un raisonnement, c'est une mesure.

---

## 3. Formulation mathématique proposée

Rien de nouveau à inventer : il s'agit d'ajouter **l'étape manquante** de l'algorithme déjà
écrit.

**Problème.** Avec `Mᵢⱼ` = macro *i* de l'aliment *j* pour 100, `b` = cible, `lo`/`hi` = plancher
et plafond :

```
minimiser   Σᵢ wᵢ · ( (M q)ᵢ − bᵢ )²        sur    lo ≤ q ≤ hi
```

C'est un moindres carrés **borné** (BVLS, Stark & Parker) : problème convexe, optimum global
unique en macros, atteint par un ensemble actif avec relâchement.

**Boucle proposée** — deux lignes ajoutées à la boucle existante :

1. résoudre sur les variables libres *(inchangé — recentrage N1.5.1 compris)* ;
2. si une variable sort de sa boîte → la figer à la borne, recalculer le résidu, recommencer
   *(inchangé)* ;
3. **sinon**, calculer le gradient `gⱼ = 2 Σᵢ wᵢ rᵢ Mᵢⱼ` et relâcher la variable figée qui le
   viole le plus : `g < −ε` au plancher, `g > +ε` au plafond. Recommencer.
4. si aucune violation → **c'est l'optimum**, on sort.

**Terminaison.** L'objectif décroît strictement à chaque relâchement, et il n'existe qu'un nombre
fini d'ensembles actifs : la boucle termine. Un garde-fou d'itérations reste souhaitable, et le
compteur `determinism.iterations` existe déjà.

**Déterminisme.** Le critère de choix reste total : plus grande violation, puis plus petit index
— exactement la convention déjà en place.

**Aucune bibliothèque, aucun `λ`, aucune algèbre nouvelle.** Le noyau `solutionNormeMinimale`
(Gram-Schmidt + équations normales) est réutilisé tel quel.

---

## 4. Métriques comparées — mesuré sur les trois bancs

J'ai calculé l'**optimum global exact** de la boîte pour chaque métrique (gradient projeté,
400 000 itérations, conditions KKT vérifiées `ok` partout), puis arrondi et comparé au point
rendu aujourd'hui.

| | poids par macro |
|---|---|
| **A** erreur brute | `1, 1, 1` |
| **B** normalisée cible | `1/P*², 1/G*², 1/L*²` |
| **C** tolérances existantes | `1/max(5, 0,1·m*)²` |

### Ce que chaque métrique donne (banc B, cible P55 · G93 · L32)

| | bœuf | patate | tomate | poivron | jus | résultat | écart cible−résultat |
|---|---:|---:|---:|---:|---:|---|---|
| solveur actuel | 208 | **0** | 300 | **0** | **0** | P59,2 G14,1 L14,4 | P −4,2 · **G +78,9** · L +17,6 |
| optimum **A** | 194 | 139 | 300 | 0 | 500 | P59,2 G92,8 L13,8 | P −4,2 · G +0,2 · L +18,2 |
| optimum **B** | 222 | 128 | 300 | 0 | 500 | P66,1 G91,0 L15,4 | **P −11,1** · G +2,0 · L +16,6 |
| optimum **C** | 197 | 135 | 300 | 0 | 500 | P59,9 G92,1 L14,0 | P −4,9 · G +0,9 · L +18,0 |

Gain sur le coût, banc B : **A −94,7 %**, **B −69,8 %**, **C −83,7 %**.
Banc C : **A −96,8 %**, **B −71,1 %**, **C −76,2 %**.

### Ce que les mesures disent

- **A laisse le gros nombre dominer**, exactement ce que ton §5 refuse. Elle perfectionne les
  glucides (cible 158) et paie en protéines : banc C, `G +1,0` mais `P −6,6`. Un gramme de
  glucide et un gramme de protéine n'ont pas le même poids pour l'élève.
- **B sur-pondère les petites cibles.** Poids en `1/m*²` : les lipides (cible 42) pèsent
  14 fois les glucides (cible 158). Résultat banc C : elle sacrifie **11,3 g de glucides** pour
  gagner un peu sur les lipides — et dégrade les protéines de **14,9 g**. C'est le défaut
  symétrique de A.
- **C est B avec un plancher, et ce plancher est exactement `max(5 g, 10 %)`** — la tolérance qui
  décide déjà `approximate` / `impossible`. Pour `m* ≥ 50 g`, C est **proportionnelle** à B (même
  argmin) ; en dessous, le plancher de 5 g empêche une petite cible d'écraser les deux autres.

**Recommandation : métrique C.** Un seul argument, mais il est décisif : **elle minimise
exactement la grandeur que `determineStatus` mesure.** Optimiser A ou B tout en jugeant avec C
autoriserait un cas où le solveur « améliore » sa solution et *dégrade* le statut affiché. Avec
C, « meilleure solution » et « meilleur statut » sont la même phrase.

**Coût d'implémentation : trois lignes.** Il suffit de mettre à l'échelle les trois lignes de
`lignes[]` et le second membre `b` par `1/max(5, 0,1·m*)`. Le recentrage N1.5.1 et le noyau ne
bougent pas. Et quand le résidu peut être nul (banc A), une mise à l'échelle de lignes **ne
change pas** la solution : le cas exact est insensible au choix de métrique.

**⚠️ Arbitrage demandé.** C change les quantités affichées dans les cas `impossible` par rapport
à A. Je ne l'applique pas sans ton accord.

---

## 5. Interaction avec les portions préférées

Mesuré, pas supposé.

```
BANC B  sans préférence      → impossible  résidu 80,913  Boeuf 208 · Patate 0 · Tomate 300 · Poivron 0 · Jus 0
BANC B  avec préférences     → impossible  résidu 80,913  Boeuf 208 · Patate 0 · Tomate 300 · Poivron 0 · Jus 0
BANC A  sans préférence      → exact       Avoine 149 · Beurre 0 · Fblanc 160 · Oeuf 207 · Sirop 0
BANC A  avec préférences     → exact       Avoine 114 · Beurre 9 · Fblanc 300 · Oeuf 159 · Sirop 19
```

Deux faits :

1. **La préférence ne coûte jamais de macro.** Le recentrage `qᵢ = cᵢ + sᵢxᵢ` est un changement de
   variable : il ne modifie pas l'ensemble des minimiseurs du résidu macro, seulement **lequel**
   on retient parmi les ex æquo. Banc A : les deux solutions sont `exact`. C'est déjà la
   hiérarchie de ton §6, et elle est préservée telle quelle par l'étape de relâchement — qui ne
   se déclenche que si elle **réduit strictement l'erreur macro**.
2. **Sur le banc B, la préférence ne change rien du tout** — et c'est un symptôme, pas une
   qualité : tout est collé à une borne sauf le bœuf, la préférence n'a plus aucun degré de
   liberté où s'exprimer. Corriger l'ensemble actif lui en rendra.

**Aucune modification de la couche préférence n'est nécessaire.**

---

## 6. Interaction avec minimums et maximums

Les bornes restent **inviolables** (ton §4), et l'étape de relâchement ne peut pas les franchir :
elle ne fait que **rentrer** dans la boîte `[lo, hi]`, jamais en sortir. Les bornes utilisées sont
celles déjà en place :

```
lo = plancherApplicable(food) = min(minimum snapshoté ?? 0, borneMaximale(unité))
hi = borneMaximale(unité)     = 300 g / 500 ml
```

- **§14 — minimum contradictoire.** Un minimum figé sous un gradient positif est optimal : le
  relâchement ne le touche pas, la quantité reste au minimum, et le dépassement se retrouve dans
  le delta. Comportement déjà correct aujourd'hui.
- **§15 — maximum bloquant.** Banc B : la sauce tomate est **déjà** au plafond de 300 g et le jus
  ira à 500 ml. C'est exactement l'attendu « quantités aux plafonds pertinents, écart restant
  affiché ».
- **`minimum > maximum`** reste refusé **en amont**, par `optionCalculable` → état
  `non-calculable`. C'est l'exception structurelle de ton §3, et elle est déjà en place.
- **L'arrondi borné `clamp(round(q), ceil(min), floor(max))`** de N1.5.2 est inchangé, et c'est
  lui qui garantit que les quantités **affichées** respectent les bornes.

---

## 7. Structure des deltas

⚠️ **Le signe actuel est l'inverse de celui que tu demandes.** Aujourd'hui, dans `composer` :

```ts
const delta = { proteinGrams: actual.proteinGrams - target.proteinGrams, … };   // résultat − cible
```

Ton §8 demande `cible − résultat`. Les deux conventions sont légitimes ; elles ne peuvent pas
coexister sans piège.

**Proposition : ne pas toucher `delta`, ajouter `ecartsVersLaCible`.**

```ts
readonly ecartsVersLaCible: {
  readonly proteinGrams: number;   // cible − résultat  → > 0 : à ajouter
  readonly carbGrams: number;
  readonly fatGrams: number;
};
```

Pourquoi ne pas simplement inverser `delta` :

- `determineStatus` prend `delta` en argument et le passe en valeur absolue — l'inversion serait
  invisible **jusqu'au jour où** quelqu'un ajouterait un test de signe ;
- `delta` est exposé dans le type public `MealChoiceSolution`, partagé de fait avec le vocabulaire
  de `recipe-solver` (`SolverDeltas`, même convention) ; deux « delta » de signes opposés dans le
  même produit serait précisément le genre de piège que ce chantier évite ;
- un nom **français et explicite** (`ecartsVersLaCible`) dit son orientation dans son nom, ce que
  « delta » ne fera jamais.

**Les deux sont calculés sur `actual`**, donc sur les macros des **quantités affichées** — ton
§13 est déjà satisfait par la construction actuelle de `composer` (arrondi d'abord, macros
ensuite, statut sur ces macros).

---

## 8. Règles de message

### Seuil (§12)

Deux constantes existent, aucune n'est à inventer : `EXACT_TOLERANCE_GRAMS = 0,5` et
`max(APPROXIMATE_TOLERANCE_GRAMS = 5, 10 % de la cible)`.

**Règle proposée** — une seule, dérivée de l'existant :

> une macro est mentionnée si `|écart| ≥ tolérance approchée de cette macro`,
> c'est-à-dire exactement si c'est elle qui empêche le repas d'être `approximate`.

Simulé sur les bancs :

| cas | ratios écart/tolérance | mentionné |
|---|---|---|
| banc A (exact) | P 0,00 · G 0,02 · L 0,00 | rien |
| banc B optimum C | P 0,89 · G 0,10 · **L 3,60** | lipides seuls |
| banc C optimum C | **P 1,60** · G 0,55 · **L 3,38** | lipides + protéines |

Le banc C illustre ton §16 : les glucides, à 8,7 g d'écart mais **dans** leur tolérance de 15,8 g,
ne sont pas mentionnés. C'est exactement « ne pas mentionner ce qui est déjà dans la tolérance
utile ».

**⚠️ Mais cette règle a une conséquence que tu dois arbitrer.** Si toutes les macros sont dans
leur tolérance, le statut **est** `approximate` — donc **`approximate` n'affiche jamais d'écart**,
alors que ton §9 dit « Puis écarts si utiles ». Et ton §14 (cible L 10, minimum imposant 12) donne
un écart de 2 g, ratio 0,40 : **aucun message** avec cette règle — alors que ton exemple en
attend un. Note au passage que ce cas-là n'est pas `impossible` mais `approximate` : 2 g < 5 g.

Trois options, à trancher :

| | règle | banc A | approximate | §14 (2 g) |
|---|---|---|---|---|
| **1** | seuil = tolérance approchée | rien | jamais d'écart | rien |
| **2** | seuil = 1 g (le pas d'affichage) | rien (0,2 g → 0) | écarts affichés | « environ 2 g de lipides en trop » |
| **3** | 1 g pour lister, tolérance pour « surtout » | rien | écarts affichés, sans emphase | message §14 rendu |

Je recommande **3** : deux seuils, mais **aucun des deux n'est arbitraire** — 1 g est le pas
d'affichage `PAS_D_AFFICHAGE`, la tolérance est celle du statut. En dessous de 1 g, l'écart
arrondi vaut 0 : il n'y a littéralement rien à écrire.

### Priorité (§11)

> On met en avant la macro de **plus grand ratio écart/tolérance**, et **seulement si** ce ratio
> vaut au moins **le double** du deuxième. Sinon, liste compacte.

Rendu simulé :

```
BANC B · solveur ACTUEL     « Il manque surtout environ 79 g de glucides. »
                            · ajouter environ 18 g de lipides
BANC B · optimum C          « Il manque surtout environ 18 g de lipides. »
BANC C · solveur ACTUEL     « Il manque surtout environ 110 g de glucides. »
                            · ajouter environ 17 g de lipides
BANC C · optimum C          « Il manque surtout environ 17 g de lipides. »
                            · réduire environ 11 g de protéines
```

Le ratio, et non le gramme brut, est ce qui évite qu'une grande cible domine mécaniquement —
c'est la même exigence qu'au §5, appliquée au texte.

### Vocabulaire (§9, §10)

`écart > 0` → « **ajouter** environ N g de … » · `écart < 0` → « **réduire** environ N g de … ».
Jamais un signe nu. Jamais un aliment nommé : le seul geste proposé reste
« Modifie un de tes choix pour t'en rapprocher », qui pointe le bouton **MODIFIER** déjà présent
sur chaque liste (§17).

---

## 9. Résultats sur les trois bancs terrain

Valeurs Ciqual lues dans la base locale. Le jus est modélisé en **ml** (plafond 500) conformément
à tes captures — **⚠️ le catalogue Ciqual le porte en `g`** (plafond 300) ; à confirmer, l'écart
est significatif (voir § 10).

### Banc A — petit déjeuner · P55 G93 L32 · **inchangé**

| | avoine | beurre | fblanc | œuf | sirop | statut |
|---|---:|---:|---:|---:|---:|---|
| avant | 149 | 0 | 160 | 207 | 0 | **exact** |
| après | 149 | 0 | 160 | 207 | 0 | **exact** |

Résidu 0, tous gradients nuls : **le relâchement ne peut rien changer.** Mesuré, pas espéré.

### Banc B — bœuf & patate douce · P55 G93 L32

| | bœuf | patate | tomate | poivron | jus | résultat | message |
|---|---:|---:|---:|---:|---:|---|---|
| **aujourd'hui** | *(masqué)* | | | | | *(masqué)* | « ne permet pas d'atteindre » |
| solution calculée mais cachée | 208 | 0 | 300 | 0 | 0 | P59 G14 L14 | — |
| **après N1.5.3** | 197 | 135 | 300 | 0 | 500 | P60 G92 L14 | « Il manque surtout environ 18 g de lipides. » |

Les glucides passent de **79 g manquants à 0,9 g**.

### Banc C — poulet & riz basmati · P70 G158 L42

| | poulet | riz | soja | carotte | jus | résultat | message |
|---|---:|---:|---:|---:|---:|---|---|
| **aujourd'hui** | *(masqué)* | | | | | *(masqué)* | « ne permet pas d'atteindre » |
| solution calculée mais cachée | 251 | **0** | 0 | 0 | 500 | P76 G48 L25 | — |
| **après N1.5.3** | 236 | 300 | 0 | 49 | 500 | P81 G149 L25 | « Il manque surtout environ 17 g de lipides. » · « réduire environ 11 g de protéines » |

Les glucides passent de **110 g manquants à 8,7 g**.

Les deux repas **restent `impossible`** : aucun de ces aliments n'apporte de lipides en quantité
suffisante, et c'est la vérité qu'il faut dire. Mais l'élève voit désormais un repas complet et
sait **quoi** changer.

---

## 10. Risques

1. **Le lot n'est pas purement UI.** Corriger l'ensemble actif touche le cœur mathématique validé
   en N1.5 / N1.5.1 / N1.5.2. C'est le risque principal, et il est atténué par une mesure, pas
   par une intention : le banc A est déjà à l'optimum (gradients nuls), donc structurellement
   insensible au relâchement.
2. **Les cas `approximate` peuvent bouger.** Un repas aujourd'hui `approximate` avec une variable
   mal figée pourrait devenir `exact` après correction. C'est une amélioration, mais c'est un
   changement de statut affiché. À mesurer par balayage avant/après.
3. **Le choix de métrique change les quantités des cas `impossible`.** A, B et C donnent des
   quantités différentes (§4). Décision produit — j'attends ton arbitrage.
4. **L'unité des jus.** Ciqual porte les jus en `g` (plafond 300), tes captures montrent des `ml`
   (plafond 500). Sur le banc C, le jus est à sa borne : **200 ml d'écart de plafond**, soit
   ~19 g de glucides. À trancher — c'est une donnée de catalogue, pas une règle de solveur.
5. **`determineStatus` est partagé** avec `recipe-solver`, donc avec les recettes **et le lot
   courses C1** (`lib/courses/besoins.ts` lit `solution.status`). N1.5.3 ne doit pas y toucher —
   ton §2 et §13 le demandent déjà ; je le note comme frontière dure.
6. **Le tripwire « pas de quantité en impossible » va sauter.** Le commentaire de tête de
   `QuantitesDuRepas` affirme l'inverse de ce lot ; il sera réécrit **en nommant l'exception et
   la raison**, pas supprimé.
7. **Coût de calcul.** Le relâchement ajoute des tours de boucle. Sur 5 aliments c'est
   négligeable ; un garde-fou d'itérations et un banc de déterminisme (100 exécutions, §21
   BEST-24) restent nécessaires.
8. **Responsive.** Le message d'écart ajoute jusqu'à trois lignes sous la liste. À mesurer sur
   375 / 390 / 430 / 768 / 1440 (§24) — non mesuré à ce stade.

---

## 11. Confirmation : aucune migration n'est nécessaire

**Confirmé, et vérifié plutôt qu'affirmé.**

- Les quatre sorties de ton §3 (`quantities`, `resultingMacros`, `status`, `deltas`) sont **déjà**
  produites par `composer()` et **déjà** dans le type `MealChoiceSolution`. Le seul ajout est
  `ecartsVersLaCible`, un champ **calculé**, jamais persisté.
- `StudentMealChoices` n'importe **aucun** client Supabase, n'appelle **aucune** RPC. La solution
  est dérivée par `useMemo` de la sélection, jamais rangée dans un état ni envoyée.
- Aucune donnée nouvelle n'est demandée au coach : minimums, portions préférées et unités sont
  déjà snapshotés depuis N1.5.1 / N1.5.2.
- Les bornes 300 / 500 vivent dans le solveur et **doivent y rester** — les écrire en base en
  ferait une seconde vérité (règle posée en N1.5.2, contrôle `M-L`).

**N1.5.3 = solveur + UI. Zéro migration, zéro RPC, zéro écriture.** `consumed_meals` et
`meal_entries` ne sont pas touchées ; « Enregistrer le repas » reste N1.6 (§19). La section
« Ce que j'ai mangé » est un élément **frère** de `StudentMealChoices` dans
`StudentPrescribedWeek` et ne lit **jamais** `solution.status` — vérifié sur le rendu, et déjà
gardé par les tests `A5-MIN-08/09/10` (§18).

---

## 12. Ce que j'attends de toi avant d'écrire une ligne

1. **Métrique** : A, B ou **C** (ma recommandation, cohérente avec `determineStatus`).
2. **Seuil de message** : option 1, 2 ou **3** (ma recommandation).
3. **Unité des jus** : `g` (Ciqual, plafond 300) ou `ml` (captures, plafond 500) ?
4. **Le lot corrige-t-il le solveur ?** Ton §20 supposait « purement solveur/UI » sans changement
   d'algorithme. La mesure dit que sans l'étape de relâchement, « meilleure solution faisable »
   resterait un titre : banc C, le riz à 0 g avec 110 g de glucides manquants. Je propose de la
   corriger. **Si tu préfères un lot UI seul d'abord** — afficher les quantités actuelles, même
   sous-optimales — c'est faisable et bien plus petit, mais l'élève verra du riz à 0 g.
