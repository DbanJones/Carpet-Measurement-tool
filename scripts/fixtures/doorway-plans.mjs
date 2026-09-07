/** Raster fixtures: only drawing geometry changes, with no text used to identify a door. */
export function doorwayFixtures(estate) {
  const symbols = '<path d="M210 340V280A60 60 0 0 1 270 340M440 300H520A80 80 0 0 1 440 380"/>';
  if (!estate.includes(symbols)) throw new Error('Estate fixture doorway geometry changed; review the doorway variants.');
  const unlabelled = estate.replace(/<g font-family="Arial, sans-serif"[\s\S]*?<\/g>/, '');
  const inside = markup => markup.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const frame = (markup, width, height, transform) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="${transform}">${inside(markup)}</g></svg>`;
  const openings = [{ x: 240, y: 340, width: 60 }, { x: 440, y: 340, width: 80 }];
  return [
    { name: 'estate-symbols', markup: estate, minDoors: 3, openings },
    { name: 'unlabelled-symbols', markup: unlabelled, minDoors: 3, openings },
    { name: 'mirrored-symbols', markup: frame(unlabelled, 960, 700, 'translate(960 0) scale(-1 1)'), minDoors: 3, openings: openings.map(p => ({ ...p, x: 960 - p.x })) },
    { name: 'rotated-symbols', markup: frame(unlabelled, 700, 960, 'translate(700 0) rotate(90)'), minDoors: 3, openings: openings.map(p => ({ ...p, x: 700 - p.y, y: p.x })) },
    { name: 'thin-symbols', markup: unlabelled.replace('stroke="#555" stroke-width="2"', 'stroke="#555" stroke-width="1"'), minDoors: 3, openings },
    { name: 'mildly-stretched-arcs', markup: unlabelled.replace(symbols, '<path d="M210 340V292A60 48 0 0 1 270 340M440 300H504A64 80 0 0 1 440 380"/>'), minDoors: 3, openings },
    { name: 'gaps-without-symbols', markup: unlabelled.replace(symbols, ''), minDoors: 0, maxDoors: 0, openings },
    { name: 'leaves-without-arcs', markup: unlabelled.replace(symbols, '<path d="M210 340V280M440 300H520"/>'), minDoors: 3, openings, onlyEvidence: 'door-leaf' },
  ];
}
