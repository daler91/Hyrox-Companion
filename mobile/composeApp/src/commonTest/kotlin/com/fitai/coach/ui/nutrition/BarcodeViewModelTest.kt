package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.NutritionFood
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class Offline : Exception("no network")

@OptIn(ExperimentalCoroutinesApi::class)
class BarcodeViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val asked = mutableListOf<String>()

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private val nutella = NutritionFood(
        id = "f1",
        source = NutritionFood.Source.Off,
        name = "Nutella",
        isPublic = true,
        createdAt = "2026-11-01T00:00:00Z",
        updatedAt = "2026-11-01T00:00:00Z",
    )

    private fun viewModel(answer: (String) -> NutritionFood) = BarcodeViewModel { code ->
        asked += code
        answer(code)
    }

    @Test
    fun onlyDigitsAreTypedAndOnlyABarcodesLengthCanBeLookedUp() {
        val vm = viewModel { nutella }
        vm.open()
        vm.type("3017-6204 22003 99")
        assertEquals("30176204220039", vm.state.value?.code)
        assertTrue(vm.state.value!!.canLookUp)

        vm.type("1234567")
        assertFalse(vm.state.value!!.canLookUp)
        vm.lookUpTyped()
        assertTrue(asked.isEmpty())
    }

    @Test
    fun aFoundFoodClosesTheSheetAndGoesToBeLogged() = runTest(dispatcher) {
        val vm = viewModel { nutella }
        vm.open()
        vm.type("3017620422003")
        vm.lookUpTyped()
        assertTrue(vm.state.value!!.lookingUp)
        advanceUntilIdle()

        assertEquals(listOf("3017620422003"), asked)
        assertNull(vm.state.value)
        assertEquals("Nutella", vm.found.first().name)
    }

    @Test
    fun anUnknownCodeSaysSoAndTypingAgainClearsIt() = runTest(dispatcher) {
        val vm = viewModel { throw ApiException(404, "NOT_FOUND", "Barcode not recognized") }
        vm.open()
        vm.type("12345678")
        vm.lookUpTyped()
        advanceUntilIdle()

        val state = vm.state.value!!
        assertTrue(state.notRecognized)
        assertFalse(state.lookingUp)
        vm.type("123456789")
        assertFalse(vm.state.value!!.notRecognized)
    }

    @Test
    fun anOfflineLookupSaysWhyAndKeepsTheSheet() = runTest(dispatcher) {
        val vm = viewModel { throw Offline() }
        vm.open()
        vm.type("12345678")
        vm.lookUpTyped()
        advanceUntilIdle()

        assertFalse(vm.state.value!!.notRecognized)
        assertTrue(vm.messages.first().isNotBlank())
    }

    @Test
    fun aScannedCodeIsLookedUpAtOnceAndAnOddOneIsNot() = runTest(dispatcher) {
        val vm = viewModel { nutella }
        vm.open()
        vm.scanned("ABC")
        assertTrue(vm.state.value!!.notRecognized)
        assertTrue(asked.isEmpty())

        vm.scanned(" 5000159484695 ")
        assertEquals("5000159484695", vm.state.value?.code)
        advanceUntilIdle()
        assertEquals(listOf("5000159484695"), asked)
        assertNull(vm.state.value)
    }

    @Test
    fun closingDropsALookupStillUnderWay() = runTest(dispatcher) {
        val vm = viewModel { nutella }
        vm.open()
        vm.type("12345678")
        vm.lookUpTyped()
        vm.close()
        advanceUntilIdle()

        assertNull(vm.state.value)
        assertTrue(asked.isEmpty())
    }
}
