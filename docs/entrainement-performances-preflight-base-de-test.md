# Validation isolée PostgreSQL 17 — revue préalable et commandes préparées

Chantier `feat/entrainement-performances`. Revue du 25/10/2026.

**AUCUNE commande de ce document n'a été exécutée.** Le projet de test n'a pas été
réactivé, aucune base n'a été restaurée ni réinitialisée, aucune migration distante
n'a été appliquée, rien n'a été écrit sur aucune base distante. Les seuls appels
passés sont des **lectures** : métadonnées de projet via l'API de gestion, et lecture
de fichiers du dépôt.

Aucune clé ni aucun secret n'est reproduit ici. Les variables sont citées par leur
**nom** ; les valeurs qui sont des secrets ne sont jamais affichées.

---

## 1. Vérification de la cible

### 1.1 Identité exacte du projet de test

| | |
|---|---|
| Référence | **`tcpdwfodenlurlactbkk`** |
| Nom | `multi-block-training-tests` |
| Hôte base | `db.tcpdwfodenlurlactbkk.supabase.co` |
| Région | `eu-west-1` |
| PostgreSQL | **17.6.1.147** — `postgres_engine` 17, canal `ga` |
| Création | 2026-07-22 |
| Organisation | `qqghzcwjzzdqmtoswwiw` (la même que la production) |
| **Statut** | **`INACTIVE`** |

Pour mémoire, la production : **`yesuolzfmxgnaznhbcnw`**, `Coaching plateforme`,
PostgreSQL **17.6.1.141**, `eu-west-1`, `ACTIVE_HEALTHY`, créée le 2026-07-03.

Les deux versions mineures diffèrent d'un patch (17.6.1.147 contre 17.6.1.141) : la
cible est donc **plus proche de la production que le bac à sable local** (17.11).

### 1.2 Ce qui démontre que ce n'est pas la production

Cinq éléments, tous vérifiables en lecture seule :

1. **Référence et hôte distincts.** `tcpdwfodenlurlactbkk` ≠ `yesuolzfmxgnaznhbcnw`.
   Deux projets séparés, deux bases séparées, deux jeux d'identifiants séparés.
2. **L'application ne connaît pas ce projet.** `NEXT_PUBLIC_SUPABASE_URL` de
   `.env.local` pointe sur l'hôte `yesuolzfmxgnaznhbcnw.supabase.co`. La référence
   `tcpdwfodenlurlactbkk` **n'apparaît nulle part** dans le code, la configuration,
   les manifestes de build (`.next/*`), ni les tests.
3. **Le build déployé est verrouillé sur la production.** La politique CSP composée au
   build (`.next/routes-manifest.json`, `connect-src` / `frame-src`) ne cite que
   `yesuolzfmxgnaznhbcnw.supabase.co`. Un navigateur servi par ce build ne pourrait
   pas joindre le projet de test, même si on l'y poussait.
4. **Statut `INACTIVE`.** Une base de production d'une application en service n'est
   pas en pause.
5. **Empreinte de données.** La production porte une signature relevée et stable :
   119 migrations (dernière `20261025090000`), 6 policies sur `programs`,
   **228 retours d'exercice détachés**, 0 occurrence de
   `save_training_program_sessions`, 0 des 3 index du lot A. Cette empreinte est le
   contrôle à rejouer sur la cible après réactivation (§2, commande 4) : une base qui
   la reproduirait **serait** la production, et il faudrait s'arrêter immédiatement.

### 1.3 État actuel : faut-il le réactiver ? — oui, et c'est démontré

Le projet est **en pause**, et cela bloque *toute* lecture de sa base, pas seulement
les écritures. Vérifié : un listage des migrations via l'API de gestion échoue sur
`Connection terminated due to connection timeout`. Les métadonnées du projet
(référence, région, version, statut) restent lisibles ; **le contenu de la base ne
l'est pas**.

Conséquence directe : **une réactivation est indispensable, et elle doit venir avant
toute décision sur les données.** C'est une opération distante — elle n'a pas été
faite et attend une validation explicite.

### 1.4 Ses données peuvent-elles être réinitialisées ou écrasées ?

**Je ne le sais pas, et je ne le suppose pas.**

