# ALIMENTS A5.7 — HISTORIQUE ALIMENTAIRE HEBDOMADAIRE — LIVRABLE

**Livré, non commité. Aucun `db push`. Aucun merge. Aucune purge. Aucun Courses.**
Branche `feat/aliments-a5-food-experience`, arbre de travail seul.
Base locale reconstruite de zéro (baseline + **72** fichiers de migration,
**45** post-baseline — le même compte qu'à la fin d'A5), les 3 330 aliments
Ciqual intacts.

---

## 1. Architecture de l'historique

L'historique est **dérivé**. Il n'a ni table, ni cache, ni agrégat persisté, ni
copie de `meal_entries`.

```
consumed_meals ─┐
                ├─► readConsumedMeals(supabase, [7 dates])   (déjà existant, A2)
meal_entries ───┘            │
                             ▼
              lib/nutrition/historique.ts   ← NOUVEAU, module FEUILLE
              (ni React, ni Supabase, ni réseau)
                 │
                 ├── semaineContenant / decalerSemaine / libelleSemaine
                 ├── resumeDuJour / resumeSemaine
                 └── identiteDeLEntree / agregerConsommation   ← contrat Courses
                             │
        ┌────────────────────┴─────────────────────┐
        ▼                                          ▼
 NutritionWeekNav (NOUVEAU)              NutritionDayCarousel (A5.6, inchangé)
 flèches ‹ › + titre + résumé semaine    glissement horizontal des 7 jours
```

**Fichiers touchés**

| fichier | état | rôle |
|---|---|---|
| `lib/nutrition/historique.ts` | **nouveau** | toute l'arithmétique — semaines, résumés, agrégat |
| `components/student/NutritionWeekNav.tsx` | **nouveau** | les deux flèches, le titre, le résumé de semaine |
| `scripts/tests/aliments-a5-history.mts` | **nouveau** | HIST1..HIST25 |
| `supabase/tests/aliments_a5_7_historique_checklist.sql` | **nouveau** | ce qui ne se prouve qu'en base |
| `lib/nutrition/consumed.ts` | modifié | `ConsumedEntry.productId` |
| `lib/supabase/consumed-meals.ts` | modifié | `product_id` dans le `select` et dans `mapEntry` |
| `components/student/StudentPrescribedWeek.tsx` | modifié | branche la barre de semaine au-dessus du carrousel |
| `app/(student)/nutrition/[planId]/page.tsx` | modifié | la semaine devient un **état**, la lecture le suit |
| `scripts/tests/aliments-a2.mts` | modifié | `productId: null` dans une fixture |
| `package.json` | modifié | `test:aliments-a5-history` |

**Ce qui n'existe pas, et c'est délibéré** : aucune table `*_history`, aucune vue
matérialisée, aucun agrégat semaine/mois stocké. Une copie mentirait dès la
première correction d'une entrée — et les mesures du §3 montrent qu'elle
n'apporterait rien.

---

## 2. Migration : **NON**

Aucune migration n'accompagne A5.7. C'était la conclusion de l'audit, et elle
est vérifiée par comptage, pas par déclaration :

- `supabase/migrations/` compte **72 fichiers**, dont **45** post-baseline —
  identique à la fin d'A5. Aucun fichier postérieur à `20260905090100`.
- `supabase/baseline/manifest.json` déclare les mêmes 45. Les deux compteurs
  s'accordent (`HIST-SUP`).

**Le seul manque trouvé était dans la LECTURE, pas dans le schéma.**
`ConsumedEntry` et le `select` de `readConsumedMeals` ne remontaient pas
`meal_entries.product_id`. Sans lui, l'agrégateur Courses ne pourrait pas
distinguer deux produits et retomberait sur leur **libellé** — exactement la
fusion par le nom que le contrat interdit. La colonne existe depuis la phase 3
d'A3 : c'est un correctif de code, pas une migration. Vérifié en base :

```
OK — SUP · meal_entries.product_id existe depuis A3 — aucune migration A5.7
```

Les policies et privilèges d'A1/A2 suffisent tels quels : l'écran d'historique
ne fait que **lire** ce que l'élève avait déjà le droit de lire.

---

## 3. Stockage — **mesuré**, pas estimé

Banc réel sur la base reconstruite : 20 élèves × 90 jours × 4 repas × 3 aliments
= **7 200 repas / 21 600 entrées**, après `analyze`, **index compris**.

