import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./_app";

const { getSession, onAuthStateChange, replace } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  replace: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}));

let pathname = "/";
vi.mock("next/router", () => ({
  useRouter: () => ({ pathname, replace }),
}));

function Dashboard() {
  return <div>dashboard content</div>;
}

const props = { Component: Dashboard, pageProps: {}, router: {} as never };

describe("App auth guard", () => {
  beforeEach(() => replace.mockClear());

  it("redirects to /login when visiting / without a session", async () => {
    pathname = "/";
    getSession.mockResolvedValue({ data: { session: null } });

    render(<App {...props} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();
  });

  it("renders the dashboard when a session is active", async () => {
    pathname = "/";
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@tec.mx" } } } });

    render(<App {...props} />);

    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
