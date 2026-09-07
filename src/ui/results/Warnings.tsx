/**
 * Warning lists for the estimate: flat (compact panel) or grouped by level (full estimate page),
 * each item styled by level and prefixed with the room / staircase it concerns.
 */
import { useEffect, useRef } from 'react';
import type { Project, Warning } from '@engine/types';
import { useProjectStore, type Selection } from '@store/projectStore';

export type WarningLevel = Warning['level'];

export const LEVEL_ORDER: WarningLevel[] = ['error', 'warning', 'info'];
export const LEVEL_LABELS: Record<WarningLevel, string> = { error: 'Errors', warning: 'Warnings', info: 'Notes' };

/** Name of the room / staircase / product a warning refers to, if it can be resolved. */
export function subjectName(project: Project, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return (
    project.rooms.find((r) => r.id === id)?.name ??
    project.staircases.find((s) => s.id === id)?.name ??
    project.products.find((p) => p.id === id)?.name
  );
}

/** Drop exact repeats (the same warning can be reported by a room plan and its roll plan). */
export function dedupeWarnings(warnings: Warning[]): Warning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.level}|${w.code}|${w.subjectId ?? ''}|${w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sort by severity (errors first), keeping the engine's order within a level. */
export function sortWarnings(warnings: Warning[]): Warning[] {
  return warnings
    .map((w, i) => ({ w, i }))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.w.level) - LEVEL_ORDER.indexOf(b.w.level) || a.i - b.i)
    .map((x) => x.w);
}

export function WarningItem({ warning, project }: { warning: Warning; project: Project }) {
  const select = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const name = subjectName(project, warning.subjectId);
  const id = warning.subjectId;
  const target: Selection | undefined = id && project.rooms.some((room) => room.id === id) ? { kind: 'room', id }
    : id && project.staircases.some((stairs) => stairs.id === id) ? { kind: 'staircase', id }
    : id && project.products.some((product) => product.id === id) ? { kind: 'product', id } : undefined;
  // Engine messages usually start with the room name already ("Lounge: ..."); do not repeat it.
  const showName = name && !warning.message.startsWith(name);
  const cls = warning.level === 'warning' ? 'warning' : `warning ${warning.level}`;
  return (
    <li className={cls} data-level={warning.level} data-code={warning.code}>
      {showName ? <strong className="warning-subject">{name}: </strong> : null}
      <span>{warning.message}</span>
      {target ? (
        <button type="button" className="link warning-action no-print" aria-label={`Review ${name}: ${warning.message}`} onClick={() => {
          select(target);
          setTab(target.kind === 'product' ? 'materials' : 'rooms');
        }}>Review {name}</button>
      ) : null}
    </li>
  );
}

export interface WarningsProps {
  warnings: Warning[];
  project: Project;
  /** Group by level with a heading per level (full page); otherwise a flat list sorted by severity. */
  grouped?: boolean;
  /** Show at most this many (flat mode) and a "n more" note. */
  max?: number;
  /** Rendered when there is nothing to show; omit to render nothing. */
  emptyText?: string;
  onShowMore?: () => void;
}

export function Warnings({ warnings, project, grouped, max, emptyText, onShowMore }: WarningsProps) {
  const all = sortWarnings(dedupeWarnings(warnings));
  if (all.length === 0) {
    return emptyText ? <p className="muted small warnings-empty">{emptyText}</p> : null;
  }

  if (grouped) {
    return (
      <div className="warnings-grouped">
        {LEVEL_ORDER.map((level) => {
          const items = all.filter((w) => w.level === level);
          if (items.length === 0) return null;
          if (level === 'info') return <InformationNotes key={level} items={items} project={project} />;
          return (
            <div key={level} className="warnings-group">
              <h4>
                {LEVEL_LABELS[level]} <span className="badge">{items.length}</span>
              </h4>
              <ul className="warnings" aria-label={LEVEL_LABELS[level]}>
                {items.map((w, i) => (
                  <WarningItem key={`${w.code}-${w.subjectId ?? ''}-${i}`} warning={w} project={project} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  const shown = max !== undefined ? all.slice(0, max) : all;
  const more = all.length - shown.length;
  return (
    <div className="warnings-flat">
      <ul className="warnings" aria-label="Warnings">
        {shown.map((w, i) => (
          <WarningItem key={`${w.code}-${w.subjectId ?? ''}-${i}`} warning={w} project={project} />
        ))}
      </ul>
      {more > 0 ? (
        onShowMore ? (
          <button type="button" className="link small" onClick={onShowMore}>
            {more} more…
          </button>
        ) : (
          <p className="muted small">{more} more…</p>
        )
      ) : null}
    </div>
  );
}

/** Keep background assumptions available without pushing the actual plan below a wall of notes. */
function InformationNotes({ items, project }: { items: Warning[]; project: Project }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let wasOpen: boolean | undefined;
    const beforePrint = () => {
      const details = detailsRef.current;
      if (!details || wasOpen !== undefined) return;
      wasOpen = details.open;
      details.open = true;
    };
    const afterPrint = () => {
      if (detailsRef.current && wasOpen !== undefined) detailsRef.current.open = wasOpen;
      wasOpen = undefined;
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, []);
  return (
    <details className="warnings-notes" ref={detailsRef}>
      <summary><span>Notes</span> ({items.length}) <span className="muted small">— planning assumptions and advice</span></summary>
      <ul className="warnings" aria-label="Notes">
        {items.map((warning, index) => <WarningItem key={`${warning.code}-${warning.subjectId ?? ''}-${index}`} warning={warning} project={project} />)}
      </ul>
    </details>
  );
}
