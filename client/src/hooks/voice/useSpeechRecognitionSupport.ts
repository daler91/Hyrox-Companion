import { useEffect, useState } from "react";

import { isSpeechRecognitionSupported } from "./speechRecognition";

export function useSpeechRecognitionSupport(): boolean {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSupported(isSpeechRecognitionSupported());
  }, []);

  return isSupported;
}
