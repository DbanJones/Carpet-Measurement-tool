import { useProjectStore } from '@store/projectStore';
import { TopBar } from './layout/TopBar';
import { Sidebar } from './layout/Sidebar';
import { RoomEditor } from './rooms/RoomEditor';
import { StairsEditor } from './stairs/StairsEditor';
import { FloorPlanPanel } from './floorplan/FloorPlanPanel';
import { MaterialsPanel } from './materials/MaterialsPanel';
import { ResultsPanel } from './results/ResultsPanel';
import { ProductEditor } from './materials/ProductEditor';
import { SettingsPanel } from './materials/SettingsPanel';
import { MobileSpaceSwitcher, ProjectOverview } from './layout/ProjectOverview';
import { GuidedSetupProgress } from './setup/GuidedSetup';

/**
 * Layout: top bar (project, units, save/load, tabs) / sidebar (rooms, stairs, products, plans) /
 * main editor (depends on the tab and selection) / results column on editing screens.
 * Floor plans use the full workspace for the drawing and its contextual task panel.
 */
export function App() {
  const tab = useProjectStore((s) => s.tab);
  const selection = useProjectStore((s) => s.selection);
  const projectId = useProjectStore((s) => s.project.id);
  const stairsWorkspace = tab === 'rooms' && selection.kind === 'staircase';
  const roomWorkspace = tab === 'rooms' && selection.kind === 'room';

  let main: JSX.Element;
  if (tab === 'floorplan') main = <FloorPlanPanel key={projectId} />;
  else if (tab === 'materials') main = <MaterialsPanel key={projectId} />;
  else if (tab === 'settings') main = <SettingsPanel key={projectId} />;
  else if (tab === 'results') main = <ResultsPanel expanded />;
  else if (selection.kind === 'room') main = <RoomEditor roomId={selection.id} />;
  else if (selection.kind === 'staircase') main = <StairsEditor staircaseId={selection.id} />;
  else if (selection.kind === 'product') main = <ProductEditor productId={selection.id} />;
  else main = <ProjectOverview />;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the editor
      </a>
      <TopBar />
      {/* `layout-results` replaces a `:has()` selector in the print rules: browsers without `:has()`
          printed a blank page from the Estimate tab. */}
      <div className={tab === 'results' ? 'layout layout-results' : tab === 'floorplan' ? 'layout layout-floorplan' : tab === 'materials' || tab === 'settings' ? 'layout layout-materials' : stairsWorkspace ? 'layout layout-stairs' : roomWorkspace ? 'layout layout-rooms' : 'layout'}>
        {tab !== 'floorplan' && tab !== 'materials' && tab !== 'settings' ? <aside className="panel sidebar-column no-print" aria-label="Project contents">
          <Sidebar />
        </aside> : null}
        <main className="main-column" id="main" tabIndex={-1}>
          <MobileSpaceSwitcher />
          <GuidedSetupProgress />
          {main}
        </main>
        {tab !== 'results' && tab !== 'floorplan' && tab !== 'materials' && tab !== 'settings' ? (
          <aside className="panel results-column" aria-label="Running estimate">
            <ResultsPanel />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
