import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LINKS } from '../services/links'

/** Where a text and a link are posted, as YuE2 Studio's share window lists them. */
const PLACES: Array<{ id: string; url: (text: string, link: string) => string }> = [
  {
    id: 'telegram',
    url: (text, link) =>
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: 'x',
    url: (text, link) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
  },
  {
    id: 'vk',
    url: (text, link) =>
      `https://vk.com/share.php?url=${encodeURIComponent(link)}&title=${encodeURIComponent(text)}`,
  },
  {
    id: 'whatsapp',
    url: (text, link) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`,
  },
  {
    id: 'reddit',
    url: (text, link) =>
      `https://reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(text)}`,
  },
]

const canShareFiles = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  typeof navigator.canShare === 'function'

interface ShareMenuProps {
  title: string
  /** The file itself, read when it is sent. */
  file: () => Promise<File>
  className?: string
  compact?: boolean
}

/**
 * Shares a result, as YuE2 Studio's share window does: the file itself through the system's share sheet (the
 * Windows one reaches Telegram, mail and the other programs), or a line about it with VideoSOS's link to a site.
 */
export function ShareMenu({ title, file, className, compact }: ShareMenuProps) {
  const { t } = useTranslation()
  const text = t('share.text', { title })
  const sendFile = async () => {
    const shared = await file()
    if (!navigator.canShare({ files: [shared] })) {
      toast.error(t('share.fileRefused'))
      return
    }
    await navigator.share({ files: [shared], title, text }).catch((error: unknown) => {
      // closing the share sheet is the person's choice, not a failure
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={className ?? 'h-6 px-1.5 text-[11px]'}
          title={t('share.title')}
          aria-label={t('share.title')}
        >
          <Share2 className={compact ? 'h-3 w-3' : 'mr-1 h-3 w-3'} />
          {!compact && t('share.title')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!canShareFiles()}
          onSelect={() =>
            void sendFile().catch((error: unknown) =>
              toast.error(
                t('share.failed', {
                  reason: error instanceof Error ? error.message : String(error),
                }),
              ),
            )
          }
        >
          <Share2 className="mr-2 h-3.5 w-3.5" />
          {canShareFiles() ? t('share.file') : t('share.fileUnavailable')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PLACES.map((place) => (
          <DropdownMenuItem key={place.id} asChild>
            <a href={place.url(text, LINKS.repo)} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              {t(`share.places.${place.id}`)}
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void navigator.clipboard.writeText(`${text}\n${LINKS.repo}`).then(
              () => toast.success(t('share.copied')),
              (error: unknown) =>
                toast.error(
                  t('share.failed', {
                    reason: error instanceof Error ? error.message : String(error),
                  }),
                ),
            )
          }
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          {t('share.copyText')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
