import type { SVGProps } from "react";

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
type P = SVGProps<SVGSVGElement>;

export const IconPlay = (p: P) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M7.5 4.9v14.2a1 1 0 0 0 1.53.85l11.1-7.1a1 1 0 0 0 0-1.7L9.03 4.05A1 1 0 0 0 7.5 4.9Z" />
  </svg>
);
export const IconInfo = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" />
  </svg>
);
export const IconEye = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);
export const IconCheck = (p: P) => <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IconNo = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </svg>
);
export const IconChevronDown =(p: P) => <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>;
export const IconChevronLeft = (p: P) => <svg {...base} {...p}><path d="m15 5-7 7 7 7" /></svg>;
export const IconChevronRight = (p: P) => <svg {...base} {...p}><path d="m9 5 7 7-7 7" /></svg>;
export const IconBack = (p: P) => <svg {...base} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const IconSearch = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const IconLibrary = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4" width="4" height="16" rx="1" />
    <rect x="9.5" y="4" width="4" height="16" rx="1" />
    <path d="m16 5.2 3.6-.9 3 15.4-3.6.9Z" transform="translate(-2.2 0)" />
  </svg>
);
export const IconStar = (p: P) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" />
  </svg>
);
export const IconSettings = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.5 7.5 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.4.9 2-3.4Z" />
  </svg>
);
export const IconPlus = (p: P) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const IconClose = (p: P) => <svg {...base} {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>;
export const IconFilter = (p: P) => <svg {...base} {...p}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
export const IconShuffle = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 7h3.5c2 0 3.3 1 4.4 2.6l2.2 3.3c1.1 1.6 2.4 2.6 4.4 2.6H21" />
    <path d="M3 17h3.5c1.6 0 2.7-.6 3.6-1.6M14 8.6c.9-1 2-1.6 3.5-1.6H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
  </svg>
);
export const IconGrid = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
  </svg>
);
export const IconList = (p: P) => <svg {...base} {...p}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>;
export const IconBookmark = (p: P) => <svg {...base} {...p}><path d="M6.5 4h11v16l-5.5-4-5.5 4Z" /></svg>;
export const IconExternal = (p: P) => <svg {...base} {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
export const IconCalendar = (p: P) => (
  <svg {...base} {...p}><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></svg>
);
export const IconLayers = (p: P) => (
  <svg {...base} {...p}><path d="m12 4 8.5 4.5L12 13 3.5 8.5Z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></svg>
);
export const IconTrophy = (p: P) => (
  <svg {...base} {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M10 17h4" /></svg>
);
export const IconDownload = (p: P) => <svg {...base} {...p}><path d="M12 4v11M7 10.5 12 15l5-4.5M5 19.5h14" /></svg>;
export const IconMore = (p: P) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18.5" cy="12" r="1.7" />
  </svg>
);
