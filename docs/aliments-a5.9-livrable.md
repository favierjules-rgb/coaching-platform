# ALIMENTS A5.9 — RESPONSIVE DE LA FICHE ÉLÈVE ADMIN/COACH — LIVRABLE

**Livré, non commité. Aucune migration. Aucun `db push`. Aucun merge.**
Aucune modification métier, aucun calcul nutritionnel touché, aucune RLS
touchée. Trois lignes de CSS utilitaire, deux fichiers.

---

## 0. Ce que l'audit a coûté, et pourquoi c'est dans le rapport

Trois de mes propres mesures étaient **fausses avant d'être justes**. Elles sont
racontées ici parce qu'elles sont la partie utile du lot : sans les contrôles
négatifs, ce rapport aurait conclu « aucun débordement, rien à corriger ».

| # | ce que j'ai mesuré | pourquoi c'était faux | ce qui l'a démasqué |
|---|---|---|---|
| 1 | « la balise viewport manque » | Next **fusionne** ses défauts avec l'export partiel : la balise émise est correcte | lecture du HTML réellement servi |
| 2 | « 0 px de débordement partout » sur le harnais | le harnais répondait **404** : un dossier `app/__…` commence par `_`, donc **privé** et jamais routé | garde-fou de contenu ajouté au banc |
| 3 | « 0 px de débordement » sur la page réelle | le banc ne regardait que `documentElement` — or `<main>` **avalait** le débordement | un `div` de 2 400 px injecté exprès, qui n'a pas rougi |

Le §11 est donc respecté par la mesure, pas par prudence : **le viewport était
déjà correct et n'a pas été touché.**

---

## 1. Cause exacte du débordement desktop

**Deux défauts qui se cumulent**, tous deux introduits par le carrousel d'A5.6
et rendus visibles sur la fiche par A5.8.

### 1.a — La piste du carrousel imposait sa largeur de contenu

`NutritionDayCarousel` rend sept jours en `w-full flex-shrink-0` dans une piste
`overflow-x-auto`. `overflow-x-auto` ne suffit **pas** à isoler le débordement :
les enfants étant `flex-shrink-0`, la largeur **minimale** de la piste valait la
**somme** de leurs largeurs minimales.

> Mesuré : la piste avait un `clientWidth` de **1 106 px quel que soit le
> viewport** — 390 px comme 1 440 px. Elle se dimensionnait sur son contenu.

### 1.b — La colonne de contenu d'`AdminShell` ne pouvait pas rétrécir

```
<div className="flex min-h-screen">        ← rangée flex
  <div className="hidden lg:flex">…</div>  ← sidebar
  <div className="flex flex-1 flex-col">   ← ⚠️ min-width: auto
```

Un enfant flex a `min-width: auto` : il refuse de devenir plus étroit que la
largeur minimale de son contenu. Les 1 106 px de la piste remontaient donc
jusqu'à cette colonne, qui élargissait la rangée, qui élargissait la page.

> Mesuré : **1 204 px de colonne dans un viewport de 390 px**.

### 1.c — Le symptôme « il faut slidder » plutôt qu'une barre de page

`<main className="flex-1 overflow-y-auto p-6 lg:p-10">` : la spec CSS force
`overflow-x` à `auto` dès qu'un axe cesse d'être `visible`. `<main>` était donc
un conteneur de défilement **horizontal** que personne n'avait demandé, et il
**absorbait** une partie du débordement. C'est pourquoi la page glissait
latéralement sans toujours montrer de barre — et pourquoi une mesure limitée à
`documentElement.scrollWidth` ne pouvait pas le voir.

`<main>` n'a **pas** été modifié : une fois 1.a et 1.b corrigés, plus rien ne
déborde, donc il ne défile plus horizontalement. Un test le vérifie.

---

## 2. Cause exacte du rendu miniature sur mobile

**La même.** Ce n'est pas un problème de viewport — la balise émise est
`<meta name="viewport" content="width=device-width, initial-scale=1">`, vérifié
sur le HTML réellement servi, sur la fiche élève comme ailleurs.

Quand le contenu d'une page dépasse largement le viewport, Safari iOS **réduit
l'échelle initiale pour faire tenir la largeur**. Avec un document de 6 687 px
sur un écran de 390, le facteur est d'environ **1/17** : textes, cartes et
historique deviennent illisibles. Un seul défaut, deux symptômes.

Un troisième élément aggravait le mobile, et il venait d'A5.8 :

### Les `sr-only` s'échappaient du carrousel

`JourConsomme` posait un `<p className="sr-only">{date}</p>`. En Tailwind,
`sr-only` est `position: absolute`. **Un élément absolu n'est pas clippé par un
conteneur défilant si son bloc conteneur se situe au-dessus de ce conteneur** :
les sept paragraphes sortaient de la piste et allongeaient le document.

