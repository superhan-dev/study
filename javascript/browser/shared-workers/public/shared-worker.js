const ID = Math.random().toString(36).substring(2, 15);
console.log(`Shared Worker ${ID} started`);

const ports = new Set();

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  console.log(`Shared Worker ${ID} connected to a new port`, ports.size);

  // start() is required when using addEventListener; harmless with onmessage
  port.start();

  // Notify all ports that a new client connected (helps confirm wiring)
  for (let p of ports) {
    p.postMessage([ID, { type: "connected", total: ports.size }]);
  }

  port.onmessage = (e) => {
    console.log(`Shared Worker ${ID} received message:`, e.data);

    for (let p of ports) {
      p.postMessage([ID, e.data]);
    }
  };
};
