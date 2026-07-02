"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle } from "lucide-react";

import { SectionLabel } from "@/components/ui/SectionLabel";
import { newsletterGoals } from "@/data/mock";

export function Newsletter() {
  const [sent, setSent] = useState(false);
  const [goal, setGoal] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Données mockées pour l'instant : aucun envoi réel n'est effectué.
    setSent(true);
  }

  return (
    <section id="newsletter" className="border-t border-border bg-card py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
          <div className="max-w-xl">
            <SectionLabel>La méthode Seth</SectionLabel>
            <h2 className="mb-6 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
              Reçois la
              <br />
              méthode
              <br />
              <span className="italic text-primary">complète</span>
            </h2>
            <p className="text-muted-foreground">
              Programme type, conseils nutrition et stratégie de progression
              — directement dans ta boîte mail.
            </p>
          </div>

          <div className="w-full max-w-lg">
            {sent ? (
              <div className="border border-primary/30 bg-background p-8 text-center">
                <CheckCircle size={40} className="mx-auto mb-4 text-primary" />
                <h3 className="mb-2 font-heading text-xl font-bold uppercase text-foreground">
                  C&apos;est parti !
                </h3>
                <p className="text-sm text-muted-foreground">
                  Vérifie ta boîte mail dans les prochaines minutes.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label
                    htmlFor="firstName"
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Prénom
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    required
                    placeholder="Ton prénom"
                    className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="ton@email.com"
                    className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="goal"
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Objectif principal
                  </label>
                  <select
                    id="goal"
                    name="goal"
                    required
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    className="w-full appearance-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  >
                    <option value="">Choisir un objectif</option>
                    {newsletterGoals.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  className="mt-4 inline-flex items-center justify-center gap-2 bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
                >
                  Recevoir la méthode <ArrowRight size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
