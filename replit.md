# HyroxTracker

## Overview

HyroxTracker is a training planning and logging application designed for Hyrox athletes. It enables users to plan, track, and analyze their training for the Hyrox competition, which combines running with functional workout stations. The application aims to provide a unified timeline of past, current, and future training, leverage AI for coaching and workout suggestions, and offer robust workout tracking capabilities including PR detection and free-text exercise parsing. The project's vision is to be a premium fitness app focusing on data clarity and athletic performance tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with React and TypeScript, utilizing Wouter for client-side routing and TanStack React Query for server state management. Styling is handled by Tailwind CSS with CSS variables for theming, and UI components are derived from shadcn/ui, based on Radix UI primitives. Vite serves as the build tool. The application features a streamlined, page-based architecture including a public Landing page, a unified Timeline for training management and AI coaching, a Log Workout form, Analytics for performance tracking, and Settings for user preferences. The Timeline is the core experience, integrating AI coaching, plan management, and workout actions.

### Backend Architecture
The backend is a Node.js Express application written in TypeScript with ESM modules. It provides RESTful endpoints under the `/api` prefix, secured with authentication middleware. Replit Auth (OIDC) is used for authentication, with PostgreSQL storing session data. Routes are organized into domain-based modules (e.g., `ai`, `analytics`, `workouts`, `plans`, `auth`, `preferences`, `email`). Shared utilities, types, AI prompt constants, and maintenance scripts are structured for modularity. Service modules are extracted for export, analytics, and Strava mapping.

### Data Storage
Drizzle ORM with PostgreSQL is used for data persistence. The schema, shared between client and server, includes tables for Users, Sessions, TrainingPlans, PlanDays, WorkoutLogs, ExerciseSets, and CustomExercises. Foreign key constraints ensure data integrity, and user-scoped indexes optimize query performance. An `IStorage` interface pattern enforces data isolation per user.

### Authentication
Replit Auth, an OpenID Connect provider, handles user authentication. Session data is stored in PostgreSQL using `connect-pg-simple`.

### AI Integration
The Google Gemini API (gemini-3-flash-preview model) powers the AI features. This includes an AI training coach that provides Hyrox-specific advice, workout analysis, and pacing strategies, as well as AI text-to-exercise parsing for converting free-text workout descriptions into structured data. The AI also benefits from custom exercise recognition based on user-saved names. The server-side implementation manages conversation history and provides personalized training context to the AI, including user stats and recent workout data.

AI response robustness (`server/gemini.ts`):
- **JSON mode**: `responseMimeType: "application/json"` on suggestion and exercise-parse calls ensures Gemini returns raw JSON (no markdown fences or preamble)
- **Zod validation**: Parsed AI responses are validated with Zod schemas (`workoutSuggestionSchema`, `parsedExerciseSchema`) — malformed items are logged and dropped (suggestions) or throw with clear messages (exercises)
- **Retry with backoff**: Transient failures (429 rate limit, 500/503 server errors, network errors) retry up to 2 times with exponential backoff (1s, 2s); non-retryable errors fail immediately
- **Error logging**: Parse failures log truncated raw response text; Zod failures log validation issues and raw data for debugging

## External Dependencies

### Third-Party Services
- **Google Gemini API**: Used for AI coaching and exercise parsing.
- **PostgreSQL**: The primary database backend.
- **Replit Auth**: Provides OpenID Connect authentication.
- **Sentry.io**: For error monitoring in both frontend and backend.

### Key Libraries
- **UI Framework**: Radix UI primitives.
- **Forms**: `react-hook-form` with `zod` validation.
- **Data Fetching**: `@tanstack/react-query`.
- **Date Handling**: `date-fns`.
- **Database**: `drizzle-orm`, `drizzle-zod`, `pg`.
- **Session Management**: `express-session`, `connect-pg-simple`.
- **Auth**: `openid-client`, `passport`.

### Development Tools
- **Type Checking**: TypeScript.
- **CSS Processing**: PostCSS with Tailwind CSS.
- **Database Migrations**: `drizzle-kit`.
- **E2E Testing**: Cypress.io with Cypress Cloud integration.