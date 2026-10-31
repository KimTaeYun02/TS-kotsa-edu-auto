'use strict';
const results = document.querySelector('#results');
const statusLine = document.querySelector('#status');
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render(data) {
  results.replaceChildren();
  statusLine.textContent = `열린 탭 ${data.totalTabs}개 · 학습 탭 ${data.targetTabs}개`;
  if (!data.reports.length) results.append(element('p','학습 탭을 찾지 못했습니다. 이 확장 프로그램이 설치된 Chrome 창에서 교육 페이지를 열어 주세요.'));
  for (const tab of data.reports) {
    const card = element('article');
    card.append(element('h2',tab.title),element('code',tab.url));
    const apply = element('button','이 탭에 JS 적용');
    apply.addEventListener('click',() => perform('apply-tab',tab.tabId));
    card.append(element('p')).append(apply);
    if (tab.error) card.append(element('p',tab.error,'error'));
    const list = element('ul');
    for (const frame of tab.frames) {
      const item = element('li');
      item.append(element('code',`${frame.frameId === 0 ? '메인' : `iframe #${frame.frameId}`} · ${frame.url}`));
      if (frame.error) item.append(element('p',frame.error,'error'));
      else {
        const s = frame.state;
        const ready = s.hasPlayer && s.hasForm && s.hasEndFunction;
        item.append(element('p',`영상 ${s.videoCount}개 · 플레이어 ${s.hasPlayer ? '있음' : '없음'} · 폼 ${s.hasForm ? '있음' : '없음'} · 완료 함수 ${s.hasEndFunction ? '있음' : '없음'} · 연결 ${s.bridge ? '있음' : '없음'} · 패널 ${s.panel ? '있음' : '없음'}`, ready ? 'ok' : ''));
        if (ready && !s.panel) item.append(element('small','JS 적용 버튼을 누르면 이 프레임에 패널을 설치합니다.'));
        else if (!ready && s.videoCount) item.append(element('small','영상은 있지만 첨부 문서와 플레이어 구조가 다르거나 아직 로딩 중입니다.'));
        else if (!s.videoCount && s.iframeCount) item.append(element('small','영상은 하위 iframe 검사 결과를 확인하세요.'));
      }
      list.append(item);
    }
    card.append(list);
    results.append(card);
  }
}
async function perform(type,tabId) {
  document.querySelectorAll('button').forEach(b => {b.disabled=true;});
  statusLine.textContent = type === 'scan' ? '탭과 iframe 검사 중…' : '학습 프레임에 JS 적용 및 검사 중…';
  try {
    const response = await chrome.runtime.sendMessage({type,tabId});
    if (!response?.ok) throw new Error(response?.error || '확장 프로그램을 다시 로드해 주세요.');
    render(response.data);
  } catch (error) {statusLine.textContent = error.message;}
  finally {document.querySelectorAll('button').forEach(b => {b.disabled=false;});}
}
document.querySelector('#scan').addEventListener('click',() => perform('scan'));
document.querySelector('#apply').addEventListener('click',() => perform('apply-all'));
perform('scan');
