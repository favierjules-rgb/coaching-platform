"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";

import { AuthCardLayout } from "@/components/shared/AuthCardLayout";
import {
  creerVerificateurActivation,
  lireJetonActivation,
  urlPorteUnJeton,
  urlSansJeton,
  type JetonActivation,
} from "@/lib/auth/activation-token";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * `arme`    — un jeton exploitable est en mémoire, EN ATTENTE d'un clic ;
 * `session` — une session existe déjà (repli `#access_token`, ou vérification
 *             réussie) : le formulaire de mot de passe est affiché ;
 * `consomme`— le lien a déjà été ouvert ;
 * `invalide`— aucun jeton exploitable, ou jeton refusé.
 */
type Etat = "arme" | "session" | "consomme" | "invalide";

function redirectPathForRole(role: string): string {
  return role === "student" ? "/dashboard" : "/admin";
}

/**
 * Formulaire « définir un nouveau mot de passe » (/reinitialiser-mot-de-passe)
 * — destination commune du lien d'invitation envoyé aux nouveaux élèves et du
 * lien de récupération de /mot-de-passe-oublie.
 *
 * ---------------------------------------------------------------------
 * Pourquoi la vérification n'a PLUS lieu au chargement
 * ---------------------------------------------------------------------
 * Incident du 27/07/2026, établi par les traces Supabase : le jeton
 * d'invitation a été vérifié avec SUCCÈS 8 secondes après l'envoi de
 * l'e-mail (`email_confirmed_at`), sans qu'aucune session ne soit créée. Le
 * clic réel de l'acheteur, 1 min 43 plus tard, a reçu un 403 — le jeton était
 * déjà consommé. Autrement dit : quelque chose avait ouvert le lien avant
 * l'utilisateur.
 *
 * C'est le comportement normal d'un lien à usage unique envoyé par e-mail :
 * relais de sécurité, aperçu de lien, préchargement du navigateur, indexation
 * — un GET automatique suffit à le brûler. Aucune correction côté serveur ne
 * peut l'empêcher tant que le simple CHARGEMENT de la page consomme le jeton.
 *
 * D'où la règle appliquée ici : **le chargement de la page ne vérifie
 * rien.** Le jeton est mis de côté en mémoire, retiré de l'URL, et n'est
 * échangé contre une session qu'au clic explicite de l'utilisateur sur
 * « Définir mon mot de passe ». Un automate qui suit le lien voit une page
 * d'attente ; il ne déclenche aucun appel réseau vers Supabase.
 *
 * Le jeton est retiré de la barre d'adresse dès le premier rendu
 * (`router.replace`) : il ne part donc plus dans le `Referer`, ne reste pas
 * dans l'historique, et ne peut plus être rejoué depuis un partage d'URL.
 *
 * ---------------------------------------------------------------------
 * Pourquoi le jeton n'est lu qu'une fois
 * ---------------------------------------------------------------------
 * Il est capté par l'initialiseur paresseux d'un `useState`, qui ne
 * s'exécute qu'à la création de l'instance, et le drapeau « déjà tenté »
 * vit dans un `useRef`. Ni l'un ni l'autre ne dépend de `searchParams`,
 * dont la référence change après hydratation. Aucune ré-exécution d'effet,
 * aucun re-rendu, aucun changement de props ne peut donc déclencher une
 * seconde vérification.
 *
 * ---------------------------------------------------------------------
 * Repli `#access_token`
 * ---------------------------------------------------------------------
 * Conservé pour les liens historiques : si `detectSessionInUrl` a déjà
 * établi une session, on passe directement au formulaire. Ce chemin ne
 * consomme aucun jeton d'invitation.
 *
 * Garde anti-collision multi-onglets : le client Supabase stocke la session
 * dans localStorage, PARTAGÉ par tous les onglets. On mémorise l'utilisateur
 * ciblé au moment où la session est établie, et on revérifie juste avant
 * `updateUser` que la session correspond toujours — sinon on refuse plutôt
 * que d'écraser le mot de passe d'un autre compte.
 */
