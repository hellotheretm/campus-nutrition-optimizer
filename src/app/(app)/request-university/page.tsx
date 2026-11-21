import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/app/page-header";
import { RequestUniversityForm } from "@/components/universities/request-form";

export const metadata: Metadata = {
  title: "Request a university",
  description: "Ask for your campus to be added to Campus Nutrition Optimizer.",
};

export default function RequestUniversityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Universities"
        title="Request your university"
        description="Tell us which campus to add next. Requests for the same school are combined so we can see where interest is highest."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel>
          <RequestUniversityForm />
        </Panel>
        <aside className="space-y-4 text-sm text-muted-foreground" aria-label="How campuses are added">
          <Panel as="div" className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">How a campus gets added</h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>We find where the dining operator publishes its menus and nutrition information.</li>
              <li>
                We check how that data can be used and, where we can, ask the operator or menu platform for permission.
              </li>
              <li>Menus are then synced on a schedule or loaded from menu files, and each campus page says which.</li>
            </ol>
            <p>
              We never invent menus. A campus without real menu data shows a notice and a link to its official menus
              instead.{" "}
              <Link href="/universities" className="font-medium text-primary underline-offset-4 hover:underline">
                See supported campuses
              </Link>
              .
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
