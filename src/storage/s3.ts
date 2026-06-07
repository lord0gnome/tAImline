import { AwsClient } from "aws4fetch";

// Thin S3-compatible storage helper (works with any S3 API: MinIO, R2, AWS,
// Backblaze…). Uses aws4fetch for SigV4 — tiny, no transitive deps. Path-style
// addressing for broad compatibility. Objects are private; reads go through
// short-lived presigned GET URLs (see the media proxy routes).

export function storageConfigured(): boolean {
  const creds = Boolean(
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
  );
  // Need either an explicit endpoint (R2/MinIO/etc.) or a region (AWS).
  const target = Boolean(process.env.S3_ENDPOINT || process.env.S3_REGION);
  return creds && target;
}

function cfg() {
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET ?? "";
  const region = process.env.S3_REGION || "us-east-1";
  const client = new AwsClient({
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    region,
    service: "s3",
  });
  return { endpoint, bucket, region, client };
}

function objectUrl(key: string): string {
  const { endpoint, bucket, region } = cfg();
  const path = key.split("/").map(encodeURIComponent).join("/");
  // Explicit endpoint → path-style (R2/MinIO/custom). Otherwise AWS
  // virtual-hosted style derived from the region (no endpoint to configure).
  return endpoint
    ? `${endpoint}/${bucket}/${path}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
}

async function presign(key: string, method: "PUT" | "GET", expiresSec: number): Promise<string> {
  const { client } = cfg();
  const u = new URL(objectUrl(key));
  u.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client.sign(u.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

/** Presigned PUT URL the browser uploads directly to. */
export const presignPut = (key: string, expiresSec = 900) => presign(key, "PUT", expiresSec);

/** Short-lived presigned GET URL for reads (redirected to by the media proxy). */
export const presignGet = (key: string, expiresSec = 900) => presign(key, "GET", expiresSec);

export async function deleteObject(key: string): Promise<void> {
  const { client } = cfg();
  await client.fetch(objectUrl(key), { method: "DELETE" });
}
