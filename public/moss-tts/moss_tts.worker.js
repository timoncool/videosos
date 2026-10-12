/* global importScripts */

const HOST_SOURCE = 'freecut-moss-tts-worker';
const CLIENT_SOURCE = 'freecut-moss-tts-client';
const TOKENIZER_SOURCE = 'nano-reader-tokenizer-sandbox';
const MODEL_STORE_KEY = 'freecut-moss-tts';

let runtimePromise = null;
let tokenizerWorker = null;
let tokenizerRequestCounter = 0;
const pendingTokenizerRequests = new Map();

function postToMain(payload, transfer = undefined) {
  self.postMessage(
    {
      source: HOST_SOURCE,
      ...payload,
    },
    transfer || [],
  );
}

function ensureModelStoreLoaded() {
  if (!self.NanoReaderBrowserModelStore) {
    importScripts('./browser_model_store.js');
  }
  return self.NanoReaderBrowserModelStore;
}

function ensureTokenizerWorker() {
  if (tokenizerWorker) {
    return tokenizerWorker;
  }

  tokenizerWorker = new Worker(
    new URL('./tokenizer_sandbox.js', self.location.href),
    { type: 'module' },
  );
  tokenizerWorker.addEventListener('message', (event) => {
    const payload = event.data;
    if (!payload || payload.source !== TOKENIZER_SOURCE || payload.type !== 'response') {
      return;
    }

    const pending = pendingTokenizerRequests.get(payload.requestId);
    if (!pending) {
      return;
    }

    pendingTokenizerRequests.delete(payload.requestId);
    if (payload.ok) {
      pending.resolve(payload.data);
    } else {
      pending.reject(new Error(payload.error || 'Tokenizer request failed.'));
    }
  });

  return tokenizerWorker;
}

async function postTokenizerRequest(action, data = {}) {
  const worker = ensureTokenizerWorker();
  const requestId = `tokenizer-${Date.now()}-${tokenizerRequestCounter += 1}`;

  return new Promise((resolve, reject) => {
    pendingTokenizerRequests.set(requestId, { resolve, reject });
    worker.postMessage({
      source: TOKENIZER_SOURCE,
      type: 'request',
      requestId,
      action,
      ...data,
    });
  });
}

self.__freecutMossTokenizerBridge = postTokenizerRequest;

async function getRuntimeFactory() {
  const module = await import('./browser_onnx_runtime.js');
  return module.createBrowserOnnxTtsRuntime;
}

async function getRuntime({ requestId, threadCount = 4, warmup = false }) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const createBrowserOnnxTtsRuntime = await getRuntimeFactory();
      const store = ensureModelStoreLoaded();
      const ensured = await store.ensureExternalBrowserOnnxModels({
        key: MODEL_STORE_KEY,
        onProgress: (info) => {
          postToMain({
            type: 'progress',
            requestId,
            stage: info?.message || 'Preparing MOSS Nano...',
          });
        },
      });

      const runtime = createBrowserOnnxTtsRuntime();
      await runtime.configure({
        modelPath: ensured.managedPath,
        threadCount,
      });
      return runtime;
    })();
  }

  const runtime = await runtimePromise;

  if (warmup && !runtime.__freecutWarmedUp) {
    postToMain({
      type: 'progress',
      requestId,
      stage: 'Warming up MOSS Nano worker...',
    });
    await runtime.warmup();
    runtime.__freecutWarmedUp = true;
  }

  return runtime;
}

function serializeChunk(chunk) {
  const buffers = Array.isArray(chunk?.chunkData)
    ? chunk.chunkData.map((channelData) => channelData.buffer)
    : [];

  return {
    sampleRate: Number(chunk?.sampleRate) || 0,
    channels: Number(chunk?.channels) || buffers.length,
    isPause: Boolean(chunk?.isPause),
    buffers,
  };
}

async function handleWarmup(requestId, payload) {
  await getRuntime({
    requestId,
    threadCount: payload?.threadCount,
    warmup: true,
  });

  postToMain({
    type: 'response',
    requestId,
    ok: true,
    data: { status: 'ready' },
  });
}

async function handleSynthesize(requestId, payload) {
  const runtime = await getRuntime({
    requestId,
    threadCount: payload?.threadCount,
    warmup: true,
  });

  const audioChunks = [];
  const result = await runtime.synthesizeVoiceClone({
    text: payload?.text || '',
    voiceName: payload?.voiceName || '',
    streaming: false,
    sampleMode: 'fixed',
    enableNormalizeTtsText: true,
    enableWeTextProcessing: true,
    voiceCloneMaxTextTokens: 75,
    onPreparedText: async () => {
      postToMain({
        type: 'progress',
        requestId,
        stage: 'Preparing multilingual text...',
      });
    },
    onAudioChunk: async (chunk) => {
      audioChunks.push(chunk);
      postToMain({
        type: 'progress',
        requestId,
        stage: `Decoded audio chunk ${audioChunks.length}...`,
      });
    },
  });

  const serializedChunks = audioChunks.map(serializeChunk);
  const transfer = serializedChunks.flatMap((chunk) => chunk.buffers);

  postToMain({
    type: 'response',
    requestId,
    ok: true,
    data: {
      status: 'completed',
      textChunkCount: Array.isArray(result?.textChunks) ? result.textChunks.length : 0,
      audioChunks: serializedChunks,
    },
  }, transfer);
}

self.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload || payload.source !== CLIENT_SOURCE) {
    return;
  }

  const requestId = payload.requestId;
  if (!requestId) {
    return;
  }

  void (async () => {
    try {
      if (payload.action === 'warmup') {
        await handleWarmup(requestId, payload);
        return;
      }

      if (payload.action === 'synthesize') {
        await handleSynthesize(requestId, payload);
        return;
      }

      if (payload.action === 'dispose') {
        tokenizerWorker?.terminate();
        tokenizerWorker = null;
        runtimePromise = null;
        postToMain({
          type: 'response',
          requestId,
          ok: true,
          data: { status: 'disposed' },
        });
        return;
      }

      postToMain({
        type: 'response',
        requestId,
        ok: false,
        error: `Unsupported worker action: ${payload.action}`,
      });
    } catch (error) {
      postToMain({
        type: 'response',
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

postToMain({ type: 'ready' });
