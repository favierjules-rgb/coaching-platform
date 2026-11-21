#!/usr/bin/env bash
# =============================================================================
# BANC SQL JETABLE — stabilisation B1 / B2
#
# Ce que ce script fait, et pourquoi il existe
# -----------------------------------------------------------------------------
# `scripts/tests/stabilisation-b1-b2.mts` lit des FICHIERS : il prouve que les
# bonnes lignes sont écrites, jamais que les privilèges sont retirés ni que la
# RPC découpe correctement. Ces deux propriétés demandent une base.
#
# Ce script en fabrique une, l'utilise, et la détruit :
#   1. il crée un cluster PostgreSQL NEUF dans un dossier temporaire ;
#   2. il y pose un décor minimal, EXTRAIT DU DÉPÔT (voir plus bas) ;
#   3. il applique les deux migrations de stabilisation, dans l'ordre ;
#   4. il exécute `supabase/tests/stabilisation_b1_b2_checklist.sql` ;
#   5. il rejoue trois CONTRE-ÉPREUVES et exige qu'elles ÉCHOUENT ;
#   6. il vérifie qu'aucun résidu ne subsiste ;
#   7. il arrête et supprime le cluster, quoi qu'il arrive.
#
# ⚠️ AUCUN IDENTIFIANT DE PRODUCTION N'EST UTILISÉ, ET CE N'EST PAS UNE
# PROMESSE : toutes les variables d'environnement qui pourraient désigner une
# autre base sont EFFACÉES au démarrage (`PGHOST`, `DATABASE_URL`, …), et le
# cluster n'écoute sur aucun port TCP (`listen_addresses=''`) — il n'est
# joignable que par sa propre socket, dans son dossier temporaire.
#
# ⚠️ LE DÉCOR EST EXTRAIT, PAS RECOPIÉ. Les tables `coaches` et `students`
# viennent du `CREATE TABLE` du baseline, contraintes `CHECK` comprises ; la
# version FAUTIVE de la RPC vient de la migration 20260726220000. C'est ce qui
# a manqué le 19/11/2026 : un décor écrit à la main, sans les `not null` réels,
# avait laissé passer deux défauts de la checklist.
#
# Usage :
#   bash scripts/tests/sql/b1b2-base-jetable.sh
#   PG_BIN=/opt/homebrew/opt/postgresql@16/bin bash scripts/tests/sql/b1b2-base-jetable.sh
#
# Codes de sortie : 0 succès — 1 échec d'un contrôle — 2 PostgreSQL indisponible.
# =============================================================================
set -u

# --- 1. Isolation : rien ne doit pouvoir désigner une base existante ---------
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGOPTIONS \
      DATABASE_URL SUPABASE_DB_URL POSTGRES_URL 2>/dev/null || true

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASELINE="$RACINE/supabase/baseline/00_baseline_remote_schema.sql"
MIGRATION_RPC_ORIGINE="$RACINE/supabase/migrations/20260726220000_fix_profiles_role_escalation.sql"
MIGRATION_B2="$RACINE/supabase/migrations/20261119090000_b2_revoquer_anon_fonctions_m1.sql"
MIGRATION_B1="$RACINE/supabase/migrations/20261119091000_b1_decoupage_nom_coach.sql"
CHECKLIST="$RACINE/supabase/tests/stabilisation_b1_b2_checklist.sql"

for f in "$BASELINE" "$MIGRATION_RPC_ORIGINE" "$MIGRATION_B2" "$MIGRATION_B1" "$CHECKLIST"; do
  [ -r "$f" ] || { echo "FICHIER INTROUVABLE : $f"; exit 1; }
done

# --- 2. Localisation des binaires PostgreSQL ---------------------------------
trouver_bin() {
  if [ -n "${PG_BIN:-}" ] && [ -x "$PG_BIN/initdb" ]; then echo "$PG_BIN"; return; fi
  if command -v pg_config >/dev/null 2>&1; then
    d="$(pg_config --bindir 2>/dev/null || true)"
    [ -n "$d" ] && [ -x "$d/initdb" ] && { echo "$d"; return; }
  fi
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@*/bin /opt/homebrew/bin; do
    [ -x "$d/initdb" ] && { echo "$d"; return; }
  done
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  echo ""
}
BIN="$(trouver_bin)"
if [ -z "$BIN" ]; then
  cat <<'FIN'
PostgreSQL INDISPONIBLE — ce banc ne peut pas s'exécuter ici.

