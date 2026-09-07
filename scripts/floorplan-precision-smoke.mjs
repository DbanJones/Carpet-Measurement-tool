/** Real uploaded-plan scale/stair review plus precise manual doorway placement in Chrome. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base=process.env.BASE_URL??'http://127.0.0.1:5173/';
const fixture=process.env.FLOORPLAN_PATH;
if(!fixture)throw new Error('Set FLOORPLAN_PATH to a local floor-plan image for this acceptance journey.');
const out=process.env.OUT_DIR??'test-results/floorplan-precision';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)});
const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
page.setDefaultTimeout(30000);
const errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const pass=message=>{checks.push(message);console.log('PASS',message);};
const storage='flooring-estimator:project:v1';
const project=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).project,storage);
const button=name=>page.getByRole('button',{name,exact:true});
const openPlan=()=>page.locator('nav.tabs').getByRole('button',{name:'Floor plan',exact:true}).click();
async function at(point){
  const overlay=page.getByTestId('floorplan-overlay');await overlay.scrollIntoViewIfNeeded();
  return overlay.evaluate((svg,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},point);
}
async function tap(point){const q=await at(point);await page.mouse.click(q.x,q.y);}
try{
  await page.goto(base);await openPlan();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)',{exact:true}).setInputFiles(fixture);
  await page.getByTestId('automatic-scale-suggestion').waitFor({timeout:90000});
  assert.equal((await project()).floorPlans[0].mmPerPx,undefined);
  assert.match(await page.getByTestId('automatic-scale-suggestion').innerText(),/Bedroom 3/);
  await page.locator('.fp-workspace').screenshot({path:`${out}/01-real-scale.png`});
  pass('The real three-floor image yields a scale preview from readable OCR without applying it');
  await button('Confirm scale & find rooms').click();
  await page.getByTestId('mode-detected-rooms').waitFor();
  const scaled=(await project()).floorPlans[0];
  assert(scaled.mmPerPx>18&&scaled.mmPerPx<20);
  assert.equal(await page.getByTestId('detected-staircase-overlay').count(),3);
  assert.equal((await project()).staircases.length,0);
  await page.locator('.fp-workspace').screenshot({path:`${out}/02-room-stair-review.png`});
  const roomChecks=page.getByRole('checkbox',{name:/Include detected room/});
  for(let i=0;i<await roomChecks.count();i++)await roomChecks.nth(i).uncheck();
  const checkboxes=page.getByRole('checkbox',{name:/Include detected staircase/});
  for(let i=0;i<3;i++){
    await checkboxes.nth(i).check();
    await page.getByLabel('Detected staircase risers',{exact:true}).fill('14');
    await page.getByLabel('Detected staircase risers',{exact:true}).press('Tab');
  }
  await button('Add 3 selected spaces').click();
  const saved=await project();
  assert.equal(saved.staircases.length,3);assert.equal(saved.rooms.length,0);
  assert(saved.staircases.every(stair=>stair.steps.length===14&&stair.source&&/Estimated from/.test(stair.notes)));
  await page.reload();assert.deepEqual((await project()).staircases,saved.staircases);
  pass('All three stair footprints are review-only, accept corrected counts and survive reload');

  // Put a curved detection outline around the first-floor landing doorway, matching the report.
  const points=[{x:512,y:94},{x:802,y:94},{x:802,y:505},{x:632,y:505},{x:632,y:248},{x:611,y:248},{x:608,y:234},{x:598,y:225},{x:578,y:218},{x:578,y:248},{x:512,y:248}];
  const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  const repair={...saved,id:`${saved.id}-door-check`,rooms:[{id:'door-check',name:'Living',productId:saved.products[0].id,shape:{kind:'polygon',points:points.map(p=>({x:Math.round((p.x-minX)*scaled.mmPerPx),y:Math.round((p.y-minY)*scaled.mmPerPx)}))},doorways:[],subfloor:'timber',source:{floorPlanId:scaled.id,pixelPolygon:points}}],staircases:[]};
  await page.evaluate(({key,value})=>{const stored=JSON.parse(localStorage.getItem(key));stored.project=value;localStorage.setItem(key,JSON.stringify(stored));},{key:storage,value:repair});
  await page.reload();await openPlan();await tap({x:730,y:290});await button('Mark doorway').click();
  const cursor=await at({x:578,y:248});await page.mouse.move(cursor.x,cursor.y);
  assert(await page.getByTestId('precision-zoom').isVisible());
  await tap({x:578,y:248});await tap({x:611,y:248});
  assert(await page.getByTestId('straight-doorway-outline').isVisible());
  assert.equal((await project()).rooms[0].doorways.length,0);
  await page.locator('.fp-workspace').screenshot({path:`${out}/03-doorway-repair.png`});
  await button('Add doorway').click();
  const corrected=(await project()).rooms[0];
  assert.equal(corrected.doorways.length,1);assert(corrected.doorways[0].width>500&&corrected.doorways[0].width<800);
  assert(corrected.source.pixelPolygon.length<points.length);
  pass('The reported door-swing outline straightens into a saved threshold with a precise placement preview');
  for(const width of[768,390]){
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow at${width}px`);
  }
  await page.locator('.fp-workspace').screenshot({path:`${out}/04-phone.png`});
  assert.deepEqual(errors,[]);
  pass('Floor-plan review and editing fit phone and tablet layouts without browser errors');
  await writeFile(`${out}/report.json`,JSON.stringify({checks,errors,scale:scaled.mmPerPx},null,2));
}catch(error){await page.screenshot({path:`${out}/failure.png`,fullPage:true});await writeFile(`${out}/report.json`,JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
