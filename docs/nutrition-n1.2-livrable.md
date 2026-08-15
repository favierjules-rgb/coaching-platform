# N1.2 — Bibliothèque de listes alimentaires (côté coach)

**Branche** `feat/nutrition-structured-meals` · **N1.1** = `c681d8f`, migration **non poussée** en distant.
**Aucun commit, aucun push, aucun merge, aucun `db push`.** Aucune migration créée.

---

## 0. Ce qui a été livré, en une phrase

Un coach peut créer, nommer, renommer, remplir, réordonner, dupliquer et archiver des listes
d'aliments réels ; une liste ne porte **ni macro, ni quantité, ni rôle** ; et rien de tout cela
ne peut atteindre un repas déjà construit.

| | |
|---|---|
| Tests N1.2 | **34 / 34**, 0 échec (24 + 10 ajoutés aux deux relectures) |
| Contrôles négatifs | **16 / 16 discriminants**, tous restaurés (md5 identique) |
| Contrôle du banc de mesure | **1**, il change de verdict quand on l'abîme |
| Contrôle de l'invariant responsive | **1**, un seul `min-w-0` retiré = +338 px de débordement |
| Non-régression | 20 suites, **595 tests**, 0 échec |
| `tsc --noEmit` / `eslint .` | verts |
| Migration | **aucune** — démontré inutile, voir §3 |

---

## 1. L'audit préalable (§22), en 7 points

1. **Où l'écran vit.** `/admin/nutrition/listes`, atteint par un bouton sur `/admin/nutrition`,
   voisin de « Recettes ». `AdminSidebar.tsx` **n'est pas touché** : « Nutrition » y est un lien
   plat, sans sous-navigation, et le précédent « Recettes » est déjà un lien *dans la page*.
   Ajouter une sous-entrée créerait deux chemins vers le même écran et un état actif à tenir
   à deux endroits.
2. **Écritures réutilisables.** Le modèle de `food-favorites.ts` : `insert` / `update` / `delete`
   directs, filtrés par la RLS. N1.1 accorde déjà ces droits à `authenticated` sous
   `coach_id = current_coach_id()`. Une RPC n'apporterait qu'une migration de plus.
3. **Recherche d'aliments.** `searchCatalogFoods` et `searchCachedProducts`
   (`lib/supabase/consumed-meals.ts`), appelées **telles quelles**. Aucune seconde recherche.
4. **Composants réutilisables.** `Field` (`AdminFormFields.tsx`) ; le motif de boutons
   monter/descendre de `RecipeIngredientsPanel.tsx`. **Aucune dépendance de glisser-déposer
   n'existe dans `package.json`** — et le cahier interdisait d'en ajouter une pour ça.
5. **Migration nécessaire ?** **Non.** Démonstration au §3.
6. **Fichiers.** Voir §9.
7. **Écart N1.1 ↔ N1.2.** `food_lists` et `food_list_items` sont absentes de
   `types/supabase.ts`, qui n'est rempli qu'au fur et à mesure des usages. D'où les casts —
   la convention déjà en place dans `consumed-meals.ts` et `food-products.ts`.

---

## 2. La règle absolue, et comment elle est tenue

> Une liste n'a **aucun** `solver_role`, **aucune** macro propre, **aucune** quantité,
> **aucune** règle nutritionnelle.

Ce n'est pas une consigne d'écriture : c'est **mesuré sur ce qui part vers la base**.
Le test N1.2-21 relit la ligne réellement écrite dans `food_list_items` et compare
l'ensemble de ses colonnes :

```
["catalog_food_id", "list_id", "position", "product_id"]
```

Rien d'autre. Les colonnes `name`, `protein_per_100`, `carb_per_100`, `fat_per_100`,
`grams`, `role`, `solver_role` sont vérifiées **absentes**, une par une.

Et les macros **affichées** sont lues à la source : le même test modifie
`food_catalog.protein_per_100` de 23 à 31 puis relit la liste — l'écran suit le catalogue.
Un modèle de bibliothèque pointe vers un aliment **vivant**, comme un favori.

---

## 3. Pourquoi aucune migration — et pourquoi ça se joue sur une contrainte

