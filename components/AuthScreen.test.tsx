import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthScreen from "./AuthScreen";

const { signInWithPassword, signUp, from } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword, signUp }, from },
}));

function chain(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve: (r: typeof result) => void) => resolve(result),
  };
  return builder;
}

const ORGS = [
  { id: "org-fred", name: "FrED-Factory" },
  { id: "org-rob", name: "RoBorregos" },
];

describe("AuthScreen", () => {
  it("logs in an existing user", async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    render(<AuthScreen />);
    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "a@tec.mx" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "a@tec.mx",
        password: "password1",
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("registers a new user under an existing organization", async () => {
    from.mockReturnValueOnce(chain({ data: ORGS, error: null }));
    signUp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Don't have an account? Register here."));

    await waitFor(() => expect(screen.getByText("RoBorregos")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "new@tec.mx" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "org-rob" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "new@tec.mx",
        password: "password1",
        options: { data: { organization_name: "RoBorregos" } },
      }),
    );
    await screen.findByText(/Check your email to confirm/);
  });

  it("registers under a brand-new organization name (created server-side)", async () => {
    from.mockReturnValueOnce(chain({ data: ORGS, error: null })); // org list on mount
    signUp.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });

    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Don't have an account? Register here."));

    await waitFor(() => expect(screen.getByText("RoBorregos")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "founder@tec.mx" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__new__" } });
    fireEvent.change(screen.getByPlaceholderText("Nombre de la organización"), {
      target: { value: "Aeroblaze" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "founder@tec.mx",
        password: "password1",
        options: { data: { organization_name: "Aeroblaze" } },
      }),
    );
    await screen.findByText(/Check your email to confirm/);
  });

  it("rejects registration with a non-@tec.mx email before calling signUp", async () => {
    from.mockReturnValueOnce(chain({ data: ORGS, error: null }));

    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Don't have an account? Register here."));
    await waitFor(() => expect(screen.getByText("RoBorregos")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "outsider@gmail.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "org-rob" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await screen.findByText(/restringido a correos @tec\.mx/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("shows the error message when auth fails", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid credentials" } });

    render(<AuthScreen />);
    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "a@tec.mx" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    await screen.findByText("Error: Invalid credentials");
  });
});
