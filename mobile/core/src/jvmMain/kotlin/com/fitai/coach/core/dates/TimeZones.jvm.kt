package com.fitai.coach.core.dates

import java.time.ZoneId

internal actual fun systemZoneId(): String? = ZoneId.systemDefault().id
