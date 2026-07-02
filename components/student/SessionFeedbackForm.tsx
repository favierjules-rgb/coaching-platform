"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle } from "lucide-react";

const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);

export function SessionFeedbackForm() {
  const [completed, setCompleted] = useState(false);
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Donnée mockée pour l'instant : aucun envoi réel n'est effectué.
    setSent(true);
  }

  return (
    <div className="border border-border bg-card p-6">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
        Retour élève
      </h2>

      {sent ? (
        <div className="border border-primary/30 bg-background p-8 text-center">
          <CheckCircle size={32} className="mx-auto mb-3 text-primary" />
          <h3 className="mb-1 font-heading text-base font-bold uppercase text-foreground">
            Retour envoyé
          </h3>
          <p className="text-sm text-muted-foreground">
            Ton coach recevra ton retour avant la prochaine séance.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex items-center gap-3 border border-border bg-background px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={completed}
              onChange={(event) => setCompleted(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Séance terminée
          </label>

          <div>
            <label
              htmlFor="rpe"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Difficulté ressentie (RPE)
            </label>
            <select
              id="rpe"
              name="rpe"
              defaultValue=""
              className="w-full appearance-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            >
              <option value="" disabled>
                Choisir une note sur 10
              </option>
              {rpeOptions.map((value) => (
                <option key={value} value={value}>
                  {value} / 10
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="loads"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Charges utilisées
            </label>
            <input
              id="loads"
              name="loads"
              placeholder="Ex : Développé couché 62 kg, squat 92 kg…"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="comment"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Commentaire
            </label>
            <textarea
              id="comment"
              name="comment"
              rows={3}
              placeholder="Comment s'est passée la séance ?"
              className="w-full resize-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pain"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Douleur ou gêne éventuelle
            </label>
            <input
              id="pain"
              name="pain"
              placeholder="Ex : légère gêne à l'épaule droite"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="mt-2 bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
          >
            Envoyer le retour
          </button>
        </form>
      )}
    </div>
  );
}
