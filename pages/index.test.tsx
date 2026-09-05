import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./index";

describe("Home", () => {
  it("renders without crashing", () => {
    const { container } = render(<Home />);
    expect(container).toBeInTheDocument();
  });
});
