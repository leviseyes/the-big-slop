"use client";
import { useRef, useState } from "react";
import { Upload, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
type Item = {
  uploadId: string;
  file: Blob;
  preview: string;
  name: string;
  kind: string;
  description: string;
  assetId: string;
  clipIds: string[];
};
async function normalize(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Choose PNG, JPEG or WebP files of up to 20 MB each.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1024 / bitmap.width, 1024 / bitmap.height),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image conversion unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not read this image.")),
        "image/png",
      ),
    );
    if (blob.size > 5 * 1024 * 1024)
      throw new Error("This image is too large after conversion.");
    return { file: blob, preview: canvas.toDataURL("image/png") };
  } finally {
    bitmap.close();
  }
}
export default function ReferenceUpload({
  project,
  ensureSaved,
  onComplete,
  disabled = false,
}: {
  project: any;
  ensureSaved: () => Promise<any>;
  onComplete: (p: any) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const draft = ["references_ready", "ready"].includes(project?.status);
  const valid =
    items.length > 0 &&
    items.every(
      (i) =>
        i.name.trim() &&
        i.description.trim().length >= 3 &&
        (i.assetId || i.clipIds.length > 0),
    ) &&
    new Set(items.filter((i) => i.assetId).map((i) => i.assetId)).size ===
      items.filter((i) => i.assetId).length;
  function change(id: string, values: Partial<Item>) {
    setItems((old) =>
      old.map((i) => (i.uploadId === id ? { ...i, ...values } : i)),
    );
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setItems([]);
          setError("");
          setOpen(true);
        }}
      >
        <Upload /> Upload reference images
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="reference-batch-dialog">
          <DialogTitle>Bring your own references</DialogTitle>
          <DialogDescription>
            {draft
              ? "Replace existing characters, locations or props, or add new references and choose the clips that should use them. Nothing continues until you press Done in reference review."
              : "Choose the existing reference each image should replace. Its script identity stays the same."}{" "}
            Add up to 10 images at once.
          </DialogDescription>
          <input
            ref={input}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (!files.length) return;
              if (items.length + files.length > 10) {
                setError("Upload up to 10 images per batch.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const added: Item[] = [];
                for (const file of files)
                  added.push({
                    uploadId: crypto.randomUUID(),
                    ...(await normalize(file)),
                    name: file.name.replace(/\.[^.]+$/, ""),
                    kind: "character",
                    description: "",
                    assetId: "",
                    clipIds: [],
                  });
                setItems((old) => [...old, ...added]);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not read an image.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button
            variant="outline"
            disabled={busy || items.length >= 10}
            onClick={() => input.current?.click()}
          >
            <Upload /> Choose images
          </Button>
          <p className="fine-print">
            PNG, JPEG or WebP · up to 20 MB per original. Images are converted
            to PNG and resized to fit 1024 pixels while keeping their
            proportions.
          </p>
          <div className="reference-batch-editors">
            {items.map((i) => (
              <div className="reference-batch-item" key={i.uploadId}>
                <img src={i.preview} alt={i.name} />
                <div className="upload-reference-fields">
                  {!!project?.assets?.length && (
                    <label>
                      Use for
                      <Select
                        disabled={busy}
                        value={i.assetId || "new"}
                        onValueChange={(v) => {
                          const a = project.assets.find((a: any) => a.id === v);
                          change(
                            i.uploadId,
                            a
                              ? {
                                  assetId: a.id,
                                  name: a.name,
                                  kind: a.kind,
                                  description: a.description,
                                }
                              : { assetId: "" },
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {draft && (
                            <SelectItem value="new">New reference</SelectItem>
                          )}
                          {!draft && (
                            <SelectItem value="new" disabled>
                              Choose a reference
                            </SelectItem>
                          )}
                          {project.assets.map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name} ({a.kind})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  {!i.assetId && <fieldset><legend>Use this new reference in these clips</legend><div className="reference-clip-options">{project.clips.map((c:any,n:number)=><label key={c.id}><input type="checkbox" checked={i.clipIds.includes(c.id)} onChange={e=>change(i.uploadId,{clipIds:e.target.checked?[...i.clipIds,c.id]:i.clipIds.filter(id=>id!==c.id)})}/> Clip {n+1} · {n*30}–{(n+1)*30}s</label>)}</div></fieldset>}
                  <label>
                    Script name
                    <Input
                      disabled={busy || !!i.assetId}
                      value={i.name}
                      maxLength={120}
                      onChange={(e) =>
                        change(i.uploadId, { name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Type
                    <Select
                      disabled={busy || !!i.assetId}
                      value={i.kind}
                      onValueChange={(kind) => change(i.uploadId, { kind })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["character", "location", "object"].map((k) => (
                          <SelectItem value={k} key={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    Description / how it appears in the script
                    <Textarea
                      disabled={busy}
                      maxLength={2000}
                      value={i.description}
                      onChange={(e) =>
                        change(i.uploadId, { description: e.target.value })
                      }
                      placeholder="Mara, the waitress. Keep this face, yellow uniform and hairstyle."
                    />
                  </label>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setItems((old) =>
                        old.filter((a) => a.uploadId !== i.uploadId),
                      )
                    }
                  >
                    <X /> Remove image
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {project?.status === "ready" && (
            <p className="fine-print">
              Uploads are saved for your review. Storyboards wait until you press Done. Your uploaded images are not regenerated.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy || !valid}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const p = await ensureSaved(),
                  form = new FormData();
                form.set("id", p.id);
                form.set(
                  "references",
                  JSON.stringify(
                    items.map(
                      ({ uploadId, assetId, name, kind, description, clipIds }) => ({
                        uploadId,
                        assetId: assetId || undefined,
                        name,
                        kind,
                        description,
                        clipIds,
                      }),
                    ),
                  ),
                );
                for (const i of items)
                  form.set(i.uploadId, i.file, `${i.uploadId}.png`);
                const response = await fetch("/api/references", {
                  method: "POST",
                  body: form,
                });
                const result: any = await response.json();
                if (!response.ok)
                  throw new Error(
                    result.error ||
                      "Upload failed. Your selected files are still here.",
                  );
                onComplete(result.project);
                setOpen(false);
                setItems([]);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Upload failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="spin" /> : <Upload />}
            {project?.status === "ready"
              ? "Upload & rebuild affected frames"
              : "Save uploaded references"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
