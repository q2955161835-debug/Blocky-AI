/** Executes in a dedicated CDP isolated world. Never reads field values or key events. */
export const recordingCollector = String.raw`function({binding, removeKey}) {
  const entries = [], indices = new WeakMap();
  const selector = 'button,a[href],input,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],[role="tab"],[role="textbox"],[role="searchbox"]';
  const controls = document.querySelectorAll(selector);
  if (controls.length > 2048) throw Error('BLK-RPA-LIMIT-001');
  for (const element of controls) {
    const type = (element.getAttribute('type') || '').toLowerCase();
    let role = element.getAttribute('role');
    if (!role) {
      if (element.tagName === 'BUTTON') role = 'button';
      else if (element.tagName === 'A') role = 'link';
      else if (element.tagName === 'TEXTAREA') role = 'textbox';
      else if (element.tagName === 'INPUT') role = ['checkbox','radio'].includes(type) ? type : type === 'search' ? 'searchbox' : ['', 'text', 'email', 'tel', 'url'].includes(type) ? 'textbox' : 'unsupported';
    }
    const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).slice(0,8).map(id=>document.getElementById(id)).filter(Boolean);
    const labels = element.labels ? [...element.labels].slice(0,8) : [];
    const dependencies = labelledBy.length ? labelledBy : labels;
    const field = ['INPUT','TEXTAREA'].includes(element.tagName) || ['textbox','searchbox','spinbutton'].includes(role);
    const text = element.getAttribute('aria-label') ?? (dependencies.length ? dependencies.map(node => (node.textContent || '').slice(0,201)).join(' ') : field ? '' : (element.textContent || '').slice(0,201));
    const hints = [type, element.getAttribute('autocomplete'), element.getAttribute('id'), element.getAttribute('name'), text].join(' ');
    const metadata = { locator: {kind:'browser', role, name:text.trim()}, sensitive:/password|secret|api[-_ ]?key|token|one-time-code|cc-number|密码|密钥|验证码/i.test(hints) };
    indices.set(element, entries.length);
    entries.push({element, dependencies:[element,...dependencies], metadata, invalid:false});
  }
  const invalidate = records => {
    if (records.length > 256) { for (const entry of entries) entry.invalid=true; return; }
    for (const record of records) for (const entry of entries) {
      if (entry.dependencies.some(node => node === record.target || node.contains(record.target))) entry.invalid = true;
      if (!entry.element.isConnected) entry.invalid = true;
    }
  };
  const observer = new MutationObserver(invalidate);
  observer.observe(document, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-labelledby','role','type','id','name','autocomplete','for']});
  const capture = event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const action = event.type === 'input' ? 'fill' : 'click';
    const element = action === 'fill' ? event.target : event.target.closest(selector);
    if (!element) return;
    invalidate(observer.takeRecords());
    const index = indices.get(element), entry = entries[index];
    if (action === 'click' && entry && ['textbox','searchbox','spinbutton'].includes(entry.metadata.locator.role)) return;
    globalThis[binding](JSON.stringify(!entry || entry.invalid ? {omitted:true} : {index,action}));
  };
  document.addEventListener('click',capture,true); document.addEventListener('input',capture,true);
  globalThis[removeKey] = () => { document.removeEventListener('click',capture,true);document.removeEventListener('input',capture,true);observer.disconnect();delete globalThis[removeKey]; };
  return entries.map(entry=>entry.metadata);
}`;
