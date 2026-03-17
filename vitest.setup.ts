import "@testing-library/jest-dom/vitest";

process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
process.env.CLERK_PUBLISHABLE_KEY = "dummy";
process.env.CLERK_SECRET_KEY = "dummy";
process.env.ENCRYPTION_KEY = "01234567890123456789012345678901";
