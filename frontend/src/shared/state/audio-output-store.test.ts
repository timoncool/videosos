import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { listAudioOutputs } from './audio-output-store'

describe('the sound outputs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('open the microphone only when the person asked for their names', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }))
    const enumerateDevices = vi.fn(async () => [
      { kind: 'audiooutput', deviceId: 'default', label: '' },
      { kind: 'audiooutput', deviceId: 'speakers', label: '' },
      { kind: 'audioinput', deviceId: 'mic', label: '' },
    ])
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } })

    expect(await listAudioOutputs({ names: false })).toEqual([
      { id: 'speakers', label: 'speakers', named: false },
    ])
    expect(getUserMedia).not.toHaveBeenCalled()

    await listAudioOutputs({ names: true })
    expect(getUserMedia).toHaveBeenCalledOnce()
  })
})
