import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthScreen from "./AuthScreen";

const { signInWithPassword, signUp } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword, signUp } },
}));

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
  });

  it("registers a new user and shows a confirmation message", async () => {
    signUp.mockResolvedValue({ error: null });

    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Don't have an account? Register here."));
    fireEvent.change(screen.getByPlaceholderText("alumno@tec.mx"), {
      target: { value: "new@tec.mx" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(signUp).toHaveBeenCalledWith({ email: "new@tec.mx", password: "password1" });
    await screen.findByText(/Check your email to confirm/);
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
