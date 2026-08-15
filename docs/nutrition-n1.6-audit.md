# N1.6 — AUDIT D'ARBITRAGE : couleurs des listes + enregistrement du repas

Branche `feat/nutrition-structured-meals`. **Aucun code, aucune migration, aucun commit, aucun
push, aucun `db push`.** Tout ce qui suit est lu dans le schéma, le code et — en lecture seule —
**la base de production**.

> **Deux découvertes changent le périmètre annoncé, et il faut les lire avant le reste.**
>
> **1. Le projet a DÉJÀ le vocabulaire de couleurs que ton §A2 demande** :
> `training_blocks.color_key`, contraint à `gray · red · orange · yellow · green · blue · purple`,
> avec sa carte de styles, son sélecteur accessible et son rendu en pastille / barre latérale.
> Il n'y a rien à inventer — seulement à réutiliser.
>
> **2. La RPC atomique de ton §B5 EXISTE DÉJÀ, et elle n'a jamais été branchée.**
> `enregistrer_repas_planifie(p_meal_id, p_planned_on, p_items jsonb)`, livrée en N1.1, fait
> exactement ce que tu décris : elle valide l'appartenance du repas à l'élève, exige **un choix
> par occurrence**, vérifie que chaque aliment appartient au **snapshot** de son occurrence,
> contrôle la convertibilité d'unité, écrit en **transaction**, et est **idempotente** par
> `on conflict (student_id, planned_on, meal_id)`. Elle s'arrête juste avant la consommation —
> et `planned_meals.consumed_meal_id`, colonne déjà présente et jamais remplie, est le crochet
> laissé pour la suite.
> **Mesuré en production : 0 ligne dans `planned_meals`, 0 appelant TypeScript.**

---

## 0. L'état réel de la production, vérifié avant de proposer quoi que ce soit

| | |
|---|---|
| dernière migration appliquée à distance | **`20260909090000_n1_5_2_quantite_minimale`** — N1.5.2 **est** en production |
| `food_lists` | **12** |
| `meal_choice_slots` | **105** |
| `meal_choice_options` | **609**, dont **63** avec `quantity_unit`, **0** avec un minimum |
| `consumed_meals` | **27**, dont **20** prescrits |
| `meal_entries` | **55** — de la vraie donnée élève |
| `planned_meals` / `planned_meal_items` | **0 / 0** |
| `food_catalog` archivés / privés coach | **0 / 0** |
| `preferred_unit` encore rempli | **63** |

⚠️ **La CONTRACT de N1.5.2 est toujours due.** `preferred_unit` et `quantity_unit` cohabitent en
production, comme prévu par l'expand. Ce n'est pas un problème pour N1.6 — mais c'est une dette
ouverte, et le § 12 en tient compte.

---

# A — COULEURS DES LISTES

## 1. Schéma COLOR proposé

```sql
alter table public.food_lists
  add column if not exists color_key text;
alter table public.food_lists
  add constraint food_lists_color_key_check
  check (color_key is null or color_key in ('red','orange','yellow','green','blue','purple'));
```

**Nullable, sans default, sans backfill.** Les 12 listes existantes restent à `null` et
s'affichent avec le style neutre déjà en place.

⚠️ **Une seule différence avec `training_blocks`, et elle est délibérée : pas de `gray`.**
`training_blocks.color_key` est `not null default 'gray'` — `gray` y est la couleur neutre. Ici,
`null` dit déjà « aucune couleur ». Garder les deux donnerait **deux façons d'écrire la même
chose**, exactement ce que N1.5.2 a refusé pour `minimum_quantity` (`null` contre `0`).

**⚠️ Arbitrage demandé.** Deux options cohérentes, je recommande la première :

| | vocabulaire | listes existantes | « aucune couleur » |
|---|---|---|---|
| **1 · recommandée** | 6 couleurs, nullable | restent `null` — **aucune écriture** | `null` |
| **2 · miroir strict** | 7 clés dont `gray`, `not null default 'gray'` | **12 lignes réécrites** à `gray` | `gray` |

