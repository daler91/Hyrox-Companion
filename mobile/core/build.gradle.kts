plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    // JVM only for now: it compiles and runs commonTest on any machine, which
    // is what the generated API models and the golden-fixture parity tests
    // need. Phase 3 adds the Android target (Android Gradle Plugin) and the
    // iOS targets (macOS host) to this same module.
    jvm()
    jvmToolchain(21)

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}
