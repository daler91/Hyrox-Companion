import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MetricCard } from "../MetricCard";
import { Activity } from "lucide-react";

describe("MetricCard", () => {
  const defaultProps = {
    title: "Total Workouts",
    value: "12",
    icon: Activity,
  };

  it("renders the title and value correctly", () => {
    render(<MetricCard {...defaultProps} />);
    expect(screen.getByText("Total Workouts")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders the unit when provided", () => {
    render(<MetricCard {...defaultProps} unit="km" />);
    expect(screen.getByText("km")).toBeInTheDocument();
  });

  it("renders the icon", () => {
    const { container } = render(<MetricCard {...defaultProps} />);
    // Lucide icons render as svg elements
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("text-primary");
  });

  it("renders 'up' trend correctly", () => {
    render(
      <MetricCard
        {...defaultProps}
        trend="up"
        trendValue="+15%"
      />
    );
    const trendElement = screen.getByText("+15%");
    expect(trendElement).toBeInTheDocument();
    expect(trendElement).toHaveClass("text-green-500");

    // Check for the up icon (TrendingUp)
    // Since we are using the real lucide icons, we can check for the class it adds
    const svg = screen.getByText("+15%").previousSibling as HTMLElement;
    expect(svg).toHaveClass("text-green-500");
  });

  it("renders 'down' trend correctly", () => {
    render(
      <MetricCard
        {...defaultProps}
        trend="down"
        trendValue="-5%"
      />
    );
    const trendElement = screen.getByText("-5%");
    expect(trendElement).toBeInTheDocument();
    expect(trendElement).toHaveClass("text-red-500");

    const svg = screen.getByText("-5%").previousSibling as HTMLElement;
    expect(svg).toHaveClass("text-red-500");
  });

  it("renders 'neutral' trend correctly", () => {
    render(
      <MetricCard
        {...defaultProps}
        trend="neutral"
        trendValue="0%"
      />
    );
    const trendElement = screen.getByText("0%");
    expect(trendElement).toBeInTheDocument();
    expect(trendElement).toHaveClass("text-muted-foreground");

    const svg = screen.getByText("0%").previousSibling as HTMLElement;
    expect(svg).toHaveClass("text-muted-foreground");
  });

  it("does not render trend when trendValue is missing", () => {
    render(<MetricCard {...defaultProps} trend="up" />);
    // The trend container is only rendered if trend && trendValue
    // We check that no percentage sign (common in trend values) is rendered
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
