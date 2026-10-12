import React from 'react'
import { useTranslation } from 'react-i18next'
import { AbsoluteFill } from '@/runtime/composition-runtime/deps/player'

interface MediaOfflinePlaceholderProps {
  /**
   * True when the item's media is known-missing/broken (relink needed). False
   * while the source is merely still resolving — we show a neutral loading hint
   * instead of alarming the user during a normal load.
   */
  offline: boolean
  /** File name / clip label to help the user identify which media is missing. */
  label?: string
}

/**
 * Clean fallback shown in the preview when an item's media source can't be
 * rendered — either it's still resolving, or it's genuinely missing and needs
 * relinking. Replaces the ad-hoc per-type "not loaded" cards so video, image
 * and Lottie all read the same, and so a dead source shows an actionable state
 * instead of letting the renderer spam the console with failed blob fetches.
 */
export const MediaOfflinePlaceholder: React.FC<MediaOfflinePlaceholderProps> = ({
  offline,
  label,
}) => {
  const { t } = useTranslation()
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 16,
        textAlign: 'center',
      }}
    >
      {offline ? (
        <>
          <svg
            width={28}
            height={28}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffb84d"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m18.84 12.25 1.72-1.71a4.24 4.24 0 0 0-6-6l-1.71 1.72" />
            <path d="m5.17 11.75-1.72 1.71a4.24 4.24 0 0 0 6 6l1.71-1.72" />
            <line x1="8" y1="2" x2="8" y2="5" />
            <line x1="2" y1="8" x2="5" y2="8" />
            <line x1="16" y1="19" x2="16" y2="22" />
            <line x1="19" y1="16" x2="22" y2="16" />
          </svg>
          <span style={{ color: '#ffb84d', fontSize: 14, fontWeight: 600 }}>
            {t('preview.mediaOffline.title')}
          </span>
          {label && (
            <span style={{ color: '#999', fontSize: 12, wordBreak: 'break-word' }}>{label}</span>
          )}
          <span style={{ color: '#777', fontSize: 12 }}>{t('preview.mediaOffline.relink')}</span>
        </>
      ) : (
        <span style={{ color: '#666', fontSize: 14 }}>{t('preview.mediaOffline.loading')}</span>
      )}
    </AbsoluteFill>
  )
}
