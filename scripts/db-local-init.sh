#!/usr/bin/env bash
# =====================================================================
# Reconstruction d'une base Supabase LOCALE reproductible.
#
# ---------------------------------------------------------------------
# Pourquoi un workdir isolé
# ---------------------------------------------------------------------
# `supabase start` applique AUTOMATIQUEMENT le contenu de
# <workdir>/supabase/migrations au démarrage. Lancé depuis le dépôt, il
# rejoue donc les 32 migrations historiques sur une base vierge et
# échoue dès la première :
#     ERROR: relation "public.student_profiles" does not exist
#
# La CLI n'offre aucun moyen de désactiver ce comportement. La seule
# parade fiable est de démarrer la pile depuis un workdir SÉPARÉ, hors du
# dépôt, qui ne contient qu'un `config.toml` et AUCUNE migration. La CLI
# n'a alors rien à appliquer, et ce script charge lui-même le baseline
# puis les seules migrations postérieures.
#
# ---------------------------------------------------------------------
# Pourquoi un baseline
# ---------------------------------------------------------------------
# Le dépôt n'a jamais eu de migration initiale : le schéma fondateur a été
# créé à la main dans le SQL Editor (voir le fichier historique
# supabase/schema.sql, à ne pas exécuter). Les migrations ne sont que des
# évolutions posées par-dessus.
#
# Le baseline vit dans supabase/baseline/, VOLONTAIREMENT HORS de
# supabase/migrations/ : `supabase db push` ne pousse que le contenu de
# migrations/, donc un baseline rangé ici ne peut structurellement pas
# partir sur la production, où le schéma existe déjà.
#
# Instantané du 24/07/2026, il contient DÉJÀ les 25 premières migrations.
# Seules les 5 postérieures sont rejouées — les appliquer toutes créerait
# des doublons de policies, de fonctions et de contraintes.
#
# Usage :
#   npm run db:local:init            # baseline + migrations post-baseline
#   npm run db:local:init -- --seed  # avec le jeu de données synthétique
# =====================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

SUPABASE_CLI="npx supabase@2.109.1"
BOOTSTRAP_WORKDIR="${BOOTSTRAP_WORKDIR:-$HOME/.cache/coaching-platform-supabase-bootstrap}"
# Identifiant du projet Supabase LOCAL de ce dépôt. Il nomme les conteneurs
# et volumes Docker (`supabase_db_<project_id>`, `supabase_storage_<project_id>`…)
# et sert de FILTRE EXCLUSIF au nettoyage : aucune autre pile Supabase de la
# machine ne doit jamais être touchée.
PROJECT_ID="coaching-platform-bootstrap"
BASELINE_DIR="supabase/baseline"
MANIFEST="$BASELINE_DIR/manifest.json"
AVEC_SEED=false
for arg in "$@"; do
  [[ "$arg" == "--seed" ]] && AVEC_SEED=true
done

rouge()   { printf '\033[31m%s\033[0m\n' "$*"; }
vert()    { printf '\033[32m%s\033[0m\n' "$*"; }
titre()   { printf '\n\033[1m── %s\033[0m\n' "$*"; }
abandon() { rouge "ARRÊT — $*"; exit 1; }

# ---------------------------------------------------------------------
# 1. Garde-fous
# ---------------------------------------------------------------------
titre "Contrôles de sûreté"

for arg in "$@"; do
  case "$arg" in
    --linked|--db-url*|--project-ref*|*supabase.co*|*supabase.in*)
      abandon "argument interdit : « $arg ». Ce script est strictement local." ;;
  esac
done
vert "  ✓ aucune cible distante en argument"

# L'absence de commande distante DANS ce fichier (drapeau de liaison,
# réparation d'historique, URL hébergée) est vérifiée hors du script, par
# scripts/tests/security-hardening.mts : un auto-contrôle textuel se
# déclencherait sur ses propres motifs de recherche.

