import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RollPlan } from '@engine/types';
import { RollCutDiagram } from './RollCutDiagram';

const product = { name: 'Shared carpet', kind: 'carpet' as const, maxRollLength: 6000, cutIncrement: 100 };
function fixture(): RollPlan {
  return {
    productId: 'carpet', rollWidth: 4000, pileDirection: 'along_length',
    pieces: [
      { id: 'lounge-main', ownerId: 'lounge', ownerName: 'Lounge', label: 'Main', role: 'main', length: 4000, width: 3000 },
      { id: 'stairs-1', ownerId: 'stairs', ownerName: 'Stairs', label: 'Step 1', role: 'stair_step', length: 548, width: 960 },
      { id: 'stairs-2', ownerId: 'stairs', ownerName: 'Stairs', label: 'Step 2', role: 'stair_step', length: 548, width: 960 },
    ],
    cuts: [
      { index: 0, length: 4000, pieces: [{ pieceId: 'lounge-main', x: 0, width: 3000, length: 4000 }, { pieceId: 'stairs-1', x: 3000, width: 960, length: 548 }], offcut: { width: 40, length: 4000 } },
      { index: 1, length: 3000, pieces: [{ pieceId: 'stairs-2', x: 0, width: 960, length: 548 }], offcut: { width: 3040, length: 3000 } },
    ],
    orderLength: 7000, rollsRequired: 2, orderedAreaM2: 28, netAreaM2: 13, wasteFraction: 15 / 28,
    offcuts: [], seamsByRoom: {}, warnings: [],
  };
}

afterEach(cleanup);

