# ALIMENTS A3 — AUDIT PHASE 1

**Branche** `feat/aliments-a2-meal-tracking` · **Date** 13/08/2026 · **Aucun code écrit.**

Tout ce qui suit est **mesuré**, jamais mémorisé : la table Ciqual a été téléchargée
et analysée, les endpoints Open Food Facts ont été appelés, le schéma a été lu sur
une base reconstruite baseline → 38 migrations.

---

## 0. Le wording de suppression est déjà corrigé

Fait en A2.1, vérifié sur la branche :

```tsx
Supprimer «&nbsp;{repas.label}&nbsp;» et tout son contenu&nbsp;?
```

Aucune pluralisation dynamique, aucun comptage. `A2-POLISH1` et `A2-POLISH2`
l'éprouvent sur 0, 1 et 3 aliments, et interdisent le motif dans les six
composants du lot.

---

## 1. CE QUE LE DÉPÔT A DÉJÀ, ET CE QUI MANQUE

### `food_catalog` (A1) — utilisable tel quel pour Ciqual, à deux colonnes près

| Colonne | Verdict A3 |
|---|---|
| `id`, `name`, `slug` (généré par `food_slug`) | ✅ |
| `owner_coach_id` NULL = global | ✅ Ciqual sera global |
| `nutrition_unit` ∈ (g, ml) | ✅ Ciqual est **toujours** « pour 100 g de partie comestible » → `'g'` |
| `protein_per_100`, `carb_per_100`, `fat_per_100` | ✅ correspondance directe |
| `piece_weight_g` | ✅ reste NULL — Ciqual ne donne pas de poids de pièce |
| `status` ∈ (active, archived) | ✅ |
| **`source`** | ❌ **ABSENTE** |
| **`source_ref`** | ❌ **ABSENTE** |

**Conséquence** : sans `(source, source_ref)` et sans contrainte UNIQUE dessus, un
import rejouable est impossible — on ne saurait pas si « Banane, chair sans peau,
crue » a déjà été importée, ni la distinguer d'un aliment créé à la main.

Index existants : `food_catalog_slug_global_unique UNIQUE (slug) WHERE owner_coach_id IS NULL`.

> **Point mesuré, et c'est un soulagement** : sur les 3 385 aliments Ciqual
> retenus, `food_slug` produit **3 385 slugs distincts — zéro collision**.
> La contrainte d'unicité globale d'A1 tient sans aménagement.

### `food_aliases` (A1) — prête

`(food_id, alias, alias_normalise generated food_slug(alias))`, UNIQUE
`(food_id, alias_normalise)`, index sur `alias_normalise`. Rien à changer.

### `meal_entries` (A1+A2) — il manque le pointeur produit

```
source_type CHECK ∈ (recipe, catalog_food, product, free)   ← 'product' DÉJÀ déclaré
recipe_id → nutrition_recipes   food_id → food_catalog
meal_entries_food_id_coherent   CHECK (food_id IS NULL OR source_type = 'catalog_food')
meal_entries_source_unique      CHECK (recipe_id IS NULL OR food_id IS NULL)
```

`source_type = 'product'` est **déjà accepté** — A1 l'avait déclaré d'avance. Mais
il n'existe **aucune colonne `product_id`** : une entrée produit serait aujourd'hui
consommable sans aucune traçabilité vers le produit. A3 doit ajouter `product_id`
et sa contrainte de cohérence, dans le sens qui survit à `ON DELETE SET NULL`,
comme les deux autres.

### `consumed_meals` + les 8 RPC (A2) — **aucune modification nécessaire**

`ajouter_aliment_catalogue` exige `owner_coach_id is null and status = 'active'`.
Un aliment Ciqual étant global et actif, **le §11 de ton énoncé est déjà satisfait
sans écrire une ligne** : sélection → quantité → RPC A2 → snapshot serveur → barre
A2. Vérifié sur le banc.

Le privilège d'écriture directe sur `meal_entries` reste retiré à `authenticated` :
la voie produit devra donc être une RPC `security definer`, comme les autres.

### `food_products` — n'existe pas

Confirmé : `to_regclass('public.food_products')` → NULL.

### La recherche actuelle

```ts
.is("owner_coach_id", null).eq("status", "active")
.or(`name.ilike.%terme%,slug.ilike.%terme%`).limit(20)
```