Ton §A2 mentionne aussi `pink`. Il n'existe nulle part dans le projet : l'ajouter obligerait à
étendre `BLOCK_COLOR_STYLES` et à valider son contraste dans les deux thèmes. **Je ne l'ajoute
pas sans ton accord.**

## 2. Format de couleur proposé

**Réutiliser l'identifiant contrôlé existant, et sa carte de styles.** Mesuré :

```ts
// lib/training-block-editing.ts
export const BLOCK_COLOR_KEYS = ["gray","red","orange","yellow","green","blue","purple"] as const;

// components/admin/blocks/block-view-model.ts
red: { dot: "bg-red-500", borderLeft: "border-l-red-500/70", softBg: "bg-red-500/5", label: "Rouge" }
```

Trois raisons, toutes vérifiées :

- **le design system n'a AUCUNE palette catégorielle.** `app/globals.css` est strictement
  monochrome (`--background`, `--foreground`, `--card`, `--border`, `--primary`) plus trois
  accents sémantiques : `--destructive`, `--warning`, `--success`. Inventer huit teintes créerait
  un second système de couleurs parallèle au design system ;
- **`color_key` est la seule couleur stockée du projet** — recherche exhaustive sur toutes les
  colonnes `%color%` / `%couleur%` / `%theme%` : une seule, `training_blocks.color_key` ;
- **le triplet `dot` / `borderLeft` / `softBg` est exactement ce que ton §A5 décrit** — pastille,
  barre latérale, accent discret. Le rendu massif n'existe même pas dans la carte.

⚠️ **Aucune chaîne CSS arbitraire.** Un `text` libre autoriserait `#000` sur fond noir, ou une
valeur non contrastée en thème clair, et il n'existe aucun endroit où la valider.

## 3. Emplacement du snapshot couleur

```sql
alter table public.meal_choice_slots
  add column if not exists color_snapshot text;
alter table public.meal_choice_slots
  add constraint meal_choice_slots_color_snapshot_check
  check (color_snapshot is null or color_snapshot in ('red','orange','yellow','green','blue','purple'));
```

`meal_choice_slots` est le bon emplacement, et ce n'est pas une préférence : **c'est la seule
table qui porte déjà `source_list_id`**, donc le lien liste → occurrence.

⚠️ **Le snapshot n'est pas une optimisation, il est OBLIGATOIRE.** Vérifié sur les policies :

```
food_lists_manage_own_coach | ALL | coach_id = current_coach_id()
food_lists_manage_admin     | ALL | is_admin()
```

**Il n'existe AUCUNE policy `select` pour un élève sur `food_lists`.** Un élève ne peut
structurellement pas lire la couleur de la bibliothèque : ton `COLOR-11` est donc déjà garanti
par la base, pas seulement par une convention de code. Sans snapshot, la couleur serait
simplement invisible côté élève.

**Écriture du snapshot** : par `save_nutrition_plan_v2`, la RPC qui écrit déjà `source_list_id`.
C'est un ajout **additif** — une clé de plus dans la charge utile d'occurrence, une colonne de
plus à l'insert. Aucune réécriture, aucun expand/contract nécessaire.

Comportement demandé au §A4, obtenu sans règle nouvelle : la couleur est figée à l'ajout ;
`blue → red` dans la bibliothèque ne touche aucun repas déjà construit ; une occurrence ajoutée
après prend `red`. C'est **exactement** la sémantique de snapshot de N1.3 / N1.5.1 / N1.5.2.

## 4. UI coach et élève

**Coach — quatre surfaces, toutes déjà identifiées :**

| fichier | rôle |
|---|---|
| `components/admin/FoodListEditor.tsx` | édition d'une liste → le **sélecteur** |
| `components/admin/FoodListRow.tsx` | ligne de bibliothèque → pastille |
| `components/admin/MealChoiceListsPanel.tsx` | sélecteur de liste dans le constructeur → pastille |
| `app/admin/nutrition/listes/…` | pages, aucun changement attendu |

