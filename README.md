<div align="center">
  <h1>🏃‍♂️ HyroxTracker (Companion App)</h1>
  <p><strong>A fully responsive, AI-powered specialized training planner and analytics suite built exclusively for <a href="https://hyrox.com/" target="_blank">Hyrox</a> athletes.</strong></p>

  <p>
    <a href="#features">Features</a> •
    <a href="#architecture--tech-stack">Tech Stack</a> •
    <a href="#project-structure">Project Structure</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#available-scripts">Scripts</a> •
    <a href="#testing--code-quality">Testing</a> •
    <a href="#cicd-pipeline">CI/CD</a> •
    <a href="#license">License</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React">
    <img src="https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
    <img src="https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">
    <img src="https://img.shields.io/badge/Vitest-750%2B_Tests-729B1B?style=flat-square&logo=vitest&logoColor=white" alt="Vitest">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License">
  </p>
</div>

---

<br />

Plan structured training programs, log complex workouts with voice or free-text using Gemini LLMs to parse sets & reps, automatically sync activities from Strava, and get real-time prescriptive AI coaching to adjust your volume based on your completed results.

## 🌟 Capabilities Deep-Dive

### 📅 Unified Training Experience
- **Interactive Timeline**: A drag-and-drop integrated view spanning past performance, today's focus, and future planned workouts. Visually distinguish between completed, planned, and missed workouts.
- **Hyrox Plans**: Import customized CSV, DOCX, or PDF training blocks, or utilize the built-in 8-week rigorous Hyrox program out-of-the-box.
- **Custom Exercises**: Log non-standard movements (e.g., custom sled pushes or sandbag lunges) natively alongside your core lifts.
- **Onboarding Wizard**: A guided setup flow that configures your profile, preferred units, weekly training goals, and AI coach personality on first launch.

### 🤖 Google Gemini AI Engine
- **Intelligent Workout Parsing**: No more tapping dropdowns. Simply say or type: *"Did 3 sets of bench pressing at 225lbs for 8 reps, then ran 3 miles in 24 minutes"*. The Gemini Vision & Language API parses the raw text into structured database elements instantly using enforced Zod JSON schemas.
- **Real-time Auto-Coach**: The AI continuously reads your active plan's goal and your recent timeline. It evaluates fatigue, volume, and pacing, and provides actionable adjustments to your upcoming schedule automatically.
- **Streaming Live Chat**: Interact directly with your Coach over a fast Server-Sent Events (SSE) stream for contextual questions like *"What pace should I aim for on my next 1km run based on yesterday's track session?"*

### 📚 RAG-Powered Coaching
- **Document Uploads**: Upload your own coaching materials (CSV, DOCX, PDF) to enrich the AI coach's knowledge base with sport-specific or personal training methodologies.
- **Vector Embeddings**: Documents are chunked and embedded via pgvector, enabling semantic retrieval-augmented generation (RAG) for highly contextual coaching responses.

### 🚴 Strava Integration
- **Zero-Friction Sync**: Link your primary Strava account using secure OAuth 2.0 flows. HyroxTracker listens to activity updates and automatically mounts them onto your timeline as completed workouts, decrypting access tokens locally on the fly.

### 📊 Meaningful Analytics
- **Personal Records**: Automatically detects and graphs 1RM estimation progressions and lifetime PRs natively.
- **Advanced Filtering**: Drill down into performance by exercise categories, dates, or particular micro-cycles.
- **Weekly Email Summaries**: Backgrounded cron jobs via pg-boss leverage Resend to email you weekly training summaries or gentle reminders for missed days.

### 📱 PWA & Offline Support
- **Installable App**: Built as a Progressive Web App with Workbox service worker for offline caching and native-like experience on mobile devices.

---

## 🏗 Architecture & Tech Stack

This repository is a fully functional monorepo containing both the React frontend and the Express REST API backend, written entirely in strictly typed **TypeScript**.

### Frontend
- **Framework**: React 18, Vite 5, TypeScript 5.9
- **Styling**: Tailwind CSS 4 layered over shadcn/ui (accessible Radix primitives)
- **State Management**: TanStack Query (React Query) for optimized server state caching
- **Client Routing**: wouter for ultra-lightweight navigation
- **Drag & Drop**: dnd-kit for sortable, accessible drag-and-drop interactions
- **Visualization**: Recharts for interactive performance charts
- **PWA**: vite-plugin-pwa + Workbox for offline support and installability
- **Error Tracking**: Sentry for real-time error monitoring

### Backend
- **API Runtime**: Node.js + Express 4 with thin controller wrappers and thick service abstractions
- **Database**: PostgreSQL bridged by the type-safe Drizzle ORM
- **Authentication**: Clerk JWT middleware protecting all private endpoints
- **AI**: Google Gemini API (`@google/genai`) for workout parsing and coaching
- **Vector DB**: pgvector extension for RAG document embeddings
- **Job Queue**: pg-boss for background tasks (email scheduling, maintenance)
- **Email**: Resend for transactional email delivery
- **Logging**: Pino + pino-http for structured, high-performance logging
- **API Documentation**: Swagger UI auto-generated from Zod schemas via zod-to-openapi
- **Validation**: Zod for runtime schema validation with drizzle-zod integration
- **Security**:
  - Helmet for HTTP security headers
  - express-rate-limit for granular API rate limiting
  - AES-256-GCM encryption for Strava token storage
  - Strava OAuth CSRF state verification

