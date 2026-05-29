# AI Coach Auto-Regulation Flow

[Back to README](../README.md)

This document shows how the auto-coach updates workouts after new training evidence arrives. The current flow has two decision layers:

- **Load governor:** deterministic UTSS, ACWR, and biomechanical-overlap rules.
- **Provider coach:** AI-generated suggestions and review notes using the same training context, RAG materials, and training-style prompt rules.

The load governor runs first. If it modifies an upcoming workout, provider suggestions for that same workout are filtered out so deterministic safety edits are not overwritten by the model.

---

## End-To-End Flow

```mermaid
flowchart TD
    A["User logs workout or moves scheduled workout"] --> B["Server writes workout or plan-day date change"]
    B --> C["Queue auto-coach job<br/>pg-boss: auto-coach<br/>singleton per user for 60s"]
    C --> D["triggerAutoCoach(userId)<br/>server/services/coachService.ts"]

    D --> E{"AI coach enabled?"}
    E -- "No" --> Z1["Return adjusted: 0"]
    E -- "Yes" --> F{"AI budget allowed?"}
    F -- "No" --> Z2["Skip background coaching"]
    F -- "Yes" --> G["Set users.isAutoCoaching = true"]

    G --> H["buildTrainingContext(userId)<br/>server/services/ai/index.ts"]
    H --> I["Build upcoming workout inputs<br/>next 7 planned days"]
    I --> NU{"Any upcoming planned workouts?"}
    NU -- "No" --> Z3["Return adjusted: 0"]
    NU -- "Yes" --> J["Resolve training style<br/>and retrieve RAG coaching materials"]
    J --> J2["Build CoachNoteInputs audit metadata"]
    J2 --> K["Analyze safety signals"]

    K --> L["Build deterministic load-governor suggestions<br/>buildLoadGovernorSuggestions(...)"]
    L --> M["Collect workout IDs modified by governor"]

    M --> N["Generate provider workout suggestions<br/>Gemini / configured text provider"]
    N --> O["Apply safety layer and repeat-suppression filters"]
    O --> P["Drop provider suggestions for governor-modified workouts"]

    P --> Q["Prepare structured suggestions<br/>parse rows when workout has exercise table"]
    Q --> R["Merge governor suggestions first, then provider suggestions"]
    R --> S["Generate review notes for unchanged workouts"]
    S --> T["Apply all changes in DB transaction"]

    T --> U{"Workout has structured exercise rows?"}
    U -- "Yes" --> V["Replace or append exercise_sets rows<br/>table-first write"]
    U -- "No" --> W["Update plan_days mainWorkout/accessory/notes text"]

    V --> X["Persist aiSource, aiRationale, aiInputsUsed"]
    W --> X
    X --> Y["Timeline shows coach note, source badge, and input chips"]
    Y --> AA["Finally reset users.isAutoCoaching = false"]
    Z1 --> AA
    Z2 --> AA
    Z3 --> AA
```

---

## Training Context Inputs

`buildTrainingContext` is the shared context builder used by auto-coach suggestions, review notes, and coach-facing prompt flows.

```mermaid
flowchart LR
    subgraph DB["Database and Storage Reads"]
        T1["timeline.getTimeline(userId)"]
        T2["plans.getActivePlan(userId)"]
        T3["users.getUser(userId)"]
        T4["timeline.getUpcomingPlannedDays(userId, 7)"]
        T5["analytics.getWorkoutLogsByDateRange(userId, last 70 days)"]
        T6["analytics.getAllExerciseSetsWithDates(userId, last 70 days)"]
        T7["analytics.getExerciseLoadTags()"]
    end

    subgraph Derived["Derived Coaching Signals"]
        D1["Recent workouts"]
        D2["Structured exercise stats"]
        D3["RPE trend and fatigue flag"]
        D4["Station gaps"]
        D5["Plan phase"]
        D6["Weekly volume trend"]
        D7["Progression flags"]
        D8["Training state decision tree"]
        D9["Load governor overview<br/>UTSS, ACWR, restrictions"]
    end

    subgraph Context["TrainingContext"]
        C1["Athlete totals and adherence"]
        C2["Active plan and goal"]
        C3["Upcoming planned workouts"]
        C4["Recent completed workouts"]
        C5["Structured exercise rows"]
        C6["coachingInsights"]
    end

    T1 --> D1
    T1 --> D2
    T1 --> D3
    T1 --> D4
    T1 --> D7
    T2 --> D5
    T3 --> D6
    T3 --> D8
    T4 --> C3
    T5 --> D9
    T6 --> D9
    T7 --> D9

    D1 --> C4
    D2 --> C5
    D3 --> C6
    D4 --> C6
    D5 --> C6
    D6 --> C6
    D7 --> C6
    D8 --> C6
    D9 --> C6

    T1 --> C1
    T2 --> C2
```

---

## Load Governor Decision Flow

The mechanical governor converts completed training history into a unified load model, then turns active restrictions into deterministic edits.

