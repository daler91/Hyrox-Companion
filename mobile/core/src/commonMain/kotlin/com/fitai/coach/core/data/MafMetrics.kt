package com.fitai.coach.core.data

/**
 * What a MAF test is scored from, in canonical units: heart rate in bpm,
 * duration in seconds, distance in metres. Null is a value the athlete
 * doesn't have; an average heart rate is needed for a compliance score.
 */
public data class MafMetrics(
    val avgHeartRate: Int? = null,
    val maxHeartRate: Int? = null,
    val durationSeconds: Int? = null,
    val distanceMeters: Double? = null,
)
