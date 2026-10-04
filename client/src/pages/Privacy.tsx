import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function Privacy() {
  useDocumentTitle("Privacy");
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
          <p className="text-muted-foreground">Last updated: October 4, 2026</p>

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
              <strong>Health metrics</strong> &mdash; heart rate (including per-session heart-rate
              and pace series), calories, cadence, and power data synced from Strava or Garmin.
            </li>
            <li>
              <strong>Body and health profile</strong> &mdash; bodyweight, height, age, gender,
              resting and maximum heart rate, FTP, activity level, weight goal, training constraints,
              and your MAF heart-rate questionnaire answers (including injury, illness and medication)
              and test results.
            </li>
            <li>
              <strong>Nutrition</strong> &mdash; your food log, meal descriptions and photos, nutrition
              label photos, nutrition targets, favourite foods, recipes, and custom foods.
            </li>
            <li>
              <strong>Training plans</strong> &mdash; plans you create, import, or generate via AI,
              and changes you or the coach make to them.
            </li>
            <li>
              <strong>Chat messages</strong> &mdash; conversations with the AI Coach, including photos
              you attach.
            </li>
            <li>
              <strong>Coaching materials</strong> &mdash; documents you upload for the AI knowledge
              pipeline.
            </li>
            <li>
              <strong>Notes about your training</strong> &mdash; weekly review intents, timeline
              annotations, and facts on your athlete card.
            </li>
            <li>
              <strong>Preferences and consents</strong> &mdash; unit settings, notification
              preferences, training goals, your consent decisions, and the push-notification address of
              each device you enable.
            </li>
          </ul>
          <p>
            Heart-rate data, the body and health profile, MAF answers and nutrition logs are health
            data. We use them only to provide the features you use.
          </p>

          <h2>2. How We Use Your Data</h2>
          <ul>
            <li>To provide personalized workout tracking and analytics.</li>
            <li>To generate AI coaching recommendations (when you have opted in).</li>
            <li>To sync activities from connected services (Strava, Garmin).</li>
            <li>To look up the foods you search for or scan.</li>
            <li>To send email and push notifications you have opted into (weekly summaries,
              reminders, session briefs, coach insights).</li>
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
                <td>Configured AI text provider (Google Gemini by default)</td>
                <td>AI coaching, chat, plan generation, text parsing (opt-in only)</td>
                <td>Workout history, training plans, performance and body metrics, chat messages,
                  meal and workout descriptions, coaching materials</td>
              </tr>
              <tr>
                <td>Google (Gemini API), whichever text provider is configured</td>
                <td>Photo parsing and search embeddings</td>
                <td>Meal, nutrition-label, workout and chat photos, plus coaching-material text and
                  chat questions turned into search embeddings (all opt-in only); food searches and
                  food names, including your custom foods, when semantic food search is enabled</td>
              </tr>
              <tr>
                <td>Open Food Facts, USDA FoodData Central, Edamam</td>
                <td>Food search and barcode lookup</td>
                <td>The search terms and barcodes you enter, without your name or account</td>
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
                <td>Email address, first name, and each email&rsquo;s content: training summaries,
                  reminders, session briefs, coach insights and race predictions</td>
              </tr>
              <tr>
                <td>Your browser&rsquo;s push service (e.g. Google, Mozilla, Apple, Microsoft)</td>
                <td>Push notifications (opt-in only)</td>
                <td>Your device&rsquo;s push address and end-to-end encrypted notification
                  content</td>
              </tr>
              <tr>
                <td>Sentry</td>
                <td>Error monitoring</td>
                <td>Error reports with personal data scrubbed (in your browser only if you have not
                  declined error reporting)</td>
              </tr>
            </tbody>
          </table>

          <h2>4. AI Coach Data Processing</h2>
          <p>
            When you enable the AI Coach, your workout history, training plan details, performance
            and body metrics, chat messages, and the meals and workouts you describe or photograph
            are sent to an AI provider to generate personalized coaching responses and parse your
            entries. This data is used by this app solely for those features. You must explicitly opt
            in first, and you can disable the AI Coach at any time in Settings.
          </p>
          <p>
            Text goes to the configured text provider. fitai.coach&rsquo;s default is{" "}
            <strong>Google Gemini</strong>; an operator may instead configure Anthropic or an
            OpenAI-compatible endpoint (such as OpenAI, xAI, Groq, Together, OpenRouter or DeepSeek).
            Photos and search embeddings always go to <strong>Google Gemini</strong>, whichever text
            provider is configured, so Google&rsquo;s Gemini API terms apply to them in every case.
          </p>
          <p>
            Once your data reaches a provider, its handling is governed by that provider&rsquo;s
            data-processing agreement (DPA) and retention policy rather than by fitai.coach. We do not
            authorize providers to use your data to train their models, but we cannot control a
            provider&rsquo;s independent retention windows, so we recommend reviewing their privacy
            and data-retention policies.
          </p>

          <h2>5. Garmin Integration</h2>
          <p>
            Garmin does not offer a public OAuth API for end users. To sync Garmin activities, we
            store your Garmin email and password encrypted at rest using AES-256-GCM. We strongly
            recommend using a unique password for your Garmin account. You can disconnect your Garmin
            account at any time in Settings, which permanently deletes your stored credentials. If a
            Garmin connection repeatedly fails to sync, we also clear the stored credentials
            automatically and ask you to reconnect, so they are not kept for a connection that is no
            longer working.
          </p>
          <p>
            Because Garmin does not publish a token-revocation endpoint, disconnecting or deleting
            your account removes your credentials and session tokens from fitai.coach but cannot
            actively invalidate any tokens still cached on Garmin&rsquo;s side. Those tokens expire
            naturally over time. If you want to invalidate them immediately, change your Garmin
            password &mdash; that revokes all existing Garmin sessions, including any our system may
            have held.
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
            <li>Records you delete stay in the recycle bin for 90 days so you can restore them, then
              are removed.</li>
            <li>Idempotency cache entries expire after 7 days.</li>
            <li>Offline workout-save queue entries stay on your device until they sync, expire,
              are dropped after retry limits, or you sign out/delete your account.</li>
            <li>AI usage logs are retained for 7 days.</li>
            <li>A device&rsquo;s push subscription is kept until you turn notifications off or sign
              out on that device.</li>
            <li>Data sent to an AI provider (Section 4) is retained according to that
              provider&rsquo;s data-processing terms, not by fitai.coach; consult the
              provider&rsquo;s policy for specifics.</li>
          </ul>

          <h2>8. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>
              <strong>Access</strong> your data via the export feature in Settings. The JSON export
              covers the data we hold for your account: profile and body metrics, preferences,
              workout timeline, every training plan with all its days, exercise sets, heart-rate
              streams, nutrition log, targets, favourites, recipes and custom foods, MAF tests,
              weekly reviews, chat history with the AI coach, uploaded coaching materials, athlete
              card facts, custom exercises, timeline annotations, plan-change proposals and session
              moves, stored coach insights and race predictions, consent records, training-style
              history, recycle-bin contents, AI usage logs, push-notification endpoints, and metadata
              for connected Strava and Garmin accounts. OAuth tokens, stored credentials, and
              push-message encryption keys are intentionally excluded so a leaked export file cannot
              be used to act on your behalf with third parties. Server-internal records are left out
              too: the short-lived request-replay cache, the search index built from your coaching
              materials (whose text is exported), and data-migration bookkeeping. The CSV export is
              workout-focused and intended for spreadsheet use.
            </li>
            <li>
              <strong>Delete</strong> your account and all associated data via Settings. Deletion is
              permanent and cascades to all workout logs, plans, chat messages, and connected
              service credentials, and erases your private custom foods (including their search
              index entries). It also clears unsynced local workout saves and drafts on the current
              device. One exception: custom foods you have explicitly shared publicly (via the
              &ldquo;Share publicly&rdquo; toggle) remain available to other users after deletion,
              with no link back to you &mdash; unshare them before deleting your account if you
              don&rsquo;t want that.
            </li>
            <li>
              <strong>Opt out</strong> of email notifications, AI coaching, and error-diagnostics
              reporting (Sentry) at any time in Settings. Each third-party processor can be disabled
              independently.
            </li>
            <li>
              <strong>Disconnect</strong> Strava or Garmin integrations, which removes stored
              tokens and credentials.
            </li>
          </ul>

          <h2>9. California Privacy Rights (CCPA/CPRA)</h2>
          <p>
            If you are a California resident, the California Consumer Privacy Act (as amended by the
            CPRA) gives you the rights to know, access, delete, and correct the personal information
            we hold, and to not be discriminated against for exercising them. The access and deletion
            controls in <strong>Section 8</strong> apply to these rights.
          </p>
          <h3>Do Not Sell or Share My Personal Information</h3>
          <p>
            We do <strong>not</strong> sell your personal information, and we do not share it for
            cross-context behavioral advertising. The only sharing is with the processors listed in{" "}
            <strong>Section 3</strong>, solely to operate the features you request.
          </p>
          <h3>Limit the Use of My Sensitive Personal Information</h3>
          <p>
            Health and fitness data (such as heart rate, workout performance, your body and health
            profile, and nutrition logs) is sensitive personal information. We use it only to provide
            the features you enable, never to infer characteristics about you or for advertising. The
            AI Coach features send it to an AI provider <em>only</em> when you opt in to AI coaching.
            To exercise your &sect;1798.120 right to opt out, leave <strong>AI Coach</strong>{" "}
            disabled (the default) or turn it off in Settings, which turns those features off.
          </p>

          <h2>10. Cookies</h2>
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

          <h2>11. Contact</h2>
          <p>
            For questions about this privacy policy or to exercise your data rights, please contact
            us through the application&apos;s Settings page.
          </p>
        </article>
      </div>
    </div>
  );
}