Le seul point qui pouvait en exiger une est le **réordonnancement**.

`food_list_items_position_unique` est `unique (list_id, position)` et **n'est pas déferrable**
(`condeferrable = f`, mesuré sur la base). Trois conséquences enchaînées :

1. **Une permutation écrite en une passe échoue.** Poser la position 1 sur `c` alors que `a`
   la détient encore lève `23505`, immédiatement — pas en fin de transaction.
2. **PostgREST ne sait pas écrire une expression.** `position = position + 1000` n'existe pas
   depuis le navigateur : on ne pose que des valeurs littérales. Le décalage en masse par une
   seule requête est donc impossible.
3. **Deux `upsert` suffisent.** Tout le monde part au-dessus de 1 000 (aucune valeur ne peut y
   croiser une position existante, qui vaut au plus le nombre d'aliments), puis on écrit
   1..N, où plus rien n'est occupé. **Deux allers-retours, pas 2N.**

Le test N1.2-11 **exécute les deux** : d'abord l'écriture naïve, qui doit rendre `23505` et ne
rien laisser derrière elle ; puis la vraie, qui doit rendre l'ordre demandé en positions
continues **et** n'émettre exactement que `upsert:food_list_items:3` deux fois.

> **Ce que ce n'est pas.** Ce n'est pas atomique : le navigateur ne peut pas ouvrir de
> transaction. Si la seconde passe échoue, les positions restent à 1001…100N — un état qui
> reste **valide** (unique, ≥ 1, dans le bon ordre) et que relancer l'opération corrige. Le
> lecteur trie par position et ne dépend jamais du fait qu'elle commence à 1.
> Une RPC atomique serait plus propre — elle demanderait une migration, que le cahier
> interdit sauf impossibilité démontrée. Il n'y a pas d'impossibilité, il y a un état
> intermédiaire bénin.

---

## 4. L'instantané : renommer ne renomme rien d'autre

`meal_choice_slots.label` est une **copie** du nom de la liste au moment de l'ajout, et
`source_list_id` n'est que de la provenance. La garantie ne repose pas sur un drapeau mais
sur l'**absence de chemin** :

- **N1.2-19** pose une occurrence dans un repas, renomme la liste « Protéines » →
  « Protéines animales », et vérifie que `label` vaut toujours « Protéines ». Puis retire un
  aliment de la bibliothèque, puis archive la liste : les deux options du repas sont toujours là.
- **N1.2-20** vérifie que `food-lists.ts` **et les quatre écrans** ne nomment
  `meal_choice_slots`, `meal_choice_options`, `planned_meals`, `planned_meal_items`, `meals`,
  `consumed_meals` dans **aucun** appel `from("…")`. C'est ce qui rend le test précédent
  structurel et pas anecdotique.

Le contrôle négatif **NC7** ajoute exactement la ligne coupable
(`update meal_choice_slots set label = …`) : les deux tests rougissent ensemble.

---

## 5. Ce que chaque test prouve

| # | Test | Ce qu'il établit |
|---|---|---|
| 01 | porte d'entrée | le lien existe sur `/admin/nutrition`, à côté de « Recettes » |
| 02 | pas de navigation parallèle | `AdminSidebar` intouchée, précédent Recettes intact |
| 03 | fil d'ariane | les deux écrans remontent d'un cran |
| 04 | nom nettoyé | espaces réduits, nom vide refusé **avant** l'aller-retour |
| 05 | renommer | change le nom, ne touche pas un aliment |
| 06 | sémantique d'enregistrement | nom au bouton, aliments écrits tout de suite |
| 07 | dupliquer | même ordre, **copie indépendante** (modifier la copie ne change rien) |
| 08 | ajouter | position suivante ; le produit est résolu marque comprise |
| 09 | doublon dans une liste | refusé, rendu « déjà présent », **aucune** ligne, position non avancée |
| 10 | même aliment ailleurs | accepté dans une autre liste |
| 11 | réordonner | réussit là où une passe unique lève `23505` ; deux instructions |
| 12 | ordre partiel | aucun aliment perdu, positions continues |
| 13 | retirer | renumérotation 1..N, aucun trou, ordre relatif conservé |
| 14 | archiver | sorties par défaut, retour sur demande, aliments intacts |
| 15 | pas de suppression offerte | aucun `.delete()` dans les écrans ; les **deux** de la couche : un item, et le rollback de duplication |
| 16 | l'écran le dit | « archivée », « Désarchiver », « elles ne sont pas supprimées » |
| 17 | RLS, deux coaches | chacun ne voit que ses listes |
| 18 | RLS, lecture croisée | **introuvable**, jamais « interdit » ; l'écriture ne touche rien |
| 19 | instantané | renommer/retirer/archiver n'atteint pas un repas construit |
| 20 | absence de chemin | aucune table de repas nommée, ni en couche ni en écran |
| 21 | ni macro ni rôle | colonnes réellement écrites ; macros lues à la source |
| 22 | une seule recherche | celle de l'élève, et elle ne rend qu'une identité |
| 23 | pas d'écran blanc | 7 états nommés ; `role="alert"` ; `chargement` jamais réarmé |
| 24 | pas de débordement | `min-w-0`, `truncate`, `flex-wrap`, cibles 44 px, `aria-label` |
| ERR-1 | `food_lists` en panne | **erreur**, jamais « aucune liste » ; l'erreur passe avant le vide |
| ERR-2 | lecture d'une liste en panne | **erreur**, jamais « introuvable » ; `null` garde un sens unique |
| ERR-3 | `food_list_items` en panne | jamais une liste rendue **vide** ; une vraie liste vide se lit sans erreur |
| ERR-4 | comptage en panne | jamais « 0 aliment » en silence ; le compte juste reste juste |
| RACE-1 | collision de **position** | jamais « déjà présent » ; retentée, puis vraie erreur ; le doublon réel intact |
| RACE-2 | lecture de position en panne | on n'insère pas à l'aveugle sur la position 1 |
| DUP-ERR-1 | copie des items en échec | **aucun** identifiant rendu ; la source intacte |
| DUP-ERR-2 | après cet échec | **aucune copie active vide** ; repli par archivage si le retrait échoue |
| ERR-WRITE-1 | lecture interne de `reordonnerFoodList` en panne | **`false`**, et **aucune** écriture tentée ; liste vide = succès |
| ERR-WRITE-2 | relecture après `DELETE` en panne | **`false`**, aucune passe de positions ; liste devenue vide = succès |

---

## 6. Les 8 contrôles négatifs

Chacun : sabotage → exécution → rouge attendu → restauration → **md5 vérifié identique**.

| # | Sabotage | Fichier | Rouges obtenus | Verdict |
|---|---|---|---|---|
| NC1 | réordonnancement en **une** passe (détour par 1000 supprimé) | `lib/supabase/food-lists.ts` | N1.2-11, N1.2-12 | discrimine |
| NC2 | retrait **sans** renumérotation | `lib/supabase/food-lists.ts` | N1.2-13 | discrimine |
| NC3 | `23505` traité comme une erreur | `lib/supabase/food-lists.ts` | N1.2-09 | discrimine |
| NC4 | index d'unicité d'identité retiré **du double** | `helpers/food-lists-double.ts` | N1.2-09 | discrimine |
| NC5 | archivées **non** exclues | `lib/supabase/food-lists.ts` | N1.2-14 | discrimine |
| NC6 | RLS neutralisée **dans le double** | `helpers/food-lists-double.ts` | N1.2-17, N1.2-18 | discrimine |
| NC7 | renommer écrit aussi le libellé snapshoté | `lib/supabase/food-lists.ts` | N1.2-19, N1.2-20 | discrimine |
| NC8 | porte d'entrée retirée | `app/admin/nutrition/page.tsx` | N1.2-01 | discrimine |
| NC9 | `listerFoodLists` retombe sur `data ?? []` | `lib/supabase/food-lists.ts` | ERR-1 | discrimine |
| NC10 | items illisibles rendus comme liste vide | `lib/supabase/food-lists.ts` | ERR-3 | discrimine |
| NC11 | **tout** `23505` redevient « déjà présent » | `lib/supabase/food-lists.ts` | RACE-1 | discrimine |
| NC12 | duplication ratée rendant quand même un id | `lib/supabase/food-lists.ts` | DUP-ERR-1, DUP-ERR-2 | discrimine |
| NC13 | rollback de la coquille supprimé | `lib/supabase/food-lists.ts` | N1.2-15, DUP-ERR-2 | discrimine |
| NC14 | injection d'erreurs neutralisée **dans le double** | `helpers/food-lists-double.ts` | les **10** tests d'erreur | discrimine |
| NC15 | `reordonnerFoodList` retombe sur `data ?? []` | `lib/supabase/food-lists.ts` | ERR-WRITE-1 | discrimine |
| NC16 | renumérotation jamais faite, annoncée réussie | `lib/supabase/food-lists.ts` | ERR-WRITE-2 | discrimine |

**NC4, NC6 et NC14 sabotent le double, pas le code** — et c'est délibéré. Ils répondent à la seule
question qui compte pour un vert obtenu contre un banc : *le banc sait-il dire non ?* Si retirer
l'index d'unicité ne rendait pas N1.2-09 rouge, le « déjà présent » ne prouverait rien. NC14 pose
la même question à la machinerie d'injection ajoutée à la relecture : sans elle, aucun chemin
d'erreur n'est jamais parcouru, et les huit tests d'erreur seraient une décoration.

**NC1 est aussi une assertion permanente**, à l'intérieur de N1.2-11 : l'écriture naïve y est
tentée à chaque exécution et doit lever `23505`. Sans elle, le détour par 1 000 ressemblerait à
une précaution gratuite que le premier refactor supprimerait.

---

## 6 bis. Les trois corrections de la relecture

### A. Une erreur de lecture n'est plus une absence de données

C'était le défaut le plus dangereux du lot, **parce qu'il ne casse rien** : `devWarn` puis
`data ?? []` rend un écran calme, vide et faux. Le coach en conclut qu'il a perdu sa
bibliothèque — ou qu'une liste est vide, et il la re-remplit par-dessus jusqu'à buter sur
« déjà présent » partout.

Les **sept** lectures de la couche passent désormais par `exigerLecture(...)`, qui jette une
`ErreurLectureFoodLists` nommée (convention `RpcConsommationError` de `consumed-meals.ts`) :
`listerFoodLists`, son **comptage**, `lireFoodList`, ses **items**, `lireAliments`,
`lireProduits`, et la lecture de position d'`ajouterAlimentAListe`. Les deux hooks ont déjà un
`try/catch` : le rejet devient un état d'erreur, sans qu'aucun d'eux ne change.

`null` garde donc **un seul** sens dans `lireFoodList` : « pas de ligne visible » — liste d'un
autre coach ou liste disparue. Et les tests vérifient aussi **l'ordre des branches** dans les
deux écrans : `erreur` est évaluée **avant** « aucune liste » / « introuvable ». Un état
d'erreur correct affiché après une branche « vide » ne servirait à rien.

### B. `23505` n'est plus un synonyme de « déjà présent »

Trois index uniques rendent ce code sur `food_list_items`. Les deux d'identité
(`food_list_items_food_unique`, `food_list_items_product_unique`) signifient bien « déjà dans la
liste ». Le troisième, `food_list_items_position_unique`, signifie **une course** — deux ajouts
concurrents. L'annoncer comme un doublon envoyait le coach chercher dans sa liste un aliment
qui n'y est pas.

`contrainteViolee()` lit d'abord les **noms d'index**, puis, en repli, les **colonnes** citées
par le `details` de PostgREST (« Key (list_id, position)=(…) already exists ») — si un index
était renommé un jour, la seconde lecture tiendrait encore. Un `23505` qu'on ne sait pas nommer
est rendu comme une **vraie erreur**, pas deviné en faveur du silence.

Une collision de position est **retentée** : `TENTATIVES_AJOUT = 3`, chacune relisant la
dernière position. Un nombre fixe, pas une boucle « jusqu'à réussite » qui tournerait
indéfiniment sur une panne durable. RACE-1 exécute les trois cas : collision passagère →
`ajoute` ; collision durable → `erreur` ; même aliment → `deja-present`, intact.

### C. Une duplication à moitié faite est un échec

Si la copie des items échoue, `dupliquerFoodList` rend **`null`**. Rendre l'identifiant
ouvrait une liste vide portant « — copie » que le coach croyait fidèle.

Deux tables, aucune transaction depuis le navigateur : le seul recours est de **retirer la
coquille** — `delete` sur la liste qui vient d'être créée par cette même fonction, qui n'a
jamais été annoncée comme un succès ni affichée, et qui ne contient rien. Ce n'est pas la
« suppression d'une liste » que l'UX interdit : aucun bouton n'y mène, et aucun appelant ne
peut viser autre chose que `nouvelId`.

Si le retrait **lui-même** échoue, la coquille est **archivée** : elle sort de l'index et du
sélecteur, donc aucune copie **active** et vide ne subsiste. C'est la limite exacte de ce qu'un
rollback local peut garantir, et DUP-ERR-2 mesure les deux chemins.

**N1.2-15 a été réécrit en conséquence**, et reste discriminant : aucun `.delete()` dans les
écrans, exactement **deux** dans la couche, celui sur `food_lists` prouvé **présent dans le
corps de `dupliquerFoodList`** et **absent partout ailleurs**. NC13 le confirme en supprimant le
rollback : N1.2-15 et DUP-ERR-2 rougissent ensemble.

---

## 6 ter. Le dernier correctif : les lectures internes aux écritures

Le même piège que §6 bis A, mais **plus sournois** : ici un `data ?? []` ne rend pas un écran
vide, il rend **`true`**. L'écran annonce une opération réussie qui n'a jamais eu lieu — et le
coach n'a aucune raison d'aller vérifier.

**`reordonnerFoodList`.** Une lecture initiale en panne donnait `lignes.length === 0`, donc
`return true`. On sort désormais avant d'écrire quoi que ce soit : **`false`**, et **aucune**
des deux passes n'est tentée. ERR-WRITE-1 le mesure sur le journal du double (zéro `upsert:`)
et vérifie que l'ordre d'origine est intact. Une liste **réellement vide** reste un succès —
sans ce second point, le test serait vert pour la mauvaise raison, c'est-à-dire en rendant tout
`false`.

**`retirerAlimentDeListe`.** Le `DELETE` passe, la relecture tombe : `data ?? []` appelait
`ecrirePositions([])`, qui rend `true` sans rien écrire — « retrait + renumérotation réussis »
alors que les positions gardent leur trou. La fonction rend maintenant **`false`**.

> **Elle ne prétend pas annuler le `DELETE`.** Le navigateur n'ouvre pas de transaction :
> revenir en arrière serait un mensonge de plus. Ce qu'on peut faire, c'est ne pas en dire un
> premier. Le booléen énonce exactement ceci : *l'opération complète n'a pas abouti*. L'écran
> relit ensuite le serveur, et le coach voit l'état réel — un aliment retiré, des positions à
> renuméroter, ce que le prochain réordonnancement comble.

ERR-WRITE-2 vérifie les trois faits : le `delete:` est bien au journal, aucun `upsert:` ne
suit, et les positions valent `[1, 3]` — le trou est là, constatable. Puis le cas valide :
retirer le dernier aliment d'une liste rend `true` et laisse une liste vide.

---

## 7. Responsive — mesuré, pas supposé

Un débordement est un fait de mise en page : il ne se prouve que dans un moteur de rendu.
Les écrans réels sont branchés sur des hooks de données ; sans base, ils n'affichent que
« Connexion indisponible », et mesurer cet écran-là produirait des « 0 px » rassurants et faux
(la leçon d'A5.9).

Un **banc temporaire** (`app/mesure-n1-2/page.tsx`) a donc rendu les **vrais composants**, avec
de vraies données, **dans le vrai `AdminShell`** — la même chaîne de conteneurs que
`/admin/nutrition/listes`. Nom pathologique : une chaîne insécable de 86 caractères.
Serveur Next réel, Chromium, garde-fou de contenu actif. **Le banc a été supprimé après mesure.**

| viewport | `clientWidth` | `scrollWidth` | écart | conteneur défilant subi |
|---:|---:|---:|---:|---|
| 375 | 375 | 375 | **0** | aucun |
| 390 | 390 | 390 | **0** | aucun |
| 430 | 430 | 430 | **0** | aucun |
| 768 | 768 | 768 | **0** | aucun |
| 1440 | 1440 | 1440 | **0** | aucun |

**Deux contrôles, parce qu'un banc qui ne sait dire que « 0 » ne prouve rien :**

- **Banc.** Un `div` de 2 400 px injecté : verdict **DÉBORDE** aux cinq largeurs.
  `documentElement.scrollWidth` reste pourtant à 375 — c'est `<main class="… overflow-y-auto …">`
  qui **avale** le débordement (`client=375 scroll=2424`, +2 049 px). Exactement le piège d'A5.9 :
  mesurer le seul document aurait conclu « rien à signaler ».
- **Cause.** Un **seul** `min-w-0` retiré du lien de `FoodListRow` : **+338 px** de débordement
  subi à 375 px. L'invariant asserté par N1.2-24 est donc bien la cause, pas une décoration.

Restauration vérifiée par md5 dans les deux cas, et remesure à 0 px.

> **Après les deux séries de corrections, cette mesure tient sans être rejouée** : aucun fichier
> d'interface n'a changé. Les md5 de `FoodListRow.tsx`, `FoodListEditor.tsx`,
> `FoodSearchPicker.tsx`, des deux pages et de `useFoodLists.ts` sont **identiques** à ceux du
> §9 mesurés avant relecture. Les corrections portent uniquement sur `lib/supabase/food-lists.ts`,
> le double de test et la suite — jamais sur un fichier qui décide d'une largeur.

---

## 8. Non-régression

| suite | résultat | | suite | résultat |
|---|---|---|---|---|
| `aliments-a1` | 16 / 0 | | `nutrition-v2-unified` | 74 / 0 |
| `aliments-a3-search` | 36 / 0 | | `nutrition-recipes` | 45 / 0 |
| `aliments-a3-ui` | 25 / 0 | | `nutrition-recipes-admin` | 65 / 0 |
| `aliments-a2` | 42 / 0 | | `nutrition-plan-v2-builder` | 72 / 0 |
| `aliments-a5` | 26 / 0 | | `nutrition-recipe-solver` | 25 / 0 |
| `aliments-a5-history` | 26 / 0 | | `nutrition-macro-targets` | 15 / 0 |
| `aliments-a5-coach` | 11 / 0 | | `security-hardening` | 31 / 0 |
| `aliments-a5-responsive` | 17 / 0 | | `authz-hardening` | 25 / 0 |
| `courses-c1` | 44 / 0 | | `admin-shell-nav` | 16 / 0 |
| `courses-c1-ui` | 16 / 0 | | `pwa-coquille` | 11 / 0 |
| **`nutrition-n1-listes`** | **34 / 0** | | | |

`npx tsc --noEmit` : vert. `npx eslint .` : vert. Aucun espace en fin de ligne, aucune
tabulation dans les fichiers du lot.

> **Une chose n'a pas pu être rejouée ici** : `supabase/tests/nutrition_n1_listes_checklist.sql`
> (102 vérifications, vertes en N1.1). Aucune base n'est joignable depuis ce conteneur
> aujourd'hui — port 54322 fermé, pas d'instance locale. **N1.2 ne modifie aucun SQL** : ni
> migration, ni fonction, ni policy. La checklist porte donc exactement sur ce qu'elle validait
> déjà. À rejouer sur la machine avec `psql "$DATABASE_URL" -f supabase/tests/nutrition_n1_listes_checklist.sql`
> avant tout transfert, si tu veux le vert de bout en bout dans une même session.

---

## 9. Les fichiers

**Nouveaux**

| fichier | md5 | rôle |
|---|---|---|
| `lib/supabase/food-lists.ts` | `50ffa9f269c6fc75e48f095a7ddbf3e5` | la couche d'accès — **toutes** les requêtes du lot |
| `hooks/useFoodLists.ts` | `b2343305b955764e07112ff1ea28bb0f` | `useFoodLists` (index) et `useFoodList` (fiche) |
| `components/admin/FoodSearchPicker.tsx` | `54faa993a2b70e0470912c9e58f182e8` | la recherche — réutilise le moteur de l'élève |
| `components/admin/FoodListEditor.tsx` | `e83a1396e547e3eca5751066bda864b6` | l'éditeur d'une liste |
| `components/admin/FoodListRow.tsx` | `17e62674326ef75109b647ff20ae68c7` | une ligne de l'index, extraite pour être **mesurable** |
| `app/admin/nutrition/listes/page.tsx` | `fb67c1582cb4d6ce58e10734e0df9b41` | MES LISTES D'ALIMENTS |
| `app/admin/nutrition/listes/[listId]/page.tsx` | `ef15bcb89e40498534ca17ce628957e7` | une liste |
| `scripts/tests/helpers/food-lists-double.ts` | `fe669ac922743deb9447d93e9b80bce1` | le double de base N1.1 |
| `scripts/tests/nutrition-n1-listes.mts` | `1705cac24856b09a2acc94e7ed60a63f` | les 34 tests |
| `docs/nutrition-n1.2-livrable.md` | — | ce rapport |

**Modifiés**

| fichier | md5 | changement |
|---|---|---|
| `app/admin/nutrition/page.tsx` | `01db88de2ad0f4e08f83d49fc21ca391` | un lien « Listes d'aliments » + son icône. Rien d'autre. |
| `package.json` | — | une entrée `test:nutrition-n1-listes`. Rien d'autre. |

**Supprimé après usage** : `app/mesure-n1-2/page.tsx` (banc de mesure, §7).

### Pourquoi un second double de base

`scripts/tests/helpers/supabase-double.ts` existe pour la chaîne des retours d'entraînement :
il porte les **défauts** de `workout_feedback` / `exercise_feedback` et reproduit leurs
**triggers**. Il ne connaît ni `upsert` ni `is`, et son `order` est un **no-op**
(`order: () => chaîne`). Le rendre triant changerait le résultat de **toutes** les suites qui
l'utilisent déjà. Le double N1.2 reproduit d'autres contraintes — dont la non-déferrabilité,
sans laquelle rien de ce lot ne serait démontrable. Ce n'est pas une copie : ce sont d'autres
tables, d'autres règles.

---

## 10. Deux corrections de mes propres tests, signalées

Deux assertions étaient **fausses**, et le rouge venait d'elles, pas du code. Corrigées comme
telles, jamais assouplies :

1. **N1.2-20** cherchait la sous-chaîne `meals` — qui se trouve dans
   `@/lib/supabase/consumed-meals`, un import parfaitement légitime. Remplacée par la recherche
   d'un **appel de table** : `from("meals")`. Et le test vérifie maintenant aussi que la couche
   nomme bien `from("food_lists")` et `from("food_list_items")` — sans quoi l'absence des autres
   ne voudrait rien dire.
2. **N1.2-24** interdisait `\bw-\[\d+px\]`. Dans `min-w-[44px]`, le tiret ouvre une frontière de
   mot : la règle condamnait les cibles tactiles de 44 px qu'elle est censée exiger. Remplacée
   par `(?<![\w-])w-\[\d+px\]`.

---

## 11. Ce qui n'est pas fait, et pourquoi

- **Glisser-déposer.** Le cahier interdit d'ajouter une grosse dépendance pour ça ; aucune
  n'existe dans `package.json`. Monter/descendre, cibles 44 px, `aria-label` explicites.
- **Suppression d'une liste.** Interdite en UX N1.2. Archivage réversible à la place. Le seul
  `delete` sur `food_lists` est le **rollback interne** d'une duplication ratée (§6 bis C) —
  jamais exposé, jamais atteignable depuis un écran.
- **Atomicité de la duplication.** Impossible sans RPC, donc sans migration. Le rollback local
  la remplace, avec sa limite documentée : si le retrait échoue, la coquille est archivée.
- **Écriture atomique du réordonnancement.** Demanderait une RPC, donc une migration. Voir §3.
- **Rejeu de la checklist SQL.** Voir §8.

---

## 12. Git

Sur `feat/nutrition-structured-meals`. **Rien n'a été commité, poussé, mergé.**
Aucun `db push`, ni local ni distant. Aucune migration créée. **STOP après N1.2.**