Ce que je sais : le projet s'appelle `multi-block-training-tests`, il a été créé le
22/07/2026 — vraisemblablement pour le chantier « multi-blocs » de juillet — et rien
dans le dépôt actuel ne s'y connecte. Ce que je ne sais pas : **ce qu'il contient.**
Un nom n'est pas une preuve de jetabilité, et la base est inaccessible tant qu'elle
est en pause.

La question ne peut donc être tranchée qu'**après réactivation et avant toute
réinitialisation**, par la séquence de lecture seule de la commande 4 au §2. Règle de
décision proposée :

| Constat après lecture | Décision |
|---|---|
| Base vide, ou schéma sans données métier, ou données manifestement synthétiques | `db reset --db-url` acceptable |
| Données inconnues, ou volumétrie comparable à la production, ou l'empreinte de production se reproduit | **ne rien écraser**, s'arrêter et en reparler |
| Historique de migrations divergent de `supabase/migrations/` mais données négligeables | `db reset --db-url` plutôt qu'un `db push` (un push sur un historique divergent échoue ou applique à côté) |

Dans le doute, une troisième voie existe et évite complètement la question : **créer
un projet neuf** sur le plan free (l'organisation en compte 2 aujourd'hui ; la limite
du plan est à vérifier dans le tableau de bord), le valider, puis le supprimer.
Aucune donnée existante n'est alors en jeu.

### 1.5 Vers quoi pointent le dépôt, la configuration et l'environnement

**⚠️ C'est le point le plus important de cette revue : aujourd'hui, tout pointe vers
la PRODUCTION.**

| Élément | Valeur constatée | Conséquence |
|---|---|---|
| `supabase/.temp/project-ref` | `yesuolzfmxgnaznhbcnw` | **le dépôt est lié à la PRODUCTION** |
| `supabase/.temp/linked-project.json` | `{"ref":"yesuolzfmxgnaznhbcnw","name":"Coaching plateforme",…}` | idem |
| `supabase/.temp/pooler-url` | hôte poolé de `yesuolzfmxgnaznhbcnw` | idem |
| `supabase/.temp/postgres-version` | `17.6.1.141` | cohérent avec la production |
| `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` | hôte `yesuolzfmxgnaznhbcnw.supabase.co` | **l'application locale parle à la PRODUCTION** |
| `.env.local` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | définies (valeurs non affichées) | ce sont les clés de **production** |
| `supabase/config.toml` → `project_id` | `"coaching-platform"` | **ce n'est pas une référence distante** : le fichier le documente lui-même comme le nom du stack LOCAL. Ne pas le confondre |
| Workflows GitHub | **aucun** | aucun déploiement automatique ne peut partir par accident |
| `vercel.json`, `.vercel/project.json` | présents | déploiement de l'application, sans référence de projet Supabase |

**Ce que cela implique, très concrètement :** dans l'état actuel du dépôt, un
`supabase db push` tapé sans argument de cible **s'appliquerait à la production**.
C'est exactement l'accident que le reste du chantier s'est interdit.

**D'où une correction de la procédure que j'avais proposée.** Mon plan précédent
commençait par `supabase link --project-ref tcpdwfodenlurlactbkk`. Je ne le recommande
plus : `link` **réécrit `supabase/.temp/project-ref`**, donc l'état de liaison du
dépôt, et laisse une amorce durable — si personne ne relie ensuite à la production,
le prochain `db push` d'une session future, tapé de bonne foi, partirait vers le
projet de test ; et si on relie en sens inverse en cours de validation, c'est le
contraire. **Toutes les commandes du §2 passent donc par `--db-url` explicite, et le
dépôt reste lié à la production, inchangé.** La cible est nommée à chaque invocation
plutôt que retenue dans un fichier.

**Deux fichiers citent l'origine de production en dur**, et ce n'est pas un problème :
`scripts/tests/video-source.mts` et `scripts/tests/video-garde-fous.mts` **posent
eux-mêmes** `process.env.NEXT_PUBLIC_SUPABASE_URL` avant d'importer la configuration.
Ils sont donc insensibles à `.env.local`, et il n'y a **aucune raison de modifier
`.env.local`** pour cette validation — ce qui est aussi la garantie que l'application
locale ne se mettra pas à écrire dans la base de test par inadvertance.

