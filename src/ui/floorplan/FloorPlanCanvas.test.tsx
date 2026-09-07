import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FloorPlanDocument } from '@engine/types';
import { FloorPlanCanvas, type FloorPlanCanvasProps } from './FloorPlanCanvas';

const plan: FloorPlanDocument = { id: 'ground', name: 'Ground floor', widthPx: 2400, heightPx: 1600, imageDataUrl: 'data:image/png;base64,test' };

function Harness({ initialZoom = 1, ...props }: Partial<FloorPlanCanvasProps> & { initialZoom?: number }) {
  const [zoom, setZoom] = useState(initialZoom);
  return <FloorPlanCanvas plan={plan} {...props} zoom={zoom} onZoomChange={setZoom} />;
}

const overlay = () => screen.getByTestId('floorplan-overlay');
const viewport = () => document.querySelector('.floorplan-canvas') as HTMLDivElement;
const readZoom = () => Number(screen.getByTestId('zoom-readout').textContent?.replace('%', '')) / 100;

/** jsdom lacks PointerEvent; provide the fields needed for actual independent touch contacts. */
function pointer(type: string, id: number, x: number, y: number, pointerType = 'mouse', button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
  fireEvent(overlay(), event);
}

function dimensions(width: number, height: number) {
  const el = viewport();
  Object.defineProperties(el, { clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height } });
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ left: 20, top: 30, width, height, right: 20 + width, bottom: 30 + height, x: 20, y: 30, toJSON: () => ({}) }));
  vi.spyOn(overlay(), 'getBoundingClientRect').mockImplementation(() => {
    const stage = document.querySelector('.floorplan-stage') as HTMLDivElement;
    const w = Number.parseFloat(stage.style.width);
    const h = Number.parseFloat(stage.style.height);
    return { left: 20 - el.scrollLeft, top: 30 - el.scrollTop, width: w, height: h, right: 20 - el.scrollLeft + w, bottom: 30 - el.scrollTop + h, x: 20 - el.scrollLeft, y: 30 - el.scrollTop, toJSON: () => ({}) };
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('FloorPlanCanvas', () => {
  it('shows a close-up at the actual plan point without changing the tap coordinates', () => {
    const onTap = vi.fn();
    render(<Harness initialZoom={.5} precision onTap={onTap}/>);
    dimensions(360,420); viewport().scrollLeft=100; viewport().scrollTop=50;
    pointer('pointermove',1,120,80);
    const view=screen.getByTestId('precision-zoom').querySelector('svg')!;
    const [x,y,width,height]=view.getAttribute('viewBox')!.split(' ').map(Number);
    expect(x!+width!/2).toBe(400); expect(y!+height!/2).toBe(200);
    pointer('pointerdown',1,120,80); pointer('pointerup',1,120,80);
    expect(onTap).toHaveBeenCalledWith({x:400,y:200},expect.anything());
    fireEvent.click(screen.getByRole('button',{name:'Precision zoom'}));
    pointer('pointermove',1,130,90);
    expect(screen.queryByTestId('precision-zoom')).toBeNull();
  });

  it('hides the precision preview during touch panning and cancellation',()=>{
    render(<Harness precision/>); dimensions(360,420);
    pointer('pointerdown',1,120,130,'touch');
    expect(screen.getByTestId('precision-zoom')).toBeTruthy();
    pointer('pointermove',1,160,180,'touch');
    expect(screen.queryByTestId('precision-zoom')).toBeNull();
    pointer('pointercancel',1,160,180,'touch');
    expect(screen.queryByTestId('precision-zoom')).toBeNull();
  });

  it('fits a 2400px image inside a phone viewport using its actual height and width', () => {
    render(<Harness />);
    dimensions(360, 420);
    fireEvent.click(screen.getByRole('button', { name: 'Fit plan' }));
    const stage = document.querySelector('.floorplan-stage') as HTMLDivElement;
    expect(Number.parseFloat(stage.style.width)).toBeCloseTo(358);
    expect(Number.parseFloat(stage.style.height)).toBeLessThan(420);
    expect(readZoom()).toBe(0.15);
  });

  it('refits on viewport resize, while preserving a manually zoomed view', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Harness />);
    dimensions(802, 202);
    fireEvent(window, new Event('resize'));
    expect(readZoom()).toBe(0.13); // height limits fit to 200/1600
    dimensions(322, 402);
    fireEvent(window, new Event('resize'));
    expect(readZoom()).toBe(0.13); // width now limits fit to 320/2400
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(readZoom()).toBe(0.17);
    dimensions(802, 602);
    fireEvent(window, new Event('resize'));
    expect(readZoom()).toBe(0.17);
  });

  it('maps taps into image coordinates after zoom and scrolling', () => {
    const onTap = vi.fn();
    render(<Harness initialZoom={0.5} onTap={onTap} />);
    dimensions(360, 420);
    viewport().scrollLeft = 100;
    viewport().scrollTop = 50;
    pointer('pointerdown', 1, 120, 80);
    pointer('pointerup', 1, 120, 80);
    expect(onTap).toHaveBeenCalledWith({ x: 400, y: 200 }, expect.objectContaining({ zoom: 0.5, pointerType: 'mouse' }));
  });

  it('pans with one finger and never treats dragging or cancelled gestures as a trace point', () => {
    const onTap = vi.fn();
    render(<Harness onTap={onTap} />);
    dimensions(360, 420);
    viewport().scrollLeft = 100;
    viewport().scrollTop = 100;
    pointer('pointerdown', 1, 200, 200, 'touch');
    pointer('pointermove', 1, 150, 160, 'touch');
    pointer('pointerup', 1, 150, 160, 'touch');
    expect(viewport().scrollLeft).toBe(150);
    expect(viewport().scrollTop).toBe(140);
    pointer('pointerdown', 2, 120, 150, 'touch');
    pointer('pointercancel', 2, 120, 150, 'touch');
    expect(onTap).not.toHaveBeenCalled();
  });

  it('anchors pinch zoom on the moving midpoint and suppresses both touch releases', () => {
    const onTap = vi.fn();
    render(<Harness onTap={onTap} />);
    dimensions(360, 420);
    pointer('pointerdown', 1, 120, 130, 'touch');
    pointer('pointerdown', 2, 220, 130, 'touch');
    pointer('pointermove', 2, 320, 130, 'touch');
    expect(readZoom()).toBe(2);
    // Initial midpoint maps to (150,100) on the plan. Keep it at the new midpoint (200,100) in the viewport.
    expect(viewport().scrollLeft).toBe(100);
    expect(viewport().scrollTop).toBe(100);
    pointer('pointerup', 2, 320, 130, 'touch');
    pointer('pointermove', 1, 140, 140, 'touch');
    pointer('pointerup', 1, 140, 140, 'touch');
    expect(onTap).not.toHaveBeenCalled();
    pointer('pointerdown', 3, 120, 130, 'touch');
    pointer('pointerup', 3, 120, 130, 'touch');
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('drags a nearby draft corner in plan coordinates instead of moving the viewport', () => {
    const onTap = vi.fn();
    const onPointMove = vi.fn();
    render(<Harness initialZoom={0.5} onTap={onTap} editablePoints={[{ x: 200, y: 200 }]} onPointMove={onPointMove} />);
    dimensions(360, 420);
    // At 50%, the vertex is (120,130) on screen; a touch 18px away is within its hit target.
    pointer('pointerdown', 1, 138, 130, 'touch');
    pointer('pointermove', 1, 158, 160, 'touch');
    pointer('pointerup', 1, 158, 160, 'touch');
    expect(onPointMove).toHaveBeenLastCalledWith(0, { x: 240, y: 260 });
    expect(viewport().scrollLeft).toBe(0);
    expect(viewport().scrollTop).toBe(0);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('keeps a click on a corner available to close the outline, and ignores middle clicks', () => {
    const onTap = vi.fn();
    const onPointMove = vi.fn();
    render(<Harness onTap={onTap} editablePoints={[{ x: 100, y: 100 }]} onPointMove={onPointMove} />);
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerup', 1, 100, 100);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onPointMove).not.toHaveBeenCalled();
    pointer('pointerdown', 2, 100, 100, 'mouse', 1);
    pointer('pointerup', 2, 100, 100, 'mouse', 1);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('pinches near an editable handle without modifying the outline', () => {
    const onPointMove = vi.fn();
    render(<Harness editablePoints={[{ x: 100, y: 100 }]} onPointMove={onPointMove} />);
    dimensions(360, 420);
    pointer('pointerdown', 1, 120, 130, 'touch');
    pointer('pointerdown', 2, 220, 130, 'touch');
    pointer('pointermove', 2, 320, 130, 'touch');
    pointer('pointerup', 1, 120, 130, 'touch');
    pointer('pointerup', 2, 320, 130, 'touch');
    expect(readZoom()).toBe(2);
    expect(onPointMove).not.toHaveBeenCalled();
  });

  it('anchors Ctrl+wheel zoom at the cursor and leaves ordinary wheel scrolling alone', () => {
    render(<Harness />);
    dimensions(360, 420);
    fireEvent.wheel(viewport(), { clientX: 120, clientY: 130, deltaY: -100 });
    expect(readZoom()).toBe(1);
    fireEvent.wheel(viewport(), { clientX: 120, clientY: 130, deltaY: -100, ctrlKey: true });
    expect(readZoom()).toBe(1.25);
    expect(viewport().scrollLeft).toBe(25);
    expect(viewport().scrollTop).toBe(25);
  });
});
