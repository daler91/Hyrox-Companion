package com.fitai.coach.core.exercises

/*
 * The catalogue tables in shared/ are plain JS object literals, and two
 * lookups read them in ways that also see the members every object inherits
 * from Object.prototype:
 *
 *  - `slug in EXERCISE_DEFINITIONS` (normalizeExerciseName) is true for
 *    "constructor", the one inherited name a slug can spell;
 *  - `IMPLEMENT_OVERRIDES[exercise]` (implementFor) returns a function or an
 *    object, not an implement, for every name below.
 *
 * The Kotlin maps have no prototype, so the ports consult this set to give the
 * same answers. The fixture suites run every name through the TypeScript.
 */

/** `Object.getOwnPropertyNames(Object.prototype)`, as in Node 22. */
internal val JS_OBJECT_PROTOTYPE_KEYS: Set<String> = setOf(
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
)
