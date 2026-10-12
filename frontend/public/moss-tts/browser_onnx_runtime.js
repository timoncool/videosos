// src/browser_onnx_runtime.js
import * as ort from "./vendor/ort/ort.wasm.min.mjs";

// src/tts_robust_normalizer.js
var CJK_CHARS = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff";
var CJK = `[${CJK_CHARS}]`;
var PROT = "___PROT\\d+___";
var PROT_CAPTURE_RE = new RegExp(`(${PROT})`, "gu");
var PROT_FULL_RE = new RegExp(`^${PROT}$`, "u");
var URL_RE = /https?:\/\/[^\s\u3000，。！？；、）】》〉」』]+/gu;
var EMAIL_RE = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])/gu;
var MENTION_RE = /(?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,32}/gu;
var REDDIT_RE = /(?<![A-Za-z0-9_])(?:u|r)\/[A-Za-z0-9_]+/gu;
var HASHTAG_RE = /(?<![A-Za-z0-9_])#(?!\s)[^\s#]+/gu;
var DOT_TOKEN_RE = /(?<![A-Za-z0-9_])\.(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]+/gu;
var FILELIKE_RE = /(?<![A-Za-z0-9_])(?=[A-Za-z0-9._/+:-]*[A-Za-z])(?=[A-Za-z0-9._/+:-]*[./+:-])[A-Za-z0-9][A-Za-z0-9._/+:-]*(?![A-Za-z0-9_])/gu;
var LATINISH = `(?:${PROT}|(?=[A-Za-z0-9._/+:-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._/+:-]*)`;
var ZERO_WIDTH_RE = /[\u200b-\u200d\ufeff]/gu;
var TRAILING_CLOSERS = new Set(`"')]}\uFF09\u3011\u300B\u3009\u300D\u300F\u201D\u2019`);
var CJK_SPACE_RE = new RegExp(`(${CJK})\\s+(?=${CJK})`, "gu");
var CJK_DIGIT_SPACE_RE = new RegExp(`(${CJK})\\s+(?=\\d)`, "gu");
var DIGIT_CJK_SPACE_RE = new RegExp(`(\\d)\\s+(?=${CJK})`, "gu");
var CJK_LATINISH_SPACE_RE = new RegExp(`(${CJK})(?=(${LATINISH}))`, "gu");
var LATINISH_CJK_SPACE_RE = new RegExp(`(${LATINISH})(?=${CJK})`, "gu");
function isControlCharacter(character) {
  return /^\p{C}$/u.test(character);
}
function isUnicodePunctuation(character) {
  return /^\p{P}$/u.test(character);
}
function baseCleanup(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u3000/g, " ");
  const withoutZeroWidth = normalized.replace(ZERO_WIDTH_RE, "");
  const cleaned = [];
  for (const character of withoutZeroWidth) {
    if (character === "\n" || character === "	" || character === " " || !isControlCharacter(character)) {
      cleaned.push(character);
    }
  }
  return cleaned.join("");
}
function ensureTerminalPunctuation(text) {
  if (!text) {
    return text;
  }
  let index = text.length - 1;
  while (index >= 0 && /\s/u.test(text[index])) {
    index -= 1;
  }
  while (index >= 0 && TRAILING_CLOSERS.has(text[index])) {
    index -= 1;
  }
  if (index >= 0 && isUnicodePunctuation(text[index])) {
    return text;
  }
  return `${text}\u3002`;
}
function ensureTerminalPunctuationByLine(text) {
  if (!text) {
    return text;
  }
  return String(text).split("\n").map((line) => {
    const trimmed = line.trim();
    return trimmed ? ensureTerminalPunctuation(trimmed) : "";
  }).join("\n").trim();
}
function normalizeMarkdownAndLines(text) {
  let normalized = String(text || "");
  normalized = normalized.replace(/\[([^\[\]]+?)\]\((https?:\/\/[^)\s]+)\)/gu, "$1 $2");
  const lines = [];
  for (const rawLine of normalized.split("\n")) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }
    line = line.replace(/^#{1,6}\s+/u, "");
    line = line.replace(/^>\s+/u, "");
    line = line.replace(/^[-*+]\s+/u, "");
    line = line.replace(/^\d+[.)]\s+/u, "");
    lines.push(line);
  }
  if (!lines.length) {
    return "";
  }
  const merged = [lines[0]];
  for (let index = 1; index < lines.length; index += 1) {
    merged[merged.length - 1] = ensureTerminalPunctuation(merged[merged.length - 1]);
    merged.push(lines[index]);
  }
  return merged.join("");
}
function protectSpans(text) {
  const protectedSpans = [];
  const patterns = [
    URL_RE,
    EMAIL_RE,
    MENTION_RE,
    REDDIT_RE,
    HASHTAG_RE,
    DOT_TOKEN_RE,
    FILELIKE_RE
  ];
  let normalized = String(text || "");
  for (const pattern of patterns) {
    normalized = normalized.replace(pattern, (match) => {
      const token = `___PROT${protectedSpans.length}___`;
      protectedSpans.push(match);
      return token;
    });
  }
  return { text: normalized, protectedSpans };
}
function restoreSpans(text, protectedSpans) {
  let restored = String(text || "");
  for (let index = 0; index < protectedSpans.length; index += 1) {
    const token = `___PROT${index}___`;
    restored = restored.split(token).join(protectedSpans[index]);
  }
  return restored;
}
function normalizeVisibleUnderscores(text) {
  return String(text || "").split(PROT_CAPTURE_RE).map((part) => PROT_FULL_RE.test(part) ? part : part.replace(/_/gu, " ")).join("");
}
function normalizeFlowArrows(text) {
  return String(text || "").replace(
    /\s*(?:<[-=]+>|[-=]+>|<[-=]+|[→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺↦↤↪↩])\s*/gu,
    "\uFF0C"
  );
}
function normalizeSpaces(text) {
  let normalized = String(text || "");
  normalized = normalized.replace(/[ \t\r\f\v]+/gu, " ");
  normalized = normalized.replace(CJK_SPACE_RE, "$1");
  normalized = normalized.replace(CJK_DIGIT_SPACE_RE, "$1");
  normalized = normalized.replace(DIGIT_CJK_SPACE_RE, "$1");
  normalized = normalized.replace(CJK_LATINISH_SPACE_RE, "$1 ");
  normalized = normalized.replace(LATINISH_CJK_SPACE_RE, "$1 ");
  normalized = normalized.replace(/ {2,}/gu, " ");
  normalized = normalized.replace(/\s+([，。！？；：、”’」』】）》])/gu, "$1");
  normalized = normalized.replace(/([（【「『《“‘])\s+/gu, "$1");
  normalized = normalized.replace(/([，。！？；：、])\s*/gu, "$1");
  normalized = normalized.replace(/\s+([,.;!?])/gu, "$1");
  return normalized.replace(/ {2,}/gu, " ").trim();
}
function normalizeStructuralPunctuation(text) {
  let normalized = String(text || "");
  normalized = normalized.replace(/\[\s*([^\[\]]+?)\s*\]/gu, '"$1"');
  normalized = normalized.replace(/\{\s*([^{}]+?)\s*\}/gu, '"$1"');
  normalized = normalized.replace(/[【〖『「]\s*([^】〗』」]+?)\s*[】〗』」]/gu, '"$1"');
  normalized = normalized.replace(
    /(^|[。！？!?；;]\s*)《([^》]+)》(?=\s*(?:___PROT\d+___|[—–―-]{2,}|$|[。！？!?；;，,]))/gu,
    "$1$2"
  );
  normalized = normalizeFlowArrows(normalized);
  normalized = normalized.replace(/\s*(?:—|–|―|-){2,}\s*/gu, "\u3002");
  return normalized;
}
function normalizeRepeatedPunctuation(text) {
  let normalized = String(text || "");
  normalized = normalized.replace(/(?:\.{3,}|…{2,}|……+)/gu, "\u3002");
  normalized = normalized.replace(/[。．]{2,}/gu, "\u3002");
  normalized = normalized.replace(/[，,]{2,}/gu, "\uFF0C");
  normalized = normalized.replace(/[!！]{2,}/gu, "\uFF01");
  normalized = normalized.replace(/[?？]{2,}/gu, "\uFF1F");
  normalized = normalized.replace(/[!?！？]{2,}/gu, (match) => {
    const hasQuestion = [...match].some((character) => character === "?" || character === "\uFF1F");
    const hasExclamation = [...match].some((character) => character === "!" || character === "\uFF01");
    if (hasQuestion && hasExclamation) {
      return "\uFF1F\uFF01";
    }
    return hasQuestion ? "\uFF1F" : "\uFF01";
  });
  return normalized;
}
function normalizeTtsText(text) {
  let normalized = baseCleanup(text);
  normalized = normalizeMarkdownAndLines(normalized);
  normalized = normalizeFlowArrows(normalized);
  const { text: protectedText, protectedSpans } = protectSpans(normalized);
  normalized = normalizeVisibleUnderscores(protectedText);
  normalized = normalizeSpaces(normalized);
  normalized = normalizeStructuralPunctuation(normalized);
  normalized = normalizeRepeatedPunctuation(normalized);
  normalized = normalizeSpaces(normalized);
  normalized = restoreSpans(normalized, protectedSpans);
  normalized = normalized.trim();
  return ensureTerminalPunctuationByLine(normalized);
}

