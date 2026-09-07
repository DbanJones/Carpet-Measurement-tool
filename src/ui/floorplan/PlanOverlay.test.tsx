import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FloorPlanDocument } from '@engine/types';
import { PlanOverlay, type PlanTool } from './PlanOverlay';
import { CanvasCalibrationNotice, CanvasScaleOverlay, physicalScaleRuler, type CanvasScaleState } from './ScaleOverlay';

const plan: FloorPlanDocument = {
  id: 'plan', name: 'Ground floor', widthPx: 1000, heightPx: 800, imageDataUrl: 'data:image/png;base64,test',
  mmPerPx: 10, calibration: { a: { x: 100, y: 200 }, b: { x: 500, y: 200 }, distance: 4000 },
};
const points = [{ x: 100, y: 300 }, { x: 600, y: 300 }];
function Overlay({ tool = 'detect', zoom = 1, document = plan, scaleDistance }: { tool?: PlanTool; zoom?: number; document?: FloorPlanDocument; scaleDistance?: number }) {
  return <svg><PlanOverlay plan={document} rooms={[]} selectedRoomId="" tool={tool} points={tool === 'scale' ? points : []} closed={false} hover={null} zoom={zoom} gaps={[]} unit="metric" scaleDistance={scaleDistance}/></svg>;
}
function ScaleCanvas({ state }: { state: CanvasScaleState }) {
  return <><CanvasCalibrationNotice unit="metric" state={state}/><CanvasScaleOverlay plan={plan} zoom={1} unit="metric" state={state}/></>;
}

afterEach(cleanup);

describe('Floor plan scale references', () => {
  it('retains the saved distance and endpoint markers while finding and drawing rooms', () => {
    const { rerender } = render(<Overlay/>);
    expect(screen.getByTestId('confirmed-scale-reference').textContent).toContain('4.00 m · Scale set');
    expect(screen.getByText('A').tagName.toLowerCase()).toBe('text');
    expect(screen.getByText('B').tagName.toLowerCase()).toBe('text');
    rerender(<Overlay tool="trace"/>);
    expect(screen.getByTestId('confirmed-scale-reference')).toBeTruthy();
  });

  it('distinguishes an entered unsaved reference from the existing calibration', () => {
    render(<Overlay tool="scale" scaleDistance={6500}/>);
    expect(screen.getByTestId('draft-scale-reference').textContent).toContain('6.50 m · Not saved');
    expect(screen.queryByTestId('confirmed-scale-reference')).toBeNull();
    expect(screen.queryByText('4.00 m · Scale set')).toBeNull();
  });

  it('never applies the old scale to the distance being calibrated', () => {
    render(<Overlay tool="scale"/>);
    expect(screen.getByText('A → B · Enter the distance')).toBeTruthy();
    expect(screen.queryByText('5.00 m')).toBeNull();
  });

  it('keeps labels and endpoints the same display size through zoom changes', () => {
    const { container, rerender } = render(<Overlay zoom={1}/>);
    const radius = () => Number(container.querySelector('.fp-reference-point circle')?.getAttribute('r'));
    const fontSize = () => Number(container.querySelector('.fp-reference-caption text')?.getAttribute('font-size'));
    const first = { radius: radius(), font: fontSize() };
    rerender(<Overlay zoom={.25}/>);
    expect(radius() * .25).toBe(first.radius);
    expect(fontSize() * .25).toBe(first.font);
    expect(screen.getByTestId('confirmed-scale-reference').getAttribute('pointer-events')).toBe('none');
  });

  it('shows a known drawing grid without suggesting that its scale came from an uploaded wall', () => {
    const document = { ...plan, sketch: { gridMm: 1000 } };
    render(<><Overlay document={document}/><CanvasScaleOverlay plan={document} zoom={1} unit="metric"/></>);
    expect(screen.queryByTestId('confirmed-scale-reference')).toBeNull();
    expect(screen.getByText('1.00 m grid')).toBeTruthy();
  });

  it('provides each calibration instruction and keeps the saved ruler separate from unsaved dimensions', () => {
    const { rerender } = render(<ScaleCanvas state={{ active: true, pointCount: 0 }}/>);
    expect(screen.getByTestId('scale-canvas-instruction').textContent).toContain('first end');
    rerender(<ScaleCanvas state={{ active: true, pointCount: 1 }}/>);
    expect(screen.getByTestId('scale-canvas-instruction').textContent).toContain('other end');
    rerender(<ScaleCanvas state={{ active: true, pointCount: 2, distance: 6000 }}/>);
    expect(screen.getByTestId('scale-canvas-instruction').textContent).toContain('6.00 m entered');
    expect(screen.getByTestId('physical-scale-ruler').textContent).toContain('Saved scale');
  });

  it('does not invent a ruler before calibration', () => {
    render(<CanvasScaleOverlay plan={{ ...plan, mmPerPx: undefined, calibration: undefined }} zoom={1} unit="metric"/>);
    expect(screen.getByText('Scale not set')).toBeTruthy();
    expect(document.querySelector('.fp-ruler-line')).toBeNull();
  });

  it('asks for confirmation of an automatic reference without showing manual point-placement steps', () => {
    render(<CanvasCalibrationNotice unit="metric" state={{ active: true, pointCount: 2, distance: 4000, suggested: true }}/>);
    const notice = screen.getByTestId('scale-canvas-instruction').textContent;
    expect(notice).toContain('Suggested scale · awaiting confirmation');
    expect(notice).toContain('4.00 m A–B reference');
    expect(notice).not.toContain('3 of 3');
    expect(notice).not.toContain('Tap the first');
  });

  it.each([.1, .25, 1, 3, 8])('matches the physical ruler to the zoomed image at %sx', (zoom) => {
    const ruler = physicalScaleRuler(10, zoom, 'metric')!;
    expect(ruler.width / zoom * 10).toBeCloseTo(ruler.distance);
    expect(ruler.width).toBeLessThanOrEqual(96);
    expect(ruler.width).toBeGreaterThan(30);
    const imperial = physicalScaleRuler(10, zoom, 'imperial')!;
    expect(imperial.width / zoom * 10).toBeCloseTo(imperial.distance);
  });
});
