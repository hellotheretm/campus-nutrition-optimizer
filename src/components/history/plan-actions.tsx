"use client";

import { LoaderCircle, NotebookPen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { addSavedPlanToDiaryAction, deletePlanAction } from "@/app/actions/plans";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Open / add to diary / delete for one saved plan. */
export function PlanActions({ id, name, date }: { id: string; name: string; date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function addToDiary() {
    start(async () => {
      const res = await addSavedPlanToDiaryAction(id, "planned");
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data ? `Added ${res.data} item${res.data === 1 ? "" : "s"} to your diary as planned` : "Nothing to add", {
        action: { label: "Open diary", onClick: () => router.push(`/diary?date=${date}`) },
      });
    });
  }

  function remove() {
    start(async () => {
      const res = await deletePlanAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Plan deleted");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button asChild size="sm" variant="outline" className="rounded-full">
        <Link href={`/optimizer?plan=${encodeURIComponent(id)}`}>
          Open<span className="sr-only"> {name} in the optimizer</span>
        </Link>
      </Button>
      <Button size="sm" variant="ghost" className="rounded-full" onClick={addToDiary} disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <NotebookPen aria-hidden="true" />}
        Add to diary<span className="sr-only">: {name}</span>
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Delete ${name}`} disabled={pending}>
            <Trash2 aria-hidden="true" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              “{name}” will be removed from your saved plans. Diary entries you already added from it stay in your diary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
