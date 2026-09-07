import { boundingBox } from '@engine/geometry';
import type { StaircaseSuggestion } from './roomSuggestions';
import { svgPoints } from './tracing';

export function DetectedStairsOverlay({stairs,activeId,editingId,zoom,onSelect}:{stairs:StaircaseSuggestion[];activeId?:string;editingId?:string;zoom:number;onSelect:(id:string)=>void}) {
  return <g className="fp-detected-stairs" aria-label="Detected staircase suggestions">{stairs.map((stair,index)=>{
    if(stair.id===editingId)return null;
    const bounds=boundingBox(stair.polygon);
    return <g key={stair.id} role="button" tabIndex={0} aria-label={`Review detected staircase ${index+1}: ${stair.name}`} aria-pressed={activeId===stair.id}
      className={`fp-stair-suggestion${stair.included?' included':''}${activeId===stair.id?' active':''}`} data-testid="detected-staircase-overlay"
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onSelect(stair.id);}}}>
      <polygon points={svgPoints(stair.polygon)} strokeWidth={2/zoom} strokeDasharray={`${5/zoom} ${3/zoom}`}/>
      {stair.treads.map((line,i)=><line key={i} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="#8a5bbb" strokeWidth={1/zoom}/>)}
      <rect x={bounds.minX} y={bounds.minY-23/zoom} width={32/zoom} height={21/zoom} rx={5/zoom}/>
      <text x={bounds.minX+16/zoom} y={bounds.minY-8/zoom} fontSize={11/zoom} textAnchor="middle">S{index+1}</text>
    </g>;
  })}</g>;
}
