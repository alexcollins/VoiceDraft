import { useRef, useState } from "react";
import { DictateButton } from "../src/react";
import "../src/react/voice-draft.css";

export function DictateButtonExample() {
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 680 }}>
      <textarea ref={field} value={value} onChange={(event) => setValue(event.target.value)} rows={4} style={{ flex: 1 }} />
      <DictateButton field={field} wave />
    </div>
  );
}
