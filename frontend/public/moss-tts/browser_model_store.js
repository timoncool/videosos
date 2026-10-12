(function initNanoReaderBrowserModelStore(globalScope) {
  const MANAGED_SCHEME = 'managed://';
  const DEFAULT_EXTERNAL_MODEL_KEY = 'browser-onnx-external';
  const INTERNAL_ROOT_DIR_NAME = 'nano-reader-browser-model-store';
  const HF_API_BASE = 'https://huggingface.co/api/models/';
  const HF_RESOLVE_BASE = 'https://huggingface.co/';
  const MODEL_REPOS = [
    {
      repoId: 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX',
      localDirName: 'MOSS-TTS-Nano-100M-ONNX',
      requiredFiles: [
        'browser_poc_manifest.json',
        'tts_browser_onnx_meta.json',
        'tokenizer.model',
        'moss_tts_prefill.onnx',
        'moss_tts_decode_step.onnx',
        'moss_tts_local_decoder.onnx',
        'moss_tts_local_cached_step.onnx',
        'moss_tts_local_fixed_sampled_frame.onnx',
        'moss_tts_global_shared.data',
        'moss_tts_local_shared.data'
      ]
    },
    {
      repoId: 'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX',
      localDirName: 'MOSS-Audio-Tokenizer-Nano-ONNX',
      requiredFiles: [
        'codec_browser_onnx_meta.json',
        'moss_audio_tokenizer_encode.onnx',
        'moss_audio_tokenizer_encode.data',
        'moss_audio_tokenizer_decode_full.onnx',
        'moss_audio_tokenizer_decode_step.onnx',
        'moss_audio_tokenizer_decode_shared.data'
      ]
    }
  ];

  function normalizeRelativePath(relativePath) {
    const parts = String(relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .split('/')
      .filter(Boolean);

    const resolvedParts = [];
    for (const part of parts) {
      if (part === '.') {
        continue;
      }
      if (part === '..') {
        if (resolvedParts.length > 0) {
          resolvedParts.pop();
        }
        continue;
      }
      resolvedParts.push(part);
    }
    return resolvedParts.join('/');
  }

  function normalizeManagedKey(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    const normalized = String(key || DEFAULT_EXTERNAL_MODEL_KEY).trim();
    return normalized || DEFAULT_EXTERNAL_MODEL_KEY;
  }

  function getManagedDirectoryName(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    return normalizeManagedKey(key)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_');
  }

  function getManagedStorageLabel(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    return `browser-managed:${normalizeManagedKey(key)}`;
  }

  function isManagedModelPath(pathValue) {
    return String(pathValue || '').trim().toLowerCase().startsWith(MANAGED_SCHEME);
  }

  function createManagedModelPath(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    return `${MANAGED_SCHEME}${encodeURIComponent(normalizeManagedKey(key))}`;
  }

  function parseManagedModelKey(pathValue) {
    if (!isManagedModelPath(pathValue)) {
      return null;
    }
    return decodeURIComponent(String(pathValue).trim().slice(MANAGED_SCHEME.length));
  }

  async function getStorageRootDirectory() {
    const storage = globalScope.navigator?.storage;
    if (!storage || typeof storage.getDirectory !== 'function') {
      throw new Error('Browser-managed storage is not available in this browser context.');
    }

    try {
      if (typeof storage.persist === 'function') {
        await storage.persist();
      }
    } catch (error) {
      // Persist is best-effort only.
    }

    const originRoot = await storage.getDirectory();
    return originRoot.getDirectoryHandle(INTERNAL_ROOT_DIR_NAME, { create: true });
  }

  async function getDirectoryByRelativePath(rootHandle, relativePath, create = false) {
    const segments = normalizeRelativePath(relativePath).split('/').filter(Boolean);
    let current = rootHandle;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  async function getOptionalDirectoryHandleByRelativePath(rootHandle, relativePath) {
    try {
      return await getDirectoryByRelativePath(rootHandle, relativePath, false);
    } catch (error) {
      if (error && error.name === 'NotFoundError') {
        return null;
      }
      throw error;
    }
  }

  async function getManagedModelRootDirectory(key = DEFAULT_EXTERNAL_MODEL_KEY, create = false) {
    const rootHandle = await getStorageRootDirectory();
    const directoryName = getManagedDirectoryName(key);
    return create
      ? rootHandle.getDirectoryHandle(directoryName, { create: true })
      : getOptionalDirectoryHandleByRelativePath(rootHandle, directoryName);
  }

  async function getDirectoryRecord(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    const normalizedKey = normalizeManagedKey(key);
    const handle = await getManagedModelRootDirectory(normalizedKey, false);
    if (!handle) {
      return null;
    }
    return {
      key: normalizedKey,
      label: getManagedStorageLabel(normalizedKey),
      updatedAt: null,
      handle
    };
  }

  async function getStoredDirectoryHandle(key = DEFAULT_EXTERNAL_MODEL_KEY) {
    return getManagedModelRootDirectory(normalizeManagedKey(key), false);
  }

  async function getDirectoryHandleByManagedPath(pathValue, create = false) {
    const key = parseManagedModelKey(pathValue);
    if (!key) {
      throw new Error(`Unsupported managed model path: ${pathValue}`);
    }
    const handle = await getManagedModelRootDirectory(key, create);
    if (!handle) {
      throw new Error('Browser-managed ONNX model storage is not initialized yet.');
    }
    return handle;
  }

  async function getFileHandleByRelativePath(rootHandle, relativePath, create = false) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      throw new Error('Relative file path is empty.');
    }
    const segments = normalized.split('/').filter(Boolean);
    const fileName = segments.pop();
    const directoryHandle = segments.length > 0
      ? await getDirectoryByRelativePath(rootHandle, segments.join('/'), create)
      : rootHandle;
    return directoryHandle.getFileHandle(fileName, { create });
  }

  async function fileExists(rootHandle, relativePath) {
    try {
      await getFileHandleByRelativePath(rootHandle, relativePath, false);
      return true;
    } catch (error) {
      if (error && error.name === 'NotFoundError') {
        return false;
      }
      throw error;
    }
  }

  async function writeResponseToFile(rootHandle, relativePath, response) {
    const fileHandle = await getFileHandleByRelativePath(rootHandle, relativePath, true);
    const writable = await fileHandle.createWritable();
    try {
      await writable.truncate(0);
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            await writable.write(value);
          }
        }
      } else {
        await writable.write(await response.arrayBuffer());
      }
    } catch (error) {
      try {
        await writable.abort();
      } catch (abortError) {
        // Ignore abort cleanup failures.
      }
      throw error;
    }
    await writable.close();
  }

  async function readTextFromManagedPath(rootPath, relativePath) {
    const handle = await getDirectoryHandleByManagedPath(rootPath, false);
    const fileHandle = await getFileHandleByRelativePath(handle, relativePath, false);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function readBufferFromManagedPath(rootPath, relativePath) {
    const handle = await getDirectoryHandleByManagedPath(rootPath, false);
    const fileHandle = await getFileHandleByRelativePath(handle, relativePath, false);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function fetchWithOptionalToken(url, accessToken = '') {
    const headers = {};
    const normalizedToken = String(accessToken || '').trim();
    if (normalizedToken) {
      headers.Authorization = `Bearer ${normalizedToken}`;
    }
    return fetch(url, {
      cache: 'no-store',
      headers
    });
  }

  async function fetchRepoTree(repoId, accessToken = '') {
    const url = `${HF_API_BASE}${repoId}/tree/main?recursive=1`;
    const response = await fetchWithOptionalToken(url, accessToken);
    if (!response.ok) {
      throw new Error(`Failed to fetch Hugging Face repo tree for ${repoId} (status=${response.status}).`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected Hugging Face repo tree response for ${repoId}.`);
    }
    return data;
  }

  function buildRemotePathMap(treeRows, requiredFiles, repoId) {
    const fileMap = new Map();
    for (const row of treeRows) {
      const pathValue = String(row?.path || '');
      if (!pathValue || String(row?.type || '').toLowerCase() === 'directory') {
        continue;
      }
      const fileName = pathValue.split('/').pop();
      if (!requiredFiles.includes(fileName)) {
        continue;
      }
      const current = fileMap.get(fileName);
      if (!current || pathValue.length < current.length) {
        fileMap.set(fileName, pathValue);
      }
    }
    for (const fileName of requiredFiles) {
      if (!fileMap.has(fileName)) {
        throw new Error(`Required file ${fileName} was not found in Hugging Face repo ${repoId}.`);
      }
    }
    return fileMap;
  }

  function buildResolveUrl(repoId, remotePath) {
    const encodedPath = normalizeRelativePath(remotePath).split('/').map(encodeURIComponent).join('/');
    return `${HF_RESOLVE_BASE}${repoId}/resolve/main/${encodedPath}?download=1`;
  }

  async function downloadRepoFiles(destinationHandle, repoSpec, onProgress = null, accessToken = '') {
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'tree',
        repoId: repoSpec.repoId,
        message: `Scanning ${repoSpec.repoId}...`
      });
    }
    const treeRows = await fetchRepoTree(repoSpec.repoId, accessToken);
    const remotePathMap = buildRemotePathMap(treeRows, repoSpec.requiredFiles, repoSpec.repoId);
    const totalFiles = repoSpec.requiredFiles.length;
    for (let index = 0; index < repoSpec.requiredFiles.length; index += 1) {
      const fileName = repoSpec.requiredFiles[index];
      const remotePath = remotePathMap.get(fileName);
      const destinationPath = `${repoSpec.localDirName}/${fileName}`;
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'download',
          repoId: repoSpec.repoId,
          fileName,
          fileIndex: index + 1,
          fileCount: totalFiles,
          destinationPath,
          message: `Downloading ${fileName} (${index + 1}/${totalFiles})...`
        });
      }
      const response = await fetchWithOptionalToken(buildResolveUrl(repoSpec.repoId, remotePath), accessToken);
      if (!response.ok) {
        throw new Error(
          `Failed to download ${fileName} from ${repoSpec.repoId} (status=${response.status}).`
        );
      }
      await writeResponseToFile(destinationHandle, destinationPath, response);
    }
  }

  async function hasCompleteExternalModelSet(rootHandle) {
    for (const repoSpec of MODEL_REPOS) {
      for (const fileName of repoSpec.requiredFiles) {
        const exists = await fileExists(rootHandle, `${repoSpec.localDirName}/${fileName}`);
        if (!exists) {
          return false;
        }
      }
    }
    return true;
  }

  async function ensureExternalBrowserOnnxModels({
    key = DEFAULT_EXTERNAL_MODEL_KEY,
    onProgress = null,
    forceDownload = false,
    accessToken = ''
  } = {}) {
    const normalizedKey = normalizeManagedKey(key);
    const rootHandle = await getManagedModelRootDirectory(normalizedKey, true);
    const alreadyComplete = !forceDownload && await hasCompleteExternalModelSet(rootHandle);

    if (!alreadyComplete) {
      for (const repoSpec of MODEL_REPOS) {
        await downloadRepoFiles(rootHandle, repoSpec, onProgress, accessToken);
      }
    } else if (typeof onProgress === 'function') {
      onProgress({
        phase: 'reuse',
        message: `Using existing browser-managed ONNX models for ${normalizedKey}.`
      });
    }

    return {
      key: normalizedKey,
      label: getManagedStorageLabel(normalizedKey),
      managedPath: createManagedModelPath(normalizedKey),
      downloaded: !alreadyComplete
    };
  }

  globalScope.NanoReaderBrowserModelStore = {
    MANAGED_SCHEME,
    DEFAULT_EXTERNAL_MODEL_KEY,
    MODEL_REPOS,
    isManagedModelPath,
    createManagedModelPath,
    parseManagedModelKey,
    getDirectoryRecord,
    getStoredDirectoryHandle,
    readTextFromManagedPath,
    readBufferFromManagedPath,
    ensureExternalBrowserOnnxModels
  };
})(globalThis);
