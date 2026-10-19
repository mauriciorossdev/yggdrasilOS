# Yggdrasil mobile

Flutter client for a Yggdrasil gateway (chat, voice, files, phone-side tools).

## Build

```bash
cd mobile/app
flutter pub get
flutter run
```

## Firebase (push notifications)

Push notifications use Firebase Cloud Messaging (`lib/services/push_service.dart`). The repository does **not**
ship a Firebase configuration: create your own project and add its client config.

1. Create a project in the [Firebase console](https://console.firebase.google.com/) and add an Android app whose
   package name matches `applicationId` in `android/app/build.gradle.kts`
   (change both if you want your own id).
2. Download `google-services.json` into `android/app/` (use `google-services.json.example` as a reference for the
   shape). The file is git-ignored; never commit it.
3. For iOS, add `GoogleService-Info.plist` to `ios/Runner/` (also git-ignored).

Without these files the Android build fails at the `com.google.gms.google-services` Gradle plugin. If you do not need
push notifications, remove that plugin from `android/app/build.gradle.kts` and the Firebase calls in `push_service.dart`.
