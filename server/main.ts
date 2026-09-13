const kv = await Deno.openKv();

Deno.serve(async (req) => {
  const upgrade = req.headers.get("upgrade");
  if (upgrade !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let peerId = null;
  let roomId = null;

  // --- helpers ---
  async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function sanitizeId(id) {
    if (!id || typeof id !== "string") return null;
    // Allow only alphanumeric, hyphens, dots, underscores. Max 64 chars.
    const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
    return cleaned.length > 0 ? cleaned : null;
  }

  socket.addEventListener("message", async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "join": {
        // Sanitize inputs
        peerId = await sanitizeId(msg.peerId);
        roomId = await sanitizeId(msg.roomId);
        if (!peerId || !roomId) {
          socket.send(JSON.stringify({ type: "error", reason: "invalid_input" }));
          return;
        }

        // Validate password
        const roomPasswordHash = (await kv.get(["room_pw", roomId])).value;
        const submittedHash = msg.password ? await hashPassword(msg.password) : null;

        if (roomPasswordHash === null) {
          // First joiner — set this password as the room password (or empty = no password)
          await kv.set(["room_pw", roomId], submittedHash);
        } else if (roomPasswordHash !== submittedHash) {
          socket.send(JSON.stringify({ type: "error", reason: "wrong_password" }));
          return;
        }

        // Register peer in KV
        await kv.set(["peer", roomId, peerId], { peerId, roomId, ts: Date.now() });

        // Get existing peers
        const peers = [];
        const entries = kv.list({ prefix: ["peer", roomId] });
        for await (const entry of entries) {
          const info = entry.value;
          if (info.peerId !== peerId) peers.push(info.peerId);
        }

        // Send joined response
        socket.send(JSON.stringify({ type: "joined", peers }));

        // Notify existing peers about newcomer
        for (const pid of peers) {
          await kv.set(["msg", roomId, pid, crypto.randomUUID()], {
            type: "peer-joined",
            peerId,
          });
        }

        // Start polling for messages
        pollMessages(peerId, roomId, socket);
        break;
      }

      case "signal": {
        if (!roomId || !peerId) return;
        const entries = kv.list({ prefix: ["peer", roomId] });
        for await (const entry of entries) {
          const info = entry.value;
          if (info.peerId !== peerId) {
            await kv.set(["msg", roomId, info.peerId, crypto.randomUUID()], {
              type: "signal",
              from: peerId,
              signal: msg.signal,
            });
          }
        }
        break;
      }
    }
  });

  socket.addEventListener("close", async () => {
    if (peerId && roomId) {
      await kv.delete(["peer", roomId, peerId]);
      const entries = kv.list({ prefix: ["peer", roomId] });
      for await (const entry of entries) {
        const info = entry.value;
        await kv.set(["msg", roomId, info.peerId, crypto.randomUUID()], {
          type: "peer-left",
          peerId,
        });
      }
    }
  });

  return response;
});

async function pollMessages(peerId, roomId, socket) {
  while (socket.readyState === 1) {
    try {
      const entries = kv.list({ prefix: ["msg", roomId, peerId] }, { limit: 10 });
      for await (const entry of entries) {
        if (socket.readyState !== 1) return;
        if (entry.value) {
          socket.send(JSON.stringify(entry.value));
          await kv.delete(entry.key);
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
}
