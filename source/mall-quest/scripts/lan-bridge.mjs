// Keep a managed localhost preview running while adding one explicit LAN entry.
// Forward only to this website's localhost port; never log headers or tokens.
import http from "node:http";
import net from "node:net";
import { networkInterfaces } from "node:os";

const host = process.argv[2];
const port = 5173;
const octets = host?.split(".").map(Number);
const privateIPv4 = net.isIP(host || "") === 4 && (octets[0] === 10 ||
  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
  (octets[0] === 192 && octets[1] === 168));
const local = Object.values(networkInterfaces()).flat().some(address =>
  address && !address.internal && address.address === host);
if (!privateIPv4 || !local) {
  throw new Error("Provide this computer's current private LAN IPv4 address.");
}

const server = http.createServer((request, response) => {
  if (!request.url?.startsWith("/")) {
    response.writeHead(400).end("Invalid request path");
    return;
  }
  const upstream = http.request({ hostname: "127.0.0.1", port,
    method: request.method, path: request.url, headers: request.headers }, incoming => {
    response.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.on("error", () => response.destroy());
    incoming.pipe(response);
  });
  upstream.setTimeout(30000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Website preview is unavailable. Start the localhost preview first.");
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
  request.pipe(upstream);
});

// Preserve the preview's hot-reload connection for phone browsers as well.
server.on("upgrade", (request, socket, head) => {
  if (!request.url?.startsWith("/")) { socket.destroy(); return; }
  const upstream = net.connect(port, "127.0.0.1", () => {
    const headers = request.rawHeaders.reduce((lines, value, index) =>
      index % 2 ? lines : [...lines, `${value}: ${request.rawHeaders[index + 1]}`], []);
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});
server.on("error", error => { console.error(`LAN entry failed: ${error.code || "unknown"}`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`LAN entry ready: http://${host}:${port} (localhost preview retained)`));
