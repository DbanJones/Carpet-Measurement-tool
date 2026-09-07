import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { sampleProject } from '@engine/fixtures';
import { estimateProject } from '@engine/estimate';
import { ClientPack, clientPackHtml, costGroups } from './ClientPack';
import { ResultsPanel } from './ResultsPanel';
import { useProjectStore } from '@store/projectStore';

afterEach(cleanup);
it('keeps the client price breakdown equal to the estimate and excludes optional work', () => {
  const project = sampleProject();
  const estimate = estimateProject(project);
  expect(costGroups(estimate).reduce((sum, group) => sum + group.total, 0)).toBeCloseTo(estimate.totals.subtotal!);
  const { container } = render(<ClientPack project={project} estimate={estimate} />);
  expect(container.querySelector('.pack-grand-total')!.textContent).toContain('£5,076.26');
  expect(screen.getByRole('heading', { name: 'Your flooring' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Optional items' })).toBeTruthy();
  expect(screen.queryByText('Hourly labour rate')).toBeNull();
});

it('exports an escaped, styled, standalone document and flags unpriced drafts', () => {
  const project = sampleProject();
  project.name = '<script>alert(1)</script>';
  project.business = { name: 'Smith & Sons', terms: 'Terms <script>unsafe()</script>' };
  delete project.products[0]!.pricePerM2;
  const html = clientPackHtml(project, estimateProject(project));
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Smith &amp; Sons');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('DRAFT · INCOMPLETE');
  expect(html).toContain('not a complete quotation');
  expect(html).toContain('@media print');
});

it('opens focused estimate views and offers a client pack with editable details', () => {
  useProjectStore.getState().setProject(sampleProject());
  render(<ResultsPanel expanded />);
  const navigation = screen.getByRole('navigation', { name: 'Estimate sections' });
  expect(document.getElementById('estimate-cutting')!.hidden).toBe(true);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Cutting plans' }));
  expect(document.getElementById('estimate-cutting')!.hidden).toBe(false);
  expect(document.getElementById('estimate-summary')!.hidden).toBe(true);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Client pack' }));
  expect(screen.getByTestId('client-pack')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download client pack' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Print / save PDF' })).toBeTruthy();
  const controls = document.querySelector('.client-pack-controls')!;
  fireEvent.change(within(controls as HTMLElement).getByLabelText('Customer'), { target: { value: 'Alex Customer' } });
  expect(within(screen.getByTestId('client-pack')).getByText('Alex Customer')).toBeTruthy();
});
