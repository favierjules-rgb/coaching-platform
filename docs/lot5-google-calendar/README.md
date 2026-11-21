# Lot 5 — recette Google Calendar

⚠️ **Aucun test Google n'a été exécuté par Claude.** La suite
`npm run test:google-calendar` vérifie la **conformité** du format et le
comportement d'un **modèle** de client Gmail — pas celui de Google.

Les fichiers des scénarios A à E sont ceux du lot 4 :
`docs/lot4-apple-calendar/`. Le format émis est identique pour Apple et pour
Google, le lot 5 n'ayant modifié aucun format. Ce dossier ne contient que les
**deux fichiers de l'expérience ORGANIZER**, décrite plus bas.

Les adresses sont en `.invalid`, non routables.

## Procédure Gmail

Google décide à partir du **paramètre MIME `method`** de la pièce jointe.
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

# Expérience ORGANIZER — à mener avant tout arbitrage

## Le problème

Dans le fichier destiné au coach, le coach est `ORGANIZER` et le **seul**
`ATTENDEE` est l'élève. Son adresse n'apparaît donc nulle part comme
participant.

```
ORGANIZER;CN=Jules FAVIER:mailto:coach-a@exemple.invalid
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Thomas:mailto:eleve@…
```

Gmail ne traite une invitation que lorsque l'adresse du titulaire de la boîte
y figure. Il reconnaît aussi l'organisateur, mais le comportement varie selon
le compte et le réglage « ajouter automatiquement les invitations », et un
organisateur ne reçoit normalement pas d'invitation à son propre événement.
**Conséquence redoutée : l'agenda du coach n'est jamais alimenté, et ses
annulations ne sont jamais appliquées.** C'est le risque hérité du lot 4, et
il est au moins aussi sérieux côté Google que côté Apple.

## Le protocole

1. **Scénario A2 tel quel** (`docs/lot4-apple-calendar/A2-…`) dans la boîte du coach.
   - [ ] carte d'invitation affichée ?
   - [ ] événement ajouté à l'agenda ?
2. **Puis `B2` tel quel.**
   - [ ] l'événement disparaît ?
3. **Variante : `V1-variante-coach-attendee-invitation.ics`** (ce dossier).
   - [ ] carte affichée ?
   - [ ] événement ajouté ?
4. **Puis `V2-variante-coach-attendee-annulation.ics`.**
   - [ ] l'événement disparaît ?

La variante ajoute une ligne, sans rien retirer :

```
ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=Jules FAVIER:mailto:coach-a@…
```

Le coach reste `ORGANIZER` — donc l'autorité sur l'annulation est inchangée —
et devient en plus participant de son propre événement, déjà accepté et sans
RSVP demandé. C'est la forme que Google émet lui-même pour l'organisateur.

## Les trois options, et ma recommandation

| | Description | Pour | Contre |
|---|---|---|---|
| **1 — recommandée** | Ajouter le coach comme `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED` en plus de son rôle d'`ORGANIZER` | purement additif ; n'enlève rien ; forme canonique de Google ; `GCONF-05` reste vrai (organisateur inchangé entre invitation et annulation) | une ligne de plus dans le fichier ; aucune autre contrepartie identifiée |
| 2 | Faire de la plateforme l'`ORGANIZER` (`no-reply@…`) et mettre coach **et** élève en `ATTENDEE` | le plus conforme à iTIP ; les deux agendas sont alimentés de la même façon | annule la décision du lot 2 (le coach est l'organisateur) ; expose une adresse de plateforme ; invalide `GCONF-05` sur l'historique, car les anciens événements ont un autre organisateur |
| 3 | Ne rien changer | zéro risque de régression | si l'expérience échoue, l'agenda du coach n'est jamais à jour — le défaut que les lots 3 et 4 cherchaient à supprimer reste entier de son côté |

**Je recommande l'option 1, mais seulement après l'expérience ci-dessus.**
Si l'étape 1 réussit chez toi (carte affichée, événement ajouté), le
changement est inutile et l'option 3 s'impose : Google reconnaît
l'organisateur sur ton compte, et il ne faut pas toucher au format sans
défaut constaté. Si l'étape 1 échoue et l'étape 3 réussit, l'option 1 est
démontrée et je l'applique — c'est une ligne dans `lib/ics.ts`, plus un
paramètre indiquant si le destinataire est l'organisateur.

`GSIM-05` fige l'état actuel dans la suite de tests et **rougira** le jour où
l'arbitrage sera appliqué : c'est voulu, pour que la décision soit visible
dans l'historique plutôt que silencieuse.

Note ce que tu observes en face de chaque case, et renvoie-moi les écarts.
