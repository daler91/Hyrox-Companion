package com.fitai.coach.core.api

/** A file from commonTest/resources, or null when there is none. Per-platform: JVM reads the classpath. */
expect fun readTestResource(path: String): String?
