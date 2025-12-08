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

**Primary Font**: Inter (Google Fonts) - clean, readable at all sizes
**Secondary Font**: Roboto Mono - for metrics and numbers

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
- Calendar View: 7-column grid for weekly planning

---

## Component Library

### Navigation
**Top Navigation Bar**:
- Fixed header with logo left, main nav center, profile right
- Navigation items: Dashboard, Plan, Log, History, Chat
- Mobile: Hamburger menu with slide-out drawer
- Height: h-16
- Shadow: shadow-sm

### Dashboard Cards
**Metric Cards** (3-column grid):
- Large number display with label
- Trend indicator (up/down arrow)
- Rounded corners: rounded-xl
- Padding: p-6
- Border: border border-gray-200

**Weekly Summary Card**:
- Full-width card showing 7-day overview
- Mini bar chart for daily volume
- Quick stats row at bottom

### Workout Planning

**Workout Builder**:
- Left panel: Exercise selection (searchable list)
- Center: Workout structure (drag-drop zones)
- Right panel: Exercise details and notes
- Exercise categories: Running, SkiErg, Sled Push/Pull, Burpees, Rowing, Farmers Carry, Wall Balls

**Exercise Cards**:
- Icon + Exercise name
- Input fields for sets/reps/weight/time/distance
- Compact form layout with inline labels
- Border-l-4 for exercise type color coding

### Training Log

**Log Entry Form**:
- Date/time picker at top
- Workout type selector (buttons group)
- Expandable sections for each Hyrox station
- Large "Save Workout" button at bottom
- Quick entry shortcuts for common workouts

**History Timeline**:
- Vertical timeline with workout cards
- Each card shows: date, duration, key metrics, completion status
- Filters: Date range, exercise type, workout type
- Hover reveals quick actions (edit, delete, duplicate)

### Chatbot Interface

**Chat Panel** (can be sidebar or full-screen modal):
- Message bubbles: User right-aligned, AI left-aligned
- AI responses include data visualizations when relevant
- Quick question chips above input ("Analyze my running", "Show weekly volume", "Compare to last month")
- Input: Fixed bottom with rounded-full border
- Message padding: p-4
- Avatar icons for both user and AI

**Embedded Charts in Chat**:
- Line graphs for progress trends
- Bar charts for workout volume
- Compact design: max height h-64
- Inline with conversation flow

### Data Visualization

**Progress Charts**:
- Line chart for performance over time
- Y-axis: metric values, X-axis: dates
- Multiple series with legend
- Tooltip on hover showing exact values
- Min height: h-80

**Workout Heatmap**:
- Calendar grid showing training frequency
- Intensity indicated by visual weight
- Click date to see details

### Forms & Inputs

**Input Fields**:
- Floating labels
- Border: border-2 on focus
- Height: h-12
- Rounded: rounded-lg
- Error states with message below

**Button Styles**:
- Primary CTA: Large, rounded-lg, px-8 py-3, font-semibold
- Secondary: Outlined variant
- Icon buttons: Square (w-10 h-10), rounded-lg
- Button groups for multi-choice (toggle buttons)

**Number Steppers** (for weights/reps):
- Inline +/- buttons flanking number display
- Large touch targets: min-w-12 h-12

---

## Page Layouts

### Dashboard
- Header with greeting and current week
- 3-column metrics row (Total Volume, Workouts This Week, Personal Bests)
- Weekly summary card (full width)
- Recent workouts list (2-column on desktop)
- Chat shortcut floating action button (bottom-right)

### Planner
- Calendar view (primary)
- List view (alternative toggle)
- Right sidebar: Workout template library
- Drag workouts from library to calendar
- Click day to create/edit workout

### Logger
- Quick log form (centered, max-w-2xl)
- Previous workout reference (collapsible sidebar)
- Timer integration for live logging
- Exercise auto-complete

### History
- Filter bar at top
- Timeline view (default)
- Grid view (toggle)
- Stats summary card pinned at top
- Infinite scroll for older entries

### Chat
- Full-height layout (split-screen on desktop)
- Left: Training context panel (current week summary)
- Right: Chat interface
- Mobile: Full-screen chat with swipe-up drawer for context

---

## Interaction Patterns

**Minimal Animations**:
- Card hover: subtle lift (translate-y-1)
- Button press: scale-95 on active
- Page transitions: fade only
- NO complex scroll animations

**Loading States**:
- Skeleton screens for data-heavy views
- Spinner for quick actions
- Progress bar for uploads

**Responsiveness**:
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Stack columns on mobile
- Collapsible sidebars

---

## Images

**Hero Image**: NOT NEEDED - This is a utility-focused app, not a marketing site

**Icon Library**: Heroicons (via CDN)
- Line style for navigation and general UI
- Solid style for active states and primary actions

**Exercise Illustrations**: Use placeholder comments for custom Hyrox station icons
- `<!-- CUSTOM ICON: SkiErg -->`
- `<!-- CUSTOM ICON: Sled Push -->`
- Consistent size: w-12 h-12 or w-16 h-16 for larger contexts