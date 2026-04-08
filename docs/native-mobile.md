# Native Mobile App Investigation: Capacitor vs React Native

## Recommendation: Capacitor

Capacitor is the recommended path for wrapping fitai.coach as a native mobile app. It avoids a full UI rewrite while enabling native features.

## Why Capacitor Over React Native

| Factor | Capacitor | React Native |
|--------|-----------|--------------|
| UI rewrite required | No — runs existing web app in WebView | Yes — all 27 shadcn/ui components need replacement |
| Estimated effort | 2-3 weeks (basic), 4-6 weeks (production) | 3-4 months |
| Tailwind CSS | Works as-is | Requires NativeWind or custom mapping |
| Radix UI / shadcn | Works as-is | Incompatible — needs React Native Paper or similar |
| Routing (wouter) | Works as-is | Compatible but needs adaptation |
| TanStack Query | Works as-is | Compatible |
| Native APIs | Via Capacitor plugins | Built-in |

## What Capacitor Enables

- **App Store / Play Store distribution** — installable from stores, not just PWA
- **Native push notifications** (APNs + FCM) — more reliable than web push, especially on iOS
- **HealthKit / Google Fit integration** — via `@capacitor-community/health-connect`
- **Background app refresh** — for Strava sync and notification checks
- **Native splash screen + app icon** — proper first-launch experience
- **Haptic feedback** — for workout completion, PR celebrations
- **Camera/Photos** — future progress photo feature

## Current Web-Only Dependencies

| Dependency | Capacitor Impact | Notes |
|------------|-----------------|-------|
| Web Speech API (voice input) | Partial — may need `@nicehash/capacitor-speech-recognition` plugin | Works in some WebViews |
| localStorage | Works in WKWebView/Android WebView | No changes needed |
| Service Worker / PWA | Disabled in native shell | Use native push instead |
| Clerk Auth | Works in WebView | May need deep linking config for OAuth |
| CSS variables + Tailwind | Full support | WebView renders standard CSS |
| Recharts (SVG charts) | Full support | WebView renders SVG |

## Implementation Steps

### Phase 1: Basic Wrapper (2-3 weeks)
1. `npm install @capacitor/core @capacitor/cli`
2. `npx cap init fitai.coach com.fitai.coach --web-dir dist/public`
3. `npx cap add ios && npx cap add android`
4. Configure `capacitor.config.ts` (server URL for dev, bundled assets for prod)
5. Add `@capacitor/splash-screen` and `@capacitor/status-bar` plugins
6. Build and test on iOS Simulator + Android Emulator
7. Set up app icons and splash screens

### Phase 2: Native Push (1 week)
1. Add `@capacitor/push-notifications` plugin
2. Configure APNs certificate (Apple Developer Account required)
3. Configure FCM (Firebase project required)
4. Add platform detection: if Capacitor, use native push; if web, use web push
5. Bridge native push tokens to server-side delivery

### Phase 3: App Store Submission (1 week)
1. Prepare App Store Connect metadata (screenshots, description, keywords)
2. Prepare Google Play Console listing
3. Build signed release builds
4. Submit for review
5. Address any review feedback

### Phase 4: Native Enhancements (ongoing)
- HealthKit / Google Fit sync
- Native voice recognition (if Web Speech API doesn't work in WebView)
- Offline SQLite caching (future)
- Widget for today's workout

## Files That Would Change

### New Files
- `capacitor.config.ts` — Capacitor project configuration
- `ios/` — Xcode project (auto-generated)
- `android/` — Android Studio project (auto-generated)

### Modified Files
- `package.json` — Add `@capacitor/*` dependencies
- `client/src/main.tsx` — Detect Capacitor runtime, use native APIs
- `client/src/hooks/usePushNotifications.ts` — Add Capacitor push branch
- Build scripts — Add `npx cap sync` step after `pnpm build`

## Cost Considerations

- **Apple Developer Account:** $99/year
- **Google Play Developer Account:** $25 one-time
- **Firebase (FCM):** Free tier sufficient for push
- **No additional hosting** — app bundles the web assets

## Decision Criteria

Choose Capacitor if:
- You want App Store presence quickly
- Native push notifications are the primary driver
- The current web UI is acceptable on mobile
- You don't need deep OS integration beyond push + HealthKit

Choose React Native if:
- You need 60fps native animations and gestures
- You want platform-specific UI (iOS vs Android patterns)
- You plan to add complex native features (camera overlays, AR, etc.)
- You have 3-4 months of development time available