### 1.6 Collisions entre jeux de test — vérifié, il n'y en a pas

Les quatre fichiers qui écrivent dans la base de validation utilisent des espaces
d'identifiants **disjoints** :

| Fichier | Préfixes d'identifiants |
|---|---|
| `perf_decor_representatif.sql` | `11111111-…`, `22222222-…`, `33330000-…`, `55550000-…`, `88880000-…` |
| `prescriptions_diff_checklist.sql` | `ddddddd1-…`, `d1d1d1d1-…` … `d5d5d5d5-…`, `aaaaaaa2-…` |
| `programmes_cloisonnement_coach.sql` | `00000000-…-00000000a0xx`, `…a1xx` |
| `save_training_program_sessions_checklist.sql` | `0a000000-…`, `0b000000-…`, `0c000000-…`, `00000000-…-ffff` |

Et **aucune des trois checklists ne supprime de lignes sans condition** : la seule
occurrence de `truncate` porte sur une table temporaire (`pg_temp.resultats`). Elles
peuvent donc tourner dans n'importe quel ordre, avant ou après le décor, sans
s'effacer mutuellement.

### 1.7 Outillage manquant

**Aucun binaire `supabase` n'est installé** sur le poste (ni dans le `PATH`, ni en
dépendance du projet). L'installation est le préalable n° 0 du §2 ; elle est sans
effet distant.

---

## 2. Commandes préparées, dans l'ordre

Conventions de lecture :

* **Cible** : sur quoi la commande agit.
* **Nature** : *lecture seule* / *écrit en local* / **ÉCRIT EN DISTANT**.
* Les commandes marquées **⛔** modifient un environnement distant et **attendent une
  validation explicite**. Aucune n'a été lancée.

Le mot de passe de la base de test et sa chaîne de connexion sont des **secrets** :
ils se récupèrent dans le tableau de bord du projet de test
(*Settings → Database → Connection string*, mode **session**, « non pooling ») et se
posent dans une variable de shell. Ne pas les écrire dans un fichier du dépôt, ne pas
les afficher, ne pas les passer en argument visible.

```bash
# Dans un shell dont l'historique est désactivé pour cette ligne (espace initial) :
 export DBURL_TEST='postgresql://…'          # chaîne du PROJET DE TEST
```

### 0. Préalable — outillage

```bash
npm i -g supabase          # ou : brew install supabase/tap/supabase
supabase --version
supabase login
```

