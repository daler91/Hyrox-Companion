import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface ProfileSectionProps {
  readonly userName: string;
}

export function ProfileSection({ userName }: Readonly<ProfileSectionProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Profile</CardTitle>
        <CardDescription>Your personal information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Display Name</Label>
          <p className="text-sm text-muted-foreground" data-testid="text-display-name">
            {userName}
          </p>
          <p className="text-xs text-muted-foreground">
            Your name is managed through your login provider
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
