package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.RecycleBinItem
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.dates.localDateOf
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.userMessage

/** What a deleted record is called (the web's TYPE_LABEL); one from a newer server is just an item. */
fun recycleBinTypeLabel(type: RecycleBinItem.EntityType): String = when (type) {
    RecycleBinItem.EntityType.WorkoutLog -> "Workout"
    RecycleBinItem.EntityType.PlanDay -> "Plan day"
    RecycleBinItem.EntityType.TrainingPlan -> "Training plan"
    RecycleBinItem.EntityType.Unknown -> "Item"
}

/** "expires today", "expires tomorrow", "expires in 87 days", counted in calendar days. */
fun expiryCopy(expiresOn: String, today: String): String = when (val days = dayDiff(today, expiresOn) ?: 0) {
    in Int.MIN_VALUE..0 -> "expires today"
    1 -> "expires tomorrow"
    else -> "expires in $days days"
}

/** "Deleted today", "Deleted yesterday", "Deleted 3 days ago". */
fun deletedCopy(deletedOn: String, today: String): String = when (val days = dayDiff(deletedOn, today) ?: 0) {
    in Int.MIN_VALUE..0 -> "Deleted today"
    1 -> "Deleted yesterday"
    else -> "Deleted $days days ago"
}

/** The item's line under its name: its own date, when it was deleted and when it goes for good, in the athlete's timezone. */
fun recycleBinMeta(item: RecycleBinItem, today: String, timeZone: String?): String = listOfNotNull(
    item.entityDate?.let(::shortDate),
    localDateOf(item.deletedAt, timeZone)?.let { deletedCopy(it, today) },
    localDateOf(item.expiresAt, timeZone)?.let { expiryCopy(it, today) },
).joinToString(" · ")

/** The toast after a restore; what couldn't be put back exactly follows, in the server's words. */
fun restoredMessage(warnings: List<String>): String = (listOf("Restored") + warnings).joinToString(" ")

/** Why a restore was refused: the plan overlap gets the web's advice, the rest the server's words. */
fun restoreFailure(error: Throwable): String = if (
    error is ApiException && (error.code == "PLAN_OVERLAP" || error.message.orEmpty().contains("already covers"))
) {
    "Can't restore this plan yet. Another plan already covers these dates. Archive that one first."
} else {
    error.userMessage("Couldn't restore")
}

fun emptiedMessage(count: Long): String = if (count == 1L) "1 item deleted forever" else "$count items deleted forever"

/** "1 item", "3 items". */
fun itemCount(count: Long): String = if (count == 1L) "1 item" else "$count items"

/** A final step the athlete confirms first: deleting one item forever, or emptying the bin. */
sealed interface RecycleBinConfirm {
    data class Purge(val item: RecycleBinItem) : RecycleBinConfirm

    data object Empty : RecycleBinConfirm
}
