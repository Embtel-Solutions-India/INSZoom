import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Real App.jsx routing tree (MainLayout, ProtectedRoute, BlockEmployeeRoute,
// BlockIfHasCase) is exercised as-is — only the pieces that would otherwise
// require a live backend/session are stubbed:
// - Navbar is replaced with a lightweight marker so its own dependencies
//   (NotificationBell, sockets) don't need mocking; MainLayout still
//   unconditionally renders it for routes nested under it, so presence of
//   the marker still proves "this route is under MainLayout".
// - useAuth/useHasCase are stubbed so ProtectedRoute/BlockIfHasCase resolve
//   synchronously instead of hitting the real API.
// - The two leaf pages under test are stubbed; their own content isn't what
//   this test is about.
vi.mock("./components/Navbar", () => ({
  default: () => <nav data-testid="global-navbar">NAVBAR</nav>,
}));
vi.mock("./context/AuthContext", () => ({
  useAuth: () => ({ user: { _id: "user-1", role: "client" }, authLoading: false }),
}));
vi.mock("./hooks/useHasCase", () => ({
  default: () => ({ hasCase: false, loading: false }),
}));
vi.mock("./Pages/Eligibility/EligibilityQuiz", () => ({
  default: () => <div data-testid="quiz-page">QUIZ</div>,
}));
vi.mock("./Pages/Dashboard/About", () => ({
  default: () => <div data-testid="about-page">ABOUT</div>,
}));

const { default: App } = await import("./App");

describe("App route/layout wiring", () => {
  it("renders the eligibility quiz standalone, without the global Navbar", async () => {
    window.history.pushState({}, "", "/eligibility/quiz");
    render(<App />);

    expect(await screen.findByTestId("quiz-page")).toBeTruthy();
    expect(screen.queryByTestId("global-navbar")).toBeNull();
  });

  it("still renders an ordinary marketing route with the global Navbar", async () => {
    window.history.pushState({}, "", "/about");
    render(<App />);

    expect(await screen.findByTestId("about-page")).toBeTruthy();
    expect(screen.queryByTestId("global-navbar")).toBeTruthy();
  });
});
