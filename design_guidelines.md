# Hyrox Training Tool - Design Guidelines

## Design Approach
**System-Based Approach** inspired by premium fitness apps (Strava, TrainingPeaks, Whoop) with a focus on data clarity, athletic performance tracking, and seamless AI interaction.

## Core Design Principles
1. **Performance-First**: Clear data hierarchy prioritizing key metrics
2. **Athletic Professionalism**: Clean, focused interface that respects serious athletes
3. **Scannable Information**: Quick-read cards and data visualization
4. **Conversational Intelligence**: Natural chatbot integration within training context

---

## Typography System

**Heading Font**: Space Grotesk (`font-heading`) - bold, modern geometric sans-serif, used for the landing page headings and the fitai.coach wordmark. In-app headings carry no `font-heading` class and render in the body font
**Body Font**: Geist - clean, readable at all sizes for body text
**Mono Font**: Geist Mono - for the Race Predictor times, coach stat badges, keyboard hints and error details. Other metrics stay in the body font, often with `tabular-nums`

All three are self-hosted through `@fontsource` imports in `client/src/main.tsx`; the stacks are the `--font-*` variables in `client/src/index.css`.

**Hierarchy**:
- H1 (Page Titles): text-2xl font-bold tracking-tight, stepping up to text-3xl from `md` on Training and from `sm` on Log Workout. Settings is text-3xl at every width; Analytics (text-2xl font-bold), Weekly Review (text-2xl font-semibold) and Nutrition (text-xl font-semibold) are smaller
- H2 (Section Headers): text-2xl font-semibold (the `CardTitle` default, rendered with `as="h2"`)
- H3 (Card Titles): `CardTitle` renders an `h3` at text-2xl font-semibold leading-none tracking-tight; denser cards override the size to text-lg or text-base
- Body Text: text-base font-normal
- Metrics/Numbers: text-2xl font-bold on the analytics stat tiles; the Race Predictor headline time is text-4xl font-mono font-bold tabular-nums
- Labels: text-xs font-medium uppercase tracking-wide
- Timestamps: text-xs font-normal

---

## Layout & Spacing System

**Tailwind Units**: Primary spacing with 4, 6, 8, 12, 16, 24
- Component padding: p-6 (the `CardHeader` / `CardContent` default); dense cards such as the timeline workout card and the filter bar use p-4
- Card spacing: space-y-4
- Section gaps: space-y-6 between a page's sections (Training, Analytics, Settings); gap-8 appears only on the landing page
- Page margins: p-4 md:p-8, from `PageContainer` (`client/src/components/ui/PageContainer.tsx`)
- Container max-width: `PageContainer` sizes — max-w-5xl by default (Training, Analytics, Nutrition, Weekly Review), max-w-3xl for the Log Workout form, max-w-2xl for Settings

**Grid System**:
- Dashboard: the analytics stat tiles use grid-cols-2 md:grid-cols-3 lg:grid-cols-6
- Workout List: the timeline is a single column of date groups at every width; paired form fields and charts go two-up from `sm` (sm:grid-cols-2)
- Analytics: Responsive charts with full-width containers

---

## Component Library

**UI Framework**: shadcn/ui (Radix UI primitives) with Tailwind CSS and class-variance-authority (CVA)

### Navigation
**Sidebar Navigation**:
- Persistent sidebar on desktop (16rem width). It uses the sidebar primitive's default off-canvas mode, not the 3rem icon mode: Ctrl/Cmd+B hides or shows it, and the open state is kept in the `sidebar_state` cookie
- Below 768px the sidebar is a slide-in drawer (a `Sheet`), opened from the trigger in the sticky mobile header; tapping a nav item closes it
- Navigation items: Training (timeline), Log Workout, Nutrition (when the nutrition flag is on), Analytics, Settings — one list, `PRIMARY_NAV_ITEMS` in `client/src/lib/navItems.ts`. Weekly Review (`/review`) is not in the list; it is linked from Analytics
- Desktop: breadcrumb bar above the content on Log Workout, Analytics, Settings and the Privacy and Delete Account pages, and on Training while a workout is open (Nutrition and Weekly Review have none); phones get a bottom tab bar (`MobileTabBar`) with the same items instead
- User profile display with avatar in sidebar footer
- Theme toggle and logout in footer; logging out with offline changes still queued asks for confirmation first

### Theme System
- **Dark Mode**: Full support with class-based toggle
- **Storage**: Persisted to localStorage, falls back to OS preference
- **CSS Variables**: 38 HSL colour tokens, each defined for light (`:root`) and dark (`.dark`), plus elevation, outline, font, radius and shadow variables
- **Elevation System**: Custom `--elevate-1` and `--elevate-2` for hover/active states

