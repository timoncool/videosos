import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'

interface DopesheetHeaderFrameInputsProps {
  disabled: boolean
  inputsEnabled: boolean
  totalFrames: number
  globalFrame: number | null
  localFrameInputValue: string
  globalFrameInputValue: string
  setLocalFrameInputValue: (value: string) => void
  setGlobalFrameInputValue: (value: string) => void
  skipNextHeaderFrameBlurRef: React.RefObject<'local' | 'global' | null>
  commitLocalFrameInput: () => void
  commitGlobalFrameInput: () => void
  handleHeaderFrameInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    input: 'local' | 'global',
    commit: () => void,
  ) => void
}

export function DopesheetHeaderFrameInputs({
  disabled,
  inputsEnabled,
  totalFrames,
  globalFrame,
  localFrameInputValue,
  globalFrameInputValue,
  setLocalFrameInputValue,
  setGlobalFrameInputValue,
  skipNextHeaderFrameBlurRef,
  commitLocalFrameInput,
  commitGlobalFrameInput,
  handleHeaderFrameInputKeyDown,
}: DopesheetHeaderFrameInputsProps) {
  const { t } = useTranslation()
  const inputDisabled = disabled || !inputsEnabled

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] text-muted-foreground">
          {t('timeline.keyframeEditor.local')}
        </span>
        <Input
          type="number"
          autoComplete="off"
          data-bwignore="true"
          value={localFrameInputValue}
          onChange={(event) => setLocalFrameInputValue(event.target.value)}
          placeholder="-"
          onBlur={() => {
            if (skipNextHeaderFrameBlurRef.current === 'local') {
              skipNextHeaderFrameBlurRef.current = null
              return
            }
            commitLocalFrameInput()
          }}
          onKeyDown={(event) =>
            handleHeaderFrameInputKeyDown(event, 'local', commitLocalFrameInput)
          }
          aria-label={t('timeline.keyframeEditor.localFrame')}
          className="h-5 w-12 px-1 text-center text-[10px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          min={0}
          max={Math.max(totalFrames - 1, 0)}
          disabled={inputDisabled}
        />
      </div>
      {globalFrame !== null && (
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-muted-foreground">
            {t('timeline.keyframeEditor.global')}
          </span>
          <Input
            type="number"
            autoComplete="off"
            data-bwignore="true"
            value={globalFrameInputValue}
            onChange={(event) => setGlobalFrameInputValue(event.target.value)}
            placeholder="-"
            onBlur={() => {
              if (skipNextHeaderFrameBlurRef.current === 'global') {
                skipNextHeaderFrameBlurRef.current = null
                return
              }
              commitGlobalFrameInput()
            }}
            onKeyDown={(event) =>
              handleHeaderFrameInputKeyDown(event, 'global', commitGlobalFrameInput)
            }
            aria-label={t('timeline.keyframeEditor.globalFrame')}
            className="h-5 w-14 px-1 text-center text-[10px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            disabled={inputDisabled}
          />
        </div>
      )}
    </div>
  )
}
