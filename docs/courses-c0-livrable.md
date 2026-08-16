# COURSES C0 + C0.1 — VALIDER MES CHOIX, ET FIGER CE QUI EST CONSOMMÉ

**Aucun transfert Mac. Aucun commit. Aucun push. Aucun `db push`.**
Branche `feat/nutrition-structured-meals`. Conteneur uniquement.

| | |
|---|---|
| Migrations sur disque | 79 → **80** (C0 : 0 · C0.1 : 1) |
| Manifeste post-baseline | 52 → **53** |
| Checklist C0/C0.1 | **72 contrôles, 0 échec** |
| Suite TS `courses-c0` | **16 tests, 0 échec** |
| Contrôles négatifs | **13, tous discriminants** |
| `tsc --noEmit` · `eslint .` · `git diff --check` | exit 0 |
| Batterie complète | **105 suites, 96 vertes** — 9 rouges, toutes antérieures au lot |
| Responsive 375 / 390 / 430 / 768 / 1440 | **0 débordement**, boutons à 44 px, banc contrôlé |

---

## 1. Ce que C0 ajoute, en une phrase

Un second geste — **« Valider mes choix »** — qui écrit la composition **prévue** (`planned_meals` + `planned_meal_items`) sans jamais déclarer le repas mangé. C'est la source dont Courses aura besoin.

```
VALIDER MES CHOIX     → enregistrer_repas_planifie          → PRÉVU
ENREGISTRER LE REPAS  → enregistrer_repas_structure_consomme → CONSOMMÉ (A5, inchangé)
```

**C0 n'a écrit aucune migration.** La RPC existait depuis N1.1, `security definer`, accordée à `authenticated`, révoquée pour `anon` — elle n'avait simplement jamais été appelée seule.

---

## 2. Le banc, avant la première ligne d'interface

`supabase/tests/courses_c0_validation_checklist.sql` a été écrit et exécuté **avant** tout code d'écran, parce qu'appeler seule une fonction qui ne l'avait jamais été, c'est un chemin non éprouvé.

| | Mesuré |
|---|---|
| **V-A** | signature `(uuid, date, jsonb)`, aucune macro, aucun élève — l'élève vient du JWT. `authenticated` oui, `anon` non. Et sur la SOURCE : jamais d'`insert` dans `consumed_meals` ni `meal_entries`, jamais d'écriture de `consumed_meal_id` |
| **V-B** | 1 `planned_meal` daté + 1 item **par occurrence**, quantités exactement transmises (163 g reste 163), identité et occurrence conservées |
| **V-C** | **aucun** `consumed_meal`, **aucune** `meal_entry`, `consumed_meal_id` **NULL** |
| **V-D** | deux appels identiques → même `planned_meal`, aucun doublon |
| **V-E** | revalidation → items **remplacés**, même `planned_meal`, `consumed_meal_id` toujours NULL |
| **V-F** | refus : `CHOIX_INCOMPLET` · `CHOIX_HORS_LISTE` · `IDENTITE_INVALIDE` · `QUANTITE_INVALIDE` · autre élève (`REPAS_PRESCRIT_INACCESSIBLE`, et RLS aveugle) · `anon` (`permission denied`). Aucun refus ne laisse de trace |
| **V-G** | jour A ≠ jour B, déjeuner ≠ dîner |
| **V-H** | identité **produit** préservée, sans `catalog_food_id` |
| **V-J** | enregistrer après validation ne duplique rien ; c'est la consommation qui pose `consumed_meal_id` |

---

## 3. C0.1 — le verrou, et ce qui l'a rendu nécessaire

Le contrôle `V-I` de C0 avait **mesuré** une divergence, sur données réelles :

```
consommer le dîner            → meal_entries        175 g
revalider le même repas       → planned_meal_items  999 g
                                consumed_meal_id    survit
planifié ≠ consommé, et rien côté serveur ne l'empêchait
```

La règle arbitrée, et désormais appliquée en base :