// src/browser_onnx_runtime.js
var BROWSER_ONNX_ASSET_ROOT = new URL("./", import.meta.url);
function resolveBrowserAssetUrl(path) {
  return new URL(path, BROWSER_ONNX_ASSET_ROOT).href;
}
var ORT_SESSION_OPTIONS = {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all"
};
var TOKENIZER_SANDBOX_SOURCE = "nano-reader-tokenizer-sandbox";
var TOKENIZER_SANDBOX_IFRAME_ID = "nano-reader-tokenizer-sandbox-frame";
var tokenizerSandboxFrame = null;
var tokenizerSandboxReadyPromise = null;
var tokenizerSandboxRequestCounter = 0;
var pendingTokenizerSandboxRequests = /* @__PURE__ */ new Map();
var DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_SHORT_SECONDS = 0.4;
var DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_LONG_SECONDS = 0.24;
var SAMPLE_MODE_GREEDY = "greedy";
var SAMPLE_MODE_FIXED = "fixed";
var SAMPLE_MODE_FULL = "full";
var SENTENCE_END_PUNCTUATION = new Set(".!?\u3002\uFF01\uFF1F\uFF1B;");
var CLAUSE_SPLIT_PUNCTUATION = new Set(",\uFF0C\u3001\uFF1B;\uFF1A:");
var CLOSING_PUNCTUATION = new Set(`"'\u201D\u2019)]}\uFF09\u3011\u300B\u300D\u300F`);
var CONTROL_EVENT_LOOP_YIELD_CHANNEL_INTERVAL = 4;
async function yieldToBrowserEventLoop() {
  if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
function createProfileState() {
  return {
    enabled: true,
    timings: {},
    counters: {}
  };
}
function recordProfileTiming(profileState, key, durationMs) {
  if (!profileState?.enabled) {
    return;
  }
  const safeDurationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  const current = profileState.timings[key] || {
    totalMs: 0,
    count: 0,
    minMs: null,
    maxMs: 0
  };
  current.totalMs += safeDurationMs;
  current.count += 1;
  current.minMs = current.minMs === null ? safeDurationMs : Math.min(current.minMs, safeDurationMs);
  current.maxMs = Math.max(current.maxMs, safeDurationMs);
  profileState.timings[key] = current;
}
function finishProfileTiming(profileState, key, startedAt) {
  if (!profileState?.enabled) {
    return;
  }
  recordProfileTiming(profileState, key, nowMs() - startedAt);
}
function recordProfileCounter(profileState, key, delta = 1) {
  if (!profileState?.enabled) {
    return;
  }
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  profileState.counters[key] = (profileState.counters[key] || 0) + safeDelta;
}
function cloneProfileSnapshot(profileState) {
  if (!profileState?.enabled) {
    return {
      enabled: false,
      timings: {},
      counters: {}
    };
  }
  const timings = {};
  for (const [key, value] of Object.entries(profileState.timings)) {
    timings[key] = {
      totalMs: value.totalMs,
      count: value.count,
      minMs: value.minMs,
      maxMs: value.maxMs,
      averageMs: value.count > 0 ? value.totalMs / value.count : 0
    };
  }
  return {
    enabled: true,
    timings,
    counters: { ...profileState.counters }
  };
}
function multiplyShape(shape) {
  return shape.reduce((accumulator, value) => accumulator * value, 1);
}
function formatByteCount(byteLength) {
  const numeric = Number(byteLength);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return String(byteLength);
  }
  if (numeric < 1024) {
    return `${numeric} B`;
  }
  if (numeric < 1024 * 1024) {
    return `${(numeric / 1024).toFixed(1)} KiB`;
  }
  return `${(numeric / (1024 * 1024)).toFixed(1)} MiB`;
}
function normalizeRelativePath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
}
function getManagedModelStore() {
  return globalThis.NanoReaderBrowserModelStore || null;
}
function isManagedModelPath(rootPath) {
  const store = getManagedModelStore();
  return Boolean(store?.isManagedModelPath?.(rootPath));
}
var MANIFEST_CANDIDATE_RELATIVE_PATHS = [
  "browser_poc_manifest.json",
  "MOSS-TTS-Nano-100M-ONNX/browser_poc_manifest.json",
  "MOSS-TTS-Nano-ONNX-CPU/browser_poc_manifest.json"
];
function joinRelativeAssetPath(baseRelativePath, childRelativePath) {
  const normalizedBase = normalizeRelativePath(baseRelativePath);
  const normalizedChild = normalizeRelativePath(childRelativePath);
  if (!normalizedBase) {
    return normalizedChild;
  }
  if (!normalizedChild) {
    return normalizedBase;
  }
  return normalizeRelativePath(`${normalizedBase}/${normalizedChild}`);
}
function getExternalDataSidecarInfo(modelRelativePath) {
  const normalizedModelPath = normalizeRelativePath(modelRelativePath);
  if (!normalizedModelPath.toLowerCase().endsWith(".onnx")) {
    return null;
  }
  const sidecarRelativePath = normalizedModelPath.replace(/\.onnx$/i, ".data");
  const sidecarPathParts = sidecarRelativePath.split("/");
  const sidecarMountPath = sidecarPathParts[sidecarPathParts.length - 1] || sidecarRelativePath;
  return {
    relativePath: sidecarRelativePath,
    mountPath: sidecarMountPath
  };
}
function resolveModelExternalDataRelativePaths(baseDir, externalDataFilesMap, modelFileName) {
  const relativePaths = Array.isArray(externalDataFilesMap?.[modelFileName]) ? externalDataFilesMap[modelFileName] : [];
  return relativePaths.map((relativePath) => joinRelativeAssetPath(baseDir, relativePath));
}
function normalizeLocalDirectoryPath(rawPath) {
  const trimmed = String(rawPath || "").trim().replace(/^"(.*)"$/, "$1");
  if (!trimmed) {
    throw new Error("Enter a local browser ONNX model root path first.");
  }
  return trimmed.replace(/[\\/]+$/, "");
}
function isResourceUrl(pathValue) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(String(pathValue || "").trim());
}
function assetRootPathToUrl(pathValue) {
  const normalized = normalizeLocalDirectoryPath(pathValue).replace(/\\/g, "/");
  if (isResourceUrl(normalized)) {
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}/`);
  }
  if (normalized.startsWith("/")) {
    return encodeURI(`file://${normalized}/`);
  }
  throw new Error(`Unsupported local path format: ${pathValue}`);
}
async function readTextFromLocalPath(rootPath, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const fileUrl = new URL(normalizedPath, assetRootPathToUrl(rootPath)).href;
  const response = await fetch(fileUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to read ${fileUrl} (status=${response.status})`);
  }
  return response.text();
}
async function readBufferFromLocalPath(rootPath, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const fileUrl = new URL(normalizedPath, assetRootPathToUrl(rootPath)).href;
  const response = await fetch(fileUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to read ${fileUrl} (status=${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
function flatten3dInt32(nested) {
  const dim0 = nested.length;
  const dim1 = nested[0].length;
  const dim2 = nested[0][0].length;
  const data = new Int32Array(dim0 * dim1 * dim2);
  let offset = 0;
  for (let i = 0; i < dim0; i += 1) {
    for (let j = 0; j < dim1; j += 1) {
      for (let k = 0; k < dim2; k += 1) {
        data[offset] = nested[i][j][k];
        offset += 1;
      }
    }
  }
  return { data, dims: [dim0, dim1, dim2] };
}
function flatten2dInt32(nested) {
  const dim0 = nested.length;
  const dim1 = nested[0].length;
  const data = new Int32Array(dim0 * dim1);
  let offset = 0;
  for (let i = 0; i < dim0; i += 1) {
    for (let j = 0; j < dim1; j += 1) {
      data[offset] = nested[i][j];
      offset += 1;
    }
  }
  return { data, dims: [dim0, dim1] };
}
function sliceChannelMajorAudio(data, dims, startSample = 0, endSample = dims[2]) {
  const channels = dims[1];
  const totalSamples = dims[2];
  const start = Math.max(0, startSample);
  const end = Math.max(start, Math.min(endSample, totalSamples));
  const chunkData = [];
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const channelOffset = channelIndex * totalSamples;
    chunkData.push(data.slice(channelOffset + start, channelOffset + end));
  }
  return chunkData;
}
function mergeFloat32Chunks(chunksByChannel) {
  return chunksByChannel.map((channelChunks) => {
    const totalLength = channelChunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of channelChunks) {
      if (!chunk?.length) {
        continue;
      }
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  });
}
function extractLastHiddenTensor(hiddenStatesTensor) {
  const dims = hiddenStatesTensor.dims;
  if (dims.length === 2) {
    return hiddenStatesTensor;
  }
  if (dims.length !== 3) {
    throw new Error(`Unexpected global_hidden rank: ${dims.length}`);
  }
  const [batchSize, seqLen, hiddenSize] = dims;
  if (batchSize !== 1) {
    throw new Error(`Only batch_size=1 is supported in browser ONNX runtime, got ${batchSize}`);
  }
  const start = (seqLen - 1) * hiddenSize;
  const end = start + hiddenSize;
  return new ort.Tensor("float32", hiddenStatesTensor.data.subarray(start, end), [1, hiddenSize]);
}
function argmax(values) {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > bestValue) {
      bestValue = values[index];
      bestIndex = index;
    }
  }
  return bestIndex;
}
function softmax(values) {
  let maxValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > maxValue) {
      maxValue = values[index];
    }
  }
  const exps = new Float64Array(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.exp(values[index] - maxValue);
    exps[index] = value;
    sum += value;
  }
  for (let index = 0; index < exps.length; index += 1) {
    exps[index] /= sum;
  }
  return exps;
}
function applyRepetitionPenalty(values, previousTokenIds, repetitionPenalty, profileState = null, profileScope = "sampling.audio") {
  const startedAt = profileState?.enabled ? nowMs() : 0;
  if (!previousTokenIds?.length || repetitionPenalty === 1) {
    recordProfileTiming(profileState, `${profileScope}.repetition_penalty`, 0);
    return values;
  }
  const result = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = values[index];
  }
  const uniqueTokenIds = new Set(previousTokenIds);
  for (const tokenId of uniqueTokenIds) {
    if (tokenId < 0 || tokenId >= result.length) {
      continue;
    }
    result[tokenId] = result[tokenId] < 0 ? result[tokenId] * repetitionPenalty : result[tokenId] / repetitionPenalty;
  }
  finishProfileTiming(profileState, `${profileScope}.repetition_penalty`, startedAt);
  return result;
}
function argmaxWithRepetitionPenalty(values, previousTokenSet, repetitionPenalty) {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  const applyPenalty = previousTokenSet?.size > 0 && repetitionPenalty !== 1;
  for (let index = 0; index < values.length; index += 1) {
    let score = values[index];
    if (applyPenalty && previousTokenSet.has(index)) {
      score = score < 0 ? score * repetitionPenalty : score / repetitionPenalty;
    }
    if (score > bestValue) {
      bestValue = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}
function sampleFromScores(values, settings, profileState = null, profileScope = "sampling") {
  const totalStartedAt = profileState?.enabled ? nowMs() : 0;
  if (!settings.doSample) {
    const argmaxStartedAt = profileState?.enabled ? nowMs() : 0;
    const bestIndex = argmax(values);
    finishProfileTiming(profileState, `${profileScope}.argmax`, argmaxStartedAt);
    finishProfileTiming(profileState, `${profileScope}.total`, totalStartedAt);
    return bestIndex;
  }
  if (!(settings.temperature > 0)) {
    throw new Error("temperature must be positive when doSample=true");
  }
  const temperatureStartedAt = profileState?.enabled ? nowMs() : 0;
  let scores = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    scores[index] = values[index] / settings.temperature;
  }
  finishProfileTiming(profileState, `${profileScope}.temperature`, temperatureStartedAt);
  if (settings.topK > 0 && settings.topK < scores.length) {
    const topKStartedAt = profileState?.enabled ? nowMs() : 0;
    const sortedDescending = Array.from(scores).sort((left, right) => right - left);
    const threshold = sortedDescending[settings.topK - 1];
    for (let index = 0; index < scores.length; index += 1) {
      if (scores[index] < threshold) {
        scores[index] = Number.NEGATIVE_INFINITY;
      }
    }
    finishProfileTiming(profileState, `${profileScope}.top_k`, topKStartedAt);
  } else {
    recordProfileTiming(profileState, `${profileScope}.top_k`, 0);
  }
  if (settings.topP > 0 && settings.topP < 1) {
    const topPStartedAt = profileState?.enabled ? nowMs() : 0;
    const indexed = Array.from({ length: scores.length }, (_unused, index) => ({ index, score: scores[index] }));
    indexed.sort((left, right) => right.score - left.score);
    const sortedScores = indexed.map((item) => item.score);
    const sortedProbs = softmax(sortedScores);
    const removeMask = new Array(indexed.length).fill(false);
    let cumulative = 0;
    for (let index = 0; index < indexed.length; index += 1) {
      cumulative += sortedProbs[index];
      if (cumulative > settings.topP) {
        removeMask[index] = true;
      }
    }
    for (let index = removeMask.length - 1; index >= 1; index -= 1) {
      removeMask[index] = removeMask[index - 1];
    }
    if (removeMask.length > 0) {
      removeMask[0] = false;
    }
    for (let index = 0; index < indexed.length; index += 1) {
      if (removeMask[index]) {
        scores[indexed[index].index] = Number.NEGATIVE_INFINITY;
      }
    }
    finishProfileTiming(profileState, `${profileScope}.top_p`, topPStartedAt);
  } else {
    recordProfileTiming(profileState, `${profileScope}.top_p`, 0);
  }
  const finalSoftmaxStartedAt = profileState?.enabled ? nowMs() : 0;
  const probabilities = softmax(scores);
  finishProfileTiming(profileState, `${profileScope}.final_softmax`, finalSoftmaxStartedAt);
  const randomDrawStartedAt = profileState?.enabled ? nowMs() : 0;
  let randomValue = Math.random();
  for (let index = 0; index < probabilities.length; index += 1) {
    randomValue -= probabilities[index];
    if (randomValue <= 0) {
      finishProfileTiming(profileState, `${profileScope}.random_draw`, randomDrawStartedAt);
      finishProfileTiming(profileState, `${profileScope}.total`, totalStartedAt);
      return index;
    }
  }
  const fallbackIndex = argmax(scores);
  finishProfileTiming(profileState, `${profileScope}.random_draw`, randomDrawStartedAt);
  finishProfileTiming(profileState, `${profileScope}.total`, totalStartedAt);
  return fallbackIndex;
}
function sampleAssistantTextToken(textLogits, manifest, generationDefaults, profileState = null) {
  const startedAt = profileState?.enabled ? nowMs() : 0;
  const candidateIds = [
    manifest.tts_config.audio_assistant_slot_token_id,
    manifest.tts_config.audio_end_token_id
  ];
  const candidateScores = candidateIds.map((tokenId) => textLogits[tokenId]);
  const sampledIndex = sampleFromScores(candidateScores, {
    doSample: generationDefaults.do_sample,
    temperature: generationDefaults.text_temperature,
    topK: Math.min(generationDefaults.text_top_k, candidateScores.length),
    topP: generationDefaults.text_top_p
  }, profileState, "sampling.assistant");
  finishProfileTiming(profileState, "sampling.assistant.wrapper", startedAt);
  return candidateIds[sampledIndex];
}
function sampleAudioToken(audioLogits, previousTokenIds, previousTokenSet, generationDefaults, profileState = null) {
  const startedAt = profileState?.enabled ? nowMs() : 0;
  if (!generationDefaults.do_sample) {
    const greedyIndex = argmaxWithRepetitionPenalty(
      audioLogits,
      previousTokenSet,
      generationDefaults.audio_repetition_penalty
    );
    finishProfileTiming(profileState, "sampling.audio.wrapper", startedAt);
    return greedyIndex;
  }
  const penalizedScores = applyRepetitionPenalty(
    audioLogits,
    previousTokenIds,
    generationDefaults.audio_repetition_penalty,
    profileState,
    "sampling.audio"
  );
  const sampledIndex = sampleFromScores(penalizedScores, {
    doSample: generationDefaults.do_sample,
    temperature: generationDefaults.audio_temperature,
    topK: generationDefaults.audio_top_k,
    topP: generationDefaults.audio_top_p
  }, profileState, "sampling.audio");
  finishProfileTiming(profileState, "sampling.audio.wrapper", startedAt);
  return sampledIndex;
}
function normalizeSampleMode(rawSampleMode, rawDoSample = true) {
  const normalized = String(rawSampleMode || "").trim();
  if ([SAMPLE_MODE_GREEDY, SAMPLE_MODE_FIXED, SAMPLE_MODE_FULL].includes(normalized)) {
    return normalized;
  }
  if (normalized === "mixed3") {
    return rawDoSample === false ? SAMPLE_MODE_GREEDY : SAMPLE_MODE_FIXED;
  }
  return rawDoSample === false ? SAMPLE_MODE_GREEDY : SAMPLE_MODE_FIXED;
}
function resolveGenerationDefaults(baseDefaults, options = {}) {
  const fallbackDoSample = options.doSample !== void 0 && options.doSample !== null ? options.doSample !== false : baseDefaults.do_sample !== false;
  const requestedSampleMode = options.sampleMode !== void 0 && options.sampleMode !== null ? options.sampleMode : fallbackDoSample ? baseDefaults.sample_mode : SAMPLE_MODE_GREEDY;
  const sampleMode = normalizeSampleMode(
    requestedSampleMode,
    fallbackDoSample
  );
  return {
    ...baseDefaults,
    sample_mode: sampleMode,
    do_sample: sampleMode !== SAMPLE_MODE_GREEDY
  };
}
function drawClampedRandomU() {
  return Math.fround(Math.min(0.99999994, Math.max(0, Math.random())));
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 32768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    let chunkBinary = "";
    for (let inner = 0; inner < chunk.length; inner += 1) {
      chunkBinary += String.fromCharCode(chunk[inner]);
    }
    binary += chunkBinary;
  }
  return btoa(binary);
}
function ensureTokenizerSandboxFrame() {
  if (typeof document === "undefined") {
    throw new Error("Tokenizer sandbox requires a browser document context.");
  }
  if (tokenizerSandboxFrame?.contentWindow) {
    return Promise.resolve(tokenizerSandboxFrame);
  }
  if (tokenizerSandboxReadyPromise) {
    return tokenizerSandboxReadyPromise;
  }
  tokenizerSandboxReadyPromise = new Promise((resolve, reject) => {
    const existingFrame = document.getElementById(TOKENIZER_SANDBOX_IFRAME_ID);
    const iframe = existingFrame instanceof HTMLIFrameElement ? existingFrame : document.createElement("iframe");
    iframe.id = TOKENIZER_SANDBOX_IFRAME_ID;
    iframe.src = resolveBrowserAssetUrl("tokenizer_sandbox.html");
    iframe.style.position = "fixed";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    const cleanup = () => {
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      tokenizerSandboxFrame = iframe;
      resolve(iframe);
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Failed to load tokenizer sandbox iframe."));
    };
    iframe.addEventListener("load", handleLoad, { once: true });
    iframe.addEventListener("error", handleError, { once: true });
    if (!existingFrame) {
      (document.documentElement || document.body || document).appendChild(iframe);
    } else if (iframe.contentWindow) {
      cleanup();
      tokenizerSandboxFrame = iframe;
      resolve(iframe);
    }
  }).finally(() => {
    tokenizerSandboxReadyPromise = null;
  });
  return tokenizerSandboxReadyPromise;
}
if (typeof window !== "undefined" && !window.__nanoReaderTokenizerSandboxListenerInstalled) {
  window.__nanoReaderTokenizerSandboxListenerInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== tokenizerSandboxFrame?.contentWindow) {
      return;
    }
    const payload = event.data;
    if (!payload || payload.source !== TOKENIZER_SANDBOX_SOURCE || payload.type !== "response") {
      return;
    }
    const pending = pendingTokenizerSandboxRequests.get(payload.requestId);
    if (!pending) {
      return;
    }
    pendingTokenizerSandboxRequests.delete(payload.requestId);
    if (payload.ok) {
      pending.resolve(payload.data);
    } else {
      pending.reject(new Error(payload.error || "Tokenizer sandbox request failed."));
    }
  });
}
async function postTokenizerSandboxRequest(action, data = {}) {
  const bridge = globalThis.__freecutMossTokenizerBridge;
  if (typeof bridge === "function") {
    return bridge(action, data);
  }
  const iframe = await ensureTokenizerSandboxFrame();
  if (!iframe.contentWindow) {
    throw new Error("Tokenizer sandbox iframe is not ready.");
  }
  const requestId = `tokenizer-${Date.now()}-${tokenizerSandboxRequestCounter += 1}`;
  return new Promise((resolve, reject) => {
    pendingTokenizerSandboxRequests.set(requestId, { resolve, reject });
    iframe.contentWindow.postMessage({
      source: TOKENIZER_SANDBOX_SOURCE,
      type: "request",
      requestId,
      action,
      ...data
    }, "*");
  });
}
function buildTextRows(tokenIds, manifest) {
  const rows = [];
  const rowWidth = manifest.tts_config.n_vq + 1;
  for (const tokenId of tokenIds) {
    const row = new Array(rowWidth).fill(manifest.tts_config.audio_pad_token_id);
    row[0] = tokenId;
    rows.push(row);
  }
  return rows;
}
function buildAudioPrefixRows(promptAudioCodes, manifest, slotTokenId = null) {
  const rows = [];
  const rowWidth = manifest.tts_config.n_vq + 1;
  const resolvedSlotTokenId = slotTokenId ?? manifest.tts_config.audio_user_slot_token_id;
  for (const codeRow of promptAudioCodes) {
    const row = new Array(rowWidth).fill(manifest.tts_config.audio_pad_token_id);
    row[0] = resolvedSlotTokenId;
    for (let index = 0; index < Math.min(codeRow.length, manifest.tts_config.n_vq); index += 1) {
      row[index + 1] = codeRow[index];
    }
    rows.push(row);
  }
  return rows;
}
function buildVoiceCloneRequestRows({ manifest, promptAudioCodes, textTokenIds }) {
  const prefixTextTokenIds = [
    ...manifest.prompt_templates.user_prompt_prefix_token_ids,
    manifest.tts_config.audio_start_token_id
  ];
  const suffixTextTokenIds = [
    manifest.tts_config.audio_end_token_id,
    ...manifest.prompt_templates.user_prompt_after_reference_token_ids,
    ...textTokenIds,
    ...manifest.prompt_templates.assistant_prompt_prefix_token_ids,
    manifest.tts_config.audio_start_token_id
  ];
  const rows = [
    ...buildTextRows(prefixTextTokenIds, manifest),
    ...buildAudioPrefixRows(promptAudioCodes, manifest),
    ...buildTextRows(suffixTextTokenIds, manifest)
  ];
  return {
    inputIds: rows,
    attentionMask: [new Array(rows.length).fill(1)]
  };
}
function containsCjk(text) {
  return [...String(text || "")].some((character) => character >= "\u4E00" && character <= "\u9FFF" || character >= "\u3400" && character <= "\u4DBF" || character >= "\u3040" && character <= "\u30FF" || character >= "\uAC00" && character <= "\uD7AF");
}
function prepareTextForSentenceChunking(text) {
  let normalizedText = String(text || "").trim();
  if (!normalizedText) {
    throw new Error("Text prompt cannot be empty.");
  }
  normalizedText = normalizedText.replace(/\r/g, " ").replace(/\n/g, " ");
  while (normalizedText.includes("  ")) {
    normalizedText = normalizedText.replace(/  /g, " ");
  }
  if (containsCjk(normalizedText)) {
    if (!SENTENCE_END_PUNCTUATION.has(normalizedText[normalizedText.length - 1])) {
      normalizedText += "\u3002";
    }
    return normalizedText;
  }
  if (/^[a-z]/.test(normalizedText)) {
    normalizedText = normalizedText[0].toUpperCase() + normalizedText.slice(1);
  }
  if (/[A-Za-z0-9]$/.test(normalizedText)) {
    normalizedText += ".";
  }
  if (normalizedText.split(/\s+/).filter(Boolean).length < 5) {
    normalizedText = `        ${normalizedText}`;
  }
  return normalizedText;
}
function normalizeBrowserTextNormalizationOptions(options = {}) {
  return {
    enableNormalizeTtsText: options.enableNormalizeTtsText !== false,
    enableWeTextProcessing: options.enableWeTextProcessing !== false
  };
}
function createPreparedTextInfo({
  rawText,
  text,
  normalizationOptions,
  wetextAvailable = false,
  wetextApplied = false,
  normalizationStages = [],
  warnings = []
}) {
  return {
    rawText,
    text,
    changed: text !== rawText,
    normalizationOptions,
    wetextRequested: normalizationOptions.enableWeTextProcessing,
    wetextAvailable,
    wetextApplied,
    normalizeTtsTextApplied: normalizationStages.includes("robust"),
    normalizationStages,
    normalizationMethod: normalizationStages.length > 0 ? normalizationStages.join("+") : "none",
    warnings
  };
}
function splitTextByPunctuation(text, punctuation) {
  const sentences = [];
  const currentChars = [];
  let index = 0;
  const normalizedText = String(text);
  while (index < normalizedText.length) {
    const character = normalizedText[index];
    currentChars.push(character);
    if (punctuation.has(character)) {
      let lookahead = index + 1;
      while (lookahead < normalizedText.length && CLOSING_PUNCTUATION.has(normalizedText[lookahead])) {
        currentChars.push(normalizedText[lookahead]);
        lookahead += 1;
      }
      const sentence = currentChars.join("").trim();
      if (sentence) {
        sentences.push(sentence);
      }
      currentChars.length = 0;
      while (lookahead < normalizedText.length && /\s/.test(normalizedText[lookahead])) {
        lookahead += 1;
      }
      index = lookahead;
      continue;
    }
    index += 1;
  }
  const tail = currentChars.join("").trim();
  if (tail) {
    sentences.push(tail);
  }
  return sentences;
}
function joinSentenceParts(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (containsCjk(left) || containsCjk(right)) {
    return left + right;
  }
  return `${left} ${right}`;
}
function computeStreamLeadSeconds(emittedSamplesTotal, sampleRate, firstAudioEmittedAtSeconds) {
  if (!firstAudioEmittedAtSeconds || !(sampleRate > 0)) {
    return 0;
  }
  const elapsedSeconds = Math.max(0, performance.now() / 1e3 - firstAudioEmittedAtSeconds);
  const emittedSeconds = emittedSamplesTotal / sampleRate;
  return emittedSeconds - elapsedSeconds;
}
function resolveStreamDecodeFrameBudget({ emittedSamplesTotal, sampleRate, firstAudioEmittedAtSeconds }) {
  const leadSeconds = computeStreamLeadSeconds(emittedSamplesTotal, sampleRate, firstAudioEmittedAtSeconds);
  if (!firstAudioEmittedAtSeconds || leadSeconds < 0.2) {
    return 1;
  }
  if (leadSeconds < 0.55) {
    return 2;
  }
  if (leadSeconds < 1.1) {
    return 4;
  }
  return 8;
}
var CodecStreamingDecodeSession = class {
  constructor({ codecMeta, session, getProfileState = null }) {
    this.codecMeta = codecMeta;
    this.session = session;
    this.getProfileState = typeof getProfileState === "function" ? getProfileState : null;
    this.transformerSpecs = codecMeta.streaming_decode.transformer_offsets || [];
    this.attentionSpecs = codecMeta.streaming_decode.attention_caches || [];
    this.audioCodeTensorCache = /* @__PURE__ */ new Map();
    this.audioCodeLengthsData = new Int32Array(1);
    this.audioCodeLengthsTensor = new ort.Tensor("int32", this.audioCodeLengthsData, [1]);
    this.stateFeeds = {};
    this.runFeeds = {
      audio_codes: null,
      audio_code_lengths: this.audioCodeLengthsTensor
    };
    this.reset();
  }
  reset() {
    this.stateFeeds = {};
    for (const spec of this.transformerSpecs) {
      this.stateFeeds[spec.input_name] = new ort.Tensor(
        "int32",
        new Int32Array(multiplyShape(spec.shape)),
        spec.shape
      );
    }
    for (const spec of this.attentionSpecs) {
      this.stateFeeds[spec.offset_input_name] = new ort.Tensor(
        "int32",
        new Int32Array(multiplyShape(spec.offset_shape)),
        spec.offset_shape
      );
      this.stateFeeds[spec.cached_keys_input_name] = new ort.Tensor(
        "float32",
        new Float32Array(multiplyShape(spec.cache_shape)),
        spec.cache_shape
      );
      this.stateFeeds[spec.cached_values_input_name] = new ort.Tensor(
        "float32",
        new Float32Array(multiplyShape(spec.cache_shape)),
        spec.cache_shape
      );
      const positions = new Int32Array(multiplyShape(spec.positions_shape));
      positions.fill(-1);
      this.stateFeeds[spec.cached_positions_input_name] = new ort.Tensor(
        "int32",
        positions,
        spec.positions_shape
      );
    }
    for (const [name, tensor] of Object.entries(this.stateFeeds)) {
      this.runFeeds[name] = tensor;
    }
  }
  ensureAudioCodeTensor(frameCount) {
    const numQuantizers = this.codecMeta.codec_config.num_quantizers;
    const cacheKey = `${frameCount}`;
    if (!this.audioCodeTensorCache.has(cacheKey)) {
      const data = new Int32Array(frameCount * numQuantizers);
      this.audioCodeTensorCache.set(cacheKey, {
        data,
        tensor: new ort.Tensor("int32", data, [1, frameCount, numQuantizers])
      });
    }
    return this.audioCodeTensorCache.get(cacheKey);
  }
  async runFrames(frameRows) {
    if (!frameRows?.length) {
      return null;
    }
    const profileState = this.getProfileState ? this.getProfileState() : null;
    const numQuantizers = this.codecMeta.codec_config.num_quantizers;
    const frameCount = frameRows.length;
    const { data: audioCodes, tensor: audioCodesTensor } = this.ensureAudioCodeTensor(frameCount);
    let offset = 0;
    for (const frameRow of frameRows) {
      for (let channelIndex = 0; channelIndex < numQuantizers; channelIndex += 1) {
        audioCodes[offset] = frameRow[channelIndex] ?? 0;
        offset += 1;
      }
    }
    this.audioCodeLengthsData[0] = frameCount;
    this.runFeeds.audio_codes = audioCodesTensor;
    const sessionStartedAt = profileState?.enabled ? nowMs() : 0;
    const outputs = await this.session.run(this.runFeeds);
    finishProfileTiming(profileState, "audio_decode.streaming_codec_decode_session", sessionStartedAt);
    recordProfileCounter(profileState, "audio_decode.streaming_codec_decode_frames", frameCount);
    for (const spec of this.transformerSpecs) {
      this.stateFeeds[spec.input_name] = outputs[spec.output_name];
      this.runFeeds[spec.input_name] = outputs[spec.output_name];
    }
    for (const spec of this.attentionSpecs) {
      this.stateFeeds[spec.offset_input_name] = outputs[spec.offset_output_name];
      this.stateFeeds[spec.cached_keys_input_name] = outputs[spec.cached_keys_output_name];
      this.stateFeeds[spec.cached_values_input_name] = outputs[spec.cached_values_output_name];
      this.stateFeeds[spec.cached_positions_input_name] = outputs[spec.cached_positions_output_name];
      this.runFeeds[spec.offset_input_name] = outputs[spec.offset_output_name];
      this.runFeeds[spec.cached_keys_input_name] = outputs[spec.cached_keys_output_name];
      this.runFeeds[spec.cached_values_input_name] = outputs[spec.cached_values_output_name];
      this.runFeeds[spec.cached_positions_input_name] = outputs[spec.cached_positions_output_name];
    }
    return {
      audio: outputs.audio,
      audio_lengths: outputs.audio_lengths
    };
  }
};
var BrowserOnnxTtsRuntime = class {
  constructor({ logger = null, assetReader = null } = {}) {
    this.logger = typeof logger === "function" ? logger : null;
    this.assetReader = assetReader || null;
    this.profileState = null;
    this.localPathRoot = "";
    this.threadCount = 1;
    this.manifest = null;
    this.manifestRelativePath = "";
    this.manifestRelativeDir = "";
    this.ttsMeta = null;
    this.ttsMetaRelativePath = "";
    this.codecMeta = null;
    this.codecMetaRelativePath = "";
    this.sessions = {};
    this.codecStreamingSession = null;
    this.prepared = false;
    this.warmedUp = false;
    this.lastPreparedKey = "";
    this.tokenizer = null;
    this.tokenizerModelKey = "";
    this.hasWarnedWetextUnavailable = false;
    this.lastPreparedTextInfo = null;
    this.resetRuntimeCaches();
  }
  log(message) {
    if (this.logger) {
      this.logger(message);
    }
  }
  setProfilingEnabled(enabled = true) {
    this.profileState = enabled ? createProfileState() : null;
    return this.getProfileSnapshot();
  }
  resetProfile() {
    if (this.profileState?.enabled) {
      this.profileState = createProfileState();
    }
    return this.getProfileSnapshot();
  }
  getProfileSnapshot() {
    return cloneProfileSnapshot(this.profileState);
  }
  resetRuntimeCaches() {
    this.emptyLocalCachedPast = null;
    this.localCachedPastInputNames = [];
    this.localCachedPresentOutputNames = [];
    this.decodePastInputNames = [];
    this.decodePresentOutputNames = [];
    this.reusableLocalGreedyFeeds = null;
    this.reusableLocalGreedySeenMaskData = null;
    this.reusableLocalGreedyPenaltyData = null;
    this.reusableLocalFixedSampledFeeds = null;
    this.reusableLocalFixedSampledSeenMaskData = null;
    this.reusableLocalFixedSampledAssistantRandomData = null;
    this.reusableLocalFixedSampledAudioRandomData = null;
    this.reusableLocalDecoderFeeds = null;
    this.reusableLocalDecoderTextTokenData = null;
    this.reusableLocalDecoderPrefixData = null;
    this.reusableLocalCachedFeeds = null;
    this.reusableLocalCachedTextTokenData = null;
    this.reusableLocalCachedAudioTokenData = null;
    this.reusableLocalCachedChannelIndexData = null;
    this.reusableLocalCachedStepTypeData = null;
    this.reusableLocalCachedPastValidLengthData = null;
    this.reusableDecodeFeeds = null;
    this.reusableDecodeRowData = null;
    this.reusableDecodePastLengthData = null;
    this.reusableCodecDecodeFullLengthData = null;
    this.reusableCodecEncodeFeeds = null;
    this.reusableCodecEncodeLengthData = null;
  }
  ensureReusableSynthesisState() {
    if (!this.manifest || !this.ttsMeta || !this.codecMeta) {
      return;
    }
    const needsLocalGreedy = Boolean(this.ttsMeta.files.local_greedy_frame);
    const needsLocalFixedSampled = Boolean(this.ttsMeta.files.local_fixed_sampled_frame);
    if (this.reusableDecodeFeeds && this.reusableLocalCachedFeeds && (!needsLocalGreedy || this.reusableLocalGreedyFeeds) && (!needsLocalFixedSampled || this.reusableLocalFixedSampledFeeds)) {
      return;
    }
    const rowWidth = this.manifest.tts_config.n_vq + 1;
    const audioPadTokenId = this.manifest.tts_config.audio_pad_token_id;
    const localHeads = Number(this.ttsMeta.model_config.local_heads || 0);
    const localHeadDim = Number(this.ttsMeta.model_config.local_head_dim || 0);
    this.decodePastInputNames = this.ttsMeta.onnx.decode_input_names.slice(2);
    this.decodePresentOutputNames = this.ttsMeta.onnx.decode_output_names.slice(1);
    this.localCachedPastInputNames = Array.isArray(this.ttsMeta.onnx.local_cached_input_names) ? this.ttsMeta.onnx.local_cached_input_names.slice(6) : this.ttsMeta.onnx.local_cached_output_names.slice(2).map((name) => name.replace("local_present_", "local_past_"));
    this.localCachedPresentOutputNames = this.ttsMeta.onnx.local_cached_output_names.slice(2);
    this.emptyLocalCachedPast = {};
    for (const tensorName of this.localCachedPastInputNames) {
      this.emptyLocalCachedPast[tensorName] = new ort.Tensor("float32", new Float32Array(0), [1, 0, localHeads, localHeadDim]);
    }
    this.reusableLocalDecoderTextTokenData = new Int32Array(1);
    this.reusableLocalDecoderPrefixData = new Int32Array(this.manifest.tts_config.n_vq - 1);
    this.reusableLocalDecoderPrefixData.fill(audioPadTokenId);
    this.reusableLocalDecoderFeeds = {
      global_hidden: null,
      text_token_id: new ort.Tensor("int32", this.reusableLocalDecoderTextTokenData, [1]),
      audio_prefix_token_ids: new ort.Tensor(
        "int32",
        this.reusableLocalDecoderPrefixData,
        [1, this.reusableLocalDecoderPrefixData.length]
      )
    };
    this.reusableLocalCachedTextTokenData = new Int32Array(1);
    this.reusableLocalCachedAudioTokenData = new Int32Array(1);
    this.reusableLocalCachedChannelIndexData = new Int32Array(1);
    this.reusableLocalCachedStepTypeData = new Int32Array(1);
    this.reusableLocalCachedPastValidLengthData = new Int32Array(1);
    this.reusableLocalCachedFeeds = {
      global_hidden: null,
      text_token_id: new ort.Tensor("int32", this.reusableLocalCachedTextTokenData, [1]),
      audio_token_id: new ort.Tensor("int32", this.reusableLocalCachedAudioTokenData, [1]),
      channel_index: new ort.Tensor("int32", this.reusableLocalCachedChannelIndexData, [1]),
      step_type: new ort.Tensor("int32", this.reusableLocalCachedStepTypeData, [1]),
      past_valid_lengths: new ort.Tensor("int32", this.reusableLocalCachedPastValidLengthData, [1])
    };
    this.resetLocalCachedState();
    this.reusableDecodeRowData = new Int32Array(rowWidth);
    this.reusableDecodeRowData.fill(audioPadTokenId);
    this.reusableDecodePastLengthData = new Int32Array(1);
    this.reusableDecodeFeeds = {
      input_ids: new ort.Tensor("int32", this.reusableDecodeRowData, [1, 1, rowWidth]),
      past_valid_lengths: new ort.Tensor("int32", this.reusableDecodePastLengthData, [1])
    };
    for (const inputName of this.decodePastInputNames) {
      this.reusableDecodeFeeds[inputName] = null;
    }
    this.reusableCodecDecodeFullLengthData = new Int32Array(1);
    this.reusableCodecEncodeLengthData = new Int32Array(1);
    if (needsLocalGreedy) {
      const audioCodebookSize = Number(this.ttsMeta.model_config.audio_codebook_sizes?.[0] || 1024);
      this.reusableLocalGreedySeenMaskData = new Int32Array(this.manifest.tts_config.n_vq * audioCodebookSize);
      this.reusableLocalGreedyPenaltyData = new Float32Array(1);
      this.reusableLocalGreedyFeeds = {
        global_hidden: null,
        repetition_seen_mask: new ort.Tensor(
          "int32",
          this.reusableLocalGreedySeenMaskData,
          [1, this.manifest.tts_config.n_vq, audioCodebookSize]
        ),
        repetition_penalty: new ort.Tensor("float32", this.reusableLocalGreedyPenaltyData, [1])
      };
    }
    if (needsLocalFixedSampled) {
      const audioCodebookSize = Number(this.ttsMeta.model_config.audio_codebook_sizes?.[0] || 1024);
      this.reusableLocalFixedSampledSeenMaskData = new Int32Array(this.manifest.tts_config.n_vq * audioCodebookSize);
      this.reusableLocalFixedSampledAssistantRandomData = new Float32Array(1);
      this.reusableLocalFixedSampledAudioRandomData = new Float32Array(this.manifest.tts_config.n_vq);
      this.reusableLocalFixedSampledFeeds = {
        global_hidden: null,
        repetition_seen_mask: new ort.Tensor(
          "int32",
          this.reusableLocalFixedSampledSeenMaskData,
          [1, this.manifest.tts_config.n_vq, audioCodebookSize]
        ),
        assistant_random_u: new ort.Tensor("float32", this.reusableLocalFixedSampledAssistantRandomData, [1]),
        audio_random_u: new ort.Tensor(
          "float32",
          this.reusableLocalFixedSampledAudioRandomData,
          [1, this.manifest.tts_config.n_vq]
        )
      };
    }
  }
  resetLocalCachedState() {
    if (!this.reusableLocalCachedFeeds) {
      return;
    }
    for (const inputName of this.localCachedPastInputNames) {
      this.reusableLocalCachedFeeds[inputName] = this.emptyLocalCachedPast[inputName];
    }
  }
  updateDecodePastFeeds(outputs) {
    for (let index = 0; index < this.decodePastInputNames.length; index += 1) {
      this.reusableDecodeFeeds[this.decodePastInputNames[index]] = outputs[this.decodePresentOutputNames[index]];
    }
  }
  prepareSynthesisText(text, options = {}) {
    const startedAt = this.profileState?.enabled ? nowMs() : 0;
    try {
      const rawText = String(text || "");
      const normalizationOptions = normalizeBrowserTextNormalizationOptions(options);
      const warnings = [];
      const normalizationStages = [];
      if (normalizationOptions.enableWeTextProcessing && !this.hasWarnedWetextUnavailable) {
        this.log("WeTextProcessing is not available in browser_onnx yet; using robust normalization only.");
        this.hasWarnedWetextUnavailable = true;
      }
      if (normalizationOptions.enableWeTextProcessing) {
        warnings.push("WeTextProcessing requested but not available in browser_onnx.");
        normalizationStages.push("wetext_unavailable");
      }
      if (!normalizationOptions.enableNormalizeTtsText) {
        const preparedTextInfo2 = createPreparedTextInfo({
          rawText,
          text: rawText,
          normalizationOptions,
          wetextAvailable: false,
          wetextApplied: false,
          normalizationStages,
          warnings
        });
        this.lastPreparedTextInfo = preparedTextInfo2;
        return preparedTextInfo2;
      }
      const normalizedText = normalizeTtsText(rawText);
      if (normalizedText !== rawText) {
        this.log(`Robust text normalization applied chars_before=${rawText.length} chars_after=${normalizedText.length}`);
      }
      normalizationStages.push("robust");
      const preparedTextInfo = createPreparedTextInfo({
        rawText,
        text: normalizedText,
        normalizationOptions,
        wetextAvailable: false,
        wetextApplied: false,
        normalizationStages,
        warnings
      });
      this.lastPreparedTextInfo = preparedTextInfo;
      return preparedTextInfo;
    } finally {
      finishProfileTiming(this.profileState, "text.prepare_synthesis_text", startedAt);
    }
  }
  async configure({ modelPath, threadCount = 4 }) {
    const normalizedPath = normalizeLocalDirectoryPath(modelPath);
    const nextThreadCount = Math.max(1, parseInt(threadCount, 10) || 1);
    const preparationKey = `${normalizedPath}::${nextThreadCount}`;
    if (this.lastPreparedKey === preparationKey && this.prepared) {
      return;
    }
    this.localPathRoot = normalizedPath;
    this.threadCount = nextThreadCount;
    this.manifest = null;
    this.manifestRelativePath = "";
    this.manifestRelativeDir = "";
    this.ttsMeta = null;
    this.ttsMetaRelativePath = "";
    this.codecMeta = null;
    this.codecMetaRelativePath = "";
    this.sessions = {};
    this.tokenizer = null;
    this.tokenizerModelKey = "";
    this.codecStreamingSession = null;
    this.prepared = false;
    this.warmedUp = false;
    this.lastPreparedKey = preparationKey;
    this.hasWarnedWetextUnavailable = false;
    this.lastPreparedTextInfo = null;
    this.resetRuntimeCaches();
  }
  async readTextAsset(relativePath) {
    if (this.assetReader?.readText) {
      return this.assetReader.readText({
        rootPath: this.localPathRoot,
        relativePath: normalizeRelativePath(relativePath)
      });
    }
    if (isManagedModelPath(this.localPathRoot)) {
      const store = getManagedModelStore();
      if (!store?.readTextFromManagedPath) {
        throw new Error("Managed browser ONNX model support is not available in this context.");
      }
      return store.readTextFromManagedPath(this.localPathRoot, normalizeRelativePath(relativePath));
    }
    return readTextFromLocalPath(this.localPathRoot, relativePath);
  }
  async readJsonAsset(relativePath) {
    if (this.assetReader?.readJson) {
      return this.assetReader.readJson({
        rootPath: this.localPathRoot,
        relativePath: normalizeRelativePath(relativePath)
      });
    }
    return JSON.parse(await this.readTextAsset(relativePath));
  }
  async readBufferAsset(relativePath) {
    if (this.assetReader?.readBuffer) {
      return this.assetReader.readBuffer({
        rootPath: this.localPathRoot,
        relativePath: normalizeRelativePath(relativePath)
      });
    }
    if (isManagedModelPath(this.localPathRoot)) {
      const store = getManagedModelStore();
      if (!store?.readBufferFromManagedPath) {
        throw new Error("Managed browser ONNX model support is not available in this context.");
      }
      return store.readBufferFromManagedPath(this.localPathRoot, normalizeRelativePath(relativePath));
    }
    return readBufferFromLocalPath(this.localPathRoot, relativePath);
  }
  resolveManifestRelativeAssetPath(relativePath) {
    return joinRelativeAssetPath(this.manifestRelativeDir, relativePath);
  }
  async readFirstAvailableJsonAsset(relativePaths) {
    let lastError = null;
    for (const relativePath of relativePaths) {
      try {
        return {
          data: await this.readJsonAsset(relativePath),
          relativePath: normalizeRelativePath(relativePath)
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error("No manifest candidate paths were provided.");
  }
  getEffectiveThreadCount() {
    const hardware = navigator.hardwareConcurrency || 4;
    if (!crossOriginIsolated) {
      return 1;
    }
    return Math.max(1, Math.min(this.threadCount, hardware));
  }
  async ensureManifestLoaded() {
    if (this.manifest && this.ttsMeta && this.codecMeta) {
      return;
    }
    if (!this.localPathRoot) {
      throw new Error("Browser ONNX model path is not configured.");
    }
    this.log("Reading browser_poc_manifest.json");
    const manifestResult = await this.readFirstAvailableJsonAsset(MANIFEST_CANDIDATE_RELATIVE_PATHS);
    this.manifest = manifestResult.data;
    this.manifestRelativePath = manifestResult.relativePath;
    this.manifestRelativeDir = this.manifestRelativePath.split("/").slice(0, -1).join("/");
    this.ttsMetaRelativePath = this.resolveManifestRelativeAssetPath(this.manifest.model_files.tts_meta);
    this.codecMetaRelativePath = this.resolveManifestRelativeAssetPath(this.manifest.model_files.codec_meta);
    this.ttsMeta = await this.readJsonAsset(this.ttsMetaRelativePath);
    this.codecMeta = await this.readJsonAsset(this.codecMetaRelativePath);
    this.ensureReusableSynthesisState();
    if (this.manifestRelativePath !== "browser_poc_manifest.json") {
      this.log(`Manifest resolved: ${this.manifestRelativePath}`);
    }
    this.log(
      `Manifest ready: builtinVoices=${this.manifest.builtin_voices.length} textSamples=${this.manifest.text_samples.length}`
    );
  }
  async ensureOrtConfigured() {
    ort.env.wasm.numThreads = this.getEffectiveThreadCount();
    ort.env.wasm.wasmPaths = resolveBrowserAssetUrl("vendor/ort/");
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
  }
  async createOrtSession(relativePath, externalDataRelativePaths = []) {
    const modelData = await this.readBufferAsset(relativePath);
    this.log(`Loaded model bytes: ${relativePath} (${formatByteCount(modelData.byteLength)})`);
    const sessionOptions = {
      ...ORT_SESSION_OPTIONS,
      executionProviders: [...ORT_SESSION_OPTIONS.executionProviders]
    };
    const fallbackExternalDataInfo = getExternalDataSidecarInfo(relativePath);
    const candidateExternalDataPaths = externalDataRelativePaths.length > 0 ? [...new Set(externalDataRelativePaths.map((pathValue) => normalizeRelativePath(pathValue)).filter(Boolean))] : fallbackExternalDataInfo ? [fallbackExternalDataInfo.relativePath] : [];
    if (candidateExternalDataPaths.length > 0) {
      const loadedExternalData = [];
      for (const externalDataRelativePath of candidateExternalDataPaths) {
        try {
          const externalData = await this.readBufferAsset(externalDataRelativePath);
          const pathParts = externalDataRelativePath.split("/");
          const mountPath = pathParts[pathParts.length - 1] || externalDataRelativePath;
          loadedExternalData.push({
            path: mountPath,
            data: externalData
          });
          this.log(`Loaded external data bytes: ${externalDataRelativePath} (${formatByteCount(externalData.byteLength)})`);
        } catch (error) {
          this.log(`External data sidecar not used: ${externalDataRelativePath}`);
        }
      }
      if (loadedExternalData.length > 0) {
        sessionOptions.externalData = loadedExternalData;
      }
    }
    return ort.InferenceSession.create(modelData, {
      ...sessionOptions
    });
  }
  async ensureTokenizerLoaded() {
    await this.ensureManifestLoaded();
    if (this.tokenizer) {
      return;
    }
    const tokenizerRelativePath = this.resolveManifestRelativeAssetPath(
      this.manifest.model_files.tokenizer_model || "tokenizer.model"
    );
    const tokenizerBytes = await this.readBufferAsset(tokenizerRelativePath);
    const tokenizerBase64 = bytesToBase64(tokenizerBytes);
    const modelKey = `${this.localPathRoot}::${tokenizerRelativePath}`;
    await postTokenizerSandboxRequest("loadTokenizer", {
      modelKey,
      tokenizerBase64
    });
    this.tokenizer = { modelKey };
    this.tokenizerModelKey = modelKey;
    this.log(`Tokenizer loaded via sandbox: ${tokenizerRelativePath}`);
  }
  async ensureCodecEncodeLoaded() {
    await this.ensureManifestLoaded();
    await this.ensureOrtConfigured();
    if (this.sessions.codecEncode) {
      return;
    }
    const codecBaseDir = this.codecMetaRelativePath.split("/").slice(0, -1).join("/");
    const relativePath = joinRelativeAssetPath(codecBaseDir, this.codecMeta.files.encode);
    const externalDataRelativePaths = resolveModelExternalDataRelativePaths(codecBaseDir, this.codecMeta.external_data_files, this.codecMeta.files.encode);
    this.log(`Creating ORT session: ${relativePath}`);
    this.sessions.codecEncode = await this.createOrtSession(relativePath, externalDataRelativePaths);
    this.log(`ORT session ready: ${relativePath}`);
  }
  buildCodecEncodeFeeds(waveform, waveformLength) {
    const session = this.sessions.codecEncode;
    const feeds = {
      waveform: new ort.Tensor(
        "float32",
        waveform,
        [1, this.codecMeta.codec_config.channels, waveformLength]
      )
    };
    const inputNames = Array.isArray(session?.inputNames) ? session.inputNames : [];
    if (inputNames.includes("input_lengths")) {
      feeds.input_lengths = new ort.Tensor("int32", new Int32Array([waveformLength]), [1]);
    } else if (inputNames.length > 0 && !inputNames.includes("waveform")) {
      this.log(`Unexpected codecEncode inputs: ${inputNames.join(", ")}`);
    }
    return feeds;
  }
  async ensureSynthesisLoaded() {
    await this.ensureManifestLoaded();
    await this.ensureOrtConfigured();
    if (this.prepared) {
      return;
    }
    this.log(
      `ORT web=${ort.env.versions?.web || "unknown"} threads=${ort.env.wasm.numThreads} simd=${String(ort.env.wasm.simd)} proxy=${String(ort.env.wasm.proxy)} crossOriginIsolated=${String(crossOriginIsolated)}`
    );
    this.log(`ORT wasm path=${String(ort.env.wasm.wasmPaths)}`);
    this.log(`ORT session options=${JSON.stringify(ORT_SESSION_OPTIONS)}`);
    const ttsBaseDir = this.ttsMetaRelativePath.split("/").slice(0, -1).join("/");
    const codecBaseDir = this.codecMetaRelativePath.split("/").slice(0, -1).join("/");
    const sessionSpecs = [
      ["prefill", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.prefill), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.prefill)],
      ["decode", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.decode_step), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.decode_step)],
      ["codecDecode", joinRelativeAssetPath(codecBaseDir, this.codecMeta.files.decode_full), resolveModelExternalDataRelativePaths(codecBaseDir, this.codecMeta.external_data_files, this.codecMeta.files.decode_full)],
      ["codecEncode", joinRelativeAssetPath(codecBaseDir, this.codecMeta.files.encode), resolveModelExternalDataRelativePaths(codecBaseDir, this.codecMeta.external_data_files, this.codecMeta.files.encode)]
    ];
    if (this.ttsMeta.files.local_greedy_frame) {
      sessionSpecs.push(["localGreedyFrame", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.local_greedy_frame), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.local_greedy_frame)]);
    }
    if (this.ttsMeta.files.local_fixed_sampled_frame) {
      sessionSpecs.push(["localFixedSampledFrame", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.local_fixed_sampled_frame), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.local_fixed_sampled_frame)]);
    }
    if (this.ttsMeta.files.local_cached_step) {
      sessionSpecs.push(["localCachedStep", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.local_cached_step), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.local_cached_step)]);
    } else {
      sessionSpecs.push(["localDecoder", joinRelativeAssetPath(ttsBaseDir, this.ttsMeta.files.local_decoder), resolveModelExternalDataRelativePaths(ttsBaseDir, this.ttsMeta.external_data_files, this.ttsMeta.files.local_decoder)]);
    }
    if (this.codecMeta.files.decode_step) {
      sessionSpecs.push(["codecDecodeStep", joinRelativeAssetPath(codecBaseDir, this.codecMeta.files.decode_step), resolveModelExternalDataRelativePaths(codecBaseDir, this.codecMeta.external_data_files, this.codecMeta.files.decode_step)]);
    }
    for (const [key, relativePath, externalDataRelativePaths] of sessionSpecs) {
      if (this.sessions[key]) {
        continue;
      }
      this.log(`Creating ORT session: ${relativePath}`);
      this.sessions[key] = await this.createOrtSession(relativePath, externalDataRelativePaths);
      this.log(`ORT session ready: ${relativePath}`);
    }
    this.codecStreamingSession = this.sessions.codecDecodeStep && this.codecMeta.streaming_decode ? new CodecStreamingDecodeSession({
      codecMeta: this.codecMeta,
      session: this.sessions.codecDecodeStep,
      getProfileState: () => this.profileState
    }) : null;
    this.prepared = true;
  }
  async warmup() {
    await this.ensureSynthesisLoaded();
    if (this.warmedUp) {
      return;
    }
    const builtinVoice = this.manifest.builtin_voices[0];
    const textSample = this.manifest.text_samples[0];
    if (builtinVoice && textSample) {
      const warmupGenerationDefaults = resolveGenerationDefaults(this.manifest.generation_defaults);
      const requestRows = buildVoiceCloneRequestRows({
        manifest: this.manifest,
        promptAudioCodes: builtinVoice.prompt_audio_codes,
        textTokenIds: textSample.text_token_ids
      });
      const { data: prefillIds, dims: prefillDims } = flatten3dInt32([requestRows.inputIds]);
      const { data: prefillMask, dims: prefillMaskDims } = flatten2dInt32(requestRows.attentionMask);
      const prefillOutputs = await this.sessions.prefill.run({
        input_ids: new ort.Tensor("int32", prefillIds, prefillDims),
        attention_mask: new ort.Tensor("int32", prefillMask, prefillMaskDims)
      });
      const globalHiddenTensor = extractLastHiddenTensor(prefillOutputs.global_hidden);
      if (this.sessions.localCachedStep) {
        await this.runLocalCachedStep({
          globalHiddenTensor,
          textTokenId: 0,
          audioTokenId: 0,
          channelIndex: 0,
          stepType: 0,
          pastValidLength: 0
        });
        this.resetLocalCachedState();
      }
      if (this.sessions.localFixedSampledFrame && warmupGenerationDefaults.sample_mode === SAMPLE_MODE_FIXED) {
        await this.runLocalFixedSampledFrame({
          globalHiddenTensor,
          previousTokenSetsByChannel: Array.from({ length: this.manifest.tts_config.n_vq }, () => /* @__PURE__ */ new Set())
        });
      } else if (this.sessions.localGreedyFrame && warmupGenerationDefaults.sample_mode === SAMPLE_MODE_GREEDY) {
        await this.runLocalGreedyFrame({
          globalHiddenTensor,
          previousTokenSetsByChannel: Array.from({ length: this.manifest.tts_config.n_vq }, () => /* @__PURE__ */ new Set()),
          generationDefaults: warmupGenerationDefaults
        });
      } else {
        await this.runLocalDecoder(globalHiddenTensor, this.manifest.tts_config.audio_assistant_slot_token_id, []);
      }
      const emptyFrames = [new Array(this.manifest.tts_config.n_vq).fill(0)];
      await this.decodeFullAudio(emptyFrames);
      if (this.codecStreamingSession) {
        this.codecStreamingSession.reset();
        await this.codecStreamingSession.runFrames(emptyFrames);
        this.codecStreamingSession.reset();
      }
    }
    const encodeChannels = this.codecMeta.codec_config.channels;
    const encodeLength = Math.max(this.codecMeta.codec_config.downsample_rate, 4096);
    const waveform = new Float32Array(encodeChannels * encodeLength);
    await this.sessions.codecEncode.run(this.buildCodecEncodeFeeds(waveform, encodeLength));
    this.warmedUp = true;
    this.log("Browser ONNX runtime warmed up.");
  }
  listBuiltinVoices() {
    return this.manifest?.builtin_voices || [];
  }
  listTextSamples() {
    return this.manifest?.text_samples || [];
  }
  async encodeText(text) {
    await this.ensureTokenizerLoaded();
    const startedAt = this.profileState?.enabled ? nowMs() : 0;
    try {
      return await postTokenizerSandboxRequest("encodeText", {
        modelKey: this.tokenizerModelKey,
        text: String(text || "")
      });
    } finally {
      finishProfileTiming(this.profileState, "text.encode_text", startedAt);
    }
  }
  async countTextTokens(text) {
    if (!this.tokenizer) {
      throw new Error("Tokenizer is not loaded.");
    }
    return (await this.encodeText(text)).length;
  }
  async splitTextByTokenBudget(text, maxTokens) {
    let remainingText = String(text || "").trim();
    if (!remainingText) {
      return [];
    }
    const pieces = [];
    const preferredBoundaryChars = /* @__PURE__ */ new Set([...CLAUSE_SPLIT_PUNCTUATION, ...SENTENCE_END_PUNCTUATION, " "]);
    while (remainingText) {
      if (await this.countTextTokens(remainingText) <= maxTokens) {
        pieces.push(remainingText);
        break;
      }
      let low = 1;
      let high = remainingText.length;
      let bestPrefixLength = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = remainingText.slice(0, middle).trim();
        if (!candidate) {
          low = middle + 1;
          continue;
        }
        if (await this.countTextTokens(candidate) <= maxTokens) {
          bestPrefixLength = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      let cutIndex = bestPrefixLength;
      const prefix = remainingText.slice(0, bestPrefixLength);
      let preferredIndex = -1;
      for (let scanIndex = prefix.length - 1; scanIndex > Math.max(-1, prefix.length - 25); scanIndex -= 1) {
        if (preferredBoundaryChars.has(prefix[scanIndex])) {
          preferredIndex = scanIndex + 1;
          break;
        }
      }
      if (preferredIndex > 0) {
        cutIndex = preferredIndex;
      }
      let piece = remainingText.slice(0, cutIndex).trim();
      if (!piece) {
        piece = remainingText.slice(0, bestPrefixLength).trim();
        cutIndex = bestPrefixLength;
      }
      pieces.push(piece);
      remainingText = remainingText.slice(cutIndex).trim();
    }
    return pieces;
  }
  async splitVoiceCloneText(text, maxTokens = 75) {
    const startedAt = this.profileState?.enabled ? nowMs() : 0;
    try {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) {
        return [];
      }
      const safeMaxTokens = Math.max(1, parseInt(maxTokens, 10) || 75);
      const preparedText = prepareTextForSentenceChunking(normalizedText);
      let sentenceCandidates = splitTextByPunctuation(preparedText, SENTENCE_END_PUNCTUATION);
      if (!sentenceCandidates.length) {
        sentenceCandidates = [preparedText.trim()];
      }
      const sentenceSlices = [];
      for (const sentenceText of sentenceCandidates) {
        const normalizedSentence = sentenceText.trim();
        if (!normalizedSentence) {
          continue;
        }
        const sentenceTokenCount = await this.countTextTokens(normalizedSentence);
        if (sentenceTokenCount <= safeMaxTokens) {
          sentenceSlices.push([sentenceTokenCount, normalizedSentence]);
          continue;
        }
        let clauseCandidates = splitTextByPunctuation(normalizedSentence, CLAUSE_SPLIT_PUNCTUATION);
        if (clauseCandidates.length <= 1) {
          clauseCandidates = [normalizedSentence];
        }
        for (const clauseText of clauseCandidates) {
          const normalizedClause = clauseText.trim();
          if (!normalizedClause) {
            continue;
          }
          const clauseTokenCount = await this.countTextTokens(normalizedClause);
          if (clauseTokenCount <= safeMaxTokens) {
            sentenceSlices.push([clauseTokenCount, normalizedClause]);
            continue;
          }
          for (const piece of await this.splitTextByTokenBudget(normalizedClause, safeMaxTokens)) {
            const normalizedPiece = piece.trim();
            if (normalizedPiece) {
              sentenceSlices.push([await this.countTextTokens(normalizedPiece), normalizedPiece]);
            }
          }
        }
      }
      const chunks = [];
      let currentChunk = "";
      let currentChunkTokenCount = 0;
      for (const [sentenceTokenCount, sentenceText] of sentenceSlices) {
        if (!currentChunk) {
          currentChunk = sentenceText;
          currentChunkTokenCount = sentenceTokenCount;
          continue;
        }
        if (currentChunkTokenCount + sentenceTokenCount > safeMaxTokens) {
          chunks.push(currentChunk.trim());
          currentChunk = sentenceText;
          currentChunkTokenCount = sentenceTokenCount;
        } else {
          currentChunk = joinSentenceParts(currentChunk, sentenceText);
          currentChunkTokenCount = await this.countTextTokens(currentChunk);
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      return chunks.length > 1 ? chunks : [normalizedText];
    } finally {
      finishProfileTiming(this.profileState, "text.split_voice_clone_text", startedAt);
    }
  }
  estimateVoiceCloneInterChunkPauseSeconds(textChunk) {
    return String(textChunk || "").trim().split(/\s+/).filter(Boolean).length <= 4 ? DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_SHORT_SECONDS : DEFAULT_VOICE_CLONE_INTER_CHUNK_PAUSE_LONG_SECONDS;
  }
  async decodeAudioToWaveform(arrayBuffer) {
    const totalStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const decodeContext = new AudioContext({ sampleRate: this.codecMeta.codec_config.sample_rate });
    try {
      const browserDecodeStartedAt = this.profileState?.enabled ? nowMs() : 0;
      const decodedAudio = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      finishProfileTiming(this.profileState, "audio_encode.decode_audio_data", browserDecodeStartedAt);
      const targetSampleRate = this.codecMeta.codec_config.sample_rate;
      const targetChannels = this.codecMeta.codec_config.channels;
      let renderedAudio = decodedAudio;
      if (decodedAudio.sampleRate !== targetSampleRate || decodedAudio.numberOfChannels !== targetChannels) {
        const resampleStartedAt = this.profileState?.enabled ? nowMs() : 0;
        const frameCount = Math.max(1, Math.ceil(decodedAudio.duration * targetSampleRate));
        const offlineContext = new OfflineAudioContext(targetChannels, frameCount, targetSampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = decodedAudio;
        source.connect(offlineContext.destination);
        source.start(0);
        renderedAudio = await offlineContext.startRendering();
        finishProfileTiming(this.profileState, "audio_encode.offline_resample", resampleStartedAt);
      }
      const waveformLength = renderedAudio.length;
      const waveformPackStartedAt = this.profileState?.enabled ? nowMs() : 0;
      const waveform = new Float32Array(targetChannels * waveformLength);
      for (let channelIndex = 0; channelIndex < targetChannels; channelIndex += 1) {
        const sourceChannel = renderedAudio.getChannelData(
          Math.min(channelIndex, renderedAudio.numberOfChannels - 1)
        );
        waveform.set(sourceChannel, channelIndex * waveformLength);
      }
      finishProfileTiming(this.profileState, "audio_encode.waveform_pack", waveformPackStartedAt);
      return {
        waveform,
        waveformLength
      };
    } finally {
      finishProfileTiming(this.profileState, "audio_encode.decode_audio_to_waveform", totalStartedAt);
      await decodeContext.close().catch(() => {
      });
    }
  }
  async encodeReferenceAudioFromFile(file) {
    const totalStartedAt = this.profileState?.enabled ? nowMs() : 0;
    await this.ensureManifestLoaded();
    await this.ensureCodecEncodeLoaded();
    try {
      const fileBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
      const { waveform, waveformLength } = await this.decodeAudioToWaveform(fileBuffer);
      const codecEncodeStartedAt = this.profileState?.enabled ? nowMs() : 0;
      const outputs = await this.sessions.codecEncode.run(this.buildCodecEncodeFeeds(waveform, waveformLength));
      finishProfileTiming(this.profileState, "audio_encode.codec_encode_session", codecEncodeStartedAt);
      const codeLength = outputs.audio_code_lengths.data[0];
      const numQuantizers = this.codecMeta.codec_config.num_quantizers;
      const promptAudioCodes = [];
      for (let frameIndex = 0; frameIndex < codeLength; frameIndex += 1) {
        const row = [];
        for (let quantizerIndex = 0; quantizerIndex < numQuantizers; quantizerIndex += 1) {
          row.push(outputs.audio_codes.data[frameIndex * numQuantizers + quantizerIndex]);
        }
        promptAudioCodes.push(row);
      }
      recordProfileCounter(this.profileState, "audio_encode.prompt_audio_frames", codeLength);
      return promptAudioCodes;
    } finally {
      finishProfileTiming(this.profileState, "audio_encode.total", totalStartedAt);
    }
  }
  findVoicePreset(voiceName, extraVoices = []) {
    const allVoices = [...this.listBuiltinVoices(), ...extraVoices];
    return allVoices.find((voice) => voice.voice === voiceName || voice.id === voiceName || voice.display_name === voiceName) || null;
  }
  async runLocalDecoder(globalHiddenTensor, textTokenId, framePrefix) {
    this.ensureReusableSynthesisState();
    this.reusableLocalDecoderTextTokenData[0] = textTokenId;
    this.reusableLocalDecoderPrefixData.fill(this.manifest.tts_config.audio_pad_token_id);
    for (let index = 0; index < Math.min(framePrefix.length, this.reusableLocalDecoderPrefixData.length); index += 1) {
      this.reusableLocalDecoderPrefixData[index] = framePrefix[index];
    }
    this.reusableLocalDecoderFeeds.global_hidden = globalHiddenTensor;
    const sessionStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const outputs = await this.sessions.localDecoder.run(this.reusableLocalDecoderFeeds);
    finishProfileTiming(this.profileState, "local_transformer.local_decoder_session", sessionStartedAt);
    return {
      textLogits: outputs.text_logits.data,
      audioLogits: outputs.audio_logits
    };
  }
  createEmptyLocalCachedPast() {
    this.ensureReusableSynthesisState();
    return this.emptyLocalCachedPast;
  }
  async runLocalCachedStep({
    globalHiddenTensor,
    textTokenId,
    audioTokenId,
    channelIndex,
    stepType,
    pastValidLength
  }) {
    this.ensureReusableSynthesisState();
    this.reusableLocalCachedFeeds.global_hidden = globalHiddenTensor;
    this.reusableLocalCachedTextTokenData[0] = textTokenId;
    this.reusableLocalCachedAudioTokenData[0] = audioTokenId;
    this.reusableLocalCachedChannelIndexData[0] = channelIndex;
    this.reusableLocalCachedStepTypeData[0] = stepType;
    this.reusableLocalCachedPastValidLengthData[0] = pastValidLength;
    const sessionStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const outputs = await this.sessions.localCachedStep.run(this.reusableLocalCachedFeeds);
    finishProfileTiming(this.profileState, "local_transformer.local_cached_step_session", sessionStartedAt);
    recordProfileCounter(this.profileState, "local_transformer.local_cached_step_calls", 1);
    for (let index = 0; index < this.localCachedPastInputNames.length; index += 1) {
      this.reusableLocalCachedFeeds[this.localCachedPastInputNames[index]] = outputs[this.localCachedPresentOutputNames[index]];
    }
    return {
      textLogits: outputs.text_logits.data,
      audioLogits: outputs.audio_logits
    };
  }
  async runLocalGreedyFrame({ globalHiddenTensor, previousTokenSetsByChannel, generationDefaults }) {
    this.ensureReusableSynthesisState();
    this.reusableLocalGreedySeenMaskData.fill(0);
    const audioCodebookSize = this.reusableLocalGreedyFeeds.repetition_seen_mask.dims[2];
    for (let channelIndex = 0; channelIndex < previousTokenSetsByChannel.length; channelIndex += 1) {
      const channelOffset = channelIndex * audioCodebookSize;
      for (const tokenId of previousTokenSetsByChannel[channelIndex]) {
        if (tokenId >= 0 && tokenId < audioCodebookSize) {
          this.reusableLocalGreedySeenMaskData[channelOffset + tokenId] = 1;
        }
      }
    }
    this.reusableLocalGreedyPenaltyData[0] = generationDefaults.audio_repetition_penalty;
    this.reusableLocalGreedyFeeds.global_hidden = globalHiddenTensor;
    const sessionStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const outputs = await this.sessions.localGreedyFrame.run(this.reusableLocalGreedyFeeds);
    finishProfileTiming(this.profileState, "local_transformer.local_greedy_frame_session", sessionStartedAt);
    const frame = new Array(this.manifest.tts_config.n_vq);
    for (let index = 0; index < frame.length; index += 1) {
      frame[index] = outputs.frame_token_ids.data[index];
    }
    return {
      shouldContinue: outputs.should_continue.data[0] > 0,
      frame
    };
  }
  async runLocalFixedSampledFrame({ globalHiddenTensor, previousTokenSetsByChannel }) {
    this.ensureReusableSynthesisState();
    this.reusableLocalFixedSampledSeenMaskData.fill(0);
    const audioCodebookSize = this.reusableLocalFixedSampledFeeds.repetition_seen_mask.dims[2];
    for (let channelIndex = 0; channelIndex < previousTokenSetsByChannel.length; channelIndex += 1) {
      const channelOffset = channelIndex * audioCodebookSize;
      for (const tokenId of previousTokenSetsByChannel[channelIndex]) {
        if (tokenId >= 0 && tokenId < audioCodebookSize) {
          this.reusableLocalFixedSampledSeenMaskData[channelOffset + tokenId] = 1;
        }
      }
    }
    this.reusableLocalFixedSampledAssistantRandomData[0] = drawClampedRandomU();
    for (let index = 0; index < this.reusableLocalFixedSampledAudioRandomData.length; index += 1) {
      this.reusableLocalFixedSampledAudioRandomData[index] = drawClampedRandomU();
    }
    this.reusableLocalFixedSampledFeeds.global_hidden = globalHiddenTensor;
    const sessionStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const outputs = await this.sessions.localFixedSampledFrame.run(this.reusableLocalFixedSampledFeeds);
    finishProfileTiming(this.profileState, "local_transformer.local_fixed_sampled_frame_session", sessionStartedAt);
    const frame = new Array(this.manifest.tts_config.n_vq);
    for (let index = 0; index < frame.length; index += 1) {
      frame[index] = outputs.frame_token_ids.data[index];
    }
    return {
      shouldContinue: outputs.should_continue.data[0] > 0,
      frame
    };
  }
  sliceAudioChannelLogits(audioLogitsTensor, channelIndex) {
    const dims = audioLogitsTensor.dims;
    const perChannel = dims[dims.length - 1];
    const start = channelIndex * perChannel;
    const end = start + perChannel;
    return audioLogitsTensor.data.subarray(start, end);
  }
  async decodeFullAudio(generatedFrames) {
    if (!generatedFrames.length) {
      return null;
    }
    this.ensureReusableSynthesisState();
    const { data, dims } = flatten3dInt32([generatedFrames]);
    this.reusableCodecDecodeFullLengthData[0] = generatedFrames.length;
    const sessionStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const outputs = await this.sessions.codecDecode.run({
      audio_codes: new ort.Tensor("int32", data, dims),
      audio_code_lengths: new ort.Tensor("int32", this.reusableCodecDecodeFullLengthData, [1])
    });
    finishProfileTiming(this.profileState, "audio_decode.codec_decode_full_session", sessionStartedAt);
    return outputs;
  }
  async decodeFullAudioIncremental(generatedFrames, frameBatchSize = 8) {
    if (!generatedFrames.length || !this.codecStreamingSession) {
      return null;
    }
    const sampleRate = this.codecMeta.codec_config.sample_rate;
    const channels = this.codecMeta.codec_config.channels;
    const mergedByChannel = Array.from({ length: channels }, () => []);
    this.codecStreamingSession.reset();
    try {
      for (let startIndex = 0; startIndex < generatedFrames.length; startIndex += frameBatchSize) {
        const frameChunk = generatedFrames.slice(startIndex, startIndex + frameBatchSize);
        const decoded = await this.codecStreamingSession.runFrames(frameChunk);
        if (!decoded) {
          continue;
        }
        const audioLength = decoded.audio_lengths.data[0];
        if (!(audioLength > 0)) {
          continue;
        }
        const chunkData = sliceChannelMajorAudio(decoded.audio.data, decoded.audio.dims, 0, audioLength);
        for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
          mergedByChannel[channelIndex].push(chunkData[channelIndex]);
        }
      }
    } finally {
      this.codecStreamingSession.reset();
    }
    return {
      channels,
      sampleRate,
      chunkData: mergeFloat32Chunks(mergedByChannel)
    };
  }
  async generateAudioFrames({
    requestRows,
    isCancelled = () => false,
    onFrame = null,
    doSample = null,
    sampleMode = null
  }) {
    this.ensureReusableSynthesisState();
    const totalStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const generationDefaults = resolveGenerationDefaults(this.manifest.generation_defaults, { doSample, sampleMode });
    const rowWidth = this.manifest.tts_config.n_vq + 1;
    const audioAssistantSlotTokenId = this.manifest.tts_config.audio_assistant_slot_token_id;
    const audioPadTokenId = this.manifest.tts_config.audio_pad_token_id;
    const { data: prefillIds, dims: prefillDims } = flatten3dInt32([requestRows.inputIds]);
    const { data: prefillMask, dims: prefillMaskDims } = flatten2dInt32(requestRows.attentionMask);
    const prefillStartedAt = this.profileState?.enabled ? nowMs() : 0;
    let outputs = await this.sessions.prefill.run({
      input_ids: new ort.Tensor("int32", prefillIds, prefillDims),
      attention_mask: new ort.Tensor("int32", prefillMask, prefillMaskDims)
    });
    finishProfileTiming(this.profileState, "tts.prefill_session", prefillStartedAt);
    let globalHiddenTensor = extractLastHiddenTensor(outputs.global_hidden);
    let pastValidLength = requestRows.attentionMask[0].reduce((total, value) => total + Number(value || 0), 0);
    this.updateDecodePastFeeds(outputs);
    const generatedFrames = [];
    const previousTokensByChannel = Array.from({ length: this.manifest.tts_config.n_vq }, () => []);
    const previousTokenSetsByChannel = Array.from({ length: this.manifest.tts_config.n_vq }, () => /* @__PURE__ */ new Set());
    for (let stepIndex = 0; stepIndex < this.manifest.generation_defaults.max_new_frames; stepIndex += 1) {
      await yieldToBrowserEventLoop();
      if (isCancelled()) {
        return generatedFrames;
      }
      const frame = [];
      if (this.sessions.localGreedyFrame && !generationDefaults.do_sample) {
        const greedyFrameResult = await this.runLocalGreedyFrame({
          globalHiddenTensor,
          previousTokenSetsByChannel,
          generationDefaults
        });
        if (!greedyFrameResult.shouldContinue) {
          this.log(`Generation stopped at step ${stepIndex} with token=${this.manifest.tts_config.audio_end_token_id}`);
          break;
        }
        for (let channelIndex = 0; channelIndex < greedyFrameResult.frame.length; channelIndex += 1) {
          const sampledToken = greedyFrameResult.frame[channelIndex];
          frame.push(sampledToken);
          previousTokensByChannel[channelIndex].push(sampledToken);
          previousTokenSetsByChannel[channelIndex].add(sampledToken);
        }
      } else if (this.sessions.localFixedSampledFrame && generationDefaults.sample_mode === SAMPLE_MODE_FIXED) {
        const fixedSampledFrameResult = await this.runLocalFixedSampledFrame({
          globalHiddenTensor,
          previousTokenSetsByChannel
        });
        if (!fixedSampledFrameResult.shouldContinue) {
          this.log(`Generation stopped at step ${stepIndex} with token=${this.manifest.tts_config.audio_end_token_id}`);
          break;
        }
        for (let channelIndex = 0; channelIndex < fixedSampledFrameResult.frame.length; channelIndex += 1) {
          const sampledToken = fixedSampledFrameResult.frame[channelIndex];
          frame.push(sampledToken);
          previousTokensByChannel[channelIndex].push(sampledToken);
          previousTokenSetsByChannel[channelIndex].add(sampledToken);
        }
      } else if (this.sessions.localCachedStep) {
        let nextTextToken2 = this.manifest.tts_config.audio_end_token_id;
        let localPastValidLength = 0;
        this.resetLocalCachedState();
        const localTextResult = await this.runLocalCachedStep({
          globalHiddenTensor,
          textTokenId: 0,
          audioTokenId: 0,
          channelIndex: 0,
          stepType: 0,
          pastValidLength: localPastValidLength
        });
        localPastValidLength += 1;
        nextTextToken2 = sampleAssistantTextToken(localTextResult.textLogits, this.manifest, generationDefaults, this.profileState);
        if (nextTextToken2 !== audioAssistantSlotTokenId) {
          this.log(`Generation stopped at step ${stepIndex} with token=${nextTextToken2}`);
          break;
        }
        let cachedStepResult = await this.runLocalCachedStep({
          globalHiddenTensor,
          textTokenId: nextTextToken2,
          audioTokenId: 0,
          channelIndex: 0,
          stepType: 1,
          pastValidLength: localPastValidLength
        });
        localPastValidLength += 1;
        let audioLogits = this.sliceAudioChannelLogits(cachedStepResult.audioLogits, 0);
        let sampledToken = sampleAudioToken(
          audioLogits,
          previousTokensByChannel[0],
          previousTokenSetsByChannel[0],
          generationDefaults,
          this.profileState
        );
        frame.push(sampledToken);
        previousTokensByChannel[0].push(sampledToken);
        previousTokenSetsByChannel[0].add(sampledToken);
        let previousToken = sampledToken;
        const hostSampledChannelLimit = this.manifest.tts_config.n_vq;
        for (let channelIndex = 1; channelIndex < hostSampledChannelLimit; channelIndex += 1) {
          if (channelIndex % CONTROL_EVENT_LOOP_YIELD_CHANNEL_INTERVAL === 0) {
            await yieldToBrowserEventLoop();
            if (isCancelled()) {
              return generatedFrames;
            }
          }
          cachedStepResult = await this.runLocalCachedStep({
            globalHiddenTensor,
            textTokenId: 0,
            audioTokenId: previousToken,
            channelIndex: channelIndex - 1,
            stepType: 2,
            pastValidLength: localPastValidLength
          });
          localPastValidLength += 1;
          audioLogits = this.sliceAudioChannelLogits(cachedStepResult.audioLogits, channelIndex);
          sampledToken = sampleAudioToken(
            audioLogits,
            previousTokensByChannel[channelIndex],
            previousTokenSetsByChannel[channelIndex],
            generationDefaults,
            this.profileState
          );
          frame.push(sampledToken);
          previousTokensByChannel[channelIndex].push(sampledToken);
          previousTokenSetsByChannel[channelIndex].add(sampledToken);
          previousToken = sampledToken;
        }
      } else {
        for (let channelIndex = 0; channelIndex < this.manifest.tts_config.n_vq; channelIndex += 1) {
          if (channelIndex > 0 && channelIndex % CONTROL_EVENT_LOOP_YIELD_CHANNEL_INTERVAL === 0) {
            await yieldToBrowserEventLoop();
            if (isCancelled()) {
              return generatedFrames;
            }
          }
          const localDecoderResult = await this.runLocalDecoder(globalHiddenTensor, nextTextToken, frame);
          const audioLogits = this.sliceAudioChannelLogits(localDecoderResult.audioLogits, channelIndex);
          const sampledToken = sampleAudioToken(
            audioLogits,
            previousTokensByChannel[channelIndex],
            previousTokenSetsByChannel[channelIndex],
            generationDefaults,
            this.profileState
          );
          frame.push(sampledToken);
          previousTokensByChannel[channelIndex].push(sampledToken);
          previousTokenSetsByChannel[channelIndex].add(sampledToken);
        }
      }
      generatedFrames.push(frame);
      recordProfileCounter(this.profileState, "generation.generated_frames", 1);
      this.reusableDecodeRowData.fill(audioPadTokenId);
      this.reusableDecodeRowData[0] = audioAssistantSlotTokenId;
      for (let index = 0; index < frame.length; index += 1) {
        this.reusableDecodeRowData[index + 1] = frame[index];
      }
      this.reusableDecodePastLengthData[0] = pastValidLength;
      const decodeStartedAt = this.profileState?.enabled ? nowMs() : 0;
      outputs = await this.sessions.decode.run(this.reusableDecodeFeeds);
      finishProfileTiming(this.profileState, "tts.decode_session", decodeStartedAt);
      globalHiddenTensor = extractLastHiddenTensor(outputs.global_hidden);
      pastValidLength += 1;
      this.updateDecodePastFeeds(outputs);
      if (onFrame) {
        await onFrame(generatedFrames, stepIndex, frame);
      }
      await yieldToBrowserEventLoop();
    }
    finishProfileTiming(this.profileState, "tts.generate_audio_frames_total", totalStartedAt);
    return generatedFrames;
  }
  async synthesizeSingleChunk({
    text,
    textTokenIds = null,
    promptAudioCodes,
    streaming,
    onAudioChunk = null,
    isCancelled = () => false,
    doSample = null,
    sampleMode = null
  }) {
    const totalStartedAt = this.profileState?.enabled ? nowMs() : 0;
    if (!Array.isArray(textTokenIds)) {
      await this.ensureTokenizerLoaded();
    }
    await this.ensureSynthesisLoaded();
    const resolvedTextTokenIds = Array.isArray(textTokenIds) ? textTokenIds : await this.encodeText(text);
    const requestRows = buildVoiceCloneRequestRows({
      manifest: this.manifest,
      promptAudioCodes,
      textTokenIds: resolvedTextTokenIds
    });
    if (!streaming || !this.codecStreamingSession) {
      const generatedFrames2 = await this.generateAudioFrames({ requestRows, isCancelled, doSample, sampleMode });
      let chunk = null;
      try {
        const decoded = await this.decodeFullAudio(generatedFrames2);
        if (decoded) {
          const audioLength = decoded.audio_lengths.data[0];
          chunk = {
            channels: decoded.audio.dims[1],
            sampleRate: this.codecMeta.codec_config.sample_rate,
            chunkData: sliceChannelMajorAudio(decoded.audio.data, decoded.audio.dims, 0, audioLength)
          };
        }
      } catch (error) {
        const message = error?.message || String(error);
        if (!this.codecStreamingSession || !/bad_alloc|std::bad_alloc|alloc/i.test(message)) {
          throw error;
        }
        this.log(`Full codec decode failed, falling back to incremental decode: ${message}`);
        chunk = await this.decodeFullAudioIncremental(generatedFrames2);
      }
      if (!chunk) {
        return { frames: 0, chunks: [] };
      }
      if (onAudioChunk) {
        await onAudioChunk(chunk);
      }
      return {
        frames: generatedFrames2.length,
        chunks: [chunk]
      };
    }
    this.codecStreamingSession.reset();
    const pendingDecodeFrames = [];
    let emittedSamplesTotal = 0;
    let firstAudioEmittedAtSeconds = null;
    const chunks = [];
    const decodePendingFrames = async (force, stepIndexLabel) => {
      const pendingCount = pendingDecodeFrames.length;
      if (pendingCount <= 0) {
        return;
      }
      const sampleRate = this.codecMeta.codec_config.sample_rate;
      const leadSeconds = computeStreamLeadSeconds(emittedSamplesTotal, sampleRate, firstAudioEmittedAtSeconds);
      const decodeBudget = resolveStreamDecodeFrameBudget({
        emittedSamplesTotal,
        sampleRate,
        firstAudioEmittedAtSeconds
      });
      if (!force) {
        let shouldDecode = false;
        if (!firstAudioEmittedAtSeconds && pendingCount > 0) {
          shouldDecode = true;
        } else if (pendingCount > 0 && leadSeconds < 0.45) {
          shouldDecode = true;
        } else if (pendingCount >= decodeBudget) {
          shouldDecode = true;
        } else if (leadSeconds < 0 && pendingCount > 0) {
          shouldDecode = true;
        }
        if (!shouldDecode) {
          return;
        }
      }
      const frameBudget = force ? pendingCount : Math.min(pendingCount, Math.max(1, decodeBudget));
      const frameChunk = pendingDecodeFrames.splice(0, frameBudget);
      const decoded = await this.codecStreamingSession.runFrames(frameChunk);
      if (!decoded) {
        return;
      }
      const audioLength = decoded.audio_lengths.data[0];
      if (!(audioLength > 0)) {
        return;
      }
      const chunk = {
        channels: decoded.audio.dims[1],
        sampleRate,
        chunkData: sliceChannelMajorAudio(decoded.audio.data, decoded.audio.dims, 0, audioLength)
      };
      if (!firstAudioEmittedAtSeconds) {
        firstAudioEmittedAtSeconds = performance.now() / 1e3;
      }
      emittedSamplesTotal += audioLength;
      chunks.push(chunk);
      if (onAudioChunk) {
        await onAudioChunk(chunk);
      }
      await yieldToBrowserEventLoop();
      this.log(`Streaming chunk queued step=${stepIndexLabel} frames=${frameChunk.length} emitted_samples=${emittedSamplesTotal}`);
    };
    const generatedFrames = await this.generateAudioFrames({
      requestRows,
      isCancelled,
      doSample,
      sampleMode,
      onFrame: async (_generatedFrames, stepIndex, frame) => {
        pendingDecodeFrames.push(frame);
        await decodePendingFrames(false, stepIndex);
      }
    });
    await decodePendingFrames(true, "flush");
    const result = {
      frames: generatedFrames.length,
      chunks
    };
    finishProfileTiming(this.profileState, "pipeline.synthesize_single_chunk", totalStartedAt);
    return result;
  }
  async synthesizeVoiceClone({
    text,
    voiceName = null,
    promptAudioCodes = null,
    preencodedTextTokenIds = null,
    extraVoices = [],
    doSample = null,
    sampleMode = null,
    streaming = true,
    onAudioChunk = null,
    onPreparedText = null,
    isCancelled = () => false,
    voiceCloneMaxTextTokens = 75,
    enableNormalizeTtsText = true,
    enableWeTextProcessing = true
  }) {
    const totalStartedAt = this.profileState?.enabled ? nowMs() : 0;
    const resolvedPromptAudioCodes = promptAudioCodes || this.findVoicePreset(voiceName, extraVoices)?.prompt_audio_codes;
    if (!resolvedPromptAudioCodes?.length) {
      throw new Error(`Voice preset not found or empty: ${voiceName}`);
    }
    const rawText = String(text || "");
    const preparedText = this.prepareSynthesisText(rawText, {
      enableNormalizeTtsText,
      enableWeTextProcessing
    });
    if (onPreparedText) {
      await onPreparedText(preparedText);
    }
    const canUsePreencodedTextTokenIds = Array.isArray(preencodedTextTokenIds) && preencodedTextTokenIds.length > 0 && preparedText.text === rawText;
    if (Array.isArray(preencodedTextTokenIds) && preencodedTextTokenIds.length > 0 && !canUsePreencodedTextTokenIds) {
      this.log("Skipping preencoded text token ids because browser-side normalization changed the text.");
    }
    if (canUsePreencodedTextTokenIds) {
      const chunkResult = await this.synthesizeSingleChunk({
        text: preparedText.text,
        textTokenIds: preencodedTextTokenIds,
        promptAudioCodes: resolvedPromptAudioCodes,
        doSample,
        sampleMode,
        streaming,
        onAudioChunk,
        isCancelled
      });
      const result2 = {
        textChunks: [preparedText.text],
        outputs: [chunkResult]
      };
      finishProfileTiming(this.profileState, "pipeline.synthesize_voice_clone", totalStartedAt);
      return result2;
    }
    await this.ensureTokenizerLoaded();
    const textChunks = await this.splitVoiceCloneText(preparedText.text, voiceCloneMaxTextTokens);
    const outputs = [];
    for (let index = 0; index < textChunks.length; index += 1) {
      await yieldToBrowserEventLoop();
      if (isCancelled()) {
        break;
      }
      const chunkText = textChunks[index];
      const chunkResult = await this.synthesizeSingleChunk({
        text: chunkText,
        promptAudioCodes: resolvedPromptAudioCodes,
        doSample,
        sampleMode,
        streaming,
        onAudioChunk,
        isCancelled
      });
      outputs.push(chunkResult);
      if (index < textChunks.length - 1) {
        const pauseSeconds = this.estimateVoiceCloneInterChunkPauseSeconds(chunkText);
        const pauseSamples = Math.max(0, Math.round(this.codecMeta.codec_config.sample_rate * pauseSeconds));
        if (pauseSamples > 0) {
          const pauseChunk = {
            channels: this.codecMeta.codec_config.channels,
            sampleRate: this.codecMeta.codec_config.sample_rate,
            chunkData: Array.from(
              { length: this.codecMeta.codec_config.channels },
              () => new Float32Array(pauseSamples)
            ),
            isPause: true
          };
          if (onAudioChunk) {
            await onAudioChunk(pauseChunk);
          }
          await yieldToBrowserEventLoop();
          outputs.push({ frames: 0, chunks: [pauseChunk] });
        }
      }
    }
    const result = {
      textChunks,
      outputs
    };
    finishProfileTiming(this.profileState, "pipeline.synthesize_voice_clone", totalStartedAt);
    return result;
  }
};
function createBrowserOnnxTtsRuntime(options = {}) {
  return new BrowserOnnxTtsRuntime(options);
}
export {
  BrowserOnnxTtsRuntime,
  createBrowserOnnxTtsRuntime
};
