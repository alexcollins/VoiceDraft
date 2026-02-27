#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import process from "node:process";

const DEFAULT_OPTIONS = {
  dataset: "benchmarks/transcription/dataset.example.jsonl",
  providers: "benchmarks/transcription/providers.example.json",
  outDir: "benchmarks/transcription/results",
  maxSamples: Number.POSITIVE_INFINITY,
  timeoutMs: 120_000,
  weights: {
    accuracy: 40,
    latency: 25,
    cost: 20,
    dx: 15,
  },
};

const AUDIO_MIME_BY_EXTENSION = new Map([
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".mp4", "audio/mp4"],
  [".webm", "audio/webm"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
]);

function printHelp() {
  console.log(`
Usage:
  node scripts/benchmark-stt.mjs [options]

Options:
  --dataset <path>      JSONL dataset file
  --providers <path>    Provider config JSON file
  --outDir <path>       Output directory
  --maxSamples <n>      Limit number of samples
  --timeoutMs <n>       Timeout per transcription request
  --weights <spec>      Weighted score config, e.g. "accuracy=40,latency=25,cost=20,dx=15"
  --help                Show this help

Provider types:
  - datasetHypothesis: reads sample.hypotheses[field]
  - command: runs shell command and reads transcript from stdout
  - openai: OpenAI-compatible transcription endpoint
  - groq: Groq OpenAI-compatible transcription endpoint
  - deepgram: Deepgram /v1/listen endpoint
`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex >= 0) {
      const key = withoutPrefix.slice(0, equalIndex);
      const value = withoutPrefix.slice(equalIndex + 1);
      parsed[key] = value;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[withoutPrefix] = true;
      continue;
    }

    parsed[withoutPrefix] = next;
    i += 1;
  }
  return parsed;
}

function parseFiniteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a finite number for ${label}, received "${value}"`);
  }
  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = parseFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for ${label}, received "${value}"`);
  }
  return parsed;
}

function parseWeights(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const next = { ...fallback };
  for (const chunk of String(raw).split(",")) {
    const part = chunk.trim();
    if (!part) {
      continue;
    }
    const [key, value] = part.split("=");
    if (!key || value === undefined) {
      throw new Error(`Invalid weight segment "${part}". Expected key=value.`);
    }
    if (!(key in next)) {
      throw new Error(`Unknown weight key "${key}". Valid keys: ${Object.keys(next).join(", ")}`);
    }
    next[key] = parseFiniteNumber(value, `weights.${key}`);
  }

  return next;
}

function normalizeTranscript(input) {
  return String(input)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(input) {
  const normalized = normalizeTranscript(input);
  return normalized ? normalized.split(" ") : [];
}

function tokenizeChars(input) {
  return normalizeTranscript(input).replace(/\s/g, "").split("");
}

function levenshteinDistance(source, target) {
  if (source.length === 0) {
    return target.length;
  }
  if (target.length === 0) {
    return source.length;
  }

  const previousRow = new Array(target.length + 1);
  const currentRow = new Array(target.length + 1);

  for (let j = 0; j <= target.length; j += 1) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= source.length; i += 1) {
    currentRow[0] = i;

    for (let j = 1; j <= target.length; j += 1) {
      const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
      const deletion = previousRow[j] + 1;
      const insertion = currentRow[j - 1] + 1;
      const substitution = previousRow[j - 1] + substitutionCost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }

    for (let j = 0; j <= target.length; j += 1) {
      previousRow[j] = currentRow[j];
    }
  }

  return previousRow[target.length];
}

function computeWordErrorRate(reference, hypothesis) {
  const refWords = tokenizeWords(reference);
  const hypWords = tokenizeWords(hypothesis);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  return levenshteinDistance(refWords, hypWords) / refWords.length;
}

function computeCharacterErrorRate(reference, hypothesis) {
  const refChars = tokenizeChars(reference);
  const hypChars = tokenizeChars(hypothesis);

  if (refChars.length === 0) {
    return hypChars.length === 0 ? 0 : 1;
  }

  return levenshteinDistance(refChars, hypChars) / refChars.length;
}

