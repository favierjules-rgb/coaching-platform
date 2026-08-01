import { existsSync } from "node:fs";
import path from "node:path";

import Image from "next/image";

import { AnimatedCounter } from "@/components/sections/AnimatedCounter";
import { SectionLabel } from "@/components/ui/SectionLabel";

/**
 * Section home page « Mon histoire » (chantier `feat/home-mon-histoire`),
 * placée juste après `Newsletter` : une fois les offres et l'inscription
 * passées, le visiteur veut savoir à qui il a affaire. C'est de la preuve
 * sociale humaine — le parcours du coach, pas un argumentaire de vente.
 *
 * Identité visuelle : strictement noir, blanc et gris. Aucune couleur, aucun
 * accent — la section « Mon bilan offert » est la seule à en porter un, et
 * doit le rester pour garder sa force d'appel. Ce qui est repris de
 * « Bilan offert », c'est le SOIN : encadré au rayon fluide, halo très
 * étalé, mesure de texte bornée, typographie resserrée. Pas la teinte.
 *
 * Mise en page : deux colonnes à partir de `lg`, photo à gauche, contenu à
 * droite. En dessous, une seule colonne dans l'ordre demandé — label, titre,
 * compteur, photo, texte — obtenu par `order-*` plutôt qu'en dupliquant le
 * balisage, pour qu'il n'existe qu'une seule source de vérité par élément.
 *
 * Aucune largeur fixe : rembourrages et rayons en `clamp()`, colonnes en
 * `minmax(0, …)` donc rétractables jusqu'à 320 px.
 */

/**
 * Photo du coach. Un seul endroit à changer pour la remplacer.
 *
 * Elle est posée en `fill` dans un cadre au ratio imposé plutôt qu'avec des
 * dimensions déclarées : le fichier actuel est un paysage 2556×1707 porteur
 * d'une rotation EXIF, et une image redressée par le navigateur ne
 * correspond alors plus aux `width`/`height` du code — ce qui la
 * déformerait. Avec `fill` + `object-cover`, seul le cadre décide de la
 * forme, quelle que soit l'orientation restituée. `w-full` sur la figure
 * n'est PAS décoratif : sans largeur définie, Safari refuse de résoudre
 * `aspect-ratio` sur un élément dont le seul contenu est absolu — hauteur
 * zéro, photo invisible sur iPhone (régression corrigée, fix/home-story-
 * photo-iphone). La photo est servie en noir et blanc (`grayscale`), comme
 * celle du héro.
 *
 * Tant que le fichier n'existe pas, la section rend un cadre neutre plutôt
 * qu'une image cassée (contrôle fait au build, jamais à chaque requête).
 */
const PORTRAIT = "/brand/hero-running.webp";
const portraitDisponible = existsSync(path.join(process.cwd(), "public", PORTRAIT));

const paragraphes = [
  "J'ai commencé le sport très tôt, avec 10 années de judo, puis les sports de glisse, tout en développant en parallèle une vraie curiosité pour la préparation physique à la maison.",
  "Le vrai tournant est arrivé lorsque je suis arrivé en France. J'y ai découvert les salles de sport, et ma vision de l'entraînement s'est élargie vers de nouvelles disciplines : street workout, force, puis sports d'endurance.",
  "En première année de STAPS, avec une spécialisation en force athlétique, j'ai progressivement construit des bases solides autour des mouvements fondamentaux : squat, développé couché et soulevé de terre. Après plusieurs années d'entraînement et d'études, j'ai eu l'opportunité de rencontrer des athlètes de haut niveau, ce qui a renforcé mon ambition.",
  "J'ai alors pris une licence en force athlétique avec un objectif clair : participer aux championnats de France. Trois ans après mes débuts dans la discipline, j'ai atteint cet objectif, avec des performances à plus de 250 kg au squat, 150 kg au développé couché et 300 kg au soulevé de terre. Cette progression m'a permis d'être sélectionné aux championnats de France, et de partager la scène avec de grands athlètes, tout en validant mon diplôme d'éducateur sportif.",
  "Avec le temps, j'ai choisi de mettre de côté la pratique à niveau national pour me consacrer pleinement à ce qui m'anime aujourd'hui : aider, transmettre et faire progresser.",
];

export function PersonalStory() {
  return (
    <section id="mon-histoire" className="histoire scroll-mt-24 overflow-hidden bg-background py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* `items-stretch` : en deux colonnes, la photo prend toute la hauteur
            du texte — c'est ce qui aligne réellement les deux colonnes, la
            réduction du corps de texte à partir de `lg` faisant le reste.
            L'écart vertical est resserré en mobile (compteur → photo → texte
            se suivent de près) et retrouve de l'air en deux colonnes. */}
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16">
          {/* Photo — première colonne en desktop, quatrième bloc en mobile. */}
          <figure className="histoire-photo order-4 m-0 w-full aspect-[4/5] lg:order-none lg:aspect-auto lg:h-full lg:min-h-[32rem]">
            {portraitDisponible ? (
              <Image
                src={PORTRAIT}
                alt="Jules, coach en préparation physique, sur la piste d'athlétisme"
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover object-center grayscale"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-full w-full items-center justify-center bg-gradient-to-b from-white/[0.06] to-white/[0.02]"
              >
                <span className="font-heading text-5xl font-extrabold uppercase tracking-tight text-white/15">Seth</span>
              </div>
            )}
          </figure>

          {/* Contenu — deuxième colonne en desktop, réordonné en mobile. */}
          <div className="contents lg:flex lg:flex-col lg:justify-center lg:max-w-[58ch]">
            <div className="order-1 lg:order-none">
              <SectionLabel>Mon parcours</SectionLabel>
              <h2 className="mb-4 font-heading text-[2.5rem] lg:mb-6 font-extrabold uppercase leading-[0.92] tracking-[-0.03em] text-foreground sm:text-5xl md:text-6xl">
                Mon histoire
              </h2>
            </div>

            {/* Compteur — volontairement le plus gros élément après le titre. */}
            <p className="histoire-compteur order-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 lg:order-none lg:mb-7">
              <AnimatedCounter
                target={103}
                suffix="+"
                className="font-heading text-[3.25rem] font-extrabold leading-none tracking-[-0.04em] text-foreground sm:text-6xl"
              />
              <span className="text-[0.8rem] uppercase tracking-[0.18em] text-muted-foreground">
                élèves accompagnés
              </span>
            </p>

            <div className="order-5 lg:order-none">
              {paragraphes.map((texte) => (
                <p key={texte} className="mb-3 text-[0.95rem] leading-relaxed text-muted-foreground lg:mb-2.5 lg:text-[0.83rem] lg:leading-[1.55]">
                  {texte}
                </p>
              ))}

              <blockquote className="histoire-citation mt-6 lg:mt-5">
                <p className="font-heading text-[1.35rem] font-bold uppercase leading-[1.15] tracking-[-0.01em] text-foreground sm:text-2xl lg:text-[1.2rem]">
                  Désormais, mes ambitions sont devenues celles de mes élèves.
                </p>
              </blockquote>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
