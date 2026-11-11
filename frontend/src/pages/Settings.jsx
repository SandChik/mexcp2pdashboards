import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { merchantApi, authApi } from '../api';
import Layout from '../components/Layout';
import MessageSettings from '../components/MessageSettings';
import SoundSettings from '../components/SoundSettings';
import NotifySettings from '../components/NotifySettings';
import BuyerLogSettings from '../components/BuyerLogSettings';
import VersionInfo from '../components/VersionInfo';
import { SectionHeader, Card, Field, inputCls, btnSmGhost } from '../components/ui';
import { Plus, Trash2, Pencil, Eye, EyeOff, Activity, CheckCircle2, XCircle, Store, BookUser, Bell, MessageSquare, Volume2, User, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PLATFORMS, platformOf } from '../components/helpers';
import { invalidateQueueMerchants, refreshQueue } from '../actionQueue';
import toast from 'react-hot-toast';
import { askConfirm } from '../components/confirm';

// Per-platform caps — mirrored from backend/routes/merchants.js.
const PLATFORM_MAX = { mexc: 5, bingx: 2, gate: 3 };

const TABS = [
  { key: 'merchant', label: 'Merchant',      icon: Store },
  { key: 'buyer',    label: 'Catatan Buyer', icon: BookUser },
  { key: 'notif',    label: 'Notifikasi',    icon: Bell },
  { key: 'reply',    label: 'Auto-reply',    icon: MessageSquare },
  { key: 'sound',    label: 'Suara',         icon: Volume2 },
  { key: 'account',  label: 'Akun',          icon: User },
];

// API keys are long; the start and end are enough to tell two apart.
const maskKey = (k) => (k && k.length > 14 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k || '—');

function MerchantForm({ existing, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    apiKey: existing?.apiKey || '',
    apiSecret: '',
    platform: existing?.platform || 'mexc',
    // Gate: every order-list call needs the fiat + crypto pair.
    fiat: existing?.fiat || 'IDR',
    asset: existing?.asset || 'USDT',
  });
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!existing && !form.apiSecret) { toast.error('API Secret wajib diisi'); return; }
    setLoading(true);
    try {
      if (existing) { await merchantApi.update(existing.id, form); toast.success('Merchant diperbarui'); }
      else { await merchantApi.add(form); toast.success('Merchant ditambahkan'); }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan');
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <h3 className="text-sm font-medium text-surface-50">{existing ? `Edit ${existing.name}` : 'Tambah merchant'}</h3>

      <div className="seg w-full">
        {Object.keys(PLATFORMS).map(p => (
          <button key={p} type="button" disabled={!!existing} onClick={() => setForm(f => ({ ...f, platform: p }))}
            className={`seg-btn flex-1 !py-1.5 disabled:opacity-60 ${form.platform === p ? 'seg-btn-active' : ''}`}>
            {PLATFORMS[p].label}
          </button>
        ))}
      </div>
      {existing && <p className="text-[11px] text-surface-300 -mt-1">Platform tidak bisa diubah — hapus lalu tambah ulang kalau salah.</p>}

      <Field label="Nama tampilan">
        <input value={form.name} onChange={set('name')} required placeholder="mis. Flash Sale" className={inputCls} />
      </Field>

      <Field label="API Key"
        hint={form.platform === 'gate' ? 'Gate: Account → APIv4 Keys; izin Spot (read, untuk saldo) + P2P/merchant. Pasang whitelist IP server bila ada.' : null}>
        <input value={form.apiKey} onChange={set('apiKey')} required={!existing}
          placeholder={form.platform === 'bingx' ? 'API key BingX (akun merchant P2P)' : form.platform === 'gate' ? 'APIv4 Key Gate (akun merchant P2P)' : 'mx0v...'}
          className={inputCls + ' font-mono'} />
      </Field>

      {form.platform === 'gate' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fiat"><input value={form.fiat} onChange={e => setForm(f => ({ ...f, fiat: e.target.value.toUpperCase() }))} required placeholder="IDR" maxLength={6} className={inputCls + ' font-mono'} /></Field>
          <Field label="Kripto"><input value={form.asset} onChange={e => setForm(f => ({ ...f, asset: e.target.value.toUpperCase() }))} required placeholder="USDT" maxLength={6} className={inputCls + ' font-mono'} /></Field>
        </div>
      )}

      <Field label={existing ? 'API Secret (kosongkan = tidak diubah)' : 'API Secret'}>
        <div className="relative">
          <input type={showSecret ? 'text' : 'password'} value={form.apiSecret} onChange={set('apiSecret')} required={!existing}
            placeholder={existing ? '(tidak diubah)' : 'API Secret…'} className={inputCls + ' pr-10 font-mono'} />
          <button type="button" onClick={() => setShowSecret(!showSecret)} aria-label={showSecret ? 'Sembunyikan' : 'Tampilkan'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-300 hover:text-surface-50">
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </Field>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">Batal</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </form>
  );
}

