# Lot 4 — recette Apple Calendar

⚠️ **Aucun test de ce dossier n'a été exécuté par Claude.** Les fichiers `.ics`
ci-dessous sont ceux que `lib/ics.ts` produit réellement ; la validation sur
macOS, iPhone et iPad reste à faire à la main. La suite automatisée
`npm run test:apple-calendar` vérifie la **conformité** du format et le
comportement d'un **modèle** de client iTIP — pas celui d'Apple.

Les adresses utilisées (`*.exemple.invalid`) ne sont pas routables : rien ne
peut partir vers un vrai destinataire.

## Comment jouer les scénarios

Chaque fichier doit arriver **en pièce jointe d'un e-mail**, avec le
`Content-Type` indiqué. C'est ce paramètre `method` qu'Apple Mail lit pour
décider s'il affiche une invitation ou une simple pièce jointe : ouvrir le
fichier depuis le Finder ne teste PAS le même chemin.

| Fichier | `Content-Type` |
|---|---|
| `A1-creation-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `A2-creation-invitation-coach.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `B1-annulation-eleve.ics` | `text/calendar; charset=utf-8; method=CANCEL` |
| `B2-annulation-coach.ics` | `text/calendar; charset=utf-8; method=CANCEL` |
| `C1-report-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `C2-report-invitation-coach.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `D1-reaffectation-invitation-eleve.ics` | `text/calendar; charset=utf-8; method=REQUEST` |
| `D2-reaffectation-invitation-coachB.ics` | `text/calendar; charset=utf-8; method=REQUEST` |

Les deux UID en jeu :

- `1f0c9e22-…` — créneau initial, **lundi 8 décembre 2026 à 10:00** (Paris)
- `9b7d4411-…` — créneau reporté, **jeudi 11 décembre 2026 à 15:00**, 1 h 30

## Scénario A — Création

1. Envoie-toi `A1` en pièce jointe.
2. Ouvre l'e-mail dans Mail (macOS), puis répète sur iPhone.

- [ ] Mail affiche une **invitation** (boutons Accepter / Refuser), pas une pièce jointe
- [ ] titre : `Séance de coaching — Jules FAVIER`
- [ ] date et heure : **8 décembre 2026, 10:00 → 11:00** (heure de Paris)
- [ ] durée : 1 h
- [ ] l'événement n'apparaît **qu'une fois** dans l'agenda
- [ ] lieu `Salle Nord, Lyon` et lien visio présents
- [ ] accents corrects : `Séance`, `préparation`, `mobilité`, et le tiret `—`

Refais le test avec `A2` : le titre doit être `Coaching — Thomas MARTIN`.

## Scénario B — Annulation

Part de l'état obtenu en A1 (événement présent dans l'agenda).

1. Envoie-toi `B1`.

- [ ] Apple reconnaît l'événement **déjà présent** (même UID)
- [ ] l'ancien événement **disparaît** ou passe à l'état annulé
- [ ] **aucun** nouvel événement n'est créé
- [ ] rien n'apparaît au 11 décembre

## Scénario C — Report

Part de l'état A1. Envoie les deux fichiers **dans cet ordre**, comme la route le fait.

1. `C`… d'abord `B1` (annulation de l'ancien), puis `C1` (invitation du nouveau).

- [ ] le créneau du **8 décembre disparaît**
- [ ] le créneau du **11 décembre 15:00 → 16:30** apparaît
- [ ] il n'y a **qu'un seul** événement de coaching dans l'agenda
- [ ] aucun doublon après avoir rouvert les deux e-mails une seconde fois

Puis recommence en inversant l'ordre de lecture (`C1` avant `B1`) : l'état
final doit être identique — les UID étant distincts, l'annulation ne touche
pas le nouveau créneau.

## Scénario D — Réaffectation du coach

Deux boîtes distinctes sont nécessaires.

1. Boîte du coach A : `A2` (état de départ), puis `B2`.
2. Boîte du coach B : `D2`.
3. Boîte de l'élève : `B1` puis `D1`.

- [ ] agenda du coach A : **plus aucun** événement de coaching
- [ ] agenda du coach B : le créneau du 11 décembre, **et lui seul**
- [ ] agenda de l'élève : un seul créneau, titré `Séance de coaching — Sophie BERNARD`
- [ ] le coach A ne reçoit **jamais** l'invitation du nouveau créneau
- [ ] le coach B ne reçoit **jamais** l'annulation d'un créneau qu'il n'a pas eu

## Points de vigilance connus

1. **Le coach est `ORGANIZER` de son propre fichier.** iTIP prévoit qu'un
   organisateur ne reçoive pas d'invitation à son propre événement : Apple peut
   l'importer sans problème, ou l'ignorer. **C'est le risque principal à
   lever** — si l'agenda du coach reste vide en A2, il faudra inverser les
   rôles pour le fichier du coach (lot suivant, sur décision).
2. **Sans `ORGANIZER`, le fichier n'est pas une invitation.** La ligne est
   omise quand l'adresse du coach est inconnue (choix de confidentialité du
   lot 2, et cas du `coach_id` nul avant M1). À vérifier séparément.
3. **La ligne `ATTENDEE` est désormais pliée** (ajout de `ROLE` et
   `PARTSTAT` : elle dépasse 75 octets). Le pliage est conforme, mais c'est un
   changement par rapport à avant le lot 4.
4. **Aucun `VTIMEZONE`** : tout est en UTC absolu. Vérifie l'affichage sur un
   appareil réglé sur un autre fuseau.

Note ce que tu observes en face de chaque case, et renvoie-moi les écarts.
