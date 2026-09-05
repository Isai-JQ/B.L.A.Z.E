import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./index";

const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange,
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

describe("Home", () => {
  it("shows the auth screen when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    render(<Home />);

    expect(await screen.findByText("Welcome Back")).toBeInTheDocument();
  });

  it("shows the signed-in user when a session exists", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@tec.mx" } } } });

    render(<Home />);

    await waitFor(() => expect(screen.getByText(/Signed in as a@tec.mx/)).toBeInTheDocument());
  });
});
