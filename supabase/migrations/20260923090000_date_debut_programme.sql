-- ═══════════════════════════════════════════════════════════════════════════
-- LA DATE DE DÉBUT D'UN PROGRAMME APPARTIENT À L'AFFECTATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NI À L'ÉLÈVE, NI AU PROGRAMME, ET C'EST TOUT L'OBJET DE CE LOT.
-- Le calcul de semaine s'ancrait jusqu'ici sur `students.start_date` — le
-- début du SUIVI. Mesuré sur la base de production le 08/09/2026 : cette
-- colonne vaut son propre `created_at` dans 11 cas sur 15, le
-- `DEFAULT CURRENT_DATE` ayant simplement enregistré le jour de création de
-- la fiche. Conséquence observée : une élève ayant reçu son programme LE JOUR
-- MÊME se voyait annoncer « Semaine 5 / 12 ».
--
-- ⚠️ `assigned_at` N'EST PAS LA RÉPONSE NON PLUS. C'est l'horodatage du clic
-- du coach. Sur le cas de référence (ERWAN) il donnerait la semaine 2, quand
-- la réponse validée par le propriétaire du projet est la semaine 4. Une
-- affectation peut être préparée d'avance ou saisie en retard : la date à
-- laquelle le programme COMMENCE est une décision de coaching, pas un
-- horodatage technique. Elle n'existait nulle part. Cette colonne l'accueille.
--
-- ⚠️ `date` ET NON `timestamptz`. Un début de programme est une date
-- calendaire : personne ne fait démarrer un programme à 14h37. Stocker un
-- instant rouvrirait exactement le défaut de fuseau que ce même lot corrige
-- dans `daysBetween` — une semaine qui bascule à 02:00 au lieu de minuit.
--
-- ⚠️ NULLABLE, ET AUCUN BACKFILL. Les 15 affectations existantes la reçoivent
-- à NULL. Les remplir avec `assigned_at` inventerait une histoire, et une
-- histoire fausse : c'est le geste que l'audit a explicitement écarté. NULL
-- signifie « affectation non régularisée » — l'interface admin le SIGNALE au
-- lieu de le masquer, et `origineDeLAncre()` rend « repli-suivi » pour que ce
-- repli reste visible plutôt que de devenir la nouvelle norme silencieuse.
--
-- ⚠️ AUCUNE POLICY MODIFIÉE. La colonne hérite des règles de `assignments`,
-- qui restent intactes : une colonne ajoutée n'élargit aucun accès.

alter table public.assignments
  add column if not exists program_start_date date;

comment on column public.assignments.program_start_date is
  'Date calendaire à laquelle CE programme commence pour CET élève. Seule ancre du calcul de semaine en mode individuel ; le mode groupe garde programs.group_start_date. NULL = affectation non régularisée, signalée à l''admin. Ne jamais dériver de assigned_at, de students.start_date ni du premier entraînement : aucune des trois n''est la date de début.';

-- Index PARTIEL, et volontairement étroit : il ne sert qu'à lister les
-- affectations de programme restant à régulariser. Indexer la colonne entière
-- coûterait de l'écriture sur chaque affectation pour une question qu'on ne
-- pose jamais (« quelles affectations commencent le 17/08 ? »).
create index if not exists assignments_programme_sans_date_idx
  on public.assignments (student_id)
  where content_type = 'programme' and program_start_date is null;
