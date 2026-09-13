// Pin to UTC so date-fns / `format()` / Date parsing produce identical
// strings on every contributor's machine. Several timeline / calendar
// tests construct fixtures via `format(new Date("2023-10-15"), …)`,
// which ECMAScript parses as UTC midnight — under non-UTC dev timezones
// (e.g. America/Chicago) the formatted date shifts by a day and the
// past/future grouping assertions misalign. CI runs in UTC, so this just
// brings local dev into parity with CI.
process.env.TZ = "UTC";

import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

// Testing Library's default 1000ms budget for findBy*/waitFor is the real
// ceiling most component tests run against, and it is tight when the suite's
// worker processes contend for CPU: a query that resolves instantly on an idle
// machine has been seen to miss 1s under full parallel load, failing as
// "unable to find an element" rather than for any real reason (issue #1710).
// This only lengthens how long a poll waits before giving up — an element that
// never appears still fails the test.
configure({ asyncUtilTimeout: 3000 });

// Register the jest-axe matcher so component tests can call
// `expect(container).toHaveNoViolations()` for automated a11y checks.
expect.extend(toHaveNoViolations);

process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
process.env.CLERK_PUBLISHABLE_KEY = "dummy";
process.env.CLERK_SECRET_KEY = "dummy";
process.env.ENCRYPTION_KEY = "01234567890123456789012345678901";
