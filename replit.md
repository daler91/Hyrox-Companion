# HyroxTracker

## Overview

HyroxTracker is a training planning and logging application designed for Hyrox athletes. It enables users to plan, track, and analyze their training for the Hyrox competition, which combines running with functional workout stations. The application aims to provide a unified timeline of past, current, and future training, leverage AI for coaching and workout suggestions, and offer robust workout tracking capabilities including PR detection and free-text exercise parsing. The project's vision is to be a premium fitness app focusing on data clarity and athletic performance tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with React and TypeScript, utilizing Wouter for client-side routing and TanStack React Query for server state management. Styling is handled by Tailwind CSS with CSS variables for theming, and UI components are derived from shadcn/ui, based on Radix UI primitives. Vite serves as the build tool. The application features a streamlined, page-based architecture including a public Landing page, a unified Timeline for training management and AI coaching, a Log Workout form, Analytics for performance tracking, and Settings for user preferences. The Timeline is the core experience, integrating AI coaching, plan management, and workout actions.

#### Landing Page
The public landing page (`client/src/pages/Landing.tsx`) is a full SaaS-style marketing page with: sticky header with Clerk sign-in, hero section with animated timeline mockup, trust strip, 4 feature cards (AI Coach, Timeline, Strava, Analytics), 3-step How It Works flow, Hyrox station grid, capability highlights, final CTA, and footer. Uses IntersectionObserver for scroll-triggered fade-up animations and CSS float animation on the hero mockup. All auth CTAs use `SignInButton` from `@clerk/clerk-react`.

#### Component Organization
Larger components are split into focused sub-components in domain directories:
- `components/onboarding/` — Wizard step components (`WelcomeStep`, `UnitsStep`, `GoalStep`, `PlanStep`, `ScheduleStep`); parent `OnboardingWizard.tsx` manages navigation and state
- `components/coach/` — `StatBadge`, `SuggestionCard`, `SuggestionsTab` (with `useSuggestions` hook); parent `CoachPanel.tsx` is a thin orchestrator
- `components/analytics/` — `MiniBarChart` extracted from Analytics page
- `components/workout/` — `SortableExerciseBlock` extracted from LogWorkout page

### Backend Architecture
The backend is a Node.js Express application written in TypeScript with ESM modules. It provides RESTful endpoints under the `/api` prefix, secured with Clerk authentication middleware. Routes are organized into domain-based modules (e.g., `ai`, `analytics`, `workouts`, `plans`, `auth`, `preferences`, `email`). Route handlers are thin wrappers that validate input and delegate to service modules.

#### Service Layer (`server/services/`)
- `workoutService.ts` — Workout create/update orchestration with `db.transaction()`, exercise-to-set-row expansion, custom exercise upsert, AI reparse
- `planService.ts` — CSV import parsing/transformation, sample plan creation, plan-day update with linked workout cleanup
- `aiService.ts` — `buildTrainingContext()` for assembling training stats, exercise breakdown, and recent workouts for AI prompts
- `analyticsService.ts` — Personal records calculation, exercise analytics aggregation
- `exportService.ts` — CSV/JSON export generation
- `stravaMapper.ts` — Strava activity to workout mapping

#### Utilities (`server/routeUtils.ts`)
Contains only cross-cutting concerns: `rateLimiter` middleware and `calculateStreak` helper.

#### Storage Layer (`server/storage/`)
- `shared.ts` — Shared `queryExerciseSetsWithDates()` helper used by both workout history and analytics queries (deduplicates exercise-set + workout-log innerJoin)
- `plans.ts` — Plan scheduling and deletion wrapped in `db.transaction()` for atomicity
- `workouts.ts`, `analytics.ts`, `users.ts`, `timeline.ts` — Domain-specific storage classes

### Data Storage
Drizzle ORM with PostgreSQL is used for data persistence. The schema, shared between client and server, includes tables for Users, TrainingPlans, PlanDays, WorkoutLogs, ExerciseSets, and CustomExercises. Foreign key constraints ensure data integrity, and user-scoped indexes optimize query performance. An `IStorage` interface pattern enforces data isolation per user.

### Authentication
Clerk handles user authentication via JWT-based sessions. The `@clerk/express` middleware on the backend validates session tokens, and `@clerk/clerk-react` provides frontend components (SignInButton, SignOutButton, useUser). On first authenticated request, the user is upserted into the local `users` table from Clerk profile data. Production instance configured for `hyroxcompanion.life` with `pk_live_`/`sk_live_` keys; development uses `pk_test_`/`sk_test_` keys.

#### Cypress Test Bypass
When Cypress runs, `window.Cypress` is detected at module load time. This causes:
- `App.tsx`: Renders `AuthenticatedLayout` directly without `ClerkProvider` wrapper
- `useAuth.ts`: Uses `useTestAuthImpl` which fetches `/api/auth/user` directly (auth state is data-driven from the API response)
- `useSignOut.ts`: Returns a no-op function instead of Clerk's `signOut`
- Cypress `setupAuthIntercepts()` stubs the `/api/auth/user` endpoint to return a mock user
- Backend auth is NOT bypassed — API routes still enforce authentication via Clerk middleware

### Voice Input
The app supports browser-native speech recognition for hands-free interaction via the Web Speech API (`SpeechRecognition`). Key files:
- `client/src/hooks/useVoiceInput.ts` — Reusable hook wrapping the SpeechRecognition API with start/stop/toggle, interim transcript, and browser support detection
- `client/src/components/VoiceButton.tsx` — Microphone button component with listening state feedback
- Integrated into `ChatInput.tsx` (AI Coach chat) and `LogWorkout.tsx` (free-text workout dictation)
- The "Voice" mode button on the Log Workout page switches to free-text mode and starts listening automatically
- Interim transcripts are shown separately (not mixed into the textarea value) to prevent state corruption