Le sélecteur **existe déjà** : `components/admin/blocks/BlockColorPicker.tsx` — bouton nommé,
`aria-haspopup`, `aria-expanded`, fermeture Échap, **nom textuel de chaque couleur**, cible
tactile `min-h-11`. Il est typé `BlockColorKey` : le rendre générique ou en écrire un jumeau est
une décision de refactor que je te soumets plutôt que de la prendre.

**Élève — une seule surface :** `StudentMealChoices.tsx`, la ligne d'occurrence. Une barre
latérale `border-l-4` avec la classe `borderLeft` existante :

```
▌ Ta protéine        Poulet         [Modifier]
▌ Ton féculent       Riz            [Modifier]
```

⚠️ **La couleur ne doit jamais être la SEULE information.** Le libellé de l'occurrence
(« Ta protéine ») reste devant, exactement comme `blockCategoryLabel` reste lisible sans couleur
dans les blocs d'entraînement. C'est la règle d'accessibilité déjà appliquée par le projet, et
elle rend `COLOR-12` mesurable.

**Contraste** : les classes sont des accents à `/70` et `/5` sur `--card`, dans les deux thèmes.
À mesurer au banc responsive, comme pour N1.5.3.

---

# B — ENREGISTRER LE REPAS

## 5. Le chemin d'enregistrement A5 existant, exactement

```
useConsumedMeals (hooks/useConsumedMeals.ts)
   └─ écrire(action)  ← garde `enCoursRef` : une écriture à la fois, puis RELIT le serveur
        ├─ ouvrirRepasPrescrit(mealId, date)   → RPC ouvrir_repas_prescrit    → uuid consumed_meal
        ├─ ajouterAlimentCatalogue(cm, foodId, qté, unité) → RPC ajouter_aliment_catalogue
        ├─ ajouterAlimentProduit(cm, productId, qté, unité) → RPC ajouter_aliment_produit
        ├─ ajouterAlimentManuel(cm, libellé, qté, unité, p100, g100, l100)
        ├─ modifierQuantiteEntree(entryId, qté, unité)
        └─ supprimerEntree(entryId)
```

**Contrat A5, mesuré dans les RPC :** le client envoie **l'identité, la quantité et l'unité —
jamais une macro**. Le serveur recharge la source et calcule :

```sql
v_base := quantite_en_base_nutritionnelle(p_quantity, p_unit, f.nutrition_unit, f.piece_weight_g);
insert into meal_entries (…, protein_g, carb_g, fat_g)
values (…, round(v_base * f.protein_per_100 / 100, 4), …);
```

**⚠️ Et c'est exactement la formule du solveur.** N1.5.3 calcule `par100 × q / 100`, sans arrondi ;
la RPC calcule la même chose puis arrondit à **4 décimales**. Sur cinq aliments, l'écart maximal
cumulé est de **2,5 × 10⁻⁴ g** — quatre ordres de grandeur sous le gramme affiché.

**Conséquence pour ton §B2.** Ta consigne « ne jamais recalculer au moment de sauvegarder » vise
le vrai risque : que la **quantité** change entre l'écran et la base. Ce risque est nul si l'on
envoie l'entier affiché (`displayQuantity`, après bounded rounding). En revanche, faire envoyer
les **macros** par le client casserait l'invariant A5 « le client n'envoie jamais une macro », et
créerait un second modèle de calcul — ce que ton §B4 interdit.

**Je recommande donc : envoyer la quantité affichée, laisser le serveur calculer les macros.**
`SAVE-05` (quantités) devient une égalité stricte ; `SAVE-06` (macros) une égalité à 10⁻⁴ près,
et le test doit le dire ainsi plutôt que de prétendre à l'exactitude binaire.

## 6. Faut-il une nouvelle RPC atomique ?

**Aujourd'hui, enregistrer 5 aliments coûte 6 allers-retours non atomiques** (1 `ouvrir` + 5
`ajouter`), et `useConsumedMeals.écrire` **relit le serveur après chacun**. Un échec au 4ᵉ laisse
3 aliments écrits. Ton §B5 a raison.