Il lui faut `initdb`, `pg_ctl` et `psql` en local (PostgreSQL 15 ou plus).
  macOS   : brew install postgresql@16
  Debian  : apt-get install postgresql-16
  ailleurs: poser PG_BIN=/chemin/vers/bin

Ce n'est PAS un échec des corrections : c'est l'absence de l'outil. Les
contrôles d'ACL et de découpage restent alors NON VÉRIFIÉS — ne pas les
déclarer conformes sur la seule foi de `npm run test:stabilisation-b1-b2`,
qui ne lit que des fichiers.
FIN
  exit 2
fi

# --- 3. `initdb` refuse de tourner en root : on délègue à l'utilisateur postgres
PREFIXE=""
if [ "$(id -u)" = "0" ]; then
  if id -u postgres >/dev/null 2>&1; then
    PREFIXE="postgres"
  else
    echo "Lancé en root sans utilisateur « postgres » : PostgreSQL refusera de démarrer."
    echo "Relancer en utilisateur non privilégié, ou créer l'utilisateur postgres."
    exit 2
  fi
fi
lancer() {  # lancer "<commande shell>"
  if [ -n "$PREFIXE" ]; then su "$PREFIXE" -c "$1"; else bash -c "$1"; fi
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/b1b2-jetable.XXXXXX")"
PGDATA="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$PGDATA" "$SOCK"
[ -n "$PREFIXE" ] && chown -R "$PREFIXE" "$TMP"

nettoyer() {
  lancer "$BIN/pg_ctl -D '$PGDATA' stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap nettoyer EXIT INT TERM

PSQL="$BIN/psql -h '$SOCK' -d postgres -v ON_ERROR_STOP=1 -q"
PSQL_LAXE="$BIN/psql -h '$SOCK' -d postgres -q"

echo "── banc SQL jetable B1/B2 ──"
echo "   PostgreSQL : $("$BIN/psql" --version)"
echo "   cluster    : $PGDATA  (détruit à la sortie)"

lancer "$BIN/initdb -D '$PGDATA' -A trust --locale=C.UTF-8 --encoding=UTF8" >"$TMP/initdb.log" 2>&1 \
  || { echo "ÉCHEC initdb — voir $TMP/initdb.log"; cat "$TMP/initdb.log"; exit 1; }
lancer "$BIN/pg_ctl -D '$PGDATA' -o \"-c listen_addresses='' -k '$SOCK'\" -l '$TMP/pg.log' start -w" >/dev/null 2>&1 \
  || { echo "ÉCHEC démarrage — voir $TMP/pg.log"; cat "$TMP/pg.log"; exit 1; }

# --- 4. Décor : extrait du dépôt, pas réécrit --------------------------------
DECOR="$TMP/decor.sql"
{
  echo "-- Rôles Supabase"
  echo "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
  echo "create schema auth;"
  echo "create or replace function auth.uid() returns uuid language sql stable as \$fn\$"
  echo "  select coalesce("
  echo "    nullif(current_setting('request.jwt.claim.sub', true), ''),"
  echo "    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')"
  echo "  )::uuid"
  echo "\$fn\$;"
  echo
  echo "-- Tables EXTRAITES du baseline : contraintes CHECK et NOT NULL réelles."
  for t in coaches students; do
    awk -v t="$t" '
      $0 ~ "CREATE TABLE.*\"?public\"?\\.\"?" t "\"?" { dedans=1 }
      dedans { print }
      dedans && /^\);$/ { exit }
    ' "$BASELINE"
  done
  echo
  echo "-- Version FAUTIVE de la RPC, EXTRAITE de 20260726220000 : c'est elle que"
  echo "-- la migration B1 remplace, et elle sert de contre-épreuve."
  awk '
    /create or replace function public\.get_my_coach_public_profile\(\)/ { dedans=1 }
    dedans { print }
    dedans && /^\$\$;$/ { exit }
  ' "$MIGRATION_RPC_ORIGINE"
  echo
  echo "-- Souches aux signatures exactes des trois fonctions de M1. Les corps ne"
  echo "-- sont pas reproduits : la migration B2 ne touche aucun corps. La"
  echo "-- correspondance des signatures avec M1 est figée par ACL-07 du harnais."
  cat <<'STUBS'
create function public.calendar_has_conflict_pour_coach(
  p_coach_id uuid, p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_appointment_id uuid default null, p_exclude_coach_event_id uuid default null
) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$ select false $fn$;

create function public.reserver_creneau_eleve(
  p_availability_id uuid, p_start_at timestamptz, p_end_at timestamptz, p_ics_uid text
) returns uuid language sql security definer set search_path to 'public','pg_temp' as $fn$ select null::uuid $fn$;

create function public.creer_rendez_vous_staff(
  p_student_id uuid, p_title text, p_description text, p_appointment_type text,
  p_start_at timestamptz, p_end_at timestamptz, p_location text,
  p_meeting_url text, p_ics_uid text, p_status text default 'confirmed'
) returns uuid language sql security definer set search_path to 'public','pg_temp' as $fn$ select null::uuid $fn$;

create function public.calendar_has_conflict(
  p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_appointment_id uuid default null, p_exclude_coach_event_id uuid default null
) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$ select false $fn$;

-- ACL de référence de l'ancienne fonction (20260726121000) : ni anon, ni authenticated.
revoke all on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) from public;
revoke execute on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) from anon, authenticated;
grant execute on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) to service_role;

