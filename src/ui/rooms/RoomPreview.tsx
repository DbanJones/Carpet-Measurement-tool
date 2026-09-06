/**
 * RoomPreview: an SVG plan of a room. Draws the outline, a dimension on every edge, circled edge
 * numbers (matching the doorway table), doorways as thick blue bars, and optionally the cut pieces,
 * seams and pile direction from an estimate. Pure presentation; the results panel reuses it.
 *
 * Coordinates are millimetres straight from the engine (viewBox in mm), so stroke widths use
 * `vector-effect: non-scaling-stroke` (px on screen) and text sizes are scaled to the room.
 */
import type { CutPiece, Doorway, Point, Polygon, RoomShape, Seam } from '@engine/types';
import { boundingBox, centroid, doorwaySegment, edgeLength, shapeToPolygon, signedArea } from '@engine/geometry';
import { formatLength } from '@ui/components/inputs';
import { useProjectStore } from '@store/projectStore';

type DisplayUnit = 'metric' | 'imperial';

export interface RoomPreviewProps {
  /** The room (or anything with a shape and doorways) to draw. */
  room: { shape: RoomShape; doorways?: Doorway[]; name?: string };
  /** Display unit for the dimension labels; defaults to the project's. */
  unit?: DisplayUnit;
  /** Cut pieces with placements (from a RoomSummary) to overlay on the plan. */
  pieces?: CutPiece[];
  /** Seams (from a RoomSummary); cross seams are drawn dotted. */
  seams?: Seam[];
  /** Draw a small arrow showing which way the pile / roll length runs. */
  showPileArrow?: 'along_length' | 'along_width';
  /** Edge dimension labels (default on). */
  showDimensions?: boolean;
  /** Circled edge numbers matching the doorway table (default on). */
  showEdgeNumbers?: boolean;
  className?: string;
}

/** `shapeToPolygon` that never throws and never returns non-finite coordinates. */
export function safePolygon(shape: RoomShape): Polygon {
  try {
    const poly = shapeToPolygon(shape);
    return poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? poly : [];
  } catch {
    return [];
  }
}

const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const pointsAttr = (pts: Polygon) => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

