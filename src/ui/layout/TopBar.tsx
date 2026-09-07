import { useEffect, useRef, useState } from 'react';
import { makeEmptyProject, usePersistenceStore, useProjectStore, type Tab } from '@store/projectStore';
import { serializeProject, parseProject } from '@engine/serialize';
import { sampleProject } from '@engine/fixtures';
import type { Project } from '@engine/types';

const TABS: { id: Tab; label: string }[] = [
  { id: 'materials', label: 'Materials & options' },
  { id: 'rooms', label: 'Rooms & stairs' },
  { id: 'floorplan', label: 'Floor plan' },
  { id: 'results', label: 'Estimate' },
  { id: 'settings', label: 'Settings' },
];

/** True when the project holds work that would be lost by replacing it. */
export function hasContent(p: Project): boolean {
  if (p.rooms.length > 0 || p.staircases.length > 0 || p.floorPlans.length > 0) return true;
  const { id: _id, products, ...details } = p;
  const { id: _emptyId, products: emptyProducts, ...emptyDetails } = makeEmptyProject();
  return JSON.stringify(details) !== JSON.stringify(emptyDetails)
    || JSON.stringify(products.map(({ id: _productId, ...product }) => product)) !== JSON.stringify(emptyProducts.map(({ id: _productId, ...product }) => product));
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const persistence = usePersistenceStore();
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('project-actions-toggle')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  /** Every action that REPLACES the whole project asks first — there is no undo. */
  const confirmReplace = (what: string) => !hasContent(project) || window.confirm(`${what} The current project is discarded unless you have saved it.`);

  const download = () => {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.flooring.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFileNotice('Backup download started. Keep this file to restore your project on any device.');
  };
  const load = async (file: File) => {
    setLoadError(null);
    let text: string;
    try { text = await file.text(); } catch { setLoadError('This file could not be read. Try opening it again.'); return; }
    const res = parseProject(text);
    if ('error' in res) {
      setLoadError(`Could not load project: ${res.error}`);
      return;
    }
    if (!confirmReplace(`Replace the current project with "${file.name}"?`)) return;
    // A file written by an older version, or with something the parser had to repair, must say so on
    // screen: it loads looking complete and the fitter has no other way to know what changed.
    setLoadWarnings(res.warnings);
    setProject(res.project);
    setTab('rooms');
    setFileNotice(null);
  };
  const loadExample = () => {
    if (!confirmReplace('Replace the current project with the example house?')) return;
    setLoadWarnings([]);
    setProject(sampleProject());
    setTab('rooms');
    setMenuOpen(false);
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
        <div className="brand"><svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 23V9h14v6H15v8ZM19 19h4v4h-4" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round"/></svg><h1>Flooring<span>Estimator</span></h1></div>
        <div className="project-identity">
          <input className="project-name" aria-label="Project name" value={project.name} onChange={(e) => updateProject({ name: e.target.value })} />
          <span className={`save-status ${persistence.status}`} role="status"><span aria-hidden="true" className="status-dot"/>{persistence.status === 'saved' ? 'Saved in this browser' : persistence.status === 'error' ? 'Browser save failed' : 'Local project · ready to start'}</span>
        </div>
        <div className="topbar-actions">
          <label className="row small unit-select">Units<select value={project.displayUnit} onChange={(e) => updateProject({ displayUnit: e.target.value as 'metric' | 'imperial' })}><option value="metric">metres</option><option value="imperial">feet &amp; inches</option></select></label>
          <button type="button" className="primary" onClick={download}>Save file</button>
          <div className="project-actions" ref={menuRef}>
            <button type="button" id="project-actions-toggle" aria-expanded={menuOpen} aria-controls="project-actions-panel" onClick={() => setMenuOpen(!menuOpen)}>Project actions <span aria-hidden="true">⌄</span></button>
            {menuOpen ? <div className="project-menu" id="project-actions-panel">
              <button type="button" onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}>Load file</button>
              <button type="button" onClick={loadExample}>Load example house</button>
              <button type="button" onClick={() => { print(); setMenuOpen(false); }}>Print</button>
              <button type="button" className="danger" onClick={() => {
                if (confirmReplace('Start a new empty project?')) { resetProject(); setLoadWarnings([]); setLoadError(null); setFileNotice(null); setMenuOpen(false); }
              }}>New</button>
            </div> : null}
          </div>
        </div>
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
      </header>
      {persistence.status === 'error' ? <div className="save-alert no-print" role="alert"><strong>Your latest changes are not saved in this browser.</strong> {persistence.message} <button type="button" onClick={download}>Save a backup file</button><button type="button" onClick={() => useProjectStore.getState().retrySave()}>Retry browser save</button></div> : null}
      {loadError ? <div className="save-alert no-print" role="alert">{loadError}<button type="button" onClick={() => setLoadError(null)}>Dismiss</button></div> : null}
      {fileNotice ? <div className="file-notice no-print" role="status">{fileNotice}<button type="button" className="link" onClick={() => setFileNotice(null)}>Dismiss</button></div> : null}
      {persistence.restoreWarnings.length > 0 ? <div className="save-alert no-print" role="alert"><strong>Check your restored project</strong><ul>{persistence.restoreWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><button type="button" onClick={persistence.dismissRestoreWarnings}>Dismiss restore notice</button></div> : null}
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
