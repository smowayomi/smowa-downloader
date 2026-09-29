import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
await fs.mkdir('.preview', {recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5182,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const p=await browser.newPage({viewport:{width:880,height:620},reducedMotion:'no-preference'});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  window.testJobs=[{id:'active',title:'A walk through Kyoto',url:'https://example.com/one',status:'downloading',phase:'Fetching video',percent:20,downloaded_bytes:2097152,total_bytes:10485760,speed:'2 MiB/s',eta:'00:04',created:100,error:'',file:'',options:{format:'mp4',resolution:1080}},{id:'second',title:'Studio session',url:'https://example.com/two',status:'queued',queue_order:1,percent:0,created:99,error:'',options:{format:'m4a'}},{id:'third',title:'The weekend edit',url:'https://example.com/three',status:'queued',queue_order:2,percent:0,created:98,error:'',options:{format:'mp4',resolution:720}}];
  window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
   if(cmd==='defaults')return{folder:'C:\\Downloads'};
   if(cmd==='snapshot')return{jobs:structuredClone(window.testJobs),pending:[],storageError:''};
   if(cmd==='health')return{'yt-dlp':true,ffmpeg:true,node:true};
   if(cmd==='engine_details')return{busy:false,tools:[]};
   if(cmd==='engine_status')return'';
   if(cmd==='inspect_video')return new Promise(resolve=>window.finishInspection=()=>resolve({title:'A walk through Kyoto',url:args.url,duration:120,formats:[{height:1080,vcodec:'avc1',acodec:'aac'}]}));
  }};
 });
 await p.goto('http://127.0.0.1:5182');await p.getByRole('button',{name:'History/Queue'}).click();
 if(!await p.locator('.tab-indicator').evaluate(el=>el.getAnimations().some(a=>a.playState==='running')))throw Error('Tab transition did not start');
 await expect.poll(()=>p.locator('.tab-indicator').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 const checkPill=()=>p.evaluate(()=>{const a=document.querySelector('.top-tabs [aria-current=page]').getBoundingClientRect(),b=document.querySelector('.tab-indicator').getBoundingClientRect();return Math.max(Math.abs(a.x-b.x),Math.abs(a.width-b.width));});
 if(await checkPill()>1)throw Error('Tab highlight is misaligned');
 await p.evaluate(()=>{window.originalRow=document.querySelector('[data-job="active"]');window.originalProgress=window.originalRow.querySelector('progress');window.originalAction=window.originalRow.querySelector('button');window.originalAction.focus();window.testJobs[0].percent=55;window.testJobs[0].downloaded_bytes=5767168;});
 await expect(p.locator('[data-job="active"] progress')).toHaveAttribute('value','55');
 if(!await p.evaluate(()=>document.querySelector('[data-job="active"]')===window.originalRow&&window.originalRow.querySelector('progress')===window.originalProgress&&document.activeElement===window.originalAction))throw Error('Progress update replaced controls or lost focus');
 if(await p.locator('[data-job="active"]').evaluate(el=>el.getAnimations().length))throw Error('Progress update restarted entry animation');
 await p.evaluate(()=>{window.testJobs[1].queue_order=2;window.testJobs[2].queue_order=1;});
 await expect.poll(()=>p.locator('#history-list .job').evaluateAll(rows=>rows.map(r=>r.dataset.job).join(','))).toBe('active,third,second');
 await p.evaluate(()=>{document.querySelector('[data-page="downloads"]').click();document.querySelector('[data-page="settings"]').click();document.querySelector('[data-page="history"]').click();});
 await expect(p.locator('#history-page')).toBeVisible();await expect(p.locator('#settings-page')).toBeHidden();
 await expect.poll(()=>p.locator('.tab-indicator').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 if(await checkPill()>1)throw Error('Interrupted navigation left stale highlight');
 await p.screenshot({path:'.preview/motion-history-880.png'});
 await p.getByRole('button',{name:'Downloader',exact:true}).click();await p.locator('#url').fill('https://example.com/one');await p.locator('#analyze').click();
 await expect(p.locator('#analyze-form')).toHaveAttribute('aria-busy','true');
 if(await p.locator('#analyze').evaluate(el=>getComputedStyle(el,'::before').animationName)!=='busy-turn')throw Error('Loading feedback missing');
 await p.emulateMedia({reducedMotion:'reduce'});
 await expect.poll(()=>p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await p.evaluate(()=>window.finishInspection());await expect(p.locator('#options')).toBeVisible();
 await p.locator('.advanced-options summary').click();await p.locator('#clip-enabled').check();
 if(await p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length))throw Error('Reduced motion is ignored');
 for(const width of [880,640]){
  await p.setViewportSize({width,height:width===640?480:620});
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow at '+width);
  await expect.poll(checkPill).toBeLessThan(1);
  await p.screenshot({path:'.preview/motion-trim-'+width+'.png',fullPage:true});
 }
 await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('#clip-enabled').uncheck();await p.locator('#clip-enabled').check();
 await expect.poll(()=>p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS stable progress nodes and keyboard focus, queue reordering, rapid navigation, responsive tab alignment, loading feedback, live reduced-motion switching and idle animation cleanup');
} finally {await browser.close();await server.close();}
