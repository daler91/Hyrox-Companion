package com.fitai.coach.ui.session

import androidx.compose.runtime.staticCompositionLocalOf
import com.fitai.coach.core.data.UserSession

/**
 * The signed-in user's session (database, repositories, API), provided by
 * SignedInRoot to every screen under it.
 */
val LocalUserSession = staticCompositionLocalOf<UserSession> { error("No signed-in session: read LocalUserSession under SignedInRoot") }
