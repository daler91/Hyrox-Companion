import io.gitlab.arturbosch.detekt.Detekt

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.kmp.library) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.roborazzi) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.detekt) apply false
}

// Formatting (ktlint) and static analysis (detekt) on every module. Code
// generated from docs/openapi.json and the exercise catalogue is skipped:
// it is rewritten by `pnpm mobile:models` / `pnpm mobile:catalogue`, never by hand.
subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")

    extensions.configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        filter {
            exclude { it.file.path.contains("/generated/") }
            exclude { it.file.path.contains("/build/") }
        }
    }

    extensions.configure<io.gitlab.arturbosch.detekt.extensions.DetektExtension> {
        buildUponDefaultConfig = true
        config.setFrom(rootProject.file("config/detekt.yml"))
        // KMP source sets live under src/<sourceSet>/kotlin, outside detekt's defaults.
        source.setFrom(
            fileTree("src") {
                include("**/kotlin/**/*.kt")
                exclude("**/generated/**")
            },
        )
        // Findings in code that predates detekt (the Phase 2 ports, which
        // mirror their TypeScript originals line for line) are recorded here;
        // new code is held to the rules. Regenerate with `./gradlew detektBaseline`.
        baseline = file("detekt-baseline.xml")
    }

    tasks.withType<Detekt>().configureEach {
        jvmTarget = "21"
    }
}
