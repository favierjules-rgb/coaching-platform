# COURSES C1.1 — UX RAPIDE / PERSONNALISÉ

**Périmètre** : C1.1 seule. Aucune migration, aucun `db push`, aucun commit, aucun push, aucun transfert Mac.
Base : `ab175d5` (C1). Le moteur Courses, le schéma et le contrat N1/C0 sont **inchangés**.

> **Révision 2 — après audit adverse.** Trois défauts trouvés puis corrigés :
> **D-1** l'écran de proposition confondait « lecture ratée » et « rien à valider » ·
> **D-2** le bouton disait « Valider mes choix » alors qu'il ne faisait qu'appliquer un brouillon ·
> **D-3** un repas dont le coach avait retiré une option disparaissait en silence de la semaine proposée.
> Sept tests obligatoires ajoutés (`UX-ERR-01`, `UX-DRAFT-01`, `UX-RECOMP-01→05`), huit contrôles négatifs dédiés — voir §13.

---

## 3. AUDIT DE LA CLASSIFICATION ALIMENTAIRE — **STOP, ET C'EST LE POINT LE PLUS IMPORTANT**

§6 demandait d'auditer avant d'écrire une ligne. Voici ce que porte réellement le modèle.

| Piste cherchée | Ce qui existe | Verdict |
|---|---|---|
| **Ciqual** | `food_catalog.source = 'ciqual'` sur **3 330 / 3 330** lignes, `source_ref` = le **code `alim_code`** (`10000` = « Bigorneau, cuit »), `source_version` | ❌ le **code** est là, **la table des groupes ne l'est pas**. Déduire le groupe des deux premiers chiffres reviendrait à coder en dur un référentiel externe absent de la base |
| **`food_catalog`** | `id, owner_coach_id, name, slug, nutrition_unit, protein/carb/fat_per_100, piece_weight_g, status, source, source_ref, source_version, preferred_quantity` | ❌ **aucune** colonne de catégorie, groupe, tag ou rayon |
| **`food_products`** | `gtin, brand, product_name, net_quantity/unit, macros, image_url, ingredients_text, allergens_declared, food_id, match_*, source*, source_payload` | ❌ pas de catégorie. `allergens_declared` est déclaratif (« aucune interprétation », commentaire de colonne), et n'existe **que** pour les produits |
| **Données OFF structurées** | `OFF_FIELDS` (`lib/open-food-facts/contrat.ts:60`) demande 13 champs | ❌ **`categories_tags` n'est pas demandé** ; `source_payload` (25 lignes sur 80) ne porte que les 15 clés du contrat |
| **Tags / catégories existants** | `nutrition_recipe_tags (kind, value)` à vocabulaire contrôlé | ❌ il étiquette des **RECETTES**. Aucune table équivalente pour les aliments |
| **Toute table `food_categor*` / `food_group*`** | — | ❌ **aucune** dans les 80 migrations |

> **VERDICT : aucune classification fiable n'existe. STOP sur la catégorisation automatique.**

**Ce que j'ai donc fait — §7 à la lettre.** Pas de sections « VIANDES / FÉCULENTS / LÉGUMES ». Une question courte :

> **« Qu'est-ce que tu préfères cette semaine ? »**

avec une petite sélection (**12 max**) d'options **réellement présentes dans la période**, triée : favoris d'abord, puis récurrence décroissante dans les snapshots, puis nom. **Préférences positives seulement** — aucune exclusion, aucune allergie, aucun « je ne veux jamais ».

`if (name.includes("poulet")) → viande` n'existe nulle part, et **UX-14 le mesure** : aucun `displayName.includes/match/startsWith/test` dans les cinq fichiers C1.1, et aucun des mots `viande / féculent / légume / laitier / sauce / fruit` en littéral. Le sabotage qui ajoute une telle fonction rougit.

### Modèle minimal proposé — NON implémenté

