# N1.4 — L'élève choisit un aliment dans chaque liste

**Branche** `feat/nutrition-structured-meals` · N1.1, N1.2, N1.3 déjà commités.
**Aucune migration.** Aucun commit, aucun push, aucun merge, aucun `db push`.

| | |
|---|---|
| Migration | **aucune** — et aucune n'a été approchée |
| Tests N1.4 | **16 / 16**, 0 échec (couvrant les 30 points du §28) |
| Contrôles négatifs | **10 / 10 discriminants**, tous restaurés (md5 identique) |
| Responsive | **0 px** à 375/390/430/768/1440, **listes ouvertes**, 36 options rendues |
| Contrôle du banc | **1**, il bascule quand on l'abîme |
| Non-régression | 13 suites, 0 échec · `tsc` / `eslint .` verts |

---

## 1. L'audit (§1), et ce qu'il a évité d'écrire

1. **La page élève du plan** est `app/(student)/nutrition/[planId]/page.tsx`, qui monte
   `StudentPrescribedWeek`. `app/(student)/nutrition/page.tsx` est l'index des plans et ne rend
   aucun repas.
2. **Le composant qui rend UN repas** est `components/student/StudentPrescribedWeek.tsx`,
   fonction `rendreJour`, dans `jour.meals.map(...)` → un `<article>` : créneau, nom, cible,
   `items`, `coachNotes`, puis la frontière coach/élève et `ConsumedMealSection`.
3. **Le lecteur est `readNutritionPlanV2Week`**, appelé par `hooks/useStudentNutritionPlanV2.ts`.
4. **Il rend DÉJÀ `choiceSlots`, hydratés** — hérité de N1.3. Le champ arrivait donc jusqu'à
   l'écran élève sans qu'aucun composant ne le lise : la seule utilisation de `.choiceSlots`
   dans tout `components/` était côté coach. **Aucun ajout de lecture n'était nécessaire**,
   sauf un (§2).
5. **`ouvrir_repas_prescrit` n'est déclenchée que par « Ajouter un aliment »**
   (`ConsumedMealSection.ouvrirAjout`), jamais à l'affichage. N1.4 n'y touche pas.
6. **Aucun accordéon réutilisable n'existe** côté élève : `AddFoodSheet` et
   `ConsumedFoodDetailSheet` sont deux feuilles ad hoc, pas un composant partagé.
7. **Les recettes ne sont pas attachées à un repas** : elles ont leur propre écran
   (`[planId]/recettes`). Rien à préserver de ce côté dans l'article du repas.

---

## 2. La seule chose ajoutée à la lecture, et pourquoi elle était indispensable

`lireOccurrences` ne lisait pas `meal_choice_options.id`. Or le §6 demande que la sélection
désigne **la ligne snapshotée**, pas l'aliment — et il a raison, pour une raison qui se
démontre : un repas peut porter « Choix de ta protéine » **deux fois**, avec « Poulet » dans
les deux. Une sélection `occurrence → aliment` ne saurait pas dire laquelle des deux a été
servie.

Le `select` passe donc de quatre à cinq colonnes. **C'est une lecture, pas une donnée
nouvelle** : aucune migration, aucune écriture, aucun champ ajouté en base. Côté coach,
`optionId` reste absent — au moment où le constructeur fige une liste, la ligne n'existe pas
encore ; c'est la RPC qui la crée. Il n'est donc jamais envoyé, seulement lu.

**Le contrôle négatif NC4 a d'ailleurs trouvé un trou dans mes tests** : rien n'épinglait que
l'identifiant d'un **aliment** ne doit jamais résoudre une sélection. Sabotage appliqué,
tests verts. L'assertion manquante a été ajoutée, et NC4 rougit désormais.

---

## 3. L'architecture, en une phrase

> Un module **pur** tient la composition, un composant la rend, et rien n'écrit.