* **Cible** : poste local / compte Supabase. **Nature** : *écrit en local* (jeton
  d'accès stocké localement). **Effet** : aucun sur une base.
* **Attendu** : une version s'affiche ; `login` ouvre le navigateur et confirme.

### 1. Garde-fou — constater vers quoi le dépôt est lié, et ne pas y toucher

```bash
cat supabase/.temp/project-ref
supabase projects list
```

* **Cible** : dépôt local + API de gestion. **Nature** : *lecture seule*.
* **Attendu** : `yesuolzfmxgnaznhbcnw` — **la production**. C'est normal et cela doit
  **rester** ainsi : aucune commande de cette procédure n'utilise la liaison. Si cette
  valeur est autre chose à la fin de la validation, c'est une anomalie à corriger.
* **Effet d'un oubli** : c'est précisément le risque que `--db-url` supprime.

### 2. ⛔ Réactiver le projet de test

Depuis le tableau de bord : projet **`multi-block-training-tests`** → *Restore*.

* **Cible** : **projet de test `tcpdwfodenlurlactbkk`**. **Nature** : **ÉCRIT EN
  DISTANT** (change le statut du projet ; la facturation de compute reprend).
* **Effets possibles** : la base redevient joignable ; quelques minutes d'attente ;
  aucun changement de schéma ni de données par cette seule opération.
* **Attendu** : `get_project` passe de `INACTIVE` à `ACTIVE_HEALTHY`.
* **Ne concerne pas** `yesuolzfmxgnaznhbcnw`. **Vérifier le nom affiché avant de
  cliquer.**

### 3. Vérifier l'état de la base de test — et qu'elle n'est pas la production

```bash
psql "$DBURL_TEST" -c "select current_database(), version();"
psql "$DBURL_TEST" -c "select inet_server_addr() is not null as joignable, current_setting('server_version') as pg;"
```

* **Cible** : projet de test. **Nature** : *lecture seule*.
* **Attendu** : PostgreSQL **17.6.1.147**. Si la version annoncée est **17.6.1.141**,
  **s'arrêter** : la chaîne de connexion pointe sur la production.

### 4. Lecture seule — décider si les données peuvent être écrasées (§1.4)

```bash
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 <<'SQL'
-- historique de migrations
select count(*) as migrations, min(version) as premiere, max(version) as derniere
  from supabase_migrations.schema_migrations;
-- volumétrie métier
select 'programs' t, count(*) n from public.programs
union all select 'workout_sessions', count(*) from public.workout_sessions
union all select 'training_prescriptions', count(*) from public.training_prescriptions
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users;
-- EMPREINTE DE PRODUCTION : doit être FAUSSE partout
select (select count(*) from public.exercise_feedback ef
         where not exists (select 1 from public.workout_exercises we where we.id = ef.exercise_id))
         = 228 as retours_detaches_228,
       (select count(*) from supabase_migrations.schema_migrations) = 119 as migrations_119,
       (select count(*) from pg_policies where tablename = 'programs') = 6 as policies_programs_6;
SQL
```

* **Cible** : projet de test. **Nature** : *lecture seule*. Les tables peuvent ne pas
  exister (base vide) : l'erreur est alors l'information.
* **Attendu** : les trois colonnes d'empreinte à **`false`**. Si l'une est `true`,
  **arrêt immédiat** — la cible n'est pas celle qu'on croit.
* **C'est cette sortie, et elle seule, qui autorise ou interdit l'étape 6.**

### 5. Statut des migrations, puis simulation

```bash
supabase migration list --db-url "$DBURL_TEST"
supabase db push --db-url "$DBURL_TEST" --dry-run
```

* **Cible** : projet de test (nommé explicitement — la liaison n'est pas utilisée).
  **Nature** : *lecture seule*. `--dry-run` n'applique rien.
* **Attendu** : `migration list` montre 123 migrations locales et l'historique
  distant de la cible ; `--dry-run` énumère les migrations qui seraient appliquées.
* **Attention** : si une de ces deux commandes refuse `--db-url` sur la version
  installée, **ne pas se rabattre sur la liaison en silence** : relier explicitement
  (`supabase link --project-ref tcpdwfodenlurlactbkk`), vérifier avec
  `supabase projects list` **avant et après**, et **relier la production à la fin**
  (étape 11).

### 6. ⛔ Préparer le schéma : remettre la base de test à plat, puis rejouer l'historique

```bash
# Variante A — historique divergent ou base douteuse (DESTRUCTIF sur la cible)
supabase db reset --db-url "$DBURL_TEST"

# Variante B — historique propre et aligné : appliquer seulement le manquant
supabase db push --db-url "$DBURL_TEST"
```

* **Cible** : projet de test. **Nature** : **ÉCRIT EN DISTANT**. La variante A
  **détruit tout le contenu** de la base de test.
* **Conditionnée par l'étape 4.** Ne pas lancer si l'empreinte de production
  apparaît, ni si les données sont inconnues.
* **Effets possibles** : la variante A rejoue les 123 migrations depuis zéro — c'est
  ce qui donne un point de départ identique au bac à sable local. La variante B peut
  échouer sur un historique divergent : c'est un refus, pas un dégât.
* **Attendu** : les 123 migrations enregistrées, dernière `20261029090000`.

### 7. Appliquer les lots dans l'ordre recommandé

L'ordre **A → C → D → B** est celui du plan de déploiement. Deux manières :

```bash
# 7a. En une passe (l'ordre d'application est l'ordre des horodatages :
#     A 20261026, B 20261027, C 20261028, D 20261029 → A, B, C, D)
supabase db push --db-url "$DBURL_TEST"

# 7b. ⛔ Dans l'ordre A → C → D → B exactement, pour éprouver CET ordre-là
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/migrations/20261026090000_entrainement_index_cles_etrangeres.sql
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/migrations/20261028090000_entrainement_predicats_rls_scalaires.sql
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/migrations/20261029090000_training_prescriptions_synchronisation_differentielle.sql
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/migrations/20261027090000_save_training_program_sessions_rpc.sql
# puis enregistrer les quatre versions dans l'historique :
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations (version) values ('20261026090000'),('20261027090000'),('20261028090000'),('20261029090000') on conflict do nothing;"
```

* **Cible** : projet de test. **Nature** : **ÉCRIT EN DISTANT**.
* **⚠️ 7a et 7b ne testent pas la même chose, et c'est voulu.** `db push` applique par
  **horodatage croissant**, donc A → B → C → D, pas l'ordre recommandé. Pour éprouver
  réellement A → C → D → B, il faut 7b. Les deux ordres ont été validés en local, mais
  c'est 7b qui correspond à un déploiement progressif réel.
* **Effets possibles** : chaque fichier porte ses propres contrôles et **lève** si une
  invariante est fausse — un échec arrête la transaction du fichier concerné.
* **Attendu** : les `notice` de contrôle de chaque lot, soit **5 contrôles (A)**,
  **6 (B)**, **10 (C)** et **8 (D)**, tous verts.

### 8. ⛔ Décor représentatif

```bash
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/tests/perf_decor_representatif.sql
```

* **Cible** : projet de test. **Nature** : **ÉCRIT EN DISTANT** — insère 29
  programmes, 199 semaines, 1 393 séances, 1 196 blocs, 4 975 exercices, 603
  prescriptions, et une identité coach dans `auth.users` / `profiles` / `coaches`.
* **Attendu** : le tableau de volumétrie exactement à ces valeurs, puis `analyze`.
* **Ne jamais lancer sur la production** : les identifiants déterministes
  (`33330000-…`) sont là pour qu'une erreur soit immédiatement reconnaissable.

### 9. ⛔ Tests SQL et benchmarks

```bash
# checklists (écrivent leurs propres jeux, espaces d'identifiants disjoints)
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/tests/prescriptions_diff_checklist.sql
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/tests/save_training_program_sessions_checklist.sql
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 -f supabase/tests/programmes_cloisonnement_coach.sql

# banc de performance — plafond de 8 s armé par le pilote, 12 répétitions
PSQL="psql \"$DBURL_TEST\"" REPS=12 ./supabase/tests/bench_sauvegarde_groupee.sh

# attribution — SEULEMENT si le banc dépasse 4 000 ms
PSQL="psql \"$DBURL_TEST\"" ./supabase/tests/bench_attribution.sh
```

* **Cible** : projet de test. **Nature** : **ÉCRIT EN DISTANT**.
* **Attendu** : **70/70**, **66/66**, **70/70**, puis le tableau du banc et son
  verdict (critères au §3).
* **Effets possibles** : le banc crée `public.bench_mesures`, `public.bench_charge`,
  `public.attr` et quelques fonctions `bench_*` / `attr_*` dans le schéma `public` de
  la cible. **C'est pour cela qu'il ne doit tourner que sur une base jetable.**

### 10. Contrôles d'après-validation

```bash
psql "$DBURL_TEST" -v ON_ERROR_STOP=1 <<'SQL'
select count(*) as migrations, max(version) as derniere
  from supabase_migrations.schema_migrations;
select indexname from pg_indexes
 where indexname in ('workout_exercises_session_id_idx',
                     'workout_sessions_program_week_id_idx',
                     'workout_sessions_program_id_idx') order by 1;
select proname, prosecdef from pg_proc
 where proname in ('save_training_program_sessions','save_training_session_blocks') order by 1;
select count(*) as policies_enfants from pg_policies
 where tablename in ('workout_sessions','training_blocks','workout_exercises',
                     'training_prescriptions','exercise_feedback');
select count(*) as policies_programs from pg_policies where tablename = 'programs';
-- objets laissés par le banc, à connaître avant de rendre la base
select relname from pg_class
 where relname like 'bench_%' or relname = 'attr' order by 1;
SQL
```

* **Cible** : projet de test. **Nature** : *lecture seule*.
* **Attendu** : **123** migrations, dernière `20261029090000` ; les **3** index ;
  `save_training_program_sessions` avec `prosecdef = false` (*security invoker*) ;
  **20** policies sur les 5 tables enfants ; **6** policies sur `programs` ; et la
  liste des objets `bench_*` à nettoyer.

### 11. Fin — rendre l'environnement comme on l'a trouvé

```bash
cat supabase/.temp/project-ref      # doit encore être yesuolzfmxgnaznhbcnw
unset DBURL_TEST
```

Puis, dans le tableau de bord : remettre `multi-block-training-tests` **en pause**
(⛔ opération distante sur le projet de test) pour arrêter la facturation de compute.

### 12. Vérification finale que la production est intacte — lecture seule

```bash
# via l'API de gestion ou le SQL editor de la PRODUCTION, en LECTURE SEULE
select (select count(*) from supabase_migrations.schema_migrations) as migrations,
       (select count(*) from pg_proc where proname='save_training_program_sessions') as rpc_groupee,
       (select count(*) from pg_indexes where indexname in (
          'workout_exercises_session_id_idx','workout_sessions_program_week_id_idx',
          'workout_sessions_program_id_idx')) as index_lot_a,
       (select count(*) from pg_policies where tablename='programs') as policies_programs,
       (select count(*) from public.exercise_feedback ef
         where not exists (select 1 from public.workout_exercises we where we.id=ef.exercise_id)) as retours_detaches;
```

* **Attendu, inchangé** : `119`, `0`, `0`, `6`, `228`.
* Le nombre de prescriptions, lui, **bouge légitimement** (666 → 669 observés le
  25/10 par activité réelle d'un coach) : ce n'est pas un indicateur d'intégrité.

---

## 3. Scénarios de validation et critères d'acceptation

| # | Scénario | Comment | Critère d'acceptation |
|---|---|---|---|
| 1 | **Migrations et leurs contrôles** | étape 7 (de préférence **7b**, l'ordre A → C → D → B) | **5 + 6 + 10 + 8 = 29 contrôles**, tous verts, aucun `raise exception`. 123 migrations enregistrées, dernière `20261029090000` |
| 2 | **Duplication d'une semaine** | scénario **S6** du banc : `weeks_to_create` + 7 `sessions_to_create`, prescriptions en `new-prescription:<uuid>` | 12/12 répétitions **sans échec** ; max **< 4 000 ms** ; 7 séances et 21 prescriptions créées par répétition ; **aucun** `FOREIGN_PRESCRIPTION_ID` |
| 3 | **Programmation de 12 semaines** | scénarios **S4** (contenu inchangé) et **S5** (contenu modifié), 84 séances | 12/12 sans échec ; aucun dépassement du plafond de 8 s ; mesures rapportées **séparément de celles à 91 séances** (§3.2) |
| 4 | **Stabilité des identifiants de prescriptions** | `prescriptions_diff_checklist.sql`, puis le contrôle de fin de banc | **70/70**. Et **603 / 603** prescriptions du décor encore vivantes après toutes les répétitions : aucune ligne recréée |
| 5 | **Reprise après échec de relecture** | `npm run test:reprise-relecture-echouee` et `npm run test:reprise-interface-desynchronisee` (client, **sans réseau** — à lancer en local, pas contre la base) | **7/7** et **17/17**. Ils ne touchent aucune base : ils ne dépendent donc pas de cette validation, et inversement |
| 6 | **Autorisations RLS et création d'un programme** | `programmes_cloisonnement_coach.sql` et `save_training_program_sessions_checklist.sql` | **70/70** et **66/66**. Création de programme par `INSERT … RETURNING` fonctionnelle ; **6** policies sur `programs`, identiques à `origin/main` ; **20** policies sur les 5 tables enfants |
| 7 | **Performance, plafond de 8 s actif** | `bench_sauvegarde_groupee.sh`, `REPS=12` | §3.1 et §3.2 |

### 3.1 Critères de performance — ce qui est déclarable

Le plafond reste **8 000 ms** (`statement_timeout` du rôle `authenticated`) et **n'est
pas relevé** : le pilote l'arme, pour qu'un dépassement soit un échec `57014` visible
et non une mesure longue. Le verdict porte sur le **maximum**, jamais sur la moyenne.

| Charge | Critère | Statut local pour mémoire |
|---|---|---|
| 1 séance (champ simple) | max **< 4 000 ms**, 0 échec | atteint, max cumulé 137,4 ms |
| 7 séances (semaine modifiée) | max **< 4 000 ms**, 0 échec | atteint, max cumulé 1 018,9 ms |
| 7 séances (duplication d'une semaine) | max **< 4 000 ms**, 0 échec | atteint, max cumulé 686,6 ms |
| 28 séances (4 semaines) | max **< 4 000 ms**, 0 échec | atteint, max cumulé 1 993,1 ms |
| **84 séances** | **aucun échec** et max **< 8 000 ms** exigés ; l'objectif de 4 000 ms est **mesuré et rapporté, pas exigé** | **non déclaré atteint** : max cumulé **4 062,4 ms** |
| **91 séances** | idem | **non déclaré atteint** : max cumulé **4 141,1 ms** |

**L'objectif de 4 secondes n'est pas déclaré atteint pour 84 séances ni pour 91
séances.** Le maximum cumulé y dépasse l'objectif, et le verdict change d'un passage à
l'autre parce que la dispersion du bac à sable (±25 %) est du même ordre que la marge
restante. Ce que la validation managée doit produire, c'est la mesure sur un compute
Supabase ; elle ne doit pas être lue comme la confirmation d'un objectif déjà acquis.

Si une charge dépasse 4 000 ms : **lancer `bench_attribution.sh` et nommer l'étape
responsable avant de proposer la moindre optimisation.** Référence locale : le coût est
dominé par la préparation des plans sous RLS, payée une fois par **instruction** (167
SubPlans sur la seule `SELECT` de `training_prescriptions`), d'où un coût marginal de
~30–40 ms par séance et un facteur **3,2–3,6 ×** en faveur du regroupement. La variable
qui commande le total est le **nombre de séances**, et le levier est de le borner côté
client — pas de toucher au timeout.

### 3.2 Les mesures à 84 et à 91 séances restent séparées

Le rapport du banc groupe par `nb_seances`, donc les deux lignes ne se confondent
jamais. À consigner, pour chacune des deux charges **distinctement** : le nombre de
répétitions, le nombre d'échecs, min / moyenne / médiane / **max**, le pourcentage du
plafond de 8 s, et le verdict.

Rappel de l'exposition réelle (relevé production, lecture seule) : 29 programmes,
**maximum 85 séances**, maximum 12 semaines, moyenne 48,6, p95 = 84 ; **1 programme
au-delà de 84 séances, aucun au-delà de 91**. Et côté client **aucun plafond** : le
diff envoie toutes les séances qu'il ne peut pas déclarer inchangées, sans découpage,
et le builder n'impose aucune borne au nombre de semaines. Un appel peut donc porter
autant de séances que la programmation en compte — c'est pour cela que 91 est mesuré
alors que la production n'y est pas encore.

### 3.3 Ce que cette validation ne couvrira pas

| Limite | Conséquence |
|---|---|
| Les 3 tests Playwright de `builder-save-path` | **non exécutables** : aucun Chromium sur le poste. Ils portent sur la mise en page, pas sur la reprise |
| L'état ambre et le bouton « Resynchroniser » | la section D de `reprise-interface-desynchronisee` est **structurelle** : elle attrape une régression, elle ne remplace pas une vérification à l'œil |
| `training-movement-patterns` F1/F2/F3/F8 | **préexistants**, indépendants du chantier (les 9 fichiers qu'ils lisent sont byte-identiques à `origin/main`) |
| La latence **perçue** par le coach | le banc mesure le temps **serveur** d'une instruction, qui est ce que borne `statement_timeout` — pas la construction de la charge, ni le réseau, ni le rendu |
| Le compute du projet de test ≠ celui de la production | un projet free tourne sur une taille de compute plus petite. Les mesures seront **conservatrices** si la production est sur un compute supérieur — à vérifier avant de conclure |

---

## 4. État Git

```
Branche : feat/entrainement-performances   HEAD 4dcbbae
origin/main...HEAD : 0 devant, 0 derrière   →  tout est non commité
```

**Rien n'a été commité, poussé ni fusionné. Aucune commande distante n'a été exécutée.
Le dépôt reste lié à la production, et c'est volontaire. Les 228 retours historiques
et les 6 policies `programs` ne sont pas touchés.**