function MerchantsTab() {
  const [merchants, setMerchants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);       // merchant id under test
  const [testResult, setTestResult] = useState({});   // merchant id -> report

  const countOn = (p) => merchants.filter(m => platformOf(m) === p).length;
  const canAdd = Object.keys(PLATFORM_MAX).some(p => countOn(p) < PLATFORM_MAX[p]);

  async function load() {
    try { setMerchants((await merchantApi.list()).data); } catch {}
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const saved = () => { setShowForm(false); setEditingId(null); load(); invalidateQueueMerchants(); refreshQueue(); };

  // "Tes koneksi" for BingX / Gate: the probe, from the dashboard. BingX only:
  // post=true adds ONE no-op write (first ad's price rewritten to its current
  // value) to confirm the POST body format — the operator chooses, never automatic.
  async function runTest(m, post) {
    if (post && !await askConfirm({ title: 'Uji POST ke BingX?', message: 'Harga iklan pertama akan ditulis ulang ke nilai yang SAMA PERSIS (tidak ada perubahan), untuk memastikan format POST diterima BingX.', confirmText: 'Jalankan', danger: true })) return;
    setTesting(m.id);
    const label = m.platform === 'gate' ? 'Gate' : 'BingX';
    try {
      const r = m.platform === 'gate' ? await merchantApi.gateTest(m.id) : await merchantApi.bingxTest(m.id, post);
      setTestResult(prev => ({ ...prev, [m.id]: r.data }));
      r.data?.ok ? toast.success(`${label} ${m.name}: koneksi OK`) : toast.error(`${label} ${m.name}: ada langkah yang gagal`);
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setTesting(null); }
  }

  async function deleteMerchant(m) {
    if (!await askConfirm({ title: 'Hapus merchant', message: `Hapus ${m.name} dari dashboard? API key yang tersimpan untuk merchant ini ikut dihapus dari server.`, confirmText: 'Hapus', danger: true })) return;
    try { await merchantApi.delete(m.id); toast.success('Merchant dihapus'); load(); invalidateQueueMerchants(); refreshQueue(); }
    catch { toast.error('Gagal menghapus'); }
  }

  const quota = Object.keys(PLATFORM_MAX).map(p => `${PLATFORMS[p].label} ${countOn(p)}/${PLATFORM_MAX[p]}`).join(' · ');

  return (
    <div className="space-y-3">
      <SectionHeader title="Merchant" desc={quota}
        action={!showForm && canAdd && <button onClick={() => { setShowForm(true); setEditingId(null); }} className="btn-primary !h-8 !text-xs"><Plus size={14} /> Tambah</button>} />

      {showForm && <MerchantForm onSave={saved} onCancel={() => setShowForm(false)} />}

      {loading ? <div className="skeleton h-40" /> : merchants.length === 0 && !showForm ? (
        <div className="card border-dashed p-8 text-center">
          <p className="text-sm text-surface-300">Belum ada merchant</p>
          <button onClick={() => setShowForm(true)} className="mt-2 text-sm text-brand-300 hover:underline">Tambah merchant pertama →</button>
        </div>
      ) : (
        <div className="card divide-y divide-surface-700">
          {merchants.map(m => editingId === m.id ? (
            <div key={m.id} className="p-2"><MerchantForm existing={m} onSave={saved} onCancel={() => setEditingId(null)} /></div>
          ) : (
            <div key={m.id} className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <img src={PLATFORMS[platformOf(m)].logo} alt={PLATFORMS[platformOf(m)].label} className="w-8 h-8 rounded-lg bg-white flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-50 truncate">{m.name}</p>
                  <p className="text-[11px] text-surface-300 font-mono truncate">
                    {PLATFORMS[platformOf(m)].label} · {maskKey(m.apiKey)}{m.platform === 'gate' ? ` · ${m.asset || 'USDT'}/${m.fiat || 'IDR'}` : ''}
                  </p>
                </div>
                {(m.platform === 'bingx' || m.platform === 'gate') && (
                  <button onClick={() => runTest(m, false)} disabled={testing === m.id} className={btnSmGhost} title="Tes koneksi (hanya baca)">
                    <Activity size={12} className={testing === m.id ? 'animate-pulse' : ''} /><span className="hidden sm:inline">Tes koneksi</span>
                  </button>
                )}
                <button onClick={() => { setEditingId(m.id); setShowForm(false); }} aria-label={`Edit ${m.name}`}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-300 hover:text-surface-50 hover:bg-surface-700">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteMerchant(m)} aria-label={`Hapus ${m.name}`}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-300 hover:text-sell hover:bg-sell/10">
                  <Trash2 size={14} />
                </button>
              </div>

              {testResult[m.id] && (
                <div className="mt-3 bg-surface-900 rounded-lg p-2.5 text-[11px] font-mono space-y-1">
                  {testResult[m.id].steps.map(s => (
                    <p key={s.name} className={`flex items-center gap-1.5 ${s.ok ? 'text-buy' : 'text-sell'}`}>
                      {s.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {s.name} {s.ok ? `· ${s.ms} ms` : `· ${s.code ?? ''} ${s.msg}`}
                    </p>
                  ))}
                  {testResult[m.id].post && (
                    <p className={`flex items-center gap-1.5 ${testResult[m.id].post.ok ? 'text-buy' : 'text-sell'}`}>
                      {testResult[m.id].post.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} POST modifyPrice (mode {testResult[m.id].postMode}) {testResult[m.id].post.ok ? '· OK' : `· ${testResult[m.id].post.code ?? ''} ${testResult[m.id].post.msg}`}
                    </p>
                  )}
                  {testResult[m.id].account && (
                    <p className="text-surface-300">
                      akun <b className="text-surface-100">{testResult[m.id].account.userName || '—'}</b> · status kerja {testResult[m.id].account.workStatus ?? '?'} · online {testResult[m.id].account.onlineStatus ?? '?'}
                      {testResult[m.id].balance ? ` · saldo spot ${testResult[m.id].balance.free} ${testResult[m.id].asset}` : ''}
                    </p>
                  )}
                  <p className="text-surface-300">
                    selisih jam {testResult[m.id].driftMs ?? '?'} ms · {testResult[m.id].orders} order · {testResult[m.id].ads} iklan{testResult[m.id].postMode ? ` · format POST: ${testResult[m.id].postMode}` : ''}
                  </p>
                  {m.platform === 'bingx' && (
                    <button onClick={() => runTest(m, true)} disabled={testing === m.id}
                      className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 border border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-50">
                      <Activity size={11} /> Uji POST (no-op)
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountTab() {
  // v76: one account — username + password. Both live in config.json
  // (appUser / appPassword); older installs show up as "admin".
  const [me, setMe] = useState('');
  const [uform, setUform] = useState({ newUsername: '', password: '' });
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [uloading, setUloading] = useState(false);
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { authApi.me().then(r => setMe(r.data?.user || '')).catch(() => {}); }, []);

  async function changeUsername(e) {
    e.preventDefault();
    setUloading(true);
    try {
      const r = await authApi.changeUsername(uform.password, uform.newUsername.trim());
      if (r.data?.token) login(r.data.token); // keep this session signed in under the new name
      setMe(r.data?.user || uform.newUsername);
      setUform({ newUsername: '', password: '' });
      toast.success('Username diganti');
    } catch (err) { toast.error(err.response?.data?.error || 'Gagal mengganti username'); }
    finally { setUloading(false); }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('Password baru tidak sama'); return; }
    setLoading(true);
    try {
      await authApi.changePassword(form.oldPassword, form.newPassword);
      toast.success('Password diganti');
      setForm({ oldPassword: '', newPassword: '', confirm: '' });
    } catch (err) { toast.error(err.response?.data?.error || 'Gagal mengganti password'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-3">
      <SectionHeader title="Akun" desc={me ? `Login sebagai ${me}` : null}
        action={<button onClick={() => { logout(); navigate('/login'); }} className={`${btnSmGhost} hover:!text-sell`}><LogOut size={13} /> Keluar</button>} />
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Ganti username">
          <form onSubmit={changeUsername} className="space-y-3">
            <Field label="Username baru" hint="3–32 karakter: huruf kecil, angka, . _ -">
              <input type="text" value={uform.newUsername} onChange={e => setUform(f => ({ ...f, newUsername: e.target.value }))} required
                autoCapitalize="none" autoCorrect="off" spellCheck={false} className={inputCls} />
            </Field>
            <Field label="Password saat ini">
              <input type="password" value={uform.password} onChange={e => setUform(f => ({ ...f, password: e.target.value }))} required autoComplete="current-password" className={inputCls} />
            </Field>
            <button type="submit" disabled={uloading} className="btn-ghost w-full">{uloading ? 'Menyimpan…' : 'Ganti username'}</button>
          </form>
        </Card>

        <Card title="Ganti password">
          <form onSubmit={changePassword} className="space-y-3">
            {[
              { key: 'oldPassword', label: 'Password saat ini', ac: 'current-password' },
              { key: 'newPassword', label: 'Password baru', ac: 'new-password' },
              { key: 'confirm', label: 'Ulangi password baru', ac: 'new-password' },
            ].map(({ key, label, ac }) => (
              <Field key={key} label={label}>
                <input type="password" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} required autoComplete={ac} className={inputCls} />
              </Field>
            ))}
            <p className="text-[11px] text-surface-300">Minimal 8 karakter. Salah 5× dari satu alamat = terkunci 15 menit.</p>
            <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Menyimpan…' : 'Ganti password'}</button>
          </form>
        </Card>
      </div>
      <VersionInfo />
    </div>
  );
}

export default function Settings() {
  // Tab lives in the URL (?tab=notif) so a reload or a shared link lands on it.
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'merchant';
  const go = (key) => setParams(key === 'merchant' ? {} : { tab: key }, { replace: true });

  return (
    <Layout>
      <div className="page-h overflow-y-auto">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 pt-4 sm:pt-8 pb-6">
          <h1 className="text-xl font-semibold text-surface-50 px-1 md:px-0">Settings</h1>

          <div className="mt-3 md:mt-6 md:grid md:grid-cols-[190px_minmax(0,1fr)] md:gap-8">
            {/* Mobile: sticky horizontal tabs. Desktop: vertical list. */}
            <nav className="sticky top-0 z-20 -mx-3 px-3 py-2 glass md:static md:m-0 md:p-0 md:bg-transparent md:backdrop-blur-0 md:border-0">
              <div className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar md:sticky md:top-6">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => go(key)} aria-current={tab === key ? 'page' : undefined}
                    className={`flex items-center gap-2 whitespace-nowrap text-sm rounded-lg px-3 h-9 transition-colors flex-shrink-0 ${
                      tab === key ? 'bg-brand-500/15 text-brand-200' : 'text-surface-200 hover:text-surface-50 hover:bg-surface-800'}`}>
                    <Icon size={15} className="flex-shrink-0" /> {label}
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-w-0 max-w-2xl mt-4 md:mt-0">
              {tab === 'merchant' && <MerchantsTab />}
              {tab === 'buyer' && <BuyerLogSettings />}
              {tab === 'notif' && <NotifySettings />}
              {tab === 'reply' && <MessageSettings />}
              {tab === 'sound' && <SoundSettings />}
              {tab === 'account' && <AccountTab />}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
