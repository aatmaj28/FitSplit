import { useId, type ReactNode } from "react";

/** FitSplit's mark: a floor plan split into three rooms (one per roommate). */
export function FitSplitMark({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id}g)`} />
      <rect x="11" y="11" width="12" height="26" rx="3" fill="#fff" />
      <rect x="25" y="11" width="12" height="12" rx="3" fill="#fff" fillOpacity="0.72" />
      <rect x="25" y="25" width="12" height="12" rx="3" fill="#fff" fillOpacity="0.45" />
    </svg>
  );
}

function Svg({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const IconHeart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />
  </Svg>
);

export const IconSwipe = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="11" height="15" rx="2.5" transform="rotate(-8 9 12.5)" />
    <path d="M17 6.5l2.6.6a2 2 0 0 1 1.5 2.4l-2.3 9.6a2 2 0 0 1-2.4 1.5l-1.4-.3" />
    <path d="M9 15.2s-2.6-1.6-2.6-3.5a1.5 1.5 0 0 1 2.6-1 1.5 1.5 0 0 1 2.6 1c0 1.9-2.6 3.5-2.6 3.5z" />
  </Svg>
);

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </Svg>
);

export const IconSofa = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    <path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4z" />
    <path d="M6 18v2M18 18v2" />
  </Svg>
);

export const IconSplit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 9 9h-9V3z" />
    <path d="M15.5 3.7A9 9 0 0 1 20.3 8.5h-4.8V3.7z" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
  </Svg>
);

export const IconPlan = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M3.5 12H10M13 12h7.5M12 3.5V8M12 15v5.5" />
  </Svg>
);

export const IconRuler = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16.5L16.5 4l3.5 3.5L7.5 20 4 16.5z" />
    <path d="M8 12.5l1.8 1.8M10.5 10l1.2 1.2M13 7.5l1.8 1.8" />
  </Svg>
);

export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13.5L6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5z" />
    <path d="M4 13.5h4.5l1 2h5l1-2H20" />
  </Svg>
);

export const IconFileCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 14.5l2 2 4-4" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19.5v-.8A4.7 4.7 0 0 1 7.7 14h2.6a4.7 4.7 0 0 1 4.7 4.7v.8" />
    <path d="M16 5a3.2 3.2 0 0 1 0 6.2M18 14.2a4.7 4.7 0 0 1 3 4.4v.9" />
  </Svg>
);

export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8L12 3.5z" />
    <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
  </Svg>
);

export const IconPlay = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M8.5 5.8v12.4a1 1 0 0 0 1.5.86l10-6.2a1 1 0 0 0 0-1.72l-10-6.2a1 1 0 0 0-1.5.86z" fill="currentColor" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1" />
    <path d="M20 20v-4.5h-4.5" />
  </Svg>
);