-- Privilèges par défaut de Supabase : EXECUTE accordé NOMMÉMENT aux trois rôles.
grant execute on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) to anon, authenticated, service_role;
grant execute on function public.creer_rendez_vous_staff(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.get_my_coach_public_profile() to authenticated, service_role;

-- Et ce que M1 écrit, qui ne suffit pas à retirer `anon` :
revoke all on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) from public;
revoke all on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.creer_rendez_vous_staff(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) from public;
STUBS
} > "$DECOR"
[ -n "$PREFIXE" ] && chown "$PREFIXE" "$DECOR"

ECHECS=0
etape() { printf '   %-62s' "$1"; }
ok()    { echo "OK"; }
ko()    { echo "ÉCHEC"; ECHECS=$((ECHECS+1)); }

etape "décor extrait du dépôt"
lancer "$PSQL -f '$DECOR'" >"$TMP/decor.log" 2>&1 && ok || { ko; sed 's/^/      /' "$TMP/decor.log"; }

# --- 5. Les deux migrations, dans l'ordre des horodatages --------------------
for m in "$MIGRATION_B2" "$MIGRATION_B1"; do
  [ -n "$PREFIXE" ] && chmod a+r "$m"
  etape "migration $(basename "$m")"
  lancer "$PSQL -f '$m'" >"$TMP/mig.log" 2>&1 && ok || { ko; sed 's/^/      /' "$TMP/mig.log"; }
done

# --- 6. La checklist, qui doit RÉUSSIR --------------------------------------
[ -n "$PREFIXE" ] && chmod a+r "$CHECKLIST"
etape "checklist complète (doit réussir)"
if lancer "$PSQL -f '$CHECKLIST'" >"$TMP/cl.log" 2>&1; then
  ok
  grep -E 'NOTICE' "$TMP/cl.log" | sed 's/^.*NOTICE:  /      · /'
else
  ko; sed 's/^/      /' "$TMP/cl.log"
fi

# ⚠️ LA TERMINAISON SE VÉRIFIE SUR LE FICHIER, PAS SUR LA SORTIE. `psql -q` ne
# réaffiche pas les étiquettes de commande : chercher « ROLLBACK » dans le
# journal rendait ce contrôle faussement rouge. On interroge donc la dernière
# instruction du fichier, et l'EFFET du rollback est contrôlé séparément par le
# test de non-résidu, en fin de banc.
etape "la checklist se termine bien par ROLLBACK"
DERNIERE="$(sed 's/--.*$//' "$CHECKLIST" | tr -s '[:space:]' '\n' | grep -v '^$' | tail -1)"
if [ "$DERNIERE" = "rollback;" ]; then
  ok
else
  ko; echo "      dernière instruction : « $DERNIERE » au lieu de « rollback; »"
fi
etape "aucun COMMIT dans la checklist"
if sed 's/--.*$//' "$CHECKLIST" | grep -qiE '(^|[[:space:]])commit[[:space:]]*;'; then
  ko; echo "      un commit figure dans le fichier"
else
  ok
fi

# --- 7. Contre-épreuves : chacune doit faire ROUGIR la checklist ------------
contre_epreuve() {  # contre_epreuve "<libellé>" "<sql de sabotage>" "<motif attendu>" "<sql de remise en état>"
  etape "contre-épreuve : $1"
  lancer "$PSQL -c \"$2\"" >/dev/null 2>&1 || { ko; echo "      sabotage impossible"; return; }
  if lancer "$PSQL -f '$CHECKLIST'" >"$TMP/ce.log" 2>&1; then
    ko; echo "      la checklist est restée VERTE alors que le défaut est réintroduit"
  elif grep -q "$3" "$TMP/ce.log"; then
    ok; grep -oE "B1/B2 — [^\"]*" "$TMP/ce.log" | head -1 | sed 's/^/      · /'
  else
    ko; echo "      a échoué, mais pas sur « $3 » :"; grep -E 'ERROR' "$TMP/ce.log" | head -2 | sed 's/^/      /'
  fi
  lancer "$PSQL -c \"$4\"" >/dev/null 2>&1 || true
}

