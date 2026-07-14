import { useState, useEffect } from 'react';
import { merchantApi, authApi } from '../api';
import Layout from '../components/Layout';
import MessageSettings from '../components/MessageSettings';
import { Plus, Trash2, Edit2, Save, X, Eye, EyeOff, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import { askConfirm } from '../components/confirm';

function MerchantForm({ existing, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    apiKey: existing?.apiKey || '',
    apiSecret: ''
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
          placeholder="mx0v..."
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
      load();
    } catch { toast.error('Failed to remove'); }
  }

  return (
    <Layout>
      <div className="h-screen overflow-y-auto p-6">
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <h1 className="font-display font-semibold text-white text-xl">Settings</h1>
            <p className="text-xs text-surface-200/40 font-mono mt-1">Manage merchants and app configuration</p>
          </div>

          {/* Merchants */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-white text-sm">Merchants</h2>
              {!showForm && merchants.length < 5 && (
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
                  onSave={() => { setShowForm(false); load(); }}
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
                      onSave={() => { setEditingId(null); load(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div
                      key={m.id}
                      className="bg-surface-800 border border-surface-200/10 rounded-xl px-4 py-3 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-white font-display font-semibold text-sm">{m.name}</p>
                        <p className="text-xs text-surface-200/40 font-mono mt-0.5 truncate">{m.apiKey}</p>
                      </div>
                      <div className="flex items-center gap-1 ml-3">
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

          <div className="bg-surface-800/50 border border-surface-200/5 rounded-xl p-4 text-xs text-surface-200/30 font-mono space-y-1">
            <p>• API keys are stored locally on your machine</p>
            <p>• Maximum 5 merchants supported</p>
            <p>• Dashboard auto-refreshes every 30 seconds</p>
            <p>• MEXC P2P API v1.3</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