Suffisant pour 3 385 lignes. `pg_trgm` / `unaccent` ne sont **pas** installés et A3
n'a pas besoin de les installer : le `slug` accent-plié fait déjà le travail
(« oeuf » trouve « Œuf… »).

---

## 2. CIQUAL — CE QUI EST RÉELLEMENT PUBLIÉ

**La Ciqual 2025 existe bien.** Publiée le **19/11/2025**, données extraites le
03/11/2025, DOI `10.57745/RDMHWY`. Elle remplace la 2020.

| | |
|---|---|
| XLSX FR | 1 544 342 o — téléchargé, SHA-256 `d2082938…02f32e` |
| XLS FR | 4,5 Mo |
| XML | archive **`.7z`** (LZMA2, pas un zip) → 71,8 Mo décompressés |
| CSV | **n'existe pas** |
| API | **il n'y en a aucune** — téléchargement de fichier uniquement |

⚠️ **data.gouv.fr ne publie que la 2020**, avec un avertissement explicite disant
qu'elle est annulée et remplacée. Coder l'import contre data.gouv.fr importerait la
table périmée.

### Contenu mesuré

- **3 484 aliments** × 84 colonnes (9 descriptives + 74 constituants + facteur de Jones)
- **3 385 aliments** ont les trois macros exploitables → **99 écartés**
- Drapeaux sur les 3 × 3 484 cellules P/G/L : 10 006 mesures, **174 « < seuil »**,
  **153 « traces »**, 119 manquantes

### Pièges de format — tous confirmés sur le fichier réel

1. **Toutes les cellules sont des chaînes**, jamais des nombres.
2. **Virgule décimale française** (`'49,9'`) — sauf `Facteur de Jones` qui utilise
   le **point** (`'6.25'`). Deux conventions dans le même fichier.
3. **`-` = valeur manquante, 83 246 occurrences.** La documentation ANSES est
   catégorique : « Il est impératif […] de ne pas les assimiler à des zéros. »
4. **`traces`** (153 sur P/G/L) et **`< X`** avec des dizaines de seuils distincts
   (`< 0,01`, `< 0,5`, `< 20`…), **espace après le `<`**. Ce n'est pas un ensemble
   fermé : il faut une regex, pas une liste blanche.
5. 💣 **Les `/` des en-têtes sont remplacés par des `\n`.** Le nom réel de la
   colonne n'est pas `Glucides (g/100 g)` mais `'Glucides\n(g\n100 g)'`. Un mapping
   par égalité de libellé échoue silencieusement. → **indexer par position ou par
   `const_code` via le XML.**
6. Codes de groupe en **texte avec zéros de tête** (`'01'`, `'0101'`).

### Colonnes retenues (positions mesurées dans le XLSX)

| Besoin | Colonne | Position |
|---|---|---|
| identifiant | `alim_code` | 6 |
| nom officiel | `alim_nom_fr` | 7 |
| groupe | `alim_grp_nom_fr` | 3 |
| **protéines** | `Protéines, N x 6.25 (g/100 g)` — const 25003 | 15 |
| **glucides** | `Glucides (g/100 g)` — const 31000 | 16 |
| **lipides** | `Lipides (g/100 g)` — const 40000 | 17 |
| énergie (métadonnée) | `Energie, Règlement UE 1169/2011 (kcal/100 g)` — const 328 | 10 |

Protéines : **N × 6,25** (const 25003, base étiquetage UE) plutôt que N × facteur de
Jones (25000). C'est la valeur qui correspond à ce que lit un élève sur un
emballage.

---

## 3. ⚠️ LA CONTRADICTION STRUCTURELLE À TRANCHER : LE 4/4/9 ET L'ALCOOL

Ton §2 est sans ambiguïté : « Les kcal SETH restent calculées via 4/4/9. Ne crée
PAS une seconde convention utilisant l'énergie Ciqual comme autorité. »

J'ai mesuré l'écart entre l'énergie Ciqual et notre 4/4/9 sur les 3 323 aliments
qui portent les deux :

| | |
|---|---|
| écart médian | **2,2 kcal** |
| écart moyen | 6,5 kcal |
| écart > 10 kcal | 430 aliments (13 %) |
| écart > 50 kcal | 81 aliments |
| écart maximal | **660 kcal** |

