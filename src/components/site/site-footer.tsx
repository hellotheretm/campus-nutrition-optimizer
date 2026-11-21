import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/menus", label: "Dining menus" },
      { href: "/optimizer", label: "Meal optimizer" },
      { href: "/diary", label: "Food diary" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Campuses",
    links: [
      { href: "/universities", label: "Supported universities" },
      { href: "/request-university", label: "Request your university" },
    ],
  },
  {
    title: "Data",
    links: [
      { href: "/#transparency", label: "How estimates work" },
      { href: "https://fdc.nal.usda.gov/", label: "USDA FoodData Central", external: true },
      { href: "https://www.housing.wisc.edu/dining/nutrition/", label: "UW–Madison dining nutrition", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-card/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)] md:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Dining-hall menus, honest nutrition estimates and meal plans for students. General information only, not medical advice.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  {"external" in l && l.external ? (
                    <a href={l.href} className="text-muted-foreground hover:text-foreground" target="_blank" rel="noreferrer">
                      {l.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={l.href} className="text-muted-foreground hover:text-foreground">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto grid max-w-6xl gap-3 px-4 py-6 text-xs leading-relaxed text-muted-foreground md:px-8">
          <p>
            <strong className="font-semibold text-foreground/80">Not affiliated.</strong> Campus Nutrition Optimizer is an independent project. It is
            not affiliated with, sponsored by or endorsed by the University of Wisconsin–Madison, University Housing, Nutrislice or the U.S.
            Department of Agriculture. Menus, recipes and allergens can change; if you have a food allergy, confirm with dining staff before
            eating.
          </p>
          <p>
            <strong className="font-semibold text-foreground/80">Data.</strong> Nutrient composition data: U.S. Department of Agriculture,
            Agricultural Research Service, FoodData Central (Foundation Foods, SR Legacy and FNDDS), public domain. Dining-hall menus come from the
            operator&apos;s published Nutrislice menus or from imported menu files; this site is not affiliated with or endorsed by any
            university or Nutrislice.
          </p>
          <p>
            <strong className="font-semibold text-foreground/80">Photo.</strong> “View from Bascom Hill in autumn” by Yinan Chen, public domain,
            via{" "}
            <a href="https://commons.wikimedia.org/wiki/File:View_from_Bascom_Hill_in_autumn.jpg" className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer">
              Wikimedia Commons
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
