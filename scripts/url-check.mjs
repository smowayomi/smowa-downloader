import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await fs.readFile('extension/popup.js','utf8');
for(const url of ['https://example.com/watch?v=1&t=2','file:///C:/test','https://user:pass@example.com']) {
 const elements=Object.fromEntries(['send','status','details'].map(id=>[id,{textContent:'',removeAttribute(){},hasAttribute(k){return !!this[k]},addEventListener(){}}]));
 vm.runInNewContext(source,{document:{getElementById:id=>elements[id]},chrome:{tabs:{query:async()=>[{url}]}},URL,encodeURIComponent});
 await new Promise(r=>setTimeout(r,0));
 if(url.startsWith('https://example.com')) assert.equal(elements.send.href,'smowadl://download?url='+encodeURIComponent(url));
 else assert.equal(elements.send.href,undefined);
}
console.log('Popup app-link routing and invalid URL checks passed.');
