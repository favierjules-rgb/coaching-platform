# EXTENSION FUTURE — « REPRENDRE MA SEMAINE PASSÉE »

**Statut : DOCUMENTÉ, NON IMPLÉMENTÉ.**
Aucun écran, aucune migration, aucune logique de copie n'existe. Ce document décrit ce que l'architecture C1 prévoit déjà, et les règles auxquelles ce mode devra obéir. Le test `C1-FUTUR` de `scripts/tests/liste-de-courses-c1.mts` vérifie qu'aucune ligne n'a été écrite.

---

## 1. LE BESOIN

L'élève veut remanger la même chose que la semaine précédente, et obtenir directement la liste de courses correspondante — sans recomposer vingt et un repas un par un.

## 2. LA SOURCE

```
planned_meals + planned_meal_items  de la période PRÉCÉDENTE correspondante
```

C'est la seule source. Elle porte, pour chaque occurrence, **l'identité exacte** choisie (`catalog_food_id` XOR `product_id`), **la quantité validée** et **l'unité** — c'est-à-dire précisément ce dont la reprise a besoin, et rien de plus.

## 3. CE QUE L'ARCHITECTURE C1 PRÉVOIT DÉJÀ

**Le lecteur est déjà le bon, et il ne change pas.**
`lireRepasPlanifiesSurPeriode(supabase, dateDebut, dateFin)` ne connaît que deux dates. Lui passer la période précédente au lieu de la période courante rend les choix et quantités réellement validés alors — mêmes identités, mêmes unités, mêmes `choice_slot_id`. **Il n'y a donc aucun second lecteur à écrire.**

**Le moteur d'agrégation est déjà le bon, et il ne change pas.**
`agregerListeDeCourses` prend des `ItemPourAgregation`. Que ceux-ci viennent de la période courante ou d'une projection de la période précédente ne le regarde pas.

**Le croisement plan × période est déjà le bon.**
`repasDeLaPeriode(week, periode, compositions)` reçoit une carte `${mealId}|${date}` → composition. La reprise consistera à **fabriquer cette carte** à partir de la période précédente, décalée. Aucune autre structure n'est nécessaire.

Ce qui reste à écrire est donc exactement : **une projection** (décalage des dates, appariement des occurrences), **une garde** (§5), **un écran**.

## 4. CE QUE CE MODE NE DEVRA JAMAIS FAIRE

| Interdit | Pourquoi |
|---|---|
| lire `consumed_meals` / `meal_entries` | « ce que j'ai mangé » n'est pas « ce que j'avais prévu ». La liste de courses porte sur le prévu ; le consommé est le domaine d'A5 |
| parcourir toutes les `meal_choice_options` | une occurrence propose cinq aliments pour qu'on en choisisse **un**. Les sommer achèterait les cinq |
| lire `preferred_quantity` | c'est une suggestion de portion écrite par le coach avant tout choix. La quantité réelle dépend des N autres aliments du repas |
| reconstruire un choix **par nom** | deux entrées Ciqual peuvent porter le même libellé ; un aliment du catalogue et un produit de marque aussi. L'appariement se fait par `(choice_slot_id, identité)`, jamais autrement |

## 5. LA RÈGLE QUI DÉCIDE DE TOUT — LE SNAPSHOT ACTUEL FAIT FOI

> Un choix repris doit **encore exister** dans les `meal_choice_options` du plan **actuellement autorisé**, pour l'occurrence visée.

Si le coach a retiré cet aliment de la liste depuis, **il ne doit pas être réinjecté silencieusement**. L'occurrence concernée reste « À COMPOSER », et l'élève est prévenu de ce qui a changé.

Sans cette règle, la reprise contournerait la prescription du coach — exactement ce que C0 empêche aujourd'hui.

⚠️ **Ce n'est pas une protection, c'est une question d'interface.** La base refuserait déjà l'écriture : `planned_meal_items` porte les clés étrangères composites `planned_meal_items_option_autorisee_food` et `..._product` vers `meal_choice_options(slot_id, …)`. Un choix devenu invalide **échouerait**. La règle existe pour que l'élève l'apprenne dans une phrase, et non par un échec sous ses yeux.

### Trois cas de divergence à traiter explicitement

1. **L'option a disparu de l'occurrence** → occurrence non reprise, marquée « À COMPOSER », motif affiché.
2. **L'occurrence elle-même a disparu** (le coach a retiré la liste du repas) → rien à reprendre pour ce repas ; le reste du repas peut l'être.
3. **Le repas n'existe plus ce jour-là** (le coach a changé la structure du jour) → rien à reprendre pour ce repas.

Dans les trois cas : **jamais de substitution automatique**. Choisir un aliment « proche » à la place de l'élève serait deviner, et deviner est précisément ce que C1 s'interdit partout ailleurs.

## 6. LE PRINCIPE, EN UNE LIGNE

```
semaine précédente VALIDÉE
  → mêmes choix alimentaires (par choice_slot_id + identité)
  → mêmes quantités validées (planned_meal_items.quantity / .unit)
  → projection sur la nouvelle période (décalage de dates seulement)
  → filtrage par le snapshot ACTUEL du coach
  → génération de la liste (agrégation C1, inchangée)
```

## 7. CE QUI RESTERA À DÉCIDER AVANT DE CODER

1. **Quelle est « la semaine précédente correspondante » ?** Les 7 jours qui précèdent la période choisie, ou la même position dans la semaine calendaire précédente ? Les deux diffèrent dès que la période ne commence pas un lundi.
2. **Que faire d'une semaine passée partiellement validée ?** Reprendre ce qui existe et laisser le reste à composer semble juste, mais il faut le dire clairement à l'écran.
3. **La reprise écrit-elle immédiatement, ou propose-t-elle ?** Écrire directement 21 `planned_meals` est un geste lourd et peu réversible. Une revue avant écriture est probablement préférable — à arbitrer.
4. **Interaction avec le verrou C0.1.** Un repas de la nouvelle période déjà **consommé** ne peut pas être réécrit (`REPAS_DEJA_CONSOMME`). La reprise doit l'écarter en amont, pas découvrir le refus en cours de route.

---

**Rien de tout cela n'est implémenté. Aucun écran, aucune migration, aucune logique de copie.**