L'écart courant est négligeable — la banane donne 87,5 en 4/4/9 contre 87,6 chez
Ciqual. **Mais l'alcool n'est pas une macro.**

```
Alcool pur   Ciqual 660 kcal  ·  4/4/9   0 kcal
Gin          Ciqual 265 kcal  ·  4/4/9   0 kcal
Whisky       Ciqual 252 kcal  ·  4/4/9   0,4 kcal
Vodka        Ciqual 250 kcal  ·  4/4/9   0 kcal
```

**59 aliments** contiennent ≥ 0,5 g d'alcool / 100 g, dont **33 divergent de plus de
30 kcal**. Appliquer ta règle telle quelle signifie qu'un élève qui saisit 100 ml de
vodka verra **0 kcal**.

Ce n'est pas un défaut d'implémentation : c'est la conséquence directe et logique de
« kcal = 4×P + 4×G + 9×L » appliquée à un aliment dont l'énergie ne vient ni des
protéines, ni des glucides, ni des lipides. Trois sorties possibles, et **c'est à toi
de choisir** :

- **(a)** Importer tout, assumer 0 kcal sur les alcools. Fidèle à la règle, mais
  visiblement faux à l'écran, et sur un produit où l'enjeu diététique est réel.
- **(b)** **Ne pas importer les boissons alcoolisées** (sous-groupe Ciqual
  identifiable). L'élève ne les trouve pas et passe par la saisie manuelle. Aucune
  valeur fausse n'est jamais affichée. *C'est ma recommandation.*
- **(c)** Ajouter l'alcool comme quatrième terme énergétique (7 kcal/g) dans le
  moteur SETH. **Cela touche le cœur de `KCAL_PER_GRAM` et déborde largement d'A3** —
  je ne le ferai pas sans une décision explicite de ta part.

---

## 4. LICENCE CIQUAL — Licence Ouverte Etalab 2.0

Aucune restriction commerciale, aucune interdiction de redistribution. La seule
obligation est la **paternité**, avec la **version**. Formule demandée
littéralement par l'ANSES :

> **« Anses. 2025. Table de composition nutritionnelle des aliments Ciqual »**

Variante longue pour un contexte scientifique :

> « Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025.
> https://doi.org/10.57745/RDMHWY »

Condition supplémentaire citée : les données ne doivent pas être « altérées », leur
sens pas « dénaturé », et « la source ainsi que la version » doivent être
mentionnées.

**Emplacement proposé** : la fiche d'un aliment générique porte « Source : Ciqual
(Anses, 2025) », et une page/section « Sources alimentaires » porte la mention
complète. **Pas de mention juridique sur chaque barre d'aliment**, conformément à ta
demande.

---

## 5. OPEN FOOD FACTS — L'ÉTAT RÉEL DE L'API

Ta correction est exacte, et l'audit la confirme en la précisant.

### Lookup GTIN → **v3**, avec un piège majeur

`GET https://world.openfoodfacts.org/api/v3/product/{barcode}`

💣 **`/api/v3` nu ne rend PAS le dernier schéma.** Mesuré sur `3017620422003` :

| URL | `schema_version` | nutriments |
|---|---|---|
| `/api/v3/…` | 999 | `nutriments.proteins_100g` ✅ |
| `/api/v3.4/…` | 1002 | `nutriments.proteins_100g` ✅ |
| `/api/v3.5/…` et `/api/v3.6/…` | 1003 / 1004 | **`nutriments` = `{}`**, remplacé par un bloc `nutrition` |

→ **Il faut épingler la sous-version dans l'URL.** Je recommande **`/api/v3.4/`** :
schéma `nutriments.*_100g` stable, et le changelog qualifie encore v3.5 de « still
currently under active development ».

Différences v2 → v3 à gérer : `status` devient une **chaîne**
(`success|failure|…`), `status_verbose` est remplacé par `result: {id,name}`,
`errors[]`/`warnings[]` apparaissent, et un **produit absent rend HTTP 404** (v2
rendait 200 avec `status: 0`).

### Recherche texte → **pas en v3, et c'est confirmé par l'API elle-même**

