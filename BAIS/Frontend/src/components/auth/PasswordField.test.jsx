import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PasswordField from "./PasswordField";

describe("PasswordField", () => {
  it("keeps the eye button visible and toggles password visibility without changing the value", () => {
    const handleChange = vi.fn();

    render(
      <PasswordField
        name="password"
        placeholder="Password"
        value="MyPassword123"
        onChange={handleChange}
        autoComplete="current-password"
      />
    );

    const input = screen.getByPlaceholderText("Password");
    const button = screen.getByRole("button", { name: /show password/i });

    expect(input.getAttribute("type")).toBe("password");
    expect(input.value).toBe("MyPassword123");
    expect(button.getAttribute("type")).toBe("button");

    fireEvent.click(button);
    expect(input.getAttribute("type")).toBe("text");
    expect(input.value).toBe("MyPassword123");
    expect(screen.getByRole("button", { name: /hide password/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide password/i }));
    expect(input.getAttribute("type")).toBe("password");
    expect(input.value).toBe("MyPassword123");
    expect(screen.getByRole("button", { name: /show password/i })).toBeTruthy();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("renders one independent visibility toggle per password field", () => {
    render(
      <>
        <PasswordField
          name="password"
          placeholder="Password"
          value="PrimarySecret123"
          onChange={() => {}}
          autoComplete="new-password"
        />
        <PasswordField
          name="confirmPassword"
          placeholder="Confirm Password"
          value="PrimarySecret123"
          onChange={() => {}}
          autoComplete="new-password"
        />
      </>
    );

    const password = screen.getByPlaceholderText("Password");
    const confirmPassword = screen.getByPlaceholderText("Confirm Password");
    const toggleButtons = screen.getAllByRole("button", { name: /show password/i });

    expect(toggleButtons).toHaveLength(2);
    expect(password.getAttribute("type")).toBe("password");
    expect(confirmPassword.getAttribute("type")).toBe("password");

    fireEvent.click(toggleButtons[0]);

    expect(password.getAttribute("type")).toBe("text");
    expect(confirmPassword.getAttribute("type")).toBe("password");
  });
});
