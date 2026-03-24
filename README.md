<div align="center">
  <h1>🏃‍♂️ HyroxTracker (Companion App)</h1>
  <p><strong>A fully responsive, AI-powered specialized training planner and analytics suite built exclusively for <a href="https://hyrox.com/" target="_blank">Hyrox</a> athletes.</strong></p>
  
  <p>
    <a href="#features">Features</a> •
    <a href="#architecture--tech-stack">Tech Stack</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#testing--code-quality">Testing</a> •
    <a href="#license">License</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React">
    <img src="https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
    <img src="https://img.shields.io/badge/Vitest-500%2B_Tests-729B1B?style=flat-square&logo=vitest&logoColor=white" alt="Vitest">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License">
  </p>
</div>

---

<br />

Plan structured training programs, log complex workouts with voice or free-text using Gemini LLMs to parse sets & reps, automatically sync activities from Strava, and get real-time prescriptive AI coaching to adjust your volume based on your completed results.

## 🌟 Capabilities Deep-Dive

### 📅 Unified Training Experience

- **Interactive Timeline**: A drag-and-drop integrated view spanning past performance, today's focus, and future planned workouts. Visually distinguish between completed, planned, and missed workouts.
- **Hyrox Plans**: Automatically import customized CSV training blocks or utilize the built-in 8-week rigorous Hyrox program out-of-the-box.
- **Custom Exercises**: Log non-standard movements (e.g., custom sled pushes or sandbag lunges) natively alongside your core lifts.

### 🤖 Google Gemini AI Engine

- **Intelligent Workout Parsing**: No more tapping dropdowns. Simply say or type: _"Did 3 sets of bench pressing at 225lbs for 8 reps, then ran 3 miles in 24 minutes"_. The Gemini Vision & Language API parses the raw text into structured database elements instantly using enforced Zod JSON schemas.
- **Real-time Auto-Coach**: The AI continuously reads your active plan's goal and your recent timeline. It evaluates fatigue, volume, and pacing, and provides actionable adjustments to your upcoming schedule automatically.
- **Streaming Live Chat**: Interact directly with your Coach over a fast Server-Sent Events (SSE) stream for contextual questions like _"What pace should I aim for on my next 1km run based on yesterday's track session?"_

### 🚴 Strava Integration

- **Zero-Friction Sync**: Link your primary Strava account using secure OAuth 2.0 flows. `HyroxTracker` listens to activity updates and automatically mounts them onto your timeline as completed workouts, decrypting access tokens locally on the fly.

### 📊 Meaningful Analytics

- **Personal Records**: Automatically detects and graphs 1RM estimation progressions and lifetime PRs natively.
- **Advanced Filtering**: Drill down into performance by exercise categories, dates, or particular micro-cycles.
- **Notification Loops**: Fully backgrounded cron jobs leverage Resend to email you weekly training summaries or gentle reminders for missed days.

---

## 🏗 Architecture & Tech Stack

This repository is a fully functional monorepo containing both the React frontend and the Express REST API backend written entirely in strictly typed **TypeScript**.

### Frontend

- **Libraries**: React 18, Vite, TypeScript, Framer Motion (for fluid micro-animations).
- **Styling**: Tailwind CSS layered perfectly over `shadcn/ui` (accessible Radix primitives).
- **State Management**: Highly optimized caching via TanStack Query (React Query).
- **Client Routing**: `wouter` for ultra-lightweight and fast navigation.

### Backend Network Layer

- **API Runtime**: Node.js & Express API, utilizing thin Controller wrappers and thick Service abstractions.
- **Database**: PostgreSQL bridged by the incredibly type-safe **Drizzle ORM**.
- **Security Protocols**:
  - Secure Clerk Middleware protecting protected endpoints via JWT.
  - Granular API route rate-limiting via isolated `express-rate-limit` dynamic caches to eliminate abuse.
  - Strava OAuth CSRF State Verification tokens.

---

## 🚀 Getting Started

Follow these instructions to run the full application ecosystem locally on your machine.

### Prerequisites

- [Node.js](https://nodejs.org/) (v22 or higher)
- [PostgreSQL](https://www.postgresql.org/download/) Database (Running locally on port 5432, or a hosted cloud instance)
- A [Clerk.dev](https://clerk.dev/) account for Auth
- A [Google AI Studio](https://aistudio.google.com/) account for the Gemini API key

### 1. Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

At minimum, set the two **required** variables:

- `DATABASE_URL` – PostgreSQL connection string
- `ENCRYPTION_KEY` – 32+ char hex key (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

See `.env.example` for all available configuration options including Clerk auth, Gemini AI, Strava sync, and more.

### 2. Installation & Database Setup

Install the necessary package dependencies and execute the Drizzle ORM schema migrations to structure your Postgres database.

```bash
# Install node dependencies
npm install

# Push the Drizzle schema constraints directly to the database
npm run db:push
```

### 3. Start the Application

Boot up the concurrent development server. This fires up the Vite frontend on HMR (Hot-Module-Reloading) and the backend Express server proxying internally onto port `5000`.

```bash
npm run dev
```

Visit `http://localhost:5000` in your browser.

---

## 🧪 Testing & Code Quality

The repository guarantees extreme stability by prioritizing testing layers at all mutation points.

- **Fast Unit Tests (`vitest`)**: Over 500 strict assertions test the AI retry boundaries, functional calculations (streak aggregators, workout spreaders), decoupled Rate-Limiting mock state clearing, and schema validations.
  - Run via: `npm test` or `npm run test:watch`
- **End-to-End Visual Tests (`cypress`)**: Cypress tests run headless browser sessions mimicking real user flows from Authentication redirects through to drag-and-drop timeline alterations.
  - Run via: `npx cypress open`
- **TypeScript Compiler**: Static safety enforced globally.
  - Run via: `npm run check`
- **CI/CD (`.github/workflows`)**: Every branch triggers intensive GitHub Actions evaluating Trivy security configurations, SonarCloud cognitive complexity drops, and raw build outputs.

---

## 🤝 Contributing

Contributions make the open-source community an amazing place to learn, inspire, and create. Any contributions to `HyroxTracker` are **greatly appreciated**.

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Verify your tests strictly (`npm run check` & `npm test`).
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
