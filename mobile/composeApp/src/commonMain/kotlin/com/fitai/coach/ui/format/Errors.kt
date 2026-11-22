package com.fitai.coach.ui.format

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.structure.StructureLintException

/**
 * What to tell the athlete about a failed request: the server's own sentence
 * when it sent one, or the one it would send for a structure it would refuse.
 */
fun Throwable.userMessage(fallback: String): String = when (this) {
    is ApiException -> if (status in CLIENT_ERRORS && message != null && message != "HTTP $status") message!! else fallback
    is StructureLintException -> message ?: fallback
    else -> fallback
}

private val CLIENT_ERRORS = 400..499
