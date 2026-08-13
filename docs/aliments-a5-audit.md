# ALIMENTS A5 — AUDIT AVANT CODE

**Aucune ligne de code A5 écrite. Aucune migration créée.** Deux migrations sont
proposées en §7 et §8 ; j'attends ta validation.

Base de mesure : `feat/aliments-a5-food-experience` à `a5266df`, arbre propre.
Banc local : PostgreSQL 16 reconstruit depuis le baseline + les 70 migrations,
**3 330 aliments Ciqual 2025** réellement importés.

---

## 1. L'état réel du schéma

### `food_catalog` — 3 330 lignes actives, globales

`id · owner_coach_id · name · slug · nutrition_unit · protein/carb/fat_per_100 ·
piece_weight_g · status · source · source_ref · source_version`

`slug` est **généré en base** (`generated always as (food_slug(name)) stored`) —
c'est lui que la recherche interroge, et c'est ce qui fait marcher « pates » et
« oeuf ». Index : `slug` unique global, `(owner_coach_id, status)`,
`(source, source_ref)` unique.

### `food_products` — cache global, **lecture seule côté client**

`gtin` (text, unique) · macros NOT NULL · `nutrition_unit` · `source_payload` ·
`source_fetched_at` · `detail_fetched_at`. RLS : `select` pour tout
authentifié ; **`revoke insert/update/delete from authenticated`**. Le cache
n'est rempli que par le serveur.

### `meal_entries` — l'instantané, et **trois pointeurs de provenance**

`student_id · consumed_meal_id · source_type · recipe_id · food_id · product_id ·
label · quantity · unit · protein_g · carb_g · fat_g · created_at`

`source_type ∈ (recipe, catalog_food, product, free)`, un seul pointeur non nul à
la fois (contrainte par comptage). `consumed_on` et `slot_key` ont été **déplacés
vers `consumed_meals`** en A2 : une entrée n'a plus de date propre, seulement
`created_at`.

Index : `(consumed_meal_id)`, `(food_id) where not null`,
`(product_id) where not null`, `(recipe_id) where not null`.
**Aucun index sur `student_id`.** ← c'est le point qui décide du §7.

RLS : élève CRUD sur ses entrées, coach lecture seule sur ses élèves, admin tout.
Privilèges : `revoke all` puis `grant select, insert, update, delete`.

### `consumed_meals` — le conteneur, qui porte la date

`id · student_id · consumed_on · position · kind · label · slot_key ·
prescribed_meal_id`, unique `(id, student_id)`, index
**`(student_id, consumed_on, position)`**. La clé étrangère de `meal_entries` est
**composite** `(consumed_meal_id, student_id)` : une entrée ne peut pas
appartenir au repas d'un autre élève, et c'est la base qui le refuse.

---

## 2. La recherche locale actuelle

**Ciqual** (`searchCatalogFoods`) — deux requêtes parallèles sur le **slug** :
`slug like 'terme%'` limite 60, `slug like '%terme%'` limite 40 ; déduplication
par `id` ; puis `classerResultats` côté client.

**Produits** (`searchCachedProducts`) — `product_name ilike '%terme%'` limite 40
**+** `brand ilike '%terme%'` limite 20 ; dédup par `id` ; classement par nom,
puis les correspondances de marque **ajoutées à la suite, non classées**.

Le classement (`lib/nutrition/recherche-aliments.ts`) est déjà celui décrit au
§4 de ta spécification, à une exception près :

| rang | règle | ta liste |
|---|---|---|
| 0 | la **tête** du nom EST le terme | 1. nom exact |
| 1 | la tête COMMENCE par le terme | 2/3. commence par / mot entier |
| 2 | le nom complet commence par le terme | 4. slug commence par |
| 3 | le terme apparaît ailleurs | 5. occurrence |
| — | sinon : **écarté**, jamais classé dernier | 6. |

Départages, dans l'ordre : **mots de la tête**, longueur du nom, alphabétique,
identifiant. Entièrement déterministe.

---

## 3. LES ONZE REQUÊTES, MESURÉES AVANT MODIFICATION

