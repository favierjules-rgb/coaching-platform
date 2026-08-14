# COURSES C1 — CORRECTIONS FINALES

Trois points demandés : l'audit des ingrédients `free`, la correction des modes,
l'intégration complète dans l'espace élève. Rapport en onze points.

---

## 1. Résultat de l'audit `free` — **aucun ingrédient `free` en production**

Requête de lecture seule sur la base réellement connectée (aucune écriture,
aucun `db push`), sur `nutrition_recipe_ingredients` jointe aux recettes
`active` :

| `role` | ingrédients |
|---|---|
| `fixed` | 41 |
| `protein` | 22 |
| `carbohydrate` | 19 |
| `fat` | 18 |
| **`free`** | **0** |

**La condition de STOP n'est pas remplie** : elle portait explicitement sur les
aliments `free`, et il n'y en a aucun. Aucun aliment achetable ne disparaît
silencieusement de la liste — le solveur ne met à 0 g que les `free`, et il n'y
en a pas. La réserve que j'avais formulée dans le livrable C1 était donc
infondée, et c'est la mesure qui l'a montré, pas une relecture.

### Ce que l'audit a montré d'autre, et qui mérite d'être dit

`fixed` est le rôle le plus peuplé, et il est **hétérogène**. Il contient :

- de **vrais aliments achetables**, quantifiés et présents dans la liste :
  Comté 1 tranche 20 g, jambon blanc 20 g, lait d'amandes 150/125 g, lait
  demi-écrémé 175/100 g, panure panko 20 g, parmesan râpé 5 g, pain burger
  62,5 g, wrap fin 32 g (`unit_scalable`), œuf entier 50 g, fruits rouges
  surgelés 150 g / frais 100 g, haricots verts ou brocolis 200 g, fromage blanc
  0 % 40/30 g, sauces zéro 30 g ;
- des **assaisonnements** qui ne s'achètent pas à la portion : « Cannelle »,
  « Curry, ail, gingembre, citron vert » ;
- des **libellés composites** qui tiennent plusieurs aliments dans une seule
  ligne de texte : « Salade, tomate, oignon rouge, cornichons » 200 g.

Les trois catégories sortent aujourd'hui sur la liste, telles quelles. Les deux
dernières produisent des lignes bizarres — « Cannelle · 6 g », « Salade, tomate,
oignon rouge, cornichons · 600 g ». Ce n'est pas un aliment perdu, c'est un
aliment mal présenté : **rien à corriger en urgence, mais c'est une décision
pour C2**, et elle demande soit un champ dans le schéma, soit une convention de
saisie côté coach. Je ne l'ai pas tranchée seul.

---

## 2. La correction exacte des modes

### Le défaut

`plan_habitudes` lisait encore les envies. Conséquence mesurable : dès que
l'élève cochait une envie, `plan_envies` et `plan_habitudes` rendaient **la même
liste**. Le sélecteur de mode affiché à l'écran ne changeait rien.

### La correction

Un tableau de signaux, dans `lib/courses/besoins.ts`, lu une fois avant la
boucle des jours :

```ts
const SIGNAUX: Readonly<
  Record<ModeGeneration, { readonly envies: boolean; readonly favoris: boolean; readonly habitudes: boolean }>
> = {
  plan_envies:    { envies: true,  favoris: true,  habitudes: true },
  plan_habitudes: { envies: false, favoris: true,  habitudes: true },
  plan_seul:      { envies: false, favoris: false, habitudes: false },
};
const actifs = SIGNAUX[entree.mode];

const envies    = actifs.envies    ? enviesNormalisees(entree.preferences) : [];
const favoris   = actifs.favoris   ? entree.favoris                        : [];
const habitudes = actifs.habitudes ? entree.habitudes                      : {};
```

Un tableau plutôt que trois `if` : le contrat des trois modes se lit d'un coup,
et un quatrième mode ajouté demain ne compilerait pas sans y déclarer ses trois
signaux.

