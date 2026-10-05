"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  PlayCircle,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react";

import { ImportantMark } from "@/components/admin/ImportantMark";
import { FileViewerModal } from "@/components/shared/FileViewerModal";
import { VideoPlayerModal } from "@/components/shared/VideoPlayerModal";
import { DocumentStatusBadge } from "@/components/student/DocumentStatusBadge";
import { documentCategoryLabels, documentTypeLabels, formatDate, matchesTextSearch } from "@/lib/admin";
import { documentKind, type DocumentKind } from "@/lib/documents";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { markDocumentViewed, type StudentDocumentWithAvailability } from "@/lib/supabase/documents";
import { getSignedDocumentFileUrl } from "@/lib/supabase/storage-documents";
import { videoLisible } from "@/lib/video/source";
import type { DocumentCategory, DocumentType } from "@/types";

type FilterKey = "tous" | DocumentCategory | "vidéo" | "guide" | "verrouilles";

const filters: { key: FilterKey; label: string }[] = [
  { key: "tous", label: "Mes documents" },
  { key: "vidéo", label: "Vidéos" },
  { key: "guide", label: "Guides" },
  { key: "nutrition", label: "Nutrition" },
  { key: "entrainement", label: "Entraînement" },
  { key: "administratif", label: "Administratif" },
  { key: "verrouilles", label: "À venir / verrouillés" },
];

function matchesFilter(item: StudentDocumentWithAvailability, filter: FilterKey): boolean {
  if (filter === "tous") return true;
  if (filter === "verrouilles") return !item.availability.available;
  if (filter === "vidéo" || filter === "guide") return item.document.type === filter;
  return item.document.category === filter;
}

function unlockLabel(unlockDate: string | null): string {
  if (!unlockDate) return "Disponible bientôt";
  const target = new Date(unlockDate);
  const diffDays = Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays > 0) {
    return `Disponible dans ${diffDays} jour${diffDays > 1 ? "s" : ""} (${formatDate(unlockDate)})`;
  }
  return `Disponible le ${formatDate(unlockDate)}`;
}

/**
 * ⚠️ LE POINT DE COULEUR ÉDITORIAL A ÉTÉ RETIRÉ (A), PAS DÉPLACÉ.
 *
 * Il affichait `document.status` — brouillon / publié / archivé — c'est-à-dire
 * une information de COACH, sur la carte d'un ÉLÈVE. La RLS ne renvoyant que
 * les documents publiés, il était toujours vert : un pixel qui ne disait rien,
 * et qui aurait affiché un point rouge inexpliqué le jour où un document
 * archivé serait passé. Sa place est prise par le statut de CONSULTATION, qui
 * est l'information que l'élève cherche à cet endroit.
 */

/** Icône de repli quand il n'y a pas de miniature — même table que la carte de démonstration. */
const typeIcons: Record<DocumentType, LucideIcon> = {
  pdf: FileText,
  "vidéo": Video,
  guide: FileText,
  lien: Link2,
  image: ImageIcon,
  texte: StickyNote,
};

/**
 * Ouvre un fichier réellement uploadé (Storage privé) via une URL signée
 * générée à la demande — jamais d'URL stockée/permanente. La génération
 * elle-même est soumise à la policy RLS du bucket (voir schema.sql,
 * `documents_bucket_select_accessible`) : un document verrouillé côté app
 * n'expose de toute façon jamais ce bouton (voir `availability.available`
 * plus bas), donc ce chemin n'est jamais atteint pour un document non
 * débloqué.
 */
/**
 * Une vidéo dont l'adresse est PUBLIQUE (YouTube) : pas de signature à
 * demander, mais surtout pas de redirection non plus. Le lecteur s'ouvre
 * dans SETH, comme partout ailleurs.
 */
function VideoLienButton({ titre, url }: { titre: string; url: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <PlayCircle size={14} />
        Voir la vidéo
      </button>
      <VideoPlayerModal ouvert={ouvert} onFermer={() => setOuvert(false)} titre={titre} url={url} />
    </>
  );
}

