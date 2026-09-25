console.log("red.js");

console.log("Red page script loaded");

document.body.insertAdjacentHTML("beforeend", "<p>This is red.js</p>");

const worker = new SharedWorker("./shared-worker.js");

// 안전하게 포트 시작
worker.port.start();

worker.onerror = (e) => {
  console.error("[Red] Worker error:", e.message, e.filename, e.lineno);
};
worker.port.onmessageerror = (e) => {
  console.error("[Red] Port message error:", e);
};

worker.port.onmessage = (event) => {
  console.log("[Red] Message from worker:", event.data);
};
