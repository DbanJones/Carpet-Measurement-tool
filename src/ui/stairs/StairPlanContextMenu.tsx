import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './stair-plan-context-menu.css';

export interface StairPlanMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
}

export interface StairPlanContextMenuProps {
  /** Position in viewport pixels, usually the contextmenu event's clientX/clientY. */
  x: number;
  y: number;
  label: string;
  items: readonly StairPlanMenuItem[];
  onAction: (id: string) => void;
  onClose: () => void;
  returnFocusTo?: HTMLElement | SVGElement | null;
}

/** The caller owns selection and geometry; this menu only presents available actions. */
export function StairPlanContextMenu({ x, y, label, items, onAction, onClose, returnFocusTo }: StairPlanContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const callbacks = useRef({ onAction, onClose });
  callbacks.current = { onAction, onClose };
  const origin = useRef<HTMLElement | SVGElement | null>(returnFocusTo ?? (
    document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null
  ));
  const closed = useRef(false);
  const [focused, setFocused] = useState(items.findIndex(item => !item.disabled));
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: Math.max(1, window.innerHeight - 16) });

  const restoreFocus = () => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); };
  const close = (restore = true) => {
    if (closed.current) return;
    closed.current = true;
    if (restore) restoreFocus();
    callbacks.current.onClose();
  };
  const activate = (index: number) => {
    if (index < 0 || items[index]?.disabled) return;
    setFocused(index);
    buttons.current[index]?.focus({ preventScroll: true });
    buttons.current[index]?.scrollIntoView?.({ block: 'nearest' });
  };

  useLayoutEffect(() => {
    const place = () => {
      const bounds = menu.current?.getBoundingClientRect();
      if (!bounds) return;
      const padding = 8;
      const maxHeight = Math.max(1, window.innerHeight - padding * 2);
      const height = Math.min(bounds.height, maxHeight);
      const width = Math.min(bounds.width, Math.max(1, window.innerWidth - padding * 2));
      setPosition({
        left: Math.max(padding, Math.min(Number.isFinite(x) ? x : padding, window.innerWidth - width - padding)),
        top: Math.max(padding, Math.min(Number.isFinite(y) ? y : padding, window.innerHeight - height - padding)),
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [x, y, label, items]);

  useLayoutEffect(() => {
    closed.current = false;
    const first = items.findIndex(item => !item.disabled);
    setFocused(first);
    (buttons.current[first] ?? menu.current)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close(false);
    };
    const scrolled = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      // Also restore the trigger when a parent dismisses the menu directly.
      if (!closed.current && menu.current?.contains(document.activeElement)) restoreFocus();
    };
    // This lifecycle is intentionally tied to opening the menu, not callback identity.
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Portal events still bubble through the diagram's React tree. Menu keystrokes
    // must never trigger its Delete, arrow or shape-edit shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    const enabled = items.flatMap((item, index) => item.disabled ? [] : [index]);
    if (!enabled.length) return;
    const current = enabled.indexOf(focused);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = enabled[(current + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(current - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const ordered = [...enabled.slice(current + 1), ...enabled.slice(0, current + 1)];
      next = ordered.find(index => items[index]!.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
    }
    if (next !== undefined) { event.preventDefault(); event.stopPropagation(); activate(next); }
  };

  return createPortal(<div ref={menu} className="stair-plan-context-menu" role="menu" aria-label={label} tabIndex={-1}
    style={position} onKeyDown={keyDown} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="stair-plan-context-menu-heading" aria-hidden="true">{label}</div>
    {items.map((item, index) => <div role="none" key={item.id}>
      {item.separatorBefore && index > 0 ? <div className="stair-plan-context-menu-separator" role="separator"/> : null}
      <button ref={button => { buttons.current[index] = button; }} type="button" role="menuitem"
        className={item.danger ? 'stair-plan-context-menu-danger' : undefined}
        disabled={item.disabled} aria-disabled={item.disabled || undefined} tabIndex={focused === index ? 0 : -1}
        onFocus={() => setFocused(index)} onClick={() => { if (!item.disabled && !closed.current) { close(); callbacks.current.onAction(item.id); } }}>
        <span>{item.label}</span>{item.shortcut ? <span className="stair-plan-context-menu-shortcut" aria-hidden="true">{item.shortcut}</span> : null}
      </button>
    </div>)}
  </div>, document.body);
}