function StorageFileButton({
  storagePath,
  label,
  icon: Icon,
  genre,
  titre,
  kind,
  onConsulte,
}: {
  storagePath: string;
  label: string;
  icon: typeof Download;
  /** Ce qu'on ouvrira : un lecteur vidéo, ou la visionneuse de document. */
  genre: "video" | "fichier";
  titre: string;
  /** Nature réelle du fichier (`documentKind`) — transmise à la visionneuse. */
  kind: DocumentKind;
  /**
   * Appelé UNE SEULE FOIS, et seulement APRÈS une signature réussie (A).
   * `undefined` = pas de suivi possible (pas de chemin Supabase).
   */
  onConsulte?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);

  /**
   * Une URL SIGNÉE, obtenue à la demande et jamais conservée ailleurs que
   * dans cet état React : ni localStorage, ni IndexedDB, ni Cache Storage.
   * Elle expire, et c'est voulu — `onRafraichir` en redemande une par le
   * même mécanisme plutôt que de rendre le document public.
   */
  async function signer(): Promise<string | null> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return null;
    return getSignedDocumentFileUrl(supabase, storagePath);
  }

  async function handleOpen() {
    setLoading(true);
    setError(false);
    const fraiche = await signer();
    setLoading(false);
    if (!fraiche) {
      setError(true);
      // ⚠️ ON SORT AVANT TOUT MARQUAGE. Une signature refusée — RLS, réseau,
      // fichier inaccessible — n'est PAS une consultation. Marquer ici
      // daterait un document que l'élève n'a jamais vu, et la date de
      // première consultation ne se réécrit pas : l'erreur serait définitive.
      return;
    }
    setUrl(fraiche);
    // La voie normale, et la seule : la modale SETH. Aucune redirection,
    // aucun nouvel onglet.
    setOuvert(true);

    // ORDRE OBLIGATOIRE : SIGNATURE → SUCCÈS → viewed_at → évènement.
    // Le marquage vient APRÈS l'ouverture et n'est jamais attendu par elle :
    // un échec d'écriture ne doit pas empêcher l'élève de lire son document.
    await onConsulte?.();
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={loading}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
        {label}
      </button>
      {error && (
        <span className="text-[11px] text-destructive">Ce document n&apos;est pas disponible.</span>
      )}
      {genre === "video" ? (
        <VideoPlayerModal
          ouvert={ouvert}
          onFermer={() => setOuvert(false)}
          titre={titre}
          url={url}
          onRafraichir={signer}
        />
      ) : (
        <FileViewerModal
          ouvert={ouvert}
          onFermer={() => setOuvert(false)}
          titre={titre}
          url={url}
          onRafraichir={signer}
          kind={kind}
        />
      )}
    </div>
  );
}

/**
 * LA MINIATURE D'UNE IMAGE — UNE SEULE SIGNATURE, ET AUCUNE POUR UN VERROUILLÉ.
 *
 * ═════════════════════════════════════════════════════════════════════
 * AUCUNE INFRASTRUCTURE NOUVELLE, ET C'EST LE POINT
 * ═════════════════════════════════════════════════════════════════════
 * Pas de `thumbnail_path`, pas d'Edge Function, pas de worker : le navigateur
 * redimensionne l'original, borné à 10 Mo par `validateDocumentFile`. La
 * seule chose dont une vraie miniature Storage nous dispenserait est le
 * téléchargement de l'original — un coût à mesurer le jour où une
 * bibliothèque d'images existe, pas à prévoir aujourd'hui.
 *
 * ═════════════════════════════════════════════════════════════════════
 * UN VERROUILLÉ NE SE SIGNE PAS
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ Ce composant n'est MONTÉ que pour un document disponible (voir la
 * garde dans `DocumentCard`), et il porte en plus sa propre vérification.
 * Afficher la miniature d'un document à venir en téléchargerait le contenu :
 * la policy Storage l'autoriserait (elle ne regarde que l'assignation, pas le
 * déblocage), et l'élève verrait le fichier avant sa date. Une double garde
 * pour une fuite définitive, c'est le bon compte.
 *
 * ═════════════════════════════════════════════════════════════════════
 * UNE SIGNATURE, PAS UNE BOUCLE
 * ═════════════════════════════════════════════════════════════════════
 * L'effet ne dépend que de `storagePath` et de `disponible`. `onError` pose
 * `echec` et ne redemande RIEN : une image dont l'URL a expiré ou dont le
 * fichier a disparu retombe sur l'icône de type, définitivement pour cette
 * carte. Une re-signature dans `onError` produirait exactement la boucle
 * qu'on refuse — échec, signature, échec, signature.
 *
 * L'URL ne quitte jamais cet état React : ni localStorage, ni IndexedDB.
 */