```sql
create table public.food_catalog_tags (
  catalog_food_id uuid not null references public.food_catalog (id) on delete cascade,
  kind  text not null check (kind in ('groupe','sous_groupe')),
  value text not null,                    -- vocabulaire CONTRÔLÉ, comme nutrition_recipe_tags
  primary key (catalog_food_id, kind, value)
);
```

Trois questions à trancher avant d'écrire ce SQL :
1. **Qui remplit la table sur 3 330 aliments ?** L'import Ciqual pourrait la peupler — mais il faudrait importer `alim_grp_nom_fr`, qui n'a jamais été récupéré. Sans réponse, la table reste vide et les sections seraient vides.
2. **Les produits commerciaux** : dériver la catégorie de `food_products.food_id` (l'aliment apparié) quand `match_status <> 'unmatched'` — ou demander `categories_tags` à OFF, ce qui change le contrat et le cache.
3. **Un aliment sans catégorie** tombe-t-il dans « AUTRES » ou disparaît-il de l'écran ? Le premier est honnête, le second cache des options autorisées.

---

## 1. ARCHITECTURE UX

```
DURÉE (1..7, aucun défaut)
   ↓
MODE  « COMMENT VEUX-TU PRÉPARER TA SEMAINE ? »   ModeCourses = "rapide" | "personnalise" | null
   ├── RAPIDE ────→ PRÉFÉRENCES COURTES ──→ TA SEMAINE PROPOSÉE ──┐
   └── PERSONNALISÉ ───────────────────────────────────────────────┤
                                                                   ↓
                                                    REPAS (groupés par JOUR)
                                                                   ↓
                                                      MA LISTE DE COURSE
```

**Les deux chemins convergent** — `EcranRepasParJour` et `EcranListe` sont montés **une seule fois** chacun, et **ne reçoivent pas le mode** (UX-20 le vérifie sur le corps de la fonction). Deux écrans finaux auraient voulu dire deux vérités possibles pour la même semaine.

**Extensible** : l'écran de mode boucle sur `MODES_COURSES`. Ajouter « COMME LA SEMAINE PASSÉE » demandera **une entrée de table + un membre d'union**, pas une réécriture d'écran.

### Le défaut corrigé — la liste plate

Avant (C1) : 21 lignes « Lundi · 2026-08-17 », trois repas du même jour indiscernables.
Après (C1.1) :

```
LUNDI            17 août                    1/3 prêts
  Petit déjeuner        2 / 2 choix    PRÊT
  Mon petit déj perso
  Collation du matin    0 / 1 choix    À COMPOSER
  Dîner                 0 / 1 choix    À COMPOSER

MARDI            18 août                    0/1 prêts
  Déjeuner              0 / 1 choix    À COMPOSER
```

- **créneau en français** — `MEAL_SLOT_LABELS_FR`, la table du modèle nutrition. Aucun mapping parallèle (UX-05).
- **ordre canonique** — `MEAL_SLOT_DEFAULT_ORDER`. Le double de test déclare volontairement dîner → petit-déjeuner → collation ; l'écran rétablit breakfast → morning_snack → dinner (UX-06).
- **nom du coach seulement s'il apporte** — « Mon petit déj perso » s'affiche, « Collation du matin » et « Dîner » non (comparaison insensible casse/accents entre **deux libellés d'affichage**, jamais entre un nom d'aliment et une catégorie).
- **aucun repas artificiel** — mardi n'a qu'un déjeuner au plan, il n'y a qu'une carte (UX-07).
- **trois statuts** : `PRÊT` · `À COMPOSER` · `À RECOMPOSER`.

---

## 2. FICHIERS

### Créés — 5

| Fichier | Rôle |
|---|---|
| `lib/nutrition/mode-courses.ts` | `ModeCourses`, `MODES_COURSES`, `estModeCourses`. Aucun défaut |
| `lib/nutrition/repas-par-jour.ts` | groupement par jour, carte repas, progression, `À RECOMPOSER` |
| `lib/nutrition/proposition-rapide.ts` | **moteur pur** : priorité, déterminisme, options proposables, `itemsAValider` |
| `scripts/tests/liste-de-courses-ux.mts` | suite C1.1 (26 tests) |
| `docs/liste-de-courses-c11-livrable.md` | ce document |

### Modifiés — 5

| Fichier | Modification |
|---|---|
| `components/student/ListeDeCoursesParcours.tsx` | six étapes, écran de mode, préférences courtes, semaine proposée, repas par jour |
| `components/student/StudentMealChoices.tsx` | **une prop optionnelle** `propositionInitiale`, défaut `null` |
| `hooks/useListeDeCourses.ts` | `validerSemaine` + `ResultatValidationSemaine` / `EchecDeRepas` |
| `scripts/tests/liste-de-courses-c1.mts` | **3 assertions adaptées** (voir §10) |
| `package.json` | une ligne : `test:liste-de-courses-ux` |

**Non touchés** : schéma, migrations (80, dernière = C0.1), RPC N1/C0, solveur, `planned_meals`, `planned_meal_items`, A5, recettes, scanner.

---

## 4. STRATÉGIE DES PRÉFÉRENCES

**Le défaut corrigé** : C1 demandait de marquer chaque aliment en favori, un par un, dans une liste entière. Supprimé.

**`food_favorites` reste, et devient un signal AUTOMATIQUE** :

```
favori existant  → remonte la priorité d'une option DÉJÀ autorisée
non favori       → reste parfaitement disponible
favori           → JAMAIS obligatoire
```

Les favoris sont **lus** (`useRaccourcisAliments`, hook A5 existant, clé `cleAlimentRapide`) dès que le mode est choisi ; l'élève n'a rien à cocher. Sur l'écran de préférences, l'étoile **dit** « tu l'as déjà en favori » — elle ne se clique pas.

Ce que l'élève choisit, ce sont des **préférences de la semaine** : une poignée de cases, sur des options réellement présentes. UX-11 vérifie qu'un favori ne filtre rien (les trois options de l'occurrence existent toujours) ; UX-15 qu'aucune option ne peut entrer hors snapshot.

---

## 5. MOTEUR DE PROPOSITION

`lib/nutrition/proposition-rapide.ts` — **fonction pure**, module feuille.

```
choisirPourOccurrence(occurrence, preferences, favoris)
  1. PRÉFÉRENCE explicite, si cette identité est autorisée DANS CETTE occurrence
  2. FAVORI existant,      si cette identité est autorisée DANS CETTE occurrence
  3. PREMIÈRE option utilisable, dans l'ORDRE DU COACH
```

| Garantie | Comment elle tient |
|---|---|
| **rien hors snapshot** | la signature ne reçoit ni catalogue, ni client Supabase, ni `food_lists`. Aucun `fetch`, aucun `supabase`. C'est **matériellement** impossible |
| **déterminisme** | aucun `Math.random`, aucun `new Date()`, aucun `Date.now()`, aucun `crypto.getRandomValues` dans les 5 fichiers C1.1 (UX-13). 10 appels → 1 seul résultat (UX-12) |
| **ordre du coach préservé** | le repli parcourt `occurrence.options` tel quel ; aucun `.sort()` sur les options |
| **départage** | à deux préférences autorisées dans la même occurrence, c'est **l'ordre du coach** qui tranche, pas l'ordre où l'élève a coché |
| **« utilisable »** | `optionExploitable` **et** `optionCalculable`. Une option sans macros produirait un repas que `calculDuRepas` rendrait « non-calculable » — donc invalidable sans que l'élève sache pourquoi |
| **repas déjà prêts** | **jamais réécrits** — ce serait effacer le travail de l'élève |
| **repas déjà consommés** | écartés en amont (le verrou C0.1 les refuserait de toute façon) |

**Aucune quantité n'est calculée ici.** Le moteur rend des `optionId`. Les grammes viennent de `calculDuRepas` → solveur N1.5 → `itemsAValider`, qui recopie **`displayQuantity`** (l'entier affiché), jamais `quantity` (le flottant interne). UX-16 le mesure sur le code **et** sur le comportement.

---

## 6. CONVERGENCE RAPIDE / PERSONNALISÉ

| | Rapide | Personnalisé |
|---|---|---|
| avant les repas | préférences courtes → semaine proposée | — |
| composition | `StudentMealChoices` **pré-rempli** (`propositionInitiale`) | `StudentMealChoices` vide |
| écriture | `VALIDER MA SEMAINE` (n repas) | `Valider mes choix` (1 repas) |
| **après** | **`EcranRepasParJour` → `EcranListe`** | **les mêmes** |

**Un seul `<StudentMealChoices>` dans tout le parcours** (UX-08). Aucun second sélecteur d'aliments, aucun second solveur.

**`propositionInitiale` ne ment pas** : `dejaValide` et `aJour` restent gouvernés par la **seule** `compositionValidee`. Le bouton affiche donc « Valider mes choix », jamais « Choix validés », tant que rien n'est en base. Et la composition validée **l'emporte toujours** sur une proposition.

---

## 7. VALIDATION PAR C0

Le seul chemin d'écriture reste **`validerChoixRepas` → `enregistrer_repas_planifie`** (RPC de N1.1). Aucune écriture directe de `planned_meals` / `planned_meal_items`, **aucune RPC nouvelle**, aucune migration (UX-18, UX-21).

### ⚠️ IL N'Y A PAS DE TRANSACTION ENTRE REPAS — et je ne fais pas semblant

C'est le point que §11 demandait de signaler explicitement.

`enregistrer_repas_planifie` est atomique **pour un repas**. Valider 21 repas, ce sont **21 allers-retours indépendants**. Si le douzième échoue, **les onze premiers restent écrits en base**. Il n'existe aucun moyen d'annuler côté client sans inventer une fausse atomicité — qui échouerait à son tour au premier réseau coupé, en laissant un état pire.

**Je n'ai donc rien inventé.** Le comportement est : tenter les 21, **n'en abandonner aucun**, puis rapporter exactement ce qui s'est passé.

Regrouper les 21 repas dans une seule RPC transactionnelle est possible — c'est une **migration**, donc hors périmètre C1.1. Porté au reste à faire.

---

## 8. ERREURS PARTIELLES

```
12 repas validés · 1 repas à corriger
  MERCREDI 19 août · Collation de l'après-midi — Ce repas a déjà été enregistré
  comme consommé : sa composition ne peut plus être modifiée.
```

| Règle | Mise en œuvre |
|---|---|
| jamais de faux succès | `complet: echecs.length === 0 && entrees.length > 0` — un sabotage à `complet: true` rougit |
| aucun repas « non exécuté » | la boucle **capture** et **continue** : ni `break`, ni `return` (vérifié sur le corps de la boucle). L'élève sait en **une** fois tout ce qui reste |
| les repas en échec sont **nommés** | `libelle` = « JOUR date · Créneau » ; sans lui, « 1 repas à corriger » est inexploitable |
| annoncé aux lecteurs d'écran | `role="alert"` sur l'échec partiel, `role="status"` sur le succès |
| reprise possible | l'écran reste ouvert, la liste des repas est rechargée, chaque repas en échec est ré-ouvrable |
| **plan modifié par le coach** | la RPC reste le rempart (clés étrangères composites). Côté UI, la carte passe **`À RECOMPOSER`** et `choisis` retombe à 0 — **aucune substitution silencieuse** (UX-SUP) |

---

## 9. RESPONSIVE

Banc `/root/banc-c1` — vrais composants en SSR, vrai CSS Tailwind recompilé, Chromium réel, `deviceScaleFactor: 2`.
Conditions dures : 7 jours × 3 repas = **21 repas**, noms Ciqual complets, marque à rallonge, quantités à 4 chiffres, 3 unités.

| Écran | 375 | 390 | 430 | 768 | 1024 | 1440 | cible min |
|---|---|---|---|---|---|---|---|
| 01 durée | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px |
| 02 **mode** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 46 px |
| 03 **préférences** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px |
| 04 **semaine proposée** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px |
| 05 **repas par jour** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 46 px |
| 06 liste | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px |
| 07 **StudentMealChoices ouvert** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 44 px |

**42 mesures, 0 débordement** (`scrollWidth == clientWidth`, 0 élément dépassant), libellés attendus présents à 375 px sur les sept écrans.

**Banc falsifié** : remplacer `truncate` par `whitespace-nowrap` sur les libellés → **4 mesures rouges**. Restauration vérifiée par md5 (8/8).

---

## 10. TESTS

`npm run test:liste-de-courses-ux` → **33 réussis, 0 échec.**

| Test | Ce qu'il mesure |
|---|---|
| **UX-01** | `useState<ModeCourses>(null)` ; aucune constante de défaut ; **rendu réel** : 2 radios, 0 coché — + contre-épreuve (avec un mode, exactement 1 coché) |
| **UX-02** | question + les deux titres + les deux promesses ; rendus **en boucle** sur `MODES_COURSES` |
| **UX-03** | attribut `disabled=""` avec `null`, absent sinon ; libellé « Choisis un mode » |
| **UX-04** | 2 groupes, dates réelles, libellés `LUNDI`/`17 août`, aucune carte dans le mauvais jour ; la date brute a quitté les cartes |
| **UX-05** | 3 créneaux en français dans l'ordre ; libellé = `MEAL_SLOT_LABELS_FR` ; nom du coach affiché/masqué ; progression `0/2`, `0/1`, `0/1` |
| **UX-06** | double déclaré en désordre → ordre canonique rétabli ; aucun ordre recopié |
| **UX-07** | mardi = 1 carte ; `total` = nombre de repas réels ; aucune journée type fabriquée |
| **UX-08** | **un seul** `<StudentMealChoices>` ; 4 props ; aucun composant `ListeDeCourses*Choix/Selecteur/Picker` ; aucun solveur dans le parcours |
| **UX-09** | aucun `supabase` / `food_lists` / `food_catalog` / `fetch` dans le moteur ; chaque `optionId` proposé appartient à son occurrence |
| **UX-10** | sans préférence → Riz ; avec → Saumon (3ᵉ option) ; préférence non autorisée ici → ignorée ; préférence > favori |
| **UX-11** | favori → Poulet ; favori absent → repli ; les 3 options existent toujours |
| **UX-12** | 10 appels → 1 résultat ; première option du coach ; aucun `.sort()` sur les options |
| **UX-13** | `Math.random`, `new Date()`, `Date.now()`, `crypto.getRandomValues` absents des 5 fichiers |
| **UX-14** | aucun `displayName.includes/match/...` ; 8 mots de catégorie interdits en littéral |
| **UX-15** | toutes les options proposables ⊂ snapshot ; `[]` sans repas ; option non calculable écartée ; un favori remonte **sans ajouter de ligne** |
| **UX-16** | la proposition ne rend que des chaînes ; aucun solveur ni macro dans le moteur ; `displayQuantity` et jamais `quantity` ; `itemsAValider(162.7 → 163)` |
| **UX-17** | moteur sans écriture ; un seul déclencheur ; proposition **dérivée** (`useMemo`, aucun `setProposition`) ; `dejaValide` vient de la base seule |
| **UX-18** | 2 appels à `validerChoixRepas` ; aucune écriture directe ; aucune RPC nouvelle ; 80 migrations |
| **UX-19** | `complet` strict ; boucle sans `break`/`return` ; repas nommés ; `role="alert"` ; aucun `rollback` client inventé |
| **UX-20** | un `<EcranRepasParJour>`, un `<EcranListe>` ; les deux chemins ; `lignes={courses.lignes}` ; l'écran final **ignore le mode** |
| **UX-21** | 80 migrations ; 3 noms de tables absents |
| **UX-22** | 5 chemins d'import + 5 mots de l'ancien vocabulaire |
| **UX-23** | 6 amorces absentes ; 2 modes exactement ; doc « NON IMPLÉMENTÉ » |
| **UX-24** | 9 mots (budget, prix, magasin, geoloc, promotion…) absents ; aucun `fetch` |
| **UX-SUP** | option retirée du snapshot → `À RECOMPOSER`, `choisis = 0`, **aucune substitution** ; un repas prêt n'est pas réécrit |
| **UX-RESP** | invariants de largeur + libellés |

### Suites rejouées

| Suite | Résultat |
|---|---|
| `liste-de-courses-c1` | **35 / 35** |
| `courses-c0-validation` | **16 / 16** |
| `nutrition-n1-6` / `n1-5` / `n1-4` | **14 / 14**, **112 / 112**, **16 / 16** |
| `nutrition-contract-preferred-unit` | **6 / 6** |
| `nutrition-v2-unified` | **74 / 74** |
| `aliments-a5-coach` / `-history` | **11 / 11**, **26 / 26** |
| `tsc --noEmit` · `eslint` | **0** · **0** |

### Les 3 assertions C1 adaptées — et pourquoi

C1.1 change l'UX que C1 mesurait. Trois assertions décrivaient l'ancien écran ; **l'intention de chacune est conservée**, seul le littéral change :

| Assertion | Avant | Après | Intention |
|---|---|---|---|
| C1-09/10 | `"À composer"` | `"À COMPOSER"` **+ `"PRÊT"`** | l'état est ÉCRIT, pas seulement coloré — **renforcée** |
| C1-24 | `aria-pressed={favori}` | `aria-pressed={choisie}` + comptes exacts (2 `aria-pressed`, 1 `aria-expanded`, 2 radios) | toute bascule dit son état — **renforcée** |
| C1-FUTUR | union à 4 étapes | union à 6 étapes + `MODES_COURSES` à 2 entrées | aucune étape/mode « semaine passée » — **renforcée** |

Aucune n'a été affaiblie ; chacune reste falsifiable, et les sabotages correspondants rougissent.

---

## 11. CONTRÔLES NÉGATIFS

18 sabotages, appliqués **un par un**, **les deux suites** relancées, fichier restauré et **md5 revérifié**. Script : `/root/banc-c11/sabotages.py`.

| Sabotage | Verdict | Test qui rougit |
|---|---|---|
| un mode par défaut (`"rapide"`) | **ROUGE** | UX-01 |
| avancer sans mode (`desactive={false}`) | **ROUGE** | UX-03 |
| retour à une liste plate | **ROUGE** | UX-04 + UX-07 |
| mapping de créneaux recopié à la main | **ROUGE** | UX-05 + UX-07 |
| ordre canonique abandonné | **ROUGE** | UX-05 + UX-06 |
| repas artificiels ajoutés | **ROUGE** | UX-04 + UX-05 |
| la préférence ne gagne plus | **ROUGE** | UX-10 |
| repli aléatoire (`Math.random`) | **ROUGE** | UX-10 + UX-12 |
| ordre du snapshot réordonné | **ROUGE** | UX-10 + UX-12 |
| heuristique sur le nom d'aliment | **ROUGE** | UX-14 |
| second calcul de quantité (`item.quantity`) | **ROUGE** | UX-16 |
| proposition rangée dans un état | **ROUGE** | UX-17 |
| la boucle s'arrête au premier échec | **ROUGE** | UX-19 |
| faux succès global (`complet: true`) | **ROUGE** | UX-19 |
| les deux modes divergent | **ROUGE** | UX-20 |
| le mode semaine passée commence | **ROUGE** | UX-23 |
| le budget commence | **ROUGE** | UX-24 |
| aliment retiré remplacé en silence | **ROUGE** | UX-SUP |

**18 / 18 rouges, 18 / 18 restaurations md5-identiques.** Plus les 21 contrôles négatifs de C1, toujours rouges.

---

## 12. POINTS LAISSÉS

### Semaine passée (§15)
Documenté dans `docs/courses-reprendre-semaine-passee.md`, **rien d'implémenté** (UX-23). L'extension est prête à recevoir : `MODES_COURSES` + un membre d'union. Le lecteur `lireRepasPlanifiesSurPeriode` sert déjà tel quel — il ne connaît que deux dates.
Reste à écrire : la projection, la garde « snapshot actuel », l'écran. **Quatre décisions ouvertes** dans le document.

### C2 — persistance
`shopping_lists` / `shopping_list_items` / `shopping_list_state` : rien. Le cochage de la liste reste **local** et le dit à l'écran.
**À y ajouter** : la **RPC transactionnelle de semaine** (§7). C'est la seule façon honnête de rendre « VALIDER MA SEMAINE » atomique, et c'est une migration.

### C3 — budget
Aucun code (UX-24). Prévu : budget utilisateur, estimation du panier, reste/dépassement, prix normalisés €/kg, €/L, €/pièce.
**Bloqueur connu** : aucune donnée de prix n'existe dans le modèle, et `planned_meal_items.unit` accepte `piece` sans poids unitaire fiable (`food_catalog.piece_weight_g` est nullable).

### C4 — magasins
Prévu : localisation, magasins proches, prix, ~~disponibilité~~, promotions, comparaison prix/distance/complétude.

> **Correction du 17/08/2026 — « disponibilité » est RETIRÉE du périmètre C4.**
> Open Prices fournit des **observations de prix datées** — un fait au passé, « le 09/08, quelqu'un
> a relevé cette étiquette ici » — et **pas un stock ni une disponibilité commerciale au présent**.
> Vérifié sur les quatre modèles du backend (Location 23 champs, Price 28, Proof 26, Product 26) et
> sur son `API.md` : zéro occurrence de `stock`, `availability`, `available`, `in_stock`,
> `out_of_stock`, `inventory`. Le seul champ qui pourrait tromper, `Price.receipt_quantity`, est une
> quantité **achetée** sur un ticket de caisse, jamais une quantité en rayon.
>
> ⚠️ **Aucune implémentation de remplacement.** En particulier, on ne dérive PAS une pseudo-
> disponibilité de la présence d'un prix récent : ce serait inventer une donnée et l'afficher avec
> l'aplomb d'un fait. 10,9 % seulement des relevés ont moins de trois mois — la fraîcheur d'un prix
> ne dit rien de la présence en rayon.

**État au 17/08/2026** — C4.1 (pont aliment → produit réel) est livré. C4.2 (modèle magasin +
magasin choisi) introduit `stores` et `student_selected_store` : aucun appel API, aucune
géolocalisation, aucun prix. La découverte des magasins proches — `GET /api/v1/locations/nearby`,
disponible en amont depuis le 15/05/2026 — est le sujet de C4.3a.

### Dette technique reconnue
1. **`resoudreIdentites` en double** — l'écran du plan et `identitesDeChoix`. Non unifié parce que `courses-c0-validation.mts:140-142` lit le code littéral de la page.
2. **`itemsAValider` en double** — même raison. Les deux à unifier **avec** la mise à jour du test, dans le même lot.
3. **Repas sans occurrence** — toujours écartés du parcours.
4. **Ancien C1** — toujours dans le conteneur, ses deux suites toujours rouges (voir livrable C1 §0).

---

## 13. LES TROIS CORRECTIFS DE L'AUDIT ADVERSE

### D-1 — une lecture ratée n'est plus un état vide

`EcranProposition` reçoit désormais `ok`. L'ordre est le même que sur l'écran des repas : **erreur d'abord**, vide ensuite.

```
ok = false            → « Impossible de lire tes repas prévus… »  (role="alert")
ok = true, 0 repas    → « Aucun repas à valider sur cette période. »
```

⚠️ **Un seul système d'erreur** : le message est extrait dans `LectureImpossible()`, utilisé par les **deux** écrans. Le test compte les occurrences — un second texte le rougit.

### D-2 — le libellé ne promet que ce qui arrive

Nouveau contrat **explicite** sur `StudentMealChoices` :

```ts
export type ModeDeValidation = "validation" | "brouillon";
```

| Contexte | Mode | Libellé |
|---|---|---|
| parcours nutrition C0 | `"validation"` (**défaut**) | « Valider mes choix » / « Mettre à jour mes choix » |
| semaine proposée (Rapide) | `"brouillon"` | **« Appliquer mes choix »** |

⚠️ **Déclaré, jamais reniflé** : `mode: onRetoucher ? "brouillon" : "validation"`. Aucune inspection du callback.
⚠️ **C0 est inchangé au caractère près** : sans `mode`, le rendu est **strictement identique** — le test compare les deux chaînes.

### D-3 — trois états distincts, et aucune substitution

La validité est remontée dans le **modèle** (`repasDeLaPeriode`), plus recalculée dans la carte : il n'y avait pas d'écart possible entre l'écran et le moteur, c'est justement l'écart qui faisait disparaître le repas.

| État | `pret` | `aRecomposer` | `consomme` | Dans la proposition ? |
|---|---|---|---|---|
| prêt et encore valide | ✅ | — | — | non (on n'écrase pas son travail) |
| consommé | ✅ | — | ✅ | non (verrou C0.1) |
| **à recomposer** | — | ✅ | — | **oui, avec `complet: false` et AUCUN choix** |
| à composer | — | — | — | oui |

`proposerSemaine` ne saute plus sur `pret` seul. Un repas à recomposer **entre** dans la proposition pour être **compté** et **ouvrable** — mais avec `selection: {}`. Le remplir d'office serait une substitution.
L'écran de proposition l'affiche : « X repas sont à recomposer… **aucun aliment n'a été remplacé à ta place** ».

### Tests et contrôles négatifs

| Test | Ce qu'il mesure |
|---|---|
| **UX-ERR-01** | `ok=false` + 0 repas → erreur ; `ok=true` + 0 repas → vide ; message unique, factorisé, utilisé 2 fois |
| **UX-DRAFT-01** | C0 → « Valider mes choix » ; défaut ≡ C0 (**rendus identiques**) ; brouillon → « Appliquer mes choix » et aucune promesse ; mode déclaré ; l'écran de proposition n'appelle ni `validerChoixRepas`, ni RPC, ni `supabase` |
| **UX-RECOMP-01** | composition encore valide → PRÊT, `aRecomposer` faux, non re-proposé |
| **UX-RECOMP-02** | composition interdite → À RECOMPOSER, `pret` faux, `choisis = 0` |
| **UX-RECOMP-03** | « 1 repas est à recomposer » sur **les deux** écrans + statut sur la carte |
| **UX-RECOMP-04** | `prets = 0`, `aRecomposer = 1`, proposition `complet: false`, `selection` vide, 0 repas validable |
| **UX-RECOMP-05** | avec préférence **et** favori autorisés : toujours aucun choix fabriqué ; composition d'origine intacte ; repas ouvrable |

**8 contrôles négatifs dédiés, tous rouges** : erreur redevenue vide · second message d'erreur · brouillon promettant une validation · mode deviné · « composition existante » suffisant · repas à recomposer redevenu silencieux · substitution automatique · récapitulatif muet.
**Total : 26 sabotages, 26 rouges, 26 restaurations md5-identiques.**

---

Aucune migration (80, dernière = `20260914090000_c0_1_verrou_repas_consomme.sql`).
Aucun `db push`, commit, push ni transfert Mac.
