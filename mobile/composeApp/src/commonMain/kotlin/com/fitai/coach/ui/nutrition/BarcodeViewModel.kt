package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The barcode sheet (BarcodeScanner.tsx): the number as typed, a lookup under way, and a code the server didn't know. */
data class BarcodeState(val code: String = "", val lookingUp: Boolean = false, val notRecognized: Boolean = false) {
    val canLookUp: Boolean get() = !lookingUp && isBarcode(code)
}

/** A food packet's barcode: 8 to 14 digits (EAN-8 to GTIN-14), as the server takes. */
fun isBarcode(code: String): Boolean = BARCODE.matches(code)

private val BARCODE = Regex("""\d{8,14}""")
private const val MAX_BARCODE_DIGITS = 14

/**
 * Finding a food by its barcode (FR-2.1): scanned with the camera where the
 * phone has a scanner, or typed, which works everywhere. Both go to the
 * server's lookup (Open Food Facts); a food it finds goes to [found] for
 * logging, and the sheet closes. A code it doesn't know says so and stays.
 */
@Suppress("TooGenericExceptionCaught")
class BarcodeViewModel(private val lookUp: suspend (String) -> NutritionFood) : ViewModel() {
    private val _state = MutableStateFlow<BarcodeState?>(null)

    /** The sheet, open when set. */
    val state: StateFlow<BarcodeState?> = _state.asStateFlow()

    private val foods = Channel<NutritionFood>(Channel.BUFFERED)

    /** A food a barcode found, to open for logging. */
    val found: Flow<NutritionFood> = foods.receiveAsFlow()

    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private var lookup: Job? = null

    fun open() {
        _state.value = BarcodeState()
    }

    /** Closes the sheet, and drops a lookup still under way: closing means the athlete moved on. */
    fun close() {
        lookup?.cancel()
        _state.value = null
    }

    fun type(code: String) = _state.update { it?.copy(code = code.filter(Char::isDigit).take(MAX_BARCODE_DIGITS), notRecognized = false) }

    fun lookUpTyped() {
        val state = _state.value?.takeIf { it.canLookUp } ?: return
        find(state.code)
    }

    /** A code from the camera: shown in the field, and looked up straight away. */
    fun scanned(code: String) {
        val digits = code.trim()
        _state.update { it?.copy(code = digits.take(MAX_BARCODE_DIGITS), notRecognized = !isBarcode(digits)) }
        if (isBarcode(digits) && _state.value?.lookingUp == false) find(digits)
    }

    private fun find(code: String) {
        _state.update { it?.copy(lookingUp = true, notRecognized = false) }
        lookup = viewModelScope.launch {
            try {
                val food = lookUp(code)
                _state.value = null
                foods.send(food)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.status == NOT_FOUND) _state.update { it?.copy(lookingUp = false, notRecognized = true) } else failed(e)
            } catch (e: Exception) {
                failed(e)
            }
        }
    }

    private suspend fun failed(e: Exception) {
        _state.update { it?.copy(lookingUp = false) }
        toasts.send(e.userMessage("Couldn't look up that barcode"))
    }

    private companion object {
        const val NOT_FOUND = 404
    }
}
