package com.fitai.coach.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.GenerationOutcome
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.dates.nextPlanStartDate
import com.fitai.coach.ui.format.userMessage
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

enum class SetupStep { Welcome, Units, Goal, Coach, Plan, AiPlan, Generating, Schedule }

/** The numbered steps, for "step 3 of 5". The AI form, its wait and the template's date belong to the plan step. */
val NUMBERED_STEPS: List<SetupStep> = listOf(SetupStep.Welcome, SetupStep.Units, SetupStep.Goal, SetupStep.Coach, SetupStep.Plan)

fun stepNumber(step: SetupStep): Int = NUMBERED_STEPS.indexOf(step).takeIf { it >= 0 }?.plus(1) ?: NUMBERED_STEPS.size

data class OnboardingUiState(
    val step: SetupStep = SetupStep.Welcome,
    val profile: SetupProfile = SetupProfile(),
    val ageError: String? = null,
    val goalId: String = DEFAULT_GOAL_ID,
    val raceDate: String = "",
    val raceDateError: String? = null,
    val today: String = "",
    val planForm: PlanForm? = null,
    /** The template's start date. */
    val startDate: String = "",
    /** The AI Coach choice as the server has it: AI plans need it on. */
    val aiCoachSaved: Boolean = false,
    val busy: Boolean = false,
)

/** Why setup closed, with what to tell the athlete. */
data class SetupResult(val message: String, val madePlan: Boolean)

