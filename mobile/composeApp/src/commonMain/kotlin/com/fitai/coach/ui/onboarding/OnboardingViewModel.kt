package com.fitai.coach.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.NutritionTarget
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.GenerationOutcome
import com.fitai.coach.core.data.MacroTargets
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.data.isNutritionOff
import com.fitai.coach.core.data.storedPeriodization
import com.fitai.coach.core.dates.nextPlanStartDate
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.nutrition.NutritionTargetInput
import com.fitai.coach.core.nutrition.PeriodizationChoice
import com.fitai.coach.core.nutrition.WeightGoalDirection
import com.fitai.coach.core.nutrition.calculateNutritionTarget
import com.fitai.coach.core.nutrition.carryPeriodizationForward
import com.fitai.coach.core.nutrition.nextPeriodizationSettings
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

enum class SetupStep { Welcome, Units, Goal, Fuelling, Coach, Plan, AiPlan, Generating, Schedule }

/**
 * The numbered steps, for "step 3 of 6". The fuelling step is there only with
 * nutrition on: without it the targets have nowhere to go. The AI form, its
 * wait and the template's date belong to the plan step.
 */
fun numberedSteps(fuelling: Boolean): List<SetupStep> =
    listOfNotNull(
        SetupStep.Welcome,
        SetupStep.Units,
        SetupStep.Goal,
        SetupStep.Fuelling.takeIf {
            fuelling
        },
        SetupStep.Coach,
        SetupStep.Plan,
    )

fun stepNumber(step: SetupStep, fuelling: Boolean): Int {
    val steps = numberedSteps(fuelling)
    return steps.indexOf(step).takeIf { it >= 0 }?.plus(1) ?: steps.size
}

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
    /** The athlete's plans: "Run setup again" is where an established athlete switches plans. */
    val plans: List<TrainingPlan> = emptyList(),
    /** Whether the fuelling step shows: off only once the server says nutrition is. */
    val fuellingOn: Boolean = true,
    val fuelling: FuellingFields = FuellingFields(),
    val savedBody: SavedBody = SavedBody(),
    /** The daily target in force, once [targetsLoaded]: a fuelling save carries its periodisation forward. */
    val currentTarget: NutritionTarget? = null,
    val targetsLoaded: Boolean = false,
    /** The athlete's answer to "set these as my targets"; null until touched. */
    val applyTargetsChoice: Boolean? = null,
) {
    /** The body profile the fuelling step previews and saves, or null while incomplete. */
    val fuellingProfile: NutritionTargetInput? get() = resolveFuellingProfile(fuelling, profile, savedBody)

    /** The profile is what is saved: a re-run then saves nothing unless asked to set the targets. */
    val fuellingUnchanged: Boolean get() = fuellingProfile?.let { isSavedFuellingProfile(it, savedBody) } == true

    /**
     * Whether Continue sets the suggested targets. On, unless that would
     * replace a target (or one that may exist, still loading) over an
     * untouched profile; whatever the switch shows is what happens.
     */
    val applyTargets: Boolean get() = applyTargetsChoice ?: (!mayHaveTarget || !fuellingUnchanged)

    /** A target exists, or may: until they load, one must not be replaced unasked. */
    private val mayHaveTarget: Boolean get() = !targetsLoaded || currentTarget != null

    /** The live plans an AI plan from [form]'s dates would run over. */
    fun overlapping(form: PlanForm): List<TrainingPlan> = findOverlappingPlans(plans, form.startDate, form.endDate, today)
}

