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
- **Filtering & Search**: Filter timeline by status (all, planned, completed)

The design follows premium fitness app patterns (Strava, TrainingPeaks, Whoop) with focus on data clarity and athletic performance tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Build Tool**: Vite with React plugin

The frontend follows a streamlined page-based architecture:
- **Landing**: Public page for unauthenticated users with login CTAs
- **Coach** (home): AI chat interface with integrated training stats - the primary user interaction point
- **Timeline**: Unified chronological view for training plan import, scheduling, editing, and status tracking
- **Log Workout**: Manual workout entry form
- **Settings**: User preferences and theme toggle

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api` prefix with authentication middleware
- **Authentication**: Replit Auth (OIDC) with PostgreSQL session storage
- **Build**: esbuild for production bundling with selective dependency bundling

The server handles API routes for training plans, plan days, workout logs, and AI chat interactions. All data routes require authentication and filter by userId for privacy. Static files are served from the built client in production, with Vite dev server middleware in development.

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Current Implementation**: PostgreSQL database with `DatabaseStorage` class
- **Schema Design**: 
  - Users table with Replit Auth profile data
  - Sessions table for session management
  - TrainingPlans, PlanDays, and WorkoutLogs tables - all linked to userId
  - PlanDays include scheduledDate and status (planned, completed, missed, skipped)
  - Timeline is aggregated from scheduled plan days and workout logs, filtered by user

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
- **Model**: gemini-2.5-flash
- **Use Case**: AI training coach that provides Hyrox-specific advice, workout analysis, and pacing strategies
- **Implementation**: Server-side chat function with conversation history and personalized training context
- **Training Context**: AI receives user's workout stats, completion rate, streak, exercise breakdown, and recent workouts

## External Dependencies

### Third-Party Services
- **Google Gemini API**: AI coach functionality requiring `GEMINI_API_KEY` environment variable
- **PostgreSQL**: Database backend requiring `DATABASE_URL` environment variable
- **Replit Auth**: OIDC authentication via `ISSUER_URL` (defaults to Replit)

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
