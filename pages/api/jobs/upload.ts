import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { jobs, userProfiles } from "@/db/schema";

// T18: validate an uploaded print file (extension + max size), rejecting anything
// that fails with a clear 400.
// T19: on a valid file, insert the jobs row (status 'queued', user_id from the
// session, organization_id resolved from the caller's user_profiles).
// The pure validator and createQueuedJob are exported so tests can exercise them
// without minting a real JWT; the default export is the thin HTTP layer.

const ALLOWED_EXT = [".gcode", ".3mf"];

// ponytail: T20 (persisting the bytes + real path) isn't built yet, so every row
// lands with this sentinel file_path. Column is NOT NULL, so null isn't an option.
// T20 replaces this with the real storage location on the same row.
export const PENDING_FILE_PATH = "pending://T20-not-implemented";

type CreateResult = { status: number; body: unknown };

export async function createQueuedJob(
  userId: string,
  fileName: string,
): Promise<CreateResult> {
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
      filePath: PENDING_FILE_PATH,
      status: "queued",
    })
    .returning();
  return { status: 201, body: row };
}

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

// Don't buffer the upload: T18 only validates metadata, it never stores the bytes.
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

  const fileName = header(req.headers["x-file-name"]);
  const result = validateUpload(fileName, Number(header(req.headers["content-length"])));
  if (result.status !== 200) return res.status(result.status).json(result.body);

  const created = await createQueuedJob(data.user.id, fileName!.trim());
  return res.status(created.status).json(created.body);
}
