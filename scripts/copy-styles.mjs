import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const source = "src/react/voice-draft.css";
const destination = "dist/react/voice-draft.css";

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
