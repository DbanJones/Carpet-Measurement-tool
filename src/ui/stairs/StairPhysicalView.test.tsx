import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeSteps } from '@store/projectStore';
import type { Staircase, StairLayout } from '@engine/types';
import { applyWinderLayout } from './stairLayout';
import { DEFAULT_STAIR_ORBIT, isStairPointVisible, layoutStairLabels, normaliseStairOrbit, physicalStairFaces, projectStairPoint, raisedStairSurfaces } from './stairPhysicalGeometry';
import { StairPhysicalView } from './StairPhysicalView';

const stairs = (): Staircase => ({ id: 'stairs', name: 'Main stairs', productId: 'carpet', steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' });
const returning = (): Staircase => {
  const layout: StairLayout = { kind: 'half_turn', direction: 'right', turnStartIndex: 5, turnSteps: 3 };
  return applyWinderLayout(stairs(), layout, 600, 100);
};

afterEach(cleanup);

describe('physical staircase projection', () => {
  it('keeps the upper flight returning in the side view instead of unfolding it', () => {
    const source = returning();
    source.steps[0]!.rise = 185;
    source.steps[12]!.rise = 205;
    const { surfaces, totalRise } = raisedStairSurfaces(source);
    const lower = surfaces[0]!; const beforeLast = surfaces.at(-2)!; const upper = surfaces.at(-1)!;
    expect(lower.elevation).toBe(185);
    expect(totalRise).toBe(source.steps.reduce((sum, step) => sum + step.rise, 0));
    expect(upper.elevation).toBe(totalRise);
    expect(projectStairPoint(upper.centre, 'side').x).toBeLessThan(projectStairPoint(beforeLast.centre, 'side').x);
    expect(projectStairPoint(upper.centre, 'side').y).toBeLessThan(projectStairPoint(beforeLast.centre, 'side').y);
    expect(upper.centre.x).toBeGreaterThan(lower.centre.x);
    expect(upper.lowerElevation).toBe(totalRise - 205);
  });

  it('uses the recorded landing sequence height, including a lower floor landing and full top landing', () => {
    const source = stairs();
    source.landings = [
      { id: 'bottom', kind: 'top', width: 1000, length: 1400, afterStepIndex: -1 },
      { id: 'middle', kind: 'half', width: 1720, length: 1000, afterStepIndex: 5 },
      { id: 'top', kind: 'top', width: 2000, length: 2200, afterStepIndex: 99 },
    ];
    const result = raisedStairSurfaces(source);
    expect(result.surfaces.find(surface => surface.id === 'bottom')!.elevation).toBe(0);
    expect(result.surfaces.find(surface => surface.id === 'middle')!.elevation).toBe(1200);
    const top = result.surfaces.find(surface => surface.id === 'top')!;
    expect(top.elevation).toBe(result.totalRise);
    expect(top.points).toHaveLength(4);
    expect(top.lowerElevation).toBe(top.elevation);
  });

  it('paints visible surfaces in depth order and limits edge faces to each actual riser', () => {
    const source = returning();
    const { surfaces } = raisedStairSurfaces(source);
    for (const view of ['side', 'front', '3d'] as const) {
      const faces = physicalStairFaces(surfaces, view);
      expect(faces.filter(face => face.kind === 'surface')).toHaveLength(13);
      expect(faces.map(face => face.depth)).toEqual(faces.map(face => face.depth).sort((a, b) => a - b));
      for (const face of faces.filter(face => face.kind === 'edge')) {
        const step = source.steps.find(item => item.id === face.pieceId)!;
        const levels = face.points.map(point => point.z);
        expect(Math.max(...levels) - Math.min(...levels)).toBe(step.rise);
      }
      expect(faces.flatMap(face => face.points.map(point => projectStairPoint(point, view))).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
  });

  it('shows a genuinely different front and isometric projection of the same returning flight', () => {
    const { surfaces } = raisedStairSurfaces(returning());
    const first = surfaces[0]!; const last = surfaces.at(-1)!;
    expect(projectStairPoint(last.centre, 'front').x - projectStairPoint(first.centre, 'front').x).toBeGreaterThan(860);
    expect(projectStairPoint(last.centre, '3d')).not.toEqual(projectStairPoint(last.centre, 'side'));
  });

  it('elevates a hand-drawn route with multiple rounded corners using the same measured risers', () => {
    const source = stairs();
    source.drawing = { points: [{ x: 0, y: 0 }, { x: 0, y: 100, curve: true }, { x: 80, y: 100, curve: true }, { x: 80, y: 0 }] };
    const result = raisedStairSurfaces(source);
    const top = result.surfaces.at(-1)!;
    const previous = result.surfaces.at(-2)!;
    expect(top.centre.y).toBeLessThan(previous.centre.y);
    expect(top.centre.x).toBeGreaterThan(result.surfaces[0]!.centre.x);
    expect(top.elevation).toBe(2600);
    expect(result.surfaces.map(surface => surface.id)).toEqual(source.steps.map(step => step.id));
    expect(physicalStairFaces(result.surfaces, '3d').every(face => face.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)))).toBe(true);
  });

  it('orbits the same geometry through every quadrant and below the treads', () => {
    const source = returning(), snapshot = JSON.stringify(source);
    const { surfaces } = raisedStairSurfaces(source);
    for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) for (const pitch of [-89, -40, 0, 40, 89]) {
      const orbit = { yaw, pitch }, faces = physicalStairFaces(surfaces, '3d', orbit);
      expect(faces.filter(face => face.kind === (pitch < 0 ? 'underside' : 'surface'))).toHaveLength(13);
      expect(faces.filter(face => face.kind === (pitch < 0 ? 'surface' : 'underside'))).toHaveLength(0);
      expect(faces.map(face => face.depth)).toEqual(faces.map(face => face.depth).sort((a, b) => a - b));
      expect(faces.flatMap(face => face.points.map(point => projectStairPoint(point, '3d', orbit))).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
    const a = physicalStairFaces(surfaces, '3d', { yaw: 0, pitch: 30 }).filter(face => face.kind === 'edge').map(face => face.id);
    const b = physicalStairFaces(surfaces, '3d', { yaw: 180, pitch: 30 }).filter(face => face.kind === 'edge').map(face => face.id);
    expect(a).not.toEqual(b);
    expect(projectStairPoint({ x: 3, y: 7, z: 11 }, '3d', { yaw: 0, pitch: 0 })).toEqual({ x: 7, y: -11 });
    expect(normaliseStairOrbit({ yaw: 765, pitch: 120 })).toEqual({ yaw: 45, pitch: 89 });
    expect(normaliseStairOrbit({ yaw: -765, pitch: -120 })).toEqual({ yaw: -45, pitch: -89 });
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('does not label a lower tread through a covering upper flight', () => {
    const source = stairs(); source.steps = source.steps.slice(0, 2);
    const { surfaces } = raisedStairSurfaces(source);
    surfaces[1]!.points = surfaces[0]!.points.map(point => ({ ...point }));
    surfaces[1]!.centre = { ...surfaces[0]!.centre, z: surfaces[1]!.elevation };
    const orbit = { yaw: 0, pitch: 89 }, faces = physicalStairFaces(surfaces, '3d', orbit);
    expect(isStairPointVisible(surfaces[0]!.centre, surfaces[0]!.id, faces, '3d', orbit)).toBe(false);
    expect(isStairPointVisible(surfaces[1]!.centre, surfaces[1]!.id, faces, '3d', orbit)).toBe(true);
  });
});

describe('StairPhysicalView', () => {
  it('keeps selected and endpoint labels while thinning a crowded returning flight', () => {
    const candidates = Array.from({ length: 13 }, (_, index) => ({
      id: String(index), text: String(index + 1), x: index < 4 ? 90 + index * 12 : 155 + index * 3,
      y: index < 4 ? 260 - index * 25 : 145 + (index % 2) * 6,
      end: index === 0 ? 'start' as const : index === 12 ? 'top' as const : undefined,
      selected: index === 8,
    }));
    const labels = layoutStairLabels(candidates, true);
    expect(labels.get('0')!.text).toBe('1 · Start');
    expect(labels.get('12')!.text).toBe('13 · Top');
    expect(labels.get('8')!.text).toBe('9');
    expect(labels.size).toBeLessThan(10);
    const all = [...labels.values()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!; const b = all[j]!;
      const horizontalGap = Math.abs(a.x - b.x) - (a.text.length * 6 + b.text.length * 6 + 12) / 2;
      expect(horizontalGap >= 8 || Math.abs(a.y - b.y) >= 20).toBe(true);
    }
  });

  it('retains every accessible step target when visual labels are suppressed', () => {
    const source = returning();
    const { container } = render(<StairPhysicalView staircase={source} unit="metric" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(container.querySelectorAll('.stair-physical-target[role="button"]')).toHaveLength(source.steps.length);
    expect(container.querySelectorAll('.stair-physical-number.quiet').length).toBeGreaterThan(0);
    expect(screen.getByText('13 · Top')).toBeTruthy();
  });

  it('starts with a physical side view and changes viewpoint without changing the staircase', () => {
    const source = returning(); const before = JSON.stringify(source);
    render(<StairPhysicalView staircase={source} unit="metric" />);
    expect(screen.getByRole('group', { name: /Side view of physical staircase/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Side' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(screen.getByRole('group', { name: /3D view of physical staircase/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(screen.getByRole('group', { name: /Front view of physical staircase/ })).toBeTruthy();
    expect(JSON.stringify(source)).toBe(before);
  });

  it('links pointer and keyboard step selection and reflects a selection from the plan', () => {
    const source = returning(); const select = vi.fn();
    const { container, rerender } = render(<StairPhysicalView staircase={source} unit="metric" onSelect={select} />);
    fireEvent.click(container.querySelector(`[data-physical-piece="${source.steps[5]!.id}"]`)!);
    expect(select).toHaveBeenLastCalledWith(source.steps[5]!.id);
    const next = screen.getByRole('button', { name: /Step 7: winder, height/ });
    fireEvent.keyDown(next, { key: 'Enter' });
    expect(select).toHaveBeenLastCalledWith(source.steps[6]!.id);
    fireEvent.keyDown(next, { key: ' ' });
    expect(select).toHaveBeenCalledTimes(3);
    rerender(<StairPhysicalView staircase={source} unit="metric" onSelect={select} selectedId={source.steps[6]!.id} />);
    expect(screen.getByRole('button', { name: /Step 7: winder, height/ }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll(`[data-physical-piece="${source.steps[6]!.id}"].selected`).length).toBeGreaterThan(0);
    expect(screen.getByText(/Step 7: winder · 1.40 m high/)).toBeTruthy();
  });

  it('announces the convention and handles a staircase with no steps', () => {
    const source = stairs(); source.steps = [];
    render(<StairPhysicalView staircase={source} unit="metric" />);
    expect(screen.getByText('Add a riser to see the staircase.')).toBeTruthy();
    expect(screen.getByText(/The last tread represents the top landing level/)).toBeTruthy();
  });

  it('allows keyboard rotation, wheel zoom, underside presets and a complete reset without editing measurements', () => {
    const source = returning(), snapshot = JSON.stringify(source);
    const { container } = render(<StairPhysicalView staircase={source} unit="metric" />);
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    const diagram = screen.getByRole('group', { name: /3D view of physical staircase/ });
    const polygon = () => container.querySelector('[data-physical-face]')!.getAttribute('points');
    const initial = polygon();
    fireEvent.keyDown(diagram, { key: 'ArrowRight' });
    expect(Number(diagram.getAttribute('data-orbit-yaw'))).toBe(DEFAULT_STAIR_ORBIT.yaw + 10);
    expect(polygon()).not.toBe(initial);
    fireEvent.keyDown(diagram, { key: 'ArrowDown', shiftKey: true });
    expect(Number(diagram.getAttribute('data-orbit-pitch'))).toBe(DEFAULT_STAIR_ORBIT.pitch - 30);
    fireEvent.wheel(diagram, { deltaY: -150 });
    expect(Number(diagram.getAttribute('data-orbit-zoom'))).toBeGreaterThan(1);
    fireEvent.click(screen.getByText('More viewing angles'));
    fireEvent.click(screen.getByRole('button', { name: 'View from below' }));
    expect(Number(diagram.getAttribute('data-orbit-pitch'))).toBe(-60);
    expect(container.querySelectorAll('[data-physical-face="underside"]')).toHaveLength(source.steps.length);
    expect(container.querySelectorAll('[data-physical-face="surface"]')).toHaveLength(0);
    fireEvent.keyDown(diagram, { key: 'Home' });
    expect(Number(diagram.getAttribute('data-orbit-yaw'))).toBe(DEFAULT_STAIR_ORBIT.yaw);
    expect(Number(diagram.getAttribute('data-orbit-pitch'))).toBe(DEFAULT_STAIR_ORBIT.pitch);
    expect(Number(diagram.getAttribute('data-orbit-zoom'))).toBe(1);
    expect(polygon()).toBe(initial);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('highlights a group and forwards selection modifiers without rotating the camera', () => {
    const source = returning(), select = vi.fn(), selectedIds = source.steps.slice(2, 6).map(step => step.id);
    const { container } = render(<StairPhysicalView staircase={source} unit="metric" selectedIds={selectedIds} onSelect={select} />);
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(container.querySelectorAll('.stair-physical-target.selected')).toHaveLength(4);
    expect(screen.getByText('4 pieces selected in both views')).toBeTruthy();
    const target = screen.getByRole('button', { name: /Step 8: winder, height/ });
    fireEvent.keyDown(target, { key: 'Enter', shiftKey: true });
    expect(select).toHaveBeenLastCalledWith(source.steps[7]!.id, { shiftKey: true, ctrlKey: false, metaKey: false });
    expect(Number(container.querySelector('.stair-physical-svg')!.getAttribute('data-orbit-yaw'))).toBe(DEFAULT_STAIR_ORBIT.yaw);
  });
});
