(() => {
  const spec = JSON.parse(document.getElementById('surface-spec').content.textContent);
  document.title = spec.title;
  const byId = id => document.getElementById(id);
  byId('title').textContent = spec.title;
  byId('description').textContent = spec.description;
  byId('result-title').textContent = spec.resultLabel;
  byId('layout').className = spec.layout;
  const controls = new Map(), form = byId('task-form'), submit = byId('submit'), stop = byId('stop'), status = byId('status');
  for (const field of spec.fields) {
    const label = document.createElement('label'), control = document.createElement(field.type === 'text' ? 'input' : field.type);
    label.textContent = field.label; control.id = `field-${field.id}`; label.htmlFor = control.id; control.required = field.required;
    if (field.type === 'select') for (const option of field.options) { const el = document.createElement('option'); el.value = el.textContent = option; control.append(el); }
    else control.maxLength = 2000;
    form.insertBefore(label, byId('actions')); form.insertBefore(control, byId('actions')); controls.set(field.id, control);
  }
  byId('attachment-label').hidden = !spec.attachment;
  let port, pending, sequence = 0;
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.kind !== 'blocky.bridge.init' || port || event.ports.length !== 1) return;
    port = event.ports[0]; submit.disabled = false; submit.textContent = spec.submitLabel;
    port.onmessage = ({data: reply}) => {
      if (!reply || reply.requestId !== pending) return;
      if (reply.kind === 'progress') {status.textContent = reply.message;const line=document.createElement('li');line.textContent=reply.message;byId('progress').append(line);while(byId('progress').children.length>50)byId('progress').firstElementChild.remove();return;}
      pending = undefined;submit.disabled = false;stop.disabled = true;
      status.textContent = reply.ok ? '已完成' : '已停止或未能完成，请查看工作台运行状态。';
      byId('answer').textContent = reply.ok ? reply.answer : '';
      byId('citations').replaceChildren();
      for (const citation of reply.ok && Array.isArray(reply.citations) ? reply.citations : []) {const item=document.createElement('li');item.textContent=`${citation.title} · ${citation.locator}`;byId('citations').append(item);}
    };port.start();
  });
  submit.addEventListener('click', async () => {
    if (!port || pending || !form.reportValidity()) return;
    pending = `request-${++sequence}`;submit.disabled=true;stop.disabled=false;status.textContent='准备提交…';byId('progress').replaceChildren();byId('answer').textContent='';byId('citations').replaceChildren();
    const requestId=pending;
    try {
      const file=byId('attachment').files[0];let attachment;
      if (spec.attachment && file) {
        if (file.size>16000 || !/\.(txt|md|csv)$/i.test(file.name)) throw Error();
        attachment={name:file.name,text:await file.text()};
      }
      if(pending!==requestId)return;
      port.postMessage({schemaVersion:'blocky.bridge-request/v1',requestId,endpointId:'ask',values:Object.fromEntries([...controls].map(([id,control])=>[id,control.value])),...(attachment?{attachment}:{})});
      status.textContent='运行中…';
    }catch{if(pending===requestId){pending=undefined;submit.disabled=false;stop.disabled=true;status.textContent='附件需为不超过 16 KB 的文本、Markdown 或 CSV 文件。';}}
  });
  stop.addEventListener('click',()=>{if(!pending)return;port?.postMessage({schemaVersion:'blocky.bridge-cancel/v1',requestId:pending});pending=undefined;submit.disabled=false;stop.disabled=true;status.textContent='已请求停止';});
})();
