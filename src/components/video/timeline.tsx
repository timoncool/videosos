"use client";

import clsx from "clsx";
import type { HTMLAttributes } from "react";

type TimelineRulerProps = {
  duration?: number;
} & HTMLAttributes<HTMLDivElement>;

export function TimelineRuler({
  className,
  duration = 30,
  ...props
}: TimelineRulerProps) {
  const totalTicks = duration * 10;
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute inset-0 w-full h-full overflow-hidden",
        className,
      )}
      {...props}
    >
      <div className="flex px-2 py-0.5 h-full">
        {Array.from({ length: totalTicks + 1 }, (_, index) => index).map(
          (tickIndex) => {
            const isMajorTick = tickIndex % 50 === 0;
            const isMinorTick = tickIndex % 10 === 0;
            return (
              <div
                key={`tick-${tickIndex}`}
                className="flex-grow flex flex-col"
              >
                {isMajorTick && (
                  <div className="text-muted-foreground text-sm tabular-nums h-full text-center mt-1">
                    {(tickIndex / 10).toFixed(0)}s
                    <div className="h-full max-h-full w-px bg-border/50 mx-auto mt-1 mb-4" />
                  </div>
                )}
                {isMinorTick && !isMajorTick && (
                  <div className="text-muted-foreground tabular-nums text-center">
                    &middot;
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
