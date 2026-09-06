import { useProjectStore } from '@store/projectStore';
import { shapeToPolygon, polygonAreaM2 } from '@engine/geometry';
import { formatArea } from '@ui/components/inputs';

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const addRoom = useProjectStore((s) => s.addRoom);
  const addStaircase = useProjectStore((s) => s.addStaircase);
  const addProduct = useProjectStore((s) => s.addProduct);

  const go = (sel: typeof selection, tab: 'rooms' | 'floorplan' | 'materials' = 'rooms') => {
    select(sel);
    setTab(tab);
  };

  return (
    <div className="stack">
      <div>
        <div className="section-header">
          <h3>Rooms</h3>
          <button onClick={() => addRoom()}>+ Room</button>
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
              <li key={r.id} aria-selected={selection.kind === 'room' && selection.id === r.id} onClick={() => go({ kind: 'room', id: r.id })}>
                <span>
                  {r.name}
                  <div className="meta">
                    {formatArea(area, project.displayUnit)} · {product?.name ?? 'no product'}
                  </div>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Stairs</h3>
          <button onClick={() => addStaircase()}>+ Stairs</button>
        </div>
        <ul className="list">
          {project.staircases.map((s) => (
            <li key={s.id} aria-selected={selection.kind === 'staircase' && selection.id === s.id} onClick={() => go({ kind: 'staircase', id: s.id })}>
              <span>
                {s.name}
                <div className="meta">
                  {s.steps.length} risers · {s.method === 'waterfall' ? 'waterfall' : 'cap & band'}
                </div>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Products</h3>
          <button
            onClick={() => {
              const id = addProduct({ name: 'New carpet', kind: 'carpet', rollWidth: 4000, alternativeRollWidths: [5000], cutIncrement: 100, maxRollLength: 30000, thickness: 10 });
              go({ kind: 'product', id }, 'materials');
            }}
          >
            + Product
          </button>
        </div>
        <ul className="list">
          {project.products.map((p) => (
            <li key={p.id} aria-selected={selection.kind === 'product' && selection.id === p.id} onClick={() => go({ kind: 'product', id: p.id }, 'materials')}>
              <span>
                {p.name}
                <div className="meta">{'rollWidth' in p ? `${p.kind.replace('_', ' ')} · ${(p.rollWidth / 1000).toFixed(1)} m roll` : `${p.kind.replace('_', ' ')} · ${p.packCoverageM2} m²/pack`}</div>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="section-header">
          <h3>Floor plans</h3>
          <button onClick={() => setTab('floorplan')}>Upload</button>
        </div>
        <ul className="list">
          {project.floorPlans.map((f) => (
            <li key={f.id} aria-selected={selection.kind === 'floorplan' && selection.id === f.id} onClick={() => go({ kind: 'floorplan', id: f.id }, 'floorplan')}>
              <span>
                {f.name}
                <div className="meta">{f.mmPerPx ? 'calibrated' : 'needs scale'}</div>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
