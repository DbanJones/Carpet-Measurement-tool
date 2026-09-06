import { useRef, useState } from 'react';
import { useProjectStore, type Tab } from '@store/projectStore';
import { serializeProject, parseProject } from '@engine/serialize';
import { sampleProject } from '@engine/fixtures';
import type { Project } from '@engine/types';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rooms', label: 'Rooms & stairs' },
  { id: 'floorplan', label: 'Floor plan' },
  { id: 'materials', label: 'Materials & options' },
  { id: 'results', label: 'Estimate' },
];

/** True when the project holds work that would be lost by replacing it. */
export function hasContent(p: Project): boolean {
  return p.rooms.length > 0 || p.staircases.length > 0 || p.floorPlans.length > 0;
}

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const tab = useProjectStore((s) => s.tab);
  const setTab = useProjectStore((s) => s.setTab);
  const updateProject = useProjectStore((s) => s.updateProject);
  const setProject = useProjectStore((s) => s.setProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  /** Every action that REPLACES the whole project asks first — there is no undo. */
  const confirmReplace = (what: string) => !hasContent(project) || window.confirm(`${what} The current project is discarded unless you have saved it.`);

  const download = () => {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.flooring.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const load = async (file: File) => {
    const text = await file.text();
    const res = parseProject(text);
    if ('error' in res) {
      alert(`Could not load project: ${res.error}`);
      return;
    }
    if (!confirmReplace(`Replace the current project with "${file.name}"?`)) return;
    // A file written by an older version, or with something the parser had to repair, must say so on
    // screen: it loads looking complete and the fitter has no other way to know what changed.
    setLoadWarnings(res.warnings);
    setProject(res.project);
  };
  const loadExample = () => {
    if (!confirmReplace('Replace the current project with the example house?')) return;
    setLoadWarnings([]);
    setProject(sampleProject());
  };
  /** Print always produces the full estimate, so switch to it first. */
  const print = () => {
    if (tab !== 'results') {
      setTab('results');
      requestAnimationFrame(() => window.print());
      return;
    }
    window.print();
  };

  return (
    <>
      <header className="topbar no-print">
        <h1 className="topbar-title">
          <span className="sr-only">Flooring estimator — project name</span>
          <input className="project-name" aria-label="Project name" value={project.name} onChange={(e) => updateProject({ name: e.target.value })} />
        </h1>
        {/* Plain navigation buttons, not an ARIA tablist: a tablist promises arrow-key movement and
            labelled panels, and announcing "tab 1 of 4" when Tab is the only way to move is worse
            than saying nothing. aria-current marks the page being shown. */}
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <label className="row small">
          Units
          <select value={project.displayUnit} onChange={(e) => updateProject({ displayUnit: e.target.value as 'metric' | 'imperial' })}>
            <option value="metric">metres</option>
            <option value="imperial">feet &amp; inches</option>
          </select>
        </label>
        <button type="button" onClick={download}>
          Save file
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Load file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={loadExample}>
          Load example house
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (confirmReplace('Start a new empty project?')) resetProject();
          }}
        >
          New
        </button>
        <button type="button" onClick={print}>
          Print
        </button>
      </header>
      {loadWarnings.length > 0 ? (
        <div className="load-warnings no-print" role="alert">
          <div className="warning">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                The file loaded with {loadWarnings.length} change{loadWarnings.length === 1 ? '' : 's'}:
              </strong>
              <button type="button" className="link" onClick={() => setLoadWarnings([])}>
                Dismiss
              </button>
            </div>
            <ul>
              {loadWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
