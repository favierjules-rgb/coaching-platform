# ALIMENTS A5.8 — HISTORIQUE ALIMENTAIRE CÔTÉ COACH — LIVRABLE

**Livré, non commité. Aucun `db push`. Aucun merge. Aucune migration.**
Complète A5.7, qui ne livrait que l'écran élève.

---

## 1. Ce qui manquait, et qui est comblé

A5.7 livrait l'historique **côté élève seulement**. La couche de données n'était
prête que pour la dimension **date** :

```ts
readConsumedMeals(supabase, dates)   // aucun paramètre student_id
```

Elle lisait `student_id` dans son `select` et `mapMeal` **jetait la colonne**.
Pour un élève, sans conséquence — la RLS ne laisse passer qu'une personne. Pour
un **coach**, la même RLS laisse passer **tous ses athlètes** : l'appeler tel
quel rendait les repas de plusieurs élèves mélangés, sans moyen de les séparer.

---

## 2. Migration : **NON** — vérifié sur le schéma réel

| ce qu'il fallait | état |
|---|---|
| policy coach `select` sur `consumed_meals` | **existe** — `is_coach_of_student(student_id)` |
| policy coach `select` sur `meal_entries` | **existe** — idem |
| `student_id` sur les deux tables | **existe**, `NOT NULL` |
| un index servant `(élève, semaine)` | **existe** — `consumed_meals_student_date_idx (student_id, consumed_on, position)` |

L'index est même **mieux** adapté au chemin coach qu'au chemin élève :
`student_id` est sa colonne de tête.

`supabase/migrations/` compte toujours **72 fichiers**, dont **45**
post-baseline. Aucun fichier postérieur à `20260905090100`. Deux tests le
vérifient par comptage (`HIST-SUP`, `COACH-SUP`).

Un chemin distinct mérite d'être noté : `is_coach_of_student` passe par
`current_coach_id()` et est **faux pour un administrateur sans fiche coach**.
L'admin accède par `is_admin()`, via les policies `*_manage_admin`. Deux routes
différentes, toutes deux déjà en place.

---

## 3. Le data layer — une cible **obligatoire**

```ts
export type CibleLecture =
  | { readonly portee: "eleve-connecte" }                          // chemin élève
  | { readonly portee: "eleve"; readonly studentId: string };      // chemin coach

readConsumedMeals(supabase, dates, cible: CibleLecture)            // ← requis
```

**Pourquoi un type plutôt qu'un `studentId?: string`.** Un paramètre optionnel a
un comportement par défaut : « ne filtre pas ». Pour l'élève ce défaut est juste.
Pour le coach, il rend tous ses athlètes en une seule réponse. Le jour où un
appelant coach oublierait l'argument, **rien ne le signalerait** — ni erreur, ni
type, ni test — juste un écran qui additionne deux élèves. Une union discriminée
et obligatoire supprime le défaut : « je veux tout » n'est plus exprimable
(point 3 du cahier des charges).

`ConsumedMeal.studentId` est ajouté et conservé par `mapMeal` — c'est ce qui
permet à COACH-HIST2 de **constater** une séparation au lieu de la supposer.

⚠️ **Le filtre client ne protège rien, et le code le dit.** `.eq("student_id",
…)` ne remplace aucune policy : un coach qui nommerait l'élève d'un confrère
reçoit une liste vide **parce que la base refuse**. Ce que le filtre apporte est
autre chose et nécessaire — **désambiguïser**. Confondre les deux serait le
piège, et la prose du fichier l'écarte explicitement.

Les deux requêtes sont filtrées, pas seulement la première. Aujourd'hui la
seconde porte sur des identifiants déjà restreints ; le jour où cette liste
viendrait d'ailleurs (une liste de courses, un export), la borne serait toujours
là.

---

## 4. Le hook — lecture seule **par construction**

`hooks/useHistoriqueEleve.ts` expose exactement quatre choses :
`loading`, `error`, `meals`, `refetch`.

`useConsumedMeals` aurait pu recevoir un élève en paramètre. Il expose **onze
fonctions d'écriture**. Les passer à un écran coach en espérant qu'il ne les
appelle pas, c'est fonder une garantie de sécurité sur une intention. Ce hook
n'en expose **aucune** et n'importe aucune RPC d'écriture : il n'y a rien à
appeler.

Un détail qui compte : le **compteur de requête**. Le coach passe d'un athlète à
l'autre pendant qu'une lecture est en vol ; sans ce garde, la réponse **lente**
du premier écraserait celle du second et la fiche de B afficherait les repas de
A — sans erreur, sans indice à l'écran.

---

## 5. L'écran — Coach → Élève → Nutrition → Historique

Bloc **« Historique alimentaire »** dans `app/admin/eleves/[studentId]/`, sous
le « Suivi nutrition » existant. `/admin` est déjà gardé par
`requireAdminOrCoach()`.

