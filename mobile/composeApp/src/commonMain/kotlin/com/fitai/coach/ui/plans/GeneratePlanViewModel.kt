package com.fitai.coach.ui.plans

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.GenerationOutcome
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.ui.format.userMessage
import com.fitai.coach.ui.onboarding.PlanForm
import com.fitai.coach.ui.onboarding.findOverlappingPlans
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where the generator sheet is: the AI Coach consent it needs first, the form, or the wait. */
enum class GeneratePhase { Consent, Form, Generating }

data class GeneratePlanState(
    val open: Boolean = false,
    val phase: GeneratePhase = GeneratePhase.Form,
    val form: PlanForm? = null,
    val today: String = "",
    val plans: List<TrainingPlan> = emptyList(),
    /** The athlete card's facts, which every plan is written around. */
    val cardFacts: List<String> = emptyList(),
    /** Turning the AI Coach on, or starting the generation. */
    val busy: Boolean = false,
    /** Why the last try didn't work, shown in the sheet. */
    val error: String? = null,
) {
    /** The live plans the new one would run over, each archived once it is ready unless kept. */
    val overlapping: List<TrainingPlan>
        get() = form?.let { findOverlappingPlans(plans, it.startDate, it.endDate, today) }.orEmpty()
}

/**
 * A new AI plan from the timeline (GeneratePlanDialog): the AI Coach consent
 * when it is off, the form, then the wait. Closing during the wait leaves the
 * plan generating; it still arrives with its message. Plans the new one runs
 * over can be archived once it is ready, so an abandoned block stops counting
 * missed sessions.
 */
@Suppress("TooGenericExceptionCaught")
class GeneratePlanViewModel(private val session: UserSession, private val todayIn: (String?) -> String) : ViewModel() {
    private val mutableState = MutableStateFlow(GeneratePlanState())
    val state: StateFlow<GeneratePlanState> = mutableState.asStateFlow()
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private var preferences: PreferencesResponse? = null
    private var generation: Job? = null

    init {
        viewModelScope.launch { session.timeline.plans.collect { plans -> mutableState.update { it.copy(plans = plans.orEmpty()) } } }
        viewModelScope.launch { session.preferences.preferences.collect { preferences = it } }
    }

    /** Opens the sheet: on the wait while a plan is generating, otherwise on a fresh form. */
    fun open() {
        if (generation?.isActive == true) {
            mutableState.update { it.copy(open = true) }
            return
        }
        val today = todayIn(preferences?.userTimezone)
        val aiOn = preferences?.aiCoachEnabled == true
        mutableState.update {
            GeneratePlanState(
                open = true,
                phase = if (aiOn) GeneratePhase.Form else GeneratePhase.Consent,
                form = PlanForm.initial(goal = "", today = today, raceDate = null),
                today = today,
                plans = it.plans,
            )
        }
        if (aiOn) loadAthleteContext()
    }

    /** Closes the sheet. A plan generating keeps going and still arrives. */
    fun close() {
        mutableState.update { it.copy(open = false) }
        if (generation?.isActive == true) {
            toasts.trySend(
                "Your plan is still generating. It will appear in your plans when it's ready, usually within a couple of minutes.",
            )
        }
    }

    fun edit(change: (PlanForm) -> PlanForm) = mutableState.update { s -> s.copy(form = s.form?.let(change), error = null) }

    /** AI plans are written by the AI Coach, which the server refuses to use without this consent. */
    fun enableAiCoach() {
        if (state.value.busy) return
        mutableState.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                session.preferences.update(UpdateUserPreferences(aiCoachEnabled = true))
                mutableState.update { it.copy(busy = false, phase = GeneratePhase.Form) }
                loadAthleteContext()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.update { it.copy(busy = false, error = e.userMessage("Couldn't turn on the AI Coach. Please try again.")) }
            }
        }
    }

    /** Starts the plan and watches it until it is ready, fails or the watch is given up on. */
    fun generate() {
        val s = state.value
        val form = s.form?.takeIf { it.canGenerate } ?: return
        if (s.busy || generation?.isActive == true) return
        val request = form.toRequest(form.supersedeIds(s.overlapping))
        mutableState.update { it.copy(busy = true, error = null) }
        generation = viewModelScope.launch {
            val planId = try {
                session.onboarding.generate(request)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.update {
                    it.copy(busy = false, error = e.userMessage("Failed to generate plan. Please try again in a moment."))
                }
                return@launch
            }
            mutableState.update { it.copy(busy = false, phase = GeneratePhase.Generating) }
            settle(session.onboarding.awaitGeneration(planId))
        }
    }

    private suspend fun settle(outcome: GenerationOutcome) {
        val failure = (outcome as? GenerationOutcome.Failed)?.let {
            it.error ?: "AI plan generation failed. The AI service was temporarily unavailable; please try again."
        }
        if (failure != null && state.value.open) {
            // Back to the form as it was, to try again.
            mutableState.update { it.copy(phase = GeneratePhase.Form, error = failure) }
            return
        }
        mutableState.update { it.copy(open = false, phase = GeneratePhase.Form) }
        toasts.send(
            when (outcome) {
                GenerationOutcome.Ready -> "Training plan generated. It's on your timeline."
                GenerationOutcome.TimedOut -> "Your plan is taking longer than usual. If it finishes, it will appear in your plans."
                GenerationOutcome.Unreachable ->
                    "Couldn't check on your plan. It may still appear in your plans; if not, try again in a few minutes."
                is GenerationOutcome.Failed -> failure.orEmpty()
            },
        )
    }

    /**
     * Best effort: the older injuries note, prefilled while the box is still
     * untouched, and the athlete card's facts. Neither is needed to generate.
     */
    private fun loadAthleteContext() {
        viewModelScope.launch {
            val note = try {
                session.account.refreshUser()
                session.account.user.first()?.trainingConstraints
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                session.account.user.first()?.trainingConstraints
            }
            mutableState.update { s ->
                s.copy(form = s.form?.let { form -> if (form.injuries.isEmpty()) form.withRememberedNote(note) else form })
            }
        }
        viewModelScope.launch {
            val facts = try {
                session.athleteCard.activeFacts().map { it.fact }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                emptyList()
            }
            mutableState.update { it.copy(cardFacts = facts) }
        }
    }
}
