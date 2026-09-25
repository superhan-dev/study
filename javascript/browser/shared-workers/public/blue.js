console.log("blue.js");

console.log("Blue page script loaded");

document.body.insertAdjacentHTML("beforeend", "<p>This is blue.js</p>");

const worker = new SharedWorker("./shared-worker.js");

worker.port.start();
worker.onerror = (e) => {
  console.error("[Blue] Worker error:", e.message, e.filename, e.lineno);
};
worker.port.onmessageerror = (e) => {
  console.error("[Blue] Port message error:", e);
};
worker.port.onmessage = (event) => {
  console.log("[Blue] Message from worker:", event.data);
};