`lib/nutrition/meal-choice-selection.ts` — `occurrenceId → optionId`, plus les gestes :
`choisirOption`, `optionChoisie`, `estChoisie`, `optionExploitable`, `progressionDesChoix`,
`choixResolus`, `cleDeComposition`. Aucun import de Supabase, aucune promesse, aucun effet.
`choixResolus` rend déjà exactement ce que N1.5 attend : occurrence + option, dans l'ordre du
coach, sans jamais fabriquer un choix par défaut.

`components/student/StudentMealChoices.tsx` — les lignes fermées, l'ouverture d'une seule
occurrence à la fois, le choix, la fermeture après choix.

**Deux détails qui sont des décisions, pas des accidents :**

- **`progressionDesChoix([])` rend `complet: false`.** Un repas libre n'a rien à compléter ;
  le dire complet laisserait croire à N1.5 qu'il y a une composition à calculer.
- **`optionChoisie` ne cherche que dans `occurrence.options`.** Une sélection qui désignerait
  l'option d'une autre occurrence rend `null` plutôt qu'un aliment trouvé de travers.

---

## 4. Ce que l'écran fait, et surtout ce qu'il ne fait pas

**Fermé, c'est réellement fermé.** Les options ne sont pas masquées en CSS : elles **n'existent
pas dans le DOM**. Le test rend dix occurrences et compte `role="radio"` : **zéro**. Un repas à
dix listes de dix aliments poserait cent lignes qu'aucun lecteur d'écran ne devrait traverser.

**Aucune quantité, aucune macro, aucun gramme.** Elles n'existent pas encore ; en montrer
obligerait à les inventer.

**Aucun bouton « Enregistrer ».** Il mentirait : il n'y a ni quantité à enregistrer, ni
consommation à créer. Le test refuse quatre formulations (`Enregistrer`, `Valider mon repas`,
`Terminer`, `Sauvegarder`).

**Aucune recherche libre.** Le coach a déjà réduit le choix : ni `AddFoodSheet`, ni Ciqual,
ni scan, ni Open Food Facts. L'élève ne voit que `meal_choice_options` de **cette** occurrence.

**Une option introuvable est visible mais désactivée** (§16). Elle **reste dans le snapshot** —
on ne la retire pas, le repas doit rester ouvrable — et affiche « Aliment indisponible ».
On ne la propose pas comme un choix normal : N1.5 ne saurait pas en calculer la quantité,
faute de source à lire.

**Une liste à une seule option exige quand même un clic.** Aucune auto-sélection : le composant
n'a **aucun `useEffect`**, et le test l'épingle.

---

## 5. La portée de l'état — ce qui rend une fuite impossible

`cleDeComposition(mealId, date)` → `"repas-1|2026-08-17"`, et **c'est cette clé qui monte le
composant** :

```tsx
<StudentMealChoices key={cleDeComposition(repas.id, date)} occurrences={repas.choiceSlots} />
```

Changer de repas ou de jour démonte donc le brouillon avec le composant. La fuite n'est pas
« évitée » par une précaution : elle est hors d'atteinte. NC8 remplace la clé par une constante
et le test rougit.

La date est dans la clé **même si l'identifiant de repas suffirait aujourd'hui** : un repas
prescrit appartient déjà à un seul jour, mais le même plan est consulté semaine après semaine,
et une composition du lundi 3 n'a rien à faire dans le lundi 10.

**§24 — le rafraîchissement remet les choix à zéro.** C'est assumé et documenté pour ce lot :
aucune persistance n'a été inventée. Le test refuse `localStorage`, `sessionStorage`,
`indexedDB` et `idb` dans le composant.

---

## 6. Les tests

16 tests couvrant les 30 points du §28 (plusieurs points partagent un test quand ils décrivent
le même fait — par exemple 13/14 « deux occurrences indépendantes » et « même aliment des deux
côtés » sont une seule démonstration).

