import { Suspense } from "react";
import { UnsubscribeForm } from "./UnsubscribeForm";
import { Loader } from "@/components/ui/Loader";

export const dynamic = "force-dynamic";

export default function DesinscriptionPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-4 py-16">
      <Suspense
        fallback={
          <Loader libelle="Chargement du formulaire…" variante="ligne" />
        }
      >
        <UnsubscribeForm />
      </Suspense>
    </main>
  );
}