| table | lignes | taille totale | par ligne |
|---|---:|---:|---:|
| `meal_entries` | 21 600 | 5 704 Kio | **270,4 o** |
| `consumed_meals` | 7 200 | 2 056 Kio | **292,4 o** |

**Coût par élève et par jour**

| profil de saisie | par élève / jour |
|---|---:|
| dense — 4 repas × 3 aliments = 12 entrées | **4 414 o** (≈ 4,3 Kio) |
| modéré — 3 repas × 2 aliments = 6 entrées | **2 500 o** (≈ 2,4 Kio) |

**Projections**

| | dense | modéré |
|---|---:|---:|
| 100 élèves × 12 semaines | **35,4 Mio** | 20,0 Mio |
| 500 élèves × 12 semaines | **176,8 Mio** | 100,1 Mio |
| 100 élèves × 1 an | 153,2 Mio | 86,8 Mio |
| 500 élèves × 1 an | 766,2 Mio | 433,9 Mio |
| 100 élèves × **5 ans** | 766,2 Mio | 433,9 Mio |
| 500 élèves × 5 ans | 3,7 Gio | 2,1 Gio |

**Honnêteté sur ce qui est mesuré** : le ratio octets/ligne est mesuré sur les
vraies tables, avec leurs vrais index. Le nombre d'entrées par élève et par jour
ne peut pas l'être — la base locale ne contient aucun journal réel. Les deux
profils encadrent donc l'usage plutôt que de le prétendre connu.

**Conséquence, conforme à la décision de rétention** : à ~100 athlètes, **cinq
ans d'historique complet tiennent dans moins de 800 Mio**, index compris. Aucune
purge, aucune limite 4 ou 12 semaines, aucun cron, aucun archivage destructif —
et rien n'a été implémenté en ce sens.

**Requêtes**, mesurées sur la base reconstruite :

- une semaine de `consumed_meals` → **Bitmap Index Scan** sur
  `consumed_meals_student_date_idx`, **0,333 ms** ;
- leurs entrées → **Nested Loop + Index Scan** sur
  `meal_entries_consumed_meal_idx`, **0,353 ms** ;
- la checklist reprend la mesure comme un contrôle : `SUP · une semaine se lit
  sans Seq Scan sur consumed_meals` — **vert**.

---

## 4. UX semaine / jour — deux niveaux, un geste par niveau

```
┌──────────────────────────────────────────┐
│  ‹      SEMAINE EN COURS                 │  ← NutritionWeekNav
│         Semaine du 10 au 16 août       › │
│  Jours suivis 5/7 · Moyenne / jour suivi │
│  2 000 kcal · P 150 · G 200 · L 67       │
├──────────────────────────────────────────┤
│  Lundi   Mardi  [Jeudi]  Vend.  …        │  ← NutritionDayCarousel (A5.6)
│              ◯  1 420 / 1 800 kcal       │     glissement horizontal
│              ▬▬▬▬▬  P  G  L              │
│              repas du jour                │
└──────────────────────────────────────────┘
```

- **Niveau 1, la semaine** : deux flèches, **extérieures** au carrousel.
- **Niveau 2, le jour** : le glissement, **réservé** au carrousel.

Deux systèmes de navigation sur le même axe rendraient l'écran imprévisible —
glisser changerait tantôt de jour, tantôt de semaine. C'est la seule raison de
ce partage.

**Par défaut** : la semaine qui contient aujourd'hui, et aujourd'hui sélectionné.
Sur une semaine passée, **aucun jour n'est marqué « Aujourd'hui »** — l'écran
retombe sur le lundi plutôt que sur un index invalide, et ne ment pas.

Le bouton « suivante » reste **toujours actif**, y compris sur la semaine en
cours : consulter une semaine à venir n'a rien d'illégitime (le coach y a
peut-être déjà prescrit), et le désactiver donnerait l'impression que
l'application s'arrête aujourd'hui.

**Chargement** : changer de semaine change les sept dates, donc la clé de
`useConsumedMeals`, donc la lecture — **deux requêtes bornées à sept jours**,
jamais l'historique entier. Conservation complète en base ≠ chargement complet
côté client.

---

## 5. Résumé de la semaine — « rien noté » n'est pas « zéro mangé »

