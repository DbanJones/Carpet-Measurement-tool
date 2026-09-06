/**
 * Smoke test for the whole shell: the app renders the sample house end to end, with the skip link,
 * the named landmarks and the estimate column, and switching tabs does not throw.
 */
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useProjectStore } from '@store/projectStore';
import { sampleProject } from '@engine/fixtures';
import { App } from './App';

beforeEach(() => {
  useProjectStore.getState().setProject(sampleProject());
  useProjectStore.getState().setTab('rooms');
});
afterEach(cleanup);

describe('App', () => {
  it('renders the shell with named landmarks and a skip link', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: 'Skip to the editor' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('complementary', { name: 'Project contents' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Running estimate' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('opens a room from the sidebar and shows its editor', () => {
    render(<App />);
    const sidebar = within(screen.getByRole('complementary', { name: 'Project contents' }));
    // the sidebar's Rooms section comes first, so the first Lounge row is the room, not the carpet
    fireEvent.click(sidebar.getAllByRole('button', { name: /^Lounge/ })[0]!);
    expect(screen.getByRole('heading', { name: 'Lounge', level: 2 })).toBeTruthy();
  });

  it('moves between every tab without throwing', () => {
    render(<App />);
    for (const label of ['Floor plan', 'Materials & options', 'Estimate', 'Rooms & stairs']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(useProjectStore.getState().tab).toBe('rooms');
  });

  it('drops the second estimate column on the Estimate tab and marks the layout for print', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));
    expect(container.querySelector('.layout-results')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Running estimate' })).toBeNull();
  });
});
