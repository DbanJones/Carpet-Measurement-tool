import { useProjectStore } from '@store/projectStore';
import { shapeToPolygon, polygonAreaM2 } from '@engine/geometry';
import { formatArea, formatLength } from '@ui/components/inputs';
import { sampleProject } from '@engine/fixtures';
import { hasContent } from './TopBar';
import { GuidedSetup, startGuidedSetup, useGuidedSetup } from '@ui/setup/GuidedSetup';
import { blankHousePlan } from '@ui/setup/blankHousePlan';

/** A useful landing page for both a new job and a restored project. */
export function ProjectOverview() {
  const { project, addRoom, addStaircase, select, setTab, setProject, newSpaceProductId } = useProjectStore();
  const guide = useGuidedSetup();
  const hasRooms = project.rooms.length + project.staircases.length > 0;
  const flooring = project.products.find((p) => p.id === newSpaceProductId) ?? project.products[0];
  const editFlooring = () => { if (flooring) select({ kind: 'product', id: flooring.id }); setTab('materials'); };
  const start = (add: () => unknown) => { add(); setTab('rooms'); };
  return (
    <div className="overview stack">
      {guide.active && guide.projectId === project.id ? <GuidedSetup/> : <section className="setup-launcher"><div><h3>A simple start, with a little guidance</h3><p>Choose flooring, add your house and check the estimate. We’ll guide you one step at a time.</p></div><button type="button" className="primary" onClick={startGuidedSetup}>{guide.projectId === project.id && guide.stage > 0 ? 'Continue guided setup' : 'Guide me through setup'}</button></section>}
      {!(guide.active && guide.projectId === project.id) ? <><section className="panel welcome-panel">
        <div className="eyebrow">YOUR FLOORING WORKSPACE</div>
        <h2>{hasRooms ? 'Pick up where you left off' : 'Start with your flooring'}</h2>
        <p className="welcome-copy">{hasRooms
          ? 'Open a space to check its measurements, or add the next part of the job.'
          : 'Choose the carpet and roll width first. Then add your measurements and see which cuts go to each room or staircase.'}</p>
        <div className="overview-flooring">
          <div><div className="eyebrow">1 · FLOORING & ROLLS</div><strong>{flooring?.name ?? 'Choose the flooring for this job'}</strong>
            <p>{flooring ? `${'rollWidth' in flooring ? `${formatLength(flooring.rollWidth, project.displayUnit)} roll` : `${flooring.packCoverageM2} m² per pack`} · Check the size and supplier price before measuring.` : 'Add your carpet, vinyl or hard flooring.'}</p>
          </div>
          <button type="button" className="primary" onClick={editFlooring}>{hasRooms ? 'Review flooring & rolls' : 'Set up flooring & rolls'}</button>
        </div>
        <div className="eyebrow">2 · MEASURE YOUR SPACES</div>
        <div className="start-actions">
          <button type="button" className="start-card" onClick={() => start(addRoom)}>
            <span className="start-symbol" aria-hidden="true">＋</span><strong>Add a room</strong><span>Enter dimensions and choose a floor covering.</span><span className="start-link" aria-hidden="true">Start measuring →</span>
          </button>
          <button type="button" className="start-card" onClick={() => setTab('floorplan')}>
            <span className="start-symbol" aria-hidden="true">▱</span><strong>Trace a floor plan</strong><span>Upload an image or PDF, set its scale and trace.</span><span className="start-link" aria-hidden="true">Upload a plan →</span>
          </button>
          <button type="button" className="start-card" onClick={() => useProjectStore.getState().addFloorPlan(blankHousePlan())}>
            <span className="start-symbol" aria-hidden="true">▦</span><strong>Draw without a floor plan</strong><span>Arrange rooms and stairs on a scaled drawing sheet.</span><span className="start-link" aria-hidden="true">Draw your house →</span>
          </button>
          <button type="button" className="start-card" onClick={() => start(addStaircase)}>
            <span className="start-symbol" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 20h6v-6h6V8h6V3"/></svg></span><strong>Add a staircase</strong><span>Measure steps, winders, runners and landings.</span><span className="start-link" aria-hidden="true">Set up stairs →</span>
          </button>
        </div>
        <p className="local-note">Saved in this browser as you work. Use <strong>Save file</strong> to keep a backup or move to another device.</p>
      </section>
      {hasRooms ? (
        <section className="panel overview-spaces">
          <div className="section-header"><h3>Your spaces</h3><span className="badge">{project.rooms.length} rooms · {project.staircases.length} stairs</span></div>
          <div className="space-grid">
            {project.rooms.map((room) => {
              let area = 0;
              try { area = polygonAreaM2(shapeToPolygon(room.shape)); } catch { /* Invalid rooms remain editable. */ }
              return <button type="button" className="space-card" key={room.id} onClick={() => select({ kind: 'room', id: room.id })}>
                <strong>{room.name || 'Untitled room'}</strong><span>{formatArea(area, project.displayUnit)} · {project.products.find((p) => p.id === room.productId)?.name ?? 'Choose a product'}</span><span className="start-link">Edit measurements →</span>
              </button>;
            })}
            {project.staircases.map((stair) => <button type="button" className="space-card" key={stair.id} onClick={() => select({ kind: 'staircase', id: stair.id })}>
              <strong>{stair.name}</strong><span>{stair.steps.length} risers · {stair.method === 'waterfall' ? 'Waterfall' : 'Cap and band'}</span><span className="start-link">Edit staircase →</span>
            </button>)}
          </div>
        </section>
      ) : (
        <section className="panel workflow-guide" aria-label="How to create an estimate">
          <h3>A straightforward path to your estimate</h3>
          <ol>
            <li><span>1</span><div><strong>Choose flooring and rolls</strong><p>Set the carpet, available roll widths and supplier price.</p></div></li>
            <li><span>2</span><div><strong>Measure your spaces</strong><p>Start with the basic dimensions. Open details for turns, openings and fitting choices.</p></div></li>
            <li><span>3</span><div><strong>Follow the cuts to each space</strong><p>Review each roll and its room or stair pieces, then check and share the estimate.</p></div></li>
          </ol>
          <button type="button" className="link" onClick={() => {
            if (hasContent(project) && !window.confirm('Replace the current project with the example house? Save a file first to keep your current work.')) return;
            setProject(sampleProject()); setTab('rooms');
          }}>Explore an example project →</button>
        </section>
      )}</> : null}
    </div>
  );
}

/** Keeps room navigation at hand when the full project sidebar moves below the editor. */
export function MobileSpaceSwitcher() {
  const { project, selection, select, addRoom, setTab, tab } = useProjectStore();
  if (tab !== 'rooms') return null;
  const value = selection.kind === 'room' || selection.kind === 'staircase' ? `${selection.kind}:${selection.id}` : '';
  return <div className="mobile-space-switcher no-print">
    <label className="field"><span className="field-label">Current space</span>
      <select aria-label="Current space" value={value} onChange={(e) => {
        const choice = e.target.value;
        if (!choice) select({ kind: 'none' });
        else if (choice.startsWith('room:')) select({ kind: 'room', id: choice.slice(5) });
        else select({ kind: 'staircase', id: choice.slice(10) });
      }}>
        <option value="">Project overview</option>
        {project.rooms.map((r) => <option key={r.id} value={`room:${r.id}`}>{r.name}</option>)}
        {project.staircases.map((s) => <option key={s.id} value={`staircase:${s.id}`}>{s.name}</option>)}
      </select>
    </label>
    <button type="button" onClick={() => { addRoom(); setTab('rooms'); }}>+ Room</button>
  </div>;
}
