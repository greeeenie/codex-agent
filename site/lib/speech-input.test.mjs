import test from 'node:test';import assert from 'node:assert/strict';import {startDictation} from './speech-input.mjs';
test('dictation combines speech results with the draft and cleans up microphone events',()=>{
 let instance;class Recognition{constructor(){instance=this;}start(){}stop(){this.onend();}abort(){this.aborted=true;}}
 let text,listening;const session=startDictation(Recognition,{text:'Задача:',onText:t=>text=t,onListening:v=>listening=v,onError:()=>assert.fail('unexpected error')});
 assert.equal(listening,true);instance.onresult({results:[[{transcript:'добавить кнопку'}]]});assert.equal(text,'Задача: добавить кнопку');instance.onresult({results:[[{transcript:'добавить чёрную кнопку'}]]});assert.equal(text,'Задача: добавить чёрную кнопку');session.stop();assert.equal(listening,false);session.dispose();assert.equal(instance.aborted,true);assert.equal(instance.onresult,null);
});
test('unsupported browsers and denied microphone permission surface actionable errors',()=>{
 let error,listening;const callbacks={text:'',onText:()=>{},onListening:v=>listening=v,onError:v=>error=v};assert.equal(startDictation(null,callbacks),null);assert.match(error,/Chrome/);
 let instance;class Recognition{constructor(){instance=this;}start(){}abort(){}}
 const session=startDictation(Recognition,callbacks);instance.onerror({error:'not-allowed'});assert.equal(listening,false);assert.match(error,/доступ к микрофону/);session.dispose();
});
