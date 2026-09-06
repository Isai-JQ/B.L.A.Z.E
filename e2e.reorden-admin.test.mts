import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// T42 — E2E del reordenamiento manual de admin en la vista de cola (RF-13, T33).
// Reutiliza la infra de e2e.flujo-completo.test.mts: usuarios confirmados vía
// admin.createUser, gateway en proceso con el stub de MQTT, `next dev` en puerto
// aleatorio. Aquí NO se manda ningún report IDLE y la impresora queda 'offline',
// así ningún job sale de 'queued' y el orden de la cola es estable para el test.
//
// El test:
//  1. member inicia sesión → /queue NO muestra los controles ▲▼ (solo admin, T33).
//  2. admin inicia sesión → mueve el job de menor prioridad (VantTec, tier 2, último
//     en FIFO) al frente con ▲.
//  3. recarga → el nuevo orden persiste en la UI.
//  4. en la DB: manual_rank quedó SOLO en los dos jobs que intercambiaron lugar
//     (VantTec y RoBorregos), no en toda la cola (FrED-Factory sigue en NULL) —
//     el fix de T33 (ver lib/reorderRanks.ts).

const require = createRequire(import.meta.url);

for (const line of require("node:fs").readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const NEXT_PORT = 3600 + Math.floor(Math.random() * 300);
const GATEWAY_PORT = 9600 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${NEXT_PORT}`;

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql);
const admin = supabaseAdmin();

const suffix = randomUUID().slice(0, 8);
const like = `%${suffix}%`;
const password = "E2eTest-pw-123456";
const serial = `E2E-T42-${suffix.toUpperCase()}`;

const users = {
  admin: { email: `blaze-t42-admin-${suffix}@tec.mx`, org: `blaze-t42-adminorg-${suffix}`, id: "" },
  member: { email: `blaze-t42-member-${suffix}@tec.mx`, org: `blaze-t42-memberorg-${suffix}`, id: "" },
};

// Three queued jobs, distinct orgs / tiers. FrED-Factory is tier 1 (like db/seed.ts),
// RoBorregos and VantTec tier 2 and split by FIFO (created_at). Initial queue order:
// FrED-Factory, RoBorregos, VantTec.
const jobsSpec = [
  { org: `FrED-Factory-e2e-${suffix}`, tier: 1, file: `fred-${suffix}.gcode`, ageMin: 3 },
  { org: `RoBorregos-e2e-${suffix}`, tier: 2, file: `roborregos-${suffix}.gcode`, ageMin: 2 },
  { org: `VantTec-e2e-${suffix}`, tier: 2, file: `vanttec-${suffix}.gcode`, ageMin: 1 },
];

let gateway: Server;
let nextProc: ChildProcess;
let browser: Browser;

// --- simulated printer: stub mqtt client (same mechanism as T41 / proxy.test.mts) ----
const proxy = require("./proxy.cjs");
const fakeConnect = () => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  return {
    connected: true,
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
    on: (ev: string, fn: (...a: unknown[]) => void) => void (handlers[ev] = fn),
    subscribe: () => {},
    publish: (_t: string, _p: unknown, _o?: unknown, cb?: (e?: Error) => void) => cb?.(),
    end: () => {},
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean | Promise<boolean>, what: string, tries = 120) => {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return;
    await sleep(250);
  }
  throw new Error(`timeout: ${what}`);
};

const login = async (email: string) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  return page;
};

// File-name column ("Archivo", 2nd cell) for every queue row, top to bottom.
const rowOrder = (page: import("playwright").Page) =>
  page.locator("tbody tr td:nth-child(2)").allTextContents();

const ranksByFile = async () => {
  const rows = await sql<{ file_name: string; manual_rank: number | null }[]>`
    select file_name, manual_rank from jobs where file_name like ${like}
  `;
  return Object.fromEntries(rows.map((r) => [r.file_name, r.manual_rank]));
};

beforeAll(async () => {
  // 1. Two confirmed users. handle_new_user provisions an org (tier 2) + member profile
  //    for each; the admin is then promoted directly (service role skips the
  //    prevent_role_change trigger).
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { organization_name: u.org },
    });
    if (error) throw error;
    u.id = data.user.id;
  }
  await sql`update user_profiles set role = 'admin' where id = ${users.admin.id}`;

  // 2. Three orgs with explicit tiers + one queued job each, all owned by the admin
  //    user (the FK only needs a real user_profiles row, not a matching org).
  for (const j of jobsSpec) {
    const [org] = await sql<{ id: string }[]>`
      insert into organizations (name, priority_tier) values (${j.org}, ${j.tier}) returning id
    `;
    await sql`
      insert into jobs (user_id, organization_id, file_name, file_path, status, created_at)
      values (${users.admin.id}, ${org.id}, ${j.file}, ${`e2e/${j.file}`}, 'queued',
              now() - (${j.ageMin} || ' minutes')::interval)
    `;
  }

  // 3. Gateway + mqtt stub, exactly like T41 — but the printer stays 'offline' and no
  //    IDLE report is ever sent, so assignNextJob never runs and the jobs stay queued.
  await sql`
    insert into printers (serial_number, name, ip_address, access_code, status)
    values (${serial}, ${serial}, '10.77.0.1', 'e2ecode00', 'offline')
  `;
  proxy.sendJob = async () => {};
  gateway = proxy.start(GATEWAY_PORT, "10.77.0.1");
  await new Promise((r) => (gateway.listening ? r(null) : gateway.once("listening", r)));
  await proxy.syncPrinters(db, fakeConnect);

  // 4. Dashboard under `next dev`, own process group so afterAll can kill the tree.
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
}, 180_000);

afterAll(async () => {
  if (nextProc?.pid) {
    try {
      process.kill(-nextProc.pid, "SIGKILL");
    } catch {
      nextProc.kill("SIGKILL");
    }
  }
  await browser?.close().catch(() => {});
  if (gateway) {
    (gateway as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    gateway.close();
  }

  // Cleanup, each step independent. Order respects FKs: jobs -> profiles -> auth users
  // -> orgs. Everything is suffix-scoped so nothing else is touched.
  for (const q of [
    sql`delete from notifications where user_id = ${users.admin.id} or user_id = ${users.member.id}`,
    sql`delete from jobs where file_name like ${like}`,
    sql`delete from user_profiles where email like ${like}`,
  ]) {
    await q.catch((e) => console.error("cleanup:", e.message));
  }
  for (const u of Object.values(users)) {
    if (u.id) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
  await sql`delete from organizations where name like ${like}`.catch((e) =>
    console.error("cleanup:", e.message),
  );
  await sql`delete from printers where serial_number like ${like}`.catch(() => {});

  // Zero orphans (like T41).
  const [{ n: jobsLeft }] = await sql<{ n: number }[]>`
    select count(*)::int as n from jobs where file_name like ${like}`;
  const [{ n: orgsLeft }] = await sql<{ n: number }[]>`
    select count(*)::int as n from organizations where name like ${like}`;
  const [{ n: profLeft }] = await sql<{ n: number }[]>`
    select count(*)::int as n from user_profiles where email like ${like}`;
  const { data: leftUsers } = await admin.auth.admin.listUsers();
  const authLeft = (leftUsers?.users ?? []).filter((u) => u.email?.includes(suffix)).length;

  await sql.end();

  expect(jobsLeft).toBe(0);
  expect(orgsLeft).toBe(0);
  expect(profLeft).toBe(0);
  expect(authLeft).toBe(0);
}, 60_000);

it("member sees no reorder controls; admin reorder shows in UI and DB, rank only on moved jobs", async () => {
  const [fred, robo, vant] = jobsSpec.map((j) => j.file);

  // --- member: /queue has no ▲▼ controls (T33) --------------------------------
  const memberPage = await login(users.member.email);
  await memberPage.goto(`${BASE}/queue`);
  await memberPage.getByRole("cell", { name: fred }).waitFor({ timeout: 30_000 });
  await until(async () => (await rowOrder(memberPage)).length === 3, "member sees all 3 jobs");

  expect(await memberPage.getByRole("button", { name: "Subir en la cola" }).count()).toBe(0);
  expect(await memberPage.getByRole("button", { name: "Bajar en la cola" }).count()).toBe(0);
  expect(await memberPage.getByRole("columnheader", { name: "Orden" }).count()).toBe(0);

  // --- admin: initial order is tier/FIFO ------------------------------------
  const adminPage = await login(users.admin.email);
  await adminPage.goto(`${BASE}/queue`);
  await adminPage.getByRole("cell", { name: fred }).waitFor({ timeout: 30_000 });
  await adminPage.getByRole("button", { name: "Subir en la cola" }).first().waitFor({ timeout: 30_000 });
  await until(
    async () => JSON.stringify(await rowOrder(adminPage)) === JSON.stringify([fred, robo, vant]),
    "initial order fred, roborregos, vanttec",
  );

  // --- admin moves the lowest-priority job (VantTec) to the front with ▲ ----
  // One ▲: swapRanks writes manual_rank on VantTec (row it lands on) and RoBorregos
  // (row it displaces). calculateQueueOrder then puts any ranked job ahead of the
  // still-unranked FrED-Factory, so VantTec goes straight to position 1.
  await adminPage
    .getByRole("row", { name: new RegExp(vant) })
    .getByRole("button", { name: "Subir en la cola" })
    .click();

  await until(
    async () => JSON.stringify(await rowOrder(adminPage)) === JSON.stringify([vant, robo, fred]),
    "after move: vanttec, roborregos, fred",
  );

  // --- reload: order persists in the UI -----------------------------------
  await adminPage.reload();
  await adminPage.getByRole("cell", { name: vant }).waitFor({ timeout: 30_000 });
  await until(
    async () => JSON.stringify(await rowOrder(adminPage)) === JSON.stringify([vant, robo, fred]),
    "order persists after reload",
  );

  // --- DB: manual_rank only on the two jobs that traded places (T33 fix) ----
  const ranks = await ranksByFile();
  expect(ranks[vant]).toBe(2); // row VantTec landed on
  expect(ranks[robo]).toBe(3); // row it displaced
  expect(ranks[fred]).toBeNull(); // untouched — NOT the whole queue
  const [{ n: ranked }] = await sql<{ n: number }[]>`
    select count(*)::int as n from jobs where file_name like ${like} and manual_rank is not null`;
  expect(ranked).toBe(2);
}, 120_000);
