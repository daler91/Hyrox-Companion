# HyroxTracker

A full-stack training planning and logging application for [Hyrox](https://hyrox.com/) athletes. Plan structured training programs, log workouts with detailed exercise tracking, get AI-powered coaching advice, and analyze your performance over time.

## Features

- **Training Plans** — Import CSV training plans or use the built-in 8-week Hyrox program. Schedule plans to your calendar and track completion.
- **Workout Logging** — Log workouts with structured exercise data (sets, reps, weight, distance, time) or free-text descriptions that AI parses into structured data.
- **Unified Timeline** — A single view combining planned workouts, completed sessions, and missed days. Drag-and-drop reordering for exercises.
- **AI Coach** — Chat with an AI training coach powered by Google Gemini. Get Hyrox-specific advice, workout analysis, pacing strategies, and personalized suggestions based on your training history.
- **Analytics** — Personal records tracking, exercise progression charts, and performance breakdowns filtered by category and date range.
- **Strava Integration** — Connect your Strava account to automatically import activities as workouts.
- **Email Notifications** — Automated missed workout reminders and weekly training summaries via Resend.
- **Dark Mode** — Full light/dark theme support.
- **Unit Preferences** — Toggle between kg/lbs and km/miles throughout the app.
- **Data Export** — Export your training data as CSV or JSON.

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for development and builds
- **Tailwind CSS** with shadcn/ui components (Radix UI primitives)
- **TanStack React Query** for server state management
- **Wouter** for client-side routing
- **dnd-kit** for drag-and-drop exercise reordering
- **Framer Motion** for animations

### Backend
- **Node.js** with Express and TypeScript
- **Drizzle ORM** with PostgreSQL
- **Google Gemini API** for AI coaching and exercise parsing
- **Resend** for transactional emails
- **Sentry** for error monitoring

### Testing
- **Vitest** for unit tests (152 tests across 8 files)
- **Cypress** for end-to-end tests (8 test suites)

## Project Structure

```
├── client/src/
│   ├── components/
│   │   ├── onboarding/      # Onboarding wizard step components
│   │   ├── coach/           # AI coach panel sub-components
│   │   ├── analytics/       # Analytics chart components
│   │   ├── workout/         # Workout logging components
│   │   └── ui/              # shadcn/ui primitives
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Utility functions
│   └── pages/               # Route pages (Timeline, LogWorkout, Analytics, Settings)
├── server/
│   ├── routes/              # Express route handlers (thin wrappers)
│   ├── services/            # Business logic layer
│   │   ├── workoutService   # Workout create/update orchestration
│   │   ├── planService      # CSV import, plan lifecycle
│   │   ├── aiService        # Training context for AI prompts
│   │   ├── analyticsService # PR calculation, exercise analytics
│   │   ├── exportService    # CSV/JSON export generation
│   │   └── stravaMapper     # Strava activity mapping
│   ├── storage/             # Database access layer (Drizzle ORM)
│   ├── gemini.ts            # Google Gemini AI client with retry logic
│   ├── email.ts             # Email templates and sending
│   └── emailScheduler.ts    # Cron-style missed workout/summary emails
├── shared/
│   └── schema.ts            # Drizzle schema + Zod types (shared frontend/backend)
└── cypress/e2e/             # End-to-end test suites
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for AI features |
| `RESEND_API_KEY` | No | Resend API key for email notifications |
| `SENTRY_DSN` | No | Sentry DSN for error monitoring |
| `STRAVA_CLIENT_ID` | No | Strava OAuth client ID |
| `STRAVA_CLIENT_SECRET` | No | Strava OAuth client secret |

### Setup

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server (frontend + backend on port 5000)
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run db:push` | Push schema changes to database |

## Testing

### Unit Tests

```bash
# Run all 152 tests
npm test

# Watch mode
npm run test:watch
```

Test coverage includes:
- **Analytics** — Personal records calculation, exercise analytics aggregation
- **AI** — Retry logic, Zod schema validation, error classification
- **Utilities** — Streak calculation, exercise row expansion, date/stats/unit helpers
- **Strava** — Activity-to-workout mapping

### End-to-End Tests

```bash
npx cypress open    # Interactive mode
npx cypress run     # Headless mode
```

Cypress suites cover: authentication, landing page, timeline, log workout, analytics, settings, navigation, and API validation.

## Architecture Notes

- **Route handlers are thin** — validation and response formatting only. Business logic lives in the service layer.
- **Database operations use transactions** — Workout creation/updates, plan scheduling, and plan deletion are wrapped in `db.transaction()` for atomicity.
- **AI responses are validated** — Gemini responses use JSON mode and are validated with Zod schemas. Malformed items are logged and dropped. Transient errors retry with exponential backoff.
- **Storage layer is user-scoped** — All queries filter by `userId` to enforce data isolation.

## Platform Dependencies

This project is developed on Replit but most of the codebase is fully portable. Here's the breakdown:

### Replit-Specific (would need replacement to deploy elsewhere)

| Component | File(s) | What it does | Portable alternative |
|-----------|---------|--------------|---------------------|
| **Authentication** | `server/replitAuth.ts` | OpenID Connect login via Replit Auth | NextAuth, Clerk, Passport with Google/GitHub, Auth0 |
| **Session storage** | `server/replitAuth.ts` | PostgreSQL sessions via `connect-pg-simple` | Already portable — just needs a Postgres connection |
| **Email URL helper** | `server/email.ts` | Uses `REPLIT_DEPLOYMENT_URL` / `REPLIT_DEV_DOMAIN` to build app links | Replace `getAppUrl()` with your domain |
| **Run config** | `.replit` | Replit-specific run/deploy configuration | Replace with platform-specific config (Dockerfile, Procfile, etc.) |

### Fully Portable (works anywhere)

Everything else — which is the vast majority of the app:

- **Express API server** and all route handlers
- **Drizzle ORM + PostgreSQL** schema and storage layer
- **React/Vite frontend** with all components and hooks
- **Google Gemini AI** integration (just needs an API key)
- **Resend email** sending (just needs an API key)
- **Strava OAuth** integration
- **Sentry** error monitoring
- **All business logic** in the service layer
- **All tests** (Vitest unit tests and Cypress e2e)

### Migrating Off Replit

If you want to deploy this elsewhere (Vercel, Railway, Fly.io, etc.):

1. **Replace auth** — Swap `replitAuth.ts` with your preferred auth provider. The rest of the app only checks `req.user` and `userId`, so the interface is small.
2. **Set `getAppUrl()`** — Update the function in `server/email.ts` to return your production domain.
3. **Provide environment variables** — Same ones listed in the setup section above, plus your auth provider's config.
4. **Remove `.replit`** — Replace with your platform's config (e.g., `Dockerfile`, `fly.toml`, `railway.json`).

The auth swap is the only non-trivial step. Everything else is standard configuration.

## License

MIT