function mean(values) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const ratio = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * ratio;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  return Number(value).toFixed(digits);
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const asText = String(value);
  if (/[",\n\r]/.test(asText)) {
    return `"${asText.replace(/"/g, "\"\"")}"`;
  }
  return asText;
}

function fillTemplate(template, context) {
  return String(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = context[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function guessMimeType(audioPath) {
  const extension = path.extname(audioPath).toLowerCase();
  return AUDIO_MIME_BY_EXTENSION.get(extension) ?? "application/octet-stream";
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readJsonLines(filePath) {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const data = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    try {
      data.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1} -> ${error.message}`);
    }
  }

  return data;
}

function resolveAudioPath(audioFile, datasetFilePath) {
  if (path.isAbsolute(audioFile)) {
    return audioFile;
  }
  return path.resolve(path.dirname(datasetFilePath), audioFile);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribeOpenAiCompatible({
  endpoint,
  apiKey,
  model,
  audioPath,
  timeoutMs,
  language,
  prompt,
  temperature,
}) {
  const audioBuffer = await readFile(audioPath);
  const body = new FormData();
  body.append("file", new Blob([audioBuffer], { type: guessMimeType(audioPath) }), path.basename(audioPath));
  body.append("model", model);
  if (language) {
    body.append("language", language);
  }
  if (prompt) {
    body.append("prompt", prompt);
  }
  if (temperature !== undefined) {
    body.append("temperature", String(temperature));
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    },
    timeoutMs,
  );

  const responseText = await response.text();
  let parsedBody = {};
  try {
    parsedBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    // no-op: fallback to raw response text in error branch
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 400)}`);
  }

  const transcript = parsedBody.text ?? parsedBody.transcript;
  if (!transcript || typeof transcript !== "string") {
    throw new Error("No transcript text returned from provider");
  }

  return transcript.trim();
}

async function transcribeDeepgram({ apiKey, model, audioPath, timeoutMs, language, smartFormat, punctuate }) {
  const params = new URLSearchParams({
    model,
    smart_format: String(smartFormat ?? true),
    punctuate: String(punctuate ?? true),
  });
  if (language) {
    params.set("language", language);
  }

  const audioBuffer = await readFile(audioPath);
  const response = await fetchWithTimeout(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": guessMimeType(audioPath),
      },
      body: audioBuffer,
    },
    timeoutMs,
  );

  const responseText = await response.text();
  let parsedBody = {};
  try {
    parsedBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    // no-op: fallback to raw response text in error branch
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 400)}`);
  }

  const transcript = parsedBody?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || typeof transcript !== "string") {
    throw new Error("No transcript returned by Deepgram");
  }
  return transcript.trim();
}

async function transcribeCommand({ command, sample, audioPath, timeoutMs }) {
  const expandedCommand = fillTemplate(command, {
    sampleId: sample.id,
    audioFile: audioPath,
    audioFileName: path.basename(audioPath),
    reference: sample.reference,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(expandedCommand, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`Command exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      const transcript = stdout.trim();
      if (!transcript) {
        reject(new Error("Command produced empty transcript output"));
        return;
      }
      resolve(transcript);
    });
  });
}

