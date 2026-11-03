import type { ReactNode } from "react";

// ponytail: one path registry, copied from the design's inline SVGs — 16px grid, stroke 1.6, so every
// icon scales and recolours with currentColor
const PATHS = {
  documents: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2z" />
      <path d="M9 2v4h4" />
    </>
  ),
  generate: <path d="M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2" />,
  tests: <path d="M6 4h8M6 8h8M6 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" />,
  review: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <path d="m5 8.2 2 2 4-4.4" />
    </>
  ),
  jobs: <path d="M1.5 8h3l2-5 3 10 2-5h3" />,
  settings: (
    <>
      <path d="M2.5 4h6.5M12.5 4h1M2.5 12h1.5M7 12h6.5M2.5 8h2M8 8h5.5" />
      <circle cx="10.7" cy="4" r="1.6" />
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="6.3" cy="8" r="1.6" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  clone: (
    <>
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  pull: <path d="M8 2.5v8M4.6 7.1 8 10.5l3.4-3.4M2.5 13.5h11" />,
  push: <path d="M8 10.5V2.5M4.6 5.9 8 2.5l3.4 3.4M2.5 13.5h11" />,
  folder: (
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
  ),
  down: <path d="m4 6 4 4 4-4" />,
  up: <path d="m4 10 4-4 4 4" />,
  right: <path d="m6 4 4 4-4 4" />,
  left: <path d="m10 4-4 4 4 4" />,
  trash: <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </>
  ),
  link: (
    <>
      <path d="M6.6 9.4 9.4 6.6" />
      <path d="M7.2 4.4 8.6 3a2.6 2.6 0 0 1 3.7 3.7L10.9 8.1M8.8 11.6 7.4 13a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  pin: (
    <>
      <path d="M6 2h4M7 2v4.2L4.5 9h7L9 6.2V2" />
      <path d="M8 9v5" />
    </>
  ),
  claude: <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />,
  revert: (
    <>
      <path d="M4 6.5h6a3 3 0 0 1 0 6H7" />
      <path d="M6.5 4 4 6.5 6.5 9" />
    </>
  ),
  send: <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </>
  ),
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  check: <path d="m3.2 8.4 3 3 6.6-7" />,
  warning: (
    <>
      <path d="M8 2.2 14.3 13.5H1.7L8 2.2z" />
      <path d="M8 6.8v3M8 11.6v.1" />
    </>
  ),
  error: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.9 5.9 4.2 4.2M10.1 5.9l-4.2 4.2" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4V11M8 5v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  draft: <circle cx="8" cy="8" r="5.6" strokeDasharray="2.4 2.2" />,
  checked: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  edit: <path d="M10.6 2.6 13.4 5.4 6 12.8H3.2V10l7.4-7.4z" />,
  validated: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.4 8.2 1.8 1.8 3.4-3.8" />
    </>
  ),
  local: (
    <>
      <rect x="2.5" y="3" width="11" height="7.5" rx="1.2" />
      <path d="M1.5 13h13" />
    </>
  ),
  modified: (
    <>
      <path d="M5 12.5H4.2a3 3 0 0 1-.4-6A4.2 4.2 0 0 1 12 6a3 3 0 0 1 .3 6.5H11" />
      <path d="M8 13.5V8.5M6.2 10.2 8 8.4l1.8 1.8" />
    </>
  ),
  synced: (
    <>
      <path d="M4.2 12.5a3 3 0 0 1-.4-6A4.2 4.2 0 0 1 12 6a3 3 0 0 1 .3 6.5H4.2z" />
      <path d="m6.2 9.4 1.3 1.3 2.4-2.6" />
    </>
  ),
  changed: (
    <>
      <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1" />
      <path d="M13.5 2.5v3h-3" />
      <path d="M8 5.8v2.6M8 10.6v.1" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 8.5V3a.5.5 0 0 1 .5-.5h5.5L14 8l-6 6-5.5-5.5z" />
      <circle cx="5.5" cy="5.5" r=".8" />
    </>
  ),
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </>
  ),
  moon: <path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z" />,
  system: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" />
    </>
  ),
  more: <path d="M3.5 8h.1M8 8h.1M12.5 8h.1" />,
  zoomIn: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5M5 7h4M7 5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5M5 7h4" />
    </>
  ),
  fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  table: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M6.5 6.5V13" />
    </>
  ),
  text: <path d="M3 4h10M3 8h10M3 12h6" />,
  jiraOff: (
    <>
      <path d="M8 1.8 14.2 8 8 14.2 1.8 8z" />
      <path d="M8 5.4 10.6 8 8 10.6 5.4 8z" />
      <path d="m2.2 2.2 11.6 11.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

const FILLED = {
  grip: (
    <>
      <circle cx="6" cy="4" r="1.1" />
      <circle cx="10" cy="4" r="1.1" />
      <circle cx="6" cy="8" r="1.1" />
      <circle cx="10" cy="8" r="1.1" />
      <circle cx="6" cy="12" r="1.1" />
      <circle cx="10" cy="12" r="1.1" />
    </>
  ),
  dot: <circle cx="8" cy="8" r="3" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name in FILLED;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? undefined : "currentColor"}
      strokeWidth={filled ? undefined : 1.6}
      strokeLinecap={filled ? undefined : "round"}
      strokeLinejoin={filled ? undefined : "round"}
    >
      {filled ? FILLED[name as keyof typeof FILLED] : PATHS[name as keyof typeof PATHS]}
    </svg>
  );
}
