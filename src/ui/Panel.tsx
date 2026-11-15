// Workspace building blocks: the label-plate header every panel carries, and the drag handles
// between panels.
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CloseIcon } from './icons.tsx';

/** Panel header styled as a printed equipment label: code block, title, serial bars, tools. */
export function PanelHead({ code, title, note, children, onClose }: { code: string; title: string; note?: ReactNode; children?: ReactNode; onClose?: () => void }) {
  return (
    <header className="label-head">
      <span className="label-code">{code}</span>
      <span className="label-title">{title}</span>
      {note !== undefined && <span className="label-note">{note}</span>}
      <span className="label-bars" aria-hidden="true" />
      {children && <span className="label-tools">{children}</span>}
      {onClose && <button className="label-x" onClick={onClose} title={`Hide ${title.toLowerCase()}`} aria-label={`Hide ${title}`}><CloseIcon /></button>}
    </header>
  );
}

/**
 * Drag handle between two panels. `dir` is the axis the pointer moves along; `invert` is set
 * when dragging toward the origin should grow the panel (right-hand and bottom panels).
 */
export function Resizer({ dir, value, onChange, invert, label }: { dir: 'x' | 'y'; value: number; onChange: (v: number) => void; invert?: boolean; label: string }) {
  const sign = invert ? -1 : 1;
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const start = dir === 'x' ? e.clientX : e.clientY;
    const v0 = value;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev: PointerEvent) => onChange(v0 + ((dir === 'x' ? ev.clientX : ev.clientY) - start) * sign);
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  return (
    <div
      className={`resizer ${dir}`}
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`Drag to resize ${label.toLowerCase()}`}
      onPointerDown={onDown}
      onKeyDown={(e) => {
        const grow = dir === 'x' ? 'ArrowRight' : 'ArrowDown', shrink = dir === 'x' ? 'ArrowLeft' : 'ArrowUp';
        if (e.key === grow || e.key === shrink) {
          e.preventDefault();
          e.stopPropagation();
          onChange(value + (e.key === grow ? 16 : -16) * sign);
        }
      }}
    />
  );
}
