package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.GetNutritionBlockResponse.PointsItem
import com.fitai.coach.ui.format.formatNumber
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuellingModelTest {
    private fun day(calories: Double, carb: Double, target: Double?, rpe: Double?, compliance: Double? = null) =
        PointsItem(
            date = "2026-11-01",
            calories = calories,
            protein = 0.0,
            carb = carb,
            fat = 0.0,
            fiber = 0.0,
            utss = 50.0,
            carbTargetG = target,
            avgRpe = rpe,
            compliancePct = compliance,
        )

    // Hit: at least 90% of a 300 g target (270 g); miss: under it.
    private fun hit(rpe: Double?, compliance: Double? = null) = day(2500.0, 280.0, 300.0, rpe, compliance)

    private fun miss(rpe: Double?, compliance: Double? = null) = day(2000.0, 150.0, 300.0, rpe, compliance)

    @Test
    fun hitDaysAreComparedWithMissedDaysOnceEachHasThree() {
        val result = fuellingCorrelation(
            listOf(hit(6.0, 95.0), hit(7.0, 90.0), hit(6.5, 100.0), miss(8.0, 80.0), miss(7.5, 85.0), miss(8.5, 90.0)),
        )
        assertTrue(result.ok)
        assertEquals(6, result.eligibleDays)
        assertEquals(MetricComparison(3, 3, 6.5, 8.0, -1.5), result.rpe)
        assertEquals(MetricComparison(3, 3, 95.0, 85.0, 10.0), result.compliance)
        assertEquals(90, result.carbHitPct)
    }

    @Test
    fun anUnloggedDayIsNotAMissAndUnderThreeDaysIsNotAComparison() {
        // No food logged: 0 g of carbs would read as a miss, so the day doesn't count.
        val unlogged = day(0.0, 0.0, 300.0, 9.0)
        val result = fuellingCorrelation(listOf(hit(6.0), hit(7.0), hit(6.5), miss(8.0), miss(7.5), unlogged))
        assertEquals(5, result.eligibleDays)
        assertNull(result.rpe)
        assertFalse(result.ok)
        // No target, no outcome: not eligible at all.
        assertEquals(0, fuellingCorrelation(listOf(day(2000.0, 100.0, null, 7.0), day(2000.0, 100.0, 300.0, null))).eligibleDays)
    }

    @Test
    fun theDifferencesReadAsTheWebsDo() {
        assertEquals("1.5 lower (felt easier)", rpeDeltaText(MetricComparison(3, 3, 6.5, 8.0, -1.5)))
        assertEquals("0.4 higher (felt harder)", rpeDeltaText(MetricComparison(3, 3, 7.4, 7.0, 0.4)))
        assertEquals("no clear difference", rpeDeltaText(MetricComparison(3, 3, 7.1, 7.0, 0.1)))
        assertEquals("10 pts better", complianceDeltaText(MetricComparison(3, 3, 95.0, 85.0, 10.0)))
        assertEquals("4 pts worse", complianceDeltaText(MetricComparison(3, 3, 81.0, 85.0, -4.0)))
        assertEquals("about the same", complianceDeltaText(MetricComparison(3, 3, 86.0, 85.0, 1.0)))
        assertEquals(
            "6.5 on carb-hit days (3) vs 8 missed (3) — 1.5 lower (felt easier)",
            comparisonLine(MetricComparison(3, 3, 6.5, 8.0, -1.5), ::formatNumber, "1.5 lower (felt easier)"),
        )
    }

    @Test
    fun theTabShowsOnceAnyDayHasFood() {
        assertTrue(hasIntake(listOf(day(0.0, 0.0, null, null), day(1800.0, 200.0, null, null))))
        assertFalse(hasIntake(listOf(day(0.0, 0.0, 300.0, 7.0))))
    }
}
