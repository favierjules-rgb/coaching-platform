# Entraînement — performances : plan de validation avant déploiement

Chantier `feat/entrainement-performances`. Document établi le 25/10/2026.
**Rien n'est déployé, rien n'est commité, la base distante n'est pas touchée.**

---

## 0. État constaté

| | |
|---|---|
| Branche | `feat/entrainement-performances`, HEAD `4dcbbae` |
| Écart avec `origin/main` | 0 commit devant, 0 derrière — **tout le chantier est non commité** |
| Migrations dans le dépôt | 123 |
| Migrations enregistrées en distant | **119**, la dernière `20261025090000` |
| Écart | exactement les 4 lots A, B, C, D (vérifié par `comm`, pas par lecture de noms) |
| Projet distant | `yesuolzfmxgnaznhbcnw`, PostgreSQL **17.6.1.141**, eu-west-1, `ga` |
| Plan de l'organisation | **free** — conséquence au §3 |

Prérequis des 4 lots : **tous présents en distant**, vérifiés un par un — les 2 prédicats
et 4 policies de `20261025090000`, les 14 fonctions de portée que le lot C appelle,
`save_training_session_blocks` (v2), et les colonnes `target_zone` /
`target_power_percentage` sur `training_prescriptions`.

---

## 1. Plan exact des migrations

### 1.1 Les quatre lots

| Lot | Fichier | Taille | Objet |
|---|---|---|---|
| **A** | `supabase/migrations/20261026090000_entrainement_index_cles_etrangeres.sql` | 267 l. | 3 index de clés étrangères |
| **B** | `supabase/migrations/20261027090000_save_training_program_sessions_rpc.sql` | 521 l. | RPC d'enregistrement groupé et atomique |
| **C** | `supabase/migrations/20261028090000_entrainement_predicats_rls_scalaires.sql` | ~700 l. | 9 prédicats scalaires + réécriture des 20 policies des 5 tables ENFANTS |
| **D** | `supabase/migrations/20261029090000_training_prescriptions_synchronisation_differentielle.sql` | ~1 000 l. | synchronisation différentielle des prescriptions cardio |

### 1.2 Dépendances — lues dans le CONTENU SQL, pas déduites des noms

Méthode : retrait des commentaires, puis relevé des `create or replace function`,
`create index`, `create policy` et de tous les appels `public.<nom>(`.

| Lot | Crée | Appelle | Dépend d'un autre lot ? |
|---|---|---|---|
| A | 3 index | rien | **non** |
| B | `save_training_program_sessions` | `is_coach_or_admin`, `save_training_session_blocks` | **non** — le moteur appelé **préexiste en v2** en distant |
| C | 9 prédicats + 20 policies enfants | 15 fonctions préexistantes | **non** |
| D | remplace `save_training_session_blocks` | `is_coach_or_admin` | **non** |

**Aucune dépendance dure entre les lots.** Vérifié empiriquement : les 4 lots
s'appliquent dans **4 ordres différents** sur un socle de 92 migrations (= état distant),
y compris **D avant B** et **C avant A**. Les 4 passages sont verts.

> Un sur-contrainte avait été introduite puis retirée : le contrôle 8 du lot D levait
> `save_training_program_sessions introuvable : lot B absent`. Il aurait interdit
> d'appliquer D avant B et de revenir en arrière sur B seul. Il est désormais
> conditionnel : si B est présent, il vérifie que B appelle toujours le moteur ;
> sinon il émet un `notice`.

### 1.3 Prérequis indispensables

Aucun **nouveau** prérequis. Les trois conditions à vérifier avant la première
application restent :

