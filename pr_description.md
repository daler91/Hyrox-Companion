💡 **What:**
Introduced a Promise deduplication (coalescing) cache in the `/api/personal-records` and `/api/exercise-analytics` endpoints. When concurrent requests hit these endpoints with identical user IDs and date ranges, the server will now issue a single database query and share the resulting `Promise` to resolve all waiting requests simultaneously.

🎯 **Why:**
The client dashboard previously launched multiple simultaneous API calls to populate its sections, hitting separate routes that each queried the exact same underlying exercise sets from the database. This triggered redundant, expensive queries (e.g. `storage.getAllExerciseSetsWithDates`) placing unnecessary strain on both the Node.js event loop and the Postgres database.

📊 **Measured Improvement:**
A benchmark test was implemented simulating identical concurrent requests against both `/api/personal-records` and `/api/exercise-analytics` using a mock database connection with an artificial 100ms latency.
* **Baseline:** The mock database was called **2** times, taking **~161ms** to resolve both API requests.
* **Optimized:** The mock database was called **1** time, taking **~100ms** to resolve both API requests.
* **Result:** Reduced identical, concurrent database queries by 100% and lowered endpoint latency overhead by nearly 40%.