⚠️ **Il n'est PAS conditionné au plan assigné**, contrairement au bloc voisin.
Un élève peut avoir mangé — et noté ce qu'il a mangé — sans plan, ou après qu'un
plan lui a été retiré. Exiger `assignedPlan` ferait disparaître un historique
qui existe.

Affiche : semaine sélectionnée · flèches ‹ › · sept jours · jour du jour
sélectionné · anneau kcal + barres P/G/L · jours suivis · repas réellement
consommés · aliments, quantités, unités.

### Réutilisation (point 13)

| réutilisé à l'identique | écrit à neuf |
|---|---|
| `lib/nutrition/historique.ts` | le rendu d'un repas et d'un aliment |
| `NutritionWeekNav` | |
| `NutritionDayCarousel` | |
| `DailyNutritionProgress` | |
| `totalsForDay` / `totalsForMeal` / `entryKcal` / `formatHeureFr` | |

**Ce qui est exclu, et pourquoi.** `ConsumedFoodBar` est un `<button>` dont le
libellé d'accessibilité dit « modifier » ; `ConsumedMealSection` exige sept
fonctions d'écriture. Les brancher demanderait des rappels factices — donc
d'afficher au coach des commandes qui ne font rien. Le rendu est donc en `<li>`,
pas en `<button>`.

**Ce qui est dupliqué est du balisage ; ce qui est partagé est le CALCUL.** Deux
écrans qui additionnent séparément finissent par afficher deux chiffres pour la
même journée, et c'est le coach qui découvre l'écart devant son athlète. Un test
interdit toute arithmétique locale (`getDay(`, `setDate(`, `reduce((`, `/ 7`).

### Une décision assumée : aucun objectif affiché

L'anneau montre le **consommé sans cible**. Cet écran répond à « qu'a-t-il
réellement mangé », pas à « a-t-il tenu son objectif » — auquel le bloc « Suivi
nutrition » répond déjà. Afficher une cible supposerait de reconstruire les sept
profils du plan, donc de **réintroduire la prescription dans un écran
d'historique**. Si tu veux l'objectif superposé, c'est un lot à part.

---

## 6. Tests — COACH-HIST1..10, 11 tests, 0 échec

`npm run test:aliments-a5-coach`

**Trois niveaux, chacun prouvant ce que les autres ne peuvent pas :**

1. `readConsumedMeals` est **appelée pour de vrai** contre un double de Supabase
   qui **applique réellement** `.in()` et `.eq()` — on observe la requête émise
   et ce que la fonction fait de la réponse, pas une intention lue dans le code.
2. Le rendu passe par `renderToString` sur les composants exportés.
3. La RLS ne se prouve **qu'en base**, et l'est dans la checklist.

⚠️ Le double **ne remplace pas la RLS** : il montre que l'application nomme
l'élève, pas que la base l'aurait protégé sans ça.

| | |
|---|---|
| COACH-HIST1 | l'élève nommé, et lui seul ; `.eq` observé sur **les deux** tables ; 7 dates |
| COACH-HIST2 | A et B ont mangé **le même jour** ; ciblé → 2 repas, l'autre → 1 ; les 777 g de B introuvables chez A. **Contrôle discriminant** : sans ciblage le banc rend bien les 3 |
| COACH-HIST3 | policy `is_coach_of_student` + checklist exécutée sur un banc à **deux coachs** |
| COACH-HIST4 | hook sans écriture ; écran sans client Supabase ; rendu **sans `<button>`**. **Contrôle discriminant** : la version élève, elle, est cliquable et dit « modifier » |
| COACH-HIST5 | deux lectures, deux élèves ; `studentId` dans les dépendances ; compteur anti-écrasement |
| COACH-HIST6 | même élève, dates différentes ; la semaine est un **état**, l'élève une **prop** |
| COACH-HIST7 | jour vide, conteneur vide, et **thé sans sucre** — les trois à 0 kcal, un seul est « sans saisie » |
| COACH-HIST8 | instantanés affichés inchangés ; aucune source vivante nommée dans l'écran |
| COACH-HIST9 | repas personnel visible, à égalité ; aucun filtre sur `kind` |
| COACH-HIST10 | `150 g`, `200 ml`, `2 pièce` — aucune conversion |
| COACH-SUP | écran branché, réutilisation vérifiée, cible **sans défaut**, 72 migrations |

