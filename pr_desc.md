🎯 **What:** The vulnerability fixed
Missing rate limiting on potentially expensive route endpoints, including the `/api/plans/import`, `/api/plans/sample`, and `/api/plans/:planId/schedule` endpoints.

⚠️ **Risk:** The potential impact if left unfixed
Malicious actors or erroneous automated scripts could repeatedly call these endpoints, leading to significant CPU/memory consumption and potential Denial of Service (DoS) for the application.

🛡️ **Solution:** How the fix addresses the vulnerability
We audited the `server/routes/plans.ts` file and confirmed that the `/api/plans/import` endpoint was previously patched with the `rateLimiter` middleware. As a best practice, we have applied the `rateLimiter` middleware to other expensive and unprotected route handlers (`/api/plans/sample` and `/api/plans/:planId/schedule`) using appropriate categories (`planSample`, `planSchedule`) and limits.

✅ **Verification:**
Tests pass successfully and ensure standard functionality is untouched.
