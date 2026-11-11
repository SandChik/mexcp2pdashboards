import { useState, useEffect, useCallback } from 'react';
import { notifyApi } from '../api';
import { pushSupport, enablePush, disablePush, currentSubscription } from '../push';
import { Bell, BellOff, Send, RefreshCw, CheckCircle2, XCircle, Search } from 'lucide-react';
import { SectionHeader, Card, Field, Toggle, Disclosure, inputCls, btnSm, btnSmGhost, btnSmPrimary } from './ui';
import toast from 'react-hot-toast';

/**
 * Settings → Notifikasi.
 *  1. Which events notify (server-side, applies to every channel).
 *  2. Web Push for THIS device (permission + subscription), plus the list of
 *     every subscribed device with its last delivery result.
 *  3. Telegram bot: token, chat id (auto-detect), test.
 * A "Tes semua" fires one test through every channel.
 */
export default function NotifySettings() {
  const [st, setSt] = useState(null);
  const [events, setEvents] = useState({});
  const [tg, setTg] = useState({ enabled: false, botToken: '', chatId: '' });
  const [busy, setBusy] = useState('');
  const [thisSub, setThisSub] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const sup = pushSupport();

  const load = useCallback(async () => {
    try {
      const r = await notifyApi.status();
      const d = r.data && typeof r.data === 'object' ? r.data : {};
      const settings = d.settings || {};
      setSt({ ...d, events: d.events || {}, subscriptions: d.subscriptions || [], recent: d.recent || [], settings });
      setEvents(settings.events || {});
      const t = settings.telegram || {};
      setTg({ enabled: !!t.enabled, botToken: t.botToken || '', chatId: t.chatId || '' });
    } catch { toast.error('Gagal memuat setelan notifikasi'); }
    setThisSub(await currentSubscription());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleEvent(k) {
    const next = { ...events, [k]: !events[k] };
    setEvents(next);
    try { await notifyApi.saveSettings({ events: { [k]: next[k] } }); } catch { toast.error('Gagal menyimpan'); }
  }

  async function onEnablePush() {
    setBusy('push');
    try { await enablePush(navigator.userAgent.slice(0, 40)); toast.success('Notifikasi aktif di perangkat ini'); await load(); }
    catch (e) { toast.error(e.message, { duration: 6000 }); }
    finally { setBusy(''); }
  }
  async function onDisablePush() {
    setBusy('push');
    try { await disablePush(); toast.success('Notifikasi dimatikan di perangkat ini'); await load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function removeDevice(id) {
    try { await notifyApi.unsubscribe(id); await load(); } catch { toast.error('Gagal menghapus'); }
  }

  async function saveTelegram(patch = {}) {
    setBusy('tg');
    try {
      const r = await notifyApi.saveSettings({ telegram: { ...tg, ...patch } });
      const t = r.data.settings.telegram;
      setTg({ enabled: !!t.enabled, botToken: t.botToken || '', chatId: t.chatId || '' });
      toast.success('Setelan Telegram disimpan');
    } catch { toast.error('Gagal menyimpan'); } finally { setBusy(''); }
  }
  async function detectChat() {
    setBusy('detect');
    try {
      const r = await notifyApi.telegramDetect(tg.botToken);
      if (r.data.ok) { setTg(t => ({ ...t, chatId: r.data.chatId })); toast.success(`Chat ditemukan: ${r.data.title || r.data.chatId}`); }
      else toast.error(r.data.error, { duration: 7000 });
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function testTelegram() {
    setBusy('tgtest');
    try { const r = await notifyApi.telegramTest(tg.botToken, tg.chatId); r.data.ok ? toast.success('Terkirim ke Telegram') : toast.error(r.data.error, { duration: 7000 }); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function testAll() {
    setBusy('test');
    try {
      const r = await notifyApi.test();
      const p = r.data.push, t = r.data.telegram;
      toast.success(`Push: ${p.sent} terkirim${p.failed ? `, ${p.failed} gagal` : ''}${p.skipped ? ` (${p.skipped})` : ''} · Telegram: ${t.ok === null ? 'mati' : t.ok ? 'OK' : 'gagal — ' + t.error}`, { duration: 7000 });
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }

  const ago = (ts) => ts ? `${Math.max(0, Math.round((Date.now() - ts) / 60000))} mnt lalu` : '—';

  return (
    <div className="space-y-3">
      <SectionHeader title="Notifikasi"
        desc="Dikirim oleh server lewat Telegram dan/atau notifikasi browser — tetap jalan walau dashboard ditutup."
        action={<button onClick={testAll} disabled={busy === 'test'} className={btnSmGhost}><Send size={12} /> Tes semua</button>} />

      {/* 1. Events */}
      <Card title="Kirim notifikasi untuk">
        <div className="grid sm:grid-cols-2 gap-x-6">
          {st ? Object.entries(st.events || {}).map(([k, def]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2 border-b border-surface-700/60">
              <span className={`text-sm ${events[k] ? 'text-surface-50' : 'text-surface-300'}`}>{def.label}</span>
              <Toggle small on={!!events[k]} onChange={() => toggleEvent(k)} label={def.label} />
            </div>
          )) : <div className="skeleton h-24 sm:col-span-2" />}
        </div>
      </Card>

      {/* 2. Web Push */}
      <Card title="Browser — perangkat ini">
        {!sup.ok ? (
          <div className="bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 text-xs text-warning space-y-1">
            {sup.reasons.map(r => <p key={r}>• {r}</p>)}
            {!sup.secure && <p className="text-surface-200">Butuh HTTPS: buka dashboard lewat alamat <code className="font-mono">https://…ts.net</code> (lihat README → Notifikasi).</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {thisSub
              ? <button onClick={onDisablePush} disabled={busy === 'push'} className={`${btnSm} border-sell/40 text-sell hover:bg-sell/10`}><BellOff size={12} /> Matikan di perangkat ini</button>
              : <button onClick={onEnablePush} disabled={busy === 'push'} className={`${btnSm} border-buy/40 text-buy hover:bg-buy/10`}><Bell size={12} /> Aktifkan di perangkat ini</button>}
            <span className="text-[11px] text-surface-300">izin: {sup.permission}{sup.ios ? ' · iOS (Home Screen)' : ''}</span>
          </div>
        )}
        {st?.subscriptions?.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[11px] text-surface-300">Perangkat terdaftar ({st.subscriptions.length})</p>
            {st.subscriptions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-[11px] font-mono bg-surface-900 rounded-md px-2 py-1.5">
                <span className="text-surface-200 truncate">{s.label || s.ua || s.id} · {s.fails ? <span className="text-sell">gagal {s.fails}× {s.lastError}</span> : s.lastOkAt ? <span className="text-buy">OK {ago(s.lastOkAt)}</span> : 'belum pernah dikirim'}</span>
                <button onClick={() => removeDevice(s.id)} aria-label="Hapus perangkat" className="text-surface-300 hover:text-sell flex-shrink-0"><XCircle size={13} /></button>
              </div>
            ))}
          </div>
        )}
        {st && !st.webPush && <p className="text-[11px] text-sell mt-2">Server: paket <code>web-push</code> belum terpasang — jalankan deploy ulang (npm ci).</p>}
      </Card>

      {/* 3. Telegram */}
      <Card title="Telegram bot"
        action={<Toggle on={tg.enabled} disabled={busy === 'tg'} onChange={() => saveTelegram({ enabled: !tg.enabled })} label={tg.enabled ? 'Telegram ON' : 'Telegram OFF'} />}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Bot token (dari @BotFather)">
            <input value={tg.botToken} onChange={e => setTg(t => ({ ...t, botToken: e.target.value }))} placeholder="123456789:AAH…" className={inputCls + ' font-mono'} />
          </Field>
          <Field label="Chat ID">
            <div className="flex gap-1.5">
              <input value={tg.chatId} onChange={e => setTg(t => ({ ...t, chatId: e.target.value }))} placeholder="mis. 123456789" className={inputCls + ' font-mono'} />
              <button type="button" onClick={detectChat} disabled={busy === 'detect' || !tg.botToken} title="Cari chat id dari pesan terakhir ke bot" className={`${btnSmGhost} !h-[38px] flex-shrink-0`}>
                {busy === 'detect' ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} Deteksi
              </button>
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => saveTelegram()} disabled={busy === 'tg'} className={btnSmPrimary}><CheckCircle2 size={12} /> Simpan</button>
          <button onClick={testTelegram} disabled={busy === 'tgtest' || !tg.botToken || !tg.chatId} className={btnSmGhost}><Send size={12} /> Tes kirim</button>
          <button onClick={() => setShowGuide(g => !g)} className={`${btnSm} border-transparent text-surface-300 hover:text-surface-50`}>{showGuide ? 'Tutup panduan' : 'Cara bikin bot'}</button>
        </div>
        {showGuide && (
          <ol className="mt-3 text-xs text-surface-200 space-y-1.5 list-decimal pl-5 bg-surface-900 rounded-lg p-3">
            <li>Di Telegram cari <b>@BotFather</b> → kirim <code className="font-mono">/newbot</code> → beri nama (mis. "SandChik Notif") dan username yang berakhiran <code className="font-mono">bot</code>.</li>
            <li>BotFather membalas dengan <b>token</b> (bentuknya <code className="font-mono">123456789:AAH…</code>). Salin ke kolom Bot token di atas. Token = kunci bot; jangan dibagikan.</li>
            <li>Buka bot yang baru dibuat di Telegram (link dari BotFather), tekan <b>Start</b> atau kirim "halo".</li>
            <li>Kembali ke sini → klik <b>Deteksi</b> → Chat ID terisi otomatis. (Mau ke grup? Masukkan bot ke grup, kirim pesan di grup, lalu Deteksi.)</li>
            <li>Nyalakan toggle Telegram, <b>Simpan</b>, lalu <b>Tes kirim</b>.</li>
          </ol>
        )}
      </Card>

      {/* 4. Diagnostics — collapsed; open it when "notif tidak masuk" */}
      {st && (
        <Disclosure summary={<>Diagnostik{st.watcher?.lastError && <span className="text-sell"> · ada error</span>}</>} defaultOpen={!!st.watcher?.lastError}>
          {st.watcher && (
            <p>
              pemantau server: {st.watcher.on ? 'ON' : 'OFF'} · tiap {Math.round(st.watcher.intervalMs / 1000)}s · siklus {st.watcher.cycles} · terkirim {st.watcher.emitted}
              {st.watcher.lastEvent && ` · terakhir: ${st.watcher.lastEvent.type} (${st.watcher.lastEvent.merchant}) ${ago(st.watcher.lastEvent.at)}`}
              {st.watcher.lastError && <span className="text-sell"> · error: {st.watcher.lastError}</span>}
            </p>
          )}
          {st.recent?.length > 0 ? (
            <div className="pt-1 max-h-40 overflow-y-auto space-y-0.5">
              <p className="text-surface-300">kiriman terakhir:</p>
              {st.recent.map((r, i) => (
                <p key={i}>
                  {ago(r.at)} · {r.type} · {r.merchant} #{r.order} · push {r.push?.sent ?? 0}/{(r.push?.sent ?? 0) + (r.push?.failed ?? 0)}{r.telegram && r.telegram.ok !== null ? ` · tg ${r.telegram.ok ? 'OK' : 'gagal: ' + r.telegram.error}` : ''}
                </p>
              ))}
            </div>
          ) : <p className="text-surface-300">belum ada kiriman sejak server menyala</p>}
        </Disclosure>
      )}
    </div>
  );
}
