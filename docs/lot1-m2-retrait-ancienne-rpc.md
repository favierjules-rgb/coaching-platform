# LOT 1 / M2 — retrait de `create_appointment_atomic`

**Ce document n'est pas une migration, et son SQL ne doit PAS être copié dans
`supabase/migrations/` avant la décision décrite au §3.**

La raison est mécanique : `supabase db push` applique *toutes* les migrations en
attente. Si le fichier M2 existait déjà dans le dossier, le prochain `push` —
fait pour n'importe quelle autre raison — appliquerait M1 et M2 ensemble, et le
découpage n'aurait servi à rien. Tant que ce fichier n'existe pas, cette
confusion est impossible.

---

## 1. Pourquoi M2 existe séparément

M1 (`supabase/migrations/20261115090000_lot1_multi_coach_ajout.sql`) ouvre les
deux nouveaux points d'entrée et **conserve** `create_appointment_atomic`,
réduite à un garde-fou qui refuse tout porteur de fiche élève et délègue le
chemin staff à `creer_rendez_vous_staff`.

Cette conservation existe pour une seule raison : l'application en service
(`65cc297`) appelle encore cette fonction, sur sa signature à 10 arguments —
vérifié par `git show 65cc297:lib/supabase/appointments.ts`. La supprimer dans
la même migration exigerait une simultanéité stricte entre l'application du SQL
et la promotion du déploiement, simultanéité qui n'existe pas.

M2 est le geste qui **ferme le retour arrière**. Après elle, redéployer
`65cc297` ne rétablit plus rien : la fonction n'existe plus.

---

## 2. SQL préparé

```sql
-- ============================================================================
-- LOT 1 / M2 — RETRAIT DÉFINITIF DE `create_appointment_atomic`
--
-- ⚠️ LES DEUX SIGNATURES, PAS UNE. La 10-arguments est celle que M1 a conservée
-- en garde-fou ; la 11-arguments n'a jamais été appliquée en production (elle
-- n'existe que sur les bases de test où la migration monolithique d'origine
-- avait été jouée). Laisser survivre l'une ou l'autre rendrait appelable une
-- surcharge PostgreSQL, et donc à nouveau accessible un point d'entrée à double
-- intention.
--
-- ⚠️ `drop` SANS `cascade`. Les corps plpgsql qui nomment cette fonction
-- résolvent le nom à l'exécution : il n'y a aucune dépendance catalogue à
-- casser. Un `cascade` ici détruirait des objets sans rapport.
--
-- ⚠️ CE QUI DOIT ÊTRE VRAI AVANT DE L'APPLIQUER est écrit au §3 de
-- `docs/lot1-m2-retrait-ancienne-rpc.md`. En particulier : plus aucun
-- `calendar_parcours_obsolete` dans les journaux, signe qu'aucun onglet n'est
-- resté sur l'ancienne page.
-- ============================================================================
drop function if exists public.create_appointment_atomic(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
);
drop function if exists public.create_appointment_atomic(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
);

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_appointment_atomic';
  if v_n <> 0 then
    raise exception 'LOT1/M2 : % signature(s) de create_appointment_atomic subsiste(nt) — surcharge appelable', v_n;
  end if;

  -- Les deux portes doivent être là, chacune en une seule signature : M2 ne
  -- doit jamais s'appliquer sur une base où M1 n'aurait pas tourné.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserver_creneau_eleve';
  if v_n <> 1 then
    raise exception 'LOT1/M2 : reserver_creneau_eleve absente ou en double (%) — M1 n''a pas tourne', v_n;
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'creer_rendez_vous_staff';
  if v_n <> 1 then
    raise exception 'LOT1/M2 : creer_rendez_vous_staff absente ou en double (%) — M1 n''a pas tourne', v_n;
  end if;

  -- Et les policies P13-B n'ont pas bougé.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'appointments' and cmd <> 'SELECT';
  if v_n <> 0 then
    raise exception 'LOT1/M2 : % policy(ies) d''ecriture directe sur appointments', v_n;
  end if;

  raise notice 'LOT1/M2 : ancienne RPC retiree, deux portes en place.';
end $$;
```

**Nom de fichier à créer le jour J** :
`supabase/migrations/<AAAAMMJJ>090000_lot1_multi_coach_retrait.sql`, avec une
estampille strictement postérieure à `20261115090000` — le point 3 du contrat
de migrations l'exige.

---

## 3. Conditions à réunir avant de créer ce fichier

Toutes, sans exception :

1. M1 appliquée en production, et la nouvelle application promue.
2. Les huit tests de fumée passés (voir §4).
3. Au moins **une vraie réservation élève** et **une vraie création manuelle**
   effectuées en production depuis la promotion.
4. `select count(*) from public.appointments where coach_id is null` vaut
   toujours **0**.
5. **Aucun `calendar_parcours_obsolete`** dans les journaux depuis plusieurs
   heures — signe qu'aucun onglet n'est resté sur l'ancienne page.
6. **Aucun `calendar_identite_ambigue`, jamais.** S'il en apparaît un, un compte
   à double identité existe : s'arrêter et traiter ce compte d'abord.
7. **24 à 48 h** écoulées depuis la promotion.
8. Décision explicite de fermer le retour arrière.

---

## 4. Les huit tests de fumée, après la promotion de M1

1. Un élève réel réserve un créneau → créé, `coach_id` = son coach titulaire,
   type et lieu venant de la disponibilité.
2. Le même créneau rejoué → `calendar_conflict`.
3. L'admin crée une séance manuelle pour un élève → créée, `coach_id` = coach
   titulaire de l'élève.
4. L'admin reporte cette séance → l'original annulé, le nouveau au même coach.
5. Un élève annule → statut `cancelled`, créneau rendu.
6. `select count(*) from public.appointments where coach_id is null` → **0**.
7. Aucun `calendar_identite_ambigue` dans les journaux.
8. `/admin/calendrier` affiche toujours l'aperçu des créneaux élèves.

---

## 5. Ce que M2 change pour le contrat de migrations

Au moment de créer le fichier, dans le **même commit** :

| Fichier | Changement |
|---|---|
| `scripts/tests/contrat-migrations.mts` | ajouter `MIGRATION_LOT1_M2_RETRAIT`, l'inscrire **après** `MIGRATION_LOT1_M1_AJOUT` dans `MIGRATIONS_APRES_C0_1` |
| `NOMBRE_DE_MIGRATIONS` | **125 → 126**, en face du nom, jamais seul |
| `supabase/baseline/manifest.json` | ajouter le nom à `migrations_post_baseline_attendues` |
| `supabase/tests/lot1_affectation_multi_coach_checklist.sql` | rien à changer : la checklist détecte l'état et bascule seule (`v_etape_m1`) |
| `scripts/tests/affectation-multi-coach.mts` | `TEXTE-16` passe de « M2 est documentée, pas appliquée » à « M2 contient les deux `drop` et l'assertion à zéro » |

---

## 6. Après M2 — ce qui devient du code mort

- Les motifs `parcours_obsolete` et `identite_ambigue` de
  `lib/supabase/appointments.ts` : plus aucune RPC ne les lève. Un appel depuis
  un très vieil onglet donnerait `PGRST202` (fonction introuvable), donc le
  motif `autre`. À retirer dans un lot de nettoyage, pas dans M2.
- `docs/lot1-reouverture-ancien-parcours.sql` (D4) devient inapplicable — il
  refuse de s'exécuter de lui-même, par conception.
