"use client";

/**
 * Filet de sécurité de dernier recours : si le layout racine lui-même
 * plante, ce fichier remplace tout le document (il doit définir ses
 * propres balises html/body) pour éviter une page blanche irrécupérable.
 */
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#0a0a0a",
          color: "#f5f5f4",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, textTransform: "uppercase", margin: 0 }}>
            Une erreur est survenue
          </h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#8f8f8f" }}>
            Le site n&apos;a pas pu s&apos;afficher correctement. Réessaie de recharger la page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            border: "1px solid #d62828",
            backgroundColor: "#d62828",
            color: "#ffffff",
            padding: "0.625rem 1.25rem",
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
