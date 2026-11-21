import {
  ArrowRight,
  CircleCheck,
  CircleQuestionMark,
  Database,
  FlaskConical,
  Leaf,
  ListChecks,
  NotebookPen,
  Scale,
  School,
  SlidersHorizontal,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderAccount, HeaderAccountFallback } from "@/components/site/header-account";
import { Reveal } from "@/components/site/reveal";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { PROVENANCE_DESCRIPTIONS, PROVENANCE_LABELS, type Provenance } from "@/lib/nutrition/provenance";
import { GOAL_NUTRIENTS } from "@/lib/optimizer/targets";
import { UW_MADISON } from "@/lib/universities/catalog";
import campus from "../../public/images/campus/bascom-hill-autumn.jpg";

const FEATURES = [
  {
    icon: UtensilsCrossed,
    title: "Menus by day, market and meal",
    body: "See what each dining market serves for breakfast, lunch and dinner. Every menu shows when it was last updated, and gaps stay gaps. We never fill them with made-up dishes.",
  },
  {
    icon: Sparkles,
    title: "A real meal optimizer",
    body: "A mixed-integer program chooses dishes and portions across the halls you pick, covering vitamins, minerals, protein and fiber while staying within sensible limits.",
  },
  {
    icon: NotebookPen,
    title: "A food diary, only if you want one",
    body: "Log what you ate, copy days and save go-to meals. The diary and the optimizer are independent, so you can use either one on its own.",
  },
  {
    icon: FlaskConical,
    title: "Transparent micronutrients",
    body: "Vitamins and minerals are estimated from USDA FoodData Central with ranges and confidence labels. Unknown values are never shown as zero.",
  },
  {
    icon: SlidersHorizontal,
    title: "Your preferences, respected",
    body: "Vegetarian, vegan or pescatarian, allergens, ingredients to skip, dislikes and favorites. Allergen filters only remove items. Always confirm with dining staff.",
  },
  {
    icon: School,
    title: "Ready for more campuses",
    body: "Menu sources plug in per university. Don't see yours? Request it, and other students can add their support.",
  },
];

const STEPS = [
  {
    title: "Pick your day and dining halls",
    body: "Choose a date, the meals you'll eat on campus and where. Pick one market per meal or let the optimizer consider them all.",
  },
  {
    title: "Tell it what matters",
    body: "Set a dietary pattern, allergens, dislikes and a goal style. Calorie targets are optional, for adults only, and never applied automatically.",
  },
  {
    title: "Get a balanced day",
    body: "See why each dish was chosen, how the day covers your nutrient references with confidence ranges, and other strategies to compare.",
  },
  {
    title: "Adjust and, if you like, track",
    body: "Lock dishes you love, swap or remove others, regenerate a single meal, then add the plan to your diary as planned meals.",
  },
];

const PROVENANCE_ORDER: { key: Provenance; icon: typeof CircleCheck }[] = [
  { key: "official", icon: CircleCheck },
  { key: "usda_match", icon: Database },
  { key: "usda_recipe", icon: FlaskConical },
  { key: "approximate", icon: Scale },
  { key: "unknown", icon: CircleQuestionMark },
];

