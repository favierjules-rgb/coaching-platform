"use client";

import Link from "next/link";
import { Activity } from "lucide-react";

import { EVENT_ICONS, relativeTime } from "@/components/admin/ActivityFeed";
import type { ActivityEvent } from "@/types";
import { Loader } from "@/components/ui/Loader";

/**
 * Notifications du dashboard admin (polish final, remplace les exemples
 * codés en dur). Source : `activity_events` via useSupabaseActivity — la
 * même donnée que le Centre d'activité, aucune table ni migration ajoutée.
 *
 * `buildNotifications` est une fonction pure : déduplication par id →
 * tri par date décroissante → slice(0, 4). Elle tolère les dates invalides
 * (repoussées en fin de liste) et ne dépend d'aucun état React.
 */

const MAX_NOTIFICATIONS = 4;

export interface DashboardNotification {
  id: string;
  eventType: ActivityEvent["eventType"];
  title: string;
  createdAt: string;
  /** Destination fiable uniquement : metadata.link, sinon la fiche élève, sinon null (ligne non cliquable). */
  href: string | null;
  isRead: boolean;
}

function eventHref(event: ActivityEvent): string | null {
  const link = event.metadata?.link;
  if (typeof link === "string" && link.startsWith("/")) return link;
  if (event.studentId) return `/admin/eleves/${event.studentId}`;
  return null;
}

function timeValue(dateIso: string): number {
  const value = new Date(dateIso).getTime();
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

export function buildNotifications(events: ActivityEvent[], limit = MAX_NOTIFICATIONS): DashboardNotification[] {
  const seen = new Set<string>();
  const deduped: ActivityEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    deduped.push(event);
  }
  return deduped
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      title: event.title,
      createdAt: event.createdAt,
      href: eventHref(event),
      isRead: event.isRead,
    }));
}

interface DashboardNotificationsProps {
  events: ActivityEvent[];
  loading: boolean;
}

export function DashboardNotifications({ events, loading }: DashboardNotificationsProps) {
  if (loading) {
    return (
      <Loader libelle="Chargement des notifications…" variante="ligne" />
    );
  }

  const notifications = buildNotifications(events);

  if (notifications.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune notification pour le moment — les événements récents (retours, rendez-vous, paiements, documents)
        apparaîtront ici.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {notifications.map((notification) => {
        const Icon = EVENT_ICONS[notification.eventType] ?? Activity;
        const inner = (
          <>
            <Icon size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-primary" />
            <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{notification.title}</span>
            <span className="flex-none text-[11px] uppercase tracking-wide text-muted-foreground">
              {relativeTime(notification.createdAt)}
            </span>
          </>
        );
        const rowClass = `flex items-start gap-3 rounded-panel border p-4 ${
          notification.isRead ? "border-border" : "border-primary/40 bg-primary/5"
        }`;
        return (
          <li key={notification.id}>
            {notification.href ? (
              <Link
                href={notification.href}
                className={`${rowClass} pressable transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
              >
                {inner}
              </Link>
            ) : (
              <div className={rowClass}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
