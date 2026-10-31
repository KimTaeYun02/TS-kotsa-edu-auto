const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture({failInjection=false, navigated=false}={}) {
  let listener;
  const scripts=[];
  const tabs=[{id:1,title:'학습',url:navigated?'https://example.com/':'https://edu.kotsa.or.kr/user/learn/LearnUserMain.do?private=secret'},{id:2,url:'https://unrelated.example/'},{id:3,title:'다른 학습',url:'https://edu.kotsa.or.kr/user/learn/LearnLessonUserView.do'}];
  const frames=[{frameId:0,parentFrameId:-1,url:'https://edu.kotsa.or.kr/user/learn/LearnUserMain.do'}, {frameId:2,parentFrameId:0,url:'https://edu.kotsa.or.kr/user/learn/LearnLessonUserView.do?id=secret'}, {frameId:3,parentFrameId:2,url:'about:blank'}, {frameId:4,parentFrameId:0,url:'https://other.example/embed'}, {frameId:5,parentFrameId:4,url:'about:blank'}];
  const chrome={
    tabs:{query:async()=>tabs},
    webNavigation:{getAllFrames:async()=>frames},
    scripting:{executeScript:async input=>{
      scripts.push(input);
      if (failInjection && input.files && input.target.frameIds[0]===2) throw new Error('Cannot access frame');
      return [{result:{videoCount:1,hasForm:true,hasPlayer:true,hasEndFunction:true,panel:!!scripts.find(s=>s.files?.includes('content.js') && s.target.tabId===input.target.tabId && s.target.frameIds[0]===input.target.frameIds[0])}}];
    }},
    runtime:{id:'our-extension',onMessage:{addListener(fn){listener=fn;}}}
  };
  vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),{chrome,URL});
  return {scripts, send:message=>new Promise(resolve=>listener(message,{id:'our-extension'},resolve)), listener};
}
test('scan counts every tab, inspects site frames and excludes unrelated origins',async()=>{
  const f=fixture();const response=await f.send({type:'scan'});
  assert.equal(response.ok,true);
  assert.equal(response.data.totalTabs,3);assert.equal(response.data.targetTabs,2);
  assert.equal(f.scripts.length,6);
  assert.ok(f.scripts.every(s=>!s.files && [0,2,3].includes(s.target.frameIds[0])));
  assert.equal(response.data.reports[0].frames[3].error.includes('다른 도메인'),true);
  assert.equal(JSON.stringify(response).includes('secret'),false);
});
test('apply injects MAIN before ISOLATED into each permitted frame',async()=>{
  const f=fixture();const response=await f.send({type:'apply-tab',tabId:1});
  assert.equal(response.ok,true);assert.equal(f.scripts.length,9);
  assert.ok(f.scripts.every(s=>s.target.tabId===1));
  assert.equal(f.scripts[0].world,'MAIN');assert.equal(f.scripts[0].files[0],'bridge.js');
  assert.equal(f.scripts[1].world,'ISOLATED');assert.equal(f.scripts[1].files[0],'content.js');
  assert.equal(response.data.reports[0].frames[1].state.panel,true);
});
test('one frame injection error is reported without blocking other frames',async()=>{
  const f=fixture({failInjection:true});const response=await f.send({type:'apply-all'});
  assert.equal(response.ok,true);assert.equal(response.data.reports.length,2);
  assert.equal(response.data.reports[0].frames[1].error,'Cannot access frame');
  assert.equal(response.data.reports[0].frames[2].state.panel,true);
});
test('changed tab URL prevents injection into unrelated destination',async()=>{
  const f=fixture({navigated:true});const response=await f.send({type:'apply-tab',tabId:1});
  assert.equal(response.ok,false);assert.equal(f.scripts.length,0);
});
test('unknown messages and other extensions cannot trigger injection',()=>{
  const f=fixture();
  assert.equal(f.listener({type:'apply-all'},{id:'other'},()=>{}),undefined);
  assert.equal(f.listener({type:'complete'},{id:'our-extension'},()=>{}),undefined);
  assert.equal(f.scripts.length,0);
});