/**
 * First-run setup (OnboardingWizard on the web): units and race profile,
 * goal and race date, the AI Coach choice, then the first plan: the 8-week
 * template from a start date, or an AI plan. Whatever way it closes, setup
 * is marked done; Settings has "Run setup again".
 */
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class OnboardingViewModel(private val session: UserSession, private val todayIn: (String?) -> String) : ViewModel() {
    private val mutableState = MutableStateFlow(OnboardingUiState())
    val state: StateFlow<OnboardingUiState> = mutableState.asStateFlow()
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()
    private val results = Channel<SetupResult>(Channel.CONFLATED)
    val finished: Flow<SetupResult> = results.receiveAsFlow()

    private var saved = SetupProfile()
    private var timeZone: String? = null

    /** A template created whose schedule then failed: a retry reuses it, any other way out deletes it. */
    private var unscheduledPlanId: String? = null
    private var generation: Job? = null

    init {
        viewModelScope.launch {
            val prefs = session.preferences.preferences.first() ?: runCatching { session.preferences.refresh() }.getOrNull()
            timeZone = prefs?.userTimezone
            saved = SetupProfile.from(prefs)
            mutableState.update { it.copy(profile = saved, today = todayIn(timeZone), aiCoachSaved = saved.aiCoachEnabled) }
        }
    }

    fun edit(change: (SetupProfile) -> SetupProfile) = mutableState.update { it.copy(profile = change(it.profile), ageError = null) }

    fun setGoal(id: String) = mutableState.update { it.copy(goalId = id) }

    fun setRaceDate(date: String) = mutableState.update { it.copy(raceDate = date, raceDateError = null) }

    fun editPlan(change: (PlanForm) -> PlanForm) = mutableState.update { s -> s.copy(planForm = s.planForm?.let(change)) }

    fun setStartDate(date: String) = mutableState.update { it.copy(startDate = date) }

    fun next() {
        when (state.value.step) {
            SetupStep.Welcome -> go(SetupStep.Units)
            SetupStep.Units -> saveUnits()
            SetupStep.Goal -> checkGoal()
            SetupStep.Coach -> saveCoach()
            else -> Unit
        }
    }

    fun back() {
        val previous = when (state.value.step) {
            SetupStep.Units -> SetupStep.Welcome
            SetupStep.Goal -> SetupStep.Units
            SetupStep.Coach -> SetupStep.Goal
            SetupStep.Plan -> SetupStep.Coach
            SetupStep.AiPlan, SetupStep.Schedule -> SetupStep.Plan
            else -> null
        }
        previous?.let(::go)
    }

    /** The AI plan form, prefilled from the goal and race date. Needs the AI Coach on. */
    fun chooseAiPlan() {
        val s = state.value
        if (!saved.aiCoachEnabled) return
        val goal = describeOnboardingGoal(s.goalId, s.profile.division, s.raceDate)
        mutableState.update { it.copy(planForm = it.planForm ?: PlanForm.initial(goal, todayNow(), s.raceDate), step = SetupStep.AiPlan) }
    }

    fun chooseTemplate() = mutableState.update {
        it.copy(startDate = it.startDate.ifEmpty { nextPlanStartDate(todayNow()) }, step = SetupStep.Schedule)
    }

    /** Creates the template and schedules it from the chosen date. */
    fun startTraining() = busy("Failed to set up your plan. Please try again.") {
        val s = state.value
        val planId = unscheduledPlanId ?: session.onboarding.createTemplatePlan(
            describeOnboardingGoal(s.goalId, s.profile.division, s.raceDate),
            s.raceDate.ifEmpty { null },
        )
        unscheduledPlanId = planId
        session.onboarding.schedule(planId, s.startDate)
        unscheduledPlanId = null
        finish(
            "Your training plan is ready! Workouts are on your timeline. Connect Strava or Garmin in Settings to log them automatically.",
            madePlan = true,
        )
    }

    /** Starts the AI plan and waits for it, showing the wait. */
    fun generate() {
        val form = state.value.planForm?.takeIf { it.canGenerate } ?: return
        if (generation?.isActive == true) return
        generation = viewModelScope.launch {
            mutableState.update { it.copy(busy = true) }
            val planId = try {
                session.onboarding.generate(form.toRequest())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.update { it.copy(busy = false) }
                toasts.send(e.userMessage("Failed to generate plan. Please try again in a moment."))
                return@launch
            }
            discardUnscheduled()
            mutableState.update { it.copy(busy = false, step = SetupStep.Generating) }
            when (val outcome = session.onboarding.awaitGeneration(planId)) {
                GenerationOutcome.Ready -> finish("Training plan generated. It's on your timeline.", madePlan = true)
                is GenerationOutcome.Failed -> {
                    go(SetupStep.AiPlan)
                    toasts.send(outcome.error ?: "AI plan generation failed. The AI service was temporarily unavailable; please try again.")
                }
                GenerationOutcome.TimedOut -> {
                    go(SetupStep.Plan)
                    toasts.send("Your plan is taking longer than usual. If it finishes, it will appear in your plans.")
                }
                GenerationOutcome.Unreachable -> {
                    go(SetupStep.Plan)
                    toasts.send("Couldn't check on your plan. It may still appear in your plans; if not, try again in a few minutes.")
                }
            }
        }
    }

    /** Leaves the plan generating on the server and finishes setup. */
    fun keepGeneratingInBackground() {
        generation?.cancel()
        viewModelScope.launch {
            finish(
                "Your plan is still generating. It will appear in your plans when it's ready, usually within a couple of minutes.",
                madePlan = true,
            )
        }
    }

    fun skip() = viewModelScope.launch {
        discardUnscheduled()
        finish("Setup finished without a plan. Run setup again anytime from Settings.", madePlan = false)
    }

    /** Closing setup part-way: what was saved stays. */
    fun leave() = viewModelScope.launch {
        generation?.cancel()
        discardUnscheduled()
        finish("Setup closed. Run it again anytime from Settings.", madePlan = false)
    }

    private fun saveUnits() {
        val s = state.value
        val problem = ageError(s.profile.age)
        if (problem != null) {
            mutableState.update { it.copy(ageError = problem) }
            return
        }
        // A failed save moves on all the same: Settings changes all of these later.
        busy("Could not save preferences. You can update them later in Settings.", always = { go(SetupStep.Goal) }) {
            unitsPatch(s.profile, saved)?.let { patch ->
                session.preferences.update(patch)
                saved = saved.copy(
                    weightUnit = s.profile.weightUnit,
                    distanceUnit = s.profile.distanceUnit,
                    division = s.profile.division,
                    gender = s.profile.gender,
                    age = s.profile.age.trim(),
                )
            }
        }
    }

    private fun checkGoal() {
        val today = todayNow()
        val problem = raceDateError(state.value.raceDate, today)
        mutableState.update { it.copy(today = today, raceDateError = problem) }
        if (problem == null) go(SetupStep.Coach)
    }

    // A failed save keeps the athlete here: the plan step must not offer AI
    // plans on a consent the server never recorded.
    private fun saveCoach() = busy("Could not save your AI Coach choice. Please try again.") {
        val choice = state.value.profile.aiCoachEnabled
        if (choice != saved.aiCoachEnabled) {
            session.preferences.update(UpdateUserPreferences(aiCoachEnabled = choice))
            saved = saved.copy(aiCoachEnabled = choice)
            mutableState.update { it.copy(aiCoachSaved = choice) }
        }
        go(SetupStep.Plan)
    }

    private fun go(step: SetupStep) = mutableState.update { it.copy(step = step) }

    private fun todayNow(): String = todayIn(timeZone)

    private suspend fun discardUnscheduled() {
        unscheduledPlanId?.let { session.onboarding.discard(it) }
        unscheduledPlanId = null
    }

    private suspend fun finish(message: String, madePlan: Boolean) {
        session.onboarding.complete()
        results.send(SetupResult(message, madePlan))
    }

    private fun busy(failure: String, always: () -> Unit = {}, block: suspend () -> Unit) {
        if (state.value.busy) return
        mutableState.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            } finally {
                mutableState.update { it.copy(busy = false) }
            }
            always()
        }
    }
}
