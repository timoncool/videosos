import { cn } from '@/shared/ui/cn'

interface FreeCutLogoProps {
  variant?: 'full' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeConfig = {
  sm: {
    icon: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-1.5',
  },
  md: {
    icon: 'w-7 h-7',
    text: 'text-xl',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-10 h-10',
    text: 'text-3xl',
    gap: 'gap-3',
  },
}

function VideoSosIcon({ className }: { className?: string }) {
  return <img src="/videosos-icon.svg" alt="" className={cn('rounded-[22%]', className)} />
}

export function FreeCutLogo({ variant = 'full', size = 'md', className }: FreeCutLogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return <VideoSosIcon className={cn(config.icon, className)} />
  }

  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <VideoSosIcon className={config.icon} />
      <span className={cn(config.text, 'font-semibold tracking-tight text-foreground')}>
        VideoSOS
      </span>
    </div>
  )
}