export function ResetPasswordForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordId = useId();
  const confirmId = useId();

  const [supabase] = useState(() => (supabaseConfigured ? createSupabaseBrowserClient() : null));

  /**
   * Jeton capté UNE SEULE FOIS, à la création de l'instance.
   *
   * L'initialiseur paresseux de `useState` ne s'exécute qu'au premier rendu :
   * la valeur survit ensuite à tous les re-rendus, sans jamais relire
   * `searchParams` — dont la référence change après hydratation. Un
   * changement de props, un re-rendu ou une navigation ne peuvent donc pas
   * ressusciter un jeton déjà utilisé.
   */
  const [jetonInitial] = useState<JetonActivation | null>(() =>
    lireJetonActivation((cle) => searchParams.get(cle)),
  );

  /**
   * Vérificateur à usage unique, créé une seule fois par instance. Toute la
   * garde anti-rejeu vit dans `lib/auth/activation-token.ts`, testée à part.
   */
  const verificateurRef = useRef(
    creerVerificateurActivation(jetonInitial, {
      verifierJeton: async (jeton) => {
        if (!supabase) return { messageErreur: "client indisponible" };
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: jeton.tokenHash,
          // Correspondance stricte avec le type émis : invite → invite,
          // recovery → recovery. Jamais de conversion.
          type: jeton.type,
        });
        if (verifyError || !data.session) return { messageErreur: verifyError?.message ?? "aucune session" };
        return { userId: data.session.user.id };
      },
    }),
  );

  const [etat, setEtat] = useState<Etat>(() => (jetonInitial ? "arme" : "invalide"));
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [verification, setVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Nettoyage de l'URL — le SEUL effet de cette page. Il ne contacte aucun
   * service : il retire `token_hash` et `type` de la barre d'adresse, sans
   * rechargement. Aucune vérification n'a lieu ici, par construction.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlPorteUnJeton(window.location.href)) {
      router.replace(urlSansJeton(window.location.href), { scroll: false });
    }
  }, [router]);

  /**
   * Repli pour les liens historiques `#access_token` : `detectSessionInUrl`
   * a pu établir une session sans notre intervention. On se contente de la
   * CONSTATER — aucun jeton n'est consommé ici.
   */
  useEffect(() => {
    if (!supabase || jetonInitial) return;
    let annule = false;
    supabase.auth.getSession().then(({ data }) => {
      if (annule || !data.session) return;
      setTargetUserId(data.session.user.id);
      setEtat("session");
    });
    return () => {
      annule = true;
    };
  }, [supabase, jetonInitial]);

  /**
   * Échange du jeton contre une session — déclenché UNIQUEMENT par le clic
   * de l'utilisateur. Le drapeau `tentativeFaiteRef` est posé avant tout
   * `await` : deux clics rapprochés ne produisent qu'un seul appel réseau.
   */
  async function handleVerifier() {
    if (!verificateurRef.current.disponible()) return;
    setVerification(true);
    const issue = await verificateurRef.current.tenter();
    setVerification(false);

    if (issue.etat === "ignore") return;
    if (issue.etat === "session") {
      setTargetUserId(issue.userId);
      setEtat("session");
      return;
    }
    setEtat(issue.etat);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("8 caractères minimum.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!supabase) {
      setError("Supabase n'est pas configuré sur cet environnement.");
      return;
    }

    setLoading(true);

    // Revérification anti-collision : si un autre onglet a réécrit la
    // session partagée entre-temps, la session courante ne correspond plus
    // à l'utilisateur détecté à l'ouverture du lien — on refuse plutôt que
    // de modifier le mot de passe d'un autre compte.
    const { data: currentSession } = await supabase.auth.getSession();
    if (!currentSession.session || currentSession.session.user.id !== targetUserId) {
      setLoading(false);
      setError(
        "La session a changé pendant que tu remplissais ce formulaire (un autre onglet connecté dans le même navigateur ?). Réouvre le lien reçu par email dans une fenêtre privée/navigation privée, seule, puis réessaie.",
      );
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError("Impossible de mettre à jour le mot de passe. Redemande un lien.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const profileRole = userData.user
      ? (await supabase.from("profiles").select("role").eq("user_id", userData.user.id).maybeSingle()).data?.role
      : null;

    router.push(profileRole ? redirectPathForRole(profileRole) : "/connexion");
    router.refresh();
  }

  /* ─────────────── Lien déjà ouvert ─────────────── */

  if (etat === "consomme" || etat === "invalide") {
    const dejaOuvert = etat === "consomme";
    return (
      <AuthCardLayout
        cardClassName="text-center"
        footer={
          <Link
            href="/mot-de-passe-oublie"
            className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft size={14} />
            Demander un nouveau lien
          </Link>
        }
      >
        <AlertCircle size={28} className="mx-auto mb-4 text-red-400" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">
          {dejaOuvert ? "Lien déjà ouvert" : "Lien expiré"}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {dejaOuvert
            ? "Ce lien a déjà été ouvert. Demandez un nouveau lien pour définir votre mot de passe."
            : "Ce lien n'est plus valide. Demandez un nouveau lien pour continuer."}
        </p>
      </AuthCardLayout>
    );
  }

  /* ─────────────── Jeton en attente du clic ─────────────── */

  if (etat === "arme") {
    return (
      <AuthCardLayout cardClassName="text-center">
        <ShieldCheck size={28} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">Votre lien est prêt</h1>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          Votre lien est prêt. Cliquez sur le bouton ci-dessous pour sécuriser votre accès et définir votre mot de
          passe.
        </p>
        <button
          type="button"
          onClick={handleVerifier}
          disabled={verification}
          className="w-full bg-primary py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
        >
          {verification ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Vérification...
            </span>
          ) : (
            "Définir mon mot de passe"
          )}
        </button>
      </AuthCardLayout>
    );
  }

  /* ─────────────── Session établie : formulaire ─────────────── */

  return (
    <AuthCardLayout>
      <h1 className="mb-1 font-heading text-2xl font-extrabold uppercase text-foreground">
        Ton mot de passe
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">Choisis un mot de passe pour ton espace coaching.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor={passwordId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Nouveau mot de passe
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor={confirmId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Confirme-le
          </label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 bg-primary py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
        >
          {loading ? "Enregistrement..." : "Valider et accéder à mon espace"}
        </button>
      </form>
    </AuthCardLayout>
  );
}
