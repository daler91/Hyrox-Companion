package com.fitai.coach.core.dates

import java.util.TimeZone

// The zone the athlete picked in the phone's settings (or the network set).
internal actual fun systemZoneId(): String? = TimeZone.getDefault()?.id