describe('RollCutDiagram destinations', () => {
  it('separates physical rolls and ties named destination cards to their cut numbers', () => {
    render(<RollCutDiagram plan={fixture()} product={product} unit="metric" />);
    const rolls = screen.getAllByTestId('physical-roll');
    expect(rolls).toHaveLength(2);
    expect(within(rolls[0]!).getByText('4.00 m to order')).toBeTruthy();
    expect(within(rolls[1]!).getByText('3.00 m to order')).toBeTruthy();
    expect(within(rolls[0]!).getByRole('button', { name: 'Highlight Lounge: 1 piece from Roll 1' }).textContent).toContain('Cut 1');
    expect(within(rolls[1]!).getByRole('button', { name: 'Highlight Stairs: 1 piece from Roll 2' }).textContent).toContain('Cut 2');
    expect(screen.getByText(/rectangular cutting blanks, including fitting allowances/)).toBeTruthy();
    expect(screen.getByText(/53.6% waste, including fitting allowances/)).toBeTruthy();
  });

  it('highlights pieces by destination and keeps their colour across separate rolls', () => {
    const { container } = render(<RollCutDiagram plan={fixture()} product={product} unit="metric" />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Stairs: 1 piece from Roll 1' }));
    const first = container.querySelector('[data-piece-id="stairs-1"]')!;
    const second = container.querySelector('[data-piece-id="stairs-2"]')!;
    const lounge = container.querySelector('[data-piece-id="lounge-main"]')!;
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(lounge.classList.contains('is-dimmed')).toBe(true);
    expect((first.querySelector('rect') as SVGRectElement).style.fill).toBe((second.querySelector('rect') as SVGRectElement).style.fill);
    fireEvent.click(screen.getByRole('button', { name: 'Show all pieces' }));
    expect(container.querySelectorAll('.is-dimmed')).toHaveLength(0);
  });

  it('selects a piece with keyboard, reports precise sizes and opens its destination explicitly', () => {
    const open = vi.fn();
    render(<RollCutDiagram plan={fixture()} product={product} unit="metric" onOpenDestination={open} />);
    const piece = screen.getByRole('button', { name: /^1B · Stairs · Step 1:/ });
    fireEvent.keyDown(piece, { key: 'Enter' });
    expect(piece.getAttribute('aria-pressed')).toBe('true');
    const status = within(screen.getAllByTestId('physical-roll')[0]!).getByRole('status');
    expect(status.textContent).toContain('1B · Stairs · Step 1');
    expect(status.textContent).toContain('0.548 m × 0.960 m');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(status).getByRole('button', { name: 'Open Stairs' }));
    expect(open).toHaveBeenCalledWith('stairs');
  });

  it('shows sizes immediately when a destination has only one piece', () => {
    render(<RollCutDiagram plan={fixture()} product={product} unit="metric" />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Lounge: 1 piece from Roll 1' }));
    const status = within(screen.getAllByTestId('physical-roll')[0]!).getByRole('status');
    expect(status.textContent).toContain('1A · Lounge · Main');
    expect(status.textContent).toContain('4.000 m × 3.000 m');
  });

  it('links the collapsed cut list to the corresponding graphic and preserves engine geometry', () => {
    const { container } = render(<RollCutDiagram plan={fixture()} product={product} unit="metric" />);
    const first = screen.getAllByTestId('physical-roll')[0]!;
    const details = first.querySelector('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector('summary')!);
    fireEvent.click(within(details).getByRole('button', { name: '1B · Stairs Step 1' }));
    const piece = container.querySelector('[data-piece-id="stairs-1"]')!;
    expect(piece.getAttribute('aria-pressed')).toBe('true');
    const rect = piece.querySelector('rect')!;
    // 210 px / 4000 mm scale: x is along-roll length; y is packed across-roll offset.
    expect(rect.getAttribute('width')).toBe('28.8');
    expect(rect.getAttribute('height')).toBe('50.4');
    expect(rect.getAttribute('y')).toBe('205.5');
    expect(screen.getAllByTestId('cut-row')).toHaveLength(2);
  });

  it('shows supplier rounding as spare ordered length beyond the last cut', () => {
    const plan = fixture();
    plan.cuts = [plan.cuts[0]!];
    plan.rollsRequired = 1;
    plan.orderLength = 4500;
    const { container } = render(<RollCutDiagram plan={plan} product={product} unit="metric" />);
    expect(container.querySelector('.roll-order-tail')).toBeTruthy();
    expect(screen.getByText('0.50 m uncut material included in the order')).toBeTruthy();
  });

  it('uses decimal inches for imperial cutting sizes instead of rounding to whole inches', () => {
    render(<RollCutDiagram plan={fixture()} product={product} unit="imperial" />);
    fireEvent.click(screen.getByRole('button', { name: /^1B · Stairs · Step 1:/ }));
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('21.57 in × 37.80 in');
  });

  it('prints complete cut lists and restores original disclosure choices after repeated events', () => {
    render(<RollCutDiagram plan={fixture()} product={product} unit="metric" />);
    const details = screen.getAllByTestId('physical-roll').map((roll) => roll.querySelector('details')!);
    fireEvent.click(details[1]!.querySelector('summary')!);
    fireEvent(window, new Event('beforeprint'));
    fireEvent(window, new Event('beforeprint'));
    expect(details.every((detail) => detail.open)).toBe(true);
    fireEvent(window, new Event('afterprint'));
    expect(details.map((detail) => detail.open)).toEqual([false, true]);
  });

  it('clears stale selection when replanning removes the selected piece', () => {
    const plan = fixture();
    const { rerender } = render(<RollCutDiagram plan={plan} product={product} unit="metric" />);
    fireEvent.click(screen.getByRole('button', { name: /^1B · Stairs · Step 1:/ }));
    const changed = fixture();
    changed.cuts[0]!.pieces.pop();
    changed.pieces = changed.pieces.filter((piece) => piece.id !== 'stairs-1');
    rerender(<RollCutDiagram plan={changed} product={product} unit="metric" />);
    expect(screen.queryByRole('button', { name: 'Show all pieces' })).toBeNull();
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('Select a piece above');
  });

  it('does not present unassigned or overlong cuts as a confirmed individual roll', () => {
    const { rerender } = render(<RollCutDiagram plan={fixture()} unit="metric" />);
    expect(screen.getByRole('heading', { name: 'Combined cuts' })).toBeTruthy();
    expect(screen.getByText(/Individual roll assignments are unavailable/)).toBeTruthy();
    rerender(<RollCutDiagram plan={fixture()} product={{ ...product, maxRollLength: 3500 }} unit="metric" />);
    expect(screen.getByText(/exceeds the supplier's maximum roll length/)).toBeTruthy();
  });

  it('handles no cuts without drawing a roll', () => {
    render(<RollCutDiagram plan={{ ...fixture(), cuts: [] }} product={product} unit="metric" />);
    expect(screen.getByTestId('roll-cut-diagram-empty')).toBeTruthy();
    expect(screen.queryByTestId('physical-roll')).toBeNull();
  });
});
