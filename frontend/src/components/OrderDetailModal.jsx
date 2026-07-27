import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, CheckCircle, Coins, RefreshCw, Wifi, WifiOff, AlertCircle, Copy, Image, Paperclip } from 'lucide-react';
import { ordersApi, chatApi, merchantApi } from '../api';
import { OrderStateBadge, SideBadge, formatTime, formatAmount, normalizeState, KYC_LABELS, getBankName } from './helpers';
import toast from 'react-hot-toast';
import { askConfirm } from './confirm';
import { addNotif } from '../notifications';

export default function OrderDetailModal({ merchantId, advOrderNo, initialTab = 'detail', onClose, onActionDone }) {
  // Escape always exits the modal (heuristic #3: user control & freedom)
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [order, setOrder] = useState(null);
  const [quickReplies, setQuickReplies] = useState([]); // per-merchant, from backend settings
  useEffect(() => {
    merchantApi.getSettings(merchantId)
      .then(r => setQuickReplies(Array.isArray(r.data?.quickReplies) ? r.data.quickReplies : []))
      .catch(() => {});
  }, [merchantId]);
  const [showRaw, setShowRaw] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [msgInput, setMsgInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [actionLoading, setActionLoading] = useState('');
  const [showPayIdInput, setShowPayIdInput] = useState(false);
  const [manualPayId, setManualPayId] = useState('');
  const [sending, setSending] = useState(false);

  const msgEndRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  const loadDetail = useCallback(async () => {
    try {
      const r = await ordersApi.detail(merchantId, advOrderNo);
      setOrder(r.data?.data);
    } catch { toast.error('Failed to load order'); }
    finally { setLoading(false); }
  }, [merchantId, advOrderNo]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll message history from MEXC HTTP API (source of truth — correct self field)
  const pollMessages = useCallback(async (cid) => {
    if (!cid) return;
    try {
      const r = await chatApi.getMessages(merchantId, cid, { limit: 50 });
      const msgs = r.data?.data?.messages || [];
      setMessages(msgs);
      // Update WS status
      const s = await chatApi.status(merchantId, cid);
      setWsStatus(s.data?.status || 'disconnected');
    } catch {}
  }, [merchantId]);

  const initChat = useCallback(async () => {
    setWsStatus('connecting');
    try {
      // Get or create conversation
      let cid = conversationId;
      if (!cid) {
        const cr = await chatApi.getConversation(merchantId, advOrderNo);
        cid = cr.data?.data?.conversationId;
        if (!cid) { toast.error('No conversation for this order'); setWsStatus('disconnected'); return; }
        setConversationId(cid);
      }
      // Load history
      await pollMessages(cid);
      // Connect WS backend proxy
      const conn = await chatApi.connect(merchantId, cid);
      setWsStatus(conn.data?.success ? 'connected' : 'error');
      // Poll every 3s
      clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollMessages(cid), 3000);
    } catch (e) {
      setWsStatus('disconnected');
      toast.error('Chat init failed: ' + e.message);
    }
  }, [merchantId, advOrderNo, conversationId, pollMessages]);

  useEffect(() => {
    if (tab === 'chat') { initChat(); }
    else { clearInterval(pollRef.current); }
    return () => clearInterval(pollRef.current);
  }, [tab]);

  async function sendMessage() {
    if (!msgInput.trim() || !conversationId || sending) return;
    setSending(true);
    const content = msgInput.trim();
    setMsgInput('');
    try {
      const r = await chatApi.send(merchantId, conversationId, content);
      if (!r.data?.success) {
        toast.error(r.data?.error || 'Send failed');
        setMsgInput(content);
      } else {
        // Trigger immediate poll to show sent message
        setTimeout(() => pollMessages(conversationId), 500);
      }
    } catch (e) {
      toast.error('Send failed: ' + e.message);
      setMsgInput(content);
    } finally { setSending(false); }
  }

  async function sendCanned(text) {
    if (!conversationId || sending) { toast.error('Chat not connected yet'); return; }
    setSending(true);
    try {
      const r = await chatApi.send(merchantId, conversationId, text);
      if (!r.data?.success) toast.error(r.data?.error || 'Send failed');
      else setTimeout(() => pollMessages(conversationId), 500);
    } catch (e) { toast.error('Send failed: ' + e.message); }
    finally { setSending(false); }
  }

  async function uploadAndSendImage(file) {
    if (!conversationId) { toast.error('Chat not connected'); return; }
    const fd = new FormData();
    fd.append('file', file);
    try {
      toast.loading('Uploading...', { id: 'upload' });
      const up = await chatApi.upload(merchantId, fd);
      toast.dismiss('upload');
      if (up.data?.code !== 0) { toast.error('Upload failed: ' + up.data?.msg); return; }
      const fileId = up.data?.data?.fileId;
      // Download to get URL
      let imgUrl = '';
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const dl = await chatApi.download(merchantId, fileId);
        if (dl.data?.code === 0 && dl.data?.data?.fileUrl) { imgUrl = dl.data.data.fileUrl; break; }
      }
      if (!imgUrl) { toast.error('Could not get image URL after upload'); return; }
      const r = await chatApi.sendImage(merchantId, conversationId, imgUrl, imgUrl);
      if (r.data?.success) { toast.success('Image sent'); setTimeout(() => pollMessages(conversationId), 800); }
      else toast.error(r.data?.error || 'Send image failed');
    } catch (e) {
      toast.dismiss('upload');
      toast.error('Upload error: ' + e.message);
    }
  }

  async function handleReleaseCoin() {
    const amt = order ? `${formatAmount(order.amount, 0)} ${order.fiatUnit}` : '';
    const qty = order ? `${formatAmount(order.tradableQuantity, 8)} ${order.coinName || 'USDT'}` : '';
    const who = order?.userInfo?.nickName || 'buyer';
    const ok = await askConfirm({ title: `Release ${qty}?`, message: `To: ${who}\nThey paid: ${amt}\n\nConfirm you have ACTUALLY received this payment in your account. This action is irreversible.`, confirmText: 'Release coin', danger: true });
    if (!ok) return;
    setActionLoading('release');
    try {
      const r = await ordersApi.releaseCoin(merchantId, advOrderNo);
      if (r.data?.code === 0) addNotif('Released', `Coin released for order ${advOrderNo}`);
      if (r.data?.code === 0) {
        toast.success('\u2705 Coin dilepas!');
        loadDetail(); onActionDone?.();
        // Auto-close: the action is finished, so drop straight back to the list
        // instead of making the operator hunt for the X on every order.
        setTimeout(() => onClose?.(), 900);
      }
      else toast.error('Gagal: ' + (r.data?.msg || 'Error'));
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setActionLoading(''); }
  }

  async function handleConfirmPaid(payId) {
    if (!payId) { setShowPayIdInput(true); return; }
    setActionLoading('confirm');
    try {
      const r = await ordersApi.confirmPaid(merchantId, advOrderNo, parseInt(payId));
      if (r.data?.code === 0) {
        toast.success('\u2705 Pembayaran dikonfirmasi!');
        setShowPayIdInput(false);
        loadDetail(); onActionDone?.();
        setTimeout(() => onClose?.(), 900);
      } else toast.error('Gagal: ' + (r.data?.msg || 'Error'));
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setActionLoading(''); }
  }

  function copyText(text) {
    navigator.clipboard.writeText(String(text));
    toast.success('Copied!', { duration: 1500 });
  }

  if (loading) return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const stateNum = order ? normalizeState(order.state) : -1;
  // WARNING — the two MEXC endpoints disagree about whose perspective `side`
  // describes. This modal reads /fiat/order/detail, which reports the
  // COUNTERPART's side; the order LIST reports OURS. Both are kept straight
  // here on purpose:
  //   detail BUY  → they buy from us  → we are SELLER → we release coin
  //   detail SELL → they sell to us   → we are BUYER  → we confirm paid
  const takerIsBuying  = order?.side === 'BUY';   // merchant sells → release coin
  const takerIsSelling = order?.side === 'SELL';  // merchant buys  → confirm paid

  // Badge shows OUR side, inverted from the detail payload, so the same order
  // never reads "SELL" in the list and "BUY" here. Display only — never feed
  // this into the action checks above.
  const displaySide = order ? (takerIsBuying ? 'SELL' : 'BUY') : null;
  const canRelease      = takerIsBuying  && [1, 2, 3].includes(stateNum);
  const canConfirmPaid  = takerIsSelling && [0, 2, 3].includes(stateNum); // 3=Processing: merchant still needs to confirm payment
  const autoPayId = order?.confirmPaymentInfo?.id || order?.paymentInfo?.[0]?.id || null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in">
      <div className="card !rounded-b-none sm:!rounded-xl w-full max-w-2xl h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col animate-sheet-up sm:animate-slide-up shadow-lift">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-surface-700 bg-surface-900">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button onClick={() => copyText(advOrderNo)} className="font-mono text-xs text-surface-200/40 hover:text-surface-200 truncate hidden sm:block transition-colors" title="Copy order no">
              {advOrderNo}
            </button>
            {order && <OrderStateBadge state={stateNum} />}
            {order && <SideBadge side={displaySide} />}
          </div>
          <button onClick={onClose} className="text-surface-200/40 hover:text-white transition-colors ml-3"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-surface-700 bg-surface-900">
          {['detail', 'chat'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-mono capitalize transition-colors relative ${tab===t?'text-brand-400':'text-surface-200/40 hover:text-surface-200'}`}>
              {t === 'chat' && (
                <span className="mr-1">
                  {wsStatus==='connected' ? <Wifi size={11} className="inline text-green-400" />
                    : wsStatus==='connecting' ? <RefreshCw size={11} className="inline text-yellow-400 animate-spin" />
                    : <WifiOff size={11} className="inline text-red-400" />}
                </span>
              )}
              {t}
              {t==='chat' && order?.unreadCount>0 && (
                <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">{order.unreadCount}</span>
              )}
              {tab===t && <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-brand-500 rounded" />}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-surface-800">
          {tab === 'detail' && order && (
            <div className="space-y-4">
              <div className="flex justify-end -mb-2">
                <button onClick={() => setShowRaw(v => !v)}
                  className="text-[11px] text-surface-300 hover:text-surface-50 border border-surface-700 rounded px-2 py-1">
                  {showRaw ? 'Hide raw' : 'Raw API data'}
                </button>
              </div>
              {showRaw && (
                <pre className="bg-surface-950 border border-surface-700 rounded-lg p-3 text-[11px] text-surface-200 font-mono overflow-auto max-h-72 whitespace-pre-wrap break-all">
                  {JSON.stringify(order, null, 2)}
                </pre>
              )}
              {/* Action alerts */}
              {canRelease && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-center gap-3">
                  <AlertCircle size={16} className="text-green-400 flex-shrink-0" />
                  <p className="text-sm text-green-400 font-mono">Buyer sudah bayar. Verifikasi pembayaran, lalu klik Release Coin.</p>
                </div>
              )}
              {canConfirmPaid && (
                <div className="bg-brand-500/10 border border-brand-500/30 rounded-lg px-4 py-3 flex items-center gap-3">
                  <AlertCircle size={16} className="text-brand-400 flex-shrink-0" />
                  <p className="text-sm text-brand-400 font-mono">
                    {stateNum === 3
                      ? 'Order sedang Processing. Jika Anda belum bayar, klik Confirm Paid setelah mengirim pembayaran.'
                      : 'Klik Confirm Paid setelah Anda mengirim pembayaran ke seller.'}
                  </p>
                </div>
              )}

              {showPayIdInput && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
                  <p className="text-sm text-blue-400 font-mono">Masukkan Payment Method ID:</p>
                  <div className="flex gap-2">
                    <input value={manualPayId} onChange={e=>setManualPayId(e.target.value)} type="number"
                      placeholder="e.g. 1545243"
                      className="flex-1 bg-surface-800 border border-surface-200/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-brand-500" />
                    <button onClick={()=>handleConfirmPaid(manualPayId)} disabled={!manualPayId||!!actionLoading}
                      className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-4 rounded font-mono text-sm transition-colors disabled:opacity-50">OK</button>
                    <button onClick={()=>setShowPayIdInput(false)} className="text-surface-200/40 hover:text-white px-2"><X size={16}/></button>
                  </div>
                  <p className="text-xs text-surface-200/30 font-mono">Payment Method ID ada di data payment yang Anda berikan di atas (field "id")</p>
                </div>
              )}

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Amount', order.amount, order.fiatUnit, 0, true],
                  ['Quantity', order.tradableQuantity, order.coinName||'USDT', 8, false],
                  ['Price/USDT', order.price, order.fiatUnit, 0, false],
                  ['Created', null, null, 0, false, formatTime(order.createTime)],
                  ['Pay Deadline', null, null, 0, false, formatTime(order.payTimeLimit)],
                  ['Updated', null, null, 0, false, formatTime(order.updateTime)],
                ].map(([k, val, unit, dec, copyable, override]) => (
                  <div key={k} className="bg-surface-900 border border-surface-700 rounded-lg p-3">
                    <p className="text-xs text-surface-200/30 font-mono mb-0.5">{k}</p>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-white font-mono">{override || `${formatAmount(val, dec)} ${unit||''}`}</p>
                      {copyable && val && (
                        <button onClick={() => copyText(val)} className="text-surface-200/30 hover:text-brand-400 ml-2 transition-colors" title="Copy">
                          <Copy size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Merchant payment info */}
              {order.paymentInfo?.length > 0 && (
                <Section title="Info Pembayaran Merchant">
                  {order.paymentInfo.map((p, i) => (
                    <div key={i} className="bg-surface-800 rounded-lg p-3 space-y-1.5 text-sm">
                      <Row label="Metode" value={getBankName(p.payMethod)} />
                      {p.bankName && <Row label="Bank" value={p.bankName} />}
                      {p.account && <Row label="Akun" value={p.account} copy onCopy={copyText} />}
                      {p.bankAddress && <Row label="Branch" value={p.bankAddress} />}
                      {p.payee && <Row label="Penerima" value={p.payee} />}
                    </div>
                  ))}
                </Section>
              )}

              {/* Buyer payment info */}
              {order.confirmPaymentInfo?.id && (
                <Section title="Metode Bayar Buyer">
                  <div className="bg-surface-800 rounded-lg p-3 space-y-1.5 text-sm">
                    <Row label="Metode" value={getBankName(order.confirmPaymentInfo.payMethod)} />
                    {order.confirmPaymentInfo.bankName && <Row label="Bank" value={order.confirmPaymentInfo.bankName} />}
                    {order.confirmPaymentInfo.account && <Row label="Akun" value={order.confirmPaymentInfo.account} copy onCopy={copyText} />}
                    {order.confirmPaymentInfo.payee && <Row label="Penerima" value={order.confirmPaymentInfo.payee} />}
                    <Row label="Pay ID" value={order.confirmPaymentInfo.id} />
                  </div>
                </Section>
              )}

              {/* Counterpart */}
              {order.userInfo && (
                <Section title="Counterpart">
                  <div className="bg-surface-800 rounded-lg p-3 space-y-1.5 text-sm">
                    <Row label="Nick" value={order.userInfo.nickName} />
                    {order.userInfo.realName && <Row label="Nama" value={order.userInfo.realName} />}
                    <Row label="KYC" value={
                      order.userInfo.kycLevel !== undefined && order.userInfo.kycLevel !== null
                        ? (KYC_LABELS[order.userInfo.kycLevel] || `Level ${order.userInfo.kycLevel}`)
                        : 'Tidak tersedia'
                    } />
                    {order.userFiatStatistics && (
                      <>
                        <Row label="Total Trade Buy" value={order.userFiatStatistics.totalBuyCount ?? 0} />
                        <Row label="Total Trade Sell" value={order.userFiatStatistics.totalSellCount ?? 0} />
                        <Row label="Completion" value={`${(parseFloat(order.userFiatStatistics.completeRate||0)*100).toFixed(1)}%`} highlight />
                      </>
                    )}
                    {order.spotCount !== undefined && order.spotCount !== null && (
                      <Row label="Spot Count" value={order.spotCount} />
                    )}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* CHAT */}
          {tab === 'chat' && (
            <div className="space-y-3 min-h-[250px]">
              {wsStatus !== 'connected' && (
                <p className="text-center text-xs font-mono text-surface-200/30 animate-pulse py-2">
                  {wsStatus === 'connecting' ? 'Menghubungkan ke chat...' : `Status: ${wsStatus}`}
                </p>
              )}
              {messages.length === 0 && wsStatus === 'connected' && (
                <p className="text-center text-surface-200/20 text-xs py-8 font-mono">Belum ada pesan</p>
              )}
              {messages.map((m, i) => (
                <div key={m.id || i} className={`flex ${m.self ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-xl px-3 py-2 text-sm ${m.self ? 'bg-green-500/20 text-green-300' : 'bg-surface-800 text-white'}`}>
                    {!m.self && <p className="text-xs text-surface-200/40 mb-1 font-mono">{m.fromNickName || 'Buyer'}</p>}
                    {(m.type===1||!m.type) && <p className="break-words whitespace-pre-wrap">{m.content}</p>}
                    {m.type===2 && (
                      <img src={m.imageUrl||m.imageThumbUrl} className="max-w-full rounded-lg max-h-48 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
                        alt="img" onError={e=>e.target.style.display='none'} onClick={() => setLightboxUrl(m.imageUrl || m.imageThumbUrl)} />
                    )}
                    {m.type===4 && <a href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline text-xs">📎 Download file</a>}
                    <p className="text-xs opacity-30 mt-1 text-right font-mono">{formatTime(m.createTime)}</p>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t-2 border-surface-700 bg-surface-900">
          {tab === 'chat' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {quickReplies.map((t, i) => (
                  <button key={i} type="button" onClick={() => sendCanned(t)} disabled={wsStatus !== 'connected' || sending}
                    title={t}
                    className="text-xs text-surface-200 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 max-w-[160px] truncate">
                    {t}
                  </button>
                ))}
              </div>
            <div className="flex gap-2">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,application/pdf"
                onChange={e => { if (e.target.files?.[0]) uploadAndSendImage(e.target.files[0]); e.target.value=''; }} />
              <button onClick={() => fileInputRef.current?.click()}
                className="bg-surface-800 hover:bg-surface-700 text-surface-200/50 hover:text-surface-200 rounded-lg px-3 transition-colors" title="Send image">
                <Image size={15} />
              </button>
              <input value={msgInput} onChange={e=>setMsgInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                placeholder={wsStatus==='connected'?'Ketik pesan...':'Menghubungkan...'}
                className="flex-1 bg-surface-800 border border-surface-200/10 rounded-lg px-3 py-2 text-sm text-white placeholder-surface-200/30 focus:outline-none focus:border-brand-500 font-mono transition-colors" />
              <button onClick={sendMessage} disabled={!msgInput.trim()||sending}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg px-4 flex items-center gap-1.5 transition-colors">
                {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {canConfirmPaid && (
                <button onClick={()=>handleConfirmPaid(autoPayId)} disabled={!!actionLoading}
                  className="flex-1 bg-brand-500/20 hover:bg-brand-500/30 disabled:opacity-50 text-brand-400 rounded-lg py-2.5 text-sm font-mono flex items-center justify-center gap-2 transition-colors">
                  {actionLoading==='confirm'?<RefreshCw size={14} className="animate-spin"/>:<CheckCircle size={14}/>}
                  Confirm Paid
                </button>
              )}
              {canRelease && (
                <button onClick={handleReleaseCoin} disabled={!!actionLoading}
                  className="flex-1 bg-buy/20 hover:bg-buy/30 disabled:opacity-50 text-buy rounded-lg py-2.5 text-sm font-mono flex items-center justify-center gap-2 border border-buy/20 transition-colors">
                  {actionLoading==='release'?<RefreshCw size={14} className="animate-spin"/>:<Coins size={14}/>}
                  Release Coin
                </button>
              )}
              {!canRelease && !canConfirmPaid && stateNum >= 0 && (
                <div className="flex-1 text-center text-xs text-surface-200/30 font-mono py-2.5">
                  {stateNum === 4 ? '✅ Order selesai' : stateNum >= 5 ? '❌ Order dibatalkan' : 'Menunggu tindakan...'}
                </div>
              )}
              <button onClick={loadDetail}
                className="bg-surface-800 hover:bg-surface-700 text-surface-200 rounded-lg px-3 py-2 transition-colors">
                <RefreshCw size={14} className={actionLoading?'animate-spin':''} />
              </button>
            </div>
          )}
        </div>
      </div>
      {lightboxUrl && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="full size" className="max-w-full max-h-full object-contain rounded-lg" />
          <button onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 rounded-full w-9 h-9 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return <div><p className="text-xs font-mono text-surface-200/30 uppercase tracking-widest mb-2">{title}</p>{children}</div>;
}
function Row({ label, value, copy, onCopy, highlight }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-surface-200/40 flex-shrink-0 text-sm">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span onClick={copy ? ()=>onCopy(value) : undefined}
          className={`font-mono text-sm text-right break-all ${highlight?'text-green-400':'text-white'} ${copy?'cursor-pointer hover:text-brand-400 transition-colors':''}`}>
          {value}
        </span>
        {copy && <button onClick={()=>onCopy(value)} className="text-surface-200/20 hover:text-brand-400 transition-colors flex-shrink-0"><Copy size={11}/></button>}
      </div>
    </div>
  );
}
