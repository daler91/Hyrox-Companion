# HyroxTracker

## Overview

HyroxTracker is a training planning and logging application for Hyrox athletes. Hyrox is a fitness competition combining running with functional workout stations (SkiErg, sled push/pull, burpees, rowing, farmers carry, and wall balls). The app allows users to:

- Log and track workouts with specific Hyrox exercises
- Upload and manage training plans via CSV files
- View training history and weekly summaries
- Chat with an AI coach powered by Google Gemini for training advice
- Customize preferences and settings

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

The frontend follows a page-based architecture with reusable components. Pages include Dashboard, LogWorkout, Plan, History, Chat, and Settings. Custom components handle Hyrox-specific UI elements like exercise selectors, workout cards, and metric displays.

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api` prefix
- **Build**: esbuild for production bundling with selective dependency bundling

The server handles API routes for training plans, plan days, and AI chat interactions. Static files are served from the built client in production, with Vite dev server middleware in development.

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Current Implementation**: In-memory storage (`MemStorage` class) with interface ready for database migration
- **Schema Design**: Users, TrainingPlans, and PlanDays tables with relationships

The storage layer uses an interface pattern (`IStorage`) allowing easy swap between in-memory and database implementations.

### AI Integration
- **Provider**: Google Gemini API via `@google/genai` SDK
- **Model**: gemini-2.5-flash
- **Use Case**: AI training coach that provides Hyrox-specific advice, workout analysis, and pacing strategies
- **Implementation**: Server-side chat function with conversation history support

## External Dependencies

### Third-Party Services
- **Google Gemini API**: AI coach functionality requiring `GEMINI_API_KEY` environment variable
- **PostgreSQL**: Database backend requiring `DATABASE_URL` environment variable

### Key Libraries
- **UI Framework**: Radix UI primitives (accordion, dialog, dropdown-menu, tabs, etc.)
- **Forms**: react-hook-form with zod validation via @hookform/resolvers
- **Data Fetching**: @tanstack/react-query
- **Date Handling**: date-fns
- **Database**: drizzle-orm, drizzle-zod, pg (PostgreSQL client)
- **Session Management**: express-session with connect-pg-simple for PostgreSQL session store

### Development Tools
- **Type Checking**: TypeScript with strict mode
- **CSS Processing**: PostCSS with Tailwind CSS and autoprefixer
- **Database Migrations**: drizzle-kit for schema migrations