> Mesuré : le `<p class="sr-only">` le plus à droite avait un bord droit à
> **6 727 px** — exactement le `scrollWidth` du document.

---

## 3. Fichiers corrigés

| fichier | correction | lignes |
|---|---|---|
| `components/admin/AdminShell.tsx` | `min-w-0` sur la colonne de contenu | 1 |
| `components/student/NutritionDayCarousel.tsx` | `w-full min-w-0` sur la piste | 1 |
| `components/student/NutritionDayCarousel.tsx` | `relative` sur chaque jour | 1 |

Plus, hors application : `scripts/tests/aliments-a5-responsive.mts` (nouveau),
`scripts/dev/mesure-responsive.mjs` (le banc, **hors** de `app/`), `package.json`.

**Ce qui n'a PAS été utilisé**, conformément au §2 : aucun `overflow-x-hidden`
sur `html`/`body`, aucun `transform: scale`, aucun `zoom`, aucune largeur
desktop artificielle, aucun viewport truqué, aucune réduction de `font-size`.
Un test l'interdit explicitement.

---

## 4. Avant / après — `documentElement.scrollWidth`

Mesuré dans Chromium sur la vraie chaîne de conteneurs (`AdminShell`, sidebar,
`<main>`, la carte, `CoachNutritionHistory`, `NutritionDayCarousel`,
`DailyNutritionProgress`, une journée avec repas).

| viewport | scrollWidth AVANT | écart | scrollWidth APRÈS | écart |
|---:|---:|---:|---:|---:|
| 375 | 6 687 | **+6 312** | 375 | **0** |
| 390 | 6 687 | **+6 297** | 390 | **0** |
| 393 | 6 687 | +6 294 | 393 | **0** |
| 430 | 6 687 | +6 257 | 430 | **0** |
| 768 | 6 687 | +5 919 | 768 | **0** |
| 1 280 | 6 943 | +5 663 | 1 280 | **0** |
| 1 440 | 6 943 | **+5 503** | 1 440 | **0** |
| 1 728 | 9 607 | +7 879 | 1 728 | **0** |
| 1 920 | 9 607 | **+7 687** | 1 920 | **0** |

**Second critère, celui que la première version du banc ne voyait pas** : aucun
conteneur ne défile horizontalement sans l'avoir demandé. Seule la piste du
carrousel défile — c'est son rôle — et elle tient désormais dans son parent.

---

## 5. Résultat 375 / 390 / 430 px

`scrollWidth === clientWidth`, écart **0 px** aux trois largeurs.

La page se **recompose** au lieu de rétrécir :

- les huit actions passent à la ligne, une par ligne, cibles tactiles à 44 px ;
- l'e-mail long (testé avec une adresse insécable de 68 caractères) revient à la
  ligne au lieu de pousser la colonne ;
- chaque carte occupe 100 % de la largeur ;
- l'historique affiche l'anneau centré, les trois barres dessous, libellés
  lisibles ;
- un libellé produit insécable (`Flocons-d-avoine-complets-bio-…`) se **tronque**
  avec une ellipse — `min-w-0` + `truncate` — au lieu d'élargir la ligne ;
- aucun pincement nécessaire.

---

## 6. Résultat 1 280 / 1 440 / 1 920 px

Écart **0 px** aux trois largeurs, et à 1 728 px également.

Sidebar + contenu = viewport exactement : **240 px + 1 200 px = 1 440 px** à la
largeur 1 440. La sidebar reste l'enfant flex incompressible, la colonne de
contenu l'enfant compressible — c'est le couple que `min-w-0` rend possible.

Aucune régression de la mise en page desktop : le carrousel garde sa largeur
pleine, l'anneau et les barres restent spacieux.

---

## 7. Comportement du graphique de poids

**Inchangé, et il n'était pas en cause.** `components/shared/WeightChart.tsx`
rend un `<svg>` en `viewBox` avec `className="w-full"` et `height: auto` : il se
met à l'échelle de son parent et n'impose aucune largeur intrinsèque. Aucune
largeur en pixels, aucun `w-screen`, aucun `min-w-max`.

Son unique `whitespace-nowrap` est sur l'**infobulle**, `absolute` et
`pointer-events-none`, à l'intérieur d'un parent `relative` — donc retenue par
son ancêtre positionné. C'est précisément la condition qui manquait aux
`sr-only` du carrousel, et un test la vérifie plutôt que d'interdire le motif en
bloc.

---

## 8. Comportement de l'historique nutrition

- Le bloc prend 100 % de la largeur de sa carte et rétrécit avec elle.
- La barre de semaine : les deux flèches gardent 44 px et ne se compriment pas ;
  le titre porte `min-w-0` + `truncate`, sans quoi
  « Semaine du 28 décembre 2026 au 3 janvier 2027 » imposerait sa largeur.
