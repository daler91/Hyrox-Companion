package com.fitai.coach.core.nutrition

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class CarryPeriodizationTest {
    private val periodized = PeriodizationSettings(
        periodizationEnabled = true,
        referenceUtss = 60.0,
        carbGramsPerUtss = 1.2,
        recoveryEnabled = true,
        recoveryProteinBumpFrac = 0.15,
        preloadCarbGramsPerUtss = 0.5,
        preloadDaysAhead = 2,
        phaseAware = false,
        maxCarbDeltaG = 120.0,
    )

    @Test
    fun aNewCarbGoalKeepsTheVersionsChoicesAndRebasesItsCalibration() {
        val current = StoredPeriodization(carbG = 300.0, settings = periodized)
        val next = carryPeriodizationForward(current, 330.0)

        assertEquals(
            nextPeriodizationSettings(
                current,
                PeriodizationChoice(330.0, periodize = true, recoveryEnabled = true, phaseAware = false),
                null,
            ),
            next,
        )
        assertEquals(60.0, next.referenceUtss)
        assertEquals(1.3, next.carbGramsPerUtss)
    }

    @Test
    fun aVersionWithoutLoadScalingStaysWithout() {
        val current = StoredPeriodization(carbG = 300.0, settings = periodized.copy(periodizationEnabled = false))

        assertFalse(carryPeriodizationForward(current, 330.0).periodizationEnabled)
    }
}
