import { useState, useEffect } from 'react';
import { merchantApi, authApi } from '../api';
import Layout from '../components/Layout';
import MessageSettings from '../components/MessageSettings';
import SoundSettings from '../components/SoundSettings';
import VersionInfo from '../components/VersionInfo';
import { Plus, Trash2, Edit2, Save, X, Eye, EyeOff, Key, Activity, CheckCircle2, XCircle } from 'lucide-react';
import { PlatformBadge, PLATFORMS } from '../components/helpers';
import { invalidateQueueMerchants, refreshQueue } from '../actionQueue';

// Per-platform caps — mirrored from backend/routes/merchants.js.
const PLATFORM_MAX = { mexc: 5, bingx: 2 };
import toast from 'react-hot-toast';
import { askConfirm } from '../components/confirm';

function MerchantForm({ existing, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    apiKey: existing?.apiKey || '',
    apiSecret: '',
    platform: existing?.platform || 'mexc',
  });
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!existing && !form.apiSecret) {
      toast.error('API Secret is required');
      return;
    }
    setLoading(true);
    try {
      if (existing) {
        await merchantApi.update(existing.id, form);
        toast.success('Merchant updated');
      } else {
        await merchantApi.add(form);
        toast.success('Merchant added');
      }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-800 border border-surface-200/10 rounded-xl p-4 space-y-3">
      <h3 className="font-display font-semibold text-white text-sm">
        {existing ? 'Edit Merchant' : 'Add Merchant'}
      </h3>

      <div>
        <label className="block text-xs font-mono text-surface-200/40 uppercase tracking-wider mb-1">Platform</label>
        <div className="flex gap-2">
          {Object.keys(PLATFORMS).map(p => (
            <button key={p} type="button" disabled={!!existing} onClick={() => setForm(f => ({ ...f, platform: p }))}
              className={`flex-1 rounded-lg py-2 text-sm font-mono border transition-colors disabled:opacity-60 ${
                form.platform === p ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-200/10 hover:text-surface-100'}`}>
              {PLATFORMS[p].label}
            </button>
          ))}
        </div>
        {existing && <p className="text-[11px] text-surface-200/40 font-mono mt-1">Platform tidak bisa diubah — hapus lalu tambah ulang kalau salah.</p>}
      </div>

      <div>
        <label className="block text-xs font-mono text-surface-200/40 uppercase tracking-wider mb-1">Display Name</label>
        <input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
          placeholder="e.g. Merchant 1"
          className="w-full bg-surface-900 border border-surface-200/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors font-mono"
        />
      </div>

      <div>
        <label className="block text-xs font-mono text-surface-200/40 uppercase tracking-wider mb-1">API Key</label>
        <input
          value={form.apiKey}
          onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
          required={!existing}
          placeholder={form.platform === 'bingx' ? 'API key BingX (akun merchant P2P)' : 'mx0v...'}
          className="w-full bg-surface-900 border border-surface-200/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors font-mono"
        />
      </div>

      <div>
        <label className="block text-xs font-mono text-surface-200/40 uppercase tracking-wider mb-1">
          API Secret {existing && <span className="text-surface-200/30">(leave blank to keep current)</span>}
        </label>
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            value={form.apiSecret}
            onChange={e => setForm(f => ({ ...f, apiSecret: e.target.value }))}
            required={!existing}
            placeholder={existing ? '(unchanged)' : 'API Secret...'}
            className="w-full bg-surface-900 border border-surface-200/10 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors font-mono"
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-200/40 hover:text-surface-200"
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-surface-900 hover:bg-surface-700 text-surface-200 rounded-lg py-2 text-sm font-mono transition-colors flex items-center justify-center gap-1"
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-black rounded-lg py-2 text-sm font-display font-semibold transition-colors flex items-center justify-center gap-1"
        >
          <Save size={14} /> {loading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function ChangePasswordSection() {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(form.oldPassword, form.newPassword);
      toast.success('Password changed');
      setForm({ oldPassword: '', newPassword: '', confirm: '' });
    } catch {
      toast.error('Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-800 border border-surface-200/10 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Key size={16} className="text-surface-200/40" />
        <h3 className="font-display font-semibold text-white text-sm">Change Password</h3>
      </div>
      {[
        { key: 'oldPassword', label: 'Current Password' },
        { key: 'newPassword', label: 'New Password' },
        { key: 'confirm', label: 'Confirm New Password' }
      ].map(({ key, label }) => (
        <div key={key}>
          <label className="block text-xs font-mono text-surface-200/40 uppercase tracking-wider mb-1">{label}</label>
          <input
            type="password"
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            required
            className="w-full bg-surface-900 border border-surface-200/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors font-mono"
          />
        </div>
      ))}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-black rounded-lg py-2.5 text-sm font-display font-semibold transition-colors"
      >
        {loading ? 'Changing...' : 'Change Password'}
      </button>
    </form>
  );
}

export default function Settings() {
  const [merchants, setMerchants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);       // merchant id under test
  const [testResult, setTestResult] = useState({});   // merchant id -> report

  const countOn = (p) => merchants.filter(m => (m.platform || 'mexc') === p).length;
  const canAdd = Object.keys(PLATFORM_MAX).some(p => countOn(p) < PLATFORM_MAX[p]);

  // "Tes koneksi" for BingX: the probe, from the dashboard. post=true adds ONE
  // no-op write (first ad's price rewritten to its current value) to confirm
  // the POST body format — the operator chooses, it is never automatic.
  async function runTest(m, post) {
    if (post && !await askConfirm({ title: 'Uji POST ke BingX?', message: 'Harga iklan pertama akan ditulis ulang ke nilai yang SAMA PERSIS (tidak ada perubahan), untuk memastikan format POST diterima BingX.', confirmText: 'Jalankan', danger: true })) return;
    setTesting(m.id);
    try {
      const r = await merchantApi.bingxTest(m.id, post);
      setTestResult(prev => ({ ...prev, [m.id]: r.data }));
      r.data?.ok ? toast.success(`BingX ${m.name}: koneksi OK`) : toast.error(`BingX ${m.name}: ada langkah yang gagal`);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally { setTesting(null); }
  }

  async function load() {
    try {
      const r = await merchantApi.list();
      setMerchants(r.data);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function deleteMerchant(id) {
    if (!await askConfirm({ title: 'Remove merchant', message: 'Remove this merchant from the dashboard? Its stored API keys will be deleted from this machine.', confirmText: 'Remove', danger: true })) return;
    try {
      await merchantApi.delete(id);
      toast.success('Merchant removed');
      load(); invalidateQueueMerchants(); refreshQueue();
    } catch { toast.error('Failed to remove'); }
  }

  return (
    <Layout>
      <div className="h-[100dvh] overflow-y-auto p-3 sm:p-6">
        <div className="max-w-lg mx-auto space-y-5 sm:space-y-6">
          <div>
            <h1 className="font-display font-semibold text-white text-xl">Settings</h1>
            <p className="text-xs text-surface-200/40 font-mono mt-1">Manage merchants and app configuration</p>
          </div>

          {/* Merchants */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-white text-sm">Merchants</h2>
              {!showForm && canAdd && (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-1.5 text-xs font-mono text-brand-400 hover:text-brand-500 transition-colors"
                >
                  <Plus size={13} /> Add
                </button>
              )}
            </div>

            {showForm && (
              <div className="mb-3">
                <MerchantForm
                  onSave={() => { setShowForm(false); load(); invalidateQueueMerchants(); refreshQueue(); }}
                  onCancel={() => setShowForm(false)}
                />
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : merchants.length === 0 && !showForm ? (
              <div className="bg-surface-800 border border-dashed border-surface-200/10 rounded-xl p-8 text-center">
                <p className="text-surface-200/40 text-sm font-mono">No merchants added yet</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-3 text-brand-400 text-xs font-mono hover:underline"
                >
                  Add your first merchant →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {merchants.map(m => (
                  editingId === m.id ? (
                    <MerchantForm
                      key={m.id}
                      existing={m}
                      onSave={() => { setEditingId(null); load(); invalidateQueueMerchants(); refreshQueue(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div
                      key={m.id}
                      className="bg-surface-800 border border-surface-200/10 rounded-xl px-4 py-3 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-white font-display font-semibold text-sm flex items-center gap-2">{m.name} <PlatformBadge platform={m.platform || 'mexc'} /></p>
                        <p className="text-xs text-surface-200/40 font-mono mt-0.5 truncate">{m.apiKey}</p>
                        {m.platform === 'bingx' && (
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-1.5">
                              <button onClick={() => runTest(m, false)} disabled={testing === m.id}
                                className="flex items-center gap-1 text-[11px] font-mono rounded-md px-2 py-1 border border-surface-200/10 text-surface-200 hover:text-white hover:bg-surface-700 disabled:opacity-50 transition-colors">
                                <Activity size={11} className={testing === m.id ? 'animate-pulse' : ''} /> Tes koneksi (baca)
                              </button>
                              <button onClick={() => runTest(m, true)} disabled={testing === m.id}
                                className="flex items-center gap-1 text-[11px] font-mono rounded-md px-2 py-1 border border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-50 transition-colors">
                                <Activity size={11} /> + uji POST (no-op)
                              </button>
                            </div>
                            {testResult[m.id] && (
                              <div className="mt-2 bg-surface-900 rounded-lg p-2.5 text-[11px] font-mono space-y-1">
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
                                <p className="text-surface-200/50">
                                  selisih jam {testResult[m.id].driftMs ?? '?'} ms · {testResult[m.id].orders} order · {testResult[m.id].ads} iklan · format POST: {testResult[m.id].postMode}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-3 self-start">
                        <button
                          onClick={() => setEditingId(m.id)}
                          className="w-8 h-8 rounded flex items-center justify-center text-surface-200/40 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => deleteMerchant(m.id)}
                          className="w-8 h-8 rounded flex items-center justify-center text-surface-200/40 hover:text-danger hover:bg-surface-700 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </section>

          {/* Change Password */}
          <ChangePasswordSection />

          {/* Info */}
          <MessageSettings />

          <SoundSettings />

          <VersionInfo />

          <div className="bg-surface-800/50 border border-surface-200/5 rounded-xl p-4 text-xs text-surface-200/30 font-mono space-y-1">
            <p>• API keys are stored locally on your machine</p>
            <p>• Maksimal 5 merchant MEXC + 2 merchant BingX</p>
            <p>• BingX: order masuk Antrian bersama; chat & auto-reply BingX menyusul</p>
            <p>• Dashboard auto-refreshes every 30 seconds</p>
            <p>• MEXC P2P API v1.3</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
