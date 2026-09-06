import type { ReactNode } from 'react';
import { useProjectStore, type Selection } from '@store/projectStore';
import { shapeToPolygon, polygonAreaM2 } from '@engine/geometry';
import { formatArea, formatLength } from '@ui/components/inputs';

/**
 * One row of a sidebar list. The row IS the control: a real `<button>` so it is reachable by Tab,
 * activated by Enter and Space, and carries a focus ring — an `<li onClick>` reached none of that,
 * and `aria-selected` on a plain list item is not a supported attribute, so the current selection
 * was invisible to assistive technology as well.
 */
function ListRow({ name, meta, selected, onOpen }: { name: string; meta: ReactNode; selected: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="list-row" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
        <span className="list-row-name">{name}</span>
        <span className="meta">{meta}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const addRoom = useProjectStore((s) => s.addRoom);
  const addStaircase = useProjectStore((s) => s.addStaircase);
  const addProduct = useProjectStore((s) => s.addProduct);

  const go = (sel: Selection, tab: 'rooms' | 'floorplan' | 'materials' = 'rooms') => {
    select(sel);
    setTab(tab);
  };

  return (
    <div className="stack">
      <div>
        <div className="section-header">
          <h3>Rooms</h3>
          <button type="button" onClick={() => addRoom()}>
            + Room
          </button>
        </div>
        {project.rooms.length === 0 ? <div className="empty small">No rooms yet</div> : null}
        <ul className="list">
          {project.rooms.map((r) => {
            const product = project.products.find((p) => p.id === r.productId);
            let area = 0;
            try {
              area = polygonAreaM2(shapeToPolygon(r.shape));
            } catch {
              area = 0;
            }
            return (
              <ListRow
                key={r.id}
                name={r.name}
                meta={`${formatArea(area, project.displayUnit)} · ${product?.name ?? 'no product'}`}
                selected={selection.kind === 'room' && selection.id === r.id}
                onOpen={() => go({ kind: 'room', id: r.id })}
              />
            );
          })}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Stairs</h3>
          <button type="button" onClick={() => addStaircase()}>
            + Stairs
          </button>
        </div>
        {project.staircases.length === 0 ? <div className="empty small">No stairs yet</div> : null}
        <ul className="list">
          {project.staircases.map((s) => (
            <ListRow
              key={s.id}
              name={s.name}
              meta={`${s.steps.length} risers · ${s.method === 'waterfall' ? 'waterfall' : 'cap & band'}`}
              selected={selection.kind === 'staircase' && selection.id === s.id}
              onOpen={() => go({ kind: 'staircase', id: s.id })}
            />
          ))}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Products</h3>
          <button
            type="button"
            onClick={() => {
              const id = addProduct({ name: 'New carpet', kind: 'carpet', rollWidth: 4000, alternativeRollWidths: [5000], cutIncrement: 100, maxRollLength: 30000, thickness: 10 });
              go({ kind: 'product', id }, 'materials');
            }}
          >
            + Product
          </button>
        </div>
        {project.products.length === 0 ? <div className="empty small">No products yet</div> : null}
        <ul className="list">
          {project.products.map((p) => (
            <ListRow
              key={p.id}
              name={p.name}
              // formatLength honours the project's display unit, as the Materials list and the room's
              // product dropdown do; this used to hard-code metres and read "4.0 m roll" in feet mode.
              meta={'rollWidth' in p ? `${p.kind.replace('_', ' ')} · ${formatLength(p.rollWidth, project.displayUnit, 1)} roll` : `${p.kind.replace('_', ' ')} · ${p.packCoverageM2} m²/pack`}
              selected={selection.kind === 'product' && selection.id === p.id}
              onOpen={() => go({ kind: 'product', id: p.id }, 'materials')}
            />
          ))}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Floor plans</h3>
          <button type="button" onClick={() => setTab('floorplan')}>
            Upload
          </button>
        </div>
        {project.floorPlans.length === 0 ? <div className="empty small">No floor plans yet</div> : null}
        <ul className="list">
          {project.floorPlans.map((f) => (
            <ListRow
              key={f.id}
              name={f.name}
              meta={f.mmPerPx ? 'calibrated' : 'needs scale'}
              selected={selection.kind === 'floorplan' && selection.id === f.id}
              onOpen={() => go({ kind: 'floorplan', id: f.id }, 'floorplan')}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
