(() => {
  const channel = new URLSearchParams(location.search).get('channel');
  if (!channel || parent === window) return;
  let enabled = false, ready = false, current = {}, signature = '', trackActivity = false;
  const pending = new Map(), listeners = new Set();
  const send = message => parent.postMessage({...message, channel}, '*');
  const display = () => {
    document.querySelectorAll('[sag-output]').forEach(container => {
      const result = current[container.getAttribute('sag-output')];
      container.replaceChildren();
      if (!result) return;
      const list = document.createElement('dl');
      for (const [key, value] of Object.entries(result.data)) {
        const name = document.createElement('dt'), detail = document.createElement('dd');
        name.textContent = key;
        detail.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
        list.append(name, detail);
      }
      container.append(list);
    });
  };
  const input = (node, data) => new Promise((resolve, reject) => {
    if (!ready || !enabled) return reject(new Error('请先启动或继续世界'));
    if (pending.size >= 8) return reject(new Error('请等待当前操作完成'));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('SAG 工作台未响应')); }, 60000);
    pending.set(requestId, {resolve, reject, timer});
    send({type: 'sag:input', requestId, node, input: data});
  });
  window.SAG = Object.freeze({
    input,
    onOutput(listener) {
      listeners.add(listener);
      if (ready) listener(structuredClone(current));
      return () => listeners.delete(listener);
    }
  });
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    const message = event.data;
    if (message.type === 'sag:view') {
      ready = true; enabled = message.enabled === true;
      trackActivity = message.trackActivity === true;
      document.querySelectorAll('form[sag-entry-input] button[type="submit"],form[sag-entry-input] button:not([type]),form[sag-entry-input] input[type="submit"]').forEach(button => { button.disabled = !enabled; });
      const next = JSON.stringify(message.outputs || {});
      if (next === signature) return;
      signature = next; current = message.outputs || {};
      display();
      for (const listener of listeners) {
        try { listener(structuredClone(current)); } catch (error) { console.error(error); }
      }
    } else if (message.type === 'sag:result' || message.type === 'sag:error') {
      const request = pending.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.requestId);
      if (message.type === 'sag:error') request.reject(new Error(message.error));
      else request.resolve({runId: message.runId});
    }
  });
  function submit(element) {
    const fields = Object.create(null);
    element.querySelectorAll('input[name],select[name],textarea[name]').forEach(field => {
      if (field.disabled || (field.type === 'radio' && !field.checked)) return;
      if (field.type === 'number' || field.type === 'range') {
        if (field.value.trim()) fields[field.name] = Number(field.value);
      } else if (field.type === 'checkbox') fields[field.name] = field.checked;
      else fields[field.name] = field.value;
    });
    const target = document.querySelector('[sag-error]');
    if (target) target.textContent = '';
    input(element.getAttribute('sag-entry-input'), fields).catch(error => {
      if (target) target.textContent = error.message;
      else console.error(error);
    });
  }
  document.addEventListener('submit', event => {
    if (event.target.matches('form[sag-entry-input]')) { event.preventDefault(); submit(event.target); }
  });
  let lastActivity = -Infinity;
  const reportActivity = event => {
    const now = performance.now();
    if (!trackActivity || !event.isTrusted || now - lastActivity < 1000) return;
    lastActivity = now;
    send({type: 'sag:activity'});
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'])
    window.addEventListener(type, reportActivity, {passive: true});
  const start = () => { display(); send({type: 'sag:ready'}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