export function RoomPreview({
  room,
  unit,
  pieces = [],
  seams = [],
  showPileArrow,
  showDimensions = true,
  showEdgeNumbers = true,
  className,
}: RoomPreviewProps) {
  const storeUnit = useProjectStore((s) => s.project.displayUnit);
  const u = unit ?? storeUnit;
  const poly = safePolygon(room.shape);
  const ariaLabel = room.name ? `Plan of ${room.name}` : 'Room plan';
  const svgClass = `diagram room-preview${className ? ` ${className}` : ''}`;

  if (poly.length < 3) {
    return (
      <svg className={svgClass} viewBox="0 0 200 60" role="img" aria-label={ariaLabel} data-testid="room-preview-empty">
        <text className="label-muted" x="100" y="34" textAnchor="middle" style={{ fontSize: 10 }}>
          No outline to draw yet
        </text>
      </svg>
    );
  }

  const placedPieces = pieces.filter((p) => p.placement && p.placement.polygon.length >= 3 && p.placement.polygon.every(finitePoint));
  const drawnSeams = seams.filter((s) => finitePoint(s.from) && finitePoint(s.to));

  // Fit the viewBox to the room plus any piece that overhangs it (allowances), with room for labels.
  const bb = boundingBox(poly);
  let minX = bb.minX;
  let minY = bb.minY;
  let maxX = bb.maxX;
  let maxY = bb.maxY;
  for (const piece of placedPieces) {
    for (const p of piece.placement!.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const fs = span * 0.035; // base font size in mm-units, ~13 px at typical panel widths
  const pad = fs * 3.6;
  const viewBox = `${fmt(minX - pad)} ${fmt(minY - pad)} ${fmt(maxX - minX + 2 * pad)} ${fmt(maxY - minY + 2 * pad)}`;

  // Outward normal of edge a->b. With y down on screen, a positive shoelace area is clockwise.
  const clockwise = signedArea(poly) >= 0;
  const outward = (a: Point, b: Point): Point => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = clockwise ? 1 : -1;
    return { x: (s * dy) / len, y: (-s * dx) / len };
  };

  const doorways = (room.doorways ?? []).filter((d) => Number.isInteger(d.edgeIndex) && d.edgeIndex >= 0 && d.edgeIndex < poly.length);

  return (
    <svg className={svgClass} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel} data-testid="room-preview">
      <polygon className="room" points={pointsAttr(poly)} vectorEffect="non-scaling-stroke" />

      {placedPieces.map((piece) => {
        const pts = piece.placement!.polygon;
        const c = centroid(pts);
        return (
          <g key={piece.id} data-piece-id={piece.id}>
            <polygon className={piece.role === 'fill' ? 'piece fill' : 'piece'} points={pointsAttr(pts)} vectorEffect="non-scaling-stroke" />
            <text className="piece-label" x={fmt(c.x)} y={fmt(c.y)} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fs * 0.8 }}>
              {piece.label}
            </text>
          </g>
        );
      })}

      {drawnSeams.map((s, i) => (
        <line
          key={i}
          className={s.kind === 'cross' ? 'seam cross' : 'seam'}
          x1={fmt(s.from.x)}
          y1={fmt(s.from.y)}
          x2={fmt(s.to.x)}
          y2={fmt(s.to.y)}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {doorways.map((d) => {
        const seg = doorwaySegment(poly, d);
        if (seg.width <= 0) return null;
        const a = poly[d.edgeIndex]!;
        const b = poly[(d.edgeIndex + 1) % poly.length]!;
        const n = outward(a, b);
        const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
        const lp = { x: mid.x + n.x * fs * 2.3, y: mid.y + n.y * fs * 2.3 };
        return (
          <g key={d.id} data-doorway-id={d.id}>
            <line className="door" x1={fmt(seg.from.x)} y1={fmt(seg.from.y)} x2={fmt(seg.to.x)} y2={fmt(seg.to.y)} vectorEffect="non-scaling-stroke">
              <title>{`${d.label ?? 'Door'}: ${formatLength(seg.width, u)} opening`}</title>
            </line>
            <text className="door-label" x={fmt(lp.x)} y={fmt(lp.y)} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fs * 0.8 }}>
              {d.label ?? 'Door'}
            </text>
          </g>
        );
      })}

      {poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length]!;
        const len = edgeLength(poly, i);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const n = outward(a, b);
        const dimPos = { x: mid.x + n.x * fs * 1.1, y: mid.y + n.y * fs * 1.1 };
        const badgePos = { x: mid.x - n.x * fs * 0.95, y: mid.y - n.y * fs * 0.95 };
        return (
          <g key={i} data-edge-index={i}>
            {showDimensions && len >= fs * 2.2 ? (
              <text className="dim" x={fmt(dimPos.x)} y={fmt(dimPos.y)} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fs }}>
                {formatLength(len, u)}
              </text>
            ) : null}
            {showEdgeNumbers ? (
              <g className="edge-badge">
                <circle cx={fmt(badgePos.x)} cy={fmt(badgePos.y)} r={fmt(fs * 0.55)} vectorEffect="non-scaling-stroke" />
                <text x={fmt(badgePos.x)} y={fmt(badgePos.y)} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fs * 0.7 }}>
                  {i + 1}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}

      {showPileArrow ? <PileArrow x={minX - pad + fs * 0.4} y={minY - pad + fs * 0.9} fs={fs} direction={showPileArrow} /> : null}
    </svg>
  );
}

function PileArrow({ x, y, fs, direction }: { x: number; y: number; fs: number; direction: 'along_length' | 'along_width' }) {
  const len = fs * 2.4;
  const head = fs * 0.5;
  if (direction === 'along_length') {
    const tip = x + len;
    return (
      <g className="pile-arrow" data-testid="pile-arrow" data-direction={direction}>
        <line x1={fmt(x)} y1={fmt(y)} x2={fmt(tip)} y2={fmt(y)} vectorEffect="non-scaling-stroke" />
        <polygon points={`${fmt(tip)},${fmt(y)} ${fmt(tip - head)},${fmt(y - head / 2)} ${fmt(tip - head)},${fmt(y + head / 2)}`} />
        <text className="label-muted" x={fmt(x)} y={fmt(y + fs * 0.9)} dominantBaseline="central" style={{ fontSize: fs * 0.75 }}>
          pile
        </text>
      </g>
    );
  }
  const tip = y + len;
  return (
    <g className="pile-arrow" data-testid="pile-arrow" data-direction={direction}>
      <line x1={fmt(x)} y1={fmt(y)} x2={fmt(x)} y2={fmt(tip)} vectorEffect="non-scaling-stroke" />
      <polygon points={`${fmt(x)},${fmt(tip)} ${fmt(x - head / 2)},${fmt(tip - head)} ${fmt(x + head / 2)},${fmt(tip - head)}`} />
      <text className="label-muted" x={fmt(x + fs * 0.5)} y={fmt(y + len / 2)} dominantBaseline="central" style={{ fontSize: fs * 0.75 }}>
        pile
      </text>
    </g>
  );
}
