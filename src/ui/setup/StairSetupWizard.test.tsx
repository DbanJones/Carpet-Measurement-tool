import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeEmptyProject, useProjectStore } from '@store/projectStore';
import { StairSetupWizard } from './StairSetupWizard';
import { stairPlanGeometry } from '@ui/stairs/stairLayout';
import type { Staircase } from '@engine/types';

beforeEach(() => { useProjectStore.setState({ project: makeEmptyProject('House'), selection: { kind: 'none' }, newSpaceProductId: null }); });
afterEach(cleanup);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const number = (name: string, value: string) => { const input = screen.getByLabelText(name); fireEvent.change(input, { target: { value } }); fireEvent.blur(input); };
const setup = () => { const id = useProjectStore.getState().addStaircase({ name: 'Hall stairs', notes: 'Keep this note', source: { floorPlanId: 'plan', pixelPolygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 0, y: 80 }] } }); const staircase = useProjectStore.getState().project.staircases.find(s => s.id === id)!; const onApply = vi.fn(), onCancel = vi.fn(); render(<StairSetupWizard staircase={staircase} unit="metric" onApply={onApply} onCancel={onCancel}/>); return { staircase, onApply, onCancel }; };

describe('staircase assistant', () => {
  it('stops at an invalid measurement and matches the preview turn defaults', () => {
    setup(); click(/Custom turn Set your own angle/); click('Continue');
    expect((screen.getByLabelText('Guide turning steps') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Guide steps before turn') as HTMLInputElement).value).toBe('2');
    click('Continue'); number('Guide step rise', 'unknown'); click('Continue');
    expect(screen.getByText('Check three starting measurements')).toBeTruthy();
    expect(screen.getByLabelText('Guide step rise').getAttribute('aria-invalid')).toBe('true');
  });
  it('keeps the staircase untouched through the guide and applies a measured L with a landing at the end', () => {
    const { staircase, onApply } = setup();
    const original = structuredClone(staircase);
    number('Guide riser count', '14'); click(/L-shaped Quarter turn/); click('Continue'); click(/A flat landing/); click(/Turn left/); click('Continue');
    number('Guide stair width', '0.9'); number('Guide step rise', '0.19'); number('Guide tread depth', '0.25');
    click('Continue');
    expect(onApply).not.toHaveBeenCalled(); expect(staircase).toEqual(original);
    expect(screen.getByRole('img', { name: 'Stair guide top-down preview' })).toBeTruthy();
    click('Apply this staircase');
    const result = onApply.mock.calls[0]![0] as Staircase;
    expect(result).toMatchObject({ id: staircase.id, productId: staircase.productId, source: staircase.source, notes: 'Keep this note', layout: { kind: 'quarter_turn', direction: 'left' } });
    expect(result.steps).toHaveLength(14);
    expect(result.steps.every(step => step.rise === 190 && step.width === 900)).toBe(true);
    expect(result.landings.some(landing => landing.kind === 'quarter')).toBe(true);
    expect(stairPlanGeometry(result).pieces.length).toBeGreaterThan(14);
  });

  it('skips the turn questions for a straight flight and cancellation changes nothing', () => {
    const { onApply, onCancel } = setup(); click('Continue');
    expect(screen.getByText('Check three starting measurements')).toBeTruthy();
    expect(screen.queryByText('How do the steps go around the turn?')).toBeNull();
    number('Guide step rise', '0.17'); click('Cancel stair guide');
    expect(onCancel).toHaveBeenCalledOnce(); expect(onApply).not.toHaveBeenCalled();
  });

  it('previews both square and rounded corners on a curving flight', () => {
    const { onApply } = setup(); click(/Custom turn Set your own angle/); click('Continue');
    const square = screen.getByRole('img', { name: 'Stair guide top-down preview' }).innerHTML;
    click(/A curved outer edge/);
    const round = screen.getByRole('img', { name: 'Stair guide top-down preview' }).innerHTML;
    expect(round).not.toBe(square);
    click('Continue'); click('Continue'); click('Apply this staircase');
    const result = onApply.mock.calls[0]![0] as Staircase;
    expect(result.steps.some(step => step.kind === 'winder')).toBe(true);
    expect(result.layout?.kind).toBe('curved');
  });

  it.each(['Straight walls / square corners', 'A curved outer edge'])('creates eight winders over 180 degrees without adding a landing, with %s', edge => {
    const { staircase, onApply } = setup();
    number('Guide riser count', '8'); click(/U-shaped Half turn/); click('Continue');
    expect((screen.getByLabelText('Guide turning steps') as HTMLInputElement).value).toBe('8');
    expect(screen.getByText('8 turning steps · 180° · no turning landing')).toBeTruthy();
    click(new RegExp(edge));
    expect(document.querySelectorAll('.setup-stair-preview .preview-landing')).toHaveLength(0);
    expect(staircase.steps).toHaveLength(13);
    click('Continue'); click('Continue'); click('Apply this staircase');
    const result = onApply.mock.calls[0]![0] as Staircase;
    expect(result.steps).toHaveLength(8);
    expect(result.steps.every(step => step.kind === 'winder')).toBe(true);
    expect(result.landings).toEqual([]);
    const geometry = stairPlanGeometry(result);
    expect(Math.abs(geometry.pieces.at(-1)!.endHeading! - geometry.pieces[0]!.heading!)).toBeCloseTo(180, 5);
  });

  it('accepts a custom rotation and keeps turn position valid when all steps are winders', () => {
    const { onApply } = setup(); number('Guide riser count', '6'); click(/Custom turn/); number('Guide curve angle', '135'); click('Continue');
    number('Guide turning steps', '6'); expect((screen.getByLabelText('Guide steps before turn') as HTMLInputElement).value).toBe('0');
    click(/A curved outer edge/); click('Continue'); click('Continue'); click('Apply this staircase');
    const result = onApply.mock.calls[0]![0] as Staircase;
    expect(result.layout).toMatchObject({ kind: 'curved', curveAngle: 135, turnSteps: 6, turnStartIndex: 0 });
    expect(result.landings).toEqual([]);
  });
});
