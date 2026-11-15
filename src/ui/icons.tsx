// Small inline icons (16 px grid, stroke follows the text colour).
import type { ReactNode, SVGProps } from 'react';

const base = (children: ReactNode, props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {children}
  </svg>
);

type P = SVGProps<SVGSVGElement>;
export const PlayIcon = (p: P) => base(<path d="M4.5 3.2v9.6L12.5 8z" fill="currentColor" stroke="none" />, p);
export const PauseIcon = (p: P) => base(<><rect x="3.8" y="3" width="3" height="10" rx="0.8" fill="currentColor" stroke="none" /><rect x="9.2" y="3" width="3" height="10" rx="0.8" fill="currentColor" stroke="none" /></>, p);
export const PinIcon = (p: P) => base(<><path d="M5.5 2.5h5l-.8 4 2.3 2.5h-8L6.3 6.5z" /><path d="M8 9v4.5" /></>, p);
export const PlusIcon = (p: P) => base(<path d="M8 3v10M3 8h10" />, p);
export const CloseIcon = (p: P) => base(<path d="M4 4l8 8M12 4l-8 8" />, p);
export const SearchIcon = (p: P) => base(<><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2l3.3 3.3" /></>, p);
export const LinkIcon = (p: P) => base(<><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8" /></>, p);
export const InfoIcon = (p: P) => base(<><circle cx="8" cy="8" r="5.8" /><path d="M8 7.2v3.6M8 5.2v.2" /></>, p);
export const DownloadIcon = (p: P) => base(<><path d="M8 2.8v7.4M5 7.6l3 3 3-3" /><path d="M3 12.8h10" /></>, p);
export const TrashIcon = (p: P) => base(<><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" /></>, p);
export const TargetIcon = (p: P) => base(<><circle cx="8" cy="8" r="4.5" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" /></>, p);

export const StepIcon = (p: P) => base(<><path d="M4 3.5v9L10 8z" fill="currentColor" stroke="none" /><path d="M12 3.5v9" /></>, p);
export const SkipIcon = (p: P) => base(<><path d="M2.5 3.5v9L8 8z" fill="currentColor" stroke="none" /><path d="M8.5 3.5v9L14 8z" fill="currentColor" stroke="none" /></>, p);

/** CELESTE mark: the Moon at first quarter inside an orbit ring, with the Sun and the Earth on it. */
export const Logo = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
    <circle cx="17" cy="17" r="14.5" fill="none" stroke="#23231f" strokeWidth="1.3" />
    <circle cx="17" cy="17" r="8.5" fill="#23231f" />
    <path d="M17 8.5a8.5 8.5 0 0 1 0 17a11.5 11.5 0 0 0 0-17z" fill="#efebe0" />
    <circle cx="27.3" cy="6.8" r="3.1" fill="#f09a1a" stroke="#d9d4c5" strokeWidth="1.2" />
    <circle cx="5.6" cy="26.2" r="2.5" fill="#2f86c8" stroke="#d9d4c5" strokeWidth="1.2" />
  </svg>
);
