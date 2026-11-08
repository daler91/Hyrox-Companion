import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * How to delete a fitai.coach account, at a public address Google Play links
 * to (its account-deletion requirement): it works signed in or out and needs
 * no app install. What it says matches DELETE /api/v1/account
 * (server/services/accountErasureService.ts) and the privacy policy.
 */
export default function DeleteAccount() {
  useDocumentTitle("Delete your account");
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
        </div>

        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1>Delete your fitai.coach account</h1>
          <p>
            You can delete your fitai.coach account, and the data it holds, at any time. You don&apos;t
            need the Android app for it: the website works the same.
          </p>

          <h2>How to delete your account</h2>
          <ol>
            <li>
              Sign in at <Link href="/">fitai.coach</Link>, in a browser or in the fitai app.
            </li>
            <li>
              Open <strong>Settings</strong>. On the website it&apos;s in the menu; in the app, it&apos;s the
              last tab.
            </li>
            <li>
              On the website, under <strong>Account</strong>, choose <strong>Delete my account</strong>. In the
              app, scroll to <strong>Account</strong> and choose <strong>Delete my account</strong>.
            </li>
            <li>
              Type <strong>DELETE</strong> to confirm. The account is deleted straight away.
            </li>
          </ol>
          <p>
            Can&apos;t sign in? Use &ldquo;Forgot password&rdquo; on the sign-in page to get back into your
            account first, then follow the steps above.
          </p>

          <h2>What is deleted</h2>
          <p>Deletion is permanent and can&apos;t be undone. It removes:</p>
          <ul>
            <li>your login and profile (name, email, profile image);</li>
            <li>
              workouts, sets and notes, including those synced from Strava, Garmin and Health Connect, and the
              heart-rate and pace data recorded with them;
            </li>
            <li>training plans, weekly reviews and analytics;</li>
            <li>your food log, nutrition targets, recipes and private custom foods;</li>
            <li>your body and health profile and MAF heart-rate answers;</li>
            <li>AI Coach conversations, coaching notes and what the coach remembers about you;</li>
            <li>
              Strava and Garmin connections and their stored credentials, and the phones and browsers registered
              for notifications;
            </li>
            <li>the recycle bin and your consent records.</li>
          </ul>
          <p>
            In the app, deleting also clears the data kept on that phone, including changes not yet synced.
          </p>

          <h2>What is kept</h2>
          <p>
            Custom foods you chose to <strong>share publicly</strong> stay available to other athletes, with no
            link back to you. Unshare them first if you don&apos;t want that. Nothing else is kept.
          </p>
          <p>
            Want a copy of your data first? <strong>Settings</strong> lets you export it as CSV or JSON before you
            delete.
          </p>

          <p>
            See the <Link href="/privacy">privacy policy</Link> for how fitai.coach handles your data.
          </p>
        </article>
      </div>
    </div>
  );
}
