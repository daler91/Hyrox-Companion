import "@testing-library/jest-dom/vitest";
import { toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

// Register the jest-axe matcher so component tests can call
// `expect(container).toHaveNoViolations()` for automated a11y checks.
expect.extend(toHaveNoViolations);

process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
process.env.CLERK_PUBLISHABLE_KEY = "dummy";
process.env.CLERK_SECRET_KEY = "dummy";
process.env.ENCRYPTION_KEY = "01234567890123456789012345678901";
