package com.fitai.coach.core.fixtures

import com.fitai.coach.core.api.readTestResource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.fail

/*
 * Golden fixtures: the TypeScript originals in shared/ run over fixed inputs
 * (script/mobile-fixtures, `pnpm mobile:fixtures`) and their outputs are
 * committed as resources/fixtures/<suite>.json. A Kotlin port passes when it
 * reproduces every output. See docs/mobile-shared-logic.md.
 */

/** For encoding a port's Kotlin result to compare: defaults and nulls kept, as JS keeps them. */
public val FixtureJson: Json = Json { encodeDefaults = true }

public class FixtureCase(public val input: JsonElement, public val output: JsonElement)

public fun fixtureCases(suite: String): List<FixtureCase> {
    val text = readTestResource("fixtures/$suite.json") ?: fail("No fixture file for $suite; run `pnpm mobile:fixtures`")
    val root = Json.parseToJsonElement(text).jsonObject
    return root.getValue("cases").jsonArray.map {
        val case = it.jsonObject
        FixtureCase(case.getValue("input"), case["output"] ?: JsonNull)
    }
}

/**
 * Runs [port] on every input of [suite] and fails listing every case whose
 * output differs from the TypeScript original's. Numbers compare by value
 * (JS writes 3 where Kotlin writes 3.0), everything else exactly.
 */
public fun assertFixtureSuite(suite: String, port: (JsonElement) -> JsonElement) {
    val cases = fixtureCases(suite)
    if (cases.isEmpty()) fail("$suite has no cases")
    val failures = cases.mapIndexedNotNull { index, case ->
        val actual = runCatching { port(case.input) }.getOrElse { return@mapIndexedNotNull "#$index ${case.input}: threw $it" }
        if (jsonEquals(case.output, actual)) null else "#$index ${case.input}: expected ${case.output}, got $actual"
    }
    if (failures.isNotEmpty()) fail("$suite: ${failures.size} of ${cases.size} cases differ\n" + failures.take(50).joinToString("\n"))
}

/** JSON equality with numbers compared as doubles (so 3 == 3.0 and -0 == 0); object key order ignored. */
public fun jsonEquals(expected: JsonElement, actual: JsonElement): Boolean = when {
    expected is JsonNull || actual is JsonNull -> expected is JsonNull && actual is JsonNull
    expected is JsonObject && actual is JsonObject ->
        expected.keys == actual.keys && expected.all { (key, value) -> jsonEquals(value, actual.getValue(key)) }
    expected is JsonArray && actual is JsonArray ->
        expected.size == actual.size && expected.indices.all { jsonEquals(expected[it], actual[it]) }
    expected is JsonPrimitive && actual is JsonPrimitive -> {
        val e = if (expected.isString) null else expected.doubleOrNull
        val a = if (actual.isString) null else actual.doubleOrNull
        if (e != null && a != null) e == a else expected.isString == actual.isString && expected.content == actual.content
    }
    else -> false
}
