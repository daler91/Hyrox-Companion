# HyroxTracker

## Overview

HyroxTracker is a training planning and logging application for Hyrox athletes. Hyrox is a fitness competition combining running with functional workout stations (SkiErg, sled push/pull, burpees, rowing, farmers carry, and wall balls). The app allows users to:

- **User Authentication**: Login with Google, GitHub, Apple, or email via Replit Auth - data is private and scoped per user
- **Unified Timeline**: Single chronological view combining past workouts, current training, and future planned sessions
- **CSV Training Plan Import**: Upload training plans and schedule them with a start date
- **Workout Tracking**: Mark planned sessions as complete, skip them, or edit details
- **Status Management**: Track planned, completed, missed, and skipped workouts
- **AI Coach**: Chat with Gemini-powered coach that analyzes your personal training data for Hyrox-specific advice
- **AI Workout Suggestions**: Timeline page offers AI-powered suggestions to optimize upcoming workouts based on past training history
- **AI Text-to-Exercise Parsing**: Free text workout descriptions (e.g. "4x8 back squat at 70kg") are parsed by Gemini into structured per-set exercise data with confidence scores (0-100) for review before saving
- **Parse Confidence Scores**: Each AI-parsed exercise shows a confidence percentage indicating how certain the AI is about the exercise mapping. Scores below 90 show colored badges (green 80-89, yellow 60-79, red <60)
- **PR Detection**: Personal records are automatically detected per exercise (heaviest weight, fastest time, longest distance) and shown with trophy badges on timeline workout cards
- **Filtering & Search**: Filter timeline by status (all, planned, completed)
- **Drag-and-Drop Reordering**: Exercises on Log Workout page and in workout edit dialogs can be reordered via drag handles using @dnd-kit
- **AI Rate Limiting**: Per-user rate limits on AI endpoints (10/min chat, 5/min parsing, 3/min suggestions) with 429 responses
- **Email Notifications**: Weekly training summaries (sent on Mondays) and missed workout reminders via Resend, with per-user opt-in/out toggle in Settings. External cron endpoint (`GET /api/cron/emails` with `x-cron-secret` header or `?secret=` query param, validated against `CRON_SECRET` env var) processes all opted-in users — designed to be called by an external cron service (e.g., cron-job.org) at a set time like 8am CST daily
- **Database Integrity**: Foreign key cascade constraints, composite indexes for performance, unique constraint on custom exercises, application-level data cleanup on startup for orphaned records (safety net)
- **Performance Optimizations**: HTTP compression (gzip/brotli), lazy-loaded route code splitting, bulk SQL updates in schedulePlan, optimized timeline queries with Map lookups and parallel fetching, single-query getWorkoutsWithoutExerciseSets using LEFT JOIN, non-blocking Google Fonts loading, immutable cache headers for hashed static assets, manual Vite chunk splitting (vendor-react, vendor-ui, vendor-query, vendor-charts), CLS-optimized skeleton loaders, Open Graph meta tags, date-range filtering on analytics endpoints
- **Security Headers**: Express middleware sets CSP (environment-aware: dev allows ws/wss and unsafe-eval for Vite HMR), X-Frame-Options (SAMEORIGIN), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), Permissions-Policy (disables camera/microphone/geolocation)
- **Accessibility**: ARIA labels on all icon-only buttons, ARIA progressbar on onboarding wizard, semantic status badge labels, success/error color theming

The design follows premium fitness app patterns (Strava, TrainingPeaks, Whoop) with focus on data clarity and athletic performance tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support), semantic `--success` color variable
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Build Tool**: Vite with React plugin

The frontend follows a streamlined page-based architecture:
- **Landing**: Public page for unauthenticated users with login CTAs
- **Timeline** (home): Unified chronological view with integrated AI Coach side panel - the single main screen experience
- **Log Workout**: Manual workout entry form
- **Analytics**: Personal records, exercise progression charts, and volume analytics with date-range filtering (30d/90d/6m/1y/all)
- **Settings**: User preferences, Strava integration, data export, batch re-parse old workouts

