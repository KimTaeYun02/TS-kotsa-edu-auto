(() => {
  'use strict';
  if (window.__tsKotsaBridgeV6) return;
  window.__tsKotsaBridgeV6 = true;
  window.__tsKotsaBridgeV1 = true;
  const REQUEST = 'ts-kotsa-helper:v6:request';
  const RESPONSE = 'ts-kotsa-helper:v6:response';
  const value = id => document.querySelector(`#detailForm #${id}`)?.value || '';
  const key = () => `${value('crseSeqCd')}/${value('lsnSn')}/${value('contNo')}`;
  const readPreference = name => { try { return sessionStorage.getItem(name); } catch { return null; } };
  const savePreference = (name, setting) => { try { sessionStorage.setItem(name, String(setting)); } catch {} };
  let continuous = readPreference('ts-kotsa-auto-v3') !== 'false';
  let activityEnabled = readPreference('ts-kotsa-activity-v6') !== 'false';
  let lastActivityAt = Date.now();
  let activityCount = 0;
  let activityReport = '';
  let lastCheckAt = Date.now();
  let playPending = false;
  let busy = false;
  let moving = false;
  let observedKey = key();
  let server = {};
  let notice = '';
  let hooked = false;
  let boundPlayer;
  const requestKeys = new WeakMap();
  function player() {
    const p = window.player;
    if (!document.querySelector('video') || !document.querySelector('#detailForm') ||
        !p || typeof p.play !== 'function' || typeof p.duration !== 'function') {
      throw new Error('학습 영상 플레이어를 찾지 못했습니다. 영상을 연 뒤 다시 시도해 주세요.');
    }
    return p;
  }
  function syncLesson() {
    if (key() !== observedKey) { observedKey = key(); server = {}; moving = false; boundPlayer = null; notice = ''; }
  }
  function status() {
    syncLesson();
    const p = player();
    return {
      title: document.querySelector('.player-area h3')?.textContent.trim().replace(/\s+/g, ' ') || '교육 영상',
      current: Number(p.currentTime()) || 0,
      duration: Number.isFinite(p.duration()) ? p.duration() : 0,
      continuous, busy, hooked, notice, activityEnabled, activityCount, activityReport,
      lastActivity:activityCount ? new Date(lastActivityAt).toLocaleTimeString('ko-KR') : null,
      checkIn: Math.max(0,30-Math.floor((Date.now()-lastCheckAt)/1000)),
      completed: server.completed === true || document.querySelector('#cmptnNm')?.textContent.trim() === '완료',
      hasNext: Boolean(value('nextLsnSn')),
      remaining: server.remaining ?? null,
      needsAction: server.needsAction || false,
      lastResponse: server.lastResponse || null,
      progress: server.progress ?? null
    };
  }
  function silence(p) {
    // Set volume before playback so a newly opened lesson cannot briefly play aloud.
    if (typeof p.volume === 'function') p.volume(0);
    if (typeof p.muted === 'function') p.muted(true);
    const video=document.querySelector('video');
    if (video) {video.volume=0;video.muted=true;}
  }
  async function play() {
    if (playPending) return {message:"재생 시작 중입니다."};
    silence(player());
    playPending = true;
    let timer;
    try {
      await Promise.race([Promise.resolve(player().play()),new Promise((_,reject) => {
        timer = setTimeout(() => reject(new Error('재생을 시작하지 못했습니다. 사이트 재생 버튼을 직접 눌러 주세요.')),10000);
      })]);
    } finally { clearTimeout(timer); playPending = false; }
    const p=player();
    if (typeof p.playbackRate === 'function') p.playbackRate(1);
    if (activityEnabled && continuous) sendActivity();
    return {message:'일반 속도로 재생합니다. 30초마다 완료와 다음 차시를 확인합니다.'};
  }
  function next() {
    const s = status();
    if (!s.completed) throw new Error('서버 또는 사이트에서 완료가 확인되어야 이동할 수 있습니다.');
    if (s.needsAction) throw new Error('사이트에서 평가·설문을 직접 진행해 주세요.');
    const nextLesson = value('nextLsnSn');
    if (!nextLesson) throw new Error('다음 차시가 없습니다. 학습 목록을 확인하세요.');
    if (moving) return {message:'다음 차시로 이동 중입니다.'};
    if (typeof window.$?.commandSubmit !== 'function') throw new Error('사이트 이동 함수를 찾을 수 없습니다.');
    moving = true;
    try {
      document.querySelector('#detailForm #lsnSn').value = nextLesson;
      document.querySelector('#detailForm #contNo').value = '1';
      window.$.commandSubmit({commandUrl:'LearnLessonUserView.do',commandForm:'detailForm'});
    } catch (error) { moving = false; throw error; }
    return {message:'다음 차시로 이동합니다.'};
  }
  function endpoint(url) {
    try {
      const path = new URL(url, location.href).pathname;
      return /\/user\/learn\/LearnAttendUser(Start|Going|End)Insert\.do$/.exec(path)?.[1] || null;
    } catch { return null; }
  }
  function hookResponses() {
    if (hooked || typeof window.$ !== 'function') return;
    const jqDocument = window.$(document);
    if (typeof jqDocument?.on !== 'function') return;
    jqDocument.on('ajaxSend.tsKotsaV6', (_,xhr,settings) => {
      const kind = endpoint(settings.url);
      if (kind) requestKeys.set(xhr,key());
    });
    jqDocument.on('ajaxComplete.tsKotsaV6', (_,xhr,settings) => {
      const kind = endpoint(settings.url);
      if (!kind || requestKeys.get(xhr) !== key()) return;
      syncLesson();
      let payload = xhr.responseJSON;
      try { if (!payload) payload = JSON.parse(xhr.responseText); } catch { return; }
      if (xhr.status < 200 || xhr.status >= 300 || payload?.status !== 'SUCCESS') {
        notice = '사이트 학습 저장 요청이 실패했습니다. 로그인·네트워크 상태를 확인하세요.';
        return;
      }
      const result = payload.value;
      if (!result || typeof result !== 'object') return;
      if (result.lsnSn != null && String(result.lsnSn) !== value('lsnSn')) return;
      if (result.contNo != null && String(result.contNo) !== value('contNo')) return;
      server.lastResponse = {kind,time:new Date().toLocaleTimeString('ko-KR')};
      if (typeof result.rmnngLrngTime === 'number' && Number.isFinite(result.rmnngLrngTime)) {
        server.remaining = Math.max(0,result.rmnngLrngTime);
      }
      if (typeof result.lsnProgRate === 'number') server.progress = result.lsnProgRate;
      if (kind === 'End') {
        if (result.cmptnYn === 'Y') {
          server.completed = true;
          server.needsAction = result.exam?.paperCnt > 0 || result.survey?.paperCnt > 0;
          notice = server.needsAction ? '완료 확인. 사이트에서 평가·설문을 진행하세요.' : '서버에서 완료를 확인했습니다.';
        } else if (result.cmptnYn === 'N') {
          server.completed = false;
          notice = '서버가 아직 미완료로 응답했습니다. 남은 학습 시간을 확인하세요.';
        }
      }
    });
    hooked = true;
  }
  function sendActivity() {
    if (!activityEnabled || !continuous) return;
    lastActivityAt=Date.now();
    let view=window;
    let sent=0;
    let parentBlocked=false;
    // Ordinary DOM events only. Never move the OS pointer or synthesize clicks/keys.
    for (let depth=0;depth<8;depth++) {
      try {
        const doc=view.document;
        const target=doc.querySelector('video') || doc.body || doc.documentElement;
        if (target) {
          const rect=target.getBoundingClientRect();
          const offset=activityCount % 2;
          target.dispatchEvent(new view.MouseEvent('mousemove',{
            bubbles:true,composed:true,cancelable:false,view,
            clientX:Math.round(rect.left+Math.max(0,rect.width/2)+offset),
            clientY:Math.round(rect.top+Math.max(0,rect.height/2)),buttons:0
          }));
          sent++;
        }
        if (!view.parent || view.parent===view) break;
        view=view.parent;
      } catch {parentBlocked=true;break;}
    }
    if (sent) activityCount++;
    activityReport=sent ? `일반 마우스 이벤트: 문서 ${sent}개${parentBlocked ? ' · 다른 도메인 상위 문서는 제외' : ''}` : '마우스 이벤트를 전달하지 못했습니다.';
  }
  function tick() {
    syncLesson();
    hookResponses();
    let p;
    try { p = player(); } catch { return; }
    if (p !== boundPlayer) {
      boundPlayer = p;
      silence(p);
      if (typeof p.on === 'function') p.on('loadedmetadata',() => {if (boundPlayer === p) silence(p);});
      const alreadyEnded = typeof p.ended === 'function' && p.ended();
      if (continuous && !alreadyEnded) play().catch(e => {notice=e.message;});
    }
    if (continuous && activityEnabled && Date.now()-lastActivityAt >= 30000) sendActivity();
    if (!continuous || busy || moving || Date.now()-lastCheckAt < 30000) return;
    lastCheckAt = Date.now();
    const s = status();
    const ended = (typeof p.ended === 'function' && p.ended()) ||
      (s.duration > 0 && s.current >= s.duration - 0.25);
    if (!ended) return;
    if (s.needsAction) { notice = '사이트에서 평가·설문을 직접 진행해 주세요.'; return; }
    if (!s.completed) {
      notice = '영상은 끝났지만 사이트가 아직 미완료입니다. 30초마다 상태만 확인하며 추가 완료 요청은 보내지 않습니다.';
      return;
    }
    if (!s.hasNext) { notice = '마지막 차시입니다. 사이트에서 평가·설문을 확인하세요.'; return; }
    try { next(); } catch (e) {notice=e.message;}
  }
  window.addEventListener('message',async event => {
    if (event.source !== window || event.data?.type !== REQUEST) return;
    const {id,action,setting} = event.data;
    if (typeof id !== 'string' || !['status','play','pause','activity','continuous','next'].includes(action)) return;
    const respond = payload => window.postMessage({type:RESPONSE,id,...payload},'*');
    if (action === 'status') {
      try { respond({ok:true,data:status()}); } catch(e) {respond({ok:false,error:e.message});}
      return;
    }
    if (busy && action !== 'pause') {respond({ok:false,error:'이전 요청을 처리 중입니다.'});return;}
    busy = true;
    try {
      let data;
      if (action === 'play') {continuous=true;savePreference('ts-kotsa-auto-v3',true);data = await play();}
      if (action === 'pause') {continuous=false;savePreference('ts-kotsa-auto-v3',false);player().pause();data={message:'자동 재생과 다음 차시 이동을 중지했습니다.'};}
      if (action === 'continuous') {
        if (typeof setting !== 'boolean') throw new Error('연속 재생 설정이 올바르지 않습니다.');
        continuous = setting;
        savePreference('ts-kotsa-auto-v3',setting);
        if (setting) await play();
        data={message:setting ? '자동 재생과 다음 차시 이동을 켰습니다. 30초마다 완료 상태를 확인합니다.' : '연속 재생을 껐습니다.'};
      }
      if (action === 'activity') {
        if (typeof setting !== 'boolean') throw new Error('활동 유지 설정이 올바르지 않습니다.');
        activityEnabled=setting;savePreference('ts-kotsa-activity-v6',setting);
        if (setting && continuous) sendActivity();
        data={message:setting ? '30초마다 일반 마우스 이벤트를 보냅니다. 실제 입력을 요구하는 사이트에는 적용되지 않을 수 있습니다.' : '활동 유지 시도를 껐습니다.'};
      }
      if (action === 'next') data = next();
      respond({ok:true,data});
    } catch(e) {respond({ok:false,error:e.message || '요청 실패'});}
    finally {busy=false;}
  });
  tick();
  setInterval(tick,1000);
})();
