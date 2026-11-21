"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reestimateAction, setRequestStatusAction, syncUniversityAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SyncButton({ universityId, universityName, disabledReason }: { universityId: string; universityName: string; disabledReason: string | null }) {
  const [pending, start] = useTransition();
  const describedBy = disabledReason ? `sync-why-${universityId}` : undefined;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || Boolean(disabledReason)}
        aria-describedby={describedBy}
        onClick={() =>
          start(async () => {
            const r = await syncUniversityAction(universityId);
            if (r.ok) toast.success(r.data.message);
            else toast.error(r.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        {pending ? "Syncing…" : "Sync now"}
        <span className="sr-only"> for {universityName}</span>
      </Button>
      {disabledReason && (
        <p id={describedBy} className="max-w-xs text-xs text-muted-foreground">
          {disabledReason}
        </p>
      )}
    </div>
  );
}

export function ReestimateButton({ outdated }: { outdated: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || outdated === 0}
      onClick={() =>
        start(async () => {
          const r = await reestimateAction();
          if (r.ok) toast.success(`Updated ${r.data.updated} foods; ${r.data.remaining} still to do.`);
          else toast.error(r.error);
        })
      }
    >
      {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
      {pending ? "Re-estimating…" : outdated ? "Re-estimate up to 200 foods" : "All estimates are current"}
    </Button>
  );
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  planned: "Planned",
  declined: "Declined",
  added: "Added",
};

export function RequestStatusSelect({ id, status, name }: { id: string; status: string; name: string }) {
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(next) => {
        const prev = value;
        setValue(next);
        start(async () => {
          const r = await setRequestStatusAction(id, next);
          if (!r.ok) {
            setValue(prev);
            toast.error(r.error);
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-32" aria-label={`Status for ${name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <SelectItem key={k} value={k}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