### Data Entry Quality
The app includes several features to improve workout data quality:
- **RPE (Rate of Perceived Exertion)**: A 1-10 effort scale selector on the Log Workout page. Color-coded (green/yellow/orange/red) with effort labels (Easy/Moderate/Hard/Max Effort). Stored on `workout_logs.rpe`. Toggle to deselect.
- **Missing Data Warnings**: Inline yellow warning banners on exercise cards when key fields are empty (e.g., weight for strength, time for Hyrox stations, distance for runs). Also shows a toast notification on save listing which exercises have gaps. Implemented in `client/src/lib/exerciseWarnings.ts` with category-based field requirements.
- **AI Missing Field Detection**: The AI exercise parser flags fields the user didn't mention in their text description (e.g., "4x8 squat" → flags "Weight" as missing). The `missingFields` array flows through the `parsedExerciseSchema` and appears as warnings on parsed exercise cards.

### AI Integration
The Google Gemini API (gemini-3-flash-preview model) powers the AI features. This includes an AI training coach that provides Hyrox-specific advice, workout analysis, and pacing strategies, as well as AI text-to-exercise parsing for converting free-text workout descriptions into structured data. The AI also benefits from custom exercise recognition based on user-saved names. The server-side implementation manages conversation history and provides personalized training context to the AI, including user stats and recent workout data.

AI response robustness (`server/gemini.ts`):
- **JSON mode**: `responseMimeType: "application/json"` on suggestion and exercise-parse calls ensures Gemini returns raw JSON (no markdown fences or preamble)
- **Zod validation**: Parsed AI responses are validated with Zod schemas (`workoutSuggestionSchema`, `parsedExerciseSchema`) — malformed items are logged and dropped (suggestions) or throw with clear messages (exercises)
- **Retry with backoff**: Transient failures (429 rate limit, 500/503 server errors, network errors) retry up to 2 times with exponential backoff (1s, 2s); non-retryable errors fail immediately
- **Error logging**: Parse failures log truncated raw response text; Zod failures log validation issues and raw data for debugging

### RAG Pipeline & pgvector Compatibility
The AI coaching system uses a RAG (Retrieval-Augmented Generation) pipeline that embeds coaching materials into chunks, stores them in `document_chunks`, and retrieves relevant chunks via cosine similarity search when the auto-coach runs.

**Critical: The `embedding` column in `document_chunks` is stored as `text` type** (Drizzle ORM has no native pgvector `vector` type). Even though the pgvector extension is installed in production, this text storage means:
- Always cast `embedding::vector` before using pgvector operators like `<=>` (cosine distance)
- Never use pgvector utility functions like `vector_dims()` — they expect `vector` type columns and will fail on `text`. Use portable SQL alternatives (e.g., `array_length(string_to_array(embedding::text, ','), 1)` to get dimension count)
- The RAG pipeline silently falls back to "legacy" mode if any step throws an error, so pgvector-related failures can be hard to spot — check production logs for `[coach] RAG retrieval failed` or `[rag]` tags

Key files: `server/storage/coaching.ts` (search/dimension queries), `server/services/ragService.ts` (embedding + retrieval), `server/services/coachService.ts` (orchestration + fallback logic)

## External Dependencies

### Third-Party Services
- **Google Gemini API**: Used for AI coaching and exercise parsing.
- **PostgreSQL**: The primary database backend.
- **Clerk**: Provides JWT-based authentication with social login support.
- **Sentry.io**: For error monitoring in both frontend and backend.

### Key Libraries
- **UI Framework**: Radix UI primitives.
- **Forms**: `react-hook-form` with `zod` validation.
- **Data Fetching**: `@tanstack/react-query`.
- **Date Handling**: `date-fns`.
- **Database**: `drizzle-orm`, `drizzle-zod`, `pg`.
- **Auth**: `@clerk/express`, `@clerk/clerk-react`.

### Development Tools
- **Type Checking**: TypeScript.
- **CSS Processing**: PostCSS with Tailwind CSS.
- **Database Migrations**: `drizzle-kit`.
- **Unit Testing**: Vitest (config: `vitest.config.ts`). Run with `npx vitest run` (single run) or `npx vitest` (watch mode).
- **E2E Testing**: Cypress.io with Cypress Cloud (project ID: `dy8p9y`). Config in `cypress.config.ts`, tests in `cypress/e2e/`. Custom `getBySel` command for `data-testid` selectors. GitHub Actions workflow in `.github/workflows/cypress.yml`. Run locally with `npx cypress open` or `npx cypress run`.

### Unit Test Locations
- `server/services/analyticsService.test.ts` — `calculatePersonalRecords`, `calculateExerciseAnalytics`
- `server/routeUtils.test.ts` — `calculateStreak` (from `routeUtils`), `expandExercisesToSetRows` (from `services/workoutService`)
- `server/gemini.test.ts` — `isRetryableError`, `retryWithBackoff`, Zod schemas (`workoutSuggestionSchema`, `parsedExerciseSchema`, `exerciseSetSchema`)
- `shared/unitConversion.test.ts` — weight/distance conversion, formatting utilities
- `server/services/stravaMapper.test.ts` — `mapStravaActivityToWorkout`
