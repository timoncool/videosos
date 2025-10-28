"use client";

import clsx from "clsx";
import {
  type HTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type TimelineRulerProps = {
  duration?: number;
  zoom?: number;
} & HTMLAttributes<HTMLDivElement>;

type ViewportState = {
  width: number;
  contentWidth: number;
  scrollLeft: number;
  zoomAttr: number;
};

const MAJOR_INTERVALS: number[] = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600,
  7200, 10800, 14400, 21600, 43200, 86400,
];

const RULER_HEIGHT = 48;
const MIN_MAJOR_SPACING_PX = 96;
const TICK_VISIBILITY_BUFFER = 32;
const EPSILON = 0.000_01;

function formatTickLabel(seconds: number, majorInterval: number) {
  if (seconds < EPSILON) {
    return "0s";
  }

  if (seconds >= 3600) {
    const hours = seconds / 3600;
    const decimals = majorInterval < 3600 ? 1 : 0;
    return `${hours.toFixed(decimals)}h`;
  }

  if (seconds >= 60) {
    const minutes = seconds / 60;
    const decimals = majorInterval < 60 ? 1 : 0;
    return `${minutes.toFixed(decimals)}m`;
  }

  if (seconds >= 1) {
    const decimals =
      majorInterval < 1 ? Math.ceil(-Math.log10(majorInterval)) : 0;
    return `${seconds.toFixed(decimals)}s`;
  }

  return `${Math.round(seconds * 1000)}ms`;
}

function chooseMajorInterval(pixelsPerSecond: number) {
  const desiredSpacingSeconds = MAJOR_INTERVALS.find(
    (interval) => interval * pixelsPerSecond >= MIN_MAJOR_SPACING_PX,
  );

  return desiredSpacingSeconds ?? MAJOR_INTERVALS[MAJOR_INTERVALS.length - 1];
}

function chooseMinorInterval(majorInterval: number) {
  const smallerIntervals = MAJOR_INTERVALS.filter(
    (value) => value < majorInterval,
  );

  const matchingInterval = smallerIntervals
    .reverse()
    .find(
      (interval) =>
        Math.abs(
          majorInterval / interval - Math.round(majorInterval / interval),
        ) < EPSILON,
    );

  if (matchingInterval) {
    return matchingInterval;
  }

  const fallback = majorInterval / 2;
  return fallback > EPSILON ? fallback : majorInterval;
}

function clampToRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function TimelineRuler({
  className,
  duration = 30,
  zoom: zoomProp,
  ...props
}: TimelineRulerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    width: 0,
    contentWidth: 0,
    scrollLeft: 0,
    zoomAttr: zoomProp ?? 1,
  });

  useEffect(() => {
    setViewport((previous) =>
      Math.abs(previous.zoomAttr - (zoomProp ?? previous.zoomAttr)) < EPSILON
        ? previous
        : { ...previous, zoomAttr: zoomProp ?? previous.zoomAttr },
    );
  }, [zoomProp]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const trackElement = element.nextElementSibling as HTMLElement | null;
    const scrollContainer =
      trackElement?.parentElement ?? element.parentElement ?? element;

    const resolveZoomFromDom = () => {
      const zoomSource =
        scrollContainer?.closest<HTMLElement>("[data-timeline-zoom]") ??
        scrollContainer;
      const attrValue = zoomSource?.getAttribute("data-timeline-zoom");
      if (attrValue) {
        const parsed = Number.parseFloat(attrValue);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      if (zoomSource) {
        const zoomVar =
          getComputedStyle(zoomSource).getPropertyValue("--timeline-zoom");
        const parsed = Number.parseFloat(zoomVar);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }

      return 1;
    };

    const readState = () => {
      const zoomValue = zoomProp ?? resolveZoomFromDom();

      const newState: ViewportState = {
        width: scrollContainer?.clientWidth ?? element.clientWidth,
        contentWidth:
          trackElement?.scrollWidth ??
          element.scrollWidth ??
          scrollContainer?.scrollWidth ??
          element.clientWidth,
        scrollLeft: scrollContainer?.scrollLeft ?? 0,
        zoomAttr: zoomValue,
      };

      setViewport((previous) => {
        if (
          Math.abs(previous.width - newState.width) < 0.5 &&
          Math.abs(previous.contentWidth - newState.contentWidth) < 0.5 &&
          Math.abs(previous.scrollLeft - newState.scrollLeft) < 0.5 &&
          Math.abs(previous.zoomAttr - newState.zoomAttr) < 0.01
        ) {
          return previous;
        }

        return newState;
      });
    };

    readState();

    const resizeObserver = new ResizeObserver(() => {
      readState();
    });

    if (scrollContainer) {
      resizeObserver.observe(scrollContainer);
      scrollContainer.addEventListener("scroll", readState, { passive: true });
    }

    if (trackElement && trackElement !== scrollContainer) {
      resizeObserver.observe(trackElement);
    }

    const mutationTarget =
      scrollContainer?.closest("[data-timeline-zoom]") ?? scrollContainer;
    let mutationObserver: MutationObserver | undefined;
    if (mutationTarget) {
      mutationObserver = new MutationObserver(() => {
        readState();
      });
      mutationObserver.observe(mutationTarget, {
        attributes: true,
        attributeFilter: ["data-timeline-zoom"],
      });
    }

    return () => {
      resizeObserver.disconnect();
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", readState);
      }
      mutationObserver?.disconnect();
    };
  }, [zoomProp]);

  const { majorTicks, minorTicks, majorInterval, viewWidth } = useMemo(() => {
    if (duration <= 0) {
      return {
        majorTicks: [],
        minorTicks: [],
        majorInterval: 1,
        viewWidth: Math.max(1, viewport.width),
      };
    }

    const viewportWidth = Math.max(1, viewport.width);
    const zoomValue = zoomProp ?? viewport.zoomAttr ?? 1;

    let totalContentWidth = Math.max(viewport.contentWidth, viewportWidth);
    if (zoomValue !== 1 && Math.abs(totalContentWidth - viewportWidth) < 0.5) {
      totalContentWidth *= zoomValue;
    }

    const pixelsPerSecond = totalContentWidth / duration;
    if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
      return {
        majorTicks: [],
        minorTicks: [],
        majorInterval: 1,
        viewWidth: viewportWidth,
      };
    }

    const visibleStartSeconds = clampToRange(
      viewport.scrollLeft / pixelsPerSecond,
      0,
      duration,
    );
    const visibleEndSeconds = clampToRange(
      (viewport.scrollLeft + viewportWidth) / pixelsPerSecond,
      0,
      duration,
    );

    const majorIntervalValue = chooseMajorInterval(pixelsPerSecond);
    const minorIntervalValue = chooseMinorInterval(majorIntervalValue);

    const startRange = clampToRange(
      visibleStartSeconds - majorIntervalValue,
      0,
      duration,
    );
    const endRange = clampToRange(
      visibleEndSeconds + majorIntervalValue,
      0,
      duration,
    );

    const majorLines: { time: number; x: number }[] = [];
    const minorLines: { time: number; x: number }[] = [];

    const minorStartIndex = Math.floor(startRange / minorIntervalValue) - 1;
    const minorEndIndex = Math.ceil(endRange / minorIntervalValue) + 1;

    for (let index = minorStartIndex; index <= minorEndIndex; index += 1) {
      const time = index * minorIntervalValue;
      if (time < -EPSILON || time - duration > EPSILON) {
        continue;
      }

      const clampedTime = clampToRange(time, 0, duration);
      const position = clampedTime * pixelsPerSecond - viewport.scrollLeft;

      if (
        position < -TICK_VISIBILITY_BUFFER ||
        position > viewportWidth + TICK_VISIBILITY_BUFFER
      ) {
        continue;
      }

      const ratio = clampedTime / majorIntervalValue;
      const isMajor = Math.abs(ratio - Math.round(ratio)) < EPSILON;

      if (isMajor) {
        if (
          !majorLines.some(
            (line) => Math.abs(line.time - clampedTime) < EPSILON,
          )
        ) {
          majorLines.push({ time: clampedTime, x: position });
        }
      } else {
        minorLines.push({ time: clampedTime, x: position });
      }
    }

    if (!majorLines.some((line) => line.time < EPSILON)) {
      majorLines.push({ time: 0, x: -viewport.scrollLeft });
    }

    if (!majorLines.some((line) => Math.abs(line.time - duration) < EPSILON)) {
      const endPosition = duration * pixelsPerSecond - viewport.scrollLeft;
      if (
        endPosition >= -TICK_VISIBILITY_BUFFER &&
        endPosition <= viewportWidth + TICK_VISIBILITY_BUFFER
      ) {
        majorLines.push({ time: duration, x: endPosition });
      }
    }

    majorLines.sort((a, b) => a.time - b.time);

    return {
      majorTicks: majorLines,
      minorTicks: minorLines,
      majorInterval: majorIntervalValue,
      viewWidth: viewportWidth,
    };
  }, [duration, viewport, zoomProp]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute inset-0 w-full h-full overflow-hidden",
        className,
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="w-full h-full"
        viewBox={`0 0 ${Math.max(1, viewWidth)} ${RULER_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <rect
          x={0}
          y={0}
          width={Math.max(1, viewWidth)}
          height={RULER_HEIGHT}
          fill="url(#timeline-ruler-bg)"
          opacity={0}
        />
        <defs>
          <linearGradient id="timeline-ruler-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(15, 23, 42, 0.0)" />
            <stop offset="1" stopColor="rgba(15, 23, 42, 0.05)" />
          </linearGradient>
        </defs>
        <line
          x1={0}
          y1={RULER_HEIGHT - 6}
          x2={Math.max(1, viewWidth)}
          y2={RULER_HEIGHT - 6}
          stroke="hsl(var(--border))"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
        {minorTicks.map((tick) => (
          <line
            key={`minor-${tick.time.toFixed(5)}-${tick.x.toFixed(2)}`}
            x1={tick.x}
            y1={RULER_HEIGHT - 22}
            x2={tick.x}
            y2={RULER_HEIGHT - 6}
            stroke="hsl(var(--border))"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        ))}
        {majorTicks.map((tick) => (
          <g key={`major-${tick.time.toFixed(5)}-${tick.x.toFixed(2)}`}>
            <line
              x1={tick.x}
              y1={RULER_HEIGHT - 32}
              x2={tick.x}
              y2={RULER_HEIGHT - 6}
              stroke="hsl(var(--border))"
              strokeOpacity={0.55}
              strokeWidth={1.5}
            />
            <text
              x={tick.x}
              y={RULER_HEIGHT - 38}
              textAnchor="middle"
              fontSize={12}
              fill="hsl(var(--muted-foreground))"
              style={{ pointerEvents: "none" }}
            >
              {formatTickLabel(tick.time, majorInterval)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
