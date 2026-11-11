package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The app end to end on the desktop JVM: the real screens, view models,
 * session and database, against a fake auth gateway and server.
 */
@OptIn(ExperimentalTestApi::class)
class AppUiTest {
    @Test
    fun signingInWithAnEmailCodeOpensTheTimeline() {
        val api = FakeApi().apply { establishedAccount() }
        appTest(FakeAuth(AuthState.SignedOut), api) { app ->
            onNodeWithContentDescription("email").performTextInput("athlete@example.com")
            onNodeWithText("email me a code").performClick()
            awaitNode(hasText("check your email"))
            assertEquals(listOf("athlete@example.com"), app.auth.codesSentTo.toList())

            onNodeWithContentDescription("code").performTextInput("123456")
            onNodeWithText("sign in").performClick()
            awaitNode(hasText("training"))
        }
    }

    @Test
    fun aNewAccountGetsSetupAndLeavingItMarksItDone() {
        val api = FakeApi().apply {
            privacyAcknowledged()
            preferences(onboarded = false)
            on("GET", "/api/v1/plans", "[]")
            on("GET", "/api/v1/timeline", "[]")
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("leave setup"))
            onNodeWithContentDescription("leave setup").performClick()
            onNodeWithText("Leave setup").performClick()

            // Back on the (empty) timeline, with setup recorded as done.
            awaitNode(hasText("Log a workout"))
            waitUntil(timeoutMillis = 10_000) {
                api.sent("PATCH", "/api/v1/preferences").any { it.body.orEmpty().contains("\"onboardingCompleted\":true") }
            }
        }
    }

    @Test
    fun completingTodaysSessionSendsTheWorkout() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("POST", "/api/v1/workouts", """{"id":"w1"}""", status = 201)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            openCard("Tempo intervals")
            awaitNode(hasText("Complete workout"))
            onNodeWithText("Complete workout").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/workouts").isNotEmpty() }
            assertTrue(api.sent("POST", "/api/v1/workouts").single().body.orEmpty().contains("\"planDayId\":\"d1\""))
        }
    }

    @Test
    fun aDeletedWorkoutComesBackWithUndo() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(
                """{"id":"log-w1","date":"$today","type":"logged","status":"completed",""" +
                    """"focus":"Leg day","mainWorkout":"","workoutLogId":"w1"}""",
            )
            on(
                "GET",
                "/api/v1/workouts/w1",
                """{"id":"w1","userId":"u1","date":"$today","focus":"Leg day","mainWorkout":"","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[],"structureBlocks":[]}""",
            )
            on("DELETE", "/api/v1/workouts/w1", """{"success":true,"recycleBinItemId":"rb1"}""")
            on("POST", "/api/v1/recycle-bin/rb1/restore", """{"ok":true,"entityType":"workout_log","entityId":"w1","warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Leg day"))
            openCard("Leg day")
            awaitNode(hasText("Delete workout"))
            onNodeWithText("Delete workout").performClick()
            onNodeWithText("Delete").performClick()

            // Back on the timeline, with the chance to take it back.
            awaitNode(hasText("Undo"))
            assertEquals(1, api.sent("DELETE", "/api/v1/workouts/w1").size)
            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/rb1/restore").isNotEmpty() }
        }
    }

    @Test
    fun aSessionMovesFromItsCardMenu() {
        val tomorrow = LocalDate.parse(FakeApi.today).plusDays(1).toString()
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("PATCH", "/api/v1/plans/days/d1", "{}")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Move Tempo intervals to another day"))
            onNodeWithContentDescription("Move Tempo intervals to another day").performClick()
            onNodeWithText("Move to tomorrow").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            assertTrue(api.sent("PATCH", "/api/v1/plans/days/d1").single().body.orEmpty().contains("\"scheduledDate\":\"$tomorrow\""))
        }
    }

    @Test
    fun aSkippedDayIsDeletedFromThePlanAndCanComeBack() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Long run").replace("\"status\":\"planned\"", "\"status\":\"skipped\""))
            on("DELETE", "/api/v1/plans/days/d1", """{"success":true,"recycleBinItemId":"rb1"}""")
            on("POST", "/api/v1/recycle-bin/rb1/restore", """{"ok":true,"entityType":"plan_day","entityId":"d1","warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            // The filter narrows to skipped sessions, and says when none match.
            awaitNode(hasText("Completed"))
            onNodeWithText("Completed").performClick()
            awaitNode(hasText("No completed workouts."))
            onNodeWithText("Skipped").performClick()

            openCard("Long run")
            onNodeWithText("Delete from plan").performClick()
            onNodeWithText("Delete").performClick()

            awaitNode(hasText("Undo"))
            assertEquals(1, api.sent("DELETE", "/api/v1/plans/days/d1").size)
            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/rb1/restore").isNotEmpty() }
        }
    }

    @Test
    fun aPlannedSessionIsEditedOnItsOwnScreen() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on(
                "GET",
                "/api/v1/plans/days/d1/sets",
                """[{"id":"s1","planDayId":"d1","exerciseName":"back_squat","category":"strength","setNumber":1,"reps":5,"version":1}]""",
            )
            on("PATCH", "/api/v1/plans/days/d1", "{}")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            openCard("Tempo intervals")
            onNodeWithText("Edit session").performClick()

            awaitNode(hasText("Back Squat"))
            onNodeWithContentDescription("Title").performTextReplacement("Track intervals")
            onNodeWithText("Save").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            assertTrue(api.sent("PATCH", "/api/v1/plans/days/d1").single().body.orEmpty().contains("\"focus\":\"Track intervals\""))
        }
    }

    @Test
    fun theLastWorkoutCanBeLoggedAgain() {
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/workouts/latest",
                """{"id":"w1","userId":"u1","date":"2026-11-01","focus":"Leg day","mainWorkout":"Squats","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":null,"structureBlocks":[],"exerciseSets":[""" +
                    """{"id":"s1","exerciseName":"back_squat","category":"strength","setNumber":1,"reps":5,"weight":100,"version":1}]}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Log Workout"))
            onNodeWithContentDescription("Log Workout").performClick()
            awaitNode(hasText("Duplicate last workout"))
            onNodeWithText("Duplicate last workout").performClick()

            awaitNode(hasText("Back Squat"))
            onNodeWithText("Confirm exercises").assertExists()
        }
    }

    @Test
    fun switchingToPoundsInSettingsSavesThePreference() {
        val api = FakeApi().apply {
            establishedAccount()
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"lbs"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Settings"))
            onNodeWithContentDescription("Settings").performClick()
            awaitNode(hasText("lbs"))
            onNodeWithText("lbs").performClick()

            waitUntil(timeoutMillis = 10_000) {
                api.sent("PATCH", "/api/v1/preferences").any { it.body.orEmpty().contains("\"weightUnit\":\"lbs\"") }
            }
        }
    }

    @Test
    fun aLinkFromANotificationOpensItsScreen() {
        val api = FakeApi().apply { establishedAccount() }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))

            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("nutrition"))
        }
    }

    @Test
    fun aTrainingNoteShowsOnItsDayAndAStravaImportLinksToTheSuggestedSession() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(
                FakeApi.plannedToday("Easy Run"),
                """{"id":"log-w9","date":"$today","type":"logged","status":"completed","focus":"Morning Run","mainWorkout":"",""" +
                    """"workoutLogId":"w9","source":"strava","stravaActivityId":"123","suggestedPlanDayId":"d1"}""",
            )
            on(
                "GET",
                "/api/v1/timeline-annotations",
                """[{"id":"a1","userId":"u1","startDate":"$today","endDate":"$today","type":"injury","note":"Calf strain"}]""",
            )
            on("POST", "/api/v1/workouts/w9/device-link", """{"id":"w9"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Calf strain"))
            awaitNode(hasText("Was this your Easy Run?"))
            onNodeWithText("Link").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/workouts/w9/device-link").isNotEmpty() }
            assertEquals("""{"planDayId":"d1"}""", api.sent("POST", "/api/v1/workouts/w9/device-link").single().body)
        }
    }

    @Test
    fun theCoachReviewingBannerShowsUntilTheReviewEnds() {
        val reviewing = """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"isAutoCoaching":true}"""
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("GET", "/api/v1/auth/user", reviewing)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Coach is reviewing your workout"))

            api.on("GET", "/api/v1/auth/user", reviewing.replace("\"isAutoCoaching\":true", "\"isAutoCoaching\":false"))
            waitUntil(timeoutMillis = 10_000) { onAllNodesWithText("Coach is reviewing your workout").fetchSemanticsNodes().isEmpty() }
        }
    }

    @Test
    fun aReviewLinkOpensTheWeekAndSavesNextWeeksLine() {
        val review = """{"weekStart":"2026-11-02","weekEnd":"2026-11-08","timezone":"UTC","isCurrentWeek":false,"weeklyGoal":4,""" +
            """"hasPlan":true,"current":{"sessionsLogged":3,"sessionsPlanned":4,"plannedCompleted":3,"missed":1,"skipped":0,""" +
            """"outstanding":0,"excused":0,"letGo":0,"totalDurationMin":150,"avgRpe":7},"previous":{"sessionsLogged":2,""" +
            """"sessionsPlanned":4,"plannedCompleted":2,"missed":2,"skipped":0,"outstanding":0,"excused":0,"letGo":0,""" +
            """"totalDurationMin":100,"avgRpe":null},"deltas":{"sessionsLogged":1,"totalDurationMin":50},""" +
            """"sessions":[{"workoutLogId":"w1","date":"2026-11-03","focus":"Hill repeats","durationMin":50,"rpe":8,""" +
            """"source":"manual","planDayId":null}],"plannedDays":[{"planDayId":"d4","date":"2026-11-06","focus":"Sled work",""" +
            """"status":"missed","excused":false}],"personalRecords":[],"annotations":[],"intent":null,"previousIntent":"Sleep more"}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/weekly-review", review)
            on("POST", "/api/v1/weekly-review/intent", """{"weekStart":"2026-11-02","intent":"Three runs"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Review("2026-11-05"))

            awaitNode(hasText("Nov 2–8, 2026"))
            assertTrue(api.sent("GET", "/api/v1/weekly-review").isNotEmpty())
            onNodeWithText("1 missed").assertExists()
            onNode(hasScrollAction()).performScrollToNode(hasText("Sleep more"))
            onNodeWithContentDescription("One thing to carry into next week").performTextInput("Three runs")
            onNodeWithText("Save").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/weekly-review/intent").isNotEmpty() }
            val sent = api.sent("POST", "/api/v1/weekly-review/intent").single().body.orEmpty()
            assertTrue(sent.contains("\"week\":\"2026-11-02\"") && sent.contains("\"intent\":\"Three runs\""), sent)
            onNode(hasScrollAction()).performScrollToNode(hasText("Hill repeats"))
            onNodeWithText("OFF PLAN").assertExists() // badges are uppercase (brand kit §6)
            onNode(hasScrollAction()).performScrollToNode(hasText("What didn't happen"))
            onNodeWithText("Sled work").assertExists()
        }
    }

    @Test
    fun theRacePredictorShowsTheFinishAndCoachInsightsGenerate() {
        val prediction = """{"totalFinishSeconds":5025,"segments":[{"index":0,"kind":"run","exerciseName":"running","label":"Run 1",""" +
            """"estimatedSeconds":290,"basis":"logged","confidence":"medium","sampleSize":6}],"transitionSeconds":300,"aiUsed":false,""" +
            """"aiUnavailableReason":"ai_consent_off","overallConfidence":"medium","division":"open","gender":"male",""" +
            """"genderAssumed":false,"ageGroup":"30-34","ageGroupAssumed":false,"dataCompleteness":{"stationsWithData":6,""" +
            """"totalStations":8,"hasRunData":true},"generatedAt":"2026-11-10T09:30:00.000Z","stale":false}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/race-prediction", prediction)
            on("GET", "/api/v1/coach-insights", """{"insights":null}""")
            on(
                "POST",
                "/api/v1/coach-insights",
                """{"insights":"You're on track for sub-90.","ragInfo":{"source":"none","chunkCount":0},""" +
                    """"generatedAt":"2026-11-10T09:30:00.000Z","stale":false}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Analytics)
            awaitNode(hasText("analytics"))

            onNodeWithText("Race predictor").performClick()
            awaitNode(hasText("1:23:45"))
            onNodeWithText("Open · Men · 30-34 · 6/8 stations logged").assertExists()
            assertTrue(api.sent("GET", "/api/v1/race-prediction").isNotEmpty())

            onNodeWithText("Coach insights").performClick()
            awaitNode(hasText("Generate insights"))
            onNodeWithText("Generate insights").performClick()
            awaitNode(hasText("on track for sub-90", substring = true))
            assertEquals(1, api.sent("POST", "/api/v1/coach-insights").size)
        }
    }

    @Test
    fun theBreakdownTabDrawsTheMixTheMuscleMapAndPatterns() {
        val overview = """{"weeklySummaries":[],"workoutDates":[],"categoryTotals":{"functional":{"count":3,"totalSets":20},""" +
            """"running":{"count":1,"totalSets":0}},"stationCoverage":[],"movementPatternCoverage":[{"pattern":"squat",""" +
            """"label":"Squat","sessionCount":2,"totalSets":8,"lastTrained":"2026-11-08","daysSince":2},{"pattern":"hinge",""" +
            """"label":"Hinge","sessionCount":0,"totalSets":0,"lastTrained":null,"daysSince":null}],"muscleGroupCoverage":[""" +
            """{"muscle":"quads","bodyRegion":"lower","label":"Quads","sessionCount":2,"totalSets":8,"lastTrained":"2026-11-08",""" +
            """"daysSince":2},{"muscle":"core","bodyRegion":"core","label":"Core","sessionCount":1,"totalSets":2,""" +
            """"lastTrained":"2026-11-01","daysSince":9}],"currentStreak":1,"weeklyCompletedWorkouts":1,"weeklyGoal":4,""" +
            """"currentStats":{"totalWorkouts":4,"avgPerWeek":1,"totalDuration":200,"avgDuration":50,"totalRunningMeters":5000},""" +
            """"trainingLoad":{"currentUtss":0,"acuteAvg":0,"chronicAvg":0,"zone":"insufficient_data","monotonyZone":"ok",""" +
            """"hrZones":[],"powerTssEstimated":false,"flaggedVectors":[],"activeRestrictions":[],"trend":[]}}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/training-overview", overview)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Analytics)
            awaitNode(hasText("analytics"))

            onNodeWithText("Breakdown").performClick()
            awaitNode(hasText("Functional 75% · 3 sessions"))
            // The page's list; the tab row and range chips scroll sideways too.
            val page = onAllNodes(hasScrollAction()).onFirst()
            page.performScrollToNode(hasContentDescription("Front muscle heat map", substring = true))
            onNodeWithContentDescription("Front muscle heat map: Quads peak set volume, Core light set volume").assertExists()
            page.performScrollToNode(hasText("Next focus: Add Hinge; it has no logged sessions in this range."))
        }
    }

    @Test
    fun theOverviewChartsReadTheLoadAndTheAiExplainsThem() {
        val trend = """[{"date":"2026-11-08","utss":60,"acwr":1.05,"zone":"sweet_spot","tsb":-4,"monotony":1.2},""" +
            """{"date":"2026-11-09","utss":80,"acwr":1.12,"zone":"sweet_spot","tsb":-8,"monotony":1.3}]"""
        val systems = """[{"system":"leg_muscle","current":1300,"baseline":1000,"ratio":1.31,"status":"high","sixWeekHigh":true,""" +
            """"previousPeak":1200,"weekly":[900,1000,1100,1000,1000,1300]},{"system":"aerobic","current":800,"baseline":800,""" +
            """"ratio":1.0,"status":"normal","sixWeekHigh":false,"weekly":[700,800,800,900,800,800]}]"""
        val overview = """{"weeklySummaries":[{"weekStart":"2026-10-26","workoutCount":3,"totalDuration":150,"avgRpe":7,""" +
            """"categoryBreakdown":{},"workoutsWithDuration":3,"rpeCount":3,"runningMeters":8000},{"weekStart":"2026-11-02",""" +
            """"workoutCount":4,"totalDuration":200,"avgRpe":6.5,"categoryBreakdown":{},"workoutsWithDuration":4,"rpeCount":4,""" +
            """"runningMeters":12000}],"workoutDates":["2026-11-02"],"categoryTotals":{},"stationCoverage":[],""" +
            """"movementPatternCoverage":[],"muscleGroupCoverage":[],"currentStreak":1,"weeklyCompletedWorkouts":1,"weeklyGoal":4,""" +
            """"currentStats":{"totalWorkouts":7,"avgPerWeek":3.5,"totalDuration":350,"avgDuration":50,"totalRunningMeters":20000},""" +
            """"trainingLoad":{"currentUtss":80,"acuteAvg":70,"chronicAvg":62,"acwr":1.12,"zone":"sweet_spot","tsb":-8,""" +
            """"monotony":1.3,"monotonyZone":"ok","hrZones":[],"powerTssEstimated":false,"flaggedVectors":[],""" +
            """"activeRestrictions":[],"trend":$trend},"bodySystemLoad":{"asOf":"2026-11-09","weeks":[],"systems":$systems,""" +
            """"sessionCount":7,"estimatedSessions":0,"unattributedSessions":0,"unscoredSessions":0}}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/training-overview", overview)
            on("GET", "/api/v1/overview-analysis", """{"sections":null}""")
            on(
                "POST",
                "/api/v1/overview-analysis",
                """{"sections":{"trainingLoad":"Your load is in the sweet spot.","bodySystems":null,"formMonotony":null,""" +
                    """"objectiveLoad":null,"weeklyWorkouts":null,"rpeDuration":null,"consistency":null},""" +
                    """"generatedAt":"2026-11-10T09:30:00.000Z","stale":false}""",
            )
            on(
                "GET",
                "/api/v1/timeline-annotations",
                """[{"id":"a1","userId":"u1","startDate":"2026-11-01","endDate":"2026-11-02","type":"injury"}]""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Analytics)
            awaitNode(hasText("AI Chart Analysis"))
            onNodeWithText("Generate analysis").performClick()
            awaitNode(hasText("Regenerate"))
            assertEquals(1, api.sent("POST", "/api/v1/overview-analysis").size)

            // The page's list; the tab row and range chips scroll sideways too.
            val page = onAllNodes(hasScrollAction()).onFirst()
            page.performScrollToNode(hasText("UTSS 80 - ACWR 1.12"))
            onNodeWithText("SWEET SPOT").assertExists()
            onNodeWithContentDescription("Acute-to-chronic workload ratio over 2 days", substring = true).assertExists()
            page.performScrollToNode(hasText("Your load is in the sweet spot."))
            page.performScrollToNode(
                hasText("Leg muscle load is at a six-week high (31% above your usual week), while aerobic load is normal."),
            )
            // The injury's two days span both weeks on the chart.
            page.performScrollToNode(hasText("Injury"))
            page.performScrollToNode(hasContentDescription("Workout activity heatmap", substring = true))
        }
    }

    @Test
    fun aMafAthleteSeesTheirMafTrendAndFuellingComparesCarbDays() {
        val user = """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"trainingStyleId":"maf_method"}"""
        fun mafTest(id: String, workout: String, metres: Int) = """{"id":"$id","userId":"u1","protocolType":"distance","version":1,""" +
            """"conditions":{"source":"workout_tag","workoutLogId":"$workout"},"metrics":{"durationSeconds":2880,""" +
            """"distanceMeters":$metres,"avgHeartRate":141,"mafCeilingUsed":145},"createdAt":"2026-11-09T08:00:00Z"}"""
        fun scored(workout: String, pct: Int, classification: String) =
            """{"id":"a-$workout","userId":"u1","workoutLogId":"$workout","compliancePct":$pct,""" +
                """"classification":"$classification","version":1}"""
        val maf = """{"tests":[${mafTest("t2", "w2", 8400)},${mafTest("t1", "w1", 8000)}],""" +
            """"analysis":[${scored("w2", 92, "compliant")},${scored("w1", 80, "mostly_compliant")}],""" +
            """"workoutDates":{"w1":"2026-11-02","w2":"2026-11-08"}}"""
        fun day(date: String, carb: Int, rpe: Double) = """{"date":"$date","calories":2400,"protein":150,"carb":$carb,"fat":80,""" +
            """"fiber":30,"utss":60,"carbTargetG":300,"avgRpe":$rpe}"""
        val block = """{"from":"2026-08-13","to":"2026-11-10","points":[${day("2026-11-01", 290, 6.0)},${day("2026-11-02", 280, 7.0)},""" +
            """${day(
                "2026-11-03",
                300,
                6.5,
            )},${day("2026-11-04", 150, 8.0)},${day("2026-11-05", 160, 7.5)},${day("2026-11-06", 100, 8.5)}]}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/auth/user", user)
            on("GET", "/api/v1/maf-tests", maf)
            on("GET", "/api/v1/nutrition/block", block)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Analytics)
            awaitNode(hasText("analytics"))
            // The MAF trend tab shows for a MAF athlete only.
            openAnalyticsTab("MAF trend")
            awaitNode(hasText("2 MAF TESTS"))
            onNodeWithText("LATEST: 92% · COMPLIANT").assertExists()
            onNodeWithText("Last updated Nov 8, 2026.").assertExists()
            val page = onAllNodes(hasScrollAction()).onFirst()
            page.performScrollToNode(hasText("5:43/km · 48:00 · 141 bpm"))
            onNodeWithText("Nov 2, 2026").assertExists()

            openAnalyticsTab("Fuelling")
            awaitNode(hasText("Intake vs training load"))
            page.performScrollToNode(hasText("6.5 on carb-hit days (3) vs 8 missed (3) — 1.5 lower (felt easier)"))
            assertTrue(api.sent("GET", "/api/v1/nutrition/block").isNotEmpty())
        }
    }

    @Test
    fun aDescribedMealIsReviewedThenLoggedInOneBatchAfterTurningOnTheAi() {
        val today = FakeApi.today
        val summary = """{"logDate":"$today","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[],""" +
            """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""
        val egg = """{"id":"f1","source":"usda","name":"Egg, scrambled","caloriesPer100g":150,"proteinPer100g":10,"carbPer100g":2,""" +
            """"fatPer100g":11,"isPublic":true,"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
        val parsed = """{"items":[{"name":"scrambled eggs","quantityG":120.4,"displayAmount":"2 scrambled eggs","mealType":"breakfast",""" +
            """"confidence":0.9,"foodId":"f1","food":$egg},{"name":"mystery sauce","quantityG":30,"displayAmount":"a splash of sauce",""" +
            """"confidence":0.3}],"warnings":["Portions are estimates."],"rawInput":"2 scrambled eggs and a splash of sauce"}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", summary)
            on("POST", "/api/v1/nutrition/parse/text", parsed)
            on(
                "PATCH",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","aiCoachEnabled":true}""",
            )
            on("POST", "/api/v1/nutrition/logs/batch", """{"created":1,"logDate":"$today"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            // The day's totals, then the Log food button below them.
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNodeWithText("Log food").performClick()
            awaitNode(hasText("Describe a meal"))
            onNodeWithText("Describe a meal").performClick()
            awaitNode(hasContentDescription("Describe your meal"))
            onNode(
                hasSetTextAction() and hasContentDescription("Describe your meal"),
            ).performTextInput("2 scrambled eggs and a splash of sauce")
            onNodeWithText("Review foods").performClick()

            // The AI isn't on yet: consent first, then the same description is read.
            awaitNode(hasText("Not now"))
            onNode(hasText("Enable AI Coach") and hasClickAction()).performClick()
            awaitNode(hasText("Review parsed foods"))
            assertEquals("""{"aiCoachEnabled":true}""", api.sent("PATCH", "/api/v1/preferences").single().body)
            onNodeWithText("Portions are estimates.").assertExists()
            onNodeWithText("No match — choose a food to log this.").assertExists()
            onNodeWithText("1 item needs a match and won't be logged.").assertExists()

            onNodeWithText("Log 1 item").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/logs/batch").isNotEmpty() }
            val batch = api.sent("POST", "/api/v1/nutrition/logs/batch").single().body.orEmpty()
            assertTrue(""""entryMethod":"nl"""" in batch, batch)
            assertTrue(""""items":[{"foodId":"f1","quantityG":120.0,"mealType":"breakfast","parseConfidence":0.9}]""" in batch, batch)
            awaitNode(hasText("Logged 1 item"))
        }
    }
}

/**
 * Taps today's session on the timeline. The "This week" card above names it
 * too, so the timeline's card is the last of the two.
 */
@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openCard(focus: String) = onAllNodesWithText(focus).onLast().performClick()

/** A list that scrolls sideways. */
private val scrollsSideways = SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange)

/**
 * Scrolls the Analytics tab row (the page's first sideways list; the range
 * chips are the second) to [label] and taps it. The row is rebuilt when the
 * athlete's training style arrives (it decides the MAF tab), so the scroll is
 * retried until the row has settled.
 */
@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openAnalyticsTab(label: String) {
    waitUntil(timeoutMillis = 10_000) {
        runCatching { onAllNodes(scrollsSideways).onFirst().performScrollToNode(hasText(label)) }.isSuccess
    }
    onNodeWithText(label).performClick()
}
