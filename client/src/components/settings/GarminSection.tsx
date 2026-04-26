import { GarminIcon } from "@/components/icons/GarminIcon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GarminStatus } from "@/lib/api";

import { GarminConnectForm } from "./garmin/GarminConnectForm";
import { GarminErrorBanner } from "./garmin/GarminErrorBanner";
import { GarminStatusRow } from "./garmin/GarminStatusRow";
import { useGarminConnectionController } from "./garmin/useGarminConnectionController";

interface GarminSectionProps {
  readonly garminStatus: GarminStatus | undefined;
  readonly garminLoading: boolean;
}

export function GarminSection({ garminStatus, garminLoading }: Readonly<GarminSectionProps>) {
  const controller = useGarminConnectionController(garminStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <GarminIcon className="h-5 w-5 text-[#007CC3]" />
          Garmin Connect
        </CardTitle>
        <CardDescription>Sync activities from your Garmin device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GarminStatusRow
          isConnected={controller.isConnected}
          hasError={controller.hasError}
          statusText={controller.statusText}
          isSyncing={controller.syncGarminMutation.isPending}
          isDisconnecting={controller.disconnectGarminMutation.isPending}
          onSync={() => controller.syncGarminMutation.mutate()}
          onDisconnect={() => controller.disconnectGarminMutation.mutate()}
        />

        {controller.hasError && <GarminErrorBanner error={garminStatus?.lastError} />}

        {!controller.isConnected && (
          <GarminConnectForm
            email={controller.email}
            onEmailChange={controller.setEmail}
            password={controller.password}
            onPasswordChange={controller.setPassword}
            garminLoading={garminLoading}
            isConnecting={controller.connectGarminMutation.isPending}
            onConnect={controller.handleConnect}
          />
        )}
      </CardContent>
    </Card>
  );
}
