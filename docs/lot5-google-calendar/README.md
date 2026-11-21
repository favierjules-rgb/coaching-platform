# Lot 5 — recette Google Calendar

⚠️ **Aucun test Google n'a été exécuté par Claude.** La suite
`npm run test:google-calendar` vérifie la **conformité** du format et le
comportement d'un **modèle** de client Gmail — pas celui de Google.

⚠️ **ARBITRAGE RENDU LE 21/11/2026 : V1 EST IMPLÉMENTÉE** (coach `ORGANIZER`
**et** second `ATTENDEE`). Voir « Arbitrage ORGANIZER » plus bas. **V1 est une
hypothèse technique à valider sur Google réel, pas une correction garantie** :
elle répond à un échec constaté, mais la cause de cet échec n'est pas
démontrée et au moins une autre explication reste ouverte (l'écart entre
l'adresse d'expédition et l'`ORGANIZER`, détaillé plus bas).

Les fichiers des scénarios A à E sont ceux du lot 4 :
`docs/lot4-apple-calendar/`, **régénérés pour V1**. Le format émis est
identique pour Apple et pour Google. Les deux prototypes manuels qui avaient
servi à démontrer l'option sont désormais dans
[`historique-avant-v1/`](historique-avant-v1/) : ils sont **périmés**, la
sortie de production portant maintenant la ligne nativement.

Les adresses sont en `.invalid`, non routables.

## Procédure Gmail

Le **paramètre MIME `method`** de la pièce jointe déclare l'opération iTIP que
le fichier porte — `REQUEST` pour une invitation ou un report, `CANCEL` pour
une annulation — et il doit concorder avec le `METHOD:` écrit dans le
`VCALENDAR`. C'est ce que `typeMimeIcs` garantit en relisant le contenu.

⚠️ **SA PRÉSENCE NE GARANTIT RIEN.** Un `method` correct ne suffit pas à
faire ajouter ou mettre à jour l'événement dans Google Agenda : le 21/11/2026,
une création et une annulation correctement annoncées sont arrivées dans Gmail
sans qu'aucun événement n'apparaisse dans l'agenda du coach. **Aucune mesure
ne permet d'affirmer comment Google traite ces invitations** — ni ce qu'il lit,
ni dans quel ordre, ni ce qui le décide. Ce paramètre est donc une condition
à remplir, pas un mécanisme dont on connaîtrait l'effet.

Déposer le `.ics` dans Google Calendar via « Importer » ne teste **pas** le
même chemin : il faut que le fichier arrive en pièce jointe d'un e-mail, avec
le bon `Content-Type`, et être traité depuis Gmail.

| Fichier (lot 4) | `Content-Type` |
|---|---|
| `A1-creation-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `A2-creation-invitation-coach.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `B1-annulation-eleve.ics` | `text/calendar; charset=utf-8; method=CANCEL` |
| `B2-annulation-coach.ics` | `text/calendar; charset=utf-8; method=CANCEL` |
| `C1-report-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `D1-reaffectation-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `D2-reaffectation-invitation-coachB.ics` | `text/calendar; charset=utf-8; method=REQUEST` |

Vérifie aussi, dans Gmail → « Afficher l'original », que l'en-tête de la pièce
jointe porte bien `Content-Type: text/calendar; charset=utf-8; method=…`.

Deux réglages Google à relever avant de conclure quoi que ce soit :
Agenda → Paramètres → **« Ajouter automatiquement les invitations »**, et le
**fuseau horaire** du compte.

## Scénario A — Création (boîte de l'élève)

- [ ] Gmail affiche une **carte d'invitation** (Oui / Peut-être / Non), pas une simple pièce jointe
- [ ] titre : `Séance de coaching — Jules FAVIER`
- [ ] **8 décembre 2026, 10:00 → 11:00** heure de Paris, durée 1 h
- [ ] un seul événement dans l'agenda
- [ ] accents et tiret cadratin corrects : `Séance`, `préparation`, `mobilité`, `—`

## Scénario B — Annulation (même boîte, après A)

- [ ] Gmail reconnaît l'événement existant (même UID)
- [ ] le rendez-vous disparaît, ou passe à « Annulé »
- [ ] **aucun** événement parasite n'est créé

## Scénario C — Report (même boîte, après A)

Dans cet ordre : `B1` puis `C1`.

- [ ] le créneau du 8 décembre disparaît
- [ ] le créneau du 11 décembre 15:00 → 16:30 apparaît
- [ ] un seul événement de coaching au total
- [ ] recommence en inversant l'ordre : l'état final doit être le même

## Scénario D — Réaffectation (trois boîtes)

- [ ] coach A, après `A2` puis `B2` : plus aucun événement
- [ ] coach B, après `D2` : le créneau du 11 décembre, et lui seul
- [ ] élève, après `B1` puis `D1` : un seul créneau, `Séance de coaching — Sophie BERNARD`

## Scénario E — Réémission

- [ ] renvoie `A1` trois fois : toujours **un seul** événement
- [ ] renvoie `B1` deux fois : la seconde est sans effet, aucun fantôme

---

# Arbitrage ORGANIZER — rendu le 21/11/2026 : V1

## Le fait qui a tranché

Jusqu'ici, le fichier destiné au coach le portait comme `ORGANIZER` et ne
donnait qu'un seul `ATTENDEE`, l'élève :

```
ORGANIZER;CN=Jules FAVIER:mailto:coach-a@exemple.invalid
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Thomas:mailto:eleve@…
```

**Ce qui a été mesuré**, sur le compte Google réel du coach :

| | |
|---|---|
| création du rendez-vous du lun. 23/11 09:00 | envoyée le 21/11 à **16:09:03**, `sent` |
| annulation du même rendez-vous | envoyée le 21/11 à **16:09:16**, `sent` |
| même UID, `SEQUENCE` 0 puis 1, `ORGANIZER` identique | oui |
| les deux e-mails reçus dans Gmail | oui |
| événement ajouté au Google Agenda du coach | **non** |

Les deux envois sont journalisés en `sent` dans `email_logs` : l'e-mail est
parti et il est arrivé. L'agenda, lui, est resté vide. Avant cette date,
**15 notifications** avaient déjà été adressées au coach depuis le 19/07/2026,
toutes en `sent`, dans ce même format.

## La décision

Les trois options étaient :

| | Description | Issue |
|---|---|---|
| **1 — V1, retenue** | ajouter le coach comme `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE` **en plus** de son rôle d'`ORGANIZER` | **implémentée le 21/11/2026** |
| 2 | faire de la plateforme l'`ORGANIZER` et mettre coach **et** élève en `ATTENDEE` | écartée : annule la décision du lot 2, expose une adresse de plateforme, et **invalide l'appariement sur l'historique** — les 11 créations déjà émises portent un autre organisateur, donc leurs annulations futures seraient signées d'un tiers et ignorées (`GCONTRE-02` le reproduit) |
| 3 | ne rien changer | écartée : le défaut est désormais constaté, pas seulement redouté |

V1 est **purement additive** : elle n'enlève rien, le coach reste `ORGANIZER`,
donc `GCONF-05` (organisateur identique entre une invitation et son
annulation) reste vrai et l'historique reste appariable.

Ce qui part maintenant, dans **les deux** fichiers d'un même rendez-vous :

```
ORGANIZER;CN=Jules FAVIER:mailto:coach-a@exemple.invalid
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Thomas:mai
 lto:eleve@exemple.invalid
ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=Jules FAVIER:mailto:coa
 ch-a@exemple.invalid
```

La ligne du coach est **dérivée des champs `organizer*`**, pas d'une nouvelle
entrée : elle est donc identique dans le fichier de l'élève et dans celui du
coach, et l'invariant du lot 2 — « les deux fichiers ne diffèrent que par
`SUMMARY` » — tient par construction. Vérifié par exécution : **une seule
ligne d'écart** entre les deux fichiers.

## V1 : hypothèse, pas correction garantie

⚠️ **À NE PAS PRÉSENTER COMME RÉSOLU.** Ce qui est établi, c'est l'**échec** :
l'agenda du coach n'a pas été alimenté. Ce qui n'est **pas** établi, c'est que
l'absence d'`ATTENDEE` en soit la cause. Trois explications restent ouvertes,
et V1 n'en traite qu'une :

1. **l'`ATTENDEE` manquant** — l'hypothèse retenue. Gmail ne traiterait une
   invitation que si l'adresse du titulaire y figure comme participant. C'est
   la règle que le modèle `GSIM-*` applique, et **le modèle n'est pas Google**.
2. **l'écart entre l'adresse d'expédition et l'`ORGANIZER`** — hypothèse
   **maintenue, non écartée**. Les e-mails partent du domaine de la plateforme
   (`RESEND_FROM_EMAIL`), tandis que l'`ORGANIZER` porte le domaine du coach.
   Un organisateur dont le domaine n'est pas celui de l'expéditeur **pourrait**
   suffire à faire ignorer la pièce. **Rien n'a été mesuré sur ce point, et
   aucun comportement de Gmail n'est affirmé ici** : c'est une piste à
   instruire, pas un mécanisme constaté. Si l'essai de validation
   ci-dessous échoue malgré les deux `ATTENDEE`, **c'est cette piste qu'il
   faut instruire** — en vérifiant dans « Afficher l'original » l'en-tête
   `From`, l'alignement SPF/DKIM/DMARC du domaine d'envoi, et en comparant
   avec une invitation envoyée depuis l'adresse du coach lui-même. Ne pas
   empiler un troisième changement de format avant d'avoir tranché celle-là.
3. **le réglage du compte** — Agenda → Paramètres → « Ajouter
   automatiquement les invitations ». **Non relevé** au moment du constat. Un
   compte réglé sur « seulement si j'ai répondu » n'ajoute rien tant que
   personne n'a cliqué : l'agenda serait vide sans qu'aucun défaut de format
   soit en cause.

Un seul compte Google a été observé, une seule fois. Ce n'est pas un
comportement général de Google, c'est un constat sur ce compte-là.

## L'essai de validation — à faire après déploiement

Tant que cet essai n'a pas abouti, V1 reste une hypothèse.

1. Crée un rendez-vous de test dans l'application.
2. Dans Gmail → « Afficher l'original », vérifie que la pièce jointe porte
   `Content-Type: text/calendar; charset=utf-8; method=REQUEST` **et deux
   lignes `ATTENDEE`**, la tienne en seconde. Relève aussi l'en-tête `From`.
   - [ ] deux `ATTENDEE` présents, le coach en second
   - [ ] `method=REQUEST` annoncé
   - [ ] `From` relevé (hypothèse 2)
3. Gmail affiche-t-il une **carte d'invitation** (Oui / Peut-être / Non) ?
   - [ ] oui / non
4. L'événement est-il dans ton agenda, avec ou sans clic ?
   - [ ] sans clic / après clic / jamais
5. Annule-le : l'événement **disparaît**-il ?
   - [ ] oui / non
6. Relève Agenda → Paramètres → « Ajouter automatiquement les invitations »
   et le fuseau du compte (hypothèse 3).
   - [ ] valeur notée

**Si l'étape 4 échoue malgré les deux `ATTENDEE`** : l'hypothèse 1 est
écartée, et il faut instruire les hypothèses 2 puis 3 — pas ajouter un
troisième changement de format.

## Ce que l'arbitrage a coûté en tests

**Cinq** tests de cette suite ont été révisés, chacun avec une raison écrite
dans le fichier : quatre ont changé de sens et rougissaient avant d'être
adaptés (`GSIM-05`, `GSIM-06`, `GCONF-07`, `CODE-02`), le cinquième
(`GSIM-07`) est resté vert mais a été nettoyé de sa mutation à la main.

| Test | Avant | Après |
|---|---|---|
| `GSIM-05` | figeait « le coach n'est que ORGANIZER » et annonçait qu'il rougirait le jour de l'arbitrage | vérifie les deux `ATTENDEE`, l'ordre, et que l'agenda du coach est alimenté |
| `GSIM-06` | construisait la variante **à la main** par `replace` | joue la sortie réelle : cycle création → annulation, et le pliage à 75 octets |
| `GSIM-07` | passait les pièces coach par une aide `avecCoachAttendee` | aide retirée, les trois agendas jouent la sortie réelle |
| `GCONF-07` | exigeait `[élève]` comme seule adresse | exige `[élève, coach]` dans cet ordre, et les paramètres des deux lignes |
| `CODE-02` | scellé à **une** ligne `ATTENDEE` dans `lib/ics.ts` | scellé à **deux**, gardées par une adresse, élève avant coach |

Trois contre-épreuves ont été ajoutées : `GCONTRE-06` (une implementation à
un seul `ATTENDEE` fait bien rougir `GSIM-05` et `GSIM-06`), `GCONTRE-07`
(l'ordre élève-puis-coach est contraint), `GCONTRE-08` (la ligne du coach sans
garde d'adresse fait réapparaître une `mailto:` vide).

⚠️ **CE QUE LES TESTS ATTRAPENT RÉELLEMENT, MESURÉ PAR MUTATION** le
21/11/2026, en mutant `lib/ics.ts` dans une copie jetable :

| Mutation de `lib/ics.ts` | Tests qui rougissent |
|---|---|
| un seul `ATTENDEE` (l'état d'avant V1) | **9** — `CONF-17`, `CONF-18`, `GCONF-07`, `GSIM-05`, `GSIM-06`, `GSIM-07`, `CODE-02`, `GCONTRE-07`, `ICS-02` |
| coach placé en premier | **6** — `CONF-13`, `CONF-17`, `GCONF-07`, `GSIM-05`, `CODE-02`, `GCONTRE-07` |
| ligne de l'élève non gardée | **3** — `CONF-18`, `CONTRE-A7`, `CODE-02` |

Le nettoyage de `GSIM-07` en a fait un détecteur à part entière : il rougit
désormais sur un retour à un seul `ATTENDEE`, ce qu'il ne faisait pas tant
qu'il ajoutait la ligne à la main. À l'inverse, `ics-cycle-de-vie` reste
**aveugle** aux trois mutations (57/57 dans tous les cas) : cette suite ne
porte aucune assertion sur `ATTENDEE`, et c'est précisément pourquoi
`CONF-17`/`CONF-18` ont été ajoutés au lot 4.

Côté lot 4, `CONF-17` et `CONF-18` couvrent désormais les deux participants et
l'absence de CAL-ADDRESS vide, avec `CONTRE-A7` pour contre-épreuve.

## Correctif joint — CAL-ADDRESS vide

Indépendant de l'arbitrage, mesuré le 21/11/2026 par exécution : avec un
élève introuvable, `lib/ics.ts` émettait

```
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=:mailto:
```

soit un `mailto:` sans adresse, qui n'est pas une CAL-ADDRESS valide.
`ORGANIZER` avait déjà sa garde ; les **deux** lignes `ATTENDEE` l'ont
désormais. Cas latent en production (aucun élève ni coach sans adresse sur les
41 fiches), couvert par `CONF-18` et contre-éprouvé par `CONTRE-A7`.

## Ce que V1 ne corrige pas

- **Le bouton « Télécharger .ics » de l'espace élève.**
  `getMyCoachPublicInfo` rend `email: ""` en dur, la RPC
  `get_my_coach_public_profile` ne renvoyant pas d'adresse : le fichier
  téléchargé n'a **ni `ORGANIZER` ni le coach en `ATTENDEE`**. L'exposer au
  navigateur reviendrait sur un choix de confidentialité du lot 2 et toucherait
  une RPC. Hors périmètre.
- **Les séances sans élève.** La route refuse en 404 dès que `student_id` est
  nul : les séances d'agenda du staff n'atteignent jamais l'agenda du coach.
  Latent (aucun cas en production).
- **La dérive des exemples de ce dossier.** Aucun test ne compare les `.ics`
  de `docs/` à la sortie réelle de `lib/ics.ts` : la régénération du
  21/11/2026 a été faite à la main. Un scellé reste à ajouter, sur décision.

Note ce que tu observes en face de chaque case, et renvoie-moi les écarts.
