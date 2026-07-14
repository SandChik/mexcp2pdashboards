/**
 * Backend WS proxy — maintains connection to MEXC P2P chat.
 * Messages are NOT stored here; frontend polls MEXC HTTP API for history.
 * This manager only: keeps WS alive, handles send, tracks "has new" flag.
 */
const WebSocket = require('ws');

class WsManager {
  constructor() {
    this.connections = new Map();
  }
  _key(mid, cid) { return `${mid}:${cid}`; }

  async connect(merchantId, conversationId, listenKey, refresher) {
    const key = this._key(merchantId, conversationId);
    const ex = this.connections.get(key);
    if (ex?.ws?.readyState === WebSocket.OPEN) return { success: true, status: 'already_connected' };
    if (ex) { clearInterval(ex.ping); clearInterval(ex.refresh); ex.ws.terminate(); this.connections.delete(key); }

    return new Promise(resolve => {
      let ws;
      try { ws = new WebSocket(`wss://fiat.mexc.com/ws?listenKey=${listenKey}&conversationId=${conversationId}`); }
      catch (e) { return resolve({ success: false, error: e.message }); }

      const entry = { ws, ping: null, refresh: null, hasNew: false, listenKey, refresher };
      this.connections.set(key, entry);

      const timer = setTimeout(() => resolve({ success: false, error: 'Connection timeout' }), 8000);

      ws.on('open', () => {
        clearTimeout(timer);
        entry.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 5000);
        // listenKey expires in ~1h. Refresh every 25 min and reconnect with the
        // fresh key so long-open chats don't silently die.
        if (typeof refresher === 'function') {
          entry.refresh = setInterval(async () => {
            try {
              const fresh = await refresher();
              if (fresh && fresh !== entry.listenKey) {
                entry.listenKey = fresh;
                this.connect(merchantId, conversationId, fresh, refresher);
              }
            } catch { /* keep current connection */ }
          }, 25 * 60 * 1000);
        }
        resolve({ success: true, status: 'connected' });
      });

      ws.on('message', data => {
        try {
          const p = JSON.parse(data.toString());
          // Any RECEIVE_MESSAGE = new incoming message from counterpart
          if (p.method === 'RECEIVE_MESSAGE') entry.hasNew = true;
        } catch {}
      });

      ws.on('error', err => { clearTimeout(timer); resolve({ success: false, error: err.message }); });
      ws.on('close', () => { clearInterval(entry.ping); clearInterval(entry.refresh); this.connections.delete(key); });
    });
  }

  send(merchantId, conversationId, content) {
    const entry = this.connections.get(this._key(merchantId, conversationId));
    if (!entry || entry.ws.readyState !== WebSocket.OPEN)
      return { success: false, error: 'WebSocket not connected. Open chat tab first.' };
    try {
      entry.ws.send(JSON.stringify({
        method: 'SEND_MESSAGE',
        params: JSON.stringify({ content, conversationId: parseInt(conversationId), type: 1 })
      }));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  sendImage(merchantId, conversationId, imageUrl, imageThumbUrl) {
    const entry = this.connections.get(this._key(merchantId, conversationId));
    if (!entry || entry.ws.readyState !== WebSocket.OPEN)
      return { success: false, error: 'WebSocket not connected.' };
    try {
      entry.ws.send(JSON.stringify({
        method: 'SEND_MESSAGE',
        params: JSON.stringify({ type: 2, conversationId: parseInt(conversationId), imageUrl, imageThumbUrl: imageThumbUrl || imageUrl })
      }));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // Check & clear "has new message" flag
  checkNew(merchantId, conversationId) {
    const entry = this.connections.get(this._key(merchantId, conversationId));
    if (!entry) return false;
    const v = entry.hasNew; entry.hasNew = false; return v;
  }

  status(merchantId, conversationId) {
    const entry = this.connections.get(this._key(merchantId, conversationId));
    if (!entry) return 'disconnected';
    return { 0: 'connecting', 1: 'connected', 2: 'disconnecting', 3: 'disconnected' }[entry.ws.readyState] || 'disconnected';
  }

  disconnect(merchantId, conversationId) {
    const key = this._key(merchantId, conversationId);
    const entry = this.connections.get(key);
    if (entry) { clearInterval(entry.ping); clearInterval(entry.refresh); entry.ws.terminate(); this.connections.delete(key); }
  }
}

module.exports = new WsManager();
