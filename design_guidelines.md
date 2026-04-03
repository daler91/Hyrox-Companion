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

**Heading Font**: Space Grotesk - bold, modern geometric sans-serif for headings
**Body Font**: Geist - clean, readable at all sizes for body text
**Mono Font**: Geist Mono - for metrics, numbers, and code

**Hierarchy**:
- H1 (Page Titles): text-4xl font-bold tracking-tight
- H2 (Section Headers): text-2xl font-semibold
- H3 (Card Titles): text-lg font-semibold
- Body Text: text-base font-normal
- Metrics/Numbers: text-3xl font-mono font-bold
- Labels: text-sm font-medium uppercase tracking-wide
- Timestamps: text-xs font-normal

---

## Layout & Spacing System

**Tailwind Units**: Primary spacing with 4, 6, 8, 12, 16, 24
- Component padding: p-6
- Card spacing: space-y-4
- Section gaps: gap-8
- Page margins: px-4 md:px-8
- Container max-width: max-w-7xl

**Grid System**:
- Dashboard: 3-column grid (lg:grid-cols-3) for metric cards
- Workout List: Single column on mobile, 2-column on desktop (md:grid-cols-2)
- Analytics: Responsive charts with full-width containers

---

## Component Library

**UI Framework**: shadcn/ui (Radix UI primitives) with Tailwind CSS and class-variance-authority (CVA)

### Navigation
**Sidebar Navigation**:
- Persistent sidebar on desktop (16rem width, 3rem icon mode)
- Collapses to icon-only on mobile with hamburger trigger
- Navigation items: Training (timeline), Log Workout, Analytics, Settings
- Mobile: Sticky top header with breadcrumb navigation
- User profile display with avatar in sidebar footer
- Theme toggle and logout in footer

### Theme System
- **Dark Mode**: Full support with class-based toggle
- **Storage**: Persisted to localStorage, falls back to OS preference
- **CSS Variables**: 36+ theme variables for light/dark modes
- **Elevation System**: Custom `--elevate-1` and `--elevate-2` for hover/active states

### Workout Cards
**Timeline Workout Cards**:
- Icon + Exercise name with category color coding
- Status indicators (completed, planned, missed, skipped)
- Compact form layout with inline labels
- Drag-and-drop reordering via dnd-kit

**Exercise Input Cards**:
- Input fields for sets/reps/weight/time/distance (dynamic per exercise type)
- AI parsing confidence shown as color-coded badges (green 80+, yellow 60-80, red <60)
- Missing field warnings with yellow alert boxes

### Training Log

**Log Entry Form** (3 input modes):
- **Voice Input**: Web Speech API with Gemini AI parsing
- **Text Input**: Free-form text parsed by Gemini
- **Form Mode**: Structured exercise entry with drag-and-drop ordering
- Exercise autocomplete (200+ base exercises + custom)
- Set/rep/weight/distance/time tracking
- RPE selector and notes field

**Training Timeline**:
- Vertical timeline with workout cards and date grouping
- Drag-and-drop workout reordering
- Filters by status (completed, planned, missed, skipped)
- Import training plans (CSV/PDF/DOCX)
- Inline workout detail dialog with edit mode
- Floating action button for quick workout logging

### AI Coach Interface

**Coach Panel** (slide-out sheet overlay):
- Streaming chat via Server-Sent Events
- Auto-suggestions based on plan and recent performance
- RAG-powered responses from uploaded coaching materials
- Coach personality customization
- Message bubbles: User right-aligned, AI left-aligned
- Input: Fixed bottom with rounded border

### Analytics Dashboard
- Personal Records tab (1RM estimation, max weight/distance, best time)
- Exercise Progression Charts (line, bar, heatmap via Recharts)
- Training Overview (weekly volume, frequency, intensity)
- Category Breakdown (strength, conditioning, running, mobility, functional)
- Advanced filtering by date range and exercise

### Data Visualization

**Progress Charts** (Recharts):
- Line chart for performance over time
- Y-axis: metric values, X-axis: dates
- Multiple series with legend
- Tooltip on hover showing exact values
- ResponsiveContainer for all chart sizes

**Workout Heatmap**:
- Calendar grid showing training frequency
- Intensity indicated by visual weight

### Forms & Inputs

**Input Fields**:
- Tailwind + Radix primitives via shadcn/ui
- Border: border-2 on focus
- Height: h-12
- Rounded: rounded-lg
- Error states with message below

**Button Styles** (CVA variants):
- Primary CTA: default variant, rounded-lg, font-semibold
- Secondary: outline variant
- Destructive: destructive variant for dangerous actions
- Icon buttons: icon variant (square)
- Size variants: sm, default, lg

---

## Page Layouts

### Training Timeline (/)
- Sidebar navigation (persistent on desktop)
- Timeline with date-grouped workout cards
- Filter bar for status filtering
- Floating action button (bottom-right) for quick log
- Coach panel overlay (slide-out sheet)
- Empty states: welcome wizard, import plan, generate plan

### Log Workout (/log)
- Mode selector (voice, text, form)
- Exercise blocks with drag-and-drop ordering
- AI-powered parsing for voice and text modes
- Exercise autocomplete and custom exercise support

### Analytics (/analytics)
- Tabbed interface (Personal Records, Progression, Overview)
- Responsive chart containers
- Date range and exercise filters
- Category breakdown cards

### Settings (/settings)
- Unit and notification preferences
- Coach personality settings
- Coaching materials upload (PDF/DOCX/CSV)
- Strava account linking/unlinking
- Email subscription management

---

## Interaction Patterns

**Minimal Animations**:
- Card hover: subtle elevation shift (custom `hover-elevate` utility)
- Dialog entrance: zoom + slide (200ms)
- Sheet transitions: slide (500ms open, 300ms close)
- Skeleton screens with `animate-pulse`
- Loading spinners with `animate-spin`
- Coach thinking indicator: 3-dot bounce with staggered delays

**Loading States**:
- Skeleton screens (TimelineSkeleton) for data-heavy views
- Spinner (Loader2 icon) for async operations
- Button disabled state with spinner overlay

**Empty States** (4 variants based on user context):
- Welcome state with onboarding CTAs
- Ready state for unscheduled plans
- No-results state for active filters
- General empty state

**Responsiveness**:
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Stack columns on mobile
- Collapsible sidebar navigation

**Error Handling**:
- FallbackErrorBoundary for full-page crashes
- FeatureErrorBoundary for isolated component failures
- Toast notifications (max 5, 5-second auto-dismiss, swipe-to-dismiss on mobile)

**Offline Support**:
- PWA with service worker caching (Workbox)
- Offline mutation queue with auto-flush on reconnect
- Visual offline indicator (bottom-left, WifiOff icon)

---

## Images

**Hero Image**: NOT NEEDED - This is a utility-focused app, not a marketing site

**Icon Library**: Lucide React
- Line style icons throughout the UI
- Consistent sizing with Tailwind classes

**Exercise Illustrations**: Category-based color coding and icons from Lucide
- Consistent size: w-12 h-12 or w-16 h-16 for larger contexts
