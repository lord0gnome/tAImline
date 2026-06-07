// Browser-side media processing + direct-to-bucket upload. Images are downscaled
// (full + thumbnail) via canvas; videos upload as-is with a captured poster frame.
// Uploads go straight to S3 via a presigned PUT, so they never transit the app.

const MAX_FULL = 1600;
const MAX_THUMB = 400;
const JPEG_Q = 0.85;

export interface UploadedMedia {
  storageKey: string;
  thumbKey: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  /** Local object URL for instant preview before the post is saved. */
  previewUrl: string;
}

async function signAndPut(blob: Blob, contentType: string): Promise<string> {
  const sign = await fetch("/api/media/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentType }),
  });
  if (!sign.ok) throw new Error((await sign.json().catch(() => ({})))?.error ?? "sign failed");
  const { key, uploadUrl } = await sign.json();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return key as string;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );
}

function scaled(w: number, h: number, max: number): [number, number] {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * s), Math.round(h * s)];
}

function drawToBlob(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  max: number,
  type = "image/jpeg",
  quality = JPEG_Q,
): Promise<{ blob: Blob; width: number; height: number }> {
  const [w, h] = scaled(srcW, srcH, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(source, 0, 0, w, h);
  return canvasToBlob(canvas, type, quality).then((blob) => ({ blob, width: w, height: h }));
}

async function processImage(file: File): Promise<UploadedMedia> {
  const bitmap = await createImageBitmap(file);
  const full = await drawToBlob(bitmap, bitmap.width, bitmap.height, MAX_FULL);
  const thumb = await drawToBlob(bitmap, bitmap.width, bitmap.height, MAX_THUMB);
  bitmap.close();
  const storageKey = await signAndPut(full.blob, "image/jpeg");
  const thumbKey = await signAndPut(thumb.blob, "image/jpeg");
  return {
    storageKey,
    thumbKey,
    mime: "image/jpeg",
    width: full.width,
    height: full.height,
    previewUrl: URL.createObjectURL(full.blob),
  };
}

async function capturePoster(file: File): Promise<{ blob: Blob } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    const done = (v: { blob: Blob } | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      drawToBlob(video, video.videoWidth, video.videoHeight, MAX_THUMB)
        .then((r) => done({ blob: r.blob }))
        .catch(() => done(null));
    };
    video.onerror = () => done(null);
  });
}

async function processVideo(file: File): Promise<UploadedMedia> {
  const storageKey = await signAndPut(file, file.type);
  const poster = await capturePoster(file);
  const thumbKey = poster ? await signAndPut(poster.blob, "image/jpeg") : null;
  return {
    storageKey,
    thumbKey,
    mime: file.type,
    width: null,
    height: null,
    previewUrl: URL.createObjectURL(file),
  };
}

export async function processAndUpload(file: File): Promise<UploadedMedia> {
  if (file.type.startsWith("image/")) return processImage(file);
  if (file.type.startsWith("video/")) return processVideo(file);
  throw new Error("Only images and videos are supported.");
}