| Test | Points couverts | Ce qu'il établit |
|---|---|---|
| N1.4-01 | 01 | le composant rend `null` ; items, notes et consommation intacts |
| N1.4-02/15 | 02, 15 | ordre du coach respecté ; **aucun `.sort()`** dans l'écran |
| N1.4-03 | 03 | zéro nom d'aliment, zéro `role="radio"` dans le DOM fermé |
| N1.4-04 | 04 | une seule ouverte ; ouvrir/fermer ne touche jamais `selection` |
| N1.4-05/13/14 | 05, 13, 14 | choisir dans A ne touche pas B ; même aliment des deux côtés ; **un id d'aliment ne résout rien** |
| N1.4-06/07/16 | 06, 07, 16 | vrais noms catalogue et produit ; ordre snapshoté |
| N1.4-08/09/12 | 08, 09, 12 | remplacement, jamais deux choix actifs, fermeture après choix |
| N1.4-12bis | 12 | progression 0/2 → 1/2 → 2/2 ; `[]` n'est pas « complet » ; `choixResolus` |
| N1.4-10/11 | 10, 11 | « Aucun choix / Choisir » puis nom + « Modifier », un seul bouton |
| N1.4-17..20 | 17, 18, 19, 20 | ni l'écran, ni l'état, ni la semaine, ni la lecture ne nomment la bibliothèque |
| N1.4-21/22/23 | 21, 22, 23 | aucun import Supabase, aucune écriture, aucune table nommée, aucun faux bouton |
| N1.4-24/25/26 | 24, 25, 26 | clé repas+date, montée en `key` ; aucune persistance |
| N1.4-27 | 27 | option introuvable : présente, nommée, désactivée |
| N1.4-28 | 28 | une seule option : « Aucun choix », aucun `useEffect` |
| N1.4-29/30 | 29, 30 | dix occurrences fermées ; invariants responsive ; a11y |
| N1.4-31 | — | **20 options → 2 requêtes d'hydratation**, `optionId` lu, bibliothèque **zéro** requête |

---

## 7. Les dix contrôles négatifs

Chacun : sabotage → exécution → rouge attendu → restauration → **md5 vérifié**.

| # | Sabotage | Rouge obtenu |
|---|---|---|
| NC1 | toutes les options rendues au chargement | 4 tests |
| NC2 | l'écran nomme `food_list_items` | N1.4-17..20 |
| NC3 | un état de sélection partagé entre occurrences | N1.4-08/09/12 |
| NC4 | la sélection retient l'**aliment** au lieu de l'option | N1.4-05/13/14 |
| NC5 | l'écran écrit à la sélection | N1.4-21/22/23 |
| NC6 | occurrences triées par libellé | N1.4-02/15 |
| NC7 | hydratation en N+1 | N1.4-31 |
| NC8 | clé de portée constante (fuite entre repas) | N1.4-24/25/26 |
| NC9 | un `useEffect` ouvre la porte à l'auto-sélection | 7 tests |
| NC10 | une option introuvable reste cliquable | N1.4-27 |

**Deux ont d'abord échoué, et les deux dénonçaient mes tests, pas le code.** NC2 sabotait un
**commentaire**, que `sansProse` efface avant l'analyse — sabotage refait dans du code réel.
NC4 est raconté au §2.

---

## 8. Responsive — mesuré listes OUVERTES