# Le filtre de nettoyage est construit à partir de PROJECT_ID : une valeur
# vide, joker ou inattendue effacerait les bases d'autres projets. On refuse
# donc tout ce qui n'est pas la valeur exacte attendue.
if [[ -z "${PROJECT_ID:-}" ]]; then
  abandon "PROJECT_ID vide : le nettoyage sélectionnerait tous les conteneurs."
fi
case "$PROJECT_ID" in
  *[*?%]*|*" "*|*$'\t'*)
    abandon "PROJECT_ID « $PROJECT_ID » contient un joker ou un espace : nettoyage refusé." ;;
esac
if [[ "$PROJECT_ID" != "coaching-platform-bootstrap" ]]; then
  abandon "PROJECT_ID inattendu (« $PROJECT_ID »). Seul coaching-platform-bootstrap est admis."
fi
vert "  ✓ projet local ciblé : $PROJECT_ID"

command -v docker >/dev/null 2>&1 || abandon "Docker est introuvable. Démarre Docker Desktop."
docker info >/dev/null 2>&1        || abandon "Docker ne répond pas. Démarre Docker Desktop."
vert "  ✓ Docker opérationnel"

[[ -f "$MANIFEST" ]] || abandon "manifeste introuvable : $MANIFEST"

# ---------------------------------------------------------------------
# 2. Intégrité du baseline
# ---------------------------------------------------------------------
titre "Intégrité du baseline"

verifier_sha() {
  local fichier="$1" attendu="$2" obtenu
  obtenu="$(shasum -a 256 "$fichier" | cut -d' ' -f1)"
  if [[ "$obtenu" != "$attendu" ]]; then
    rouge "  ✗ $(basename "$fichier")"
    rouge "    attendu : $attendu"
    rouge "    obtenu  : $obtenu"
    abandon "le baseline a été modifié. Restaure-le depuis le commit 5bafc50, ou mets à jour le manifeste en connaissance de cause."
  fi
  vert "  ✓ $(basename "$fichier")"
}

verifier_sha "$BASELINE_DIR/00_baseline_remote_schema.sql" \
  "$(node -p "require('./$MANIFEST').fichiers['00_baseline_remote_schema.sql'].sha256")"
verifier_sha "$BASELINE_DIR/01_post_baseline_storage.sql" \
  "$(node -p "require('./$MANIFEST').fichiers['01_post_baseline_storage.sql'].sha256")"

PREMIERE_A_REJOUER="$(node -p "require('./$MANIFEST').borne.premiere_migration_a_rejouer")"
vert "  ✓ borne : première migration rejouée = $PREMIERE_A_REJOUER"

# ---------------------------------------------------------------------
# 3. Arrêt des conteneurs locaux existants
# ---------------------------------------------------------------------
titre "Nettoyage du projet local $PROJECT_ID"

# Filtre EXCLUSIF, ancré des DEUX côtés : préfixe `supabase_` ET suffixe
# `_<project_id>` exact, avec un seul segment de service au milieu.
#
#   ^supabase_<service>_coaching-platform-bootstrap$
#
# Le préfixe seul serait bien trop large — il emporterait les piles des
# autres projets de la machine — et le suffixe seul laisserait passer un
# `autre_coaching-platform-bootstrap`. Les deux ancres sont donc
# indissociables. `docker volume prune` et `system prune` restent proscrits
# pour la même raison.
MOTIF="^supabase_[^[:space:]]+_${PROJECT_ID}\$"

CONTENEURS="$(docker ps -a --format '{{.Names}}' | grep -E -- "$MOTIF" || true)"
if [[ -n "$CONTENEURS" ]]; then
  echo "  Conteneurs supprimés :"
  printf '    %s\n' $CONTENEURS
  # shellcheck disable=SC2086
  docker rm -f $CONTENEURS >/dev/null
  vert "  ✓ conteneurs du projet supprimés"
else
  vert "  ✓ aucun conteneur du projet à supprimer"
fi

