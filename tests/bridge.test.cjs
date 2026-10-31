const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const fields=Object.fromEntries(Object.entries({crseSeqCd:'course',lsnSn:'10002',contNo:'1',nextLsnSn:'10003'}).map(([k,v])=>[k,{value:v}]));
 let now=100000,current=95,ended=false,rate=8,volume=1,muted=false;
 const playerEvents={};
 const calls=[],activity=[],hooks={},intervals=[],listeners=[],pending=new Map();
 const completion={textContent:'진행 중'};
 function MouseEvent(type,settings){this.type=type;this.settings=settings;this.isTrusted=false;}
 function target(name){return {getBoundingClientRect:()=>({left:0,top:0,width:640,height:360}),dispatchEvent:event=>{activity.push({name,event});return true;}};}
 const video=target('video');
 const document={querySelector(s){if(s==='video')return video;if(s==='#detailForm')return {};if(s==='#cmptnNm')return completion;if(s==='.player-area h3')return {textContent:'영상'};return fields[s.replace('#detailForm #','')]||null;}};
 const $=()=>({on(name,fn){hooks[name]=fn;}});$.commandSubmit=data=>calls.push(['next',data]);
 const window={document,MouseEvent,$,player:{volume(v){if(v!==undefined)volume=v;return volume;},muted(v){if(v!==undefined)muted=v;return muted;},on(name,fn){playerEvents[name]=fn;},duration:()=>1444,currentTime:()=>current,ended:()=>ended,playbackRate(v){if(v!==undefined)rate=v;return rate;},play:async()=>calls.push('play'),pause:()=>calls.push('pause')},addEventListener(_,fn){listeners.push(fn);},postMessage(msg){pending.get(msg.id)?.(msg);}};
 window.parent=window;
 if(options.parent){const parent={MouseEvent,document:{querySelector:()=>null,body:target('parent')}};parent.parent=parent;window.parent=parent;}
 if(options.crossOrigin){const parent={};Object.defineProperty(parent,'document',{get(){throw new Error('cross origin');}});window.parent=parent;}
 const context=vm.createContext({window,document,URL,location:{href:'https://edu.kotsa.or.kr/user/learn/LearnLessonUserView.do'},sessionStorage:{getItem:name=>name==='ts-kotsa-auto-v3'&&options.disabled?'false':null,setItem(){}},setInterval(fn){intervals.push(fn);return 1;},setTimeout,clearTimeout,Date:class extends Date{static now(){return now;}},Promise});
 const source=fs.readFileSync('extension/bridge.js','utf8');vm.runInContext(source,context);
 let sequence=0;
 return {window,fields,calls,activity,completion,intervals,video,playerEvents,
  advance(ms){now+=ms;intervals[0]();},end(){current=1444;ended=true;},rerun(){vm.runInContext(source,context);},
  send(action,setting){const id=String(++sequence);return new Promise(resolve=>{pending.set(id,resolve);listeners[0]({source:window,data:{type:'ts-kotsa-helper:v6:request',id,action,setting}});});},
  response(result,{kind='End',beforeComplete}={}){const xhr={status:200,responseJSON:{status:'SUCCESS',value:result}};const settings={url:`/user/learn/LearnAttendUser${kind}Insert.do`};hooks['ajaxSend.tsKotsaV6'](null,xhr,settings);beforeComplete?.();hooks['ajaxComplete.tsKotsaV6'](null,xhr,settings);}
 };
}
test('playback returns to normal speed without exposing speed choices',async()=>{const f=fixture();await settle();assert.equal(f.window.player.playbackRate(),1);});
test('activity is an ordinary bubbling mousemove every 30 seconds',async()=>{const f=fixture();await settle();const initial=f.activity.length;assert.equal(initial,1);f.advance(29999);assert.equal(f.activity.length,initial);f.advance(1);assert.equal(f.activity.length,initial+1);assert.equal(f.activity[0].event.type,'mousemove');assert.equal(f.activity[0].event.isTrusted,false);assert.equal(f.activity[0].event.settings.bubbles,true);});
test('activity reaches same-origin parent documents',async()=>{const f=fixture({parent:true});await settle();assert.deepEqual(f.activity.map(x=>x.name),['video','parent']);});
test('cross-origin parent is skipped without blocking video event',async()=>{const f=fixture({crossOrigin:true});await settle();assert.equal(f.activity.length,1);assert.match((await f.send('status')).data.activityReport,/다른 도메인/);});
test('activity can be disabled',async()=>{const f=fixture();await settle();await f.send('activity',false);const count=f.activity.length;f.advance(60000);assert.equal(f.activity.length,count);assert.equal((await f.send('status')).data.activityEnabled,false);});
test('automatic stop also stops activity events',async()=>{const f=fixture();await settle();await f.send('pause');const count=f.activity.length;f.advance(60000);assert.equal(f.activity.length,count);assert.equal((await f.send('status')).data.continuous,false);});
test('disabled auto mode sends no activity on install',async()=>{const f=fixture({disabled:true});await settle();f.advance(60000);assert.equal(f.activity.length,0);assert.equal(f.calls.length,0);});
test('does not navigate before video ends even if completed',()=>{const f=fixture();f.completion.textContent='완료';f.advance(30000);assert.equal(f.calls.some(c=>c[0]==='next'),false);});
test('checks completed ended lesson after 30 seconds',()=>{const f=fixture();f.end();f.response({cmptnYn:'Y',lsnSn:10002,contNo:1});f.advance(29999);assert.equal(f.calls.some(c=>c[0]==='next'),false);f.advance(1);assert.equal(f.calls.filter(c=>c[0]==='next').length,1);f.advance(30000);assert.equal(f.calls.filter(c=>c[0]==='next').length,1);});
test('site completion label is sufficient when response was not observed',()=>{const f=fixture();f.end();f.completion.textContent='완료';f.advance(30000);assert.equal(f.calls.filter(c=>c[0]==='next').length,1);});
test('server refusal keeps the lesson open',async()=>{const f=fixture();f.end();f.response({cmptnYn:'N',rmnngLrngTime:1232,lsnSn:10002,contNo:1});f.advance(30000);assert.equal((await f.send('status')).data.remaining,1232);assert.equal(f.calls.some(c=>Array.isArray(c)),false);});
test('evaluation and final lesson do not auto navigate',()=>{const f=fixture();f.end();f.response({cmptnYn:'Y',lsnSn:10002,exam:{paperCnt:1}});f.advance(30000);assert.equal(f.calls.some(c=>c[0]==='next'),false);const last=fixture();last.end();last.completion.textContent='완료';last.fields.nextLsnSn.value='';last.advance(30000);assert.equal(last.calls.some(c=>c[0]==='next'),false);});
test('late response for another lesson is ignored',async()=>{const f=fixture();f.response({cmptnYn:'Y',lsnSn:10002},{beforeComplete(){f.fields.lsnSn.value='10003';}});assert.equal((await f.send('status')).data.completed,false);});
test('reinjection does not duplicate timers',()=>{const f=fixture();f.rerun();assert.equal(f.intervals.length,1);});
test('no End sender, raw network requests, seeking, or UI speed and End options remain',()=>{const source=fs.readFileSync('extension/bridge.js','utf8');assert.doesNotMatch(source,/commandConfirm|fnCmdEndObject|fnEndObject|attemptDurationEnd|fetch\(|XMLHttpRequest/);assert.doesNotMatch(source,/currentTime\(\s*[^)\s]/);assert.doesNotMatch(fs.readFileSync('extension/content.js','utf8'),/id="speed"|id="periodic"|data-action="end"/);});

test('new lesson is silent before its first playback',async()=>{const f=fixture();await settle();assert.equal(f.window.player.volume(),0);assert.equal(f.window.player.muted(),true);assert.equal(f.video.volume,0);assert.equal(f.video.muted,true);});
test('late metadata restores zero volume and mute',async()=>{const f=fixture();await settle();f.window.player.volume(1);f.window.player.muted(false);f.playerEvents.loadedmetadata();assert.equal(f.window.player.volume(),0);assert.equal(f.window.player.muted(),true);});
test('subsequent lesson is muted again without forcing manual changes every tick',async()=>{const f=fixture();await settle();f.window.player.volume(0.5);f.window.player.muted(false);f.advance(1000);assert.equal(f.window.player.volume(),0.5);f.fields.lsnSn.value='10003';f.advance(1000);await settle();assert.equal(f.window.player.volume(),0);assert.equal(f.window.player.muted(),true);});