function MiniatureImage({
  storagePath,
  titre,
  disponible,
  Repli,
}: {
  storagePath: string;
  titre: string;
  disponible: boolean;
  Repli: LucideIcon;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  // Garde anti-double-signature en mode strict (double montage en dév).
  const demande = useRef<string | null>(null);

  useEffect(() => {
    if (!disponible) return;
    if (demande.current === storagePath) return;
    demande.current = storagePath;
    let annule = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const signee = await getSignedDocumentFileUrl(supabase, storagePath);
      if (annule) return;
      if (signee) {
        setUrl(signee);
      } else {
        setEchec(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, [storagePath, disponible]);

  if (!disponible || echec || !url) {
    return (
      <div
        className="flex h-40 w-full items-center justify-center rounded-panel border border-border bg-surface-soft/40"
        data-miniature="repli"
      >
        <Repli size={28} className="text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, hors next/image (pas de domaine stable à autoriser)
    <img
      src={url}
      alt={`Aperçu de ${titre}`}
      onError={() => setEchec(true)}
      loading="lazy"
      className="h-40 w-full rounded-panel border border-border object-cover"
      data-miniature="image"
    />
  );
}

function DocumentCard({
  item,
  onConsulte,
}: {
  item: StudentDocumentWithAvailability;
  /** Marque ce document comme consulté — voir `RealDocumentLibrary`. */
  onConsulte?: (documentId: string, titre: string) => void | Promise<void>;
}) {
  const { document, availability, viewedAt } = item;
  // Le MIME décide, jamais `document.type` seul (voir `documentKind`).
  const kind = documentKind(document);
  const Repli = typeIcons[document.type] ?? FileText;
  const marquer = onConsulte ? () => onConsulte(document.id, document.title) : undefined;

  return (
    <div className={`flex flex-col gap-3 rounded-card border border-border bg-card p-6 shadow-soft ${!availability.available ? "bg-surface-soft/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-heading text-base font-bold uppercase text-foreground">{document.title}</h3>
          {document.important && <ImportantMark />}
        </div>
        {/* LE STATUT DE CONSULTATION, source de vérité `document_assignments.viewed_at`.
            Jamais `localStorage`, jamais `document.status`. Un document verrouillé
            n'affiche rien : « Nouveau » sur un contenu qu'on ne peut pas ouvrir
            serait un reproche, pas une information. */}
        {availability.available && (
          <DocumentStatusBadge status={viewedAt ? "consulté" : "nouveau"} />
        )}
      </div>
      {/* La miniature ne concerne QUE les images déjà débloquées et téléversées. */}
      {kind === "image" && document.storagePath && availability.available && (
        <MiniatureImage
          storagePath={document.storagePath}
          titre={document.title}
          disponible={availability.available}
          Repli={Repli}
        />
      )}
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Repli size={13} aria-hidden className="flex-shrink-0" />
        {documentTypeLabels[document.type]} · {documentCategoryLabels[document.category]}
      </p>
      {document.shortDescription && <p className="text-sm text-foreground">{document.shortDescription}</p>}

      {!availability.available ? (
        <p className="flex items-center gap-2 rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <Lock size={13} className="flex-shrink-0" />
          {unlockLabel(availability.unlockDate)}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {document.type === "texte" && document.contentText && (
            <p className="whitespace-pre-wrap text-sm text-foreground">{document.contentText}</p>
          )}
          {document.type === "vidéo" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Voir la vidéo" icon={PlayCircle} genre="video" titre={document.title} kind={kind} onConsulte={marquer} />
            ) : (
              videoLisible(document.videoUrl) && (
                <VideoLienButton titre={document.title} url={document.videoUrl} />
              )
            ))}
          {document.type === "pdf" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Ouvrir le PDF" icon={FileText} genre="fichier" titre={document.title} kind={kind} onConsulte={marquer} />
            ) : (
              document.externalUrl && (
                <a
                  href={document.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Download size={14} />
                  Télécharger
                </a>
              )
            ))}
          {document.type !== "vidéo" &&
            document.type !== "pdf" &&
            document.type !== "texte" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Ouvrir" icon={ExternalLink} genre="fichier" titre={document.title} kind={kind} onConsulte={marquer} />
            ) : (
              document.externalUrl && (
                <a
                  href={document.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ExternalLink size={14} />
                  Ouvrir
                </a>
              )
            ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {availability.available ? `Publié le ${formatDate(document.createdAt)}` : ""}
      </p>
    </div>
  );
}

/**
 * LA BIBLIOTHÈQUE RÉELLE — AUCUN ÉTAT LOCAL NE SERT DE SOURCE DE VÉRITÉ (A).
 *
 * ⚠️ CE COMPOSANT N'IMPORTE PAS `useDocumentAccess`, ET NE DOIT JAMAIS LE
 * FAIRE. Ce hook lit et écrit `localStorage["seth-document-access:<id>"]`,
 * alimenté par un seed de démonstration (`data/student.ts`) : un statut par
 * navigateur, invisible du coach, absent du second appareil de l'élève, effacé
 * avec les données du site. Il reste en place pour la DÉMONSTRATION
 * (`DocumentLibrary`, `/documents/[documentId]`), et sert uniquement elle.
 *
 * Ici, le statut vient de `viewedAt`, lu dans `document_assignments` par
 * `getStudentDocumentsWithAvailability`. Rien d'autre.
 *
 * `studentId` et `onConsulte` sont OPTIONNELS : sans eux, la bibliothèque
 * affiche les statuts lus en base mais ne marque rien. C'est le cas du coach,
 * qui regarde la bibliothèque d'un élève sans la consulter à sa place.
 */
export function RealDocumentLibrary({
  documents,
  studentId,
  onConsulte,
}: {
  documents: StudentDocumentWithAvailability[];
  /** Élève connecté — requis pour marquer une consultation. */
  studentId?: string | null;
  /** Rafraîchissement après un marquage réussi (voir le hook appelant). */
  onConsulte?: () => void | Promise<void>;
}) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("tous");
  const [query, setQuery] = useState("");

  /**
   * ⚠️ LE REFETCH NE SE DÉCLENCHE QUE SUR UNE PREMIÈRE CONSULTATION.
   *
   * `markDocumentViewed` renvoie `true` seulement quand `viewed_at` VIENT
   * d'être posé — c'est la clause `viewed_at is null` de la fonction SQL qui
   * tranche, pas nous. Un second clic renvoie donc `false` et ne recharge
   * rien : aucune boucle, et aucune requête identique répétée.
   */
  const marquerConsulte = useCallback(
    async (documentId: string, titre: string) => {
      if (!studentId) return;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const premiere = await markDocumentViewed(supabase, {
        documentId,
        studentId,
        documentTitle: titre,
      });
      if (premiere) {
        await onConsulte?.();
      }
    },
    [studentId, onConsulte],
  );

  const filtered = useMemo(
    () =>
      documents.filter(
        (item) =>
          matchesFilter(item, activeFilter) &&
          matchesTextSearch([item.document.title, item.document.shortDescription], query),
      ),
    [documents, activeFilter, query],
  );

  if (documents.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText size={16} />
        Aucun document disponible pour le moment.
      </p>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher par titre ou description…"
        className="mb-6 w-full rounded-control border border-border bg-surface-soft px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      />

      <div className="mb-8 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            aria-pressed={activeFilter === filter.key}
            className={`pressable min-h-[44px] rounded-full border px-4 py-2 text-xs uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              activeFilter === filter.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document ne correspond à ta recherche.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <DocumentCard
              key={item.document.id}
              item={item}
              onConsulte={studentId ? marquerConsulte : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
