# N1.3 — Ajouter des listes aux repas dans le constructeur coach

**Branche** `feat/nutrition-structured-meals` · N1.1 et N1.2 déjà commités.
**Aucun commit, aucun push, aucun merge, aucun `db push` — local ni distant.**

| | |
|---|---|
| Migration | **1**, celle que tu as validée (contrat au §2) |
| Tests N1.3 (JS) | **17 / 17**, 0 échec |
| Checklist SQL N1.3 | **43 / 43**, 0 échec — **exécutée** dans PostgreSQL |
| Checklist SQL N1.1 | **106 / 106**, 0 échec — rejouée, enfin |
| Contrôles négatifs | **10 / 10 discriminants**, tous restaurés (md5 identique) |
| Contrôle du banc responsive | **1**, il change de verdict quand on l'abîme |
| Non-régression | 24 suites, **683 tests**, 0 échec |
| `tsc --noEmit` / `eslint .` | verts · aucun espace en fin de ligne, aucune tabulation |

---

## 0. Ce qui est nouveau depuis le dernier lot : une base réelle

Les deux lots précédents se terminaient sur la même réserve — « la checklist SQL n'a pas pu
être rejouée, aucune base n'est joignable ». Cette fois j'ai **monté un PostgreSQL 16 local**
dans le conteneur : `initdb`, rôles Supabase, `auth`/`storage` minimaux, le baseline du dépôt,
puis **les 47 migrations dans l'ordre**. Tout s'applique sans une erreur, N1.3 comprise.

Conséquence directe : ce lot ne contient **aucune** affirmation SQL non exécutée. La migration
est appliquée pour de vrai, la RPC est appelée pour de vrai, les refus sont provoqués pour de
vrai, et les contrôles négatifs SQL rechargent la fonction sabotée avant de mesurer.