Reproduction exacte du chemin réel (les deux requêtes slug, la déduplication, le
vrai `classerResultats`), sur les 3 330 lignes importées.

| requête | lignes contenant le terme | premiers résultats actuels |
|---|---:|---|
| **banane** | 7 | ✅ Banane, chair sans peau, crue · Banane, chair sans peau, sèche · Banane plantain, crue |
| **pomme** | 97 | ❌ **Pomme, sèche** · Pomme, chair et peau, crue · Pomme, chair sans peau, rôtie/cuite au four |
| **riz** | 46 | ⚠️ Riz, mélange de variétés (…), cru · Riz blanc, cru · Riz rouge, cru |
| **poulet** | 68 | ✅ Poulet, pilon cru · Poulet, viande crue · Poulet, cuisse, viande crue |
| **oeuf** | 137 | ❌ **Oeuf, en poudre** · Oeuf, blanc (blanc d'oeuf), cru · Oeuf, jaune (jaune d'oeuf), cru |
| **saumon** | 31 | ✅ Saumon, élevage, cru · Saumon, grillé/poêlé · Saumon, sauvage, cru |
| **avocat** | 2 | ✅ Avocat, chair sans peau, sans noyau, cru · Huile d'avocat |
| **pates** | 39 | ✅ Pâtes sèches, standard, crues · Pâtes sèches, aux oeufs, crues · … |
| **nutella** | **0** | — |
| **coca cola** | **0** | — |
| **skyr** | **0** | — |

### Ce que ça dit

**Le classement est déjà bon sur 6 requêtes sur 8.** Le problème est plus étroit
que « la recherche est mauvaise » — il est précis, et il a **une seule cause** :

> à rang égal et tête égale, c'est le **nom le plus court** qui gagne — et le nom
> le plus court est souvent une forme **transformée**.

