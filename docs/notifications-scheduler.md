# Planificateur des notifications — `pg_cron` → `pg_net` → `/api/cron/notifications`

## Pourquoi cet ordre SQL n'est pas une migration

`cron.schedule()` doit porter l'en-tête `Authorization: Bearer <NOTIFICATION_CRON_SECRET>`.
Une migration est versionnée dans Git : y écrire le secret le publierait à
quiconque a accès au dépôt, aujourd'hui ou plus tard. L'ordre ci-dessous est
donc exécuté **une seule fois, à la main**, dans l'éditeur SQL Supabase — et
le secret n'existe que dans Supabase Vault et dans les variables Vercel.

C'est aussi la raison pour laquelle ce chantier n'a ajouté **aucune
migration** : les cinq tables du socle suffisaient.

## État réel de la base distante — vérifié le 10/08/2026

Projet `Coaching plateforme` (`yesuolzfmxgnaznhbcnw`), lecture seule :

| Extension | Version installée | Schéma | Verdict |
|---|---|---|---|
| `pg_cron` | 1.6.4 | `pg_catalog` | **déjà active** |
| `pg_net` | 0.20.3 | `public` (fonctions dans `net`) | **déjà active** |
| `supabase_vault` | 0.3.1 | `vault` | **déjà active** |

Les fonctions existent bien sous les noms utilisés plus bas : `cron.schedule`,
`net.http_post`, `vault.create_secret`. `select … from cron.job` rend une
liste **vide** : aucune tâche n'est encore programmée.

**Il n'y a donc rien à activer.** Ne pas rejouer de `create extension` : ce
serait modifier une extension existante sans raison.

## Prérequis restant

`NOTIFICATION_CRON_SECRET` défini dans les variables d'environnement Vercel
(Preview **et** Production). Distinct de `CRON_SECRET`, qui reste réservé aux
tâches Vercel existantes (purges de vidéos).

## Poser le secret dans Vault

```sql
select vault.create_secret(
  'LE_SECRET_ICI',            -- la même valeur que NOTIFICATION_CRON_SECRET
  'notification_cron_secret',
  'En-tête Authorization du planificateur de notifications'
);
```

## Programmer l'appel, chaque minute

Remplacer `https://ton-domaine` par l'URL de l'application (la même que
`NEXT_PUBLIC_APP_URL`).

```sql
select cron.schedule(
  'notifications-chaque-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://ton-domaine/api/cron/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'notification_cron_secret'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

## Vérifier

```sql
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

Côté application, un passage sans rien à faire répond :

```json
{ "ok": true, "campagnes": 0, "occurrences": 0, "envoyes": 0, "echoues": 0, "interrompus": 0 }
```

## Arrêter

```sql
select cron.unschedule('notifications-chaque-minute');
```

## Ce que le passage fait, dans l'ordre

1. **Balayage** — les envois restés `en_cours` depuis plus de dix minutes
   deviennent `interrompue`, et leurs occurrences `echouee`. C'est le contrat
   *at-most-once* : le push est peut-être parti, on ne le rejoue pas.
2. **Campagnes dues** — `active` et `next_run_at <= now()`.
3. **Occurrence** — `insert` ; `unique (campaign_id, scheduled_for)` garantit
   qu'il n'y en a qu'une, même si deux passages se croisent.
4. **Réservation** — `update … where status = 'en_attente'`. Un seul passage
   voit une ligne modifiée ; l'autre abandonne.
5. **Échéance suivante** — recalculée **avant** l'envoi, depuis l'échéance
   traitée et le calendrier du fuseau. Une campagne dont l'envoi échoue ne
   repart donc pas en boucle à chaque minute.
6. **Destinataires → appareils** — `students.user_id` puis
   `push_subscriptions` non désactivés.
7. **Envois** — une ligne `notification_deliveries` par appareil, ouverte
   avant le push ; `unique (occurrence_id, subscription_id)` empêche qu'un
   appareil soit servi deux fois.
8. **Verdicts** — 404/410 désactivent **cet** abonnement et lui seul ; une
   erreur passagère (500, réseau) n'en désactive aucun.

## Sécurité

- Le secret n'apparaît ni dans le dépôt, ni dans les réponses de l'API.
- La route ne rend que des nombres : aucun `endpoint`, `p256dh` ni `auth`.
- Sans `NOTIFICATION_CRON_SECRET` configuré, la route répond 503 — elle n'est
  jamais ouverte par défaut.