> `planned_meals.consumed_meal_id IS NOT NULL` ⟹ `enregistrer_repas_planifie` **refuse**, avec `REPAS_DEJA_CONSOMME`.

Une consommation enregistrée **fige** la composition planifiée correspondante. Pour Courses, cela garantit qu'un repas passé ne change plus rétroactivement de composition dans la source.

### 3.1 Où le refus se place, et pourquoi

Juste **après** le contrôle d'appartenance du repas, donc **avant** l'`upsert` de `planned_meals`, **avant** la validation de la charge utile, et **avant** le `delete` des items. Le `select … for update` verrouille la ligne : la décision n'est pas une course.

⚠️ **Honnêteté sur ce que `LOCK-04` prouve.** Il compare le contenu complet des items avant/après le refus — pas leur nombre, car une réécriture 175 → 999 garderait une ligne. Mais il ne peut **pas** prouver que le refus précède le `delete` : un `raise` à l'intérieur d'une fonction annule de toute façon les écritures de l'instruction. Mesuré : déplacer le verrou après le `delete` laisse `LOCK-04` **vert**, et ne fait rougir que `LOCK-03`. C'est donc **`LOCK-03` qui garde l'ordre**, en exigeant que le refus arrive avant même la validation du payload.

### 3.2 Le piège : deux fonctions, pas une

`enregistrer_repas_structure_consomme` appelait `enregistrer_repas_planifie` **en premier**, puis constatait ensuite que le repas était déjà enregistré pour rendre sa réponse idempotente.

Poser le verrou sans rien d'autre aurait fait lever `REPAS_DEJA_CONSOMME` **au second enregistrement d'un même repas** — c'est-à-dire cassé l'idempotence de N1.6B sur le geste le plus banal qui soit : un double clic.

L'ordre est donc inversé : **on décide, puis on délègue.** Et ce n'est pas qu'une concession au verrou — l'ancien ordre avait un défaut propre, que le verrou n'a fait que révéler : *un second appel portant des items DIFFÉRENTS réécrivait `planned_meal_items` avant de répondre « déjà enregistré »*, et faisait diverger planifié et consommé **par le chemin normal**, sans appel direct ni intention hostile. `LOCK-09` le mesure désormais.

---

## 4. Impact sur N1.6B — mesuré, pas supposé

| Scénario | Avant C0.1 | Après C0.1 |
|---|---|---|
| Enregistrer **sans** validation préalable | ✔ | ✔ `LOCK-07` |
| Enregistrer **après** validation | ✔ | ✔ `LOCK-08` |
| Double enregistrement (idempotence) | ✔ | ✔ `LOCK-09` |
| Double enregistrement **aux items différents** | réécrivait le planifié en silence | ✔ ne réécrit plus rien |
| Revalider un repas consommé | réécrivait, divergence | ✖ `REPAS_DEJA_CONSOMME` |
| Revalider un repas **non** consommé | ✔ | ✔ `LOCK-01` |

La checklist N1.6B reste à **35 contrôles, 0 échec**, sans une ligne modifiée.

---

## 5. L'interface — deux gestes, quatre états

```
[ VALIDER MES CHOIX ]           secondaire — bordure sobre
[ ENREGISTRER LE REPAS ]        principale — pleine

validé et à jour   →  ✓ CHOIX VALIDÉS
                      « Cette composition sera prise en compte pour ta liste de courses. »
validé et modifié  →  MODIFICATIONS NON VALIDÉES
                      « Ta liste de courses utilise encore la composition précédente. »
                      [ METTRE À JOUR MES CHOIX ]
consommé           →  ✓ REPAS ENREGISTRÉ   (aucun bouton de validation)
```

« Repas enregistré » reste **réservé à la consommation**. Aucun bouton nouveau après consommation — le verrou serveur et l'interface disent la même chose.

**Aucune écriture au clic sur un choix** : le composant n'importe pas Supabase, et `choisir` ne fait que poser un état local.

---

## 6. Persistance, restauration, divergence

