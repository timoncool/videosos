import { createBrowserOnnxTtsRuntime } from './browser_onnx_runtime.js';

const HOST_SOURCE = 'freecut-moss-tts-host';
const CLIENT_SOURCE = 'freecut-moss-tts-client';
const MODEL_STORE_KEY = 'freecut-moss-tts';

let runtime = null;
let operationChain = Promise.resolve();

function postToParent(payload, transfer = undefined) {
  parent.postMessage(
    {
      source: HOST_SOURCE,
      ...payload,
    },
    '*',
    transfer || [],
  );
}

function getModelStore() {
  const store = globalThis.NanoReaderBrowserModelStore;
  if (!store) {
    throw new Error('MOSS browser model store is not available.');
  }
  return store;
}

function queueOperation(task) {
  const next = operationChain.then(task, task);
  operationChain = next.catch(() => {});
  return next;
}

async function ensureRuntime({ requestId, threadCount = 4, warmup = false }) {
  const store = getModelStore();
  const ensured = await store.ensureExternalBrowserOnnxModels({
    key: MODEL_STORE_KEY,
    onProgress: (info) => {
      postToParent({
        type: 'progress',
        requestId,
        stage: info?.message || 'Preparing MOSS Nano...',
      });
    },
  });

  if (!runtime) {
    runtime = createBrowserOnnxTtsRuntime();
  }

  await runtime.configure({
    modelPath: ensured.managedPath,
    threadCount,
  });

  if (warmup) {
    postToParent({
      type: 'progress',
      requestId,
      stage: 'Warming up MOSS Nano...',
    });
    await runtime.warmup();
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
  await ensureRuntime({
    requestId,
    threadCount: payload?.threadCount,
    warmup: true,
  });

  postToParent({
    type: 'response',
    requestId,
    ok: true,
    data: { status: 'ready' },
  });
}

async function handleSynthesize(requestId, payload) {
  const preparedRuntime = await ensureRuntime({
    requestId,
    threadCount: payload?.threadCount,
    warmup: true,
  });

  const audioChunks = [];
  const result = await preparedRuntime.synthesizeVoiceClone({
    text: payload?.text || '',
    voiceName: payload?.voiceName || '',
    streaming: false,
    sampleMode: 'fixed',
    enableNormalizeTtsText: true,
    enableWeTextProcessing: true,
    voiceCloneMaxTextTokens: 75,
    onPreparedText: async () => {
      postToParent({
        type: 'progress',
        requestId,
        stage: 'Preparing Chinese text...',
      });
    },
    onAudioChunk: async (chunk) => {
      audioChunks.push(chunk);
      postToParent({
        type: 'progress',
        requestId,
        stage: `Decoded audio chunk ${audioChunks.length}...`,
      });
    },
  });

  const serializedChunks = audioChunks.map(serializeChunk);
  const transfer = serializedChunks.flatMap((chunk) => chunk.buffers);

  postToParent({
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

window.addEventListener('message', (event) => {
  const payload = event.data;
  if (event.source !== parent || !payload || payload.source !== CLIENT_SOURCE) {
    return;
  }

  const requestId = payload.requestId;
  if (!requestId) {
    return;
  }

  void queueOperation(async () => {
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
        runtime = null;
        postToParent({
          type: 'response',
          requestId,
          ok: true,
          data: { status: 'disposed' },
        });
        return;
      }

      postToParent({
        type: 'response',
        requestId,
        ok: false,
        error: `Unsupported host action: ${payload.action}`,
      });
    } catch (error) {
      postToParent({
        type: 'response',
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

postToParent({ type: 'ready' });
