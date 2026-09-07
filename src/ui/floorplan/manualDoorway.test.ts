import { describe, expect, it } from 'vitest';
import type { Room } from '@engine/types';
import { doorwaySegment, polygonAreaM2 } from '@engine/geometry';
import { previewManualDoorway } from './manualDoorway';

const points = [{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:2000,y:3000},{x:1950,y:2750},{x:1800,y:2500},{x:1550,y:2300},{x:1200,y:2200},{x:1200,y:3000},{x:0,y:3000}];
const room = { shape: {kind:'polygon',points}, source: {floorPlanId:'p',pixelPolygon:points.map(p=>({x:p.x/10+20,y:p.y/10+40}))}, doorways: [{id:'existing',edgeIndex:0,offset:100,width:700,transition:'carpet'}] } as Pick<Room,'shape'|'source'|'doorways'>;

describe('manual doorway on detected outlines', () => {
  it.each([false,true])('fills a door-swing recess and keeps existing doors with reversed clicks: %s', reverse => {
    const a={x:140,y:340},b={x:220,y:340};
    const result=previewManualDoorway(room,reverse?b:a,reverse?a:b,.6)!;
    expect(result).toBeTruthy(); expect(result.adjusted).toBe(true);
    expect(result.placement.width).toBe(800);
    expect(polygonAreaM2(result.polygon)).toBe(12);
    expect(result.retainedDoorways).toHaveLength(1);
    const old=doorwaySegment(points,room.doorways[0]!);
    expect(doorwaySegment(result.polygon,result.retainedDoorways[0]!)).toEqual(old);
    expect(result.a.y).toBe(340); expect(result.b.y).toBe(340);
  });
  it('preserves direct wall placement without editing the shape',()=>{
    const result=previewManualDoorway(room,{x:140,y:42},{x:220,y:38},1)!;
    expect(result.adjusted).toBe(false); expect(result.placement.width).toBe(800);
    expect(result.polygon).toEqual(points); expect(result.retainedDoorways).toBe(room.doorways);
  });
  it('refuses distant clicks and cross-room shortcuts',()=>{
    expect(previewManualDoorway(room,{x:140,y:75},{x:220,y:75},.5)).toBeNull();
    expect(previewManualDoorway(room,{x:20,y:100},{x:420,y:100},1)).toBeNull();
    expect(previewManualDoorway(room,{x:20,y:260},{x:100,y:340},1)).toBeNull();
  });
});
