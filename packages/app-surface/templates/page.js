(() => {
  let port, sequence = 0, pending;
  const form = document.getElementById("question-form"), submit = document.getElementById("submit"), status = document.getElementById("status");
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.kind !== "blocky.bridge.init" || port || event.ports.length !== 1) return;
    port = event.ports[0]; submit.disabled = false; submit.textContent = "查找答案";
    port.onmessage = event => {
      const reply = event.data;
      if (!reply || reply.requestId !== pending) return;
      pending = undefined; submit.disabled = false;
      status.textContent = reply.ok ? "回答已生成" : "未能完成，请返回工作台检查运行状态。";
      document.getElementById("answer").textContent = reply.ok ? reply.answer : "";
      const list = document.getElementById("citations"); list.replaceChildren();
      for (const citation of reply.ok && Array.isArray(reply.citations) ? reply.citations : []) {
        const item = document.createElement("li"); item.textContent = `${citation.title} · ${citation.locator}`; list.append(item);
      }
    };
    port.start();
  });
  form.addEventListener("submit", event => {
    event.preventDefault(); if (!port || pending) return;
    const question = document.getElementById("question").value.trim(); if (!question) return;
    pending = `request-${++sequence}`; submit.disabled = true; status.textContent = "正在查找资料…";
    port.postMessage({ schemaVersion: "blocky.bridge-request/v1alpha1", requestId: pending, endpointId: "ask", question });
  });
})();
