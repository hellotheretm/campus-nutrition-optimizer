"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleFavoriteAction } from "@/app/actions/diary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  foodKey,
  name,
  initial,
  signedIn,
  next,
}: {
  foodKey: string;
  name: string;
  initial: boolean;
  signedIn: boolean;
  next: string;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  if (!signedIn) {
    return (
      <Button asChild variant="outline" className="rounded-full">
        <Link href={`/login?next=${encodeURIComponent(next)}`}>
          <Heart aria-hidden="true" /> Sign in to save
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("rounded-full", on && "border-primary/40 bg-primary/5 text-primary hover:text-primary")}
      aria-pressed={on}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await toggleFavoriteAction(foodKey, name);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          setOn(res.data);
          toast.success(res.data ? "Added to favorites" : "Removed from favorites");
        })
      }
    >
      <Heart className={cn(on && "fill-current")} aria-hidden="true" />
      {on ? "Favorite" : "Add to favorites"}
    </Button>
  );
}
