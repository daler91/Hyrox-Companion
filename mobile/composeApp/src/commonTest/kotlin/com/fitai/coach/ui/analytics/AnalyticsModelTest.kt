package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.PersonalRecordValue
import com.fitai.coach.core.data.AnalyticsRange
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AnalyticsModelTest {
    @Test
    fun deltasFollowTheWebsRules() {
        assertEquals(Delta.Same, delta(100.4, 100.0))
        assertEquals(Delta.New, delta(3.0, 0.0))
        assertEquals(Delta.Same, delta(0.0, 0.0))
        assertNull(delta(3.0, null))
        val up = assertIs<Delta.Change>(delta(5.0, 4.0))
        assertEquals(25.0, up.percent)
        assertTrue(up.better)
        assertTrue(assertIs<Delta.Change>(delta(6.0, 7.0, lowerIsBetter = true)).better)
    }

    @Test
    fun aTrendNeedsMoreThanFivePercent() {
        assertEquals(Trend.Up, trend(listOf(100.0, 100.0, 110.0, 110.0)))
        assertEquals(Trend.Flat, trend(listOf(100.0, 100.0, 104.0, 104.0)))
        assertEquals(Trend.Down, trend(listOf(100.0, 90.0)))
        assertEquals(Trend.Flat, trend(listOf(100.0)))
    }

    @Test
    fun rangesEndTodayAndAllHasNoBounds() {
        assertEquals("2026-10-10" to "2026-11-08", AnalyticsRange.Month.bounds("2026-11-08"))
        assertNull(AnalyticsRange.All.bounds("2026-11-08"))
    }

    @Test
    fun recordsFilterSortAndFindRecentOnes() {
        val old = PersonalRecordValue(value = 100.0, date = "2026-08-01", workoutLogId = "w1")
        val fresh = PersonalRecordValue(value = 120.0, date = "2026-11-01", workoutLogId = "w2")
        val records = mapOf(
            "wall_balls" to PersonalRecord(category = "functional", maxWeight = old),
            "back_squat" to PersonalRecord(category = "strength", maxWeight = fresh),
        )

        val all = recordRows(records)
        assertEquals(listOf("back_squat", "wall_balls"), all.map { it.key })
        assertEquals(listOf("back_squat"), recordRows(records, "Strength").map { it.key })
        assertEquals(listOf("back_squat"), recentRecords(all, "2026-11-08").map { it.key })
    }
}
