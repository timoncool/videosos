import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getOpfsFileBlob, getOpfsFileHandle } from './opfs-file-access'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('opfs-file-access', () => {
  it('resolves nested OPFS paths through navigator.storage', async () => {
    const fileHandle = {
      getFile: vi.fn().mockResolvedValue(new Blob(['file-data'])),
    } as unknown as FileSystemFileHandle
    const getDirectoryHandle = vi.fn()
    const contentDirectory = {
      getDirectoryHandle,
      getFileHandle: vi.fn(),
    }
    const hashDirectory = {
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
    }

    getDirectoryHandle.mockResolvedValueOnce(contentDirectory).mockResolvedValueOnce(hashDirectory)

    const root = {
      getDirectoryHandle,
      getFileHandle: vi.fn(),
    }
    const getDirectory = vi.fn().mockResolvedValue(root)

    vi.stubGlobal('navigator', {
      storage: {
        getDirectory,
      },
    })

    await expect(getOpfsFileHandle('content/aa/proxy.mp4')).resolves.toBe(fileHandle)

    expect(getDirectory).toHaveBeenCalledTimes(1)
    expect(getDirectoryHandle).toHaveBeenNthCalledWith(1, 'content')
    expect(getDirectoryHandle).toHaveBeenNthCalledWith(2, 'aa')
    expect(hashDirectory.getFileHandle).toHaveBeenCalledWith('proxy.mp4')
  })

  it('returns OPFS file blobs from resolved handles', async () => {
    const file = new Blob(['blob-data'])
    const fileHandle = {
      getFile: vi.fn().mockResolvedValue(file),
    }
    const root = {
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
    }

    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    await expect(getOpfsFileBlob('clip.mp4')).resolves.toBe(file)
    expect(fileHandle.getFile).toHaveBeenCalledTimes(1)
  })

  it('rejects empty OPFS paths', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue({}),
      },
    })

    await expect(getOpfsFileHandle('///')).rejects.toThrow('Invalid OPFS path')
  })
})
