import { useRef } from 'react';
import { useProjectStore, type Tab } from '@store/projectStore';
import { serializeProject, parseProject } from '@engine/serialize';
import { sampleProject } from '@engine/fixtures';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rooms', label: 'Rooms & stairs' },
  { id: 'floorplan', label: 'Floor plan' },
  { id: 'materials', label: 'Materials & options' },
  { id: 'results', label: 'Estimate' },
];

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const tab = useProjectStore((s) => s.tab);
  const setTab = useProjectStore((s) => s.setTab);
  const updateProject = useProjectStore((s) => s.updateProject);
  const setProject = useProjectStore((s) => s.setProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (res.warnings.length) console.warn(res.warnings);
    setProject(res.project);
  };

  return (
    <header className="topbar no-print">
      <input
        className="project-name"
        aria-label="Project name"
        value={project.name}
        onChange={(e) => updateProject({ name: e.target.value })}
      />
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
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
      <button onClick={download}>Save file</button>
      <button onClick={() => fileRef.current?.click()}>Load file</button>
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
      <button onClick={() => setProject(sampleProject())}>Load example house</button>
      <button className="danger" onClick={() => confirm('Start a new empty project? The current one is discarded unless saved.') && resetProject()}>
        New
      </button>
      <button onClick={() => window.print()}>Print</button>
    </header>
  );
}