### Ce qui ne figure PAS dans le tableau, volontairement

**Les exclusions.** Elles s'appliquent dans les trois modes, y compris
« mon plan uniquement ». « Je préfère éviter le poisson cette fois-ci » n'est
pas une préférence de confort qu'un mode pourrait ignorer : c'est un refus.

### Correction annexe trouvée au passage

`slot_not_found` produisait un avertissement `aucune_cible`, alors que seul
`no_calories` en justifie un. Un plan normal générait ainsi **cinq
avertissements faux par jour** — l'écran aurait paru cassé dès le premier
usage réel.

### Tests

`MODE-1` à `MODE-4` dans `scripts/tests/courses-c1.mts` :

| test | ce qu'il garde |
|---|---|
| MODE-1 | une envie influence `plan_envies` |
| MODE-2 | **la même envie n'influence PAS** `plan_habitudes` |
| MODE-3 | favoris et habitudes influencent `plan_habitudes` |
| MODE-4 | ni envie, ni favori, ni habitude n'influencent `plan_seul` |

MODE-2 et MODE-4 sont ceux qui seraient restés verts avant la correction : ils
comparent deux générations et exigent qu'elles **diffèrent** ou qu'elles soient
**identiques**, jamais qu'un mot apparaisse quelque part.

---

## 3. L'intégration exacte dans l'espace élève

### Le parcours, en cinq étapes

`components/student/CoursesParcours.tsx` — un seul écran, cinq blocs :

1. **Durée** — sept boutons, de 1 à 7 jours. Pas de champ numérique libre : 0
   et 8 sont inatteignables depuis l'écran en plus d'être refusés par le moteur.
   Date de départ modifiable.
2. **Envies** — neuf catégories, suggestions cliquables, saisie libre possible.
   Entièrement facultatif.
3. **Exclusions temporaires** — valables pour cette génération seulement.
   **Aucune écriture de profil**, aucune préférence persistée.
4. **Mode** — les trois modes, avec la recommandation qui suit les envies tant
   que l'élève n'a rien choisi, et qui se tait dès qu'il a choisi.
5. **Liste** — `CoursesListe`, groupée par rayon, unités réelles.

### Où elle se branche

`app/(student)/courses/page.tsx` ne fait que **câbler des lecteurs existants** :

| donnée | lecteur réutilisé |
|---|---|
| plan + recettes | `useStudentNutritionPlanV2` |
| favoris | `useRaccourcisAliments` |
| habitudes 7 j et 28 j | `useConsumedMeals` |

Aucun nouvel accès aux mêmes tables : ouvrir ici une seconde lecture de
`consumed_meals` ferait deux requêtes concurrentes pour la même donnée, et deux
vérités possibles sur l'historique.

**Aucune écriture.** `useConsumedMeals` expose des fonctions d'écriture ; la
page ne lit que `.meals`, et C1-UI-12 le vérifie sur le source.

### La porte d'entrée

Un lien **« Mes courses »** sur l'écran `/nutrition`, sous l'entrée Recettes.
Volontairement **sobre** : l'anneau lumineux animé de `RecipesHighlightLink`
perdrait tout son sens s'il était répété sur le même écran.

Sans ce lien, `/courses` n'aurait été atteignable qu'en tapant l'URL. C1-UI-01
le garde maintenant.

### Hors ligne

`/courses` est ajouté à la liste blanche des coquilles du service worker
(`public/sw.js`), et la page traite les trois états d'`useEtatOfflineEleve`
comme `/nutrition` : `SectionIndisponible` plutôt qu'une liste vide.

C'est le test `pwa-coquille` C5 qui a trouvé l'oubli — il vérifie que **toute**
section réelle de `app/(student)` figure dans la liste blanche. Sans lui,
`/courses` serait tombé sur l'écran « Pas de connexion » du navigateur au
premier trajet en métro. Sans le traitement hors ligne, il aurait affiché
« aucun plan » à un élève qui a simplement perdu le réseau.

