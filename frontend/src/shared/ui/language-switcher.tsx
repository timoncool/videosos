import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/shared/ui/cn'
import { changeAppLanguage } from '@/i18n'
import { SUPPORTED_LANGUAGES } from '@/i18n/languages'

function getLanguageButtonLabel(languageCode: string): string {
  return languageCode.split('-')[0]?.slice(0, 2).toUpperCase() || 'EN'
}

interface LanguageSwitcherProps {
  size?: 'sm' | 'md'
  align?: 'start' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function LanguageSwitcher({
  size = 'sm',
  align = 'end',
  side = 'bottom',
}: LanguageSwitcherProps) {
  const { t, i18n: i18nInstance } = useTranslation()
  const currentLanguage = i18nInstance.resolvedLanguage ?? i18nInstance.language
  const buttonClass =
    size === 'md'
      ? 'h-10 w-10 font-mono text-xs font-semibold leading-none tracking-normal'
      : 'h-7 w-7 font-mono text-[10px] font-semibold leading-none tracking-normal'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={buttonClass}
          data-tooltip={t('language.label')}
          data-tooltip-side={side}
          aria-label={t('language.ariaLabel')}
        >
          {getLanguageButtonLabel(currentLanguage)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48">
        {SUPPORTED_LANGUAGES.map((lng) => {
          const active = lng.code === currentLanguage
          return (
            <DropdownMenuItem
              key={lng.code}
              onClick={() => {
                void changeAppLanguage(lng.code)
              }}
              className="justify-between"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{lng.nativeName}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {lng.englishName}
                </span>
              </span>
              <Check className={cn('h-4 w-4', active ? 'opacity-100' : 'opacity-0')} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
