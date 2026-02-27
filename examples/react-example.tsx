import { useState } from "react";
import { VoiceDraftBar, useVoiceDraft } from "../src/react";

export function VoiceDraftExample() {
  const [value, setValue] = useState("");
  const voice = useVoiceDraft({
    locale: "en-US",
    noiseGate: {
      activationThreshold: 0.25,
      minActiveLevel: 0.06,
    },
    silence: {
      enabled: true,
      autoStopMs: 1200,
      minSpeechMs: 300,
    },
  });

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 680 }}>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={5} />
      <VoiceDraftBar
        listening={voice.listening}
        canTranscribe={voice.canTranscribe}
        waveform={voice.waveform}
        elapsed={voice.elapsed}
        onStart={voice.start}
        onCancel={voice.cancel}
        onConfirm={async () => {
          const text = await voice.stopAndGetText();
          if (text) {
            setValue((previous) => (previous ? `${previous} ${text}` : text));
          }
        }}
      />
    </div>
  );
}