# 7a. B1 — on réinstalle l'expression fautive extraite de la migration d'origine.
SABOTAGE_B1="$TMP/sabotage_b1.sql"
awk '
  /create or replace function public\.get_my_coach_public_profile\(\)/ { dedans=1 }
  dedans { print }
  dedans && /^\$\$;$/ { exit }
' "$MIGRATION_RPC_ORIGINE" > "$SABOTAGE_B1"
[ -n "$PREFIXE" ] && chown "$PREFIXE" "$SABOTAGE_B1"
etape "contre-épreuve : ancienne RPC réinstallée"
lancer "$PSQL -f '$SABOTAGE_B1'" >/dev/null 2>&1 || { ko; echo "      sabotage impossible"; }
if lancer "$PSQL -f '$CHECKLIST'" >"$TMP/ce1.log" 2>&1; then
  ko; echo "      la checklist est restée VERTE avec l'ancienne RPC"
elif grep -q 'B1-03' "$TMP/ce1.log"; then
  ok; grep -oE 'B1/B2 — B1-03 : [^"]*' "$TMP/ce1.log" | head -1 | sed 's/^/      · /'
else
  ko; grep -E 'ERROR' "$TMP/ce1.log" | head -2 | sed 's/^/      /'
fi
lancer "$PSQL -f '$MIGRATION_B1'" >/dev/null 2>&1 || true

# 7b. B2 — on redonne EXECUTE à anon.
contre_epreuve "EXECUTE rendu à anon" \
  "grant execute on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) to anon;" \
  "B2-01" \
  "revoke execute on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) from anon;"

# 7c. B2 — on redonne EXECUTE à PUBLIC : c'est le scénario qui bloquait la
#     migration avant qu'elle ne révoque PUBLIC elle-même (anomalie A5).
contre_epreuve "EXECUTE rendu à PUBLIC (anon redevient capable)" \
  "grant execute on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) to public;" \
  "B2-01" \
  "revoke execute on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) from public;"

# --- 8. Scénario A5 : PUBLIC détient EXECUTE, la migration doit s'en sortir --
etape "A5 : PUBLIC détient EXECUTE, B2 réappliquée"
lancer "$PSQL -c \"grant execute on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) to public; grant execute on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) to public; grant execute on function public.creer_rendez_vous_staff(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) to public;\"" >/dev/null 2>&1
if lancer "$PSQL -f '$MIGRATION_B2'" >"$TMP/a5.log" 2>&1; then ok; else ko; sed 's/^/      /' "$TMP/a5.log"; fi

etape "A5 : checklist de nouveau verte"
lancer "$PSQL -f '$CHECKLIST'" >"$TMP/a5cl.log" 2>&1 && ok || { ko; sed 's/^/      /' "$TMP/a5cl.log"; }

# --- 9. ACL finales, affichées pour le compte rendu -------------------------
echo "   ── ACL finales ──"
lancer "$PSQL -At -c \"select rpad(p.proname, 34) || ' : ' || coalesce(array_to_string(p.proacl, ' | '), '(defaut)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('calendar_has_conflict','calendar_has_conflict_pour_coach','reserver_creneau_eleve','creer_rendez_vous_staff','get_my_coach_public_profile') order by p.proname;\"" 2>/dev/null | sed 's/^/      /'

# --- 10. Non-résidu : la checklist n'a rien laissé --------------------------
etape "aucun résidu après ROLLBACK"
RESIDU="$(lancer "$PSQL -At -c \"select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'b1b2\\_%')::text || '/' || (select count(*) from public.coaches)::text || '/' || (select count(*) from public.students)::text;\"" 2>/dev/null)"
if [ "$RESIDU" = "0/0/0" ]; then ok; else ko; echo "      fonctions b1b2_*/coachs/élèves restants : $RESIDU"; fi

echo "── bilan ──"
if [ "$ECHECS" -eq 0 ]; then
  echo "   TOUT EST VERT. Le cluster jetable est détruit."
  exit 0
fi
echo "   $ECHECS contrôle(s) en échec."
exit 1
