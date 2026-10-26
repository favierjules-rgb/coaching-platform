#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# PILOTE DE RÉPÉTITIONS — SAUVEGARDE GROUPÉE
#
# UNE RÉPÉTITION = UNE SESSION psql = UNE INSTRUCTION DE PLUS HAUT NIVEAU,
# donc un plafond `statement_timeout` de 8 s par sauvegarde, comme une requête
# PostgREST. Une boucle SQL aurait mis les N répétitions sous UN SEUL plafond.
#
# ⚠️ LE TIMEOUT N'EST JAMAIS RELEVÉ. 8 s est la valeur du rôle `authenticated`
# en production. Un dépassement est un ÉCHEC (SQLSTATE 57014), pas une mesure.
#
# Usage :
#   PSQL="/usr/lib/postgresql/17/bin/psql -h /home/pgtest/pg17run -p 5434 -U postgres -d propre" \
#     ./bench_sauvegarde_groupee.sh
#   # base de validation isolée distante :
#   PSQL="psql \"$POSTGRES_URL_NON_POOLING\"" ./bench_sauvegarde_groupee.sh
#
# Variables : PROG (programme cible), COACH (sub du JWT), REPS (répétitions).
# ════════════════════════════════════════════════════════════════════════════
set -u
: "${PSQL:?définir PSQL (commande psql complète, base incluse)}"
PROG="${PROG:-33330000-0000-4000-8000-000000000001}"
COACH="${COACH:-11111111-1111-4111-8111-111111111111}"
REPS="${REPS:-7}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "── décor du banc ──"
eval "$PSQL" -v ON_ERROR_STOP=1 -q -f "$DIR/bench_sauvegarde_groupee_prepare.sql"

# $1 clé · $2 libellé · $3 expression SQL de la charge · $4 nb de séances · $5 répétitions
mesurer() {
  local cle="$1" libelle="$2" expr="$3" n="$4" reps="$5" r
  for r in $(seq 1 "$reps"); do
    eval "$PSQL" -v ON_ERROR_STOP=1 -q <<SQL
set statement_timeout = '8s';
set role authenticated;
set request.jwt.claims = '{"sub":"$COACH","role":"authenticated"}';
delete from public.bench_charge where cle = '$cle';
insert into public.bench_charge (cle, charge, nb_seances)
values ('$cle', ${expr//@RANG@/$r}, $n);
call public.bench_mesurer('$cle', '$libelle', $r);
SQL
    printf '  %s · répétition %d/%d\n' "$cle" "$r" "$reps"
  done
}

J="'r@RANG@-' || to_char(clock_timestamp(), 'HH24MISSMS')"

echo "── S1 : 1 séance, champ simple ──"
mesurer s1 '1 séance — champ simple' \
  "public.bench_charge_modif('$PROG', 1, false, $J)" 1 "$REPS"

echo "── S2 : 7 séances (une semaine modifiée) ──"
mesurer s2 '7 séances — une semaine modifiée' \
  "public.bench_charge_modif('$PROG', 7, false, $J)" 7 "$REPS"

echo "── S3 : 28 séances (4 semaines) ──"
mesurer s3 '28 séances — 4 semaines' \
  "public.bench_charge_modif('$PROG', 28, false, $J)" 28 "$REPS"

echo "── S4 : 84 séances, contenu inchangé (cas fréquent sur 12 semaines) ──"
mesurer s4 '84 séances — contenu inchangé' \
  "public.bench_charge_modif('$PROG', 84, false, $J)" 84 "$REPS"

echo "── S5 : 84 séances, contenu réellement modifié (PIRE CAS) ──"
mesurer s5 '84 séances — contenu modifié (pire cas)' \
  "public.bench_charge_modif('$PROG', 84, true, $J)" 84 "$REPS"

# ⚠️ EN DERNIER, ET À SEMAINE CIBLE VARIABLE. Chaque répétition CRÉE une
# semaine : réutiliser la même cible ferait buter la 2e sur la contrainte
# d'unicité (program_id, week_number), et faire grandir le programme avant S1
# à S5 aurait faussé leur volumétrie.
echo "── S6 : ajout d’une semaine par duplication (7 seances creees) ──"
mesurer s6 'ajout d’une semaine par duplication' \
  "public.bench_charge_duplication('$PROG', 1, 12 + @RANG@)" 7 "$REPS"

echo
eval "$PSQL" -f "$DIR/bench_sauvegarde_groupee_rapport.sql"