Le banc standard charge une page ; ici les options n'existent qu'après un clic. Un banc
dédié **clique réellement** la première occurrence de chaque bloc, puis mesure — et il regarde
aussi les conteneurs qui **avalent** un débordement (`overflow-y:auto` force l'autre axe).

Décor : 1, 5 et 10 occurrences, une occurrence à **douze options**, un libellé insécable de
83 caractères, des noms d'aliments longs, et une option sans libellé.

| viewport | `clientWidth` | `scrollWidth` | écart | ouvertes / options rendues |
|---:|---:|---:|---:|---|
| 375 | 375 | 375 | **0** | 3 / **36** |
| 390 | 390 | 390 | **0** | 3 / 36 |
| 430 | 430 | 430 | **0** | 3 / 36 |
| 768 | 768 | 768 | **0** | 3 / 36 |
| 1440 | 1440 | 1440 | **0** | 3 / 36 |

**Le banc discrimine** : un `div` de 2 400 px le fait basculer en `DÉBORDE` (`scroll=2416`) aux
deux largeurs testées.

**Ce que je n'ai PAS réussi à démontrer, et je ne le maquille pas** : retirer le `min-w-0` du
bouton et le `truncate` du libellé **ne reproduit aucun débordement** — un ancêtre retient déjà
la ligne. Même limite qu'en N1.3. Je peux donc écrire que la chaîne tient à cinq largeurs avec
36 options ouvertes, sur un banc prouvé capable de dire non ; je ne peux pas écrire que ce
`min-w-0`-là en est la cause. Les invariants gardés par N1.4-29/30 restent utiles — ils
empêchent la chaîne de se dégrader — mais ce sont des invariants, pas une cause mesurée.

---

## 9. Accessibilité

De vrais `<button>`, jamais un `div` cliquable (le test le vérifie par regex). `aria-expanded`
sur la bascule, `aria-controls` vers le groupe. Les options forment un `role="radiogroup"`
nommé par le libellé de l'occurrence, chaque option étant un `role="radio"` avec
`aria-checked`. L'icône est `aria-hidden` : le sens est porté par le texte — « Choisir » /
« Modifier », « Aucun choix » / le nom de l'aliment. Cibles tactiles à 44 px.

---

## 10. Non-régression

13 suites, 0 échec : `nutrition-n1-4` (16), `nutrition-n1-3` (23), `nutrition-n1-listes` (34),
`aliments-a5` (26), `aliments-a5-history` (26), `aliments-a5-coach` (11),
`aliments-a5-responsive` (17), `nutrition-plan-v2-builder` (72), `nutrition-recipes` (45),
`nutrition-single-assigned-plan` (28), `nutrition-v2-unified` (74), `security-hardening` (31),
`courses-c1-ui` (16). `npx tsc --noEmit` et `npx eslint .` verts, aucun espace en fin de ligne,
aucune tabulation.

**Aucun test existant n'a eu à être modifié** — contrairement à N1.3, aucun piège de
non-régression ne s'est déclenché : N1.4 n'ajoute ni migration, ni table lue, ni colonne.

---

## 11. Les fichiers

**Nouveaux**

| fichier | md5 |
|---|---|
| `lib/nutrition/meal-choice-selection.ts` | `c46ba3750170851940e945161587fb33` |
| `components/student/StudentMealChoices.tsx` | `43617bb144840db01deb024613909611` |
| `scripts/tests/nutrition-n1-4-choix-eleve.mts` | `0f28487aff957fe0328659c337e3093c` |
| `docs/nutrition-n1.4-livrable.md` | — |

**Modifiés**

| fichier | md5 | changement |
|---|---|---|
| `components/student/StudentPrescribedWeek.tsx` | `3e0748db70212557fbe1346de9dde35a` | montage du composant, clé repas+date |
| `lib/nutrition/plan-v2-week.ts` | `3ff06dfb1c53b4bac30f8df1eb5a47c6` | `ChoiceOption.optionId`, lecture seule |
| `lib/supabase/nutrition-week.ts` | `233abba68f7ad41b21275c217a6fc365` | `meal_choice_options.id` ajouté au `select` |
| `package.json` | — | `test:nutrition-n1-4` |

**Supprimé après usage** : `app/mesure-n1-4/page.tsx` (banc, §8).

---

## 12. Ce que N1.4 ne fait pas, et le laisse à N1.5

Aucune quantité, aucun calcul, aucune persistance, aucun repas consommé, aucune entrée. La
composition est prête à être lue par N1.5 sous la forme `choixResolus(occurrences, selection)`
— une occurrence, l'option snapshotée retenue, dans l'ordre du coach.

Sur `feat/nutrition-structured-meals`. **Rien n'a été commité, poussé, mergé, ni poussé en base.**
**STOP après N1.4.**
