package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.generated.AthleteFact
import com.fitai.coach.core.api.generated.PatchAthleteFactsByIdRequest
import com.fitai.coach.core.api.generated.PostAthleteFactsRequest

/** One short statement per fact, so each can be retired and reviewed on its own (shared/athleteFacts.ts). */
const val ATHLETE_FACT_MAX_LENGTH = 140

/** Active facts a card may hold; the server refuses one more. */
const val MAX_ACTIVE_ATHLETE_FACTS = 20

/** The categories the athlete picks from, in the web's order. */
val ATHLETE_FACT_CATEGORIES: List<AthleteFact.Category> = listOf(
    AthleteFact.Category.Constraint,
    AthleteFact.Category.Equipment,
    AthleteFact.Category.Schedule,
    AthleteFact.Category.Preference,
    AthleteFact.Category.Other,
)

/** What a category is called in the app; one from a newer server reads as Other. */
fun athleteFactCategoryLabel(category: AthleteFact.Category): String = when (category) {
    AthleteFact.Category.Constraint -> "Injury or limit"
    AthleteFact.Category.Equipment -> "Equipment"
    AthleteFact.Category.Schedule -> "Schedule"
    AthleteFact.Category.Preference -> "Preference"
    AthleteFact.Category.Other, AthleteFact.Category.Unknown -> "Other"
}

/** A fact whose review date has come: the athlete is asked whether it is still true. */
fun isAthleteFactDue(reviewOn: String, today: String): Boolean = reviewOn <= today

/** The card as Settings lists it: facts due for a check first, oldest due first, then the rest as stated. */
data class AthleteCardFacts(val active: List<AthleteFact>, val retired: List<AthleteFact>) {
    val atCap: Boolean get() = active.size >= MAX_ACTIVE_ATHLETE_FACTS
}

fun groupAthleteFacts(facts: List<AthleteFact>, today: String): AthleteCardFacts {
    val (active, retired) = facts.partition { it.active }
    val (due, current) = active.partition { isAthleteFactDue(it.reviewOn, today) }
    return AthleteCardFacts(due.sortedBy { it.reviewOn } + current, retired)
}

/** A fact being reworded: its new words and category, sent only where they changed. */
data class FactEdit(val id: String, val text: String, val category: AthleteFact.Category) {
    /** What to send, or null when nothing changed (saving then just closes the editor). */
    fun changes(fact: AthleteFact): PatchAthleteFactsByIdRequest? {
        val words = text.trim().takeIf { it != fact.fact }
        val newCategory = category.takeIf { it != fact.category }?.let { patchCategory(it) }
        return if (words == null && newCategory == null) null else PatchAthleteFactsByIdRequest(fact = words, category = newCategory)
    }

    companion object {
        fun of(fact: AthleteFact) = FactEdit(fact.id, fact.fact, fact.category)
    }
}

fun postCategory(category: AthleteFact.Category): PostAthleteFactsRequest.Category =
    PostAthleteFactsRequest.Category.entries.firstOrNull { it.wireValue == category.wireValue } ?: PostAthleteFactsRequest.Category.Other

private fun patchCategory(category: AthleteFact.Category): PatchAthleteFactsByIdRequest.Category =
    PatchAthleteFactsByIdRequest.Category.entries.firstOrNull { it.wireValue == category.wireValue }
        ?: PatchAthleteFactsByIdRequest.Category.Other

/** The toast after a change to a fact is saved, as the web words it. */
fun updatedFactMessage(changes: PatchAthleteFactsByIdRequest): String = when {
    changes.confirm == true -> "Kept on your athlete card"
    changes.active == false -> "Fact retired"
    changes.active == true -> "Fact restored"
    else -> "Fact updated"
}

/** The toast after the older note is moved onto the card; part of it may not fit. */
fun importedNoteMessage(added: Long, skipped: Long): String = if (skipped > 0) {
    "Your card is full. Added $added of ${added + skipped}. Your note stays until you retire facts to make room for the rest."
} else {
    "Note added to your athlete card"
}

/** The hint under the new fact's field. */
fun addFactHint(atCap: Boolean): String = if (atCap) {
    "Your card holds up to $MAX_ACTIVE_ATHLETE_FACTS facts. Retire one that no longer applies to add another."
} else {
    "One thing per fact, in your own words. It stays on your card until you retire it."
}

/** A step the athlete confirms first: retiring or deleting a fact, or removing the older note. */
sealed interface AthleteCardConfirm {
    data class Retire(val fact: AthleteFact) : AthleteCardConfirm

    data class Delete(val fact: AthleteFact) : AthleteCardConfirm

    data object RemoveNote : AthleteCardConfirm
}
