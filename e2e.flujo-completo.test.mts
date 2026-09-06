import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// T41 — E2E del flujo completo (RF-1, RF-8), 100% simulado, sin impresora real:
// login → subir un .gcode desde la UI → verlo en la cola → verlo asignado e
// "imprimiendo" en el dashboard → un reporte de progreso nuevo se refleja solo
// (sin recargar) → pausar/reanudar/detener desde la UI llegan como el comando
// MQTT correcto a device/{serial}/request.
//
// Piezas reales: Supabase (auth + DB + Storage) y el dashboard Next.js corriendo
// en `next dev`. Piezas simuladas: la impresora, vía el mismo mecanismo de
// `fakeConnect` (stub del cliente mqtt) que usa proxy.test.mts, y el envío
// FTPS/print-start (`proxy.sendJob`) reemplazado por un no-op.

const require = createRequire(import.meta.url);

for (const line of require("node:fs").readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Random ports so a leaked `next dev` from a crashed earlier run can never make this
// one silently talk to a stale server.
const NEXT_PORT = 3200 + Math.floor(Math.random() * 400);
const GATEWAY_PORT = 9200 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${NEXT_PORT}`;

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql);
const admin = supabaseAdmin();

const suffix = randomUUID().slice(0, 8);
const email = `blaze-e2e-${suffix}@tec.mx`;
const password = "E2eTest-pw-123456";
const orgName = `e2e-org-${suffix}`;
const serial = `E2E-${suffix.toUpperCase()}`;
const fileName = `e2e-${suffix}.gcode`;

let userId = "";
let gateway: Server;
let nextProc: ChildProcess;
let browser: Browser;

// --- simulated printer: stub mqtt client, records everything published to it ----
const proxy = require("./proxy.cjs");
const published: Array<{ topic: string; payload: string }> = [];
let printerStub: {
  emit(ev: string, ...a: unknown[]): void;
  on(ev: string, fn: (...a: unknown[]) => void): void;
};

const fakeConnect = (url: string, opts: { password?: string }) => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const stub = {
    url,
    password: opts?.password,
    connected: true,
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
    on: (ev: string, fn: (...a: unknown[]) => void) => void (handlers[ev] = fn),
    subscribe: () => {},
    publish: (topic: string, payload: unknown, _o?: unknown, cb?: (e?: Error) => void) => {
      published.push({ topic, payload: Buffer.isBuffer(payload) ? payload.toString() : String(payload) });
      if (typeof cb === "function") cb();
    },
    end: () => {},
  };
  printerStub = stub;
  return stub;
};

// Push a `device/{serial}/report` message through the stub, exactly as the broker would.
const report = (print: Record<string, unknown>) =>
  printerStub.emit(
    "message",
    `device/${serial}/report`,
    Buffer.from(JSON.stringify({ print })),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean | Promise<boolean>, what: string, tries = 120) => {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return;
    await sleep(250);
  }
  throw new Error(`timeout: ${what}`);
};

const jobRow = async () =>
  (
    await sql<{ id: string; status: string; printer_id: string | null; file_path: string }[]>`
      select id, status, printer_id, file_path from jobs where user_id = ${userId}
    `
  )[0];

beforeAll(async () => {
  // 1. Test user, already confirmed — no real email flow. The on_auth_user_created
  //    trigger provisions the organization (tier 2) and the user_profiles row.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_name: orgName },
  });
  if (error) throw error;
  userId = data.user.id;

  // 2. One simulated printer row + gateway watching it through the mqtt stub.
  await sql`
    insert into printers (serial_number, name, ip_address, access_code, status)
    values (${serial}, ${serial}, '10.77.0.1', 'e2ecode00', 'offline')
  `;
  proxy.sendJob = async () => {}; // no real FTPS upload / print-start
  gateway = proxy.start(GATEWAY_PORT, "10.77.0.1");
  await new Promise((r) => (gateway.listening ? r(null) : gateway.once("listening", r)));
  await proxy.syncPrinters(db, fakeConnect);

  // Printer comes online idle → its row goes to status 'idle' (free).
  report({ gcode_state: "IDLE" });
  await until(
    async () =>
      (await sql`select status from printers where serial_number = ${serial}`)[0].status === "idle",
    "printer row reaches idle",
  );

  // 3. Dashboard under `next dev`, pointed at this gateway. Own process group so
  //    afterAll can take the whole tree down.
  nextProc = spawn("pnpm", ["exec", "next", "dev", "-p", String(NEXT_PORT)], {
    env: { ...process.env, NEXT_PUBLIC_WS_PROXY_URL: `ws://localhost:${GATEWAY_PORT}` },
    stdio: "ignore",
    detached: true,
  });
  nextProc.on("exit", (code) => {
    if (code) console.error(`next dev exited early with code ${code}`);
  });
  await until(async () => {
    try {
      return (await fetch(`${BASE}/login`)).ok;
    } catch {
      return false;
    }
  }, "next dev serves /login", 240);

  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  // Kill the dashboard tree first and unconditionally: a hang here previously leaked
  // a `next dev` that held the port and poisoned later runs.
  if (nextProc?.pid) {
    try {
      process.kill(-nextProc.pid, "SIGKILL"); // whole process group (detached)
    } catch {
      nextProc.kill("SIGKILL");
    }
  }
  await browser?.close().catch(() => {});
  if (gateway) {
    (gateway as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    gateway.close();
  }

  // Data cleanup, each step independent, so a failed test body can't leave the test
  // user or its uploaded file behind.
  if (userId) {
    const { data: files } = await admin.storage.from("print-files").list(userId, { limit: 100 });
    if (files?.length) {
      await admin.storage.from("print-files").remove(files.map((f) => `${userId}/${f.name}`));
    }
    for (const q of [
      sql`delete from notifications where user_id = ${userId}`,
      sql`delete from jobs where user_id = ${userId}`,
      sql`delete from user_profiles where id = ${userId}`,
    ]) {
      await q.catch((e) => console.error("cleanup:", e.message));
    }
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  await sql`delete from organizations where name = ${orgName}`.catch(() => {});
  await sql`delete from printers where serial_number = ${serial}`.catch(() => {});
  await sql.end();
}, 60_000);

