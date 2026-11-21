# Exemples ICS **historiques** — état avant V1 (jusqu'au 21/11/2026)

⚠️ **Ces fichiers ne sont PLUS ce que `lib/ics.ts` produit.** Ils sont
conservés tels quels, sans modification, parce qu'ils correspondent au format
des invitations **réellement envoyées en production avant le 21/11/2026** —
soit 33 notifications de rendez-vous journalisées en `sent`, dont 15 adressées
à un coach.

Un seul écart avec les fichiers V1 du dossier parent : ils n'ont **qu'une
ligne `ATTENDEE`**, celle de l'élève. Le coach y figure uniquement comme
`ORGANIZER`.

```
ORGANIZER;CN=Jules FAVIER:mailto:coach-a@exemple.invalid
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Thomas:mailto:eleve@…
```

À quoi ils servent encore :

- **relire l'historique** : pour comprendre ce qu'un agenda a reçu avant V1,
  c'est cette forme-là qu'il faut regarder, pas celle du dossier parent ;
- **rejouer le constat du 21/11/2026** : c'est avec `A2` puis `B2` de ce
  dossier que l'agenda Google du coach est resté vide alors que les deux
  e-mails étaient bien arrivés ;
- **contre-épreuve manuelle** de `GCONTRE-06`, qui démontre la même chose de
  façon automatisée.

Ne pas les utiliser pour une recette du format courant. Les fichiers à jour
sont dans le dossier parent, [`..`](..).

Empreintes SHA-256 à la date du gel (21/11/2026) :

```
7233140c4246d5e467496b3cb5921ae1c4dcfb473d1c26b88de65fe3b8877760  A1-creation-invitation-eleve.ics
8ec835fe1e438f6242201a9e3cf2788f043bd3fe5892dd6f1075d2d818bfea31  A2-creation-invitation-coach.ics
9dcbae8cd92922334bc1182b5cdf903c26820ebb0121f0dc298c8a42dd8a73cf  B1-annulation-eleve.ics
5eb0db05793fd6cb11b4b4d8e34527c1d5890f4080bd730dc9d4d5a58c1bce3b  B2-annulation-coach.ics
6093d5915b76780c899e3208472d954d49b10a50a0de242fd06d413c00389e95  C1-report-invitation-eleve.ics
4c4824a91394f205b58b74fda11a9ac499bfced9c4dc86845890622b75f46745  C2-report-invitation-coach.ics
50154356c64351899e5992ae11bb0da4e024359504d45935dadbe8eec6e767e9  D1-reaffectation-invitation-eleve.ics
b46ef7199c9764622bb64d10f531ad641932b126284bacf7cf6dd3f4441f4ce0  D2-reaffectation-invitation-coachB.ics
```