« Pomme, sèche » (12 caractères) bat « Pomme, chair sans peau, crue (aliment
moyen) » (43). « Oeuf, en poudre » (15) bat « Oeuf, blanc (blanc d'oeuf), cru ».

**« riz » n'est pas un défaut.** Ton exigence — « un riz simple avant un plat
préparé » — est déjà tenue : « Riz cantonais, préemballé » est 6ᵉ. Le premier est
« Riz, mélange de variétés », qui est l'entrée **générique** de Ciqual pour le
riz. Discutable, mais pas faux. Je ne propose pas de le changer sans que tu le
demandes.

**« nutella », « coca cola », « skyr » ne sont pas des échecs** : ce sont des
produits commerciaux, ils n'existent pas dans Ciqual. L'écran affiche « Aucun
aliment trouvé dans le catalogue » et propose « Rechercher aussi les produits »
(action explicite, ≥ 3 caractères) et le scanner. **C'est le comportement voulu
depuis A3** — et c'est aussi ce qui rend les récents et les favoris utiles :
c'est le journal de l'élève qui les fera remonter, pas Ciqual.

---

## 4. CE QUE J'AI SIMULÉ POUR LE CLASSEMENT (et le piège évité)

Ciqual porte un marqueur explicite : **`(aliment moyen)`** — 163 lignes sur
3 330. C'est la désignation de l'Anses pour l'entrée **représentative** d'une
famille. Ce n'est pas une heuristique inventée : c'est la convention de la source.

**Premier essai — « aliment moyen » d'abord, juste après le rang.** Résultat
mesuré :

- « pomme » ✅ corrigé,
- « saumon » → « Saumon, cuit, sans précision (aliment moyen) » (acceptable),
- « pates » ❌ **CASSÉ** : « Pâtes fraîches farcies (ex : raviolis, tortellinis),
  cuites (aliment moyen) » passe devant « Pâtes sèches, standard, crues ».

**La cause** : cette entrée-là a une tête de 7 mots, la règle passait **avant** le
comptage des mots de la tête. Déplacée **après**, « pates » redevient correct.

C'est exactement le genre de règle qu'on aurait posée « parce qu'elle est
logique » et qui aurait dégradé un cas qui marchait. Elle a été mesurée avant
d'être proposée.

### Deux options mesurées, à ton choix

| requête | actuel | **A** — `(aliment moyen)` après les mots de tête | **B** — A + liste fermée de formes transformées |
|---|---|---|---|
| pomme | ❌ Pomme, sèche | ✅ Pomme, chair sans peau, crue (aliment moyen) | ✅ id. puis **Pomme, chair et peau, crue** |
| oeuf | ❌ Oeuf, en poudre | ❌ inchangé | ✅ **Oeuf, blanc (blanc d'oeuf), cru** |
| saumon | Saumon, élevage, cru | Saumon, cuit, sans précision (aliment moyen) | id. A |
| banane · riz · poulet · avocat · pates | ✅ | **inchangés** | **inchangés** |

**Option B** ajoute une liste **fermée et courte** de qualificatifs — `en poudre`,
`sèche/séché`, `déshydraté`, `appertisé`, `surgelé`, `fumé`, `confit`,
`au sirop`, `lyophilisé` — rétrogradés **à rang et tête égaux**, et **cherchés
uniquement dans les qualificatifs, jamais dans la tête**. C'est cette
distinction qui protège « Pâtes **sèches** » : là, « sèches » est l'aliment
lui-même, pas sa préparation.

**Je recommande B.** Elle corrige les deux seuls cas cassés, ne change rien
ailleurs, tient en une quinzaine de mots lisibles, et reste totalement
déterministe. Aucune migration : c'est du code client pur, dans un module déjà
éprouvé.

---

## 5. Accents, apostrophes, tirets, pluriels — rien à ajouter

`food_slug` en base et `normaliserPourRecherche` côté client font la même chose :
NFD + retrait des diacritiques, ligatures `œ → oe` / `æ → ae` à la main,
puis tout ce qui n'est ni lettre ni chiffre devient une séparation.

Mesuré : « pates » → 39 aliments (0 par le nom), « oeuf » → 137 (ligature `Œ`
comprise), « coca cola » → slug `coca-cola`. **Le slug suffit, il est réutilisé,
aucune bibliothèque linguistique n'est nécessaire.**

Les pluriels simples ne sont **pas** gérés (« bananes » ne trouve rien de plus
que « banane », puisque `like '%banane%'` matche déjà). Un `s` final optionnel
serait un ajout d'une ligne — je ne le propose pas sans que tu le demandes,
parce qu'il faudrait mesurer les faux positifs.

---

## 6. Produits commerciaux et dédoublonnage — le constat

**Ranking (§6).** L'ordre actuel est : toutes les correspondances de **nom**
classées, **puis** les correspondances de **marque** ajoutées telles quelles.
Ta liste veut la marque exacte **avant** une simple occurrence dans le nom. C'est
un écart réel, et il se corrige dans le classement, sans toucher à la requête ni
à Search-a-licious.

**Dédoublonnage (§7).** L'identité est **déjà** l'identifiant `food_products.id`,
et le GTIN est unique dans la table. Un produit remonté par la recherche externe
est **écrit en cache avant d'être rendu** : il ressort donc avec le **même `id`**
que sa version locale, et les deux déduplications existantes (`new Map` par `id`
dans `searchCachedProducts`, `fusionnerProduits` par `id`) le couvrent.

Autrement dit : **A5 n'a probablement rien à corriger ici, seulement à le
PROUVER.** Deux GTIN différents restent deux produits — aucune fusion par nom
ressemblant n'existe, et je n'en ajouterai pas.

---

## 7. ⏸ MIGRATION 1 — l'index des récents (**décision demandée**)

### Le constat

Les récents **peuvent être dérivés de `meal_entries`** : `source_type`, `food_id`,
`product_id`, `created_at` et le lien vers `consumed_meals` suffisent.
**Aucune table n'est nécessaire, et je n'en propose pas.**

Mais `meal_entries` **n'a aucun index sur `student_id`**. Banc de mesure : 30
élèves × 180 jours × 4 repas × 3 entrées = **21 600 repas, 64 800 entrées**.

| forme de requête | plan réel | temps | buffers |
|---|---|---:|---:|
| (a) `where student_id = X order by created_at desc` | **seq scan** 64 800 lignes | 7,9 ms | 926 |
| (b) jointure via `consumed_meals`, bornée à 60 jours | **seq scan** + hash join | 10,8 ms | 994 |
| (b2) la même, boucle imbriquée forcée | index + index | 2,0 ms | 806 |
| (c) `distinct on` **avec** un index `(student_id, created_at desc)` | index | 2,3 ms | — |
| **(d) « les 200 dernières entrées », avec ce même index** | **index seul** | **0,23 ms** | **303** |

**Deux enseignements mesurés, pas supposés :**

1. Passer par `consumed_meals` **ne suffit pas** : le planificateur a choisi un
   *hash join* et a quand même parcouru toute la table (10,8 ms). Compter sur
   l'index du conteneur aurait été une supposition fausse.
2. Avec un seul index, la forme (d) est **34× plus rapide que (a)** et lit **3×
   moins de blocs** — et c'est la forme naturelle : on prend les 200 dernières
   entrées de l'élève, on déduplique côté client, on garde 8 à 12.

Sans cet index, **chaque ouverture de la feuille d'ajout parcourt la table
entière de TOUS les élèves**. À 64 800 lignes c'est 8 ms ; ça croît linéairement,
et ça se dégrade sans que rien ne le signale.

### Ce que je propose

```sql
create index if not exists meal_entries_student_recent_idx
  on public.meal_entries (student_id, created_at desc);
```

- **Aucune table, aucune colonne, aucune donnée modifiée.** Un index, un seul.
- **Conséquences** : +1 index à maintenir sur les écritures du journal (une
  insertion par aliment ajouté — négligeable), et l'espace disque d'un index à
  deux colonnes.
- **RLS / privilèges** : inchangés. Un index ne change aucun droit.
- **Réversible** : `drop index`.

**Alternative si tu préfères zéro migration** : garder la forme (b2) en espérant
le bon plan — je ne la recommande pas, la mesure montre que le planificateur ne
la choisit pas spontanément.

---

## 8. ⏸ MIGRATION 2 — les favoris (**décision demandée**)

### État actuel

**Il n'existe aucune notion de favori dans le schéma.** Aucune table, aucune
colonne, aucun champ JSON détourné. Rien à migrer, tout à créer.

Un favori doit **persister entre sessions et appareils** : il ne peut donc pas
vivre en `localStorage`. Une petite table est la bonne réponse, et c'est aussi
la tienne.

### Le schéma proposé

Ta forme conceptuelle est bonne. J'y ajoute **trois durcissements**, chacun pour
une raison précise.

```sql
create table if not exists public.food_favorites (
  id uuid primary key default gen_random_uuid(),

  student_id      uuid not null references public.students (id)      on delete cascade,
  catalog_food_id uuid          references public.food_catalog (id)  on delete cascade,
  product_id      uuid          references public.food_products (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- ① EXACTEMENT UNE CIBLE PAR LIGNE. Écrit par comptage, comme
  --    meal_entries_source_unique en A3 : l'intention reste lisible si une
  --    troisième cible arrivait un jour.
  constraint food_favorites_cible_unique check (
    (case when catalog_food_id is null then 0 else 1 end)
    + (case when product_id      is null then 0 else 1 end) = 1
  )
);

-- ② UNICITÉ ÉLÈVE + CIBLE. Deux index partiels plutôt qu'un index sur
--    (student_id, catalog_food_id, product_id) : en SQL, NULL n'est pas égal à
--    NULL, et un index unique à trois colonnes laisserait donc passer autant de
--    doublons qu'on veut. C'est le piège classique, et il est silencieux.
create unique index if not exists food_favorites_food_unique
  on public.food_favorites (student_id, catalog_food_id) where catalog_food_id is not null;
create unique index if not exists food_favorites_product_unique
  on public.food_favorites (student_id, product_id)      where product_id      is not null;

-- ③ L'INDEX DE LECTURE. La seule requête de l'écran est « mes favoris, les plus
--    récents d'abord ».
create index if not exists food_favorites_student_idx
  on public.food_favorites (student_id, created_at desc);
```

**Pourquoi `on delete cascade` sur les cibles, et pas `set null` comme
`meal_entries` ?** Parce que la nature de l'objet est inverse. Une entrée du
journal est un **instantané** : elle doit survivre à la disparition de sa source,
sinon on réécrit l'histoire. Un favori est un **raccourci vers une source
vivante** : si l'aliment disparaît, le raccourci ne pointe plus sur rien, et le
garder produirait une ligne dont la contrainte ① serait d'ailleurs violée.
`cascade` est ici le comportement correct — et `food_products` est un cache, dont
les lignes peuvent légitimement disparaître.

### RLS et privilèges

```sql
alter table public.food_favorites enable row level security;

-- L'ÉLÈVE : CRUD complet, sur SES favoris, et rien d'autre.
create policy "food_favorites_crud_own_student" on public.food_favorites
  for all to authenticated
  using      (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

-- L'ADMINISTRATEUR : accès global, comme partout dans ce schéma.
create policy "food_favorites_manage_admin" on public.food_favorites
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ⚠️ PAS DE POLICY COACH. Tu as écrit « le coach n'a pas besoin de modifier les
--    favoris de l'élève ». Je vais plus loin : il n'a pas besoin de les LIRE non
--    plus. Les favoris d'un élève sont une préférence personnelle, pas une
--    donnée de suivi — le coach voit déjà le journal, qui est le fait.
--    Une policy de lecture s'ajoute en une ligne le jour où tu la veux ;
--    l'inverse est une donnée déjà exposée.

revoke all on table public.food_favorites from public;
revoke all on table public.food_favorites from anon;
revoke all on table public.food_favorites from authenticated;
grant select, insert, delete on table public.food_favorites to authenticated;
grant all    on table public.food_favorites to service_role;
```

**Pourquoi pas d'`update`** : un favori n'a rien à modifier. On l'ajoute, on le
retire. Le retirer du vocabulaire de privilèges rend impossible qu'un jour
quelqu'un déplace un favori d'un élève vers un autre par `update student_id`.
C'est la même logique que le `revoke` de `food_products` en A3 : **une policy dit
quelles lignes, jamais quelles valeurs.**

### RPC

**Aucune.** Et c'est délibéré, contrairement à A2/A3.

Les RPC d'A2 et d'A3 existaient parce que le serveur devait **calculer** quelque
chose que le client n'a pas le droit de décider — les macros d'un instantané.
Un favori ne calcule rien : c'est une ligne à deux colonnes utiles. La RLS et les
privilèges suffisent, et une RPC en plus serait une surface à maintenir sans
contrepartie.

### Conséquences

- **Nouvelle table**, 4 colonnes utiles, 3 index. Volume attendu : quelques
  dizaines de lignes par élève.
- **Aucune table existante modifiée.** Aucune donnée touchée. Aucun `db push`
  tant que tu ne le demandes pas.
- **Réversible** : `drop table public.food_favorites`.
- Horodatage du fichier : **après** `20260904090000_food_products_hydratation.sql`,
  donc `20260905090000_food_favorites.sql`.

### Tests prévus pour cette migration

| | |
|---|---|
| A5-5 | un favori `catalog_food` persiste (relecture après écriture) |
| A5-6 | un favori `product` persiste |
| A5-7 | l'élève B ne voit **pas** les favoris de l'élève A (RLS, exécutée) |
| A5-8 | cible invalide **refusée par la base** : zéro cible, deux cibles |
| A5-8b | doublon élève+cible **refusé** (et le contrôle négatif prouve que l'index à trois colonnes, lui, l'aurait laissé passer) |
| A5-9 | retirer un favori fonctionne, et ne touche pas ceux des autres |
| — | `update` **refusé par privilège**, vérifié par `has_table_privilege` |

---

## 9. Structure d'`AddFoodSheet` — ce qu'A5 va toucher

Deux onglets (RECHERCHER / SAISIR À LA MAIN), et dans le premier : champ de
recherche → bouton **SCANNER UN CODE-BARRES** → listes Aliments / Produits →
action externe → sortie manuelle → attribution.

L'insertion d'A5 est **au-dessus du bouton scanner, quand le champ est vide** :

```
[ Rechercher un aliment            ]
FAVORIS      ← si l'élève en a
RÉCENTS      ← si l'élève en a
[ SCANNER UN CODE-BARRES ]
[ Saisir un aliment à la main ]
```

Dès que l'élève tape, les deux sections cèdent la place aux résultats.

**A4 n'est pas touché** : ni le moteur, ni la caméra, ni le GTIN, ni le pipeline,
ni la torche, ni le cycle de vie. Le tap sur un favori ou un récent réutilise
`ouvrirQuantitéProduit` / le chemin catalogue existants — **aucune nouvelle
logique d'ajout**, donc `ajouter_aliment_catalogue` et `ajouter_aliment_produit`
inchangées, et l'hydratation A3 déclenchée par `doitHydrater` comme aujourd'hui.

---

## 10. Ce sur quoi j'attends ta décision

| | question | ma recommandation |
|---|---|---|
| **1** | Classement Ciqual : **option A** ou **option B** ? | **B** (corrige pomme *et* oeuf, ne casse rien) |
| **2** | Index `meal_entries (student_id, created_at desc)` — migration 1 ? | **oui** (34× mesuré, aucune donnée touchée) |
| **3** | Table `food_favorites` telle que proposée — migration 2 ? | **oui**, avec les deux index partiels et sans policy coach |
| **4** | « riz » : garder « Riz, mélange de variétés » en tête ? | **garder** (c'est l'entrée générique Ciqual, et ton exigence est déjà tenue) |
| **5** | Pluriels simples (« bananes ») | **ne pas faire** en V1 sans mesure des faux positifs |

Dès que tu tranches, j'écris les migrations, le code et les 25 tests A5.
**Rien ne sera poussé en base : pas de `db push`, pas de commit, pas de merge.**

---

# ADDENDUM — A5.6 : RÉSUMÉ NUTRITIONNEL VISUEL PAR JOUR

Audité dans la foulée, avant toute ligne de code. **Conclusion courte : aucune
migration, aucune nouvelle source de vérité — tout existe déjà.**

## A. La source `{ consumed, target }` existe, et elle est déjà branchée

Ton §3 demande de ne rien recalculer depuis les composants React. C'est déjà le
cas, et voici la chaîne exacte :

| | d'où ça vient | forme |
|---|---|---|
| **consommé** | `totalsForDay(repasDuJour)` — `lib/nutrition/consumed.ts` | `MacroTotals { proteinG, carbG, fatG, kcal }` |
| **objectif** | `dailyTargetsForDay(week, jour)` — `lib/nutrition/plan-v2-week.ts` | `.calories.totalCalories`, `.grams.{protein,carb,fat}Grams` |

Les deux alimentent déjà `DailyIntakeSummary` (Objectif · Consommé · Restant),
dans `StudentPrescribedWeek`. Le nouveau bloc visuel **consomme exactement les
mêmes deux objets** — il n'ajoute aucun calcul, il change la représentation.

`kcal` vient de `kcalFromMacros` (4/4/9), qui est le **miroir exact** de la
fonction SQL `consommation_du_jour` — un test vérifie déjà que les deux rendent
la même valeur. Il n'y aura donc pas deux vérités.

⚠️ **Un piège à éviter, déjà présent dans le code** : les objectifs d'un jour
viennent du **profil du jour**, pas d'une moyenne hebdomadaire. Un commentaire
existant signale qu'une version antérieure affichait la même moyenne pour les
sept jours. Le carrousel doit lire `dailyTargetsForDay(week, jourAffiché)` à
chaque changement de jour, jamais une valeur figée au montage.

## B. Ce qui existe aujourd'hui, et qui va changer

L'écran rend les **sept jours en grille** (`grid-cols-1 lg:grid-cols-2`), tous
dépliés, sans notion de « jour courant ». Sur iPhone, cela fait sept cartes
empilées et l'élève scrolle pour trouver aujourd'hui.

`datesParJour` (dérivé de `getCurrentWeekDates()`) donne déjà la date réelle de
chaque jour de la semaine : **identifier aujourd'hui ne demande aucune donnée
nouvelle**, seulement une comparaison.

## C. Aucune migration — et pourquoi j'en suis sûr

- Pas de nouvelle table : rien n'est stocké, tout est dérivé.
- Pas de nouvelle colonne : `consumed_on` porte déjà la date, `meal_entries`
  porte déjà l'instantané.
- Pas de nouvelle RPC : `consommation_du_jour` existe et n'est même pas
  nécessaire ici, puisque les entrées de la semaine sont déjà chargées.
- **Changer de jour affiché ne touche rien** : c'est un état local. Aucune
  écriture, aucun `consumed_on` modifié, aucun repas déplacé. C'est ce que
  A5-DAY2 et A5-DAY3 mesureront.

## D. Ce que je compte écrire

Quatre composants, aucune dépendance graphique :

| composant | rôle |
|---|---|
| `CalorieRing` | SVG `<circle>` + `strokeDasharray`/`strokeDashoffset` |
| `MacroProgressBar` | une barre, un libellé, `consommé / cible` |
| `DailyNutritionProgress` | assemble le cercle et les trois barres |
| `NutritionDayCarousel` | `scroll-snap` + `overflow-x` + `scrollIntoView` |

**Le plafonnement ne concerne QUE le visuel.** `visualProgress = min(max(ratio,
0), 1)` pour la géométrie ; le texte affiche toujours la vraie consommation, et
le dépassement est écrit. C'est la règle qu'`DailyIntakeSummary` applique déjà
au « restant » négatif, et A5-DAY5/DAY6 la mesureront.

**Division par zéro** : `target > 0 ? consumed / target : 0`, et un état neutre
« Aucun objectif prescrit » — le composant actuel a déjà ce cas
(`objectif: MacroTotals | null`). Aucun `NaN`, aucun `Infinity` : A5-DAY14.

**Les règles de calcul iront dans un module pur** (`lib/nutrition/progression.ts`),
pas dans le JSX — pour la même raison qu'en A3 et A4 : le dépôt n'a ni jsdom ni
bibliothèque de test DOM, et une règle écrite dans un `style={{}}` ne serait
éprouvée que par relecture.

## E. Ce que ça ne fera pas

Pas de dashboard coloré. Le cercle reprend les jetons SETH existants
(`border`, `primary`, `muted-foreground`), il est sobre, et la hiérarchie reste
CALORIES → P/G/L → REPAS. Aucune bibliothèque de carrousel.

## F. Décision demandée pour A5.6

**Aucune** — il n'y a rien à valider en base. Dis-moi seulement si tu veux que je
l'enchaîne **après** A5 (récents/favoris/classement) ou **avant**, puisque les
deux touchent le même écran.

## G. Couleurs des macros (demandé le 13/08) — rouge · vert · jaune

| macro | couleur demandée | jeton SETH existant | clair | sombre |
|---|---|---|---|---|
| Protéines | rouge | `--destructive` | `#dc2626` | `#f87171` |
| Glucides | vert | `--success` | `#16a34a` | `#4ade80` |
| Lipides | jaune | `--warning` | `#d97706` | `#fbbf24` |

**Aucune couleur nouvelle n'est introduite** : les trois jetons existent déjà,
avec leur variante claire ET sombre. Les barres suivront donc automatiquement le
thème, et resteront cohérentes avec le reste de l'application.

⚠️ **Deux points d'attention, à trancher en même temps que le reste.**

1. **`--destructive` veut dire « erreur » ailleurs dans l'application** — c'est la
   couleur des messages d'échec et du dépassement dans `DailyIntakeSummary`. En
   l'utilisant pour les protéines, une barre de protéines pleine deviendra rouge
   sans que rien n'aille mal. Je le signale, je ne le corrige pas de moi-même :
   c'est ton choix de design.
2. **Le cercle des calories reste SOBRE** — jeton `primary`, pas une quatrième
   couleur. La hiérarchie que tu as demandée (CALORIES principale, P/G/L
   secondaires) tient justement à ce que le cercle ne soit pas coloré comme les
   barres.

Le dépassement reste signalé par le TEXTE (`72 / 65 g`), pas par un changement de
couleur : sinon une barre de lipides jaune deviendrait rouge et se confondrait
avec les protéines.
