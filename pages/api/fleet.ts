import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

// T30: GET /api/fleet — thin proxy for the gateway's GET /printers. The live fleet
// state lives in the gateway process (proxy.cjs), so the browser reaches it here
// instead of cross-origin, the same way control.ts (T27) posts to /control.
// ponytail: pass-through, no DB join for printer names — add one only if the raw
// serial ever isn't enough in the UI.
const GATEWAY = (process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:9001").replace(/^ws/, "http");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null }, error: new Error("no token") };
  if (error || !data.user) return res.status(401).json({ error: "authentication required" });

  try {
    const r = await fetch(`${GATEWAY}/printers`);
    if (!r.ok) throw new Error(`gateway returned ${r.status}`);
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(502).json({ error: `could not reach gateway: ${(e as Error).message}` });
  }
}
