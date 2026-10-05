import type { ParseImageInput } from "@/hooks/useNutrition";

interface PhotoRowProps {
  readonly onImage: (image: ParseImageInput) => void;
  readonly isParsing: boolean;
}

/**
 * Stand-in for the Log food sheet's photo rows (SnapMealButton,
 * ScanLabelButton) in specs that exercise the sheet rather than the capture:
 * a click hands a fixed compressed photo straight to `onImage`. Lives in its
 * own module so a `vi.mock` factory can await-import it.
 */
export function photoRow(label: string) {
  return function PhotoRow({ onImage, isParsing }: PhotoRowProps) {
    return (
      <button
        type="button"
        disabled={isParsing}
        onClick={() => {
          onImage({ imageBase64: "ZmFrZS1pbWFnZQ==", mimeType: "image/jpeg" });
        }}
      >
        {label}
      </button>
    );
  };
}