*(Les extensions `pg_cron`, `pg_net`, `supabase_vault` n'existent pas en local : leurs
`CREATE EXTENSION` sont neutralisés dans une copie de travail du baseline, jamais dans le
dépôt. Aucun objet du chantier N1 n'en dépend.)*

---

## 1. L'audit (§1), en dix constats

1. **Le constructeur actif est v2, et lui seul.** `app/admin/nutrition/[planId]/page.tsx`
   ligne 116-120 : `const isV2 = plan !== null;` — la contrainte
   `nutrition_plans_model_version_check` interdit toute autre version. `NutritionPlanBuilder`
   (v1) n'est importé nulle part. Le bouton « Modifier » v1 et
   `NutritionPlanV2ConversionDialog` vivent dans une branche `else` jamais empruntée.
2. **Le composant repas est `NutritionDayManualMeals.tsx`** (sous-composant `MealEditor`),
   atteint par `NutritionPlanV2Builder → NutritionPlanV2WeekPanel`.
3. **Il ne contient AUCUN appel Supabase** — ni lui, ni `NutritionPlanV2WeekPanel`. Un repas
   n'existe en base qu'après « Enregistrer ». C'est le fait qui a décidé de toute
   l'architecture du lot.
4. **La sauvegarde est une RPC unique**, `save_nutrition_plan_v2(p_payload jsonb)`
   (`20260812090000`), qui écrit `nutrition_plans`, `nutrition_plan_profiles`,
   `nutrition_meal_slot_targets`, `nutrition_days` et `meals` en une transaction, et
   **supprime les repas absents de la charge utile**.
5. **`meals`** porte `slot, name, items (jsonb {name, quantity}), macros, coach_notes`. Les
   objectifs du jour ne sont **pas** dans `nutrition_days.target` (toujours `'{}'`) : ils
   vivent dans `nutrition_plan_profiles` sous une clé `day_<jour>`, et par créneau dans
   `nutrition_meal_slot_targets`.
6. **Duplications réellement supportées** : le **plan** entier (fiche plan → `dupliquer()` →
   relecture → `toDuplicateWeekPayload` → même RPC) et le **jour** vers 1..N jours ou toute la
   semaine (`duplicateDay` / `applyDayToWholeWeek`, **100 % côté client**, rien n'est écrit
   avant Enregistrer). **La duplication d'un repas seul n'existe pas** — aucun bouton, aucune
   fonction. Aucune fonction SQL de duplication n'existe dans le dépôt.
7. **Les identifiants de repas viennent du NAVIGATEUR** : `newMealId()` est
   `crypto.randomUUID()`, et la RPC honore l'identifiant reçu
   (`coalesce(nullif(v_meal->>'id',''), gen_random_uuid())`). C'est ce qui rend possible d'y
   rattacher des occurrences.
8. **Le chemin inverse est fermé, et c'est mesuré** : la RPC ne renvoie que `meal_count` par
   jour, **jamais les identifiants de repas**, et `readNutritionPlanV2Week` trie les repas
   **par `slot` seul** — deux repas du même créneau n'ont aucun ordre déterministe. Une
   stratégie « sauvegarder puis apparier source → copie » aurait donc été **fausse**.
9. **Les objets N1.1 suffisent, sans une colonne de plus.** `meal_choice_slots` : `label`
   snapshoté (§6), `source_list_id … on delete set null` (§18), `unique (meal_id, position)`
   (§8), et **aucune unicité sur `source_list_id`** — N1.1 l'avait explicitement écarté pour
   permettre §10. `meal_choice_options` : identité XOR, FK `restrict`, aucune macro, aucun
   rôle, cascade depuis l'occurrence (§9).
10. **Mais N1.1 n'a aucune RPC côté coach** — seulement `cible_creneau_du_repas`,
    `enregistrer_repas_planifie` et `supprimer_repas_planifie`, toutes trois côté élève. Et
    les policies d'écriture ne vérifiaient que le rôle. D'où les deux points que tu as
    tranchés.

---

## 2. La migration livrée

`supabase/migrations/20260907090000_n1_3_occurrences_de_listes_dans_les_repas.sql`
(md5 `126058677996a5f80eb202351e87d451`) — conforme au contrat validé, correction comprise.

**RPC** : `save_nutrition_plan_v2(p_payload jsonb)`, `create or replace`, **signature
inchangée**. Une clé **optionnelle** `choice_slots` par repas :

| `choice_slots` | Effet |
|---|---|
| **absente** | les occurrences du repas ne sont **pas touchées** — les charges utiles d'avant N1.3 valent à l'octet près |
| `[]` | toutes les occurrences du repas sont retirées (cascade sur les options) |
| non vide | synchronisation complète, options comprises |

**La position n'est jamais lue** : elle est dérivée de l'ordre du tableau, pour les
occurrences comme pour les options. Des positions trouées ou dupliquées ne sont pas une règle
à faire respecter — elles sont hors d'atteinte. Le contrôle négatif **NC6** le prouve : en
lisant la position de la charge utile, PostgreSQL rend
`duplicate key value violates unique constraint "meal_choice_slots_position_unique"`.

**Refus explicites**, tous levés avant la moindre écriture :
`OCCURRENCE_HORS_REPAS`, `OCCURRENCE_SANS_OPTION`, `OPTION_SANS_IDENTITE`,
`INVALID_PAYLOAD: choice_slots …`.

**La correction que tu as exigée**, et pourquoi elle comptait :

> Pour chaque `choice_slots[].id` non nul : si l'identifiant existe déjà, il doit appartenir au
> `meal_id` en cours de traitement.

Sans elle, le `on conflict (id) do update` était une **porte** : envoyer dans le repas B
l'identifiant d'une occurrence du repas A l'aurait **déplacée** vers B, et le `where` du
`DO UPDATE` se serait contenté d'ignorer en silence. Un identifiant **inconnu** reste accepté —
c'est ainsi que le navigateur crée une occurrence dont il choisit l'UUID, et c'est ce qui rend
les duplications exactes.

**Policy** : `meal_choice_slots_manage_staff`, `using` inchangé, `with check` en trois
branches — `source_list_id is null`, **ou** `is_admin()`, **ou** propriétaire de la liste.
`current_coach_id()` rend `NULL` pour un administrateur sans ligne `coaches` : sans la
deuxième branche, cette migration aurait mis l'administration dehors.
`meal_choice_options_manage_staff` n'est pas touchée.

**Aucune** table, colonne, index, trigger ni backfill. `meals.items` n'est pas modifié d'une
ligne.

---

## 3. La décision d'architecture, et ce qu'elle coûte

> **Les occurrences vivent dans l'état du formulaire, et partent avec le plan.**

Un repas n'existe en base qu'au « Enregistrer » (§1.3) : y rattacher une occurrence au clic
aurait violé la clé étrangère `meal_choice_slots.meal_id`. Les occurrences sont donc tenues
dans `WeekFormState` et écrites **dans la même transaction que le repas**.

Trois conséquences, toutes voulues :

- **L'instantané est pris au CLIC, pas à l'enregistrement.** `lireSnapshotDeListe` lit la
  bibliothèque au moment où le coach choisit, et fige `label` + identités dans l'état. Si la
  bibliothèque change avant qu'il enregistre, le repas garde ce qu'il a vu.
- **Les duplications marchent sans rien de plus.** Dupliquer un jour copie les occurrences
  avec de **nouveaux** identifiants ; dupliquer un plan les détache (`id: null`) comme il
  détachait déjà les repas. Aucune cartographie source → copie n'est nécessaire — et on a vu
  au §1.8 qu'elle aurait été impossible à faire juste.
- **« Repas sauvegardé, snapshot manquant » n'existe pas.** Ce n'est pas une précaution : la
  base ne sait pas produire cet état.

**Ce que ça coûte, et je le dis franchement** : ajouter une liste ne se voit en base qu'au
prochain « Enregistrer ». C'est déjà le comportement de tout le constructeur — nom, notes,
aliments, objectifs — donc cohérent, mais c'est un écart au « quand le coach ajoute une liste,
créer une occurrence » du §4 pris au pied de la lettre.

---

## 4. Ce que chaque test prouve

**JS — 17 tests, gestes purs exécutés + pont bibliothèque → instantané exécuté contre le double N1.2**

| # | Ce qu'il établit |
|---|---|
| 01 | un repas à zéro liste est valide ; la charge utile dit « aucune » au lieu de se taire |
| 02/03 | ajouter crée UNE occurrence et fige libellé + identités (lecture réelle de la bibliothèque) |
| 04/05/06 | une option n'a que `catalog_food_id` / `product_id` ; aucun nom, macro, quantité ni rôle ne voyage |
| 07/08/09 | trois occurrences, deux issues de la même liste, snapshots indépendants |
| 10/11/28 | l'ordre du tableau est l'ordre envoyé ; dix occurrences tiennent ; **aucune position n'est émise** |
| 12/13 | retirer ne touche ni la bibliothèque (constatée inchangée) ni l'autre occurrence |
| 14 | remplacer garde l'identifiant ET le rang, change le contenu |
| 15/16/17 | modifier, renommer, archiver la bibliothèque : l'instantané ne bouge pas — et un instantané **neuf** voit bien les changements (sinon le test serait vert sur une lecture morte) |
| 18 | `sourceListId` nullable est un état normal |
| 19/30 | `meals.items` intact ; la clé absente ne touche à rien |
| 20/21/22 | dupliquer un jour emporte les occurrences, avec de nouveaux identifiants partout ; « appliquer à la semaine » : 7 × 2 identifiants tous distincts |
| 23 | dupliquer un plan détache repas **et** occurrences ; la duplication d'un repas seul n'existe pas, donc n'est pas testée |
| 24/25 | le cloisonnement est tenu par la policy, pas par l'écran ; aucun `grant` ajouté |
| 26 | `onChoisir` n'est appelé qu'après une lecture réussie et non vide |
| 27 | liste vide : refus explicite à l'écran **et** dans la base |
| 29 | `min-w-0`, `truncate`, `flex-wrap`, cibles 44 px, `aria-label`, feuille mobile |

**SQL — 43 contrôles, exécutés dans PostgreSQL**

`N13-A` rétrocompatibilité (clé absente / `[]` / non vide) · `N13-B` création et identités
réelles · `N13-C` positions dérivées, **une `position` envoyée est ignorée** · `N13-D` deux
occurrences de la même liste, snapshots différents · `N13-E` **RPC-ID-1..4** · `N13-G` les
quatre refus · `N13-H` le snapshot ne suit pas la bibliothèque · `N13-I` `source_list_id`
étranger refusé, nul accepté, **sa propre liste archivée acceptée** · `N13-J` cascade locale ·
`N13-K` **les options conservées gardent leur ligne**.

`N13-K` mérite un mot : `planned_meal_items` cascade depuis `meal_choice_options`. Un
« supprimer tout puis réinsérer » aurait été plus court — et aurait effacé le choix déjà
planifié par l'élève sur des options que le coach n'avait pas touchées. La RPC ne retire donc
que les options réellement absentes.

**Les quatre contrôles que tu as demandés** : RPC-ID-1 (mise à jour dans son repas), RPC-ID-2
(refus `OCCURRENCE_HORS_REPAS` + l'occurrence n'a pas bougé), RPC-ID-3 (**le refus annule
tout** — le repas était renommé « PDJ VOLÉ » dans la charge utile refusée, et il ne l'est
pas), RPC-ID-4 (deux occurrences de la même source restent permises).

---

## 5. Les dix contrôles négatifs

Chacun : sabotage → exécution → rouge attendu → restauration → **md5 vérifié**. Les six
sabotages SQL **rechargent la fonction sabotée dans la base** avant de mesurer.

| # | Sabotage | Rouge obtenu |
|---|---|---|
| NC1 | la lecture d'un repas va chercher `food_list_items` | N1.3-30 |
| NC2 | l'instantané est vidé à l'ajout | 6 tests |
| NC3 | la policy ne vérifie plus le propriétaire | N13-I |
| NC4 | une occurrence sans option est acceptée | N13-G |
| NC5 | une option sans identité passe | N13-G ×2 |
| NC6 | la position est lue de la charge utile | **checklist interrompue** : `duplicate key … meal_choice_slots_position_unique` |
| NC7 | retirer une occurrence supprime les aliments du modèle | N13-J |
| NC8 | la duplication d'un jour partage les identifiants d'occurrence | N1.3-20/21/22 |
| NC9 | un échec de lecture est présenté comme un succès | N1.3-26 |
| NC10 | une deuxième occurrence de la même source est refusée | **checklist interrompue** : `SOURCE_DEJA_UTILISEE` |

**NC7 a trouvé un défaut dans MA checklist, pas dans le code.** Au premier passage il est resté
vert : l'occurrence retirée par `N13-J` n'avait **aucune provenance**, donc la suppression
sabotée ne pouvait atteindre aucune liste. Le contrôle mesurait donc du vide. `N13-J` pose
maintenant une provenance réelle, et NC7 rougit.

**NC10 a trouvé un défaut dans MA sabotage.** Placée dans la boucle de validation, elle ne
pouvait rien refuser : à cet instant, aucune occurrence n'est encore écrite. Déplacée dans la
boucle d'écriture, elle rougit.

---

## 6. Responsive — ce qui est mesuré, et ce qui ne l'est pas

Banc temporaire (`app/mesure-n1-3/page.tsx`, **supprimé après mesure**) rendant le vrai
`MealChoiceListsPanel` dans le vrai `AdminShell`, avec **1, 5 et 10 occurrences** et un
libellé insécable de 84 caractères. Serveur Next réel, Chromium, garde-fou de contenu actif.

| viewport | `clientWidth` | `scrollWidth` | écart | conteneur défilant subi |
|---:|---:|---:|---:|---|
| 375 | 375 | 375 | **0** | aucun |
| 390 | 390 | 390 | **0** | aucun |
| 430 | 430 | 430 | **0** | aucun |
| 768 | 768 | 768 | **0** | aucun |
| 1440 | 1440 | 1440 | **0** | aucun |

**Le banc discrimine** : un `div` de 2 400 px injecté fait basculer le verdict aux deux
largeurs testées, et révèle que `<main class="… overflow-y-auto …">` **avale** le débordement
(`client=375 scroll=2424`, +2 049 px) — `documentElement` reste à 375. Mesurer le seul document
aurait conclu « rien à signaler ».

**Ce que je n'ai PAS réussi à démontrer, et je ne le maquille pas** : retirer le `min-w-0` du
panneau et le `truncate` du libellé **ne reproduit aucun débordement**. L'explication est
qu'un ancêtre `min-w-0` retient déjà la ligne dans la chaîne mesurée. Je ne peux donc pas
écrire « ce `min-w-0`-ci est la cause » : je peux écrire que **la chaîne complète** tient à
cinq largeurs avec dix occurrences, sur un banc prouvé capable de dire non. Les invariants
gardés par N1.3-29 restent utiles — ils empêchent la chaîne de se dégrader — mais ce sont des
invariants, pas une cause mesurée.

---

## 7. Non-régression

24 suites, **683 tests**, 0 échec : `aliments-a1/a2/a3-search/a3-ui/a5/a5-history/a5-coach/
a5-responsive`, `courses-c1`, `courses-c1-ui`, `nutrition-v2-unified`, `nutrition-recipes`,
`nutrition-recipes-admin`, `nutrition-plan-v2-builder`, `nutrition-recipe-solver`,
`nutrition-macro-targets`, `nutrition-single-assigned-plan`, `nutrition-meal-distribution`,
`security-hardening`, `authz-hardening`, `admin-shell-nav`, `pwa-coquille`,
`nutrition-n1-listes` (34), `nutrition-n1-3` (17). Plus les deux checklists SQL : **106** et
**43**.

**Trois rouges attendus ont dû être levés à la main, et chacun était un piège volontaire :**

- **Le compteur de migrations** : 46 → 47 et 73 → 74 fichiers, dans le manifeste et **19
  assertions réparties sur 10 fichiers**, plus trois listes nominatives de « migrations
  postérieures » et six assertions qui relisent le TEXTE de `security-hardening.mts`.
- **`N1-M` (checklist N1.1)** épinglait l'équivalence exacte entre les policies des
  occurrences et celles de `meals`. N1.3 l'a rompue **volontairement**. Le contrôle est
  scindé en cinq : le `using` reste identique à `meals` (donc si `meals` était restreint un
  jour, ils rougiraient tous ensemble), les options gardent aussi le `with_check` de `meals`,
  et trois nouvelles assertions décrivent ce que N1.3 a ajouté — garde de rôle, propriété de
  la provenance, branche administrateur.
- **`nutrition-v2-unified` n°24** figeait la liste des tables lues par la couche semaine. Elle
  en compte deux de plus, et le contrôle vérifie désormais **en plus** que `food_lists` et
  `food_list_items` n'y sont **jamais** — c'est cette absence qui fait l'instantané.

**Un rouge n'est PAS de moi et je n'y ai pas touché** : `student-feedback-video` échoue sur
`F6`, qui attend `videosExercice[exerciseFb.exerciseId]` dans
`components/student/SessionFeedbackSection.tsx` là où le fichier écrit
`videosExercice[exercise.id]`. Ce fichier n'est pas dans le périmètre N1.3 et je ne l'ai pas
modifié ; la suite ne contient ni `74` ni `n1_3`. À regarder à part.

---

## 8. Les fichiers

**Nouveaux**

| fichier | md5 |
|---|---|
| `supabase/migrations/20260907090000_n1_3_occurrences_de_listes_dans_les_repas.sql` | `126058677996a5f80eb202351e87d451` |
| `supabase/tests/nutrition_n1_3_occurrences_checklist.sql` | `eadfd1bc5539510c618a93a54c510fcf` |
| `components/admin/MealChoiceListsPanel.tsx` | `25265d5cdc5c61f92daae27dfe2b9177` |
| `scripts/tests/nutrition-n1-3-occurrences.mts` | `7cb93e7a539cc78c32acb21a24e439e7` |
| `docs/nutrition-n1.3-livrable.md` | — |

**Modifiés**

| fichier | md5 | changement |
|---|---|---|
| `lib/nutrition/plan-v2-week.ts` | `0dfc7de85ba4460dd6eeca0efe5b39ec` | types `ChoiceOption`, `MealChoiceSlot`, champ `choiceSlots` |
| `lib/nutrition/plan-v2-week-form.ts` | `c4f69b50b2c6d19645257ec0065604d8` | 4 gestes purs, charge utile, duplications, `estUuid` |
| `lib/supabase/nutrition-week.ts` | `f2b945dbb67231074f34b4b1918d1777` | lecture des occurrences en deux requêtes |
| `lib/supabase/food-lists.ts` | `59625c4fb6e8b7c97469a789ddcf97b5` | `lireSnapshotDeListe` — le pont, unique |
| `components/admin/NutritionDayManualMeals.tsx` | `af25fc3130c61e00a05e8c7d3eeeaa17` | panneau branché, chaîne `min-w-0` |
| `components/admin/NutritionPlanV2WeekPanel.tsx` | `2ef4790c18a59e20c8e3602d3088ec27` | les 4 gestes câblés |
| `supabase/tests/nutrition_n1_listes_checklist.sql` | `d76a5ee51dc990ee743f997732dc48ab` | `N1-M` scindé (102 → 106) |
| `supabase/baseline/manifest.json` | `ae70997d085ca0b352e93e47e9e5d66a` | 47ᵉ migration déclarée |
| `package.json` | — | `test:nutrition-n1-3` |
| 10 fichiers `scripts/tests/*.mts` | — | compteurs 46→47, 73→74, listes nominatives, fixtures `choiceSlots: []` |

**Supprimé après usage** : `app/mesure-n1-3/page.tsx` (banc, §6).

---

## 9. Ce qui n'est pas fait, et pourquoi

- **Aucun calcul** : `solveRecipe`, objectifs, distribution, consommation A5, historique,
  courses, recettes — pas une ligne touchée. N1.3 est construction coach + snapshots.
- **Aucune conversion de `meals.items`**, aucun backfill, aucune occurrence créée d'office.
- **La duplication d'un repas seul** n'est pas testée : elle n'existe pas dans l'application.
- **`app/admin/nutrition/[planId]/page.tsx` n'est pas modifié** : la duplication de plan passe
  déjà par `toDuplicateWeekPayload`, qui emporte désormais les occurrences.

---

## 10. Git et base

Sur `feat/nutrition-structured-meals`. **Rien n'a été commité, poussé, mergé.**
**Aucun `db push`** : la migration n'est appliquée que sur le PostgreSQL local et jetable du
conteneur. Elle t'attend pour la distante. **STOP après N1.3.**