**Deux requêtes batchées, jamais un N+1** : `planned_meals` sur l'intervalle de dates, puis `planned_meal_items` sur les identifiants trouvés.

**La restauration se fait par `choice_slot_id` + identité, jamais par nom.** Une ligne orpheline — aliment retiré de l'occurrence depuis la validation — est **ignorée, pas devinée** : l'occurrence redevient « à choisir ».

**La sélection est dérivée, pas synchronisée** : `brouillon ?? selectionValidee ?? AUCUNE_SELECTION`. Aucun `useEffect` de recopie, qui aurait créé une fenêtre où l'écran montre « aucun choix » sur un repas validé, et aurait écrasé un brouillon si la relecture tombait entre deux clics.

**La divergence compare identités ET quantités ET unités.** Deux causes la produisent — l'élève change un choix, ou le calcul a bougé sous lui (portion préférée modifiée par le coach, minimum ajouté, solveur amélioré) — et les deux méritent le même signal et la même décision explicite. La composition validée n'est **jamais** réécrite par un simple rechargement : il faut un clic.

---

## 7. Contrôles négatifs — 13, tous discriminants

**C0 (TypeScript)**

| Sabotage | Rougit |
|---|---|
| la validation crée un `consumed_meal` / une `meal_entry` | `C0-06/07/08` |
| quantité flottante interne envoyée | `C0-03` **et** `C0-23/24` |
| écriture à chaque clic radio | `C0-15/25` |
| état validé gardé en React seul | `C0-09` |
| réassociation par nom | `C0-10` **et** `C0-10b` |
| « Enregistrer » exige la validation | `C0-20` **et** `C0-22` |
| module de l'ancien C1 importé | `C0-28` |
| le geste repart d'une sélection vide | `N1.4-08/09/12` |
| une persistance navigateur est inventée | `N1.5-15` |
| la clé de montage disparaît | `N1.4-24/25/26` **et** `C0-11/12` |

**C0.1 (base)**

| Sabotage | Rougit |
|---|---|
| **A** — le test `consumed_meal_id` est retiré | `LOCK-02` · `LOCK-03` · `LOCK-04` ×2 · `LOCK-09` |
| **B** — le verrou est testé après le `delete` | `LOCK-03` *(et pas `LOCK-04` — voir §3.1)* |
| **C** — tout `planned_meal` existant est bloqué | `V-D` lève `REPAS_DEJA_CONSOMME`, checklist avortée |
| **D** — `enregistrer_repas_structure_consomme` échoue | `LOCK-07` / `LOCK-08`, checklist avortée |
| **E** — migration non déclarée après le CONTRACT | `CONTRACT-07` |
| **F** — migration postérieure qui lit `preferred_unit` | `CONTRACT-07` |
| items non remplacés (migration N1.6B sabotée) | checklist, `duplicate key` |

---

## 8. Tripwires adaptés — en nommant l'exception

| contrôle | disait | dit |
|---|---|---|
| `N1.4-08/09/12` | `choisirOption(precedente, …)` | le geste part du brouillon **ou de la sélection restaurée** |
| `N1.4-26` | `useState<SelectionDeChoix>(AUCUNE_SELECTION)` | brouillon à `null`, aucune persistance navigateur, isolation par la **clé de montage** |
| `N1.5-15` | « un rafraîchissement repart sans sélection » | « un **brouillon non validé** ne survit pas au rafraîchissement » |
| `CONTRACT-07` | le CONTRACT est la **dernière** migration du dépôt | toute migration postérieure est **nommée** et **prouvée** sans `preferred_unit` |
| compteurs | 79 / manifeste 52 | **80 / 53**, + C0.1 dans les deux listes nominatives |

⚠️ **C0 change une règle documentée de N1.4/N1.5** : un rafraîchissement ne repart plus forcément à vide, puisqu'une composition validée est restaurée. C'est le but du lot, pas une fuite — et ce qui reste vrai est vérifié : le brouillon non validé, lui, ne survit à rien.

---

## 9. Responsive

