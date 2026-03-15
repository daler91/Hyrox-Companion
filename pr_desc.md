🔒 [security fix] Update ws package to resolve CVE-2024-37890

🎯 **What**
Updated the `ws` package to version 8.19.0 to address CVE-2024-37890 (a vulnerability in versions < 8.17.1). Also synced `package.json`, `package-lock.json`, and `pnpm-lock.yaml`.

⚠️ **Risk**
The vulnerability (CVE-2024-37890) is a High severity issue where a request with a number of headers exceeding the server's threshold could be used to crash a ws server, leading to Denial of Service (DoS).

🛡️ **Solution**
Updated `ws` directly using `pnpm add ws@latest` to forcefully resolve the dependency to the fixed version (8.19.0) across the entire project and sync all lockfiles.
