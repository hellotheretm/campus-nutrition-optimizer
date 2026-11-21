import Image from "next/image";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import campus from "../../../public/images/campus/bascom-hill-autumn.jpg";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-charcoal">
      <Image src={campus} alt="" fill priority placeholder="blur" sizes="100vw" className="-z-20 object-cover" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/65 via-black/50 to-badger-dark/70" aria-hidden="true" />
      <div className="flex min-h-dvh flex-col">
        <header className="p-4 md:p-6">
          <Logo tone="light" />
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-4 pb-10">
          {children}
        </main>
        <footer className="px-4 pb-4 text-center text-xs text-white/70">
          Photo: “View from Bascom Hill in autumn” by Yinan Chen, public domain, via Wikimedia Commons.
        </footer>
      </div>
    </div>
  );
}
