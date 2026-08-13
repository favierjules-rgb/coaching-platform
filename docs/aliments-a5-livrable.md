# ALIMENTS A5 — LIVRABLE

**Livré, non commité. Aucun `db push`. Aucun merge.**
Branche `feat/aliments-a5-food-experience`, HEAD `a5266df`, arbre de travail
seul. Base locale reconstruite de zéro (baseline + **72** migrations), les
3 330 aliments Ciqual intacts.

---

## 1. Les deux migrations — appliquées et éprouvées sur une base réelle

| fichier | ce qu'il fait |
|---|---|
| `20260905090000_meal_entries_student_recent_index.sql` | **un index**, `meal_entries (student_id, created_at desc)` |
| `20260905090100_food_favorites.sql` | la table `food_favorites`, 3 index, 2 policies, privilèges |

**Aucune table de récents** : ils restent DÉRIVÉS de `meal_entries`.

### Ce que la checklist SQL a réellement exécuté

`supabase/tests/aliments_a5_favoris_checklist.sql` — **30 contrôles, 0 échec**,
sur une base reconstruite, avec deux élèves **du même coach** (le cas le plus
exigeant : deux élèves de coachs différents seraient isolés par accident, et le
contrôle passerait sans rien prouver) et les rôles réellement endossés via
`set local role authenticated` + `request.jwt.claims`.

- **A5-5 / A5-6** — un favori aliment et un favori produit s'écrivent et se relisent.
- **A5-7** — l'élève B **ne voit aucun** favori de A, ne peut pas en écrire à son
  nom, et son `delete` ne touche rien ; les favoris de A **survivent** à la
  tentative.
- **A5-8** — zéro cible, deux cibles et une cible inexistante sont **refusées par
  la base**.
- **A5-8b** — le doublon est refusé. Et le contrôle négatif construit la table
  jumelle avec l'index NAÏF à trois colonnes : **il accepte le doublon**. C'est
  la preuve, pas l'affirmation, que les index partiels sont nécessaires.
- **A5-9** — retirer un favori fonctionne, et le remettre aussi.
- **A5-SUP** — `has_table_privilege('authenticated', …, 'update')` est **faux**,
  et un `update` échoue réellement ; `anon` n'a rien ; le **coach ne voit rien**,
  et aucune policy ne le nomme.
- **A5-SUP** — supprimer l'aliment **emporte le favori** (`cascade`) et
  **n'emporte jamais** l'instantané du journal (`set null`, `protein_g` intact).
  Les deux comportements opposés, vérifiés dans la même transaction, parce que
  c'est leur différence qui compte.

### Les trois durcissements, et pourquoi

1. **Contrainte par comptage, `= 1` et non `<= 1`.** Un instantané d'A1 peut
   perdre son pointeur et rester valide ; un raccourci sans destination, non.
2. **Deux index uniques PARTIELS.** En SQL, `NULL` n'est jamais égal à `NULL` :
   un index `(student_id, catalog_food_id, product_id)` verrait deux lignes
   `(élève, banane, NULL)` comme différentes et laisserait l'élève poser le même
   favori autant de fois qu'il tape sur l'étoile — **sans erreur, sans symptôme**.
3. **Aucun privilège `UPDATE`.** Une policy dit quelles LIGNES, jamais quelles
   VALEURS. Retirer le verbe rend structurellement impossible un
   `update student_id` qui déplacerait un favori d'un élève à un autre.

**Aucune RPC.** A2 et A3 en ont parce que le serveur doit calculer des macros ;
un favori ne calcule rien.

---

## 2. Les récents — dérivés, et l'index qui les rend gratuits

`lib/nutrition/recents.ts` (règles pures) + `listerRecents` (3 requêtes bornées).

- **Déduplication par identité**, jamais par libellé. Un aliment mangé trois fois
  cette semaine apparaît **une** fois, à la place de son dernier ajout.
- **Les aliments saisis à la main sont exclus**, et c'est une décision : deux
  « Sandwich maison » saisis à deux semaines d'écart sont deux textes libres, pas
  deux occurrences du même aliment. Les recettes aussi — elles ont une identité,
  mais l'écran d'ajout ne sait pas les ajouter, et un raccourci qui n'aboutit à
  rien est pire que son absence.
- **Filtre posé EN BASE** (`.in("source_type", …)`), fenêtre bornée à 200 entrées,
  12 récents affichés.
- **Trois requêtes, jamais une par aliment** : les 200 dernières entrées, puis
  deux `in (…)` d'au plus 12 identifiants. Une liste vide ne déclenche **aucune**
  requête.
- **La SOURCE est rechargée, pas l'instantané.** `meal_entries` porte les macros
  *consommées* — 250 g de riz, pas les valeurs pour 100 g. Réafficher un récent
  depuis son instantané ouvrirait une étape quantité fausse.

