#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# ATTRIBUTION — où va le temps d'une sauvegarde groupée ?
#
# À LANCER UNIQUEMENT SI LE BANC DÉPASSE L'OBJECTIF DE 4 s. Ce script ne juge
# rien : il mesure le coût du moteur par séance APPELÉ SEUL (une instruction,
# une transaction — l'ancien chemin), puis le compare au total de l'appel
# groupé. L'écart mesure ce que le regroupement fait gagner, et désigne
# l'étape responsable sans conjecture.
#
# RÉSULTAT DE RÉFÉRENCE (PG 17.11 local, décor représentatif, 25/10/2026) :
#   moteur seul, séance avec bloc cardio ....    377–526 ms (moy 450,4 · n=10)
#   moteur seul, séance strength seule ......    140–207 ms (moy 165,2 · n=10)
#   somme des 60 appels séparés ............. 11 670–13 050 ms (selon le tirage)
#   un seul appel groupé ....................  3 607,1 ms (max 3 680,9)
#   facteur de gain ......................... 3,2–3,6 ×
#
# LECTURE — L'ÉTAPE RESPONSABLE EST LA PRÉPARATION DES PLANS SOUS RLS, et elle
# est payée une fois par INSTRUCTION, pas par séance (la seule SELECT de
# `training_prescriptions` développe 167 SubPlans ; mesuré : ~970 ms des
# ~1 000 ms d'un premier appel, puis 28 ms une fois le plan en cache).
# Groupées dans une instruction unique, les 84 séances la partagent : le coût
# marginal retombe à ~40–60 ms par séance. La variable qui commande le temps
# total est donc le NOMBRE DE SÉANCES dans la charge, rien d'autre — et c'est
# elle qu'il faut borner si l'objectif est dépassé, pas le timeout.
#
# Usage : PSQL="…psql … -d propre" ./bench_attribution.sh
#         (variables : PROG, COACH, REPS)
# ════════════════════════════════════════════════════════════════════════════
set -u
: "${PSQL:?définir PSQL (commande psql complète, base incluse)}"
PROG="${PROG:-33330000-0000-4000-8000-000000000001}"
COACH="${COACH:-11111111-1111-4111-8111-111111111111}"
REPS="${REPS:-10}"
DIR="$(cd "$(dirname "$0")" && pwd)"

eval "$PSQL" -q -v ON_ERROR_STOP=1 -f "$DIR/bench_attribution_prepare.sql"

# ── séances témoins du programme cible : une avec bloc cardio, une sans ──
SEANCE_CARDIO=$(eval "$PSQL" -tA -v ON_ERROR_STOP=1 <<SQL
select ws.id from public.workout_sessions ws
  join public.program_weeks pw on pw.id = ws.program_week_id
  join public.training_blocks tb on tb.session_id = ws.id and tb.block_type = 'cardio'
 where pw.program_id = '$PROG' limit 1;
SQL
)
SEANCE_FORCE=$(eval "$PSQL" -tA -v ON_ERROR_STOP=1 <<SQL
select ws.id from public.workout_sessions ws
  join public.program_weeks pw on pw.id = ws.program_week_id
 where pw.program_id = '$PROG' and not ws.is_rest_day
   and not exists (select 1 from public.training_blocks tb
                    where tb.session_id = ws.id and tb.block_type = 'cardio')
 limit 1;
SQL
)
if [ -z "$SEANCE_CARDIO" ] || [ -z "$SEANCE_FORCE" ]; then
  echo "ATTRIBUTION: décor incomplet (séance cardio='$SEANCE_CARDIO', strength='$SEANCE_FORCE')." >&2
  echo "Appliquer perf_decor_representatif.sql avant ce script." >&2
  exit 1
fi
echo "séance cardio   : $SEANCE_CARDIO"
echo "séance strength : $SEANCE_FORCE"

mesure() { # $1 étape · $2 séance · $3 détail
  local r
  for r in $(seq 1 "$REPS"); do
    eval "$PSQL" -q -v ON_ERROR_STOP=1 <<SQL
set statement_timeout = '8s';
set role authenticated;
set request.jwt.claims = '{"sub":"$COACH","role":"authenticated"}';
call public.attr_mesurer('$1', $r, public.attr_charge_seance('$2', 'a$1$r'), '$3');
SQL
  done
}
mesure moteur_cardio   "$SEANCE_CARDIO" "1 seance avec bloc cardio"
mesure moteur_strength "$SEANCE_FORCE"  "1 seance strength seule"

# ── composition réelle des 12 premières semaines du programme cible ──
compter() { # $1 = condition sur nb_cardio / nb_blocs
  eval "$PSQL" -tA -v ON_ERROR_STOP=1 <<SQL
select count(*) from (select ws.id, count(tb.id) nb_blocs,
         count(tb.id) filter (where tb.block_type = 'cardio') nb_cardio
    from public.workout_sessions ws
    join public.program_weeks pw on pw.id = ws.program_week_id
    left join public.training_blocks tb on tb.session_id = ws.id
   where pw.program_id = '$PROG' and pw.week_number <= 12
   group by ws.id) q where $1;
SQL
}
N_CARDIO=$(compter "nb_cardio > 0")
N_FORCE=$(compter "nb_cardio = 0 and nb_blocs > 0")
echo "composition 12 semaines : $N_CARDIO cardio, $N_FORCE strength seule"

eval "$PSQL" -v n_cardio="$N_CARDIO" -v n_force="$N_FORCE" <<'SQL'
\pset footer off
\echo ''
\echo '════ COÛT DU MOTEUR PAR SÉANCE, APPELÉ SEUL (save_training_session_blocks) ════'
select etape, detail, count(*) n, min(ms) min_ms, round(avg(ms),1) moy_ms, max(ms) max_ms
  from public.attr group by etape, detail order by etape;
\echo ''
\echo '════ APPELS SÉPARÉS (ancien chemin) vs 1 APPEL GROUPÉ (lot B) ════'
with m as (select avg(ms) filter (where etape = 'moteur_cardio')   as cardio,
                  avg(ms) filter (where etape = 'moteur_strength') as force
             from public.attr),
     g as (select round(avg(ms), 1) as moy, max(ms) as max_ms
             from public.bench_mesures
            where scenario like '84 séances — contenu modifié%')
select :n_cardio as seances_cardio, :n_force as seances_strength,
       round((:n_cardio * m.cardio + :n_force * m.force)::numeric, 1) as somme_appels_separes_ms,
       g.moy as appel_groupe_moy_ms, g.max_ms as appel_groupe_max_ms,
       round(((:n_cardio * m.cardio + :n_force * m.force) / g.moy)::numeric, 2) as facteur_de_gain
  from m, g;
\echo '(les jours de repos n appellent pas le moteur : ils ne comptent pas dans la somme)'
SQL
