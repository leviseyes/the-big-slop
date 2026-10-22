"use client";
import { useState } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function ProductionTitleEditor({
  id,
  title,
  onSaved,
}: {
  id: string;
  title: string;
  onSaved: (title: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(title),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Rename ${title}`}
        onClick={() => {
          setValue(title);
          setError("");
          setOpen(true);
        }}
      >
        <Pencil size={14} /> Rename
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent>
          <DialogTitle>Edit production title</DialogTitle>
          <DialogDescription>
            Update the title in your studio and library. Existing videos and
            ongoing generation stay unchanged.
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await fetch("/api/library", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "rename", id, title: value }),
                });
                const result = (await r.json()) as {
                  title: string;
                  error?: string;
                };
                if (!r.ok)
                  throw new Error(result.error || "Unable to save the title.");
                onSaved(result.title);
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to save the title.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="library-field">
              Production title
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={120}
                required
                disabled={busy}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Loader2 className="spin" />}{" "}
              {busy ? "Saving…" : "Save title"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
