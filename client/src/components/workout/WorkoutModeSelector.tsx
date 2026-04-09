import { Dumbbell, Type } from "lucide-react";
import React, { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface WorkoutModeSelectorProps {
  useTextMode: boolean;
  setUseTextMode: (value: boolean) => void;
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  hasData?: boolean;
}

export const WorkoutModeSelector = ({
  useTextMode,
  setUseTextMode,
  isListening,
  stopListening,
  hasData,
}: Readonly<WorkoutModeSelectorProps>) => {
  const [pendingMode, setPendingMode] = useState<boolean | null>(null);

  const switchMode = useCallback(
    (toTextMode: boolean) => {
      if (isListening) stopListening();
      setUseTextMode(toTextMode);
    },
    [isListening, stopListening, setUseTextMode],
  );

  const handleModeChange = useCallback(
    (value: string) => {
      const toTextMode = value === "text";
      if (toTextMode === useTextMode) return;

      if (hasData) {
        setPendingMode(toTextMode);
      } else {
        switchMode(toTextMode);
      }
    },
    [useTextMode, hasData, switchMode],
  );

  const confirmSwitch = useCallback(() => {
    if (pendingMode !== null) {
      switchMode(pendingMode);
      setPendingMode(null);
    }
  }, [pendingMode, switchMode]);

  return (
    <>
      <Tabs
        value={useTextMode ? "text" : "exercises"}
        onValueChange={handleModeChange}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="exercises" data-testid="button-mode-exercises">
            <Dumbbell className="h-4 w-4 mr-2" />
            Exercises
          </TabsTrigger>
          <TabsTrigger value="text" data-testid="button-mode-freetext">
            <Type className="h-4 w-4 mr-2" />
            Free Text
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AlertDialog
        open={pendingMode !== null}
        onOpenChange={(open) => !open && setPendingMode(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch input mode?</AlertDialogTitle>
            <AlertDialogDescription>
              You have data entered in the current mode. Switching will not
              carry it over to the other mode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>
              Switch anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
