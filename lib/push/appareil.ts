"use client";

/**
 * LE DÉSABONNEMENT DE CET APPAREIL, AU MOMENT DE LA DÉCONNEXION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI C'EST UNE ÉTAPE DE LA DÉCONNEXION
 * ════════════════════════════════════════════════════════════════════════
 * Un abonnement push appartient à un COMPTE et à un APPAREIL. Si l'élève se
 * déconnecte de ce téléphone et que l'abonnement reste, les rappels destinés
 * à son ancien compte continuent d'arriver — sur un téléphone qui peut être
 * partagé, et devant quelqu'un d'autre.
 *
 * Best-effort de bout en bout : une déconnexion ne doit jamais échouer parce
 * qu'un désabonnement a raté. Au pire l'abonnement survit côté serveur, et
 * le prochain envoi le trouvera mort (404/410) et le désactivera.
 *
 * Ce fichier ne touche QUE l'abonnement de cet appareil : jamais les autres
 * appareils du même compte.
 */
export async function retirerAbonnementDeCetAppareil(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const enregistrement = await navigator.serviceWorker.getRegistration();
    const abonnement = await enregistrement?.pushManager.getSubscription();
    if (!abonnement) {
      return;
    }
    // Serveur d'abord : tant que la session est encore valide, c'est le seul
    // moment où l'API acceptera la suppression.
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: abonnement.endpoint }),
    });
    await abonnement.unsubscribe();
  } catch {
    /* voir l'en-tête : jamais bloquant */
  }
}
