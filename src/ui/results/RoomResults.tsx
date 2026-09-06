/**
 * Per-room and per-staircase result cards for the full estimate page: a plan with the cut pieces,
 * seams and pile arrow, the room's figures, its pieces and the BOM lines that apply to it.
 */
import type { BomLine, CutPiece, Estimate, Project, Room, RoomSummary, RollPlan, StairSummary, Staircase } from '@engine/types';
import { formatArea, formatLength } from '@ui/components/inputs';
import { RoomPreview } from '@ui/rooms/RoomPreview';
import { formatQty } from './BomTable';
import { Warnings } from './Warnings';

type Unit = 'metric' | 'imperial';

export const ROLE_LABELS: Record<CutPiece['role'], string> = {
  main: 'Main',
  fill: 'Fill',
  stair_step: 'Step',
  stair_runner: 'Runner',
  landing: 'Landing',
  winder: 'Winder',
  other: 'Piece',
};

/**
 * Which way the pile runs in this room. The room summary does not record it, so it is read off the
 * placement of the first piece: a piece's `length` runs along the roll, so if the placement's x-extent
 * matches the length the pile runs along the room's x axis ('along_length'). Falls back to the roll
 * plan's dominant direction.
 */
export function inferPileDirection(summary: RoomSummary | undefined, plan: RollPlan | undefined): 'along_length' | 'along_width' | undefined {
  const piece = summary?.pieces.find((p) => p.placement && p.placement.polygon.length >= 3);
  if (piece?.placement) {
    const xs = piece.placement.polygon.map((p) => p.x);
    const ys = piece.placement.polygon.map((p) => p.y);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    const alongX = Math.abs(dx - piece.length) + Math.abs(dy - piece.width);
    const alongY = Math.abs(dx - piece.width) + Math.abs(dy - piece.length);
    if (Math.abs(alongX - alongY) > 1e-6) return alongX < alongY ? 'along_length' : 'along_width';
  }
  return plan?.pileDirection;
}

/** BOM lines that apply to a room / staircase (by subject id). */
export function linesForSubject(bom: BomLine[], id: string): BomLine[] {
  return bom.filter((l) => l.subjectIds.includes(id));
}

export interface RoomResultsProps {
  room: Room;
  summary: RoomSummary | undefined;
  estimate: Estimate;
  project: Project;
}

