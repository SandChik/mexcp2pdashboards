import { useState, useEffect } from 'react';
import { merchantApi } from '../api';
import { PLATFORMS, platformOf } from './helpers';
import { SectionHeader, Toggle } from './ui';
import { invalidateQueueMerchants, invalidateNameIndex } from '../actionQueue';
import { FileUp } from 'lucide-react';
import toast from 'react-hot-toast';

// Imports / manual entries live under this pseudo-merchant id (see captureCore).
const MANUAL_ID = 'manual';

/**
 * Settings → Catatan Buyer (v81).
 * Per merchant: is its buyer log on ("Catat & alert" — the same switch as the
 * panel's ⋮ menu), and WHICH records its "nama sama" alert compares against.
 * Never chosen = the merchant itself + imports.
 */
export default function BuyerLogSettings() {
  const [merchants, setMerchants] = useState([]);
  const [st, setSt] = useState({}); // id -> { buyerLog, sources }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ms = (await merchantApi.list()).data || [];
        setMerchants(ms);
        const rows = await Promise.all(ms.map(async m => {
          try {
            const s = (await merchantApi.getSettings(m.id)).data || {};
            return [m.id, { buyerLog: !!s.buyerLog, sources: Array.isArray(s.buyerLogSources) ? s.buyerLogSources : [m.id, MANUAL_ID] }];
          } catch { return [m.id, { buyerLog: false, sources: [m.id, MANUAL_ID] }]; }
        }));
        setSt(Object.fromEntries(rows));
      } catch { toast.error('Gagal memuat merchant'); }
      setLoaded(true);
    })();
  }, []);

  async function save(mid, patch, next) {
    const prev = st[mid];
    setSt(s => ({ ...s, [mid]: { ...s[mid], ...next } }));
    try {
      await merchantApi.setSettings(mid, patch);
      invalidateQueueMerchants(); invalidateNameIndex(); // Antrian picks it up on its next pass
    } catch {
      setSt(s => ({ ...s, [mid]: prev }));
      toast.error('Gagal menyimpan');
    }
  }

  const toggleLog = (m) => { const v = !st[m.id].buyerLog; save(m.id, { buyerLog: v }, { buyerLog: v }); };
  const toggleSource = (m, src) => {
    const cur = st[m.id].sources;
    const sources = cur.includes(src) ? cur.filter(x => x !== src) : [...cur, src];
    save(m.id, { buyerLogSources: sources }, { sources });
  };

  const chip = (on) =>
    `inline-flex items-center gap-1.5 text-xs rounded-full pl-1 pr-2.5 h-7 border transition-colors ${
      on ? 'bg-brand-500/15 border-brand-500/50 text-brand-200' : 'border-surface-700 text-surface-300 hover:text-surface-100 hover:border-surface-600'}`;

  return (
    <div>
      <SectionHeader title="Catatan Buyer"
        desc={'Alert "nama sama" tiap merchant hanya membandingkan dengan catatan yang dipilih di sini. Bawaan: merchant itu sendiri + impor.'} />

      {!loaded ? <div className="skeleton h-40" /> : merchants.length === 0 ? (
        <p className="text-sm text-surface-300">Belum ada merchant.</p>
      ) : (
        <div className="card divide-y divide-surface-700">
          {merchants.map(m => {
            const s = st[m.id] || { buyerLog: false, sources: [] };
            return (
              <div key={m.id} className="p-4">
                <div className="flex items-center gap-2.5">
                  <img src={PLATFORMS[platformOf(m)].logo} alt="" className="w-6 h-6 rounded-md bg-white flex-shrink-0" />
                  <span className="text-sm font-medium text-surface-50 truncate flex-1">{m.name}</span>
                  <span className="text-xs text-surface-300 hidden xs:inline">Catat & alert</span>
                  <Toggle small on={s.buyerLog} onChange={() => toggleLog(m)} label={`Catat buyer & alert nama — ${m.name}`} />
                </div>

                <div className={`mt-3 ${s.buyerLog ? '' : 'opacity-50'}`}>
                  <p className="text-[11px] text-surface-300 mb-1.5">Bandingkan dengan catatan dari</p>
                  <div className="flex flex-wrap gap-1.5">
                    {merchants.map(src => {
                      const on = s.sources.includes(src.id);
                      const off = st[src.id] && !st[src.id].buyerLog;
                      return (
                        <button key={src.id} onClick={() => toggleSource(m, src.id)} className={chip(on)}
                          title={off ? `Pencatatan ${src.name} mati — catatan lamanya tetap dipakai, tapi tidak ada data baru` : undefined}>
                          <img src={PLATFORMS[platformOf(src)].logo} alt="" className="w-5 h-5 rounded-full bg-white" />
                          {src.name}{off && <span className="text-surface-300/70">· mati</span>}
                        </button>
                      );
                    })}
                    <button onClick={() => toggleSource(m, MANUAL_ID)} className={chip(s.sources.includes(MANUAL_ID))}>
                      <span className="w-5 h-5 rounded-full bg-surface-700 flex items-center justify-center"><FileUp size={11} /></span>
                      Impor / manual
                    </button>
                  </div>
                  {s.sources.length === 0 && (
                    <p className="text-[11px] text-warning mt-2">Tanpa sumber, alert hanya menangkap nama yang muncul dua kali di order yang sedang tampil.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
