import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          </Link>
        </div>

        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1>Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: April 12, 2026</p>

          <h2>1. Data We Collect</h2>
          <p>
            fitai.coach collects the following categories of personal data to provide and improve
            our fitness coaching service:
          </p>
          <ul>
            <li>
              <strong>Account information</strong> &mdash; email address, first and last name, and
              profile image, provided via Clerk authentication.
            </li>
            <li>
              <strong>Workout data</strong> &mdash; exercises, sets, reps, weights, distances,
              durations, RPE ratings, and notes you log manually or sync from connected services.
            </li>
            <li>
              <strong>Health metrics</strong> &mdash; heart rate, calories, cadence, and power data
              synced from Strava or Garmin.
            </li>
            <li>
              <strong>Training plans</strong> &mdash; plans you create, import, or generate via AI.
            </li>
            <li>
              <strong>Chat messages</strong> &mdash; conversations with the AI Coach.
            </li>
            <li>
              <strong>Coaching materials</strong> &mdash; documents you upload for the AI knowledge
              pipeline.
            </li>
            <li>
              <strong>Preferences</strong> &mdash; unit settings, email notification preferences,
              and training goals.
            </li>
          </ul>

          <h2>2. How We Use Your Data</h2>
          <ul>
            <li>To provide personalized workout tracking and analytics.</li>
            <li>To generate AI coaching recommendations (when you have opted in).</li>
            <li>To sync activities from connected services (Strava, Garmin).</li>
            <li>To send email notifications you have opted into (weekly summaries, reminders).</li>
            <li>To monitor and fix errors via our error tracking service.</li>
          </ul>

          <h2>3. Third-Party Data Processors</h2>
          <p>We share data with the following third-party services to operate fitai.coach:</p>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Purpose</th>
                <th>Data Shared</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Clerk</td>
                <td>Authentication</td>
                <td>Email, name, profile image</td>
              </tr>
              <tr>
                <td>Google Gemini</td>
                <td>AI coaching (opt-in only)</td>
                <td>Workout history, chat messages, training context</td>
              </tr>
              <tr>
                <td>Strava</td>
                <td>Activity sync (user-initiated)</td>
                <td>OAuth tokens; receives activity data</td>
              </tr>
              <tr>
                <td>Garmin</td>
                <td>Activity sync (user-initiated)</td>
                <td>Encrypted credentials; receives activity data</td>
              </tr>
              <tr>
                <td>Resend</td>
                <td>Email delivery (opt-in only)</td>
                <td>Email address, first name</td>
              </tr>
              <tr>
                <td>Sentry</td>
                <td>Error monitoring</td>
                <td>Error context (no PII)</td>
              </tr>
            </tbody>
          </table>

          <h2>4. AI Coach Data Processing</h2>
          <p>
            When you enable the AI Coach, your workout history, training plan details, performance
            metrics, and chat messages are sent to Google Gemini to generate personalized coaching
            responses. This data is used solely for generating responses and is not used to train AI
            models. You must explicitly opt in before any data is sent, and you can disable the AI
            Coach at any time in Settings.
          </p>

          <h2>5. Garmin Integration</h2>
          <p>
            Garmin does not offer a public OAuth API for end users. To sync Garmin activities, we
            store your Garmin email and password encrypted at rest using AES-256-GCM. We strongly
            recommend using a unique password for your Garmin account. You can disconnect your Garmin
            account at any time in Settings, which permanently deletes your stored credentials.
          </p>

          <h2>6. Data Security</h2>
          <ul>
            <li>All third-party credentials (Strava OAuth tokens, Garmin credentials) are encrypted
              at rest using AES-256-GCM.</li>
            <li>All data in transit is protected by TLS/SSL.</li>
            <li>CSRF protection via double-submit cookie pattern.</li>
            <li>Rate limiting on all API endpoints.</li>
            <li>Content Security Policy with nonce-based script loading.</li>
          </ul>

          <h2>7. Data Retention</h2>
          <ul>
            <li>Workout data, training plans, and analytics are retained for the lifetime of your
              account.</li>
            <li>Chat messages are retained until you clear your chat history or delete your
              account.</li>
            <li>Idempotency cache entries expire after 24 hours.</li>
            <li>AI usage logs are retained for 7 days.</li>
          </ul>

          <h2>8. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>
              <strong>Access</strong> your data via the export feature in Settings (JSON or CSV
              format).
            </li>
            <li>
              <strong>Delete</strong> your account and all associated data via Settings. Deletion is
              permanent and cascades to all workout logs, plans, chat messages, and connected
              service credentials.
            </li>
            <li>
              <strong>Opt out</strong> of email notifications and AI coaching at any time in
              Settings.
            </li>
            <li>
              <strong>Disconnect</strong> Strava or Garmin integrations, which removes stored
              tokens and credentials.
            </li>
          </ul>

          <h2>9. Cookies</h2>
          <p>
            fitai.coach uses the following cookies, all of which are strictly necessary for the
            application to function:
          </p>
          <ul>
            <li><strong>Authentication cookies</strong> &mdash; managed by Clerk for session
              management.</li>
            <li><strong>CSRF token</strong> &mdash; a security cookie to prevent cross-site request
              forgery.</li>
            <li><strong>Sidebar state</strong> &mdash; a preference cookie to remember your sidebar
              layout.</li>
          </ul>
          <p>We do not use tracking cookies or third-party analytics cookies.</p>

          <h2>10. Contact</h2>
          <p>
            For questions about this privacy policy or to exercise your data rights, please contact
            us through the application&apos;s Settings page.
          </p>
        </article>
      </div>
    </div>
  );
}
