// Deno Deploy signaling server — free tier, no credit card
// Deploy: https://deno.com/deploy

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

Deno.serve((req) => {
  // Upgrade to WebSocket
  const upgrade = req.headers.get("upgrade");
  if (upgrade !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  let roomId = null;
  let peerId = null;

  socket.addEventListener("open", () => {});

  socket.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "join": {
        roomId = msg.roomId;
        peerId = msg.peerId;
        const room = getRoom(roomId);

        // Notify existing peers
        for (const [id, peer] of room) {
          if (peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: "peer-joined", peerId: msg.peerId }));
          }
        }

        room.set(peerId, socket);

        // Send newcomer the list of existing peers
        const existing = [...room.keys()].filter(id => id !== peerId);
        socket.send(JSON.stringify({ type: "joined", peers: existing }));
        break;
      }

      case "signal": {
        const room = rooms.get(roomId);
        if (!room) return;
        // Broadcast to all other peers in the room
        for (const [id, peer] of room) {
          if (id !== peerId && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({
              type: "signal",
              from: peerId,
              signal: msg.signal
            }));
          }
        }
        break;
      }

      case "leave": {
        const room = rooms.get(roomId);
        if (room) {
          room.delete(peerId);
          for (const [id, peer] of room) {
            if (peer.readyState === WebSocket.OPEN) {
              peer.send(JSON.stringify({ type: "peer-left", peerId }));
            }
          }
          if (room.size === 0) rooms.delete(roomId);
        }
        break;
      }
    }
  });

  socket.addEventListener("close", () => {
    if (roomId && peerId) {
      const room = rooms.get(roomId);
      if (room) {
        room.delete(peerId);
        for (const [id, peer] of room) {
          if (peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: "peer-left", peerId }));
          }
        }
        if (room.size === 0) rooms.delete(roomId);
      }
    }
  });

  return response;
});