# Les VOLUMES aussi, sans quoi la base survit d'une exécution à l'autre.
#
# `docker rm -f` ne touche pas aux volumes nommés : au deuxième lancement, la
# base contenait encore le schéma du premier. Le baseline, écrit par
# `supabase db dump`, utilise `CREATE TABLE IF NOT EXISTS` (silencieux si la
# table existe) SUIVI de `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY` (qui,
# lui, échoue) :
#     ERROR: multiple primary keys for table "activity_events" are not allowed
# activity_events étant la première table par ordre alphabétique, l'erreur
# tombait dès le début du baseline.
VOLUMES="$(docker volume ls --format '{{.Name}}' | grep -E -- "$MOTIF" || true)"
if [[ -n "$VOLUMES" ]]; then
  echo "  Volumes supprimés :"
  printf '    %s\n' $VOLUMES
  # shellcheck disable=SC2086
  docker volume rm -f $VOLUMES >/dev/null 2>&1 || true
  vert "  ✓ volumes du projet supprimés (base repartant réellement de zéro)"
else
  vert "  ✓ aucun volume du projet à supprimer"
fi

# ---------------------------------------------------------------------
# 4. Workdir isolé, hors du dépôt
# ---------------------------------------------------------------------
titre "Workdir isolé"

case "$BOOTSTRAP_WORKDIR" in
  "$RACINE"|"$RACINE"/*)
    abandon "le workdir isolé ne doit jamais se trouver dans le dépôt ($BOOTSTRAP_WORKDIR)." ;;
esac

rm -rf "$BOOTSTRAP_WORKDIR"
mkdir -p "$BOOTSTRAP_WORKDIR/supabase"
cp supabase/config.toml "$BOOTSTRAP_WORKDIR/supabase/config.toml"

# Dans la COPIE uniquement : identifiant distinct (conteneurs séparés) et
# seed automatique coupé — le seed est appliqué plus bas, explicitement.
if command -v sed >/dev/null 2>&1; then
  sed -i.bak \
    -e "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" \
    "$BOOTSTRAP_WORKDIR/supabase/config.toml"
  # `enabled = true` de la section [db.seed] : première occurrence après elle.
  awk '
    /^\[db\.seed\]/ { dans_seed = 1 }
    /^\[/ && !/^\[db\.seed\]/ { dans_seed = 0 }
    dans_seed && /^enabled *=/ { print "enabled = false"; next }
    dans_seed && /^sql_paths *=/ { print "sql_paths = []"; next }
    { print }
  ' "$BOOTSTRAP_WORKDIR/supabase/config.toml" > "$BOOTSTRAP_WORKDIR/supabase/config.toml.tmp"
  mv "$BOOTSTRAP_WORKDIR/supabase/config.toml.tmp" "$BOOTSTRAP_WORKDIR/supabase/config.toml"
  rm -f "$BOOTSTRAP_WORKDIR/supabase/config.toml.bak"
fi

# Contrôles : le workdir isolé ne doit contenir NI migrations, NI seed.
# (`if` plutôt que `[[ ]] && abandon` : sous `set -e`, une condition fausse
# en fin de ligne interromprait le script.)
if [[ -d "$BOOTSTRAP_WORKDIR/supabase/migrations" ]]; then
  abandon "le workdir isolé contient un dossier migrations."
fi
if [[ -f "$BOOTSTRAP_WORKDIR/supabase/seed.sql" ]]; then
  abandon "le workdir isolé contient un seed."
fi
grep -q "^project_id = \"${PROJECT_ID}\"" "$BOOTSTRAP_WORKDIR/supabase/config.toml" \
  || abandon "project_id non isolé dans la copie."
grep -q '^enabled = false' "$BOOTSTRAP_WORKDIR/supabase/config.toml" \
  || abandon "seed automatique non désactivé dans la copie."

vert "  ✓ $BOOTSTRAP_WORKDIR"
vert "  ✓ config.toml copié, project_id isolé, seed automatique désactivé"
vert "  ✓ aucune migration dans le workdir : la CLI n'aura rien à appliquer"

# ---------------------------------------------------------------------
# 5-6. Démarrage et connexion — TOUJOURS avec le même --workdir
# ---------------------------------------------------------------------
titre "Démarrage de la pile locale"

$SUPABASE_CLI --workdir "$BOOTSTRAP_WORKDIR" start

DB_URL="$($SUPABASE_CLI --workdir "$BOOTSTRAP_WORKDIR" status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
[[ -n "$DB_URL" ]] || abandon "impossible de lire l'URL de la base locale."

# ---------------------------------------------------------------------
# 7. L'hôte DOIT être la machine locale
# ---------------------------------------------------------------------
HOTE="$(printf '%s' "$DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')"
case "$HOTE" in
  127.0.0.1|localhost|::1) vert "  ✓ base locale ($HOTE)" ;;
  *) abandon "hôte non local : « $HOTE ». Ce script refuse toute autre cible." ;;
esac

# ---------------------------------------------------------------------
# 7 bis. Le SQL s'exécute DANS le conteneur, jamais depuis la machine
# ---------------------------------------------------------------------
# Le client `psql` n'est pas installé sur toutes les machines (c'était le
# cas ici : « psql: command not found »), alors que le conteneur
# PostgreSQL de Supabase l'embarque forcément. On passe donc par
# `docker exec` : aucune dépendance à installer, et la connexion ne peut
# pas viser autre chose que le conteneur local qu'on vient de démarrer.
DB_CONTAINER="$(docker ps --format '{{.Names}}' \
  | grep -- "^supabase_db_${PROJECT_ID}\$" \
  | head -1)"

if [[ -z "$DB_CONTAINER" ]]; then
  rouge "  ✗ conteneur PostgreSQL introuvable"
  rouge "    conteneurs Supabase actuellement démarrés :"
  docker ps --format '      {{.Names}}' || rouge "      (aucun)"
  abandon "la pile locale n'expose pas supabase_db_${PROJECT_ID}."
fi
vert "  ✓ conteneur : $DB_CONTAINER"

# Applique un FICHIER SQL. `-i` transmet le fichier sur l'entrée standard :
# inutile de le copier dans le conteneur.
run_sql_file() {
  local file="$1"
  [[ -f "$file" ]] || abandon "fichier SQL introuvable : $file"
  echo "  Application SQL : $file"
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < "$file"
}

# Applique une requête CONSTRUITE par le script.
run_sql() {
  printf '%s\n' "$1" \
    | docker exec -i "$DB_CONTAINER" \
        psql -U postgres -d postgres -v ON_ERROR_STOP=1 --quiet
}

# ---------------------------------------------------------------------
# 8a-8b. Baseline puis Storage
# ---------------------------------------------------------------------
titre "Application du baseline (instantané du 24/07/2026)"

# Le baseline n'est PAS idempotent (voir l'explication sur les volumes plus
# haut). On refuse donc de l'appliquer sur une base déjà peuplée, avec un
# message clair — plutôt que d'échouer 1 500 lignes plus loin sur une erreur
# de clé primaire dont la cause n'a rien d'évident.
TABLES_EXISTANTES="$(run_sql "select count(*) from pg_tables where schemaname = 'public';" \
  | tr -d ' \n' | grep -oE '[0-9]+' | head -1)"
if [[ "${TABLES_EXISTANTES:-0}" != "0" ]]; then
  rouge "  ✗ le schéma public contient déjà $TABLES_EXISTANTES table(s)"
  abandon "la base locale n'est pas vierge. Relance ce script : il supprime conteneurs ET volumes avant de repartir."
fi
vert "  ✓ base vierge confirmée"

run_sql_file "$BASELINE_DIR/00_baseline_remote_schema.sql"
vert "  ✓ schéma : 45 tables, 107 policies, 5 fonctions"
run_sql_file "$BASELINE_DIR/01_post_baseline_storage.sql"
vert "  ✓ buckets Storage"

# ---------------------------------------------------------------------
# 8c. Les 25 migrations déjà contenues dans le baseline
# ---------------------------------------------------------------------
titre "Historique des migrations"

run_sql "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);" >/dev/null

enregistrer() {
  run_sql "insert into supabase_migrations.schema_migrations (version, name)
           values ('$1', '$2') on conflict (version) do nothing;" >/dev/null
}

incluses=0
for fichier in supabase/migrations/*.sql; do
  base="$(basename "$fichier")"
  [[ "$base" < "$PREMIERE_A_REJOUER" ]] || continue
  enregistrer "$(basename "$fichier" .sql | cut -d_ -f1)" "$(basename "$fichier" .sql | cut -d_ -f2-)"
  incluses=$((incluses + 1))
done
vert "  ✓ $incluses migrations marquées comme incluses dans le baseline (non rejouées)"

# ---------------------------------------------------------------------
# 8d-8e. Les migrations postérieures, enregistrées après succès
# ---------------------------------------------------------------------
titre "Migrations postérieures au baseline"

appliquees=0
for fichier in supabase/migrations/*.sql; do
  base="$(basename "$fichier")"
  [[ "$base" < "$PREMIERE_A_REJOUER" ]] && continue
  printf '  → %s\n' "$base"
  run_sql_file "$fichier"   # ON_ERROR_STOP + set -e : arrêt immédiat
  enregistrer "$(basename "$fichier" .sql | cut -d_ -f1)" "$(basename "$fichier" .sql | cut -d_ -f2-)"
  appliquees=$((appliquees + 1))
done
vert "  ✓ $appliquees migration(s) appliquée(s) puis enregistrée(s)"

# ---------------------------------------------------------------------
# 8f-8g. Seed synthétique, uniquement sur demande
# ---------------------------------------------------------------------
if $AVEC_SEED; then
  titre "Jeu de données synthétique"
  [[ -f supabase/seed.sql ]] || abandon "supabase/seed.sql introuvable."
  run_sql_file supabase/seed.sql
  vert "  ✓ seed appliqué (données fictives, @example.test uniquement)"
  if [[ -f supabase/tests/seed-verification.sql ]]; then
    run_sql_file supabase/tests/seed-verification.sql
    vert "  ✓ vérifications du seed"
  fi
fi

# ---------------------------------------------------------------------
# Récapitulatif
# ---------------------------------------------------------------------
titre "Base locale prête"
run_sql "select
  (select count(*) from pg_tables where schemaname='public') as tables,
  (select count(*) from pg_policies where schemaname='public') as policies,
  (select count(*) from supabase_migrations.schema_migrations) as migrations_enregistrees;"

titre "Contrôles du correctif de sécurité"

# Vérifications automatiques : plutôt que d'exiger une inspection manuelle,
# le script confirme lui-même que la migration de sécurité est bien EN PLACE
# dans la base locale. Sans cela, un échec silencieux plus haut laisserait
# croire que les tests portent sur le schéma corrigé.
run_sql "select
  (select count(*) from supabase_migrations.schema_migrations
     where version = '20260726220000')                                  as migration_securite,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='is_admin')                 as fonction_is_admin,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='get_my_coach_public_profile') as rpc_coach,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     where c.relname='profiles' and t.tgname='protect_role_column'
       and not t.tgisinternal)                                          as trigger_protection,
  (select count(*) from information_schema.role_table_grants
     where table_schema='public' and table_name='profiles' and grantee='anon') as privileges_anon,
  has_function_privilege('anon','public.get_my_coach_public_profile()','execute') as anon_execute_rpc;"

run_sql "select policyname, array_to_string(roles, ',') as roles, qual
  from pg_policies
 where schemaname='public' and tablename='profiles'
 order by policyname;"

cat <<'FIN'

Tests de sécurité (25 scénarios, se terminent par un ROLLBACK) :

  DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < scripts/sql/profiles-security-tests.sql

FIN
