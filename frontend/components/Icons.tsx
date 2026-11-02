type P = { size?: number };

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const Sparkle = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
export const Route = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
  </svg>
);
export const Clock = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const Close = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Play = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </svg>
);
export const Pause = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
export const Search = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
export const Star = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
export const ArrowUp = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const ArrowRight = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);
export const ChevronLeft = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const ChevronRight = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);
export const Focus = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </svg>
);
export const External = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const FileIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const FolderIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export function Logo({ size = 22 }: P) {
  // A small star system: a sun with two orbiting files.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="ra-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.35" stopColor="#8fd8ff" />
          <stop offset="1" stopColor="#3a7bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13" ry="6.5" fill="none" stroke="#5ad1ff" strokeOpacity="0.55" strokeWidth="1.3" transform="rotate(-24 16 16)" />
      <circle cx="16" cy="16" r="7" fill="url(#ra-sun)" />
      <circle cx="27.2" cy="11" r="2.1" fill="#ffd84d" />
      <circle cx="5" cy="21.2" r="1.6" fill="#ff7a45" />
    </svg>
  );
}
