import { type Component, createSignal, For, onMount, Show } from "solid-js";
import type { Precision } from "~/lib/dates.ts";
import CategoryInput from "./CategoryInput.tsx";
import DateField from "./DateField.tsx";
import type { MediaDTO } from "~/lib/media.ts";
import type { EraDTO, PostDTO } from "./types.ts";
import { processAndUpload, type UploadedMedia } from "./upload.ts";

interface Props {
  post: PostDTO | null; // null = creating
  eras: EraDTO[];
  defaultEraId: string | null;
  defaultDate: string;
  /** Precision seed for new moments (e.g. zoom-appropriate when added at a date). */
  defaultPrecision?: Precision;
  storageEnabled: boolean;
  /** Existing categories across the timeline, for autocomplete. */
  categorySuggestions?: string[];
  onSaved: (post: PostDTO) => void;
  onDeleted: (id: string) => void;
  onCancel: () => void;
}

const PRECISIONS: Precision[] = ["day", "month", "year"];
const VISIBILITIES = ["inherit", "private", "gated", "unlisted", "public"] as const;

const PostEditor: Component<Props> = (props) => {
  const p = props.post;
  const [title, setTitle] = createSignal(p?.title ?? "");
  const [body, setBody] = createSignal(p?.bodyMd ?? "");
  const [eventDate, setEventDate] = createSignal(p?.eventDate ?? props.defaultDate);
  const [precision, setPrecision] = createSignal<Precision>(p?.eventPrecision ?? props.defaultPrecision ?? "day");
  const [eraId, setEraId] = createSignal<string>(p?.eraId ?? props.defaultEraId ?? "");
  const [categories, setCategories] = createSignal<string[]>(p?.categories ?? []);
  const [visibility, setVisibility] = createSignal<string>(p?.visibility ?? "inherit");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Media: existing (registered) + pending (uploaded to bucket, not yet linked).
  const [existing, setExisting] = createSignal<MediaDTO[]>([]);
  const [pending, setPending] = createSignal<UploadedMedia[]>([]);
  const [uploading, setUploading] = createSignal(false);

  onMount(async () => {
    if (p) {
      const res = await fetch(`/api/media?postId=${p.id}`);
      if (res.ok) setExisting((await res.json()).media);
    }
  });

  // Mirror the server's media-name slug so a pending reference matches on save.
  function slugName(filename: string): string {
    return (
      filename
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "media"
    );
  }
  function insertRef(name: string) {
    if (!name) return;
    setBody((b) => `${b}${b && !b.endsWith("\n") ? "\n\n" : ""}![${name}](${name})\n`);
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setError(null);
    for (const f of Array.from(files)) {
      try {
        const up = await processAndUpload(f);
        setPending((prev) => [...prev, up]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    }
    setUploading(false);
  }

  async function removeExisting(m: MediaDTO) {
    if (!confirm("Remove this media?")) return;
    const res = await fetch(`/api/media/${m.id}`, { method: "DELETE" });
    if (res.ok) setExisting((prev) => prev.filter((x) => x.id !== m.id));
  }
  function removePending(i: number) {
    setPending((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, j) => j !== i);
    });
  }

  async function save(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      title: title(),
      bodyMd: body(),
      eraId: eraId() || null,
      categories: categories(),
      eventDate: eventDate(),
      eventPrecision: precision(),
      visibility: visibility(),
    };
    const res = await fetch(p ? `/api/posts/${p.id}` : "/api/posts", {
      method: p ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setBusy(false);
      setError((await res.json().catch(() => ({}))).error ?? "Could not save the moment.");
      return;
    }
    const saved: PostDTO = (await res.json()).post;

    // Link any freshly-uploaded media to the (now-known) post id.
    for (const up of pending()) {
      await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postId: saved.id,
          storageKey: up.storageKey,
          thumbKey: up.thumbKey,
          mime: up.mime,
          name: up.name,
          width: up.width,
          height: up.height,
        }),
      });
    }
    setBusy(false);
    props.onSaved(saved);
  }

  async function remove() {
    if (!p || !confirm(`Delete "${p.title}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${p.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
    setBusy(false);
    if (res.ok) props.onDeleted(p.id);
    else setError("Could not delete the moment.");
  }

  return (
    <aside class="era-editor">
      <form onSubmit={save}>
        <h2>{p ? "Edit moment" : "New moment"}</h2>

        <label>
          Title
          <input type="text" value={title()} required onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>

        <div class="era-editor__row">
          <label>
            Date
            <DateField value={eventDate()} precision={precision()} required onChange={setEventDate} />
          </label>
          <label>
            Precision
            <select value={precision()} onChange={(e) => setPrecision(e.currentTarget.value as Precision)}>
              <For each={PRECISIONS}>{(pr) => <option value={pr}>{pr}</option>}</For>
            </select>
          </label>
        </div>

        <label>
          Era
          <select value={eraId()} onChange={(e) => setEraId(e.currentTarget.value)}>
            <option value="">— none (free-floating) —</option>
            <For each={props.eras}>{(e) => <option value={e.id}>{e.title}</option>}</For>
          </select>
        </label>

        <label>
          Categories
          <CategoryInput value={categories()} suggestions={props.categorySuggestions} onChange={setCategories} />
        </label>

        <label>
          Visibility
          <select value={visibility()} onChange={(e) => setVisibility(e.currentTarget.value)}>
            <For each={VISIBILITIES}>{(v) => <option value={v}>{v}</option>}</For>
          </select>
        </label>

        <label>
          Story (markdown)
          <textarea rows={8} value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
        </label>

        {/* media */}
        <Show
          when={props.storageEnabled}
          fallback={<p class="muted" style={{ "font-size": "0.8rem" }}>Media storage isn't configured.</p>}
        >
          <label>
            Photos & videos
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => addFiles(e.currentTarget.files)}
            />
          </label>
          <Show when={uploading()}>
            <p class="muted" style={{ "font-size": "0.8rem" }}>Uploading…</p>
          </Show>
          <p class="muted" style={{ "font-size": "0.78rem", margin: "0.25rem 0 0.5rem" }}>
            Click <strong>insert</strong> (or use the name) to drop a photo/video into your
            story: <code>![caption](name)</code>.
          </p>
          <div class="gallery">
            <For each={existing()}>
              {(m) => (
                <div class="gallery__item">
                  {m.kind === "video" ? (
                    <video src={m.url} muted preload="metadata" />
                  ) : (
                    <img src={m.thumbUrl} alt={m.alt ?? ""} loading="lazy" />
                  )}
                  <button type="button" class="gallery__x" onClick={() => removeExisting(m)}>×</button>
                  <button
                    type="button"
                    class="gallery__insert"
                    title={`Insert ![](${m.name ?? ""})`}
                    onClick={() => insertRef(m.name ?? "")}
                  >
                    {m.name ?? "media"} · insert
                  </button>
                </div>
              )}
            </For>
            <For each={pending()}>
              {(u, i) => (
                <div class="gallery__item">
                  {u.mime.startsWith("video/") ? (
                    <video src={u.previewUrl} muted preload="metadata" />
                  ) : (
                    <img src={u.previewUrl} alt="" />
                  )}
                  <button type="button" class="gallery__x" onClick={() => removePending(i())}>×</button>
                  <button
                    type="button"
                    class="gallery__insert"
                    title={`Insert ![](${slugName(u.name)})`}
                    onClick={() => insertRef(slugName(u.name))}
                  >
                    {slugName(u.name)} · insert
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={error()}>
          <p class="era-editor__error">{error()}</p>
        </Show>

        <div class="era-editor__actions">
          <button type="submit" class="btn btn--primary" disabled={busy() || uploading()}>
            {p ? "Save" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.onCancel} disabled={busy()}>
            Cancel
          </button>
          <Show when={p}>
            <button type="button" class="btn era-editor__delete" onClick={remove} disabled={busy()}>
              Delete
            </button>
          </Show>
        </div>
      </form>
    </aside>
  );
};

export default PostEditor;
