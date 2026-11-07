package com.fitai.coach.core.api

actual fun readTestResource(path: String): String? =
    Thread.currentThread().contextClassLoader.getResource(path)?.readText()