**Checklist SQL** — `aliments_a5_7_historique_checklist.sql`, **38 contrôles,
0 échec** (30 d'A5.7 + 8 nouveaux), `ROLLBACK` propre.

### Un garde resserré, pas supprimé

HIST18 affirmait « A5.7 n'ouvre **aucun** écran coach ». A5.8 a légitimement
franchi cette frontière. Effacer le garde aurait fait disparaître la règle avec
la phase ; le laisser tel quel aurait rendu rouge un travail demandé. Il est
**reformulé** sur ce qu'il protège vraiment : exactement **deux** policies coach
sur l'historique, toutes deux en `SELECT`, aucune en écriture.

### Deux contrôles réécrits parce qu'ils ne prouvaient rien

- Une sous-assertion était **tautologique** (`student_id = X and student_id <>
  X` ne peut jamais échouer). Remplacée par une mesure qui peut échouer : sans
  ciblage le coach reçoit **4** entrées au lieu de 3 — l'entrée de trop.
- « Pas de `Seq Scan` » sur un banc de **8 lignes** : sur huit lignes, un Seq
  Scan est le plan **correct**. Ce contrôle était vert par accident et devenait
  rouge dès qu'on ajoutait un prédicat. Remplacé par ce qui **ne dépend pas de
  la taille** : avec `enable_seqscan = off`, le planner trouve-t-il l'index de
  semaine ? Oui — ce qu'un contrôle d'existence par le nom ne dirait pas. Le
  temps réel reste mesuré sur le banc de 21 600 entrées (0,333 ms).

---

## 7. Contrôles négatifs — neuf, exécutés puis restaurés

| # | ce qui a été cassé | rouge obtenu |
|---|---|---|
| A | le `.eq` de ciblage retiré | COACH-HIST1, 2, 5, 6 |
| B | la cible redevient optionnelle (défaut « tout ») | COACH-SUP |
| C | une écriture rebranchée dans le hook | COACH-HIST4, COACH-SUP |
| D | `ConsumedFoodBar` (cliquable) réutilisé côté coach | COACH-HIST4, COACH-SUP |
| E | l'élève devient un état interne | COACH-HIST6 |
| F | `studentId` retiré des dépendances de chargement | COACH-HIST5 |
| G | jour vide traité comme 0 kcal | COACH-HIST7 |
| H | `ml` converti en `g` au rendu | COACH-HIST10 |
| I | une policy d'écriture coach ajoutée en base | checklist : HIST19 ×3 |

```
RESTAURATION VÉRIFIÉE : aucun écart avec la référence A5.8
# pass 11 # fail 0
ALIMENTS A5.7 · HISTORIQUE — 38 contrôles, 0 échec(s)
```

---

## 8. Non-régression (point 14)

| suite | | suite | |
|---|---|---|---|
| `aliments-a1` | 16 / 0 | `nutrition-macro-targets` | 15 / 0 |
| `aliments-a2` | 42 / 0 | `nutrition-meal-distribution` | 23 / 0 |
| `aliments-a3` | 19 / 0 | `nutrition-recipe-solver` | 25 / 0 |
| `aliments-a3-off` | 23 / 0 | `nutrition-plan-v2-guards` | 18 / 0 |
| `aliments-a3-ui` | 25 / 0 | `nutrition-plan-v2-builder` | 72 / 0 |
| `aliments-a3-search` | 36 / 0 | `nutrition-single-assigned-plan` | 28 / 0 |
| `aliments-a4-scan` | 25 / 0 | `nutrition-recipes` | 45 / 0 |
| `aliments-a4-ui` | 30 / 0 | `nutrition-recipes-admin` | 65 / 0 |
| `aliments-a5` | 26 / 0 | `nutrition-recipe-images` | 46 / 0 |
| `aliments-a5-jour` | 16 / 0 | `nutrition-v2-unified` | 74 / 0 |
| `aliments-a5-history` | 26 / 0 | `nutrition-linebreaks-rpe-halves` | 14 / 0 |
| **`aliments-a5-coach`** | **11 / 0** | `security-hardening` | 31 / 0 |
| | | `admin-shell-nav` | 16 / 0 |
| | | `student-content-assignment` | 20 / 0 |

**Total : 807 tests, 0 échec.** Plus la checklist SQL : 38 contrôles, 0 échec.

Les suites exigeant des identifiants Supabase réels (`webhook-*`,
`account-activation-provisioning`, …) n'ont pas été exécutées : elles échouent
dans le conteneur pour absence de secrets, indépendamment d'A5.8, et les lancer
supposerait de toucher à la base réelle.

```
npx tsc --noEmit    → exit 0
npx eslint .        → exit 0
git diff --check    → exit 0
```

---

## 9. `git status` (point 15 — rien n'est commité)

16 fichiers modifiés ou ajoutés, aucun stagé, aucun commit, `HEAD` toujours sur
`d842849`.

⚠️ **Un point à traiter avant ton commit.** Le pont vers ton Mac ne peut pas
supprimer de fichiers, et git y a laissé un `.git/index.lock` vide. La lecture
fonctionne (`status`, `diff --check` sont passés), mais ton prochain `git add`
ou `git commit` en local échouera avec *« Unable to create '.git/index.lock':
File exists »*. Une ligne suffit, depuis ton terminal :

```
cd ~/Documents/coaching-platform && rm -f .git/index.lock
```

Le dossier `_to_delete/` contient aussi `a57.tgz`, `a58.tgz` et
`git-lock-a58/` — à supprimer quand tu veux, je ne peux pas le faire d'ici.
