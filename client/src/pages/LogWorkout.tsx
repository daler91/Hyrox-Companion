import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAuth } from "@/hooks/useAuth";
import { LogWorkoutForm } from "@/pages/log-workout/LogWorkoutForm";

/**
 * Top-level LogWorkout page. Gates the form on auth resolution so the
 * inner form can load the real user's draft on its first render.
 */
export default function LogWorkout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <LoadingSpinner />
      </div>
    );
  }

  const userKey = user?.id ?? "anon";
  // Key by userKey so an in-place account switch fully remounts the form
  // and prevents the previous user's in-memory draft from being autosaved.
  return <LogWorkoutForm key={userKey} userKey={userKey} />;
}
