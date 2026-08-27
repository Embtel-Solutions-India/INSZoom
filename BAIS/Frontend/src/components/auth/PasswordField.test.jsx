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
});