C'est la règle qui gouverne tout le lot.

| jour | entrées | total | `aSaisie` |
|---|---:|---:|---|
| lundi — repas ouvert, rien noté | 0 | 0 kcal | **non** |
| mardi — rien du tout | 0 | 0 kcal | **non** |
| dimanche — un thé sans sucre | 1 | 0 kcal | **oui** |

Les trois totaux sont identiques ; seul le dimanche est un jour **suivi**.
`aSaisie` est un booléen **posé** (`entrées.length > 0`), jamais déduit d'un
total à zéro — c'est ce qui rend la distinction impossible à perdre lors d'un
remaniement, et un test l'exige explicitement.

- **La moyenne divise par les jours SUIVIS, jamais par sept.** Cinq jours à
  2 000 kcal donnent 2 000, pas 1 428. Diviser par sept punirait l'oubli d'une
  saisie en affichant une sous-consommation qui n'a jamais eu lieu — et
  pousserait à manger davantage pour rattraper un chiffre faux. Aucun `/ 7`
  n'existe dans le fichier.
- **Aucun jour suivi → `moyennes = null`**, et non zéro. L'écran affiche alors
  *« Aucune consommation enregistrée cette semaine. »* — et **pas** 0 kcal /
  0 P / 0 G / 0 L, qui reprocherait à l'élève quelque chose qu'il n'a pas fait.
  Le rendu est vérifié : la chaîne `0 kcal` est **absente** de ce cas.
- Le libellé dit *« Moyenne / jour suivi »*, et non *« par jour »* : la nuance
  est tout l'intérêt du chiffre.

---

## 6. Historique détaillé

Le détail d'un jour reste **exactement** l'écran d'A2/A5.6 : les repas, leurs
aliments, les quantités, les unités, les instantanés. A5.7 n'a rien réécrit —
il a seulement rendu la semaine navigable.

- L'historique est **la consommation seule**. Un repas prescrit **ouvert mais
  vide** n'apporte rien : ni total, ni jour suivi, ni ligne d'agrégat. Vérifié
  en base *et* en JavaScript.
- La sélection se fait sur `consumedOn`, **jamais** sur un index de carrousel :
  c'est ce qui garantit qu'un glissement ne déplace aucune consommation.
- Un repas **personnel** (`kind = 'student'`) compte exactement comme un repas
  prescrit. Le module ne filtre jamais sur `kind` — il n'y a donc rien à oublier
  de rebrancher.

---

## 7. Snapshots — l'histoire ne se réécrit pas

L'historique **ne consulte aucune source vivante**. Ce n'est pas une promesse de
commentaire : le module ne contient nulle part les chaînes `food_catalog`,
`food_products`, `open_food_facts`, `ciqual`, `supabase`, `fetch(`, ni aucun
`per100` — vérifié sur le source **dépouillé de sa prose**, avec un contrôle
négatif prouvant que le dépouillement fonctionne (la prose, elle, mentionne bien
`food_catalog` et `food_products`).

Les macros affichées sont celles figées dans `meal_entries` par les RPC
`security definer`. Une fiche corrigée après coup ne change rien à ce qui a été
mangé, et l'invariant `on delete set null` d'A1/A3 vaut toujours : une entrée
**survit** à la disparition de sa source. Quand le pointeur a disparu,
l'agrégateur retombe sur le libellé — l'instantané reste exact, c'est l'identité
qui a disparu, et on ne l'invente pas.

---

## 8. Isolation de l'élève — **exécutée**, pas relue

`supabase/tests/aliments_a5_7_historique_checklist.sql` — **32 contrôles, 0
échec**, sur une base reconstruite, rôles réellement endossés
(`set local role authenticated` + `request.jwt.claims`).

Le banc est **trois élèves, deux coachs**, et ce montage est le cœur de la
preuve :

- **A et B ont le MÊME coach.** Si la policy élève s'appuyait par erreur sur le
  rattachement au coach, ils se verraient l'un l'autre. Deux élèves de coachs
  différents seraient isolés **par accident**, et le contrôle passerait sans
  rien prouver.
- **C a un AUTRE coach.** Sans lui, « le coach voit son élève » serait vert même
  avec une policy qui laisse voir tout le monde.