1. `20261025090000` enregistrée en distant — **oui** (c'est la dernière) ;
2. `save_training_session_blocks` en **v2** — **oui** ;
3. `training_prescriptions` porte `target_zone` et `target_power_percentage` — **oui**.

Le contrat `scripts/tests/contrat-migrations.mts` et
`supabase/baseline/manifest.json` doivent déclarer les 4 fichiers, sinon
`security-hardening` échoue. **C'est fait** (123 migrations, 96 post-baseline).

### 1.4 Ordre recommandé

```
A  →  C  →  D  →  B
```

L'ordre n'est pas imposé par les dépendances (il n'y en a pas) mais par le **risque
décroissant** et par la **compatibilité avec le client en production** :

| Rang | Lot | Pourquoi là | Effet sur l'ancien client |
|---|---|---|---|
| 1 | **A** | purement additif, réversible par `drop index`, bénéfice immédiat sur le chemin **actuel** (×44 en écriture, ×261 sur la lecture d'exercices) | **accélère l'existant**, ne change aucun comportement |
| 2 | **C** | ne touche **aucune** policy de `programs` ; réécrit les 20 policies des tables enfants à périmètre **prouvé équivalent** | neutre (worst case 11 179 → 5 226 ms) |
| 3 | **D** | remplace le moteur ; sa grammaire accepte `id` absent/`null` = « nouvelle ligne », donc **l'ancien client continue de fonctionner** | **neutre**, et c'est ce qui autorise le déploiement progressif |
| 4 | **B** | ajoute une RPC que **seul le nouveau client appelle** ; aucun chemin existant ne la traverse | **invisible** tant que le client n'est pas activé |

Chaque lot est isolément réversible : A par `drop index`, C par restauration des
policies de `origin/main`, D par réapplication de la v2 du moteur, B par
`drop function save_training_program_sessions`.

### 1.5 Lots à déployer ensemble

**Aucun.** Les quatre sont individuellement déployables et individuellement
réversibles. C'est le résultat de la vérification, pas une hypothèse.

**En revanche, trois changements CLIENT doivent être livrés ensemble** — et c'est la
seule contrainte de simultanéité du chantier :

| Fichier | Changement |
|---|---|
| `lib/training-block-editing.ts` | `duplicateBlock` donne aux prescriptions dupliquées un `new-prescription:<uuid>` |
| `lib/supabase/training-session-blocks.ts` | `serializeBlock` transmet l'`id` réel des prescriptions existantes |
| `lib/training-blocks.ts` | la grammaire `NEW_PRESCRIPTION_ID_PREFIX` / `normalizeTrainingPrescriptionId` |

Livrer la duplication sans la grammaire produit `FOREIGN_PRESCRIPTION_ID` : la
duplication réutiliserait l'identifiant persistant de la source. Le cas a été
reproduit (3 échecs sur 3) avant correction, et **trois tests bloquent désormais une
livraison séparée** (`prescriptions-identite` 13/13, `reprise-relecture-echouee` 7/7,
`training-block-editing` 47/47).

### 1.6 Conditions d'activation du nouveau client

Le nouveau client ne doit être activé que lorsque **les quatre** sont vraies :

1. A, C, D, B enregistrées en distant (`supabase migration list` les montre des deux côtés) ;
2. le banc §3 est **vert** sur la base de validation isolée (critères §4) ;
3. les 3 changements client ci-dessus sont livrés **ensemble** ;
4. les **trois manques d'interface du §5 sont traités** — sans eux, un échec de
   relecture peut faire perdre au coach ses modifications non enregistrées.

### 1.7 Étapes de mesure et critères d'acceptation

| Étape | Mesure | Critère d'acceptation |
|---|---|---|
| après **A** | temps d'écriture d'une séance, lecture d'exercices | pas de régression ; gain attendu mesurable |
| après **C** | 20 policies enfants, équivalence de périmètre | **0 désaccord** sur la preuve d'équivalence ; `programmes_cloisonnement_coach` 70/70 ; création de programme 2/2 |
| après **D** | identité des prescriptions sur sauvegardes répétées | `prescriptions_diff_checklist` **70/70** ; aucune prescription du décor recréée |
| après **B** | banc `bench_sauvegarde_groupee.sh` | **pire cas < 4 000 ms**, 0 échec, timeout de 8 s inchangé |
| global | `security-hardening`, contrat de migrations | 31/31 et contrat OK |

---

## 2. Fichiers de validation préparés

Nouveaux, additifs, non commités :

| Fichier | Rôle |
|---|---|
| `supabase/tests/perf_decor_representatif.sql` | décor calqué sur la production : 29 programmes, 199 semaines, 1 393 séances, 1 196 blocs, 4 975 exercices, 603 prescriptions. Identifiants déterministes (`33330000-…`). **Base isolée uniquement** |
| `supabase/tests/bench_sauvegarde_groupee_prepare.sql` | constructeurs de charge au format **exact du client** (26 clés par prescription, `id` réel compris) + chronomètre |
| `supabase/tests/bench_sauvegarde_groupee.sh` | pilote : **une répétition = une session psql = une instruction**, `statement_timeout = 8s` armé |
| `supabase/tests/bench_sauvegarde_groupee_rapport.sql` | rapport + verdict contre 4 000 ms et 8 000 ms |
| `supabase/tests/bench_attribution_prepare.sql` + `bench_attribution.sh` | à lancer **si** l'objectif est dépassé : désigne l'étape responsable |

**Pourquoi une répétition = une session.** `statement_timeout` est armé au début de
l'instruction de plus haut niveau. Une boucle SQL de 7 sauvegardes serait **une seule**
instruction : le plafond de 8 s s'appliquerait à leur total et les répétitions 2 à 7
échoueraient pour une raison qui n'existe pas en production. Une requête PostgREST =
une connexion, une instruction, 8 s. Le pilote reproduit cela.

**Biais corrigé.** Les mesures antérieures du bac à sable tournaient **sans** le
plafond de 8 s : les 8 661 ms du pire cas y « passaient », alors qu'en production la
transaction aurait été annulée (57014). Le banc arme le plafond.

---

## 3. Validation isolée en PostgreSQL 17

### 3.1 Les trois voies, et ce qu'elles valent réellement

| Voie | Disponible ? | PG | Coût | Verdict |
|---|---|---|---|---|
| **Branche de préversion Supabase** | **non** — le *branching* exige le plan **Pro**, l'organisation est en **free** | 17, hérité du projet | Pro 25 $/mois + ~0,0134 $/h de compute, **hors *spend cap*** | la voie la plus fidèle, mais elle suppose un changement de plan |
| **Projet de test déjà existant** | **oui** — `tcpdwfodenlurlactbkk` « multi-block-training-tests », PG **17.6.1.147**, eu-west-1, actuellement **en pause** | 17.6 | 0 € | **voie recommandée** : même major **et** même minor que la production, isolée, sans changement de plan |
| **PostgreSQL 17 local** | **oui, et déjà fait** — PG **17.11** installé, 96 migrations rejouées depuis zéro | 17.11 | 0 € | fait les mesures du §4 ; même major que la production, **minor différent** (17.11 vs 17.6) |

Une branche de préversion est **sans données de production** par construction
(« data-less ») : elle n'est semée que par `supabase/seed.sql`. Le décor du §2 est donc
nécessaire dans **toutes** les voies — et c'est une bonne nouvelle pour l'isolation :
à aucun moment une donnée réelle n'entre dans la validation.

### 3.2 Commandes préparées — **AUCUNE N'A ÉTÉ EXÉCUTÉE**

> La branche distante n'est pas créée, aucune migration distante n'est appliquée,
> aucune écriture distante n'est faite. Chaque bloc ci-dessous attend une validation
> explicite.

#### Voie recommandée — le projet de test existant

```bash
# ─── 0. Outillage (aucun effet distant) ───────────────────────────────────────
npm i -g supabase          # ou : brew install supabase/tap/supabase
supabase --version
supabase login

# ─── 1. ⚠️ OPÉRATION DISTANTE : sortir le projet de test de sa pause ─────────
#     Tableau de bord → projet « multi-block-training-tests » → Restore,
#     ou via l'API de gestion. Ne concerne PAS yesuolzfmxgnaznhbcnw.
#     → VALIDATION EXPLICITE REQUISE

# ─── 2. ⚠️ Lier le dépôt au projet de TEST, jamais à la production ───────────
#     Vérifier la cible AVANT et APRÈS :
supabase projects list          # la ligne LINKED doit être tcpdwfodenlurlactbkk
supabase link --project-ref tcpdwfodenlurlactbkk
supabase projects list

# ─── 3. Voir ce qui serait appliqué, SANS l'appliquer ────────────────────────
supabase migration list         # compare dépôt / distant
supabase db push --dry-run      # lecture seule

# ─── 4. ⚠️ ÉCRITURE DISTANTE : remettre le projet de test à plat, puis
#     rejouer les 123 migrations dans l'ordre (le projet de juillet a pu dériver)
#     → VALIDATION EXPLICITE REQUISE
supabase db reset --linked      # DESTRUCTIF sur le projet de TEST uniquement
#   équivalent non destructif si l'historique est propre :
# supabase db push

# ─── 5. Décor représentatif + banc (écritures sur le projet de TEST) ─────────
export DBURL="$(supabase status -o env 2>/dev/null | sed -n 's/^DB_URL=//p')"
#   ou, depuis le tableau de bord du projet de test : Settings → Database →
#   Connection string (session mode, « non pooling »)
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/tests/perf_decor_representatif.sql

# ─── 6. Les 8 vérifications demandées ────────────────────────────────────────
#  a. migrations A→C→D→B dans l'ordre prévu .... fait à l'étape 4
#  b. ajout d'une semaine par duplication ...... scénario S6 du banc
#  c. sauvegarde d'une programmation longue .... scénarios S4/S5 (84 séances)
#  d. temps maximal de la sauvegarde groupée ... banc, verdict sur le MAXIMUM
PSQL="psql \"$DBURL\"" REPS=7 ./supabase/tests/bench_sauvegarde_groupee.sh

#  e. identité des prescriptions avant/après plusieurs sauvegardes
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/tests/prescriptions_diff_checklist.sql    # 70 contrôles
#  f. autorisations RLS et création de programme
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/tests/programmes_cloisonnement_coach.sql  # 70 contrôles
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/tests/save_training_program_sessions_checklist.sql  # 66 contrôles
#  g. reprise après sauvegarde réussie + relecture échouée
npm run test:reprise-relecture-echouee     # 7 contrôles, côté client, sans réseau
npm run test:reprise-interface-desynchronisee   # 6 conditions d'interface (voir §5)
#  h. si (d) dépasse 4 000 ms — attribution AVANT toute nouvelle optimisation
PSQL="psql \"$DBURL\"" ./supabase/tests/bench_attribution.sh

# ─── 7. Nettoyage : remettre le projet de test en pause ──────────────────────
```

#### Voie « branche de préversion », si le plan Pro est pris

```bash
supabase link --project-ref yesuolzfmxgnaznhbcnw
# ⚠️ CRÉE UNE BRANCHE DISTANTE — NON EXÉCUTÉ, VALIDATION EXPLICITE REQUISE
supabase branches create validation-entrainement --persistent
supabase branches list
# identifiants propres à la branche (jamais ceux de la production) :
supabase branches get validation-entrainement -o env > .env.branche
set -a; . ./.env.branche; set +a
supabase db push --db-url "$POSTGRES_URL_NON_POOLING"
psql "$POSTGRES_URL_NON_POOLING" -f supabase/tests/perf_decor_representatif.sql
PSQL="psql \"$POSTGRES_URL_NON_POOLING\"" REPS=7 ./supabase/tests/bench_sauvegarde_groupee.sh
# … puis les mêmes checklists qu'au-dessus
supabase branches delete validation-entrainement    # arrête la facturation horaire
```

#### Garde-fous, dans toutes les voies

* `supabase projects list` **avant et après** `link` : la cible doit être le projet
  de test, jamais `yesuolzfmxgnaznhbcnw` ;
* `db push --dry-run` avant tout `db push` ;
* `db reset --linked` est **destructif** : interdit hors projet de test ;
* `--include-seed` n'est jamais passé sur la production ;
* le décor écrit 29 programmes et 1 393 séances : l'appliquer sur la production y
  injecterait tout ce décor. Les identifiants sont déterministes pour être
  reconnaissables en cas d'erreur.

---

## 4. Critères de décision et résultats mesurés

### 4.1 Les critères

* **Le timeout de 8 s est conservé.** `authenticated` = `statement_timeout 8s`
  (relevé distant du 25/10 : `anon` 3 s, `authenticated` 8 s, `authenticator` 8 s +
  `lock_timeout` 8 s, `service_role` aucun). **Il n'est pas relevé pour faire passer
  un test** — le banc l'arme au contraire, pour qu'un dépassement devienne un échec
  visible (57014) plutôt qu'une mesure longue.
* **Objectif de validation : 4 000 ms au maximum**, soit 50 % de marge.
* **Verdict sur le MAXIMUM**, jamais sur la moyenne : c'est le pire tirage qui échoue
  chez le coach. 7 répétitions par scénario.
* **Si l'objectif est dépassé, on identifie l'étape responsable avant de proposer
  quoi que ce soit** (`bench_attribution.sh`).

### 4.2 Résultats — PostgreSQL **17.11** local, décor représentatif, 7 répétitions

| Scénario | séances | n | échecs | min | moy | max | % de 8 s | verdict |
|---|---|---|---|---|---|---|---|---|
| champ simple | 1 | 7 | 0 | 82,3 | 94,6 | **108,4** | 1,4 | OK |
| ajout d'une semaine par duplication | 7 | 7 | 0 | 536,3 | 581,4 | **637,2** | 8,0 | OK |
| une semaine modifiée | 7 | 7 | 0 | 761,2 | 872,6 | **972,7** | 12,2 | OK |
| 4 semaines | 28 | 7 | 0 | 1 591,8 | 1 673,3 | **1 782,4** | 22,3 | OK |
| 12 semaines, contenu inchangé | 84 | 7 | 0 | 3 386,1 | 3 580,1 | **3 843,0** | 48,0 | OK |
| 12 semaines, contenu modifié | 84 | 7 | 0 | 3 445,8 | 3 607,1 | **3 680,9** | 46,0 | OK |

**603 / 603** prescriptions du décor encore vivantes après 35 sauvegardes et 7
duplications : l'identité tenue par le lot D est vérifiée **par la mesure**, pas
seulement par la checklist.

### 4.3 Le point de rupture, mesuré

| séances | n | max | ms/séance | verdict |
|---|---|---|---|---|
| 84 | 7 | 3 680,9 | 43,8 | **OK sous 4 s** |
| 91 | 5 | **4 141,1** | 45,5 | **au-dessus de l'objectif** |
| 112 | 5 | 4 420,4 | 39,5 | au-dessus de l'objectif |
| 133 | 5 | 5 233,4 | 39,3 | au-dessus de l'objectif |

**L'objectif de 4 s est tenu jusqu'à 84 séances (12 semaines × 7) et cesse de l'être
vers 91 (13 semaines).** Le plafond dur de 8 s n'est atteint qu'autour de **200
séances (~28 semaines)**, en prolongeant la pente de ~40 ms/séance.

Et 84 séances est **juste** sous l'objectif : un premier passage avait donné
**4 062,4 ms** sur ce même scénario. La variation entre exécutions traverse la limite.
**Conclusion honnête : à 12 semaines on est à la limite de l'objectif, pas
confortablement dedans.**

### 4.4 L'étape responsable, mesurée

| | ms |
|---|---|
| moteur seul, 1 séance avec bloc cardio (n=10) | 377–526 (moy **450,4**) |
| moteur seul, 1 séance strength seule (n=10) | 140–207 (moy **165,2**) |
| somme de 60 appels séparés (11 cardio + 49 strength) | **11 670 – 13 050** |
| **un seul appel groupé, mêmes 84 séances** | **3 607 (max 3 681)** |
| facteur de gain du regroupement | **3,2 – 3,6 ×** |

**La préparation des plans sous RLS est payée une fois par INSTRUCTION, pas par
séance.** La seule `SELECT` sur `training_prescriptions` développe **167 SubPlans** ;
mesuré séparément : ~970 ms des ~1 000 ms d'un premier appel, puis **28 ms** une fois
le plan en cache. Groupées dans une instruction unique, les 84 séances la partagent,
et le coût marginal retombe à ~40 ms par séance.

**Il n'y a donc pas de requête fautive à optimiser : la variable qui commande le temps
total est le NOMBRE DE SÉANCES dans la charge.** Si l'objectif devait être tenu
au-delà de 12 semaines, le levier est de **borner la taille de la charge côté client**
(découper en plusieurs appels groupés, chacun atomique), pas de toucher au timeout.

### 4.5 Ce qui est mesuré, ce qui est extrapolé — séparé

**Mesuré en local (PG 17.11, décor synthétique).** Tout le §4.2, §4.3, §4.4.

**Mesuré en production (lecture seule, `pg_stat_statements`).**
`statement_timeout = 8s` ; `save_training_session_blocks` : 1 760 appels, moyenne
1 840,6 ms, écart-type 1 517,5, min 28,2, **max 7 873,2 ms** ; rafale du 23/10 :
42 appels de 562 à 6 205 ms (moyenne 2 474, p95 5 301) ; lectures
`workout_exercises` 976 appels moy 137 max 2 040, `training_prescriptions` 964 appels
moy 84 max 969 ; 46 294 + 8 485 parcours séquentiels.

**Absent de la production.** `pg_stat_statements` ne contient **aucune** ligne pour
`save_training_program_sessions` : il n'existe **aucune** mesure de production de la
RPC groupée, ni du moteur avec les index, ni du différentiel de prescriptions.
**Les données de production disponibles ne suffisent donc pas à valider la marge sous
8 s.** C'est précisément ce que la validation isolée du §3 doit produire.

**Deux fragilités de l'extrapolation ont été levées, une subsiste.**

* *Levée* — « PG17 contre PG16 ». Le **même** banc, le **même** décor, deux
  reconstructions identiques : PG 16.15 donne 3 696 ms (84 inchangé) et 4 115,7 ms
  (84 modifié) ; PG 17.11 donne 3 843,0 et 3 680,9. **Les écarts sont dans le bruit
  d'exécution : la version majeure ne change rien ici.**
* *Levée* — « la base se dégrade en s'usant ». 25 sauvegardes consécutives de 84
  séances sans *vacuum* manuel : moyenne 3 493,7 → 3 479,2 ms, max 3 772 → 3 764 ms,
  lignes mortes ≤ 15 % (l'autovacuum suit). **Aucune dérive.**
* *Subsiste* — **l'ancien chiffre de 7 197–8 661 ms pour le pire cas n'est pas
  reproduit** par ce banc, qui donne 3 642–4 141 ms à 91 séances sur la **même**
  instance PG16. Les deux harnais diffèrent (91 séances, A/B alterné, plafond non
  armé, construction de charge peut-être incluse) et je ne sais pas reconstituer
  l'ancien. **Je ne retiens donc pas le chiffre le plus favorable : les deux restent
  sur la table, et l'hypothèse de planification reste la pessimiste jusqu'à ce que la
  validation isolée tranche.** Le banc mesure le temps **serveur** d'une instruction —
  c'est bien ce que borne `statement_timeout` ; il ne mesure pas la latence perçue par
  le coach (construction de la charge + réseau), qui est une autre question, réelle.

---

## 5. Reprise côté client : la vérification **échoue** sur trois points

`npm run test:reprise-interface-desynchronisee` → **2 / 6**, délibérément rouge : il
énonce les conditions à remplir, il n'enregistre pas l'état actuel.

**Ce qui va.** Le texte est honnête : `builderSaveUserMessage({kind:"refetch-failed"})`
rend « *Enregistré, mais le rechargement a échoué — recharge la page pour vérifier
l'état.* » Et les **données** sont protégées : `reprise-relecture-echouee` (7/7) prouve
qu'une seconde sauvegarde est refusée par le verrou optimiste, sans doublon, sans
perte, et jamais par une erreur d'identifiant.

**Ce qui ne va pas.**

1. **L'état est faux alors que le message est juste.** `page.tsx:114` renvoie
   `{ ok: false }` pour **toute** issue non-`success` ; le composant range `ok:false`
   dans `setSaveStatus("error")` ; le bandeau peint `error` en `text-red-400`. Le coach
   lit donc « Enregistré, mais… » **en rouge, sous un état d'échec**, et sans
   l'horodatage « Enregistré à HH:MM » (posé seulement sur `ok`). `SaveStatus` n'a
   d'ailleurs **aucun** état pour « enregistré mais désynchronisé » :
   `"idle" | "dirty" | "saving" | "saved" | "error"`.
2. **Il n'existe aucune commande de rechargement.** Aucune occurrence de
   `location.reload`, `router.refresh` ou d'un `onClick` appelant `refetch` dans
   `ProgramBuilderFullscreen.tsx` ni dans la page. Le message dit « recharge la page » :
   le coach doit faire F5 lui-même — et **aucun garde `beforeunload`** ne le prévient
   que ses modifications non enregistrées partiront avec.
3. **Pire : à la première sauvegarde d'un montage, l'échec de relecture démonte le
   builder.** Chaîne démontrée (test C1, gardes de dérive en C2) :
   `getProgramById` rend `null` quand la lecture échoue (il ne lève pas) →
   `refetch` fait `setProgram(frais)` **avant** de rendre `frais`, donc vide le cache
   de la page → `savedProgram` vaut encore `null` puisque seul un succès l'écrit →
   `activeProgram` tombe à `undefined` → la page affiche **« Programme introuvable. »**
   et le builder est démonté, **emportant les modifications locales et le message qui
   demandait de recharger**. Si une sauvegarde avait déjà réussi dans ce montage,
   `savedProgram` retient un instantané périmé et le builder survit : le défaut est
   conditionnel, pas théorique.

**Correction minimale proposée — et elle ne branche pas `id_mapping` dans la machine
à états** (la réconciliation reste assurée par la relecture, le verrou optimiste
couvre son échec, et rien ne démontre encore la sûreté d'une réconciliation locale) :

* ajouter un état `"desynchronise"` à `SaveStatus`, alimenté par
  `outcome.kind === "refetch-failed"` ; le peindre en ambre, pas en rouge, et **poser
  l'horodatage** — la sauvegarde a réussi ;
* ajouter à côté du message un bouton **« Recharger l'état serveur »** appelant
  `refetch()` ; sur succès, remplacer l'instantané et incrémenter la révision (le
  chemin `success` existe déjà) ; sur échec, rester en `"desynchronise"` ;
* dans `useSupabaseProgram.refetch`, **ne pas écraser `program` avec `null`** quand la
  relecture échoue : conserver la valeur précédente et signaler l'échec par le retour.
  C'est la correction du point 3, et la plus importante des trois ;
* poser un garde `beforeunload` tant que `saveStatus` vaut `"dirty"` ou
  `"desynchronise"`.

`npm run test:reprise-interface-desynchronisee` passe à 6/6 quand ces quatre points
sont faits. **Tant qu'il est à 2/6, le nouveau client ne doit pas être activé.**

---

## 6. Vérifications qui restent nécessaires

| # | À faire | Pourquoi |
|---|---|---|
| 1 | Le banc §3 sur une base **managée** PG17 isolée | la seule mesure de production de la RPC groupée qui existera ; le local ne dit rien du compute Supabase ni du réseau |
| 2 | Les 3 tests Playwright de `builder-save-path` | **non exécutables ici** : aucun Chromium sur le poste. Rien de ce chantier ne les remplace |
| 3 | Les 4 corrections d'interface du §5 | condition d'activation du client |
| 4 | `training-movement-patterns` F1/F2/F3/F8 | **préexistants**, prouvés par identité d'octets avec `origin/main` sur les 9 dépendances. À traiter hors chantier, pas à masquer |
| 5 | Mesurer la latence **perçue** (construction de charge + réseau + rendu) | le banc mesure le temps serveur, qui est ce que borne le timeout — pas ce que vit le coach |
| 6 | Décider du sort des programmations **> 12 semaines** | l'objectif de 4 s cesse d'être tenu vers 91 séances ; le levier est de borner la charge côté client |

---

## 7. État Git

```
Branche : feat/entrainement-performances   HEAD 4dcbbae
origin/main...HEAD : 0 devant, 0 derrière   →  tout est non commité
```

**Rien n'a été commité, poussé ni fusionné. Aucune migration distante appliquée.
Aucune écriture sur la base distante. Les 228 retours historiques et les 6 policies
`programs` ne sont pas touchés.**