**Mais la RPC n'est pas à écrire — elle est à FINIR.** `enregistrer_repas_planifie` fait déjà, en
une transaction :

| ce qu'elle fait | code mesuré |
|---|---|
| repas appartenant à un plan assigné, hors `prochain` | `REPAS_PRESCRIT_INACCESSIBLE` |
| repas portant des occurrences | `REPAS_SANS_LISTE` |
| une occurrence par item, sans doublon, sans intrus | `OCCURRENCE_MANQUANTE` / `EN_DOUBLE` / `HORS_REPAS` |
| **toutes** les occurrences couvertes | `CHOIX_INCOMPLET` ← ton `SAVE-01` |
| aliment appartenant au **snapshot** de l'occurrence | `CHOIX_HORS_LISTE` |
| identité unique catalogue **ou** produit | `IDENTITE_INVALIDE` ← ton §B6 |
| unité convertible pour cet aliment | `PIECE_SANS_POIDS` / `UNITE_INCOMPATIBLE` |
| upsert idempotent + remplacement intégral des items | `on conflict (student_id, planned_on, meal_id)` |

Ce qui manque : ouvrir/retrouver le `consumed_meal`, insérer les `meal_entries`, renseigner
`planned_meals.consumed_meal_id`.

**⚠️ Arbitrage demandé — deux formes, je recommande la seconde :**

| | forme | conséquence |
|---|---|---|
| **1** | étendre `enregistrer_repas_planifie` pour qu'elle écrive aussi la consommation | une RPC, mais elle change de sens : « planifier » deviendrait « manger ». Casse le contrat d'une fonction déjà déployée. |
| **2 · recommandée** | nouvelle RPC `enregistrer_consommation_structuree(p_meal_id, p_date, p_items)` qui **appelle** `enregistrer_repas_planifie`, puis ouvre le `consumed_meal` et insère les entrées | la planification reste ce qu'elle est ; la consommation est un acte distinct ; **toute la validation est réutilisée, pas recopiée** ; une seule transaction. |

⚠️ **`ouvrir_repas_prescrit` est réutilisable telle quelle** : elle est idempotente (elle rend le
`consumed_meal` existant si (élève, date, repas) existe déjà), et son unicité est garantie par
l'index `consumed_meals_prescribed_unique`. Ton §B10 est donc satisfait sans écrire une ligne :
**ouvrir n'efface rien**, et les entrées manuelles déjà présentes survivent.

## 7. Stratégie d'idempotence

**La moitié du travail est déjà faite par des index qui existent :**

```
consumed_meals_prescribed_unique  UNIQUE (student_id, consumed_on, prescribed_meal_id)
planned_meals_unique              UNIQUE (student_id, planned_on, meal_id)
planned_meal_items_un_choix_par_occurrence  UNIQUE (planned_meal_id, choice_slot_id)
```

Le conteneur et la soumission sont donc **déjà** uniques par (élève, date, repas) — tes §B14
(jour) et §B15 (repas) sont garantis **structurellement**, pas par du code.

Ce qui manque : rattacher les `meal_entries` écrites par le bouton à leur soumission.
`meal_entries` n'a **aucune** clé d'idempotence.

**⚠️ Arbitrage demandé — je recommande C :**

| | mécanisme | double clic | après refresh | reprise après suppression A5 |
|---|---|---|---|---|
| **A** | rien de neuf ; `planned_meals.consumed_meal_id` non nul = « déjà enregistré » | bloqué | **lisible** | non — l'état reste « enregistré » même si l'élève supprime tout |
| **B** | marqueur dans `meal_entries.note` | bloqué | lisible | oui, mais `note` est un champ de texte libre de l'élève : le détourner est un piège |
| **C · recommandée** | `meal_entries.planned_meal_id uuid null references planned_meals(id) on delete set null` + `unique (planned_meal_id, food_id, product_id)` partiel | **bloqué au niveau base** | **lisible** — l'état vient d'une jointure, jamais de React | **oui** : l'élève supprime les entrées via A5, la jointure ne rend plus rien, le bouton redevient disponible |

