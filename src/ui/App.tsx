import { useProjectStore } from '@store/projectStore';
import { TopBar } from './layout/TopBar';
import { Sidebar } from './layout/Sidebar';
import { RoomEditor } from './rooms/RoomEditor';
import { StairsEditor } from './stairs/StairsEditor';
import { FloorPlanPanel } from './floorplan/FloorPlanPanel';
import { MaterialsPanel } from './materials/MaterialsPanel';
import { ResultsPanel } from './results/ResultsPanel';
import { ProductEditor } from './materials/ProductEditor';

/**
 * Layout: top bar (project, units, save/load, tabs) / sidebar (rooms, stairs, products, plans) /
 * main editor (depends on the tab and selection) / results column (always visible on wide screens).
 */
export function App() {
  const tab = useProjectStore((s) => s.tab);
  const selection = useProjectStore((s) => s.selection);

  let main: JSX.Element;
  if (tab === 'floorplan') main = <FloorPlanPanel />;
  else if (tab === 'materials') main = <MaterialsPanel />;
  else if (tab === 'results') main = <ResultsPanel expanded />;
  else if (selection.kind === 'room') main = <RoomEditor roomId={selection.id} />;
  else if (selection.kind === 'staircase') main = <StairsEditor staircaseId={selection.id} />;
  else if (selection.kind === 'product') main = <ProductEditor productId={selection.id} />;
  else main = <Welcome />;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the editor
      </a>
      <TopBar />
      {/* `layout-results` replaces a `:has()` selector in the print rules: browsers without `:has()`
          printed a blank page from the Estimate tab. */}
      <div className={tab === 'results' ? 'layout layout-results' : 'layout'}>
        <aside className="panel sidebar-column no-print" aria-label="Project contents">
          <Sidebar />
        </aside>
        <main className="main-column" id="main" tabIndex={-1}>
          {main}
        </main>
        {tab !== 'results' ? (
          <aside className="panel results-column" aria-label="Running estimate">
            <ResultsPanel />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Welcome() {
  const addRoom = useProjectStore((s) => s.addRoom);
  const addStaircase = useProjectStore((s) => s.addStaircase);
  const setTab = useProjectStore((s) => s.setTab);
  return (
    <div className="panel">
      <h2>Flooring estimator</h2>
      <p className="muted">
        Add rooms by typing their dimensions, trace them from an uploaded floor plan, or add a staircase. The estimate on the right
        updates as you go: carpet or vinyl off the roll with a cutting plan and seams, underlay, gripper, door bars, floor preparation,
        stairs, wastage and a priced bill of materials.
      </p>
      <div className="row">
        <button className="primary" onClick={() => addRoom()}>
          + Add a room
        </button>
        <button onClick={() => addStaircase()}>+ Add stairs</button>
        <button onClick={() => setTab('floorplan')}>Upload a floor plan</button>
      </div>
    </div>
  );
}
