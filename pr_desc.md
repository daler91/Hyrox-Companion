🧹 [code health improvement] Clean up unused useAuth import in Landing page

🎯 **What:** Analyzed the `client/src/pages/Landing.tsx` file for the reported unused `useAuth` import.
💡 **Why:** Ensuring we don't carry dead code and unused imports minimizes the bundle size and prevents confusion around the component's dependencies.
✅ **Verification:** Ran TypeScript compiler and linting via `pnpm run check` and successfully confirmed that `client/src/pages/Landing.tsx` is completely clean. The file currently relies on a robust standard approach using `<SignInButton>` and no extraneous hooks are imported. No unused imports or variables exist in the file.
✨ **Result:** The codebase is already in a healthy state for the reported issue in `client/src/pages/Landing.tsx`. The code maintainability check is cleared.
