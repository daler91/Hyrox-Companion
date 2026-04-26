import type { TimelineAnnotationType } from "@shared/schema";
import { format } from "date-fns";
import { useState } from "react";

export function useAnnotationForm(initialDate?: string) {
  const [type, setType] = useState<TimelineAnnotationType>("injury");
  const [startDate, setStartDate] = useState(() => initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");

  const [prevInitialDate, setPrevInitialDate] = useState(initialDate);
  if (initialDate !== prevInitialDate) {
    setPrevInitialDate(initialDate);
    if (initialDate) {
      setStartDate(initialDate);
      setEndDate(initialDate);
    }
  }

  return {
    type,
    setType,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    note,
    setNote,
  };
}
