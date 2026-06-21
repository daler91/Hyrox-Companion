import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MetricRowProps {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly unit: string;
  readonly value: string;
  readonly min: number;
  readonly max: number;
  readonly testId: string;
  readonly onChange: (value: string) => void;
}

function MetricRow({ id, label, description, unit, value, min, max, testId, onChange }: Readonly<MetricRowProps>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24"
          data-testid={testId}
          aria-label={`${label} in ${unit}`}
        />
        <span className="text-sm text-muted-foreground w-10">{unit}</span>
      </div>
    </div>
  );
}

interface HealthMetricsCardProps {
  readonly restingHr: string;
  readonly maxHr: string;
  readonly ftp: string;
  readonly onRestingHrChange: (value: string) => void;
  readonly onMaxHrChange: (value: string) => void;
  readonly onFtpChange: (value: string) => void;
}

/**
 * Optional HR/power baselines that sharpen objective training-load (hrTSS/TSS).
 * All optional: when blank, the load model falls back to an age-estimated max HR
 * plus a default resting HR, and power-based TSS is skipped.
 */
export function HealthMetricsCard({
  restingHr,
  maxHr,
  ftp,
  onRestingHrChange,
  onMaxHrChange,
  onFtpChange,
}: Readonly<HealthMetricsCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Heart rate &amp; power</CardTitle>
        <CardDescription>
          Optional — improves the accuracy of objective training-load (hrTSS/TSS) when your workouts
          carry heart-rate or power data. Left blank, we estimate from your age.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetricRow
          id="resting-hr"
          label="Resting heart rate"
          description="Your resting heart rate, measured on waking."
          unit="bpm"
          value={restingHr}
          min={30}
          max={120}
          testId="input-resting-hr"
          onChange={onRestingHrChange}
        />
        <MetricRow
          id="max-hr"
          label="Max heart rate"
          description="Your true max HR, if known — otherwise estimated from age."
          unit="bpm"
          value={maxHr}
          min={120}
          max={230}
          testId="input-max-hr"
          onChange={onMaxHrChange}
        />
        <MetricRow
          id="ftp"
          label="Functional threshold power"
          description="Your FTP in watts — unlocks power-based load (TSS)."
          unit="W"
          value={ftp}
          min={50}
          max={600}
          testId="input-ftp"
          onChange={onFtpChange}
        />
      </CardContent>
    </Card>
  );
}
