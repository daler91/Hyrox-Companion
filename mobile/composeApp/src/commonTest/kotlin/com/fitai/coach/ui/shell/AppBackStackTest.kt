package com.fitai.coach.ui.shell

import androidx.navigation3.runtime.NavKey
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private data object Detail : NavKey

class AppBackStackTest {
    @Test
    fun startsOnTraining() {
        val stack = AppBackStack()

        assertEquals(TopLevel.Training, stack.currentTab)
        assertEquals(listOf<NavKey>(Route.Training), stack.entries.toList())
    }

    @Test
    fun selectingATabStartsAFreshStackAtItsRoot() {
        val stack = AppBackStack()
        stack.push(Detail)

        stack.select(TopLevel.Analytics)

        assertEquals(TopLevel.Analytics, stack.currentTab)
        assertEquals(listOf<NavKey>(Route.Analytics), stack.entries.toList())
    }

    @Test
    fun reselectingTheCurrentTabPopsToItsRoot() {
        val stack = AppBackStack()
        stack.push(Detail)

        stack.select(TopLevel.Training)

        assertEquals(listOf<NavKey>(Route.Training), stack.entries.toList())
    }

    @Test
    fun backPopsADetailButLeavesTheRootToTheSystem() {
        val stack = AppBackStack()
        stack.push(Detail)

        assertTrue(stack.pop())
        assertFalse(stack.pop())
        assertEquals(listOf<NavKey>(Route.Training), stack.entries.toList())
    }

    @Test
    fun theBottomBarMatchesTheWebsNavItems() {
        assertEquals(
            listOf("Training", "Log", "Nutrition", "Analytics", "Settings"),
            TopLevel.entries.map { it.shortTitle },
        )
    }
}
