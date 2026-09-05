import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// Hits the real Supabase project from .env (like db/rls.integration.test.ts) — no mocks.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const sql = postgres(process.env.DIRECT_URL!);

// Same DB-layer sign-up simulation as db/rls.integration.test.ts (avoids the Auth API
// email-confirmation rate limit): insert into auth.users, let handle_new_user() provision.
async function createAuthUser(email: string, organizationName: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${id}, 'authenticated', 'authenticated', ${email}, jsonb_build_object('organization_name', ${organizationName}::text))
  `;
  return id;
}

// Impersonates a logged-in user the way PostgREST does: SET ROLE authenticated + the JWT
// `sub` claim over DIRECT_URL — exactly what a direct Supabase API call to `printers`
// would hit (not going through /api/printers or the server's DATABASE_URL role).
async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return fn(tx);
  });
}

describe("T16b printers RLS: deny-all from the client (live Supabase)", () => {
  const suffix = randomUUID().slice(0, 8);
  const orgName = `printers-rls-test-org-${suffix}`;
  const serial = `PRLS-${suffix}`;
  let userId: string;

  afterAll(async () => {
    await sql`delete from printers where serial_number = ${serial}`;
    if (userId) {
      await sql`delete from user_profiles where id = ${userId}`;
      await sql`delete from auth.users where id = ${userId}`;
    }
    await sql`delete from organizations where name = ${orgName}`;
    await sql.end();
  });

  it("blocks an authenticated user from reading printers", async () => {
    userId = await createAuthUser(`printers-rls-${suffix}@blaze.test`, orgName);

    // Server (table owner, not subject to RLS) inserts a real row.
    await sql`
      insert into printers (serial_number, name, ip_address, access_code)
      values (${serial}, 'P1S', '10.0.0.9', '12345678')
    `;
    expect(await sql`select * from printers where serial_number = ${serial}`).toHaveLength(1);

    // The client sees nothing: RLS is on with no policy for `authenticated`.
    const rows = await asUser(userId, (tx) => tx`select * from printers where serial_number = ${serial}`);
    expect(rows).toHaveLength(0);
  });

  it("blocks an authenticated user from writing printers", async () => {
    await expect(
      asUser(
        userId,
        (tx) => tx`
          insert into printers (serial_number, name, ip_address, access_code)
          values (${`${serial}-x`}, 'Rogue', '10.0.0.10', '87654321')
        `,
      ),
    ).rejects.toThrow();

    await expect(
      asUser(userId, (tx) => tx`update printers set name = 'hacked' where serial_number = ${serial}`),
    ).resolves.toHaveLength(0); // update matches no visible row rather than erroring

    const [row] = await sql`select name from printers where serial_number = ${serial}`;
    expect(row!.name).toBe("P1S");
  });
});
