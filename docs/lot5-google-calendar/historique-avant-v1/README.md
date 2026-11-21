# Prototypes **historiques** de l'arbitrage ORGANIZER — périmés

⚠️ **Ces deux fichiers ont été écrits à la main**, avant que l'arbitrage ne
soit rendu, pour démontrer l'option 1 sans toucher au code de production. Ils
sont **périmés depuis le 21/11/2026** : `lib/ics.ts` produit désormais la
ligne du coach nativement, et les exemples à jour sont ceux de
[`../../lot4-apple-calendar/`](../../lot4-apple-calendar/).

| Fichier | Ce qu'il montrait |
|---|---|
| `V1-variante-coach-attendee-invitation.ics` | invitation (`METHOD:REQUEST`) avec le coach en second `ATTENDEE` |
| `V2-variante-coach-attendee-annulation.ics` | annulation (`METHOD:CANCEL`) de la même, même UID, `SEQUENCE:1` |

Deux pièges à connaître si on les relit :

1. **Ce ne sont pas deux options concurrentes.** Les noms « V1 » et « V2 »
   désignaient l'invitation et l'annulation d'**une seule et même** variante,
   pas deux arbitrages au choix. Les trois options réelles étaient décrites
   dans le README parent, et c'est l'option 1 qui a été retenue.
2. **Ils ne sont pas identiques à la sortie actuelle.** Il leur manque la
   ligne `URL:`, que les fichiers du lot 4 portent. L'affirmation « la
   variante ajoute une ligne, sans rien retirer » était donc inexacte pour ces
   deux fichiers précis — sans conséquence sur l'appariement, mais à savoir.

Remplacés par `A2-creation-invitation-coach.ics` et `B2-annulation-coach.ics`
du lot 4, régénérés à partir de `lib/ics.ts`.