```mermaid
flowchart TD
    A["70-day workout_logs + exercise_sets"] --> B["Normalize exercise tags<br/>exercise_load_tags + defaults"]

    B --> C["Calculate strength stress score<br/>SSS = tonnage * RPE factor * exercise modifiers"]
    B --> D["Calculate cardio stress score<br/>CSS = duration * inferred intensity"]

    C --> E["Daily UTSS<br/>SSS + CSS"]
    D --> E

    E --> F["Vector loads per day"]
    F --> F1["posterior_chain"]
    F --> F2["anterior_chain"]
    F --> F3["unilateral_stability"]
    F --> F4["elastic_tendon"]

    E --> G["ACWR<br/>7-day acute avg / 28-day chronic avg"]
    G --> H{"ACWR zone"}
    H -- "< 0.8" --> H1["Undertraining<br/>3-day on-ramp"]
    H -- "0.8 to 1.3" --> H2["Sweet spot<br/>no governor edit"]
    H -- "1.3 to 1.5" --> H3["Yellow load<br/>2-day soft downshift"]
    H -- "> 1.5" --> H4["Danger<br/>4-day intensity lock"]

    F1 --> I1{"High posterior load<br/>last 1 calendar day?"}
    I1 -- "Yes" --> R1["posterior_chain_velocity_lock<br/>block hills, sprints, high-velocity intervals"]

    F2 --> I2{"High anterior load<br/>last 2 calendar days?"}
    I2 -- "Yes" --> R2["anterior_chain_braking_guard<br/>downshift downhill, long-road, braking-heavy runs"]

    F4 --> I3{"Elastic tendon total high<br/>rolling 7 calendar days?"}
    I3 -- "Yes" --> R3["elastic_tendon_speed_guard<br/>downshift speed, track, plyometrics"]

    H1 --> R4["acwr_onramp"]
    H3 --> R5["acwr_yellow_guard<br/>soften near-term high-intensity work"]
    H4 --> R6["acwr_danger_lock"]

    R1 --> S["Scan upcoming workouts"]
    R2 --> S
    R3 --> S
    R4 --> S
    R5 --> S
    R6 --> S

    S --> T{"Upcoming session conflicts<br/>with active restriction?"}
    T -- "No" --> U["No deterministic edit"]
    T -- "Yes" --> V["Build load-governor suggestion"]
    V --> W["Replace with flat, low-intensity aerobic work<br/>preserve time or distance when available"]
    W --> X["aiSource = load_governor<br/>aiRationale explains why"]
```

---

## Write Path And User Visibility

```mermaid
sequenceDiagram
    participant Job as Auto-coach job
    participant Coach as coachService
    participant LG as trainingLoadGovernor
    participant Provider as Text AI provider
    participant DB as PostgreSQL
    participant UI as Timeline card

    Job->>Coach: triggerAutoCoach(userId)
    Coach->>LG: buildLoadGovernorSuggestions(loadGovernor, upcomingWorkouts)
    LG-->>Coach: deterministic suggestions first
    Coach->>Provider: generateWorkoutSuggestions(trainingContext, upcomingWorkouts)
    Provider-->>Coach: provider suggestions
    Coach->>Coach: filter provider suggestions for governor-modified days
    Coach->>DB: transaction begins
    alt load-governor suggestion and structured rows exist
        Coach->>DB: replace exercise_sets rows
        Coach->>DB: update plan_days AI metadata
    else provider suggestion and structured parse succeeds
        Coach->>DB: replace or append exercise_sets rows
        Coach->>DB: update plan_days AI metadata
    else text-only workout or provider structured parse unavailable
        Coach->>DB: update plan_days text field
        Coach->>DB: update plan_days AI metadata
    end
    Coach->>DB: write review notes for unchanged days
    Coach->>DB: transaction commits
    DB-->>UI: timeline reload/poll returns updated plan day
    UI-->>UI: show source badge, rationale, and input chips
```

---

## Source Map

| Area | Primary files |
| --- | --- |
| Auto-coach job worker | `server/queue.ts` |
| Workout creation trigger | `server/services/workoutService/workouts.ts` |
| Reschedule trigger | `server/services/planService.ts` |
| Auto-coach orchestration | `server/services/coachService.ts` |
| Shared training context | `server/services/ai/index.ts`, `server/gemini/types.ts` |
| Provider suggestion prompt | `server/gemini/suggestionService.ts` |
| Deterministic load math + ACWR/restrictions | `server/services/trainingLoadService.ts` |
| Load-governor suggestion builder (`buildLoadGovernorSuggestions`) | `server/services/trainingLoadGovernor.ts` |
| Exercise load tag schema | `shared/schema/tables.ts`, `migrations/0049_exercise_load_tags.sql` |
| Coach-note metadata type | `shared/schema/types/plans.ts` |
| Timeline coach note UI | `client/src/components/timeline/timeline-workout-card/CoachNote.tsx` |
| Training overview load chart | `client/src/components/analytics/training-overview/AcwrTrendChart.tsx` |

---

## Important Behavior Guarantees

- Governor suggestions are prepared before provider suggestions.
- Governor-modified workouts are excluded from provider modification output.
- Load-governor edits stay table-first on structured workouts; if a structured governor write cannot be prepared, it does not silently fall back to text.
- Provider suggestions prefer structured `exercise_sets` writes when rows exist, but can still use the existing text fallback when parsing structured rows is unavailable.
- Deterministic governor writes use `aiSource: "load_governor"`.
- ACWR yellow now creates a medium-priority, short-window soft downshift for high-intensity sessions instead of only surfacing passive metadata.
- The visible timeline note keeps the rationale and input audit metadata on `plan_days.aiRationale` and `plan_days.aiInputsUsed`.
- Users can still manually edit any downshifted workout afterward.