C répond à ton §B16 (« l'état enregistré doit venir de la persistance ») **et** à ton §B13
(« le bouton n'enferme jamais le repas ») avec le même mécanisme.

⚠️ **La garde React existante ne suffit pas, et c'est mesuré** : `useConsumedMeals` porte un
`enCoursRef` qui refuse une seconde écriture *pendant* la première. Deux clics espacés de deux
secondes passent tous les deux. C'est exactement le cas que ton §B8 vise.

## 8. Repas déjà partiellement rempli (§B10)

**Aucun risque, et il est structurel.** `ouvrir_repas_prescrit` fait `select … if found return` :
elle **ne crée que si rien n'existe**, ne touche jamais les entrées. Le bouton n'écrit que des
`insert into meal_entries` : le café et le dessert déjà saisis restent intacts. C'est ton
`SAVE-13`, et il est garanti par la RPC existante.

L'idempotence de l'option C empêche d'ajouter deux fois **la proposition structurée**, sans rien
dire des entrées libres — qui restent librement ajoutables, modifiables, supprimables.

## 9. Modification après enregistrement (§B18)

Le cas : l'élève enregistre A, puis change ses choix vers B.

**Ce qui est acquis** : la consommation A ne bouge pas. `save_nutrition_plan_v2` n'écrit jamais
dans `consumed_meals`, et rien ne relie la prescription à la consommation dans ce sens. Ton §B9
est déjà vrai.

**Ce qui reste à trancher — je recommande 3 :**

| | comportement | pourquoi / pourquoi pas |
|---|---|---|
| 1 | le bouton reste « ✓ Repas enregistré », inerte | simple, mais l'élève qui a changé d'avis **avant** de manger est bloqué sans issue lisible |
| 2 | « Enregistrer cette nouvelle version » qui **ajoute** | double la nourriture dans « Ce que j'ai mangé ». Presque jamais ce que l'élève veut. |
| **3 · recommandée** | « ✓ Repas enregistré » + une phrase : « Tes choix ont changé depuis. Modifie ta consommation ci-dessous, ou supprime ces lignes pour enregistrer la nouvelle version. » | aucune écriture automatique, aucun doublon, et l'issue est **les outils A5 qui existent déjà** — cohérent avec « prescription ≠ consommation » |

⚠️ **Je ne recommande AUCUN remplacement automatique.** Supprimer des lignes que l'élève a
peut-être déjà corrigées à la main serait une écriture destructive déclenchée par un changement
de prescription — l'inverse exact de ton §B9.

## 10. Migrations nécessaires

**Deux migrations, séparées, dans cet ordre.** A et B ne partagent aucune table.

**M1 — COLOR**
```
food_lists.color_key                     (nullable, check 6 valeurs)
meal_choice_slots.color_snapshot         (nullable, check 6 valeurs)
save_nutrition_plan_v2                   (+1 clé lue, +1 colonne écrite — ADDITIF)
```

**M2 — ENREGISTREMENT**
```
meal_entries.planned_meal_id             (nullable, FK on delete set null)
index unique partiel d'idempotence
enregistrer_consommation_structuree(uuid, date, jsonb)   NOUVELLE
grant execute to authenticated
```

**Aucun backfill dans l'une ni dans l'autre.** Aucune colonne supprimée, aucune renommée.

## 11. Risques de production

1. **`ajouter_aliment_catalogue` refuse un aliment archivé ou privé** (`owner_coach_id is null and
   status = 'active'`), alors que **le lecteur élève des repas ne filtre PAS le statut** — c'est
   documenté et délibéré : « un aliment archivé après coup doit garder son nom à l'écran ». Un
   aliment archivé après la construction du repas s'affiche donc, se calcule, **et échouerait à
   l'enregistrement** avec `ALIMENT_INACCESSIBLE`. *Mesuré aujourd'hui : 0 archivé, 0 privé — le
   risque est latent, pas actuel.* La nouvelle RPC doit décider explicitement : refuser (échec
   lisible) ou accepter l'archivé (le repas a été prescrit quand il était actif). **À trancher.**
2. **55 `meal_entries` réelles en production.** Toute erreur d'idempotence duplique de la donnée
   élève déjà existante. C'est le risque le plus concret du lot.
3. **La CONTRACT de N1.5.2 est en attente** : `preferred_unit` est encore rempli sur 63 lignes.
   Deux chantiers ouverts sur `meal_choice_options` en même temps — à séquencer, § 12.
4. **`save_nutrition_plan_v2` est retouchée pour la quatrième fois** (N1.3, N1.5.1, N1.5.2, N1.6).
   Additif à chaque fois, mais la fonction grossit ; sa checklist doit croître avec elle.
5. **`planned_meals` est vide en production.** Aucune régression possible sur de la donnée
   existante — mais aucun retour terrain non plus sur une RPC jamais exécutée en vrai. Le banc
   local devra l'exercer sérieusement.
6. **RLS** : rien à ouvrir. `meal_entries_crud_own_student` est déjà `ALL` sur
   `student_id = current_student_id()`, `planned_meals` est en `select` seul pour l'élève (les
   écritures passent par la RPC `security definer`), et la nouvelle RPC doit reprendre la garde
   `p.student_id = v_student and p.status <> 'prochain'` **mot pour mot** — sans elle, une
   fonction `security definer` contournerait la RLS qu'elle est censée respecter. Ton `SAVE-21`.
7. **Contraste des couleurs en thème clair.** `--card` vaut `#ffffff` : un accent à `/5` y est
   quasi invisible. À mesurer dans les deux thèmes, pas seulement en sombre.

## 12. Ordre recommandé des migrations et du déploiement

```
1.  M1 COLOR          → db push, puis déploiement. Purement additif, aucune lecture
                        existante ne casse : une colonne nulle de plus.
2.  CONTRACT N1.5.2   → lot séparé, déjà dû : drop preferred_unit et ses contraintes,
                        maintenant que le code neuf est déployé et validé en terrain.
3.  M2 ENREGISTREMENT → db push, puis déploiement. La RPC neuve n'est appelée par
                        personne tant que le bouton n'est pas déployé : l'ordre
                        base-puis-code est sûr, contrairement à N1.5.2.
```

**Pourquoi la CONTRACT au milieu.** Elle touche `meal_choice_options`, M2 touche `meal_entries` :
aucune collision. Mais la faire **avant** M2 évite d'avoir trois états de schéma en vol en même
temps, et elle est en attente depuis N1.5.2.

**Aucun ordre contraint entre base et code cette fois**, pour les deux migrations : elles
n'ajoutent que des colonnes nullables et une fonction neuve. C'est la leçon de N1.5.2 appliquée
en amont plutôt qu'en rattrapage.

---

## 13. Ce que j'attends de toi avant d'écrire une ligne

1. **Vocabulaire couleur** : 6 couleurs nullable *(recommandé)*, ou 7 avec `gray` not-null ?
   Et `pink` — on l'ajoute au projet, ou pas ?
2. **Sélecteur** : rendre `BlockColorPicker` générique, ou écrire un jumeau pour les listes ?
3. **Forme de la RPC** : nouvelle `enregistrer_consommation_structuree` qui réutilise
   `enregistrer_repas_planifie` *(recommandé)*, ou extension de l'existante ?
4. **Idempotence** : `meal_entries.planned_meal_id` + index unique *(recommandé)*, ou variante A ?
5. **Après changement de choix** : « enregistré » + phrase d'issue *(recommandé)*, ou une des deux
   autres ?
6. **Aliment archivé au moment d'enregistrer** : refuser, ou accepter parce qu'il était actif à la
   prescription ?
7. **Un seul lot ou deux ?** COLOR et SAVE ne partagent rien. Les livrer séparément rendrait
   chaque rapport et chaque `db push` beaucoup plus lisibles — mais tu as demandé un chantier
   commun pour gagner du temps. Je peux faire les deux ; dis-moi.