it("login → upload → queue → dashboard → live progress → pause/resume/stop", async () => {
  const page = await (await browser.newContext()).newPage();

  // --- login (T10) --------------------------------------------------------------
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });

  // --- upload a .gcode from the UI (T31) --------------------------------------
  const gcodePath = join(mkdtempSync(join(tmpdir(), "blaze-e2e-")), fileName);
  writeFileSync(gcodePath, "; B.L.A.Z.E E2E test file\nG28\nG1 Z5 F5000\n");

  await page.getByRole("button", { name: "Nuevo trabajo" }).click();
  await page.setInputFiles("#job-file", gcodePath);
  await page.getByRole("button", { name: "Subir a la cola" }).click();
  await page.getByText(/encolado \(queued\)/).waitFor({ timeout: 30_000 });

  // --- job shows in the queue view (T32) --------------------------------------
  await page.goto(`${BASE}/queue`);
  await page.getByRole("cell", { name: fileName }).waitFor({ timeout: 30_000 });
  await page.getByText("En cola").waitFor({ state: "visible", timeout: 30_000 });

  // --- printer picks the job up; mock then reports 'printing' (T22/T23) ------
  report({ gcode_state: "IDLE" }); // free report → assignNextJob runs
  await until(async () => (await jobRow()).status === "printing", "job reaches status=printing");
  const { id: jobId } = await jobRow();

  report({
    gcode_state: "RUNNING",
    nozzle_temper: 218,
    nozzle_target_temper: 230,
    bed_temper: 60,
    bed_target_temper: 60,
    mc_percent: 12,
    layer_num: 20,
    total_layer_num: 300,
    mc_remaining_time: 45,
    gcode_file: `/data/Metadata/${fileName}`,
  });

  // --- dashboard reflects the assigned job (T30) ----------------------------
  await page.goto(`${BASE}/`);
  await page.getByText(serial).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Imprimiendo").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("button", { name: "Pausar" }).waitFor({ timeout: 30_000 });

  // --- a fresh progress report updates the dashboard with no reload ---------
  report({ mc_percent: 77, nozzle_temper: 231, layer_num: 210, mc_remaining_time: 9 });
  await page.getByText("77%").waitFor({ state: "visible", timeout: 30_000 }); // no page.reload()
  await page.getByText("231°").first().waitFor({ state: "visible", timeout: 30_000 });

  // --- pause / resume / stop from the UI reach the printer over MQTT (T35) --
  for (const [label, command] of [
    ["Pausar", "pause"],
    ["Reanudar", "resume"],
    ["Detener", "stop"],
  ] as const) {
    const before = published.length;
    await page.getByRole("button", { name: label }).click();
    await until(
      () =>
        published
          .slice(before)
          .some(
            (p) =>
              p.topic === `device/${serial}/request` &&
              JSON.parse(p.payload).print?.command === command,
          ),
      `${command} published to device/${serial}/request`,
    );
  }

  // The job really was the one we uploaded, controlled by its owner.
  expect(jobId).toBeTruthy();
}, 120_000);
