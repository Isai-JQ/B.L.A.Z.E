import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./index";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession, signOut: vi.fn() } },
}));

describe("Home", () => {
  it("shows the signed-in user's email", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@tec.mx" } } } });

    render(<Home />);

    await waitFor(() => expect(screen.getByText(/Signed in as a@tec.mx/)).toBeInTheDocument());
  });
});
