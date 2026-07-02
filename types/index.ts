import type { LucideIcon } from "lucide-react";

export interface NavLink {
  label: string;
  href: string;
}

export interface MethodPillar {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface Transformation {
  id: string;
  name: string;
  duration: string;
  goal: string;
  quote: string;
}

export interface NewsletterGoalOption {
  value: string;
  label: string;
}
