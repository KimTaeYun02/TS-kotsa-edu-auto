(() => {
  'use strict';
  if (window.__tsKotsaContentV6) return;
  window.__tsKotsaContentV6 = true;
  let host;
  let ui;
  let working = false;
  let sequence = 0;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'ts-kotsa-helper:v6:response') return;
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(event.data.id);
    event.data.ok ? item.resolve(event.data.data) : item.reject(new Error(event.data.error));
  });
  function request(action, setting) {
    const id = `${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('응답 시간이 초과되었습니다. 페이지를 새로고침해 주세요.'));
      }, 40000);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ type: 'ts-kotsa-helper:v6:request', id, action, setting }, '*');
    });
  }
  const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function show(message, error = false) {
    ui.querySelector('#message').textContent = message;
    ui.querySelector('#message').classList.toggle('error', error);
  }
  async function refresh() {
    if (!host || working) return;
    try {
      const s = await request('status');
      ui.querySelector('#title').textContent = s.title;
      ui.querySelector('#progress').textContent = `${time(s.current)} / ${time(s.duration)} · ${s.completed ? '완료' : '진행 중'}`;
      ui.querySelector('#server').textContent = s.remaining === null ? '서버 남은 시간: 아직 응답 없음' : `서버 남은 시간: ${time(s.remaining)}`;
      ui.querySelector('#continuous').checked = s.continuous;
      ui.querySelector('#activity').checked = s.activityEnabled;
      ui.querySelector('#automation').textContent = s.continuous ? `다음 차시 확인 ${s.checkIn}초 후` : '자동 이동 중지';
      ui.querySelector('#activity-status').textContent = s.activityEnabled ? (s.lastActivity ? `활동 시도 ${s.activityCount}회 · ${s.lastActivity} · ${s.activityReport}` : '활동 유지 시도 대기 중') : '활동 유지 시도 꺼짐';
      ui.querySelector('#diagnostic').textContent = s.lastResponse ? `최근 저장: ${s.lastResponse.kind} · ${s.lastResponse.time}` : (s.hooked ? '서버 응답 대기 중' : '사이트 응답 감지를 연결하지 못했습니다.');
      if (s.notice) show(s.notice, !s.completed);
      ui.querySelector('[data-action="next"]').disabled = !s.completed || !s.hasNext || s.busy || s.needsAction;
    } catch (e) { show(e.message, true); }
  }
  function mount() {
    const supported = document.querySelector('video') && document.querySelector('#detailForm');
    if (!supported) {
      host?.remove(); host = null; return;
    }
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'ts-kotsa-helper';
    host.style.cssText = 'position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;';
    ui = host.attachShadow({ mode: 'open' });
    ui.innerHTML = `
      <style>
        :host{font-family:system-ui,sans-serif;color:#152033;font-size:13px}
        section{width:min(320px,calc(100vw - 48px));background:#fff;border:1px solid #cdd6e4;border-radius:14px;box-shadow:0 8px 32px #14213d30;padding:16px}
        header{display:flex;align-items:center;justify-content:space-between;gap:12px}strong{font-size:15px}p{line-height:1.5;margin:10px 0;overflow-wrap:anywhere}
        #title{max-height:60px;overflow:auto;color:#59677c}#progress{font-variant-numeric:tabular-nums}#message{min-height:38px;color:#235a45}.error{color:#b32323!important}
        .buttons{display:flex;flex-wrap:wrap;gap:6px}button{font:inherit;border:1px solid #cdd6e4;border-radius:7px;padding:8px 10px;background:#f5f7fa;color:#152033;cursor:pointer}button.primary{background:#174fb8;color:white;border-color:#174fb8}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:3px solid #64a4ff;outline-offset:2px}
        #toggle{border:0;padding:4px}small{display:block;color:#667386;line-height:1.4;margin-top:12px}[hidden]{display:none!important}
      </style>
      <section aria-label="TS 학습 도우미"><header><strong>TS 학습 도우미 1.6.1</strong><button id="toggle" aria-expanded="true">접기</button></header>
      <div id="body"><p id="title">플레이어 확인 중…</p><p id="progress"></p><p id="server"></p><p id="automation"></p>
      <div class="buttons"><button class="primary" data-action="play">자동 시작</button><button data-action="pause">자동 중지</button><button data-action="next" disabled>다음 차시</button></div>
      <p><label><input id="continuous" type="checkbox"> 자동 재생 · 30초마다 다음 차시 확인</label></p>
      <p><label><input id="activity" type="checkbox"> 활동 유지 시도 · 30초마다 마우스 이동 이벤트</label></p><small id="activity-status"></small>
      <p id="message" role="status" aria-live="polite">일반 속도로 재생하며 완료된 차시를 자동으로 넘깁니다.</p><small id="diagnostic"></small><small>사이트에서 완료가 확인된 차시만 이동합니다. 별도 완료 요청은 보내지 않습니다. 활동 이벤트는 실제 마우스 입력과 달라 사이트가 무시할 수 있습니다.</small></div></section>`;
    ui.querySelector('#toggle').addEventListener('click', event => {
      const body = ui.querySelector('#body');
      body.hidden = !body.hidden;
      event.currentTarget.textContent = body.hidden ? '펼치기' : '접기';
      event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
    });
    async function configure(action, setting) {
      if (working) return;
      working = true;
      try { const result = await request(action, setting); show(result.message); }
      catch (e) { show(e.message, true); }
      finally { working = false; await refresh(); }
    }
    ui.querySelector('#activity').addEventListener('change',event => configure('activity',event.target.checked));
    ui.querySelector('#continuous').addEventListener('change', event => configure('continuous', event.target.checked));
    ui.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
      if (working) return;
      working = true;
      ui.querySelectorAll('[data-action]').forEach(b => { b.disabled = true; });
      show('처리 중입니다…');
      try { const result = await request(button.dataset.action); show(result.message); }
      catch (e) { show(e.message, true); }
      finally {
        working = false;
        ui.querySelectorAll('[data-action]').forEach(b => { b.disabled = false; });
        await refresh();
      }
    }));
    document.documentElement.append(host);
    refresh();
  }
  mount();
  setInterval(() => { mount(); refresh(); }, 2000);
})();
