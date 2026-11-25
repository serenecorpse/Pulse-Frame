"use client";

import { useRef, type PointerEvent } from "react";
import type { Motion, MotionParameter } from "@/lib/motion";

const tracks: { parameter: MotionParameter; color: string; top: number }[] = [
  { parameter: "cx", color: "#f2cf89", top: 7 },
  { parameter: "cy", color: "#76d6c6", top: 27 },
  { parameter: "zoom", color: "#b397ff", top: 47 },
  { parameter: "rotation", color: "#ee91aa", top: 67 },
];
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
function yPosition(parameter: MotionParameter, value: number, top: number) {
  if (parameter === "rotation") return top + (clamp(value, -30, 30) / 30) * 11;
  const normalized = parameter === "zoom" ? value / Math.log(4) : value;
  return top + (1 - clamp(normalized, 0, 1)) * 11;
}

export default function MotionGraph({
  motion,
  onStart,
  onChange,
}: {
  motion: Motion;
  onStart: () => void;
  onChange: (motion: Motion) => void;
}) {
  const drag = useRef<{ parameter: MotionParameter; index: number } | null>(
    null,
  );
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 300,
      y = ((event.clientY - bounds.top) / bounds.height) * 92;
    const item = tracks.find(
      (track) => track.parameter === drag.current!.parameter,
    )!;
    const next = structuredClone(motion),
      point = next.keyframes[item.parameter][drag.current.index];
    point.t = clamp(((x - 12) / 276) * motion.duration, 0, motion.duration);
    if (item.parameter === "rotation")
      point.v = clamp(((y - item.top) / 11) * 30, -30, 30);
    else {
      const value = clamp(1 - (y - item.top) / 11, 0, 1);
      point.v = item.parameter === "zoom" ? value * Math.log(4) : value;
    }
    onChange(next);
  };
  const finish = () => {
    if (!drag.current) return;
    const { parameter, index } = drag.current,
      next = structuredClone(motion),
      moved = next.keyframes[parameter][index];
    next.keyframes[parameter] = next.keyframes[parameter]
      .filter((point, i) => i === index || Math.abs(point.t - moved.t) >= 0.001)
      .sort((a, b) => a.t - b.t);
    drag.current = null;
    onChange(next);
  };
  return (
    <svg
      className="motion-keyframe-track"
      viewBox="0 0 300 92"
      role="img"
      aria-label="Drag camera keyframe dots"
      onPointerDown={(event) => {
        const target = event.target;
        if (!(target instanceof SVGCircleElement)) return;
        const parameter = target.dataset.parameter as MotionParameter,
          index = Number(target.dataset.index);
        if (
          !tracks.some((track) => track.parameter === parameter) ||
          !Number.isInteger(index)
        )
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { parameter, index };
        onStart();
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {tracks.map(({ parameter, color, top }) => (
        <g key={parameter}>
          <line
            className="motion-track-line"
            x1="12"
            y1={top + 15}
            x2="288"
            y2={top + 15}
          />
          <text x="12" y={top + 2}>
            {parameter}
          </text>
          <polyline
            points={[...motion.keyframes[parameter]]
              .sort((a, b) => a.t - b.t)
              .map(
                (point) =>
                  `${12 + (point.t / motion.duration) * 276},${yPosition(parameter, point.v, top)}`,
              )
              .join(" ")}
            fill="none"
            stroke={color}
            strokeOpacity=".46"
          />
          {motion.keyframes[parameter].map((point, index) => (
            <circle
              key={index}
              className="motion-track-dot"
              data-parameter={parameter}
              data-index={index}
              cx={12 + (point.t / motion.duration) * 276}
              cy={yPosition(parameter, point.v, top)}
              r="4"
              fill={color}
            >
              <title>
                {parameter} at {point.t.toFixed(2)}s
              </title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