### Workout Cards
**Timeline Workout Cards**:
- Session title, then one chip per exercise, color-coded by category (`categoryChipColors`); a trophy marks a chip that set a personal record
- Status indicators (completed, planned, missed, skipped)
- Compact layout (p-4); tapping the card opens the session, and a planned session carries a complete button
- Drag a card onto another day to move it (dnd-kit), or pick the date from the card's move menu

**Exercise Rows** (Log Workout confirm step and workout detail):
- Per-set fields for reps/weight/time/distance, chosen per exercise type
- Missing critical fields (e.g. weight and reps for strength) are reported as warnings when the workout is saved

**Completed-workout detail sheet** (`ReviewSurface`) is read-first — a finished session is mostly looked at, occasionally corrected:
- One stats card on top: headline numbers in a grid (label, value, unit set smaller), a toned status chip in words where a number is rated (adherence, MAF), and one quiet line of the recording's secondary metrics (pace/speed, cadence, power, relative effort). Nothing is printed twice on the sheet — RPE lives in its picker, calories in the stats
- Results rows start closed as one-line summaries; tapping opens the set editor. The description/scan/parse tools and the structure builder fold into one "Description & structure" line once rows exist
- Effort & notes stays open as its own card
- Supporting context (coach rationale, fuelling, session time, plan link, MAF test, counts-as-training) sits in one `DetailGroup` card as rows: each shows a one-line status when closed and opens in place
- A plan-linked session also shows its session grade card (`SessionGradeCard`) under the stats
- Footer is one sticky row: Ask coach (primary), Reopen (plan-linked sessions only), an icon-only Combine, and an icon-only Delete behind a confirm

### Training Log

**Log Entry Form** (a three-step stepper: Capture → Confirm → Reflect):
- **Capture**: a structured exercise list plus a collapsible "Description, voice, or photo" panel — free text, voice (Web Speech API) or a photo is parsed by the AI into the list. Text is parsed on "Parse into exercise table", or on Continue if it has not been parsed yet
- **Confirm**: review and correct the parsed rows before saving
- **Reflect**: RPE and notes
- Exercise autocomplete (200+ base exercises + custom)
- Set/rep/weight/distance/time tracking
- RPE selector and notes field

**Training Timeline**:
- Vertical timeline with workout cards and date grouping
- Drag-and-drop to move a workout to another day
- Filters by status (completed, planned, missed, skipped)
- Import training plans (CSV)
- Tapping a card opens a detail sheet for its state (`LogSheet`, `ReviewSurface`, `SkippedSheet`, `PreviewSheet`): a dialog on desktop, a bottom sheet on phones
- Two floating pill buttons, AI Coach and Log Workout; Log Workout opens the ad-hoc log sheet (`AdhocLogSheet`)

### AI Coach Interface

**Coach Panel** (a docked column beside the timeline on desktop, w-80 / lg:w-96; a full-screen dialog on phones):
- Streaming chat via Server-Sent Events
- Auto-suggestions based on plan and recent performance
- RAG-powered responses from uploaded coaching materials
- Message bubbles: User right-aligned, AI left-aligned
- Input: a textarea in the panel footer, under the quick-action chips

### Analytics Dashboard
- Tabs: Overview, Breakdown, PRs & Trends, Session Quality, Coach Insights, Race Predictor, plus MAF Trend for MAF-method athletes and Fuelling when the nutrition flag is on
- PRs & Trends holds two sub-tabs: Records (estimated 1RM, max weight, max distance, best time, with a category filter) and Progression (pick an exercise; bar or line charts via Recharts)
- Overview: stat tiles, training-load trend charts, a weekly workouts chart and the workout heatmap
- Breakdown: category split (strength, conditioning, running, functional) as a pie chart, and coverage grids
- Date range select (last 30 / 90 days, 6 months, year, all time), CSV / JSON export, and a link to the Weekly Review

### Data Visualization

**Progress Charts** (Recharts):
- Line chart for performance over time
- Y-axis: metric values, X-axis: dates
- Multiple series with legend (the legend is omitted for a single series)
- Tooltip on hover showing exact values
- ResponsiveContainer for all chart sizes

**Workout Heatmap**:
- Calendar grid of the last 16 weeks showing training frequency (a CSS grid, not a Recharts chart)
- Two states per day, "Workout logged" or "Rest day"; there is no intensity scale. Future days and days outside the selected range are drawn separately

### Forms & Inputs

**Input Fields**:
- Tailwind + Radix primitives via shadcn/ui
- Border: 1px `border-input`; focus adds a 2px ring (focus-visible:ring-2 with ring-offset-2), not a thicker border
- Height: h-11 (44px touch target) on phones, h-9 from `md`
- Rounded: rounded-md
- Error states with message below (`errorMessage` prop: destructive border, text-xs message with `role="alert"`)

