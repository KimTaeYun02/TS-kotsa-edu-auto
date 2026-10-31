'use strict';
const SITE = 'https://edu.kotsa.or.kr';
function isSite(url) {
  try { return new URL(url).origin === SITE; } catch { return false; }
}
function safeUrl(url) {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return url || ''; }
}
// Inspect only; never start playback or send a completion request during diagnosis.
function inspectFrame() {
  const p = window.player;
  return {
    videoCount: document.querySelectorAll('video').length,
    iframeCount: document.querySelectorAll('iframe,frame').length,
    hasForm: Boolean(document.querySelector('#detailForm')),
    hasPlayer: Boolean(p && typeof p.play === 'function' && typeof p.duration === 'function'),
    hasEndFunction: typeof window.fnCmdEndObject === 'function',
    bridge: Boolean(window.__tsKotsaBridgeV1),
    panel: Boolean(document.querySelector('#ts-kotsa-helper')),
    readyState: document.readyState
  };
}
function supportedFrames(frames) {
  const allowed = new Set(frames.filter(f => isSite(f.url)).map(f => f.frameId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of frames) {
      if (/^(about:(blank|srcdoc)|blob:https:\/\/edu\.kotsa\.or\.kr\/)/.test(f.url) &&
          allowed.has(f.parentFrameId) && !allowed.has(f.frameId)) {
        allowed.add(f.frameId); changed = true;
      }
    }
  }
  return frames.filter(f => allowed.has(f.frameId));
}
async function inspectTab(tab, inject) {
  const report = { tabId: tab.id, title: tab.title || 'TS 교육', url: safeUrl(tab.url), frames: [] };
  try {
    const frames = await chrome.webNavigation.getAllFrames({tabId:tab.id});
    if (!frames?.length) throw new Error('프레임 목록을 가져오지 못했습니다. 탭 로딩 후 다시 시도하세요.');
    const allowed = supportedFrames(frames);
    const allowedIds = new Set(allowed.map(f => f.frameId));
    for (const frame of frames) {
      const row = {frameId:frame.frameId, parentFrameId:frame.parentFrameId, url:safeUrl(frame.url)};
      report.frames.push(row);
      if (!allowedIds.has(frame.frameId)) {
        row.error = '다른 도메인 프레임: 현재 권한으로 실행하지 않습니다.';
        continue;
      }
      try {
        const target = {tabId:tab.id,frameIds:[frame.frameId]};
        if (inject) {
          await chrome.scripting.executeScript({target,world:'MAIN',files:['bridge.js']});
          await chrome.scripting.executeScript({target,world:'ISOLATED',files:['content.js']});
        }
        const results = await chrome.scripting.executeScript({target,world:'MAIN',func:inspectFrame});
        row.state = results[0]?.result;
        if (!row.state) throw new Error('프레임 검사 결과가 없습니다.');
      } catch (error) { row.error = error.message; }
    }
  } catch (error) { report.error = error.message; }
  return report;
}
async function run(message) {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter(tab => isSite(tab.url));
  const selected = message.type === 'apply-tab' ? targets.filter(t => t.id === message.tabId) : targets;
  if (message.type === 'apply-tab' && !selected.length) throw new Error('해당 학습 탭이 닫혔거나 주소가 변경되었습니다. 다시 검사하세요.');
  const reports = await Promise.all(selected.map(tab => inspectTab(tab, message.type !== 'scan')));
  return {totalTabs:tabs.length, targetTabs:targets.length, reports};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['scan','apply-all','apply-tab'].includes(message?.type)) return;
  run(message).then(data => respond({ok:true,data}), error => respond({ok:false,error:error.message}));
  return true;
});