async function transcribeWithProvider(provider, sample, datasetFilePath, timeoutMs) {
  const sampleId = sample?.id;
  const providerType = provider?.type;

  if (!sampleId || typeof sampleId !== "string") {
    throw new Error("Sample is missing required string field: id");
  }
  if (typeof sample?.reference !== "string") {
    throw new Error(`Sample "${sampleId}" is missing required string field: reference`);
  }

  if (providerType === "datasetHypothesis") {
    const field = provider.field ?? provider.id;
    const transcript = sample?.hypotheses?.[field];
    if (!transcript || typeof transcript !== "string") {
      throw new Error(`Sample "${sampleId}" is missing hypotheses["${field}"]`);
    }
    return transcript;
  }

  if (typeof sample?.audioFile !== "string") {
    throw new Error(`Sample "${sampleId}" is missing required string field: audioFile`);
  }

  const audioPath = resolveAudioPath(sample.audioFile, datasetFilePath);
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  if (providerType === "command") {
    if (!provider.command || typeof provider.command !== "string") {
      throw new Error(`Provider "${provider.id}" of type "command" must define "command"`);
    }
    return transcribeCommand({ command: provider.command, sample, audioPath, timeoutMs });
  }

  if (providerType === "openai") {
    const apiKeyEnv = provider.apiKeyEnv ?? "OPENAI_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Missing environment variable ${apiKeyEnv}`);
    }
    return transcribeOpenAiCompatible({
      endpoint: provider.endpoint ?? "https://api.openai.com/v1/audio/transcriptions",
      apiKey,
      model: provider.model ?? "whisper-1",
      audioPath,
      timeoutMs,
      language: provider.language,
      prompt: provider.prompt,
      temperature: provider.temperature,
    });
  }

  if (providerType === "groq") {
    const apiKeyEnv = provider.apiKeyEnv ?? "GROQ_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Missing environment variable ${apiKeyEnv}`);
    }
    return transcribeOpenAiCompatible({
      endpoint: provider.endpoint ?? "https://api.groq.com/openai/v1/audio/transcriptions",
      apiKey,
      model: provider.model ?? "whisper-large-v3-turbo",
      audioPath,
      timeoutMs,
      language: provider.language,
      prompt: provider.prompt,
      temperature: provider.temperature,
    });
  }

  if (providerType === "deepgram") {
    const apiKeyEnv = provider.apiKeyEnv ?? "DEEPGRAM_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Missing environment variable ${apiKeyEnv}`);
    }
    return transcribeDeepgram({
      apiKey,
      model: provider.model ?? "nova-3",
      audioPath,
      timeoutMs,
      language: provider.language,
      smartFormat: provider.smartFormat,
      punctuate: provider.punctuate,
    });
  }

  throw new Error(`Unsupported provider type "${providerType}" on provider "${provider.id}"`);
}

function summarizeProviderResults(allResults, providers, weights) {
  const summary = [];

  for (const provider of providers) {
    const rows = allResults.filter((row) => row.providerId === provider.id);
    const okRows = rows.filter((row) => row.status === "ok");
    const werValues = okRows.map((row) => row.wer).filter((value) => Number.isFinite(value));
    const cerValues = okRows.map((row) => row.cer).filter((value) => Number.isFinite(value));
    const latencyValues = okRows.map((row) => row.latencyMs).filter((value) => Number.isFinite(value));

    summary.push({
      providerId: provider.id,
      providerType: provider.type,
      totalSamples: rows.length,
      okCount: okRows.length,
      errorCount: rows.length - okRows.length,
      successRatePct: rows.length ? (okRows.length / rows.length) * 100 : 0,
      avgWer: mean(werValues),
      medianWer: percentile(werValues, 50),
      avgCer: mean(cerValues),
      avgLatencyMs: mean(latencyValues),
      p90LatencyMs: percentile(latencyValues, 90),
      costPerHourUsd: Number.isFinite(provider.costPerHourUsd) ? provider.costPerHourUsd : null,
      integrationEffort:
        Number.isFinite(provider.integrationEffort) && provider.integrationEffort >= 1 && provider.integrationEffort <= 5
          ? provider.integrationEffort
          : null,
    });
  }

  const bestLatency = Math.min(
    ...summary.map((row) => row.avgLatencyMs).filter((value) => Number.isFinite(value)),
  );
  const availableCosts = summary
    .map((row) => row.costPerHourUsd)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const hasZeroCost = availableCosts.some((value) => value === 0);
  const lowestPositiveCost = Math.min(...availableCosts.filter((value) => value > 0));

  for (const row of summary) {
    row.accuracyScore = Number.isFinite(row.avgWer) ? clamp((1 - row.avgWer) * 100, 0, 100) : null;
    row.latencyScore =
      Number.isFinite(bestLatency) && Number.isFinite(row.avgLatencyMs) && row.avgLatencyMs > 0
        ? clamp((bestLatency / row.avgLatencyMs) * 100, 0, 100)
        : null;
    if (Number.isFinite(row.costPerHourUsd)) {
      if (row.costPerHourUsd === 0) {
        row.costScore = 100;
      } else if (hasZeroCost) {
        row.costScore = 0;
      } else if (Number.isFinite(lowestPositiveCost) && row.costPerHourUsd > 0) {
        row.costScore = clamp((lowestPositiveCost / row.costPerHourUsd) * 100, 0, 100);
      } else {
        row.costScore = null;
      }
    } else {
      row.costScore = null;
    }
    row.dxScore =
      Number.isFinite(row.integrationEffort)
        ? clamp(((5 - row.integrationEffort) / 4) * 100, 0, 100)
        : null;

    const components = [
      { key: "accuracy", score: row.accuracyScore },
      { key: "latency", score: row.latencyScore },
      { key: "cost", score: row.costScore },
      { key: "dx", score: row.dxScore },
    ].filter((component) => Number.isFinite(component.score));

    const activeWeight = components.reduce((sum, component) => sum + weights[component.key], 0);
    if (activeWeight === 0) {
      row.totalScore = null;
      continue;
    }

    const weightedScore = components.reduce(
      (sum, component) => sum + (component.score * weights[component.key]) / activeWeight,
      0,
    );
    row.totalScore = weightedScore;
  }

  summary.sort((left, right) => {
    const leftScore = Number.isFinite(left.totalScore) ? left.totalScore : -1;
    const rightScore = Number.isFinite(right.totalScore) ? right.totalScore : -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    const leftAccuracy = Number.isFinite(left.accuracyScore) ? left.accuracyScore : -1;
    const rightAccuracy = Number.isFinite(right.accuracyScore) ? right.accuracyScore : -1;
    return rightAccuracy - leftAccuracy;
  });

  return summary;
}

