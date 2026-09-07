import { emptyProject } from './fixtures';
import { parseProject, serializeProject } from './serialize';
import type { Project } from './types';

const roundtrip = (project: Project) => {
  const result = parseProject(serializeProject(project));
  if ('error' in result) throw new Error(result.error);
  return result.project;
};
it('preserves client business details and spatial OCR results through a backup without changing scale', () => {
  const project = emptyProject('reading');
  project.business = { name: 'Example Floors', email: 'hello@example.test', phone: '01234', terms: 'Quote terms\nSecond line' };
  project.floorPlans = [{ id: 'plan', name: 'Estate plan', imageDataUrl: 'data:image/png;base64,AAAA', widthPx: 500, heightPx: 400, reading: { source: 'ocr', text: 'BEDROOM 4.35m', lines: [{ text: 'BEDROOM', x: 50, y: 100, width: 150, height: 20, confidence: 91, reviewed: true }] } }];
  const result = roundtrip(project);
  expect(result.business).toEqual(project.business);
  expect(result.floorPlans[0]!.reading).toEqual(project.floorPlans[0]!.reading);
  expect(result.floorPlans[0]!.mmPerPx).toBeUndefined();
});

it('discards malformed OCR boxes and caps imported text rather than rendering unsafe geometry', () => {
  const project = emptyProject('reading');
  project.floorPlans = [{ id: 'plan', name: 'Estate plan', imageDataUrl: 'data:image/png;base64,AAAA', widthPx: 500, heightPx: 400, reading: { source: 'ocr', text: 'x'.repeat(60000), lines: [
    { text: 'BEDROOM', x: -50, y: 100, width: -50, height: 20, confidence: 400 },
    { text: 'Bad', x: NaN, y: 20, width: 20, height: 20, confidence: 90 },
  ] } }];
  const result = roundtrip(project).floorPlans[0]!.reading!;
  expect(result.text.length).toBe(50000);
  expect(result.lines).toHaveLength(1);
  expect(result.lines[0]).toMatchObject({ x: 0, width: 0, confidence: 100 });
});