export default function HomePage() {
  const account = (
    <Suspense fallback={<HeaderAccountFallback />}>
      <HeaderAccount />
    </Suspense>
  );

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader account={account} />
      <main id="main">
        {/* Hero */}
        <section className="relative isolate flex min-h-[100svh] items-end overflow-hidden bg-charcoal md:items-center">
          <Image
            src={campus}
            alt="Autumn trees lining Bascom Hill on the University of Wisconsin–Madison campus"
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="-z-20 object-cover object-[50%_45%]"
          />
          <div
            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(12,12,12,0.62)_0%,rgba(12,12,12,0.38)_38%,rgba(12,12,12,0.82)_100%)]"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_36rem_at_8%_100%,rgba(197,5,12,0.38),transparent_65%)]"
            aria-hidden="true"
          />
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-28 pb-14 md:px-8 md:pt-32 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:pb-24">
            <Reveal>
              <p className="glass-dark inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white/90">
                <span className="size-1.5 rounded-full bg-badger" aria-hidden="true" />
                Starting with UW–Madison · built for any campus
              </p>
              <h1 className="mt-5 max-w-3xl text-5xl leading-[1.02] font-semibold tracking-tight text-balance text-white sm:text-6xl md:text-7xl">
                Eat Smarter on Campus.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-pretty text-white/85 md:text-xl">
                Discover what&apos;s on the menu, understand your nutrition, and find meals that work for you.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full px-6 text-base shadow-lg shadow-black/30">
                  <Link href="/optimizer">
                    <Sparkles aria-hidden="true" />
                    Optimize My Meals
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-white/35 bg-white/10 px-6 text-base text-white backdrop-blur-md hover:bg-white/20 hover:text-white dark:border-white/35 dark:bg-white/10 dark:hover:bg-white/20"
                >
                  <Link href="/menus">
                    <UtensilsCrossed aria-hidden="true" />
                    Explore Today&apos;s Menu
                  </Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={0.15} className="hidden lg:block">
              <div className="glass-dark rounded-3xl p-5 text-white">
                <p className="text-xs font-semibold tracking-[0.14em] text-white/70 uppercase">Every number says where it came from</p>
                <ul className="mt-4 grid gap-2.5">
                  {PROVENANCE_ORDER.map(({ key, icon: Icon }) => (
                    <li key={key} className="flex items-start gap-3 rounded-2xl bg-white/[0.06] px-3 py-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-white/90" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-medium">{PROVENANCE_LABELS[key]}</span>
                        <span className="block text-xs leading-relaxed text-white/70">{PROVENANCE_DESCRIPTIONS[key]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Facts strip */}
        <section aria-label="At a glance" className="relative z-10 mx-auto -mt-8 max-w-6xl px-4 md:px-8">
          <ul className="glass-strong grid grid-cols-2 gap-px overflow-hidden rounded-3xl md:grid-cols-4">
            {[
              { value: String(UW_MADISON.locations.length), label: "UW–Madison dining markets mapped, with official hours" },
              { value: String(GOAL_NUTRIENTS.length), label: "vitamins, minerals and macros the optimizer balances" },
              { value: "3", label: "USDA FoodData Central datasets behind every estimate" },
              { value: "0", label: "unknown values quietly shown as zero" },
            ].map((s) => (
              <li key={s.label} className="bg-card/40 p-5">
                <p className="text-3xl font-semibold tracking-tight text-primary">{s.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-28" aria-labelledby="features-title">
          <Reveal>
            <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">What you can do</p>
            <h2 id="features-title" className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
              Everything you need between class and the dining hall
            </h2>
          </Reveal>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <li key={f.title}>
                <Reveal delay={i * 0.05} className="h-full">
                  <div className="glass h-full rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-0.5">
                    <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <f.icon className="size-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24 bg-charcoal py-20 text-white md:py-28" aria-labelledby="how-title">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <Reveal>
              <p className="text-xs font-semibold tracking-[0.14em] text-[#ff8a8f] uppercase">How it works</p>
              <h2 id="how-title" className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                From today&apos;s menus to a balanced day in a few taps
              </h2>
            </Reveal>
            <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={i * 0.06} className="h-full">
                    <div className="h-full rounded-3xl border border-white/10 bg-white/[0.04] p-6">
                      <span className="grid size-9 place-items-center rounded-full bg-badger text-sm font-semibold" aria-hidden="true">
                        {i + 1}
                      </span>
                      <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/70">{s.body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 rounded-full px-5">
                <Link href="/optimizer">
                  Try the optimizer <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-11 rounded-full px-5 text-white hover:bg-white/10 hover:text-white">
                <Link href="/signup">Create a free account</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Transparency */}
        <section id="transparency" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 md:px-8 md:py-28" aria-labelledby="transparency-title">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <Reveal>
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Our data</p>
              <h2 id="transparency-title" className="mt-2 text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                Honest about what we know, and what we don&apos;t
              </h2>
              <div className="mt-5 grid gap-4 text-sm leading-relaxed text-muted-foreground md:text-base">
                <p>
                  Dining halls usually publish calories, macronutrients and a handful of label nutrients. Most vitamins and minerals are not
                  published, so we estimate them from USDA FoodData Central.
                </p>
                <p>
                  When an ingredient list is available, each ingredient is matched to USDA data and amounts are solved so the recipe reproduces
                  the published calories and macros. Cooking losses are applied, and every estimate keeps a range, a provenance label and a
                  confidence level.
                </p>
                <p>
                  The optimizer counts uncertain values conservatively, so it doesn&apos;t lean on optimistic guesses. When there&apos;s no
                  reliable information, the value is listed as unknown, never as zero.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <figure className="glass rounded-3xl p-5 md:p-6">
                <figcaption className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  How an estimate is displayed (illustration)
                </figcaption>
                <div className="mt-4 rounded-2xl bg-card/70 p-4 ring-1 ring-foreground/5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">Vitamin C</span>
                    <span className="text-lg font-semibold tabular-nums">≈ 18 mg</span>
                  </div>
                  <div className="relative mt-3 h-2.5 rounded-full bg-muted" aria-hidden="true">
                    <div className="absolute inset-y-0 left-[12%] w-[30%] rounded-full bg-prov-recipe/25" />
                    <div className="absolute inset-y-[-3px] left-[22%] w-1 rounded-full bg-prov-recipe" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Likely range 9–30 mg · 20% of the daily value</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-medium text-prov-recipe">
                      <FlaskConical className="size-3" aria-hidden="true" /> USDA recipe-derived
                    </span>
                    <span className="inline-flex h-5 items-center rounded-full bg-conf-medium/10 px-2 text-[11px] font-medium text-conf-medium ring-1 ring-conf-medium/30 ring-inset">
                      Medium confidence
                    </span>
                  </div>
                </div>
                <ul className="mt-4 grid gap-2 text-sm">
                  {[
                    { icon: CircleCheck, text: "Official values come straight from the dining operator's published nutrition." },
                    { icon: ListChecks, text: "Each estimate links to the USDA records and ingredient amounts behind it." },
                    { icon: Leaf, text: "Allergen and dietary labels are shown exactly as the source published them." },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex gap-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="text-muted-foreground">{text}</span>
                    </li>
                  ))}
                </ul>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* Request a university */}
        <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8 md:pb-28" aria-labelledby="request-title">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-badger to-badger-dark p-8 text-white md:p-12">
              <div className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
              <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <h2 id="request-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
                    Don&apos;t see your university?
                  </h2>
                  <p className="mt-3 max-w-xl text-white/85">
                    Tell us which campus to add next. Requests from several students help us decide where to go, and we&apos;ll only add
                    menus the dining operator lets us use.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
                  <Button asChild size="lg" variant="secondary" className="h-11 rounded-full bg-white px-5 text-badger-dark hover:bg-white/90">
                    <Link href="/request-university">Request your university</Link>
                  </Button>
                  <Button asChild size="lg" variant="ghost" className="h-11 rounded-full px-5 text-white hover:bg-white/10 hover:text-white">
                    <Link href="/universities">See supported campuses</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
