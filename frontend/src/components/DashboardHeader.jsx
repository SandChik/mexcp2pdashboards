import { Calendar, Radio, RefreshCw, Plus, Bell, X } from 'lucide-react';

/**
 * One header for the MEXC, BingX and Gate dashboards (v81) — they were three
 * hand-copied blocks that had drifted apart.
 *
 * Phone: platform + merchant count on the left, ONE compact toolbar on the
 * right (range · auto · refresh), merchant switcher as a segmented control
 * below. "+ Merchant" is desktop-only — Settings is one tap away in the dock.
 */
export default function DashboardHeader({
  platform,                 // { logo, label }
  merchantCount,
  rangeLabel, showDate, setShowDate, dateRef, sheetRef, datePanel,
  autoRefresh, setAutoRefresh, autoTitle,
  onRefresh, onAdd, addTitle,
  switcher,                 // { items: [{ id, name, count }], active, onSelect(i) } | null
  alert, onAlertOpen, onAlertClose,
}) {
  const sep = <span aria-hidden className="w-px h-4 bg-surface-700" />;
  const toolBtn = 'flex items-center justify-center gap-1.5 h-8 rounded-lg px-2 text-xs transition-colors';

  return (<>
    <header className="glass border-b flex-shrink-0 z-30">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-14">
        {/* Identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/brand/sandchik-mark.png" alt="SandChik" className="hidden sm:block w-7 h-7 rounded-md bg-[#f6f3ee] flex-shrink-0" />
          <span className="hidden sm:block font-semibold text-surface-50 text-[15px] tracking-tight">SandChik P2P</span>
          <span aria-hidden className="hidden sm:block w-px h-5 bg-surface-700" />
          <img src={platform.logo} alt="" className="w-7 h-7 sm:w-5 sm:h-5 rounded-lg sm:rounded-md bg-white flex-shrink-0" />
          <div className="min-w-0 leading-tight">
            <span className="block sm:inline text-[15px] sm:text-sm font-semibold sm:font-medium text-surface-50">{platform.label}</span>
            <span className="block sm:inline text-[11px] sm:text-xs text-surface-300 sm:ml-2 truncate">
              <span className="sm:hidden">SandChik · </span>{merchantCount} merchant
            </span>
          </div>
        </div>

        {/* Toolbar — one grouped control instead of four loose buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-0.5 rounded-xl border border-surface-700 bg-surface-900/70 p-0.5">
            <div className="relative" ref={dateRef}>
              <button onClick={() => setShowDate(s => !s)} aria-expanded={showDate} aria-label="Rentang tanggal"
                className={`${toolBtn} text-surface-100 hover:bg-surface-800 max-w-[118px] sm:max-w-[170px]`}>
                <Calendar size={13} className="flex-shrink-0 text-surface-300" />
                <span className="truncate">{rangeLabel}</span>
              </button>
              {showDate && <div className="hidden sm:block absolute right-0 top-10 z-40">{datePanel}</div>}
            </div>
            {sep}
            <button onClick={() => setAutoRefresh(a => !a)} title={autoTitle} aria-pressed={autoRefresh}
              aria-label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
              className={`${toolBtn} ${autoRefresh ? 'text-buy hover:bg-buy/10' : 'text-surface-300 hover:bg-surface-800'}`}>
              <Radio size={14} className={autoRefresh ? 'animate-pulse' : ''} />
              <span className="hidden sm:inline">{autoRefresh ? 'Auto' : 'Manual'}</span>
            </button>
            {sep}
            <button onClick={onRefresh} title="Refresh semua panel" aria-label="Refresh semua panel"
              className={`${toolBtn} w-8 !px-0 text-surface-200 hover:text-surface-50 hover:bg-surface-800`}>
              <RefreshCw size={14} />
            </button>
          </div>

          <button onClick={onAdd} title={addTitle} className="hidden sm:inline-flex btn-primary !h-8 !px-3 !text-xs">
            <Plus size={14} /> Merchant
          </button>
        </div>
      </div>

      {/* Phone: merchant switcher — one panel at a time beats a squashed grid */}
      {switcher && switcher.items.length > 1 && (
        <div className="lg:hidden px-3 pb-2.5">
          <div className="flex gap-0.5 rounded-xl border border-surface-700 bg-surface-900/70 p-0.5">
            {switcher.items.map((m, i) => {
              const on = switcher.active === i;
              return (
                <button key={m.id} onClick={() => switcher.onSelect(i)} aria-pressed={on}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 h-8 rounded-lg px-2 text-xs font-medium transition-colors ${
                    on ? 'bg-surface-700 text-surface-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-surface-300 hover:text-surface-50'}`}>
                  <span className="truncate">{m.name}</span>
                  {m.count > 0 && (
                    <span className="flex-shrink-0 bg-brand-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {m.count > 99 ? '99+' : m.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Activity on a panel you can't currently see */}
      {alert && (
        <button onClick={onAlertOpen}
          className="lg:hidden w-full flex items-center gap-2 px-3 py-2 bg-brand-500/15 border-t border-brand-500/30 text-left animate-slide-up">
          <Bell size={13} className="text-brand-300 flex-shrink-0" />
          <span className="text-xs text-brand-200 flex-1 truncate">
            {alert.delta} order baru di <b className="font-semibold text-brand-100">{alert.name}</b> — ketuk untuk lihat
          </span>
          <X size={14} className="text-surface-300 flex-shrink-0" onClick={e => { e.stopPropagation(); onAlertClose(); }} />
        </button>
      )}
    </header>

    {/* Phone: date range as a bottom sheet */}
    {showDate && (
      <div className="sm:hidden fixed inset-0 z-50 flex items-end animate-fade-in" onClick={() => setShowDate(false)}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div ref={sheetRef} className="relative w-full p-3 pb-safe animate-sheet-up" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-sm font-medium text-surface-50">Pilih rentang</span>
            <button onClick={() => setShowDate(false)} aria-label="Tutup" className="text-surface-300 hover:text-surface-50 p-1"><X size={18} /></button>
          </div>
          {datePanel}
        </div>
      </div>
    )}
  </>);
}
