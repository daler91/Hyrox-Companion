import { AlertTriangle, Loader2 } from "lucide-react";

import { GarminIcon } from "@/components/icons/GarminIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GarminConnectFormProps {
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly password: string;
  readonly onPasswordChange: (value: string) => void;
  readonly garminLoading: boolean;
  readonly isConnecting: boolean;
  readonly onConnect: () => void;
}

export function GarminConnectForm({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  garminLoading,
  isConnecting,
  onConnect,
}: GarminConnectFormProps) {
  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <div className="text-amber-900 dark:text-amber-200">
            <p className="font-medium">Garmin doesn&apos;t offer OAuth for end users.</p>
            <p className="mt-1">
              We have to log in with your email and password against Garmin&apos;s mobile API.
              Credentials are stored encrypted (AES-256-GCM) but this is materially less secure than
              OAuth. <strong>2-step verification is not supported</strong> - you&apos;ll need to
              disable it on Garmin temporarily to connect.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="garmin-email">Garmin email</Label>
        <Input
          id="garmin-email"
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          disabled={isConnecting || garminLoading}
          data-testid="input-garmin-email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="garmin-password">Garmin password</Label>
        <Input
          id="garmin-password"
          type="password"
          autoComplete="off"
          placeholder="********"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          disabled={isConnecting || garminLoading}
          data-testid="input-garmin-password"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onConnect}
        disabled={!email || !password || isConnecting || garminLoading}
        data-testid="button-connect-garmin"
      >
        {isConnecting ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
        ) : (
          <GarminIcon className="h-4 w-4 mr-1.5 text-[#007CC3]" />
        )}
        Connect Garmin
      </Button>
    </div>
  );
}