- Le résumé hebdomadaire passe à la ligne (`flex-wrap`).
- Le défilement des sept jours reste **à l'intérieur** du carrousel — c'est tout
  l'objet du correctif 1.a. `snap-x`, `scroll-snap` et le `scrollTo` sur la
  piste sont inchangés : le contrat A5.6 est intact, et testé.

---

## 9. Tests responsive — A5-RESPONSIVE, 17 tests, 0 échec

`npm run test:aliments-a5-responsive` — RESP1..RESP16 + RESP-SUP.

**Ce que ce harnais mesure, et ce qu'il ne mesure pas.** Un débordement ne se
prouve que dans un moteur de rendu ; le dépôt n'a ni jsdom ni moteur de layout.
Le fichier ne rejoue donc pas le navigateur : il garde les **invariants de code**
dont la mesure a établi qu'ils étaient la cause, et consigne les chiffres
observés (RESP11..16 vérifient qu'un débordement existait **avant** — sans quoi
ces tests seraient verts sur du vide).

| | |
|---|---|
| RESP1 | ni `w-screen`, ni `100vw`, ni largeur en pixels, ni `min-w-max` |
| RESP2 | `min-w-0` sur la colonne de contenu — la cause n°1 |
| RESP3 | aucune largeur minimale sur `CoachNutritionHistory` |
| RESP4 | les actions passent à la ligne, cibles 44 px conservées |
| RESP5 | l'historique tient à 100 %, libellés `min-w-0` + `truncate` |
| RESP6 | la barre de semaine ne force aucune largeur |
| RESP7 | l'anneau fait 120 px de côté — sous les 375 px du plus petit écran |
| RESP8 | `min-w-0` sur la piste des barres, remplissage en pourcentage |
| RESP9 | le graphique en `viewBox` + `w-full`, infobulle absolue contenue |
| RESP10 | sidebar + contenu = viewport |
| RESP11..16 | 375 / 390 / 430 / 768 / 1 440 / 1 920 : écart 0, et débordement réel avant |
| RESP-SUP | aucun masquage, viewport intact, **aucun banc livré** |

**Contrôles négatifs sur les correctifs**, exécutés puis restaurés :

| correctif retiré | tests rouges |
|---|---|
| `min-w-0` du shell | **3** |
| `w-full min-w-0` de la piste | **1** |
| `relative` des jours | **1** |

**Contrôles négatifs du banc lui-même** — ceux qui comptent le plus ici : un
`div` de 2 400 px injecté dans la page ne rougissait **pas** avec la première
version du détecteur ; il rougit avec la version finale, qui distingue le
défilement *voulu* (`overflow-x` demandé) du défilement *subi*.

---

## 10. Non-régression

| suite | | suite | |
|---|---|---|---|
| `aliments-a1` | 16 / 0 | `aliments-a5` | 26 / 0 |
| `aliments-a2` | 42 / 0 | `aliments-a5-jour` | 16 / 0 |
| `aliments-a3` | 19 / 0 | `aliments-a5-history` | 26 / 0 |
| `aliments-a3-ui` | 25 / 0 | `aliments-a5-coach` | 11 / 0 |
| `aliments-a3-search` | 36 / 0 | **`aliments-a5-responsive`** | **17 / 0** |
| `aliments-a4-scan` | 25 / 0 | `admin-shell-nav` | 16 / 0 |
| `aliments-a4-ui` | 30 / 0 | | |

**Total : 305 tests, 0 échec.** `admin-shell-nav` est inclus délibérément :
c'est la suite qui garde le comportement du tiroir mobile d'`AdminShell`, le
fichier modifié.

Aucun fichier d'A2, A3, A4, A5, A5.6, A5.7 ni A5.8 n'a été touché, hormis les
deux composants de mise en page nommés au §3.

---

## 11. `tsc`

```
npx tsc --noEmit
tsc exit=0
```

---

## 12. `eslint`

```
npx eslint .
eslint exit=0
```

⚠️ eslint a rattrapé une bourde de ma part que `tsc` avait laissé passer : ma
propre prose contenait une séquence de fermeture de commentaire littérale, qui
refermait le bloc au milieu d'une phrase. Reformulée.

---

## 13. `git diff --check`

À exécuter sur le Mac après transfert — le miroir du conteneur n'est pas un
dépôt git.

---

## 14. `git status`

Les fichiers du §3, non commités. Rien n'a été stagé, aucun commit, aucun merge.

**Rappel du lot précédent** : le pont ne peut pas supprimer de fichiers et git a
laissé un `.git/index.lock` vide. Avant ton commit :

```
cd ~/Documents/coaching-platform && rm -f .git/index.lock
```

Le dossier `_to_delete/` contient `a57.tgz`, `a58.tgz`, `a59.tgz` et
`git-lock-a58/` — à supprimer quand tu veux, je ne peux pas le faire d'ici.
