"use client";

import { useRef, useState } from "react";
import { ImageOff, Loader2, Upload, X } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteBannerFileByPublicUrl, uploadBannerFile, type BannerKind } from "@/lib/supabase/storage-banners";

/**
 * Upload de photo bannière (programme ou séance — chantier module
 * Programmation, étape 4). Composant "sans état serveur" : upload direct
 * vers le bucket public "banners" au choix du fichier, puis `onChange`
 * reçoit la nouvelle URL publique (ou null après suppression) — l'appelant
 * décide quand/comment persister (généralement au prochain "Enregistrer" du
 * builder, même principe que les autres champs de DayCard/réglages
 * programme).
 */
export function BannerUploadField({
  label,
  kind,
  entityId,
  value,
  onChange,
}: {
  label: string;
  kind: BannerKind;
  entityId: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase non configuré.");
      return;
    }

    setUploading(true);
    setError(null);
    const result = await uploadBannerFile(supabase, kind, entityId, file);
    setUploading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    const previousUrl = value;
    onChange(result.publicUrl);
    if (previousUrl) {
      await deleteBannerFileByPublicUrl(supabase, previousUrl);
    }
  }

  async function handleRemove() {
    if (!value) return;
    const supabase = createSupabaseBrowserClient();
    const previousUrl = value;
    onChange(null);
    if (supabase) {
      await deleteBannerFileByPublicUrl(supabase, previousUrl);
    }
  }

  return (
    <div>
      <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">{label}</label>
      {value ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- bucket Storage public, URL externe */}
          <img src={value} alt="" className="h-32 w-full border border-border object-cover" />
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Supprimer la bannière"
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:border-red-500 hover:text-red-400"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          <span className="text-xs uppercase tracking-widest">{uploading ? "Envoi..." : "Ajouter une bannière"}</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />
      {error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
          <ImageOff size={12} />
          {error}
        </p>
      )}
    </div>
  );
}
