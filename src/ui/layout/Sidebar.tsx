import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useProjectStore, type Selection } from '@store/projectStore';
import { shapeToPolygon, polygonAreaM2 } from '@engine/geometry';
import { formatArea, formatLength } from '@ui/components/inputs';
import './sidebar-organising.css';

type SidebarItem = { id: string; name: string; meta: ReactNode; selected: boolean; onOpen: () => void };

/** Navigation remains a real button, separate from its drag handle and actions. */
function ListRow({ name, meta, selected, onOpen, nameId }: Omit<SidebarItem, 'id'> & { nameId?: string }) {
  return <button type="button" className="list-row" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
    <span className="list-row-name" id={nameId}>{name}</span><span className="meta">{meta}</span>
  </button>;
}

type Drag = { id: string; x: number; y: number; active: boolean; target: string | null; after: boolean };

function ActionIcon({ kind }: { kind: 'more' | 'up' | 'down' | 'rename' | 'delete' }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'more' ? <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></> : kind === 'up' ? <path d="M12 19V5m-6 6 6-6 6 6"/> : kind === 'down' ? <path d="M12 5v14m-6-6 6 6 6-6"/> : kind === 'rename' ? <path d="m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14v5ZM12 20h8"/> : <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>}
  </svg>;
}

function OrganisedList({ items, label, kind, onMove, onRemove, onRename, removalNote }: {
  items: SidebarItem[]; label: string; kind: string;
  onMove: (id: string, toIndex: number) => void; onRemove: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  removalNote?: (id: string) => string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const instructionsId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    if (!openId) return;
    const outside = (event: globalThis.PointerEvent) => {
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-sidebar-item]') ?? [])].find(row => row.dataset.sidebarItem === openId);
      if (!row?.contains(event.target as Node)) { setOpenId(null); setConfirmId(null); setRenaming(null); }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [openId]);

  const updateDrag = (next: Drag | null) => { dragRef.current = next; setDrag(next); };
  const move = (id: string, index: number) => {
    const item = items.find(item => item.id === id);
    if (!item || index < 0 || index >= items.length) return;
    onMove(id, index);
    setAnnouncement(`${item.name} moved to position ${index + 1} of ${items.length}.`);
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || items.length < 2) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setOpenId(null); setConfirmId(null);
    updateDrag({ id, x: event.clientX, y: event.clientY, active: false, target: id, after: false });
  };
  const dragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    const list = listRef.current;
    if (!current || !list) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    const bounds = list.getBoundingClientRect();
    // A room can only move within Rooms; releasing outside its list cancels the move.
    if (event.clientX < bounds.left - 25 || event.clientX > bounds.right + 25 || event.clientY < bounds.top - 25 || event.clientY > bounds.bottom + 25) {
      updateDrag({ ...current, active: true, target: null }); return;
    }
    const rows = [...list.querySelectorAll<HTMLElement>('[data-sidebar-item]')];
    let target = rows[rows.length - 1];
    for (const row of rows) { if (event.clientY <= row.getBoundingClientRect().bottom) { target = row; break; } }
    if (!target) return;
    const targetBounds = target.getBoundingClientRect();
    updateDrag({ ...current, active: true, target: target.dataset.sidebarItem!, after: event.clientY > targetBounds.top + targetBounds.height / 2 });
    if (event.clientY < 60) window.scrollBy(0, -12);
    else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
  };
  const finish = () => {
    const current = dragRef.current;
    updateDrag(null);
    if (!current?.active || !current.target) return;
    const from = items.findIndex(item => item.id === current.id);
    const target = items.findIndex(item => item.id === current.target);
    if (from < 0 || target < 0) return;
    const insertion = target + (current.after ? 1 : 0);
    const index = insertion - (from < insertion ? 1 : 0);
    if (index !== from) move(current.id, index);
  };
  const closeActions = (id: string) => {
    setOpenId(null); setConfirmId(null); setRenaming(null);
    listRef.current?.querySelectorAll<HTMLElement>('[data-sidebar-item]').forEach(row => {
      if (row.dataset.sidebarItem === id) row.querySelector<HTMLButtonElement>('.sidebar-actions-toggle')?.focus();
    });
  };
  const remove = (item: SidebarItem, index: number) => {
    onRemove(item.id);
    setOpenId(null); setConfirmId(null);
    setAnnouncement(`${item.name} deleted.`);
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLButtonElement>('.list-row');
      const next = rows?.[Math.min(index, rows.length - 1)];
      if (next) next.focus();
      else listRef.current?.parentElement?.querySelector<HTMLButtonElement>('.section-header > button')?.focus();
    });
  };

  return <>
    <span id={instructionsId} className="sidebar-sr-only">Drag the handle to reorder. When the handle is focused, use the up and down arrow keys. Escape cancels a drag.</span>
    <ul className="list sidebar-organised-list" aria-label={label} ref={listRef}>
      {items.map((item, index) => <li key={item.id} data-sidebar-item={item.id}
        className={`${drag?.active && drag.id === item.id ? 'sidebar-dragging' : ''} ${drag?.active && drag.target === item.id ? (drag.after ? 'sidebar-drop-after' : 'sidebar-drop-before') : ''}`}>
        <div className="sidebar-row-controls">
          <button type="button" className="sidebar-drag-handle" aria-label={`Reorder ${kind} ${index + 1}`}
            aria-describedby={`${instructionsId}-${item.id} ${instructionsId}`} title={`Drag to reorder ${item.name}, or use arrow keys`} disabled={items.length < 2}
            onPointerDown={event => begin(event, item.id)} onPointerMove={dragMove} onPointerUp={finish}
            onPointerCancel={() => updateDrag(null)} onLostPointerCapture={() => updateDrag(null)}
            onKeyDown={event => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault(); move(item.id, index + (event.key === 'ArrowUp' ? -1 : 1));
              } else if (event.key === 'Escape') { updateDrag(null); setAnnouncement('Reorder cancelled.'); }
            }}>
            <svg viewBox="0 0 16 24" width="12" height="18" aria-hidden="true"><path d="M5 5h.01M11 5h.01M5 12h.01M11 12h.01M5 19h.01M11 19h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          </button>
          <ListRow {...item} nameId={`${instructionsId}-${item.id}`} />
          <button type="button" className="sidebar-actions-toggle" aria-label={`${kind[0]!.toUpperCase()}${kind.slice(1)} ${index + 1} actions`}
            title={`Actions for ${item.name}`} aria-describedby={`${instructionsId}-${item.id}`} aria-expanded={openId === item.id} aria-controls={openId === item.id ? `${instructionsId}-actions-${item.id}` : undefined}
            onKeyDown={event => { if (event.key === 'Escape') closeActions(item.id); }}
            onClick={() => { setOpenId(openId === item.id ? null : item.id); setConfirmId(null); setRenaming(null); }}>
            <ActionIcon kind="more"/>
          </button>
        </div>
        {openId === item.id && <div className="sidebar-item-actions" role="group" id={`${instructionsId}-actions-${item.id}`} aria-label={`Actions for ${item.name}`}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeActions(item.id); } }}>
          {confirmId === item.id ? <>
            <p>Delete <strong>{item.name}</strong>?</p>
            <p className="sidebar-removal-note">{removalNote?.(item.id) ?? 'Its measurements and estimate will be removed from this project.'}</p>
            <div className="sidebar-confirm-actions"><button type="button" autoFocus onClick={() => closeActions(item.id)}>Cancel</button><button type="button" className="danger" onClick={() => remove(item, index)}>Confirm deletion</button></div>
          </> : renaming?.id === item.id ? <form className="sidebar-rename-form" onSubmit={event => { event.preventDefault(); if (renaming.value.trim()) { onRename?.(item.id, renaming.value.trim()); closeActions(item.id); setAnnouncement(`${item.name} renamed to ${renaming.value.trim()}.`); } }}>
            <label htmlFor={`${instructionsId}-rename`}>Floor plan name</label><input id={`${instructionsId}-rename`} autoFocus onFocus={event => event.target.select()} value={renaming.value} maxLength={120} onChange={event => setRenaming({ id: item.id, value: event.target.value })}/>
            <div className="sidebar-confirm-actions"><button type="button" onClick={() => closeActions(item.id)}>Cancel</button><button type="submit" disabled={!renaming.value.trim()}>Save name</button></div>
          </form> : <>
            <span className="sidebar-actions-caption">{item.name}</span>
            {onRename && <button type="button" className="sidebar-menu-action" onClick={() => setRenaming({ id: item.id, value: item.name })}><ActionIcon kind="rename"/>Rename {kind}</button>}
            <div className="sidebar-move-actions"><button type="button" disabled={index === 0} onClick={() => move(item.id, index - 1)}><ActionIcon kind="up"/>Move up</button><button type="button" disabled={index === items.length - 1} onClick={() => move(item.id, index + 1)}><ActionIcon kind="down"/>Move down</button></div>
            <button type="button" className="danger sidebar-delete-action" onClick={() => setConfirmId(item.id)}><ActionIcon kind="delete"/>Delete {kind}</button>
          </>}
        </div>}
      </li>)}
    </ul>
    <span role="status" className="sidebar-sr-only">{announcement}</span>
  </>;
}

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const tab = useProjectStore((s) => s.tab);
  const select = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const addRoom = useProjectStore((s) => s.addRoom);
  const addStaircase = useProjectStore((s) => s.addStaircase);
  const addProduct = useProjectStore((s) => s.addProduct);
  const reorderRoom = useProjectStore((s) => s.reorderRoom);
  const reorderStaircase = useProjectStore((s) => s.reorderStaircase);
  const reorderProduct = useProjectStore((s) => s.reorderProduct);
  const removeRoom = useProjectStore((s) => s.removeRoom);
  const removeStaircase = useProjectStore((s) => s.removeStaircase);
  const removeProduct = useProjectStore((s) => s.removeProduct);
  const reorderFloorPlan = useProjectStore((s) => s.reorderFloorPlan);
  const updateFloorPlan = useProjectStore((s) => s.updateFloorPlan);
  const removeFloorPlan = useProjectStore((s) => s.removeFloorPlan);

  const go = (sel: Selection, tab: 'rooms' | 'floorplan' | 'materials' = 'rooms') => { select(sel); setTab(tab); };
  const productRemovalNote = (id: string) => {
    const count = project.rooms.filter(room => room.productId === id).length + project.staircases.filter(stairs => stairs.productId === id).length;
    if (!count) return 'This product is not assigned to any rooms or stairs.';
    const fallback = project.products.find(product => product.id !== id);
    return fallback
      ? `${count} ${count === 1 ? 'space will' : 'spaces will'} switch to ${fallback.name}. You can change the product for each space afterwards.`
      : `${count} ${count === 1 ? 'space will' : 'spaces will'} be left without a product. Add and assign a product to include them in the material estimate.`;
  };

  return <div className="stack sidebar-organising">
    <button type="button" className="overview-button" aria-current={tab === 'rooms' && selection.kind === 'none' ? 'page' : undefined} onClick={() => go({ kind: 'none' })}>Project overview <span aria-hidden="true">↗</span></button>
    <div>
      <div className="section-header"><h3>Rooms</h3><button type="button" onClick={() => { addRoom(); setTab('rooms'); }}>+ Room</button></div>
      {project.rooms.length === 0 && <div className="empty small">No rooms yet</div>}
      <OrganisedList label="Rooms" kind="room" onMove={reorderRoom} onRemove={removeRoom} items={project.rooms.map(room => {
        const product = project.products.find(product => product.id === room.productId);
        let area = 0; try { area = polygonAreaM2(shapeToPolygon(room.shape)); } catch { /* Incomplete measurements. */ }
        return { id: room.id, name: room.name, meta: `${formatArea(area, project.displayUnit)} · ${product?.name ?? 'no product'}`,
          selected: tab === 'rooms' && selection.kind === 'room' && selection.id === room.id, onOpen: () => go({ kind: 'room', id: room.id }) };
      })} />
    </div>
    <div>
      <div className="section-header"><h3>Stairs</h3><button type="button" onClick={() => { addStaircase(); setTab('rooms'); }}>+ Stairs</button></div>
      {project.staircases.length === 0 && <div className="empty small">No stairs yet</div>}
      <OrganisedList label="Stairs" kind="staircase" onMove={reorderStaircase} onRemove={removeStaircase} items={project.staircases.map(stairs => ({
        id: stairs.id, name: stairs.name, meta: `${stairs.steps.length} risers · ${stairs.method === 'waterfall' ? 'waterfall' : 'cap & band'}`,
        selected: tab === 'rooms' && selection.kind === 'staircase' && selection.id === stairs.id, onOpen: () => go({ kind: 'staircase', id: stairs.id }),
      }))} />
    </div>
    <div>
      <div className="section-header"><h3>Products</h3><button type="button" onClick={() => {
        const id = addProduct({ name: 'New carpet', kind: 'carpet', rollWidth: 4000, alternativeRollWidths: [5000], cutIncrement: 100, maxRollLength: 30000, thickness: 10 });
        go({ kind: 'product', id }, 'materials');
      }}>+ Product</button></div>
      {project.products.length === 0 && <div className="empty small">No products yet</div>}
      <OrganisedList label="Products" kind="product" onMove={reorderProduct} onRemove={removeProduct} removalNote={productRemovalNote} items={project.products.map(product => ({
        id: product.id, name: product.name,
        meta: 'rollWidth' in product ? `${product.kind.replace('_', ' ')} · ${formatLength(product.rollWidth, project.displayUnit, 1)} roll` : `${product.kind.replace('_', ' ')} · ${product.packCoverageM2} m²/pack`,
        selected: tab === 'materials' && selection.kind === 'product' && selection.id === product.id, onOpen: () => go({ kind: 'product', id: product.id }, 'materials'),
      }))} />
    </div>
    <div>
      <div className="section-header"><h3>Floor plans</h3><button type="button" onClick={() => setTab('floorplan')}>Upload</button></div>
      {project.floorPlans.length === 0 && <div className="empty small">No floor plans yet</div>}
      <OrganisedList label="Floor plans" kind="floor plan" onMove={reorderFloorPlan} onRemove={removeFloorPlan} onRename={(id, name) => updateFloorPlan(id, { name })}
        removalNote={() => 'The drawing and its scale will be removed. Rooms, stairs and their measurements stay in the project; their links to this plan will be cleared.'}
        items={project.floorPlans.map(plan => ({ id: plan.id, name: plan.name, meta: plan.mmPerPx ? 'calibrated' : 'needs scale',
          selected: tab === 'floorplan' && selection.kind === 'floorplan' && selection.id === plan.id, onOpen: () => go({ kind: 'floorplan', id: plan.id }, 'floorplan'),
        }))}/>
    </div>
  </div>;
}
