package com.fitai.coach.ui.format

import com.fitai.coach.core.api.ApiException

/** What to tell the athlete about a failed request: the server's own sentence when it sent one. */
fun Throwable.userMessage(fallback: String): String = when (this) {
    is ApiException -> if (status in CLIENT_ERRORS && message != null && message != "HTTP $status") message!! else fallback
    else -> fallback
}

private val CLIENT_ERRORS = 400..499