Résultats : A ne voit **aucun** repas ni **aucune** entrée de B ou C ; B ne voit
rien de A. Deux contrôles discriminants accompagnent ces zéros — A voit bien ses
**5** entrées à lui (sans quoi une RLS qui masquerait *tout* serait verte), et le
journal de B **existe réellement en base** (vérifié hors RLS, `reset role` : la
RLS le **masque**, elle ne l'a pas supprimé).

---

## 9. Accès coach — lecture seule, et rien de plus

**Rien n'a été élargi.** Les policies d'A1/A2 suffisaient :

| | `consumed_meals` | `meal_entries` |
|---|---|---|
| élève | `select` sur `student_id = current_student_id()` | idem |
| coach | `select` sur `is_coach_of_student(student_id)` | idem |
| coach — écriture | **aucune policy** | **aucune policy** |

**Et ce n'est pas qu'une question de policy** — une policy dit quelles *lignes*,
jamais quelles *valeurs* ; c'est le **privilège** qui décide du verbe.
`revoke insert, update, delete … from authenticated` retire l'écriture à
`authenticated` **tout entier**, coach comme élève ; tout passe par des fonctions
`security definer` qui lisent l'élève dans le jeton, jamais dans un paramètre.

Mesuré : le coach ne peut **ni ajouter** une entrée, **ni corriger** une
quantité, **ni supprimer**, **ni créer un repas**, **ni déplacer un repas dans le
temps** — et il **lit toujours** (contrôle discriminant : les refus portent sur
le verbe, pas sur une session cassée). Il voit ses deux élèves, et **rien** de
l'élève de l'autre coach.

**Aucun écran coach n'est ouvert dans A5.7**, conformément à la consigne. La
couche de données est prête — `readConsumedMeals` accepte une liste de dates
arbitraire — mais l'UI coach reste un lot séparé.

---

## 10. Contrat futur Courses — préparé, pas implémenté

```ts
agregerConsommation(repas): readonly LigneConsommee[]
// { identity, sourceType, catalogFoodId?, productId?, nameSnapshot, quantityTotal, unit }
```

Fonction **pure**, dans le module feuille. Elle répond à « donne-moi les aliments
réellement consommés du 3 au 9 août ». Ce que Courses en fera — rayons,
conditionnements, ce qui reste au placard — ne la regarde pas.

**Les trois règles d'identité**

1. `catalog_food` → **l'identifiant**. Deux aliments différents ne se rejoignent
   jamais, même s'ils portent le même nom.
2. `product` → **l'identifiant**, garanti unique par GTIN depuis A3.
   ⚠️ **Deux GTIN restent deux produits.** « Yaourt nature 500 g » et « Yaourt
   nature 1 kg » ont deux fiches, parfois deux compositions ; additionner leurs
   quantités mettrait sur une liste un produit qui n'existe pas. Testé sur le
   pire cas : **libellé identique au mot près**, deux lignes quand même.
3. `free` → **le libellé normalisé** (minuscules, accents retirés, espaces
   réduits). Seule règle souple du fichier, et sûre parce qu'elle ne s'applique
   **qu'aux** aliments saisis à la main, qui n'ont par définition aucun
   identifiant. `normaliserLibelle` n'est appelée qu'une fois dans
   `identiteDeLEntree`, sur cette branche — un test le compte.

L'identité porte le **type en préfixe** (`catalog_food:…`, `product:…`) : deux
`uuid` peuvent coïncider entre deux tables, et un aliment n'est pas un produit.

---

## 11. Unités — aucune conversion, jamais

L'**unité fait partie de la clé** d'agrégation : `` `${identity}|${e.unit}` ``.

- `g` reste `g`, `ml` reste `ml`, `piece` reste `piece`, `portion` reste
  `portion` — quatre unités, quatre lignes possibles pour un même aliment.
- **200 g et 200 ml du même produit donnent DEUX lignes.** `food_catalog` ne
  porte aucune densité ; inventer « 1 ml ≈ 1 g » créerait une seconde convention
  nutritionnelle à côté du 4/4/9, celle-là même que la RPC d'A2 refuse depuis le
  premier jour. Deux lignes dans une liste de courses se lisent ; une conversion
  inventée ne se voit pas.
- Aucune densité, aucun facteur, aucune table de conversion dans le fichier
  (`densite`, `density`, `convert`, `mlVersG`, `1 ml` : tous absents du code —
  et `1 ml` est présent dans la **prose**, ce qui rend le contrôle probant).

---

## 12. Tests — A5-HISTORY, 26 tests, 0 échec

`npm run test:aliments-a5-history` — **HIST1..HIST25 + HIST-SUP**.

| | |
|---|---|
| HIST1 | semaine actuelle par défaut ; le **dimanche** appartient à la semaine du lundi d'avant ; date illisible → `null` |
| HIST2 | jour actuel sélectionné ; sur une semaine passée, **aucun** jour marqué, aucun badge |
| HIST3 | semaine précédente : les 7 bonnes dates ; changement de **mois**, changement d'**année** (`du 28 décembre 2026 au 3 janvier 2027`), −52 semaines sans dérive |
| HIST4 | semaine suivante ; aller-retour **exactement** idempotent ; les deux rappels câblés |
| HIST5 | un jour ne voit que ses `consumed_meals` |
| HIST6 | repas ouvert mais vide : 0 total, 0 aliment, **pas** un jour suivi ; le module ignore le vocabulaire de la prescription |
| HIST7 | repas personnel présent, à égalité avec un prescrit |
| HIST8 | instantané `catalog_food` conservé (libellé, macros, identité) |
| HIST9 | instantané `product` conservé ; `product_id` remonté par la couche de lecture |
| HIST10 | catalogue modifié ensuite : historique inchangé ; **aucune source vivante** nommée dans le module |
| HIST11 | jour sans saisie ≠ 0 kcal ; le thé sans sucre est une saisie ; l'écran l'écrit en mots |
| HIST12 | moyenne sur les jours **suivis** — 2 000, pas 1 428 ; `null` si aucun ; aucun `/ 7` |
| HIST13 | totaux exacts, **voisins exclus** (dimanche d'avant, lundi d'après) ; somme des jours = total semaine |
| HIST14 | `g` reste `g` |
| HIST15 | `ml` reste `ml` ; `piece` et `portion` aussi — trois unités, trois lignes |
| HIST16 | 200 g + 200 ml = **deux lignes** ; aucune densité dans le fichier |
| HIST17 | élève A ≠ élève B (policies + **checklist SQL exécutée**) |
| HIST18 | coach borné à `is_coach_of_student` (+ checklist) |
| HIST19 | écriture retirée **par privilège**, pas seulement par policy (+ checklist) |
| HIST20 | identités identiques additionnées ; ordre déterministe ; `free` regroupé sur le libellé normalisé |
| HIST21 | deux GTIN jamais fusionnés, **même libellé identique** |
| HIST22 | deux `catalog_food` jamais fusionnés ; même `uuid` dans deux tables ≠ même identité ; source supprimée → repli sur le libellé |
| HIST23 | aucune date déplacée ; aucune écriture nommée dans le module ni dans la barre |
| HIST24 | les deux rappels ne font que poser un état — une instruction chacun |
| HIST25 | A5.6 garde **les cibles propres à chaque jour** (2 000 le lundi, 2 600 les autres) ; le consommé du lundi ne déborde pas |
| HIST-SUP | le dépouillement de la prose n'a rien vidé, et les mots interdits sont bien **présents dans la prose** |

**Checklist SQL** — `supabase/tests/aliments_a5_7_historique_checklist.sql`,
**32 contrôles, 0 échec**, `ROLLBACK` propre (aucune donnée de test ne subsiste,
3 330 Ciqual intacts). Elle couvre HIST5, HIST6, HIST11, HIST13, HIST17, HIST18,
HIST19, HIST23, plus : aucune table/vue/vue matérialisée d'historique
alimentaire, pas de `Seq Scan` sur une lecture de semaine, `product_id` présent
depuis A3.

**Deux pièges rencontrés et corrigés dans le harnais** (pas dans le produit) :

- React sépare deux textes adjacents par `<!-- -->` : `{a}/{b}` rend
  `5<!-- -->/<!-- -->7`. Une assertion écrite sur ce que l'utilisateur *lit*
  échouait sur un affichage correct → helper `texteRendu`.
- `consumedOn === date` contient littéralement `consumedOn =` : interdire cette
  chaîne rendait rouge la lecture même qu'elle devait autoriser → regex
  `/consumedOn\s*=[^=]/`, doublée d'un contrôle qui exige que la **comparaison**,
  elle, soit bien présente.

---

## 13. Contrôles négatifs — les huit, exécutés puis restaurés

Chacun casse volontairement une règle et doit **rougir**. Restauration vérifiée
ensuite par `diff -r` contre une copie de référence : **aucun écart**.

| # | ce qui a été cassé | rouge obtenu |
|---|---|---|
| 1 | historique recalculé depuis `food_products` actuel (ajout d'un `fetch`) | **HIST10**, HIST-SUP |
| 2 | jour vide traité comme 0 kcal (`aSaisie: true`) | **HIST6, HIST11, HIST12, HIST13** |
| 3 | semaine mélangeant une date extérieure (borne retirée) — JS **et** SQL | **HIST13** ; checklist : HIST5 ×2, HIST13, HIST11 |
| 4 | données d'un autre élève (policy `using (true)` posée exprès) | checklist : **9 contrôles rouges** — HIST5, HIST13, HIST17 ×4, HIST18 ×3 |
| 5 | `ml` converti en `g` dans la clé d'agrégation | **HIST16** |
| 6 | deux GTIN fusionnés sur leur nom | **HIST9, HIST21, HIST22** |
| 7 | prescription non consommée affichée (cible ajoutée au total) | **HIST5, HIST6, HIST7, HIST8, HIST10, HIST11** |
| 8 | navigation modifiant les données (`creerRepas` dans le rappel) | **HIST4, HIST24** |

Note honnête sur le n° 5 : **un seul** test le rattrape (HIST16). HIST14 et
HIST15 restent verts, parce que la ligne conserve malgré tout son unité
d'origine — c'est exactement leur périmètre. Le contrôle discrimine, mais la
règle « pas de conversion » ne tient qu'à HIST16, et c'est dit ici plutôt que
masqué.

```
RESTAURATION VÉRIFIÉE : aucun écart avec la référence
# pass 26 # fail 0
ALIMENTS A5.7 · HISTORIQUE — 32 contrôles, 0 échec(s)
```

---

## 14. Non-régression

| suite | résultat |
|---|---|
| `aliments-a1` | 16 / 0 |
| `aliments-a2` | 42 / 0 |
| `aliments-a3` | 19 / 0 |
| `aliments-a3-off` | 23 / 0 |
| `aliments-a3-ui` | 25 / 0 |
| `aliments-a3-search` | 36 / 0 |
| `aliments-a4-scan` | 25 / 0 |
| `aliments-a4-ui` | 30 / 0 |
| `aliments-a5` | 26 / 0 |
| `aliments-a5-jour` (A5-DAY) | 16 / 0 |
| **`aliments-a5-history`** | **26 / 0** |
| `nutrition-macro-targets` | 15 / 0 |
| `nutrition-meal-distribution` | 23 / 0 |
| `nutrition-recipe-solver` | 25 / 0 |
| `nutrition-plan-v2-guards` | 18 / 0 |
| `nutrition-plan-v2-builder` | 72 / 0 |
| `nutrition-single-assigned-plan` | 28 / 0 |
| `nutrition-recipes` | 45 / 0 |
| `nutrition-recipes-admin` | 65 / 0 |
| `nutrition-recipe-images` | 46 / 0 |
| `nutrition-v2-unified` | 74 / 0 |
| `nutrition-linebreaks-rpe-halves` | 14 / 0 |
| `security-hardening` | 31 / 0 |

**Total : 760 tests, 0 échec.**

Les suites qui exigent des identifiants Supabase réels (`webhook-*`,
`account-activation-provisioning`, …) n'ont pas été exécutées : elles échouent
dans le conteneur pour absence de secrets, indépendamment d'A5.7, et les faire
tourner supposerait de toucher à la base réelle — ce que la consigne interdit.

---

## 15. `tsc`

```
npx tsc --noEmit
tsc exit=0
```

---

## 16. `eslint`

```
npx eslint .
eslint exit=0
```

---

## 17. `git status` / `git diff --check`

À exécuter sur le Mac après transfert — le miroir du conteneur n'est pas un
dépôt git. Les fichiers livrés sont ceux du tableau du §1.

**Aucun commit, aucun push, aucun merge, aucun `db push`.** La base locale `lab`
est la seule à avoir été touchée, et chaque checklist se termine par un
`ROLLBACK` vérifié.