The Timeline consolidates training management and AI coaching into one view:
- Toggleable AI Coach panel (side column on desktop, full-screen overlay on mobile)
- Training plan import, scheduling, editing, and status tracking
- Workout merging and quick actions all in one place

Key component directories:
- `client/src/components/timeline/` — Timeline sub-components (workout cards, dialogs, filters, headers)
- `client/src/components/settings/` — Settings page sections (ProfileSection, StravaSection, PreferencesSection, DataToolsSection)
- `client/src/components/ui/` — shadcn/ui primitives (25 components, trimmed from unused originals)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api` prefix with authentication middleware
- **Authentication**: Replit Auth (OIDC) with PostgreSQL session storage
- **Build**: esbuild for production bundling with selective dependency bundling

Routes are split into domain-based modules under `server/routes/`:
- `server/routes/ai.ts` — AI chat, streaming chat, exercise parsing, AI suggestions
- `server/routes/analytics.ts` — personal records, exercise volume stats with optional `from`/`to` date params (delegates to analyticsService)
- `server/routes/workouts.ts` — workout CRUD, exercise history, re-parse, data export, timeline (delegates to exportService)
- `server/routes/plans.ts` — training plan CRUD, CSV import, sample plan, scheduling, plan day updates
- `server/routes/auth.ts` — user profile endpoint (`/api/auth/user`)
- `server/routes/preferences.ts` — user preferences GET/PATCH (`/api/preferences`)
- `server/routes/email.ts` — email check and cron endpoints (`/api/emails/check`, `/api/cron/emails`)
- `server/routes.ts` — pure orchestrator mounting all sub-routers + Strava routes

Shared utilities and types:
- `server/types.ts` — `AuthenticatedRequest` type (typed Express Request with user claims), `toDateStr()` date formatting helper
- `server/routeUtils.ts` — rate limiter, expandExercisesToSetRows, buildTrainingContext (decomposed into calculateTrainingStats, getExerciseBreakdown, calculateStreak, collectRecentWorkouts), upsertCustomExercisesFromSets, reparseWorkout (transactional delete+create)
- `server/prompts.ts` — AI prompt constants (BASE_SYSTEM_PROMPT, SUGGESTIONS_PROMPT, PARSE_EXERCISES_PROMPT), validation sets, buildSystemPrompt function
- `server/maintenance.ts` — startup cleanup (cleanOrphanedData, markMissedPlanDays) extracted from index.ts
- `server/samplePlan.ts` — hardcoded 8-week sample training plan data

Extracted service modules under `server/services/`:
- `server/services/exportService.ts` — CSV and JSON export generation (extracted from workouts route)
- `server/services/analyticsService.ts` — personal records calculation and exercise analytics aggregation (extracted from analytics route)
- `server/services/stravaMapper.ts` — Strava activity-to-workout mapping and formatting helpers (extracted from strava.ts)

The storage layer is split into domain modules under `server/storage/`:
- `server/storage/IStorage.ts` — storage interface with all method signatures
- `server/storage/users.ts` — user CRUD, preferences, chat, Strava connections, custom exercises
- `server/storage/workouts.ts` — workout log CRUD, exercise sets CRUD, exercise history
- `server/storage/plans.ts` — training plan CRUD, plan days, scheduling, marking missed days
- `server/storage/timeline.ts` — timeline assembly from plans and workouts
- `server/storage/analytics.ts` — exercise analytics with optional date-range filtering, missed workouts, weekly stats
- `server/storage/index.ts` — composes domain storages into `DatabaseStorage` class, exports singleton
- `server/storage.ts` — re-export shim for backward compatibility

All data routes require authentication and filter by userId for privacy. Static files are served from the built client in production, with Vite dev server middleware in development.

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Current Implementation**: PostgreSQL database with `DatabaseStorage` class
- **Schema Design**: 
  - Users table with Replit Auth profile data
  - Sessions table for session management
  - TrainingPlans, PlanDays, and WorkoutLogs tables - all linked to userId
  - ExerciseSets table linked to WorkoutLogs for structured exercise tracking (sets, reps, weight, distance, time, confidence score)
  - CustomExercises table (userId, name, category) to remember user's custom exercise names for future AI recognition
  - PlanDays include scheduledDate and status (planned, completed, missed, skipped)
  - Timeline is aggregated from scheduled plan days and workout logs, filtered by user
  - 40+ predefined exercises across 4 categories (hyrox_station, running, strength, conditioning) defined in shared/schema.ts
- **Foreign Key Constraints**:
  - `exercise_sets.workoutLogId` → `workout_logs.id` (cascade delete)
  - `plan_days.planId` → `training_plans.id` (cascade delete)
  - `workout_logs.planDayId` → `plan_days.id` (set null on delete)
  - `chat_messages.userId` → `users.id` (cascade delete)
  - `custom_exercises.userId` → `users.id` (cascade delete)
  - `strava_connections.userId` → `users.id` (cascade delete)
- **Indexes**: User-scoped indexes on all tables, composite indexes for common queries (user+date, plan+week, workout+exercise), dedicated indexes on `strava_activity_id` and `source` columns

The storage layer uses an interface pattern (`IStorage`) with all methods requiring userId for data isolation between users.

### Authentication
- **Provider**: Replit Auth (OpenID Connect)
- **Session Storage**: PostgreSQL via connect-pg-simple
- **Key Files**: 
  - `server/replitAuth.ts` - auth setup and middleware
  - `client/src/hooks/useAuth.ts` - React hook for auth state
  - `client/src/pages/Landing.tsx` - public landing page

### AI Integration
- **Provider**: Google Gemini API via `@google/genai` SDK
- **Model**: gemini-3-flash-preview
- **Use Cases**: 
  - AI training coach that provides Hyrox-specific advice, workout analysis, and pacing strategies
  - AI text-to-exercise parsing: converts free-text workout descriptions into structured per-set exercise data
  - Custom exercise recognition: AI parser receives user's saved custom exercise names for better matching
- **Implementation**: Server-side chat function with conversation history and personalized training context
- **Training Context**: AI receives user's workout stats, completion rate, streak, exercise breakdown, structured exercise performance stats (max weight, best time, distances), and recent workouts with per-exercise details
- **Text Parsing**: POST /api/parse-exercises accepts free text, passes user's weightUnit preference to Gemini for correct unit handling, validates/normalizes exercise names and categories on server side before returning structured data

## External Dependencies

### Third-Party Services
- **Google Gemini API**: AI coach functionality requiring `GEMINI_API_KEY` environment variable
- **PostgreSQL**: Database backend requiring `DATABASE_URL` environment variable
- **Replit Auth**: OIDC authentication via `ISSUER_URL` (defaults to Replit)
- **Sentry.io**: Error monitoring for frontend (`@sentry/react` in `client/src/main.tsx`) and backend (`@sentry/node` in `server/index.ts`). DSN loaded from `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (frontend) environment variables. CSP allows `https://*.ingest.us.sentry.io` for event reporting

### Key Libraries
- **UI Framework**: Radix UI primitives (accordion, dialog, dropdown-menu, tabs, etc.)
- **Forms**: react-hook-form with zod validation via @hookform/resolvers
- **Data Fetching**: @tanstack/react-query
- **Date Handling**: date-fns
- **Database**: drizzle-orm, drizzle-zod, pg (PostgreSQL client)
- **Session Management**: express-session with connect-pg-simple for PostgreSQL session store
- **Auth**: openid-client, passport

### Development Tools
- **Type Checking**: TypeScript with strict mode
- **CSS Processing**: PostCSS with Tailwind CSS and autoprefixer
- **Database Migrations**: drizzle-kit for schema migrations
- **E2E Testing**: Cypress.io with Cypress Cloud (project ID: `dy8p9y`). Config in `cypress.config.ts`, 8 test specs in `cypress/e2e/` (landing, auth, navigation, timeline, settings, log-workout, analytics, api-validation). Shared auth intercept helper in `cypress/support/authIntercepts.ts`. Custom `getBySel` command for `data-testid` selectors. GitHub Actions workflow in `.github/workflows/cypress.yml` runs tests on push/PR with `CYPRESS_RECORD_KEY` secret. Run locally with `npx cypress open` or `npx cypress run`
