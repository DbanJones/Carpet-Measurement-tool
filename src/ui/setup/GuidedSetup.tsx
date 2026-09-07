import { useProjectStore } from '@store/projectStore';
import { Field } from '@ui/components/inputs';
import { blankHousePlan } from './blankHousePlan';
import { GuidedSetupFlooring } from './GuidedSetupFlooring';
import { refreshGuidedFlooring, useGuidedSetup, type SetupPath, type SetupStage } from './GuidedSetupState';
export { startGuidedSetup, useGuidedSetup } from './GuidedSetupState';
import './setup.css';

const labels = ['Flooring', 'Starting point', 'Rooms & stairs', 'Review'];
/** Shown on real editors so the guide remains easy to return to during measurement. */
export function GuidedSetupProgress() {
  const { project, selection, tab, select, setTab } = useProjectStore();
  const session = useGuidedSetup();
  if (!session.active || session.projectId !== project.id || (tab === 'rooms' && selection.kind === 'none')) return null;
  return <div className="setup-workspace-progress"><span><strong>Guided setup</strong> · {labels[session.stage]}</span><button type="button" onClick={() => { select({ kind: 'none' }); setTab('rooms'); }}>Back to guide</button></div>;
}

export function GuidedSetup() {
  const store = useProjectStore();
  const { project } = store;
  const session = useGuidedSetup();
  const stage = session.stage;
  const setStage = (next: SetupStage) => { if (next === 0) refreshGuidedFlooring(); useGuidedSetup.setState({ stage: next }); };
  const spaces = project.rooms.length + project.staircases.length;
  const go = (path: SetupPath) => {
    useGuidedSetup.setState({ stage: 2, path });
    if (path === 'plan') store.setTab('floorplan');
    else if (path === 'sketch') store.addFloorPlan(blankHousePlan(project.floorPlans.some(p => p.sketch) ? `Floor ${project.floorPlans.filter(p => p.sketch).length + 1} sketch` : undefined));
    else { store.addRoom(); store.setTab('rooms'); }
  };
  const back = () => setStage(Math.max(0, stage - 1) as SetupStage);
  return <section className="panel guided-setup" aria-label="Guided project setup">
    <div className="setup-header"><div><div className="eyebrow">A LITTLE HELP, ONE STEP AT A TIME</div><h2>Set up your flooring job</h2></div><button type="button" className="link" onClick={() => useGuidedSetup.setState({ active: false })}>Close guide</button></div>
    <ol className="setup-steps" aria-label="Guided setup progress">{labels.map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined} className={index < stage ? 'complete' : ''}><span>{index < stage ? '✓' : index + 1}</span>{label}</li>)}</ol>
    {stage === 0 ? <GuidedSetupFlooring/> : stage === 1 ? <div className="setup-content"><h3>How would you like to measure?</h3><p>Your {project.products.length} flooring {project.products.length === 1 ? 'product is' : 'products are'} ready. Choose the flooring for the next space; you can change it in any room.</p><GuideDefaultFlooring/><div className="setup-paths">
      <button type="button" className="setup-choice" onClick={() => go('plan')}><SetupIcon kind="plan"/><strong>I have a floor plan</strong><span>Upload a PDF or image, set one known wall length, then trace rooms.</span></button>
      <button type="button" className="setup-choice" onClick={() => go('sketch')}><SetupIcon kind="sketch"/><strong>Draw a house without a plan</strong><span>Sketch rooms together on a measured grid. Enter exact sizes as you go.</span></button>
      <button type="button" className="setup-choice" onClick={() => go('measure')}><SetupIcon kind="measure"/><strong>Enter room measurements</strong><span>Start with a room’s length and width. No house drawing is required.</span></button>
    </div><div className="setup-actions"><button type="button" onClick={back}>Back</button></div></div> : stage === 2 ? <div className="setup-content"><h3>{spaces ? 'Keep building your house' : 'Add your first room or staircase'}</h3><p>Measure one space at a time. Start with a basic shape; use the diagram to refine unusual corners later.</p><GuideDefaultFlooring/>
      <div className="setup-space-list">{project.rooms.map(room => <button type="button" key={room.id} onClick={() => store.select({ kind: 'room', id: room.id })}><strong>{room.name}<small className="setup-space-product">{project.products.find(product => product.id === room.productId)?.name}</small></strong><span>Check room measurements →</span></button>)}{project.staircases.map(stair => <button type="button" key={stair.id} onClick={() => store.select({ kind: 'staircase', id: stair.id })}><strong>{stair.name}</strong><span>{stair.steps.length} risers · check stairs →</span></button>)}</div>
      <div className="setup-actions"><button type="button" onClick={() => session.path === 'measure' ? store.addRoom() : store.setTab('floorplan')}>{session.path === 'measure' ? 'Add room' : 'Draw another room'}</button><button type="button" onClick={() => store.addStaircase()}>Add stairs</button>{project.floorPlans.length ? <button type="button" onClick={() => store.setTab('floorplan')}>Continue house drawing</button> : <button type="button" onClick={() => go('sketch')}>Start a house drawing</button>}</div>
      <p className="setup-note">For stairs, use “Guide me through stairs” in the staircase editor. It explains turns and measurements with a preview before applying them.</p>
      <div className="setup-actions"><button type="button" onClick={back}>Back</button><button type="button" className="primary" disabled={!spaces} onClick={() => setStage(3)}>Review my job</button></div>
    </div> : <div className="setup-content"><h3>Your job is ready to review</h3><p>You’ve added {project.rooms.length} rooms and {project.staircases.length} staircases. Check the measurements before ordering.</p><ol className="setup-review-list"><li><strong>Check each space</strong><span>Match room sizes, turns and landing measurements to the house.</span></li><li><strong>Follow the cut plan</strong><span>See the pieces cut from each roll and which space receives them.</span></li><li><strong>Finish your estimate</strong><span>Review waste, preparation and labour, then create a client pack.</span></li></ol><div className="setup-actions"><button type="button" onClick={back}>Check rooms & stairs</button><button type="button" className="primary" onClick={() => { store.setTab('results'); }}>Open estimate & client pack</button><button type="button" className="link" onClick={() => useGuidedSetup.setState({ active: false })}>Finish guide</button></div></div>}
  </section>;
}

function SetupIcon({ kind }: { kind: SetupPath }) {
  return <svg viewBox="0 0 64 52" aria-hidden="true"><rect x="7" y="5" width="50" height="42" rx="4"/>{kind === 'plan' ? <path d="M16 37V14H46V27H33V38M38 34H46V40"/> : kind === 'sketch' ? <><path d="M18 5V47M30 5V47M42 5V47M7 17H57M7 29H57M7 41H57" className="setup-icon-grid"/><path d="M18 41V17H42V29H30V41Z"/></> : <><path d="M17 17H47V37H17ZM17 10H47M12 17V37M23 7V13M41 7V13M9 22H15M9 32H15"/></>}</svg>;
}

function GuideDefaultFlooring() {
  const { project, newSpaceProductId, setNewSpaceProduct } = useProjectStore();
  const selected = project.products.find(product => product.id === newSpaceProductId)?.id ?? project.products[0]?.id ?? '';
  return <Field label="Flooring for the next space" hint="Each room keeps its own flooring choice."><select aria-label="Guide room flooring" value={selected} onChange={event => { setNewSpaceProduct(event.target.value); useGuidedSetup.setState({ defaultProductId: event.target.value }); }}>{project.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>;
}
