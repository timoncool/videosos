interface OpfsFileAccessErrorMessages {
  invalidPath: string
  missingFileName: string
}

const DEFAULT_ERROR_MESSAGES: OpfsFileAccessErrorMessages = {
  invalidPath: 'Invalid OPFS path',
  missingFileName: 'Invalid OPFS path: missing filename',
}

/**
 * Narrow browser OPFS file access helpers.
 *
 * This facade intentionally only covers direct FileSystemHandle access used by
 * browser infrastructure consumers. Media-library keeps ownership of the OPFS
 * worker singleton, message protocol, directory layout, and upload/read APIs.
 */
export async function getOpfsFileHandle(
  path: string,
  errorMessages: OpfsFileAccessErrorMessages = DEFAULT_ERROR_MESSAGES,
): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory()
  const parts = path.split('/').filter((part) => part)

  if (parts.length === 0) {
    throw new Error(errorMessages.invalidPath)
  }

  let dir = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (!part) {
      continue
    }
    dir = await dir.getDirectoryHandle(part)
  }

  const fileName = parts[parts.length - 1]
  if (!fileName) {
    throw new Error(errorMessages.missingFileName)
  }

  return dir.getFileHandle(fileName)
}

export async function getOpfsFileBlob(
  path: string,
  errorMessages?: OpfsFileAccessErrorMessages,
): Promise<Blob> {
  const fileHandle = await getOpfsFileHandle(path, errorMessages)
  return fileHandle.getFile()
}
