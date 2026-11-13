# Play Console: answers for the Android app

What to enter in Play Console for `com.fitai.coach`, drawn from the code as of
Phase 6 (docs/mobile-app-plan.md). Re-check it whenever the app starts
collecting something new, and keep it in step with the privacy policy
(`client/src/pages/Privacy.tsx`, served at https://fitai.coach/privacy).

## Store listing and policy links

| Field | Value |
| --- | --- |
| Privacy policy | https://fitai.coach/privacy |
| Account deletion (web link) | https://fitai.coach/delete-account (`client/src/pages/DeleteAccount.tsx`): public, no app needed, lists the steps, what is deleted and what is kept |
| In-app deletion | Settings → Account → Delete my account (type DELETE), which calls `DELETE /api/v1/account` |
| Category | Health & Fitness |

## Data safety

"Collected" means the app sends it off the device. Processors acting for
fitai.coach (Clerk, the AI provider, Google Gemini for photos, Resend, FCM)
are service providers, which Play does not count as sharing. Nothing is sold
or used for advertising. All traffic is HTTPS (`usesCleartextTraffic="false"`).

| Data type | Collected | Optional? | Purposes | Notes |
| --- | --- | --- | --- | --- |
| Personal info: name, email address | Yes | Required (account) | Account management, App functionality | From sign-in (Clerk) |
| Health and fitness: health info | Yes | Optional | App functionality, Personalisation | Body profile (weight, height, age, gender, resting/max HR, FTP), MAF answers incl. injury, illness and medication |
| Health and fitness: fitness info | Yes | Required for the core app | App functionality, Analytics (in-app), Personalisation | Workouts, sets, RPE, heart rate, distance, calories; from logging, Strava, Garmin and Health Connect |
| Photos | Yes | Optional | App functionality | Workout, meal, label and coach photos the athlete picks or takes; parsed by Google Gemini |
| Audio | No | | | Dictation uses the phone's speech recogniser; the app receives only the text |
| Messages: other in-app messages | Yes | Optional (AI Coach is opt-in) | App functionality, Personalisation | AI Coach conversations |
| App activity: other user-generated content | Yes | Optional | App functionality | Notes, food log, recipes, custom foods (publicly shared custom foods are visible to others, unlinked) |
| Device or other IDs | Yes | Optional (push is opt-in) | App functionality | FCM registration token and Firebase installation ID, only once push is turned on |
| App info and performance: crash logs, diagnostics | No | | | The Android app has no crash reporter yet. Sentry runs in the web app only; if one is added to the app, update this row |
| Location | No | | | Strava's GPS track is deliberately not fetched (server/strava.ts); Health Connect routes are not read |
| Financial info, contacts, calendar, files, web history | No | | | |

Answer "Yes" to: data is encrypted in transit; users can request deletion
(both in the app and through the web link above).

Barcode scanning uses Google's code scanner (ML Kit, through Play services).
The scan runs on the phone and only the digits reach fitai.coach. Google's own
SDK may send device and usage diagnostics to Google. Check its current data
disclosure (ML Kit's "Data disclosure" page) before submitting the form, and
add what it lists to the rows above.

## Health Connect declaration

Permissions requested (androidApp/src/main/AndroidManifest.xml), each read-only:

| Permission | Why |
| --- | --- |
| `READ_EXERCISE` | Import the athlete's workouts from their watch or other fitness apps into their training log |
| `READ_HEART_RATE` | Average and maximum heart rate for each imported workout, used for training load and the coach |
| `READ_DISTANCE` | Distance and pace of each imported workout |
| `READ_ACTIVE_CALORIES_BURNED` | Energy burned in each workout, used for nutrition targets |
| `READ_HEALTH_DATA_IN_BACKGROUND` | Keep the log current without opening the app (a sync every few hours) |

- Data is read only for sessions' spans and only from the app that recorded each session.
- It is never written back, sold, used for advertising, or shared beyond the processors that run the features the athlete uses.
- The permissions rationale is `HealthPermissionsRationaleActivity`, which Health Connect opens; it links to the privacy policy.
- The privacy policy's "Android App" section carries the Limited Use statement.

## Content rating

Health & Fitness reference app. No violence, sexual content, gambling, drugs or
location sharing. Two answers need care:

- **User-generated content**: athletes can publish custom foods (name and
  nutrition values) for others to use, with no link to their account.
- **AI-generated content**: the AI Coach writes chat replies and plans. Play's
  AI-generated content policy needs an in-app way to report offensive output:
  every coach reply has thumbs up / down (CoachRepository.rate), which is that
  path; say so in the declaration.

## App access (reviewer login)

Sign-in is an emailed one-time code or Google, so a reviewer cannot use a
normal account without the inbox. **Decide before the first review**:

1. Give the reviewer a dedicated account with a password (enable password
   sign-in in Clerk for that account and add a password option to the sign-in
   screen), or
2. Use a Clerk test address on a separate review instance, where codes are fixed.

Whichever it is, enter the credentials under App content → App access, and
keep the account's data realistic (a plan, a few workouts).

## Target API level

`targetSdk` is 36 (androidApp/build.gradle.kts), which Play requires of new
apps and updates now. Android lint's OldTargetApi check is turned off with that
note; moving to 37 is a separate change, tested against Android 17's behaviour
changes, before Play's next yearly deadline.

## Before production

- New personal developer accounts must run a closed test (the alpha track,
  `mobile-promote.yml`) with at least 12 testers for 14 days before
  production access opens.
- Register the upload key's and Play's app signing key's SHA-256 fingerprints
  in `ANDROID_APP_CERT_SHA256` on the server, so App Links (emails, the Strava
  return) verify (server/bootstrap/wellKnown.ts).