### Le défaut trouvé par C1-UI-12

`habitudesDepuis` appelait `agregerConsommation` **une fois sur toute la
fenêtre**. Or cet agrégateur fond volontairement toutes les consommations d'un
même aliment en une seule ligne — c'est ce qu'il faut pour un total
hebdomadaire, et exactement ce qu'il ne faut pas ici. Le compteur ne pouvait
donc valoir que **0 ou 1** : un aliment mangé sept fois pesait autant qu'un
aliment mangé une fois, alors que le champ s'appelle « nombre de
consommations ».

Corrigé par une agrégation **repas par repas** : la fréquence est conservée,
l'identité alimentaire reste entre les mains d'A5.7 (jamais deux GTIN fondus),
et un aliment saisi deux fois dans le même repas ne compte qu'une fois — un
repas est une consommation.

Le scoring, lui, n'a pas bougé : il lit la **présence** (`> 0`), pas le volume,
pour qu'un aliment consommé quarante fois n'écrase pas une envie explicite.

---

## 4. Fichiers créés / modifiés

### Créés

| fichier | rôle |
|---|---|
| `hooks/useCourses.ts` | l'état du parcours ; ne calcule aucune course |
| `components/student/CoursesParcours.tsx` | les cinq étapes |
| `app/(student)/courses/page.tsx` | le câblage des lecteurs existants |
| `scripts/tests/courses-c1-ui.mts` | C1-UI-01..15 + SUP |
| `docs/courses-c1-corrections.md` | ce rapport |

### Modifiés

| fichier | modification |
|---|---|
| `lib/courses/besoins.ts` | tableau `SIGNAUX` ; `slot_not_found` n'avertit plus |
| `scripts/tests/courses-c1.mts` | + MODE-1..MODE-4 |
| `app/(student)/nutrition/page.tsx` | lien « Mes courses » |
| `public/sw.js` | `/^\/courses$/` dans `COQUILLES_ELEVE` |
| `package.json` | `test:courses-c1-ui` |

`VERSION` du service worker **non modifiée** : ajouter un motif à la liste
blanche n'invalide aucun cache existant, et un changement de `VERSION` ferait
perdre à tous les élèves leurs coquilles déjà en cache pour rien.

**Aucune migration. Aucun `db push`. Aucun commit, aucun merge.**

---

## 5. Tests C1 moteur — 35 tests, 0 échec

```
npm run test:courses-c1
# pass 35 # fail 0
```

C1-01..C1-30, MODE-1..MODE-4, C1-SUP.

---

## 6. Tests C1 UI — 16 tests, 0 échec

```
npm run test:courses-c1-ui
# pass 16 # fail 0
```

C1-UI-01..C1-UI-15 + C1-UI-SUP (le dépouillement des commentaires n'a rien vidé
— la leçon `app/admin/**` d'A5.9 : les commentaires de LIGNE sont retirés avant
les blocs).

### Contrôles négatifs — huit, exécutés puis restaurés

| # | sabotage | test devenu rouge |
|---|---|---|
| 1 | `habitudesDepuis` agrège toute la fenêtre d'un coup | C1-UI-12 |
| 2 | le lien `/courses` retiré de l'écran Nutrition | C1-UI-01 |
| 3 | `/^\/courses$/` retiré de `public/sw.js` | C1-UI-13 **et** pwa-coquille C5 |
| 4 | `plan_habitudes` écoute les envies | MODE-2 |
| 5 | `plan_seul` écoute les favoris | MODE-4 |
| 6 | la page lit une fonction d'écriture de `useConsumedMeals` | C1-UI-12 |
| 7 | le résultat du moteur est jeté avant `setResultat` | C1-UI-10 |
| 8 | `min-h-[44px]` ramené à 30 px | C1-UI-01 **et** C1-UI-15 |

