/**
 * The application shell: the top bar's destructive actions and print, and the sidebar's navigation.
 * These are the two places a mis-click used to cost a morning's measuring or leave a keyboard user
 * unable to open a room at all.
 */
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import { sampleProject } from '@engine/fixtures';
import { TopBar, hasContent } from './TopBar';
import { Sidebar } from './Sidebar';

const state = () => useProjectStore.getState();

beforeEach(() => {
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TopBar', () => {
  it('asks before replacing a project that has work in it', () => {
    state().addRoom({ name: 'Lounge' });
    render(<TopBar />);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Project actions/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Load example house' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('example house'));
    expect(state().project.rooms).toHaveLength(1);
    expect(state().project.name).toBe('Test');

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(state().project.rooms).toHaveLength(1);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Load example house' }));
    expect(state().project.id).toBe(sampleProject().id);
  });

  it('does not nag when there is nothing to lose', () => {
    useProjectStore.setState({ project: makeEmptyProject() });
    render(<TopBar />);
    const confirmSpy = vi.spyOn(window, 'confirm');
    expect(hasContent(state().project)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Project actions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Load example house' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(state().project.rooms.length).toBeGreaterThan(0);
  });

  it('switches to the Estimate tab before printing, so Print never yields a near-blank page', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return 1;
    });
    render(<TopBar />);
    expect(state().tab).toBe('rooms');
    fireEvent.click(screen.getByRole('button', { name: /Project actions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(state().tab).toBe('results');
    expect(print).not.toHaveBeenCalled();
    frames.forEach((cb) => cb(0));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('marks the current section with aria-current rather than an unimplemented tab pattern', () => {
    render(<TopBar />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).queryAllByRole('tab')).toHaveLength(0);
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Materials & options', 'Rooms & stairs', 'Floor plan', 'Estimate', 'Settings']);
    const current = within(nav)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current.map((b) => b.textContent)).toEqual(['Rooms & stairs']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Settings' }));
    expect(state().tab).toBe('settings');
    expect(within(nav).getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
  });

  it('has the page heading, so the outline does not start at h2', () => {
    render(<TopBar />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('protects project details and customised prices before any room is added', () => {
    const project = makeEmptyProject();
    project.customer = 'Alex';
    expect(hasContent(project)).toBe(true);
    const customised = makeEmptyProject();
    customised.products[0]!.pricePerM2 = 99;
    expect(hasContent(customised)).toBe(true);
  });

  it('closes the project actions with Escape', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: /Project actions/ }));
    expect(screen.getByRole('button', { name: 'Load file' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Load file' })).toBeNull();
    expect(document.activeElement?.id).toBe('project-actions-toggle');
  });
});

describe('Sidebar', () => {
  it('opens a newly added room even when starting from another section', () => {
    state().setTab('results');
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: '+ Room' }));
    expect(state().tab).toBe('rooms');
    expect(state().selection.kind).toBe('room');
  });
  it('opens a room from the keyboard: every row is a real button', () => {
    const id = state().addRoom({ name: 'Lounge' });
    state().select({ kind: 'none' });
    render(<Sidebar />);
    const row = screen.getByRole('button', { name: /Lounge/ });
    expect(row.tagName).toBe('BUTTON');
    // Enter and Space come free with a button; testing-library's click is what they dispatch
    fireEvent.click(row);
    expect(state().selection).toEqual({ kind: 'room', id });
    expect(screen.getByRole('button', { name: /Lounge/ }).getAttribute('aria-current')).toBe('true');
  });

  it('describes a roll width in the project display unit, like the rest of the app', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /Carpet \(4 m roll\)/ }).textContent).toContain('4.0 m roll');
    cleanup();
    state().updateProject({ displayUnit: 'imperial' });
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /Carpet \(4 m roll\)/ }).textContent).toContain(`13' 1"`);
  });

  it('says so when a section is empty rather than showing bare space', () => {
    render(<Sidebar />);
    expect(screen.getByText('No rooms yet')).toBeTruthy();
    expect(screen.getByText('No stairs yet')).toBeTruthy();
    expect(screen.getByText('No floor plans yet')).toBeTruthy();
  });
});
