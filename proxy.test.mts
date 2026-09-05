import { createRequire } from "node:module";
import type { Server } from "node:http";
import { afterAll, expect, it } from "vitest";

// proxy.cjs is CommonJS and runs outside Next.js (plain `node proxy.cjs`), so it is
// required rather than imported.
const { start, handleReport, printers } = createRequire(import.meta.url)("./proxy.cjs");

const SERIAL = "01P00A123456789";
const report = (print: Record<string, unknown>) =>
  handleReport(`device/${SERIAL}/report`, Buffer.from(JSON.stringify({ print })));

const server: Server = start(0, "127.0.0.1");
afterAll(() => void server.close());

it("keeps simulated printer state in memory and exposes it over HTTP", async () => {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));

  // Simulated printer: a P1S sends one full report and then partial deltas.
  report({
    gcode_state: "RUNNING",
    nozzle_temper: 219.7,
    bed_temper: 60,
    mc_percent: 42,
    layer_num: 12,
    total_layer_num: 300,
    mc_remaining_time: 51,
    gcode_file: "/data/Metadata/fred.gcode",
  });
  report({ mc_percent: 43, layer_num: 13, nozzle_temper: 220.1 });

  // Junk is ignored instead of clobbering the state.
  expect(handleReport(`device/${SERIAL}/report`, Buffer.from("not json"))).toBeNull();
  expect(handleReport("device//report", Buffer.from("{}"))).toBeNull();

  const port = (server.address() as { port: number }).port;
  const body = await (await fetch(`http://127.0.0.1:${port}/printers`)).json();

  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({
    serial: SERIAL,
    gcodeState: "RUNNING",
    nozzleTemp: 220.1,
    bedTemp: 60,
    printPercent: 43,
    layerNum: 13,
    // Untouched by the delta report, so it must survive from the first one.
    totalLayerNum: 300,
    remainingTime: 51,
    gcodeFile: "/data/Metadata/fred.gcode",
  });
  expect(Date.parse(body[0].lastReportAt)).not.toBeNaN();
  expect(printers.size).toBe(1);
});