function buildSummaryCsv(summaryRows) {
  const columns = [
    "providerId",
    "providerType",
    "totalSamples",
    "okCount",
    "errorCount",
    "successRatePct",
    "avgWer",
    "medianWer",
    "avgCer",
    "avgLatencyMs",
    "p90LatencyMs",
    "costPerHourUsd",
    "integrationEffort",
    "accuracyScore",
    "latencyScore",
    "costScore",
    "dxScore",
    "totalScore",
  ];

  const lines = [columns.join(",")];
  for (const row of summaryRows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function buildSummaryMarkdown(summaryRows, metadata) {
  const header = [
    "# STT Benchmark Summary",
    "",
    `Generated at: ${metadata.generatedAt}`,
    `Dataset: ${metadata.datasetPath}`,
    `Providers: ${metadata.providersPath}`,
    `Samples: ${metadata.sampleCount}`,
    `Weights: accuracy=${metadata.weights.accuracy}, latency=${metadata.weights.latency}, cost=${metadata.weights.cost}, dx=${metadata.weights.dx}`,
    "",
    "| Provider | Type | Success % | Avg WER | Avg Latency (ms) | Cost/hr USD | DX effort (1=easy) | Score |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of summaryRows) {
    header.push(
      `| ${row.providerId} | ${row.providerType} | ${formatNumber(row.successRatePct, 1)} | ${formatNumber(row.avgWer)} | ${formatNumber(row.avgLatencyMs, 1)} | ${formatNumber(row.costPerHourUsd, 4)} | ${row.integrationEffort ?? ""} | ${formatNumber(row.totalScore, 2)} |`,
    );
  }

  header.push("");
  return header.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const options = {
    dataset: path.resolve(args.dataset ?? DEFAULT_OPTIONS.dataset),
    providers: path.resolve(args.providers ?? DEFAULT_OPTIONS.providers),
    outDir: path.resolve(args.outDir ?? DEFAULT_OPTIONS.outDir),
    maxSamples: args.maxSamples
      ? parsePositiveInteger(args.maxSamples, "maxSamples")
      : DEFAULT_OPTIONS.maxSamples,
    timeoutMs: args.timeoutMs ? parsePositiveInteger(args.timeoutMs, "timeoutMs") : DEFAULT_OPTIONS.timeoutMs,
    weights: parseWeights(args.weights, DEFAULT_OPTIONS.weights),
  };

  const dataset = await readJsonLines(options.dataset);
  const providersConfig = await readJsonFile(options.providers);
  if (!Array.isArray(providersConfig)) {
    throw new Error("Provider config must be a JSON array.");
  }

  const providers = providersConfig.filter((provider) => provider.enabled !== false);
  if (providers.length === 0) {
    throw new Error("No enabled providers found. Set at least one provider with enabled=true.");
  }

  const sampleLimit = Number.isFinite(options.maxSamples) ? options.maxSamples : dataset.length;
  const samples = dataset.slice(0, sampleLimit);
  if (samples.length === 0) {
    throw new Error("No samples found in dataset.");
  }

  await mkdir(options.outDir, { recursive: true });

  console.log(
    `Running STT benchmark with ${samples.length} sample(s) across ${providers.length} provider(s). Timeout ${options.timeoutMs}ms/provider/sample.`,
  );

  const sampleResults = [];
  for (const provider of providers) {
    if (!provider.id || typeof provider.id !== "string") {
      throw new Error('Each provider must define a string "id".');
    }
    if (!provider.type || typeof provider.type !== "string") {
      throw new Error(`Provider "${provider.id}" must define a string "type".`);
    }

    console.log(`\nProvider: ${provider.id} (${provider.type})`);
    for (const sample of samples) {
      const started = performance.now();
      try {
        const transcript = await transcribeWithProvider(provider, sample, options.dataset, options.timeoutMs);
        const latencyMs = performance.now() - started;
        const wer = computeWordErrorRate(sample.reference, transcript);
        const cer = computeCharacterErrorRate(sample.reference, transcript);

        sampleResults.push({
          sampleId: sample.id,
          providerId: provider.id,
          status: "ok",
          latencyMs,
          wer,
          cer,
          transcript,
          reference: sample.reference,
          tags: Array.isArray(sample.tags) ? sample.tags : [],
        });

        console.log(
          `  [ok] ${sample.id} | WER=${formatNumber(wer)} | CER=${formatNumber(cer)} | latency=${formatNumber(latencyMs, 1)}ms`,
        );
      } catch (error) {
        const latencyMs = performance.now() - started;
        const message = error instanceof Error ? error.message : String(error);

        sampleResults.push({
          sampleId: sample.id,
          providerId: provider.id,
          status: "error",
          latencyMs,
          wer: null,
          cer: null,
          transcript: null,
          reference: sample.reference,
          tags: Array.isArray(sample.tags) ? sample.tags : [],
          error: message,
        });

        console.log(`  [error] ${sample.id} | ${message}`);
      }
    }
  }

  const summary = summarizeProviderResults(sampleResults, providers, options.weights);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const metadata = {
    generatedAt: new Date().toISOString(),
    datasetPath: options.dataset,
    providersPath: options.providers,
    outDir: options.outDir,
    sampleCount: samples.length,
    providerCount: providers.length,
    timeoutMs: options.timeoutMs,
    weights: options.weights,
  };

  const detailOutput = {
    metadata,
    summary,
    sampleResults,
  };

  const detailJsonPath = path.join(options.outDir, `stt-benchmark-${timestamp}.json`);
  const summaryCsvPath = path.join(options.outDir, `stt-summary-${timestamp}.csv`);
  const summaryMdPath = path.join(options.outDir, `stt-summary-${timestamp}.md`);

  await writeFile(detailJsonPath, `${JSON.stringify(detailOutput, null, 2)}\n`, "utf8");
  await writeFile(summaryCsvPath, buildSummaryCsv(summary), "utf8");
  await writeFile(summaryMdPath, buildSummaryMarkdown(summary, metadata), "utf8");

  console.log("\nBenchmark complete.");
  console.log(`- Detailed JSON: ${detailJsonPath}`);
  console.log(`- Summary CSV:   ${summaryCsvPath}`);
  console.log(`- Summary MD:    ${summaryMdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`STT benchmark failed: ${message}`);
  process.exitCode = 1;
});
