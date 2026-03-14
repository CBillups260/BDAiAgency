import { EventEmitter } from "events";
import type { Response } from "express";

class SSEBroadcaster extends EventEmitter {
  private clients: Set<Response> = new Set();

  addClient(res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n"); // heartbeat

    this.clients.add(res);

    res.on("close", () => {
      this.clients.delete(res);
    });

    // Send heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      if (this.clients.has(res)) {
        res.write(":\n\n");
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);
  }

  broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
    this.emit(event, data);
  }

  get clientCount() {
    return this.clients.size;
  }
}

export const sse = new SSEBroadcaster();