### Shared
- Shared Zod schemas and TypeScript types between client and server
- OpenAPI spec generation from Zod schemas

---

## 📁 Project Structure

```
Hyrox-Companion/
├── client/                     # React frontend (Vite SPA)
│   └── src/
│       ├── components/         # UI components
│       │   ├── ui/             # shadcn/ui primitives
│       │   ├── analytics/      # Analytics dashboard
│       │   ├── coach/          # AI coaching interface
│       │   ├── onboarding/     # Onboarding wizard
│       │   ├── plans/          # Training plan management
│       │   ├── settings/       # User preferences
│       │   ├── timeline/       # Drag-and-drop timeline
│       │   └── workout/        # Workout logging
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Utilities & API client
│       └── pages/              # Route pages (Landing, Timeline, LogWorkout, Analytics, Settings)
├── server/                     # Express backend
│   ├── gemini/                 # Gemini AI parsing & prompt logic
│   ├── routes/                 # API route handlers
│   ├── services/               # Business logic layer
│   ├── storage/                # Database access layer (Drizzle)
│   └── utils/                  # Server utilities
├── shared/                     # Shared code (client + server)
│   └── schema/                 # Drizzle table definitions, Zod types, enums
├── migrations/                 # Drizzle SQL migrations
├── cypress/                    # E2E test suites
├── .github/workflows/          # CI/CD pipelines (7 workflows)
└── script/                     # Build & maintenance scripts
```

---

## 📖 API Documentation

Interactive API documentation is available via **Swagger UI** at `/api/docs` when the server is running. The spec is auto-generated from Zod schemas using `@asteasolutions/zod-to-openapi`, ensuring documentation always stays in sync with the codebase.

---

## 🚀 Getting Started

Follow these instructions to run the full application ecosystem locally.

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or higher)
- [pnpm](https://pnpm.io/) (v9.x — run `corepack enable` to auto-install)
- [PostgreSQL](https://www.postgresql.org/download/) with the [pgvector](https://github.com/pgvector/pgvector) extension (for RAG features)
- A [Clerk.dev](https://clerk.dev/) account for auth (optional — use `ALLOW_DEV_AUTH_BYPASS=true` for local dev)
- A [Google AI Studio](https://aistudio.google.com/) key for AI features (optional)

### 1. Environment Variables
Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

At minimum, set the two **required** variables:
- `DATABASE_URL` – PostgreSQL connection string
- `ENCRYPTION_KEY` – 32+ char hex key (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

See `.env.example` for all available configuration options including Clerk auth, Gemini AI, Strava sync, Resend email, Sentry, and more.

### 2. Installation & Database Setup

```bash
# Install dependencies
pnpm install

# Generate and run Drizzle ORM migrations
pnpm run db:generate
pnpm run db:migrate
```

### 3. Start the Application

```bash
pnpm dev
```

This fires up the Vite frontend with HMR and the Express backend on port `5000`. Visit `http://localhost:5000` in your browser.

---

## 📜 Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start development server (Vite HMR + Express) |
| `pnpm build` | Production build (client + server) |
| `pnpm start` | Run production build |
| `pnpm check` | TypeScript type checking |
| `pnpm test` | Run Vitest unit & integration tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting without writing |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm db:check` | Validate migration/schema consistency |

---

## 🧪 Testing & Code Quality

The repository maintains stability through comprehensive testing at all mutation points.

- **Unit & Integration Tests (Vitest)**: 750+ test cases across 60+ test files covering AI retry boundaries, functional calculations (streak aggregators, workout spreaders), rate-limiting state, schema validations, and service logic.
  - Run via: `pnpm test` or `pnpm test:watch`
- **End-to-End Tests (Cypress)**: 120+ E2E test cases running headless browser sessions mimicking real user flows from authentication through drag-and-drop timeline interactions.
  - Run via: `pnpm exec cypress open`
- **TypeScript Compiler**: Strict static type safety enforced globally.
  - Run via: `pnpm check`
- **Linting & Formatting**: ESLint + Prettier for consistent code style.
  - Run via: `pnpm lint` and `pnpm format:check`

---

## 🔄 CI/CD Pipeline

Every push and pull request triggers automated pipelines via GitHub Actions:

| Workflow | Trigger | Purpose |
|---|---|---|
| **Build** | Push / PR | Lint, type check, production build |
| **Test** | Push / PR | Unit & integration test suite |
| **Cypress** | Push / PR | E2E browser tests |
| **Migrations** | Push / PR | Database schema consistency validation |
| **Post-Migration** | After migration | Post-migration health checks |
| **Trivy** | Push / PR / Weekly | Security vulnerability scanning |
| **Dependency Review** | PR | Audit new/updated dependencies for known vulnerabilities |

---

## 🤝 Contributing

Contributions make the open-source community an amazing place to learn, inspire, and create. Any contributions to HyroxTracker are **greatly appreciated**.

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Verify your tests strictly (`pnpm check` & `pnpm test`).
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request.

---

## 📄 License
This project is licensed under the MIT License.