### Le gain, mesuré

| forme | plan | temps | blocs |
|---|---|---:|---:|
| `where student_id` **sans** index | seq scan 64 800 lignes | 7,9 ms | 926 |
| jointure via `consumed_meals` (plan choisi) | **seq scan** + hash join | 10,8 ms | 994 |
| **200 dernières entrées, avec l'index** | index seul | **0,23 ms** | **303** |

Le deuxième cas est le plus instructif : passer par le conteneur **ne suffisait
pas**, le planificateur parcourait quand même toute la table. C'était une
supposition, elle a été testée, elle était fausse.

---

## 3. Le classement — option B, mesurée avant et après

| requête | avant A5 | après A5 |
|---|---|---|
| **pomme** | ❌ Pomme, **sèche** | ✅ Pomme, chair sans peau, crue *(aliment moyen)* |
| **oeuf** | ❌ Oeuf, **en poudre** | ✅ Oeuf, blanc (blanc d'oeuf), cru |
| banane · riz · poulet · saumon · avocat · **pates** | ✅ | **inchangés** |

Deux départages ajoutés, **après** le comptage des mots de la tête :

1. **`(aliment moyen)`** — la désignation de l'Anses pour l'entrée
   représentative, 163 lignes sur 3 330. Pas une heuristique maison.
2. **Une liste fermée de 17 formes transformées**, cherchée **uniquement dans les
   qualificatifs, jamais dans la tête**. C'est cette distinction qui protège
   « Pâtes **sèches** » : là, « sèches » est l'aliment, pas sa préparation. Le
   même mot, deux natures, séparées par sa position dans le nom Ciqual.

⚠️ **L'ordre des départages n'est pas décoratif.** Placée juste après le rang, la
règle « aliment moyen » corrigeait « pomme » et **cassait « pates »** — les pâtes
farcies passaient devant les pâtes sèches. Mesuré avant d'être proposé, corrigé
avant d'être écrit.

**« riz » n'a pas été touché**, comme décidé : l'entrée générique Ciqual reste en
tête, et les plats préparés restent derrière les riz simples.

**Pluriels : non**, comme décidé. Normalisation et slugs inchangés.

---

## 4. Produits — marque et dédoublonnage

**Cinq rangs** (`rangProduit`) : nom exact · nom commence par · **marque exacte
ou commence par** · occurrence dans le nom · occurrence dans la marque.

Avant A5, les correspondances de marque étaient ajoutées **à la suite** de toutes
les correspondances de nom : un produit de la marque exactement cherchée passait
derrière un produit dont le nom contenait vaguement le terme. Le rang 2 le
corrige. **Search-a-licious n'est pas touché** ; la recherche externe reste une
action explicite.

**Dédoublonnage par IDENTITÉ, et rien d'autre** : `id`, plus le `gtin` en second
filet. Aucune comparaison de nom — un contrôle le vérifie sur le source.
**Deux GTIN différents restent deux produits** : « Yaourt nature 500 g » et
« Yaourt nature 1 kg » ont deux fiches, parfois deux compositions, et les
confondre ferait consommer les macros de l'un sous l'étiquette de l'autre —
définitivement, puisqu'un instantané ne suit jamais sa source.

---

## 5. L'écran — favoris, récents, et rien de cassé

```
Ajouter un aliment
├─ RECHERCHER
│   [ Rechercher un aliment            ]
│   FAVORIS          ← si l'élève en a
│   RÉCENTS          ← si l'élève en a
│   [ ⌗ SCANNER UN CODE-BARRES ]
│   … résultats, action externe, saisie manuelle
└─ SAISIR À LA MAIN
```

- **Toujours deux onglets.** Le scan et les raccourcis sont des manières de
  RETROUVER un aliment, pas des façons d'en ajouter un.
- **Une section vide n'est pas rendue** — pas un titre suivi d'un blanc, qui
  donnerait l'impression d'un écran cassé au premier jour.
- **Dès que l'élève tape**, les deux sections cèdent la place aux résultats.
- **L'étoile apparaît aussi dans les résultats de recherche** (§8), avec la
  bonne cible — un aliment n'est pas un produit. C'est un **bouton à part** : un
  bouton dans un bouton n'est pas du HTML valide, et taper l'étoile ne doit pas
  ouvrir l'étape quantité.
- **Mise à jour immédiate** : l'étoile change avant la réponse du réseau, et est
  remise comme elle était si l'écriture échoue. Un doublon (23505) est traité
  comme un **succès** — du point de vue de l'élève, l'aliment EST en favori.
- **Le tap sur un raccourci n'ajoute aucune logique** : un aliment ouvre l'étape
  quantité, un produit passe par `choisirProduit`, donc par **l'hydratation A3**
  si sa fiche n'a jamais été chargée. Un produit mis en favori après une
  recherche texte a pu arriver sans son unité réelle — le consommer tel quel
  écrirait 250 g là où il y avait 250 ml.

**A4 n'a pas été touché** : ni le moteur, ni la caméra, ni le GTIN, ni le
pipeline, ni la torche, ni le cycle de vie. Un contrôle vérifie qu'aucun fichier
de `lib/scan/` ne contient le mot « favori » ou « récent ».

---

## 6. A5.6 — le résumé visuel

Quatre composants, **aucune dépendance graphique**, aucune bibliothèque de
carrousel :

| | |
|---|---|
| `CalorieRing` | SVG `<circle>`, `strokeDasharray` / `strokeDashoffset`, `rotate(-90)` pour partir du haut |
| `MacroProgressBar` | une barre, un libellé, `consommé / cible` |
| `DailyNutritionProgress` | assemble le cercle et les trois barres |
| `NutritionDayCarousel` | `scroll-snap` + `overflow-x-auto` + `scrollTo` |

**Aucune nouvelle source de vérité.** Le bloc reçoit `totalsForDay(repasDuJour)`
et `dailyTargetsForDay(week, jour)` — les mêmes objets que `DailyIntakeSummary` —
et n'en fait qu'une géométrie. Un contrôle vérifie qu'aucun `* 4`, `* 9`,
`kcalFromMacros` ni `KCAL_PER_GRAM` n'apparaît dans le composant : une troisième
implémentation du 4/4/9, à côté de `kcalFromMacros` et de `consommation_du_jour`,
finirait par diverger.

**Le plafonnement ne concerne QUE le dessin.** `part` est borné à [0, 1] ;
`consomme` et `cible` ne sont jamais touchés. `1 950 / 1 800` reste écrit,
`+150 kcal` est affiché. Trois tests séparés gardent cette règle.

**Couleurs — décision du §7 appliquée.** Les trois barres partagent la **même**
couleur, celle du texte principal ; leur distinction se lit dans leur libellé.
`destructive` ne sert **qu'à** signaler un dépassement réel — un test compare les
classes des trois barres et vérifie qu'elles sont identiques hors dépassement.
Le cercle reste sobre : jeton `primary`, pas une quatrième couleur.

**Changer de jour ne change QUE le jour affiché.** Le carrousel n'a aucune
fonction d'écriture, ne reçoit ni repas ni entrées, et ne connaît pas Supabase —
c'est structurel, vérifié sur son source, pas promis en commentaire.

**Aujourd'hui par défaut**, nommé « Aujourd'hui » et pas seulement mis en gras.
La date du jour est **injectée** depuis la page, jamais lue dans le rendu : une
horloge lue pendant le rendu diffère entre serveur et client autour de minuit.
La comparaison se fait sur des **chaînes** `YYYY-MM-DD`, jamais sur des `Date` —
à 23 h en heure d'été, `new Date("2026-08-13")` interprété en UTC répond « non »
à la question « le 13 août est-il le 13 août ? ».

Une semaine passée n'a pas d'« aujourd'hui » : on retombe sur le premier jour,
jamais sur `-1` — cet index pilote un défilement.

**Aucun `NaN`, aucun `Infinity`** : objectif nul, absent, négatif, `NaN` ou
`Infinity` donnent tous « aucun objectif » et une part de 0. Un `NaN` dans
`stroke-dashoffset` effacerait le cercle entier sans message d'erreur.

---

## 7. Tests

| suite | résultat |
|---|---|
| `npm run test:aliments-a5` | **26/26** — A5-1 à A5-25 + suppléments |
| `npm run test:aliments-a5-jour` | **16/16** — A5-DAY1 à A5-DAY15 + supplément |
| checklist SQL favoris, **exécutée** | **30 contrôles, 0 échec** |

### Trois pièges rencontrés en écrivant ces harnais

1. **Le séparateur de milliers n'est pas une espace.** `formatIntegerFr(1420)`
   rend « 1 420 » avec une **espace insécable** (U+00A0). Six tests étaient
   rouges sur un affichage parfaitement correct. Corrigé en comparant à la
   sortie du **même** formateur que le composant.
2. **La prose de la migration, 9ᵉ occurrence.** L'assertion « aucun index unique
   à trois colonnes » échouait sur le commentaire qui écrit cet index pour
   expliquer pourquoi il serait faux. Le SQL est dépouillé, et un contrôle
   négatif vérifie que la prose en parle bien.
3. **La prose d'une migration A3, 10ᵉ occurrence.** Le garde-fou A3-SEARCH
   cherchait « Search-a-licious » dans les migrations ; il le trouvait dans un
   commentaire `--`. `sansProse` ne retirait que les commentaires JavaScript.

### Contrôles négatifs — 8, tous discriminants, tous restaurés

| | sabotage | constaté |
|---|---|---|
| N25 | récents non dédupliqués | A5 **1 rouge** |
| N26 | ordre des récents inversé | A5 **2 rouges** |
| N27 | policy coach ajoutée | A5 **1 rouge** |
| **N27bis** | **la même, éprouvée SUR LA BASE** | **checklist SQL 2 rouges** — « le coach ne voit aucun favori » et « aucune policy coach » |
| N28 | doublon de même GTIN accepté | A5 **2 rouges** |
| N29 | rang exact derrière une occurrence faible | A5 **2 rouges** |
| N30 | ligature `œ` non traitée | A5 **1 rouge** |
| N31 | scanner A4 retiré de la feuille | A5 **3 rouges** |
| N32 | objectifs coach altérés par le résumé | A5-DAY **4 rouges** |

Restauration vérifiée par `diff -r` sur `lib/`, `components/student/` et
`supabase/migrations/` : **identiques**. Base reconstruite et checklist
re-exécutée après N27bis : **30/0**.

---

## 8. Non-régression

| | |
|---|---|
| Batterie complète | **92 suites, 2 143 tests verts, 31 rouges** |
| `tsc --noEmit` | **0 erreur** |
| `eslint` (arbre entier) | **0 erreur, 0 avertissement** |
| `git diff --check` | **propre** |
| `git status --short` | 20 modifiés, 12 non suivis — le delta exact |

**Les 31 rouges sont EXACTEMENT ceux d'avant A5** — mêmes suites, mêmes noms,
même nombre : les 24 de la baseline `3ed5cfa`, plus les 7 de
`webhook-idempotency` (le faux client du harnais n'expose pas `.rpc`), prouvés
antérieurs par exécution. **Aucune nouvelle régression.**

### Six suites sont passées au rouge en cours de route, et c'était le but

Ajouter deux migrations a fait rougir `security-hardening`, `coach-reply-video`,
`student-feedback-video`, `student-feedback-video-retention`,
`training-movement-patterns` et `aliments-a1`. **C'est exactement leur raison
d'être** : le dépôt croise le compteur de migrations dans **neuf fichiers** et le
manifeste du bootstrap, pour qu'une migration ne puisse pas apparaître sans
passer par la procédure. Les deux migrations ont donc été **déclarées au
manifeste** (43 → 45) et les compteurs mis à jour (70 → 72), partout.

### Trois garde-fous resserrés, aucun supprimé

- **`aliments-a2` / A2-UI2** comparait tout le HTML précédant la frontière
  « Ce que j'ai mangé » — le résumé visuel s'y trouve désormais, et il change
  quand un aliment est ajouté : c'est sa raison d'être. La comparaison démarre
  **après lui**, et une assertion **supplémentaire** vérifie que l'en-tête du
  jour — qui porte les objectifs du coach — ne bouge pas non plus.
- **`aliments-a3-ui` / A3-UI3** comptait deux « Aliment générique » ; il y en a
  trois depuis que les raccourcis en affichent. L'exigence est inchangée :
  partout où un aliment générique est montré, il est identifiable comme tel.
- **`aliments-a3-search`** exigeait qu'aucune migration ne soit postérieure à la
  phase 4.1 — **cinquième fois** qu'un contrôle décrit le périmètre d'une phase
  en parlant de tout le dossier. Resserré sur ce qui reste vrai, et qui est plus
  utile : **aucune migration, de quelque chantier que ce soit, ne parle de
  recherche texte**, et la phase 4 n'en a créé aucune.

---

## 9. Test terrain (§15)

Après `npm install` (rien de nouveau à installer — A5 n'ajoute **aucune
dépendance**) et une Preview :

| | |
|---|---|
| **A** | ouvrir « Ajouter un aliment » → voir les récents |
| **B** | Banane en favori → fermer → rouvrir → toujours favorite |
| **C** | taper un favori → quantité → journal |
| **D** | chercher « pomme » → la pomme crue en premier |
| **E** | chercher « riz » → riz simple avant plats composés |
| **F** | scanner un produit → A4 fonctionne toujours |
| **+** | ouvrir Nutrition → **aujourd'hui** affiché, cercle et barres remplis |
| **+** | glisser vers un autre jour → seul le jour affiché change |

---

## 10. Ce qui reste ouvert

**Le `db push` n'a pas été fait**, comme demandé. Les deux migrations sont
appliquées et éprouvées **en local uniquement**. Quand tu voudras les pousser :
elles sont déclarées au manifeste, la checklist les couvre, et aucune donnée
existante n'est touchée — un index et une table neuve.

**Rien n'est commité, poussé ni mergé.**