`GET /api/v3/search` rend **HTTP 400 `invalid_api_action`** — mesuré. Le cheatsheet
officiel : « `/api/v3/search` is not yet implemented » et « Full-text search is not
available in the v2 or v3 server-side API ».

Trois options, aucune parfaite :

| Voie | État réel |
|---|---|
| **Search-a-licious** `GET https://search.openfoodfacts.org/search?q=…` | **Répond en production** (testé, 200, syntaxe Lucene). Mais OpenAPI `version: 0.1.0`, **aucun SLA, aucune limite publiée**, et la doc OFF en parle encore au futur (« will be deployed »). |
| `/api/v2/search` | Officiellement **deprecated**, et **ne fait pas de full-text** — uniquement du structuré. |
| `cgi/search.pl` | Fonctionne, « not recommended for new integrations ». |

→ **C'est exactement le cas que tu as anticipé** : la recherche texte n'est pas
couverte par v3. Elle doit être **isolée derrière notre couche serveur**, avec une
seule fonction d'adaptation remplaçable, pour qu'un futur `/api/v3/search` ne
touche pas l'UI.

### Rate limits — chiffres officiels

- **15 req/min/IP** sur les lectures produit
- **10 req/min/IP** sur les recherches — la doc dit littéralement : « *don't use it
  for a search-as-you-type feature, you would be blocked very quickly* »
- Limites **globales** en plus, indépendantes de l'IP → **HTTP 503**
- Dépassement répété → **bannissement d'IP**

⚠️ Observé et **non documenté** : certaines recherches par catégorie rendent **503
pour les utilisateurs anonymes**, avec un message indiquant que les utilisateurs
enregistrés ne sont pas soumis aux limites.

### User-Agent — format documenté

> `AppName/Version (ContactEmail)` — ex. `MyApp/1.0 (myapp@example.com)`

Aucun rejet technique sans lui (une requête sans User-Agent a rendu 200), mais OFF
se réserve le blocage. Il contient une adresse de contact : **c'est une donnée à
placer en variable d'environnement serveur**, pas en dur dans le dépôt.

### Champs nutritionnels

`nutriments.proteins_100g`, `nutriments.carbohydrates_100g`, **`nutriments.fat_100g`**
(pas `lipids`). Pièges confirmés :

- `nutrition_data_per: "serving"` → les `_100g` sont **calculés** depuis
  `serving_size`, champ **texte libre** ; s'il n'est pas parsable, **les `_100g`
  peuvent manquer entièrement**.
- `no_nutrition_data: "on"` → `nutriments` quasi vide, cas « frequent (thousands of
  products) ».
- `nutriments_estimated` est un bloc **séparé** d'estimations. À ne jamais confondre
  avec `nutriments`.
- `product_quantity` et `serving_quantity` sont des **chaînes**, pas des nombres.
- Champ absent ≠ champ à 0.

→ Ton §13 est donc parfaitement calibré : le refus propre d'un produit incomplet
n'est pas un cas rare, c'est un cas **fréquent**.

### Licences OFF

| Objet | Licence |
|---|---|
| Base de données | **ODbL 1.0** |
| Contenus | DbCL 1.0 |
| Images | **CC BY-SA** (le lien officiel pointe la **3.0**) |

Attribution exigée : mention de la licence + « Open Food Facts » + **lien** vers
`https://openfoodfacts.org` ou vers la page produit. Obligation également pour les
œuvres dérivées, et clause *share alike*.

⚠️ Les « attribution guidelines » détaillées vivent sur le wiki OFF, actuellement
protégé par un anti-bot et illisible programmatiquement. À ouvrir dans un
navigateur si tu veux le wording recommandé au mot près.

---

## 6. CE QUE JE PROPOSE — ET LES QUATRE DÉCISIONS QUE J'ATTENDS

### Import Ciqual : dataset normalisé versionné

Parmi les trois stratégies que tu listes, **le dataset normalisé versionné dans le
dépôt** est la seule qui satisfasse tes cinq exigences simultanément.

| Exigence | Dataset versionné | Script depuis le fichier officiel |
|---|---|---|
| déterministe | ✅ octet pour octet | ❌ dépend de la disponibilité du site |
| rejouable | ✅ | ⚠️ |
| auditable | ✅ diff Git lisible | ❌ |
| sans téléchargement au build | ✅ | ❌ |
| traçable | ✅ SHA-256 du fichier source dans le manifeste | ✅ |

