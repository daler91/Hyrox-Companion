## 2024-05-19 - Insecure Direct Object Reference (IDOR) in Exercise Sets Deletion
**Vulnerability:** The `/api/workouts/:id` DELETE endpoint previously deleted exercise sets by `workoutLogId` *before* verifying if the `workoutLogId` actually belonged to the requesting user. This allowed an attacker to delete any other user's exercise sets by guessing or knowing the `workoutLogId`.
**Learning:** Always verify ownership of the parent resource before performing cascade deletes on child resources, even if the final deletion of the parent resource would fail due to an ownership check. The `deleteExerciseSetsByWorkoutLog` method was called without authorization context.
**Prevention:** Ensure all storage methods that modify or delete data, especially child resources, require and validate the `userId` to enforce authorization boundaries.

## 2024-03-12 - Sensitive Data Exposure in API Request Logging
**Vulnerability:** The Express server's global logging middleware logged the complete JSON response body for every API request (`capturedJsonResponse`). This exposed sensitive PII (like emails and auth tokens from `/api/auth/user`) directly into server logs.
**Learning:** Logging full HTTP response bodies globally is a critical security risk. It creates a secondary vector for data breaches where attackers only need access to the logs, not the database.
**Prevention:** Avoid modifying `res.json` to capture and log response bodies. Log only necessary metadata (method, path, status, duration) for routine requests. If payload logging is strictly necessary for auditing, use a dedicated, sanitized logging service for specific actions only.

## 2024-05-24 - Replace Math.random() with window.crypto.getRandomValues()
 **Vulnerability:** Math.random() is flagged by SAST tools for insecure randomness, even when used innocuously for UI rendering.
 **Learning:** While functionally fine for determining skeleton loader widths, using predictable PRNGs like Math.random() creates noise in security scans and theoretically reduces the resilience of client-side operations against tampering.
 **Prevention:** In client-side React code, default to the Web Crypto API `window.crypto.getRandomValues()` when generating random numbers or percentages, even for low-risk visual calculations.
