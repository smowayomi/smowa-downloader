import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page = await browser.newPage();
 const script = await fs.readFile('extension/media-buttons.js','utf8');
 for (const [url,html,expected] of [
  ['https://www.youtube.com/watch?v=abc','<div id="movie_player"><video></video></div>','watch?v=abc'],
  ['https://x.com/home','<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><video></video></article>','/user/status/123'],
  ['https://www.instagram.com/','<article><a href="/reel/abc/">Post</a><video></video></article>','/reel/abc/'],
  ['https://www.tiktok.com/@user/video/123','<video></video>','/video/123'],
 ]) {
  await page.route('**/*',r=>r.fulfill({body:`<style>video{width:400px;height:300px}</style>${html}`,contentType:'text/html'}));
  await page.goto(url);
  // Open shadow roots only in this fixture to inspect the production control.
  await page.evaluate(()=>{const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){return original.call(this,{...o,mode:'open'})};});
  await page.addScriptTag({content:script});
  const a=page.getByRole('link',{name:'Download with SmowaDL'});
  assert.equal(await a.count(),1);
  assert.ok(decodeURIComponent(await a.getAttribute('href')).includes(expected));
  await page.evaluate(()=>document.querySelector('video').remove());
  await page.waitForTimeout(600);
  assert.equal(await a.count(),0);
  await page.unroute('**/*');
 }
 console.log('Four platform fixtures passed: associated media URL, one control, removal.');
} finally {await browser.close();}