**Taille mesurée** : 3 385 lignes → **332 Ko en JSON**, **305 Ko en CSV**, 66 Ko
gzippé. Parfaitement versionnable.

Le script de génération (`scripts/ciqual/…`) reste dans le dépôt et est rejouable à
la main pour produire une future version, mais **la Production ne dépend jamais de
ciqual.anses.fr**. Le manifeste porte le SHA-256 du XLSX officiel, la date
d'extraction et le DOI — une régénération qui produirait un fichier différent se
verrait dans le diff.

L'import lui-même : une migration idempotente qui fait un `insert … on conflict
(source, source_ref) do update`, ce qui rend une future Ciqual 2027 capable de
corriger les aliments **sans jamais toucher aux `meal_entries` historiques** —
l'instantané A1 les en protège déjà, et `MEAL-A5` / `A2-DB10` le prouvent.

### Les quatre décisions

1. **L'alcool** (§3 ci-dessus) : **(a)** importer avec 0 kcal, **(b)** exclure les
   boissons alcoolisées — *ma recommandation*, ou **(c)** ajouter 7 kcal/g d'alcool
   au moteur, ce qui dépasse A3.

2. **Les valeurs `traces` et `< seuil`** (322 aliments concernés sur 3 385, soit
   9,5 %). Pour une macro « < 0,5 g », retenir 0,5 surestime, retenir 0 sous-estime.
   Je propose **`traces` → 0** et **`< X` → 0**, en conservant la chaîne brute en
   métadonnée : sous-estimer une trace de lipides est sans conséquence
   diététique, la surestimer systématiquement fausserait le total. Confirmes-tu ?

3. **Le périmètre du premier import.** 3 385 aliments d'un coup, ou un
   sous-ensemble des groupes réellement utiles (viandes/œufs/poissons 775,
   fruits/légumes 589, produits laitiers 353, céréaliers 213 = 1 930) ? Je
   recommande **tout importer** : le tri par pertinence se fait à la recherche, et
   un catalogue amputé se remarque tout de suite.

4. **Le contact du User-Agent OFF.** Quelle adresse veux-tu exposer dans
   `SETH/1.0 (contact)` ? Elle sera visible d'Open Food Facts. Je la mettrai en
   variable d'environnement serveur, jamais en dur.

### Ce que je ne ferai pas sans te redemander

- Aucun `db push`. La migration A3 portera un nouveau timestamp
  (`20260902090000_…`), ne réécrira ni A1 ni A2.
- Aucun rattachement produit → aliment (§17), `food_id` reste NULL.
- Aucune caméra, aucun `BarcodeDetector`, aucun Service Worker (§20).
- Aucun appel OFF depuis le navigateur.

---

## 7. ARCHITECTURE PROPOSÉE, EN UNE PAGE

```
                    ┌─────────────────────────────────────┐
   frappe  ────────▶│  recherche LOCALE, instantanée      │
                    │  food_catalog (Ciqual + coach)      │
                    │  + food_products déjà en cache      │
                    └─────────────────────────────────────┘
                                    │  rien de pertinent ?
                                    ▼
                    ┌─────────────────────────────────────┐
   [ RECHERCHER ]──▶│  route serveur SETH — EXPLICITE     │
   (clic, jamais    │  garde-fou anti-rafale              │
    la frappe)      └─────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  adaptateur OFF (un seul module)    │
                    │   lookup GTIN  → /api/v3.4/product  │
                    │   texte        → Search-a-licious   │
                    │   User-Agent SETH, timeout, 429/503 │
                    └─────────────────────────────────────┘
                                    │
                                    ▼
                    normalisation → refus si P/G/L inexploitables
                                    │
                                    ▼
                    cache food_products (TTL ~30 j)
                                    │
                                    ▼
                    RPC ajouter_aliment_produit (definer)
                                    │
                                    ▼
                    meal_entries · snapshot serveur · barre A2
```

La frontière est nette : **l'UI ne connaît que nos tables et nos RPC.** Le jour où
`/api/v3/search` existera, un seul module change.

---

*Aucune ligne de code A3 n'a été écrite. J'attends tes arbitrages sur les quatre
points du §6.*
