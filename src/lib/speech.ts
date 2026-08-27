import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation for the chat field, using the browser's own speech recognition.
 *
 * This is input only: it turns speech into text in the box and never speaks
 * back. Support is uneven across browsers, so `supported` is false wherever the
 * API is missing and the caller simply shows no microphone.
 */

type SpeechResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Dictation = {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
};

/**
 * @param onText Called with the words heard so far. The caller decides what to
 *   do with them, so the field stays the single source of truth.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [supported] = useState(() => recognitionClass() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<Recognition | null>(null);
  const heard = useRef("");
  // The callback changes on every render; a ref keeps the handler stable.
  const sink = useRef(onText);
  sink.current = onText;

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Recognizer = recognitionClass();
    if (Recognizer === null) return;
    if (recognition.current !== null) {
      stop();
      return;
    }

    const engine = new Recognizer();
    engine.lang = navigator.language || "en-US";
    engine.continuous = true;
    engine.interimResults = true;
    heard.current = "";

    engine.onresult = (event) => {
      let settled = "";
      let pending = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) settled += result[0].transcript;
        else pending += result[0].transcript;
      }
      heard.current = settled;
      sink.current(`${settled}${pending}`.trim());
    };

    engine.onerror = (event) => {
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Your browser blocked the microphone. Allow it, then try again."
          : event.error === "no-speech"
            ? "Loomstate heard nothing."
            : "The microphone stopped.",
      );
      setListening(false);
      recognition.current = null;
    };

    engine.onend = () => {
      setListening(false);
      recognition.current = null;
    };

    try {
      engine.start();
      recognition.current = engine;
      setError(null);
      setListening(true);
    } catch {
      setError("Loomstate could not start the microphone.");
      recognition.current = null;
    }
  }, [stop]);

  // A recogniser left running after the panel closes keeps the microphone on.
  useEffect(() => {
    return () => {
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  return { supported, listening, error, start, stop };
}