**Button Styles** (CVA variants):
- Primary CTA: default variant, rounded-md, font-medium
- Secondary: outline variant; `secondary` and `ghost` variants also exist
- Destructive: destructive variant for dangerous actions
- Icon buttons: `size="icon"` (square: 44px on phones, 36px from `md`); `size="icon-touch"` stays 44px
- Size variants: sm, default, lg (min-heights 8 / 9 / 10)

---

## Page Layouts

### Training Timeline (/)
- Sidebar navigation (persistent on desktop)
- Timeline with date-grouped workout cards
- Filter bar: plan selector, status filter and a plan tools menu, in one row at every width
- Two floating pill buttons (bottom-right): AI Coach and Log Workout
- Coach panel: docked to the right of the timeline on desktop, a full-screen dialog on phones
- Empty states: a welcome card (generate an AI plan, use the sample plan, import a CSV), a "set start date" card for an unscheduled plan, and a no-results card for an active filter; the onboarding wizard opens over the page on first run

### Log Workout (/log)
- Capture → Confirm → Reflect stepper
- Exercise list filled from parsed text, voice or a photo
- Exercise autocomplete and custom exercise support

### Analytics (/analytics)
- Tabbed interface (Overview, Breakdown, PRs & Trends, Session Quality, Coach Insights, Race Predictor; MAF Trend and Fuelling when they apply)
- Responsive chart containers
- Date range select in the page header; category filter on Records and exercise select on Progression
- Category breakdown cards

### Nutrition (/nutrition, when the nutrition flag is on)
- Day header, food search and a quick-add bar
- Log actions: barcode scanner, describe a meal, custom food, recipe builder
- Micronutrient panel, My Foods and an insights panel; targets edited in dialogs

### Weekly Review (/review)
- One Monday-to-Sunday week: summary, highlights, intent and the week's sessions
- Reached from the Analytics header and the timeline's weekly review prompt, not from the primary navigation

### Settings (/settings)
- Six tabs: Account, Training, Integrations, Notifications, Data & Privacy, Recycle bin
- Account: profile, unit preferences, re-run the welcome flow, delete account
- Training: athlete profile and goals, training style, AI coach on/off, coaching materials upload (TXT/MD/CSV/PDF/DOCX)
- Integrations: Strava and Garmin account linking/unlinking
- Notifications: per-type email notifications with send hours, and push notifications

---

## Interaction Patterns

**Minimal Animations**:
- Card hover: a translucent tint over the card (custom `hover-elevate` utility, `--elevate-1`); on touch screens it shows while pressed instead
- Dialog entrance: fade + zoom + slide (200ms)
- Sheet transitions: slide (500ms open, 300ms close)
- Skeleton screens with `animate-pulse`
- Loading spinners with `animate-spin`
- Coach thinking indicator: 3-dot bounce with staggered delays (0 / 150 / 300ms)
- `prefers-reduced-motion: reduce` cuts every animation and transition to near-instant (`client/src/index.css`)

**Loading States**:
- Skeleton screen (TimelineSkeleton) for the timeline; other views show `LoadingSpinner`
- Spinner (Loader2 icon) for async operations
- A pending button is disabled and swaps its icon for the spinner

**Empty States** (3 timeline variants based on user context):
- Welcome state with onboarding CTAs
- Ready state for unscheduled plans
- No-results state for active filters

**Responsiveness**:
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px); `md` is where the sidebar replaces the phone tab bar
- Stack columns on mobile
- Sidebar becomes a drawer plus the bottom tab bar below `md`

**Error Handling**:
- FallbackErrorBoundary for full-page crashes
- FeatureErrorBoundary for isolated component failures
- Toast notifications (one at a time — `TOAST_LIMIT = 1` — with swipe-to-dismiss on mobile)

**Offline Support**:
- PWA with service worker caching (Workbox)
- Offline mutation queue with auto-flush on reconnect
- Status pill (`OfflineIndicator`): top-centre below the header on phones, bottom-left from `md`. It shows "You're offline" with the WifiOff icon, then syncing and synced states as the queue drains

---

## Images

**Hero Image**: NOT NEEDED - This is a utility-focused app. The signed-out landing page uses no photographs either; its hero is a mock of the Training Timeline

**Icon Library**: Lucide React
- Line style icons throughout the UI
- Consistent sizing with Tailwind classes

**Exercise Illustrations**: None. Exercises are shown by name, with category-based color coding on their chips (`categoryChipColors` in `client/src/lib/exerciseUtils.ts`)
- Standalone empty-state icons are h-10 w-10 on the analytics tabs and h-12 w-12 on the timeline