**Le contrôle n° 7 est resté vert au premier essai**, et c'est le seul
enseignement de cette série : C1-UI-10 ne vérifiait que la **présence** de
`genererCourses(` dans le source. En glissant `(… as never) ?? genererCourses({…})`,
l'appel restait écrit, son résultat était jeté, et le test ne voyait rien. Le
test a été renforcé — `setResultat\(\s*genererCourses\(\{` — puis le sabotage
rejoué : rouge. Les six fichiers touchés ont été comparés à leur sauvegarde
après restauration : identiques.

---

## 7. Non-régression — 97 suites, 2 248 tests verts

Toute la batterie a été relancée, pas seulement les suites voisines.

**Verts, entre autres :** courses-c1 (35), courses-c1-ui (16), aliments-a1 (16),
a2 (42), a3 (19), a3-off (23), a3-ui (25), a3-search (36), a4-scan (25),
a4-ui (30), a5 (26), a5-jour (16), a5-history (26), a5-coach (11),
a5-responsive (17), nutrition-v2-unified (74), plan-v2-builder (72),
recipes-admin (65), recipe-images (46), recipes (45),
single-assigned-plan (28), recipe-solver (25), meal-distribution (23),
plan-v2-guards (18), macro-targets (15), security-hardening (31),
authz-hardening (25), authz-behaviour (25), pwa-coquille (11).

### Huit suites rouges — **toutes antérieures à ce lot**

| suite | échecs | cause |
|---|---|---|
| `webhook-idempotency` | 7 | `supabase.rpc is not a function` (`lib/supabase/programs.ts`) |
| `account-activation-provisioning` | 16 | même cause |
| `previous-performance` | 1 | `.filter(hasRealizedSetInput)` attendu 2 fois, présent 1 fois |
| `set-rpe-feedback` | 1 | même cause |
| `prescribed-rpe` | 1 | même cause |
| `student-training-ui` | 1 | même cause |
| `training-movement-patterns` | 3 | training |
| `student-feedback-video` | 1 | chemin vidéo absent de la charge utile |

**Preuve d'antériorité, pas déclaration.** Un manifeste md5 de 920 fichiers
source a été comparé entre le miroir et le dépôt du Mac. Sept fichiers seulement
diffèrent, et ce sont ceux du §4 (plus `next-env.d.ts`, généré et ignoré par
git, et `docs/aliments-a5.7-livrable.md`, voir §11). **Aucun** fichier exercé
par ces huit suites ne diffère : elles échouent sur du code strictement
identique à celui qui est déjà committé sur `main`.

`pwa-coquille` faisait partie des rouges au premier passage — à cause de
`/courses`. Corrigé, il est vert.

Ces huit suites ne relèvent pas de C1. Je ne les ai pas touchées, et je n'ai
modifié aucun test hors périmètre pour obtenir du vert.

---

## 8. `npx tsc --noEmit`

Aucune erreur.

---

## 9. `npx eslint .`

Aucune erreur, aucun avertissement.

---

## 10. `git diff --check`

Aucun espace en fin de ligne, aucun conflit résiduel.

---

## 11. `git status`

Sur le Mac, avant transfert : `main`, `package.json` modifié, le reste du lot
Courses en fichiers non suivis. Après transfert du delta, les fichiers du §4.

Deux points à signaler honnêtement :

1. **`.git/index.lock`** traîne dans le dépôt. Le pont ne peut pas le supprimer.
   Avant tout commit :
   ```
   cd ~/Documents/coaching-platform && rm -f .git/index.lock
   ```
2. **`docs/aliments-a5.7-livrable.md`** : ma copie de travail contient une
   version plus longue (25 183 o) que celle committée sur `main` (23 036 o) —
   un reliquat de la finalisation d'A5.7 jamais transféré. **Je ne l'ai pas
   transféré**, parce qu'il est hors du périmètre C1 et qu'il salirait le diff.
   Le dépôt garde sa version committée.

**Aucun commit. Aucun push. Aucun merge. Aucune migration. Aucun `db push`.**