/** Why setup closed, with what to tell the athlete, and whether to offer connecting Strava or Garmin. */
data class SetupResult(val message: String, val madePlan: Boolean, val offerConnect: Boolean = false)

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

    /** The older free-text injuries note, prefilled into the AI plan form while the athlete has one. */
    private var rememberedNote: String? = null

    /** A template created whose schedule then failed: a retry reuses it, any other way out deletes it. */
    private var unscheduledPlanId: String? = null
    private var generation: Job? = null

    /** The fuelling step's weight goal was picked, so the goal step no longer suggests one. */
    private var goalPicked = false

    init {
        viewModelScope.launch {
            val prefs = session.preferences.preferences.first() ?: runCatching { session.preferences.refresh() }.getOrNull()
            timeZone = prefs?.userTimezone
            saved = SetupProfile.from(prefs)
            val body = SavedBody.from(prefs)
            mutableState.update {
                it.copy(
                    profile = saved,
                    today = todayIn(timeZone),
                    aiCoachSaved = saved.aiCoachEnabled,
                    savedBody = body,
                    fuelling = FuellingFields.from(body, saved.weightUnit, it.goalId),
                )
            }
        }
        viewModelScope.launch { loadTargets() }
        viewModelScope.launch { rememberedNote = session.account.user.first()?.trainingConstraints }
        viewModelScope.launch { session.timeline.plans.collect { plans -> mutableState.update { it.copy(plans = plans.orEmpty()) } } }
    }

    /** A changed weight unit converts a typed bodyweight with it. */
    fun edit(change: (SetupProfile) -> SetupProfile) = mutableState.update { s ->
        val next = change(s.profile)
        val bodyweight = convertTypedWeight(s.fuelling.bodyweight, s.profile.weightUnit, next.weightUnit)
        s.copy(profile = next, ageError = null, fuelling = s.fuelling.copy(bodyweight = bodyweight))
    }

    /** "Lose weight" starts the fuelling step's weight goal on lose, until one is saved or picked. */
    fun setGoal(id: String) = mutableState.update { s ->
        val direction = if (goalPicked || s.savedBody.goalDirection != null) {
            s.fuelling.goalDirection
        } else if (id == "weight_loss") {
            WeightGoalDirection.Lose
        } else {
            WeightGoalDirection.Maintain
        }
        s.copy(goalId = id, fuelling = s.fuelling.copy(goalDirection = direction))
    }

    fun editFuelling(change: (FuellingFields) -> FuellingFields) = mutableState.update { s ->
        val next = change(s.fuelling)
        if (next.goalDirection != s.fuelling.goalDirection) goalPicked = true
        s.copy(fuelling = next)
    }

    fun setApplyTargets(on: Boolean) = mutableState.update { it.copy(applyTargetsChoice = on) }

    fun setRaceDate(date: String) = mutableState.update { it.copy(raceDate = date, raceDateError = null) }

    fun editPlan(change: (PlanForm) -> PlanForm) = mutableState.update { s -> s.copy(planForm = s.planForm?.let(change)) }

    fun setStartDate(date: String) = mutableState.update { it.copy(startDate = date) }

    fun next() {
        when (state.value.step) {
            SetupStep.Welcome -> go(SetupStep.Units)
            SetupStep.Units -> saveUnits()
            SetupStep.Goal -> checkGoal()
            SetupStep.Fuelling -> saveFuelling()
            SetupStep.Coach -> saveCoach()
            else -> Unit
        }
    }

    fun back() {
        val previous = when (state.value.step) {
            SetupStep.Units -> SetupStep.Welcome
            SetupStep.Goal -> SetupStep.Units
            SetupStep.Fuelling -> SetupStep.Goal
            SetupStep.Coach -> if (state.value.fuellingOn) SetupStep.Fuelling else SetupStep.Goal
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
        mutableState.update {
            it.copy(
                planForm = it.planForm ?: PlanForm.initial(goal, todayNow(), s.raceDate).withRememberedNote(rememberedNote),
                step = SetupStep.AiPlan,
            )
        }
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
            "Your training plan is ready! Workouts are on your timeline. Connect Strava or Garmin to log them automatically.",
            madePlan = true,
            offerConnect = true,
        )
    }

    /** Starts the AI plan and waits for it, showing the wait. */
    fun generate() {
        val form = state.value.planForm?.takeIf { it.canGenerate } ?: return
        val supersede = form.supersedeIds(state.value.overlapping(form))
        if (generation?.isActive == true) return
        generation = viewModelScope.launch {
            mutableState.update { it.copy(busy = true) }
            val planId = try {
                session.onboarding.generate(form.toRequest(supersede))
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
        finish(
            "Setup finished without a plan. Add one anytime from Plan tools, or run setup again from Settings.",
            madePlan = false,
            offerConnect = true,
        )
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
        if (problem == null) go(if (state.value.fuellingOn) SetupStep.Fuelling else SetupStep.Coach)
    }

    /**
     * The daily target in force, for the fuelling step: whether to say it will
     * be replaced, and the periodisation a save carries forward. Nutrition
     * switched off on the server hides the step; any other failure leaves the
     * target unknown (so the switch starts off over an unchanged profile).
     */
    private suspend fun loadTargets() {
        try {
            val current = session.nutrition.targets.current()
            mutableState.update { it.copy(currentTarget = current, targetsLoaded = true) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            if (e.isNutritionOff()) mutableState.update { it.copy(fuellingOn = false) }
        } catch (_: Exception) {
            // Unknown: the step shows, and a save looks the target up again.
        }
    }

    /**
     * The optional fuelling step's Continue (handleFuellingNext): a complete
     * profile is saved where it changed, and the suggested targets set unless
     * declined. An incomplete one just moves on. A failed save says where to
     * finish the job and moves on too: nutrition never holds up setup.
     */
    private fun saveFuelling() {
        val s = state.value
        val problem = ageError(s.profile.age)
        if (problem != null) {
            mutableState.update { it.copy(ageError = problem) }
            return
        }
        val input = s.fuellingProfile
        if (input == null || (s.fuellingUnchanged && !s.applyTargets)) {
            go(SetupStep.Coach)
            return
        }
        busy("Could not save your fuelling profile.", always = { go(SetupStep.Coach) }) { saveFuellingProfile(input, s) }
    }

    /** Saves the profile where it changed and sets the targets if asked; a failure says where to finish the job. */
    private suspend fun saveFuellingProfile(input: NutritionTargetInput, s: OnboardingUiState) {
        try {
            if (!s.fuellingUnchanged) {
                session.preferences.update(input.toPreferences())
                saved = saved.copy(age = input.ageYears.toInt().toString())
                mutableState.update { it.copy(savedBody = input.toSavedBody()) }
            }
            if (s.applyTargets) setTargets(input, s)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val reason = e.userMessage("Something went wrong.").let { if (it.endsWith(".")) it else "$it." }
            toasts.send("Could not save your fuelling profile. $reason You can set it up later in Nutrition → Targets.")
        }
    }

    /** Sets the targets [input] suggests as a new version, keeping the current one's periodisation. */
    private suspend fun setTargets(input: NutritionTargetInput, s: OnboardingUiState) {
        val target = calculateNutritionTarget(input)
        val current = if (s.targetsLoaded) s.currentTarget else session.nutrition.targets.current()
        val periodization = current?.let { carryPeriodizationForward(it.storedPeriodization(), target.carbG) }
            ?: nextPeriodizationSettings(
                null,
                PeriodizationChoice(target.carbG, periodize = false, recoveryEnabled = false, phaseAware = false),
                null,
            )
        session.nutrition.targets.save(MacroTargets(target.calories, target.proteinG, target.carbG, target.fatG), periodization, todayNow())
        toasts.send(
            "Daily fuelling targets set: ${jsNumberToString(target.calories)} kcal · ${jsNumberToString(target.proteinG)} g protein " +
                "to start. Adjust them anytime in Nutrition.",
        )
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

    private suspend fun finish(message: String, madePlan: Boolean, offerConnect: Boolean = false) {
        session.onboarding.complete()
        results.send(SetupResult(message, madePlan, offerConnect))
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
