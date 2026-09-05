import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

// T18: validate an uploaded print file (extension + max size) and reject anything
// that fails with a clear 400 — without persisting it (storage + jobs row are T19/T20).
// Pure validator is exported so tests can exercise it without minting a real JWT;
// the default export is the thin HTTP layer that requires an active session.

const ALLOWED_EXT = [".gcode", ".3mf"];

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

  const result = validateUpload(
    header(req.headers["x-file-name"]),
    Number(header(req.headers["content-length"])),
  );
  return res.status(result.status).json(result.body);
}
