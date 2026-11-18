plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firebase (push) needs google-services.json, which isn't in the repo. Without
// it the build still works and push just stays off: PushService catches the
// failed Firebase.initializeApp.
val hasGoogleServicesJson = file("google-services.json").exists() ||
    fileTree("src") { include("**/google-services.json") }.files.isNotEmpty()
if (hasGoogleServicesJson) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle("google-services.json not found: building without Firebase (push disabled).")
}

android {
    namespace = "com.mauriciorossdev.yggdrasil"
    // permission_handler_android (voice input, home-screen-voice-input-ux.md)
    // requires compileSdk 37 — flutter.compileSdkVersion still defaults to 36.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.mauriciorossdev.yggdrasil"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLabel"] = "Yggdrasil"
    }

    buildTypes {
        debug {
            // Lets a debug build install next to the release app (different signing key).
            // src/debug/google-services.json carries the matching Firebase client.
            applicationIdSuffix = ".dev"
            manifestPlaceholders["appLabel"] = "Yggdrasil Dev"
        }
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