Les quatre états rendus dans Chromium **avec la vraie feuille du projet** — pire cas : cinq occurrences, libellés Ciqual longs, trois lignes d'écart, les deux boutons.

```
375 / 390 / 430 / 768 / 1440 px   scrollWidth == clientWidth   AUCUN DÉBORDEMENT
boutons mesurés à 44 px exactement
```

⚠️ **Correction de méthode.** Le banc responsive utilisé jusqu'ici chargeait Tailwind depuis le CDN — **injoignable depuis ce conteneur** (`ERR_CONNECTION_RESET`). Les mesures étaient donc faites **sans CSS**, et `scrollWidth == clientWidth` y était vrai trivialement. La feuille du projet est désormais générée par `@tailwindcss/postcss` depuis `app/globals.css` avec sources explicites. Banc contrôlé : retirer `min-w-0` + `truncate` sur une ligne fait passer `scrollWidth` à 404 et **désigne le coupable**.

---

## 10. Ordre de rollout

```
1. appliquer 20260914090000_c0_1_verrou_repas_consomme.sql     (base seule)
2. déployer le runtime C0                                       (les deux boutons)
```

**Pourquoi la base d'abord.** La migration est **purement restrictive sur un chemin que le runtime déployé n'emprunte pas** : aucun code en ligne n'appelle `enregistrer_repas_planifie` seule aujourd'hui — C0 l'introduit, et C0 n'est pas déployé. Elle peut donc s'appliquer sans fenêtre de casse. L'inverse fonctionnerait aussi, mais laisserait le trou ouvert le temps du déploiement.

Elle est **postérieure au CONTRACT** (`20260913090000`), et c'est sans danger : elle ne lit ni n'écrit `preferred_unit` — `CONTRACT-07` l'exige désormais explicitement.

---

## 11. Fichiers

**Nouveaux (3)**
`supabase/migrations/20260914090000_c0_1_verrou_repas_consomme.sql` ·
`supabase/tests/courses_c0_validation_checklist.sql` ·
`scripts/tests/courses-c0-validation.mts`

**Modifiés (13)**
`lib/supabase/consumed-meals.ts` *(`validerChoixRepas`, `lireCompositionsValidees`)* ·
`lib/nutrition/meal-choice-selection.ts` *(`selectionDepuisComposition`, `compositionIdentique`)* ·
`hooks/useConsumedMeals.ts` · `components/student/StudentMealChoices.tsx` ·
`components/student/StudentPrescribedWeek.tsx` · `app/(student)/nutrition/[planId]/page.tsx` ·
`supabase/baseline/manifest.json` · `scripts/tests/nutrition-contract-preferred-unit.mts` ·
`scripts/tests/nutrition-n1-4-choix-eleve.mts` · `scripts/tests/nutrition-n1-5-quantites.mts` ·
`scripts/tests/aliments-a5-coach.mts` · `scripts/tests/aliments-a5-history.mts` ·
+ 11 suites dont les compteurs de migrations passent à 80 / 53 · `package.json`

⚠️ **`package.json`** : **une seule ligne** à ajouter au transfert — `test:courses-c0`. Le `package.json` du conteneur porte encore les deux entrées `courses-c1` de l'ancienne dérive : **il ne doit jamais être copié**.

---

## 12. Rouges hors périmètre — identiques à avant le lot

**9 suites sur 105.** Les 8 habituelles (entraînement, webhook, vidéo) et `test:courses-c1` — l'ancienne suite abandonnée, qui n'existe que dans ce conteneur et qui était **déjà rouge avant C0** : elle asserte 76 migrations, il y en a 80. Aucun test n'a été modifié pour obtenir du vert.

---

## 13. Ce qui reste ouvert

- **La liste de courses elle-même** (C1) n'existe pas encore : C0/C0.1 préparent la source. `C0-28` vérifie qu'aucune table `shopping`/`grocery` n'a été créée en avance.
- **Rien n'est transféré.** Le lot vit dans le conteneur, prêt à partir.
