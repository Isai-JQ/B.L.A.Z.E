import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// upload.ts imports lib/supabase.ts, which builds its client at module load from env.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { MAX_UPLOAD_BYTES, validateUpload } = await import("./upload");

it("accepts a valid .gcode file under the size limit", () => {
  const res = validateUpload("benchy.gcode", 5 * 1024 * 1024);
  expect(res.status).toBe(200);
});

it("accepts a valid .3mf file (case-insensitive extension)", () => {
  expect(validateUpload("part.3MF", 1024).status).toBe(200);
});

it("rejects a wrong extension with a clear 400", () => {
  const res = validateUpload("virus.exe", 1024);
  expect(res.status).toBe(400);
  expect((res.body as { error: string }).error).toContain(".gcode, .3mf");
});

it("rejects a file over the size limit with a clear 400", () => {
  const res = validateUpload("huge.gcode", MAX_UPLOAD_BYTES + 1);
  expect(res.status).toBe(400);
  expect((res.body as { error: string }).error).toContain("too large");
});

it("rejects a missing / zero size", () => {
  expect(validateUpload("a.gcode", 0).status).toBe(400);
  expect(validateUpload("a.gcode", NaN).status).toBe(400);
});
