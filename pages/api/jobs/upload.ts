import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jobs, userProfiles } from "@/db/schema";

// T18: validate an uploaded print file (extension + declared max size), rejecting
// anything that fails with a clear 400.
// T19: on a valid file, insert the jobs row (status 'queued', user_id from the
// session, organization_id resolved from the caller's user_profiles).
// T20: stream the bytes into a private Supabase Storage bucket, cutting the write
// off at the *real* size (the client's Content-Length is not trusted, see T18),
// and store the real object path in jobs.file_path.
// The pieces below are exported so tests can exercise them without minting a real
// JWT; the default export is the thin HTTP layer.

const ALLOWED_EXT = [".gcode", ".3mf"];

// Private bucket (public: false), created by db/sql/002_storage_bucket.sql.
export const STORAGE_BUCKET = "print-files";

// Default 200MB, overridable via env without touching code.
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 200 * 1024 * 1024;

type Result = { status: number; body: unknown };

export function validateUpload(
  fileName: string | undefined,
  sizeBytes: number,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Result {
  if (!fileName || fileName.trim() === "") {
    return { status: 400, body: { error: "missing file name (x-file-name header)" } };
  }
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  if (!ALLOWED_EXT.includes(ext)) {
    return {
      status: 400,
      body: { error: `unsupported file extension "${ext || fileName}": allowed ${ALLOWED_EXT.join(", ")}` },
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { status: 400, body: { error: "missing or invalid file size (Content-Length header)" } };
  }
  if (sizeBytes > maxBytes) {
    return {
      status: 400,
      body: { error: `file too large: ${sizeBytes} bytes exceeds max ${maxBytes} bytes` },
    };
  }
  return { status: 200, body: { ok: true, fileName, sizeBytes } };
}

// Read the request body into memory, bailing the moment the real byte count passes
// maxBytes — the declared Content-Length is attacker-controlled (see T18 note).
// ponytail: buffers the whole file in RAM; switch to a streamed storage upload if
// 200MB jobs start to pressure memory.
export async function readCappedBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function objectKey(userId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return `${userId}/${randomUUID()}${ext}`;
}

export async function createQueuedJob(
  userId: string,
  fileName: string,
  filePath: string,
): Promise<Result> {
  const [profile] = await db
    .select({ organizationId: userProfiles.organizationId })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId));
  if (!profile) return { status: 403, body: { error: "no user profile / organization" } };

  const [row] = await db
    .insert(jobs)
    .values({
      userId,
      organizationId: profile.organizationId,
      fileName,
      filePath,
      status: "queued",
    })
    .returning();
  return { status: 201, body: row };
}

// Full pipeline: validate metadata -> read + cap the bytes -> store in the private
// bucket -> insert the queued job with the real file_path.
export async function processUpload(
  userId: string,
  fileName: string | undefined,
  declaredSize: number,
  body: AsyncIterable<Uint8Array>,
): Promise<Result> {
  const meta = validateUpload(fileName, declaredSize);
  if (meta.status !== 200) return meta;
  const name = fileName!.trim();

  const bytes = await readCappedBody(body);
  if (!bytes) {
    return { status: 413, body: { error: `file exceeds max ${MAX_UPLOAD_BYTES} bytes` } };
  }

  const key = objectKey(userId, name);
  const { error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(key, bytes, { contentType: "application/octet-stream" });
  if (error) {
    return { status: 502, body: { error: `storage upload failed: ${error.message}` } };
  }

  // ponytail: an orphan object is left if this insert fails; add a cleanup/delete
  // if that ever shows up in practice.
  return createQueuedJob(userId, name, `${STORAGE_BUCKET}/${key}`);
}

// Fetch a stored file back from a jobs.file_path ("<bucket>/<key>").
export async function downloadJobFile(filePath: string) {
  const slash = filePath.indexOf("/");
  return supabaseAdmin()
    .storage.from(filePath.slice(0, slash))
    .download(filePath.slice(slash + 1));
}

// Don't let Next buffer/parse the body: processUpload streams and size-caps it.
export const config = { api: { bodyParser: false } };

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null }, error: new Error("no token") };
  if (error || !data.user) return res.status(401).json({ error: "authentication required" });

  const created = await processUpload(
    data.user.id,
    header(req.headers["x-file-name"]),
    Number(header(req.headers["content-length"])),
    req,
  );
  return res.status(created.status).json(created.body);
}