export function RoomResults({ room, summary, estimate, project }: RoomResultsProps) {
  const unit: Unit = project.displayUnit;
  const product = project.products.find((p) => p.id === room.productId);
  const plan = estimate.rollPlans.find((rp) => rp.productId === room.productId);
  const pieces = summary?.pieces ?? [];
  const seams = summary?.seams ?? [];
  const pile = inferPileDirection(summary, plan);
  const lines = linesForSubject(estimate.bom, room.id);
  const sideSeams = seams.filter((s) => s.kind === 'side').length;
  const crossSeams = seams.length - sideSeams;

  return (
    <article className="panel result-card room-result" data-testid="room-result" data-room-id={room.id}>
      <header className="result-card-header">
        <h3>{room.name}</h3>
        <span className="muted small">{product?.name ?? 'No product'}</span>
      </header>
      <div className="result-card-body">
        <div className="result-card-plan">
          <RoomPreview room={room} unit={unit} pieces={pieces} seams={seams} showPileArrow={pile} showEdgeNumbers={false} />
        </div>
        <div className="result-card-figures">
          <dl className="figures-list">
            <div>
              <dt>Net area</dt>
              <dd data-testid="room-net-area">{summary ? formatArea(summary.netAreaM2, unit) : '—'}</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{summary ? formatLength(summary.perimeter, unit) : '—'}</dd>
            </div>
            <div>
              <dt>Gripper perimeter</dt>
              <dd>{summary ? formatLength(summary.gripperPerimeter, unit) : '—'}</dd>
            </div>
            <div>
              <dt>Overall</dt>
              <dd>{summary ? `${formatLength(summary.boundingBox.length, unit)} × ${formatLength(summary.boundingBox.width, unit)}` : '—'}</dd>
            </div>
            {pieces.length > 0 ? (
              <div>
                <dt>Seams</dt>
                <dd>
                  {seams.length === 0 ? 'none' : `${seams.length}`}
                  {seams.length > 0 ? <span className="muted small"> ({sideSeams} side, {crossSeams} cross)</span> : null}
                </dd>
              </div>
            ) : null}
            {pile && pieces.length > 0 ? (
              <div>
                <dt>Pile direction</dt>
                <dd>{pile === 'along_length' ? 'along the length' : 'along the width'}</dd>
              </div>
            ) : null}
          </dl>

          {pieces.length > 0 ? (
            <table className="data pieces-table" aria-label={`Cut pieces for ${room.name}`}>
              <thead>
                <tr>
                  <th scope="col">Piece</th>
                  <th scope="col" className="num">
                    Length (along roll)
                  </th>
                  <th scope="col" className="num">
                    Width
                  </th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.label} <span className="badge">{ROLE_LABELS[p.role]}</span>
                    </td>
                    <td className="num">{formatLength(p.length, unit)}</td>
                    <td className="num">{formatLength(p.width, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {lines.length > 0 ? (
            <details className="result-lines">
              <summary className="small">Materials &amp; labour for this room ({lines.length})</summary>
              <ul className="small result-lines-list">
                {lines.map((l) => (
                  <li key={l.id}>
                    {l.description}: <b>{formatQty(l.quantity)}</b> {l.unit}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {room.notes ? <p className="small muted result-notes">{room.notes}</p> : null}
          <Warnings warnings={summary?.warnings ?? []} project={project} />
        </div>
      </div>
    </article>
  );
}

export interface StairResultsProps {
  staircase: Staircase;
  summary: StairSummary | undefined;
  estimate: Estimate;
  project: Project;
}

export function StairResults({ staircase, summary, estimate, project }: StairResultsProps) {
  const unit: Unit = project.displayUnit;
  const product = project.products.find((p) => p.id === staircase.productId);
  const lines = linesForSubject(estimate.bom, staircase.id);
  const pieces = summary?.pieces ?? [];
  const byRole = pieces.reduce<Partial<Record<CutPiece['role'], number>>>((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <article className="panel result-card stair-result" data-testid="stair-result" data-staircase-id={staircase.id}>
      <header className="result-card-header">
        <h3>{staircase.name}</h3>
        <span className="muted small">
          {product?.name ?? 'No product'} · {staircase.method === 'waterfall' ? 'waterfall' : 'cap & band'}
          {staircase.runner ? ` · runner ${formatLength(staircase.runner.width, unit)}` : ''}
        </span>
      </header>
      <dl className="figures-list">
        <div>
          <dt>Steps</dt>
          <dd data-testid="stair-steps">{summary?.stepCount ?? staircase.steps.length}</dd>
        </div>
        <div>
          <dt>Pieces</dt>
          <dd>
            {pieces.length}
            {pieces.length > 0 ? (
              <span className="muted small">
                {' '}
                (
                {Object.entries(byRole)
                  .map(([role, n]) => `${n} ${ROLE_LABELS[role as CutPiece['role']].toLowerCase()}`)
                  .join(', ')}
                )
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Carpet area</dt>
          <dd>{summary ? formatArea(summary.carpetAreaM2, unit) : '—'}</dd>
        </div>
        <div>
          <dt>Gripper</dt>
          <dd>{summary ? formatLength(summary.gripperLength, unit) : '—'}</dd>
        </div>
        <div>
          <dt>Binding</dt>
          <dd>{summary ? (summary.bindingLength > 0 ? formatLength(summary.bindingLength, unit) : 'none') : '—'}</dd>
        </div>
        <div>
          <dt>Underlay pads</dt>
          <dd>{summary ? formatArea(summary.underlayAreaM2, unit) : '—'}</dd>
        </div>
      </dl>
      {pieces.length > 0 ? (
        <details className="result-lines">
          <summary className="small">Pieces ({pieces.length})</summary>
          <table className="data pieces-table" aria-label={`Cut pieces for ${staircase.name}`}>
            <thead>
              <tr>
                <th scope="col">Piece</th>
                <th scope="col" className="num">
                  Length (along roll)
                </th>
                <th scope="col" className="num">
                  Width
                </th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.label} <span className="badge">{ROLE_LABELS[p.role]}</span>
                  </td>
                  <td className="num">{formatLength(p.length, unit)}</td>
                  <td className="num">{formatLength(p.width, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {lines.length > 0 ? (
        <details className="result-lines">
          <summary className="small">Materials &amp; labour for these stairs ({lines.length})</summary>
          <ul className="small result-lines-list">
            {lines.map((l) => (
              <li key={l.id}>
                {l.description}: <b>{formatQty(l.quantity)}</b> {l.unit}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {staircase.notes ? <p className="small muted result-notes">{staircase.notes}</p> : null}
      <Warnings warnings={summary?.warnings ?? []} project={project} />
    </article>
  );
}
