process.env.ENCRYPTION_KEY = "01234567890123456789012345678901";
process.env.SESSION_SECRET = "dummy_session_secret_for_tests_only";
delete process.env.CLERK_PUBLISHABLE_KEY;
delete process.env.CLERK_SECRET_KEY;
// Let DATABASE_URL be provided by CI environment, but dummy it locally if absent to prevent crash.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
}
