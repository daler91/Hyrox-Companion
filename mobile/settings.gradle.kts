// The native app (docs/mobile-app-plan.md), in the Android Gradle Plugin 9
// layout: `androidApp` is the Android entry point only, `composeApp` holds the
// shared UI, and `core` the API client, data layer and ported logic.
pluginManagement {
    repositories {
        gradlePluginPortal()
        google {
            mavenContent {
                includeGroupAndSubgroups("androidx")
                includeGroupAndSubgroups("com.android")
                includeGroupAndSubgroups("com.google")
            }
        }
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            mavenContent {
                includeGroupAndSubgroups("androidx")
                includeGroupAndSubgroups("com.android")
                includeGroupAndSubgroups("com.google")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "fitai-mobile"

include(":core")
include(":composeApp")
include(":androidApp")
