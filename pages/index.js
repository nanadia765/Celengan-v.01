import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import {
  nextAlloc, computeGoalProgress, computeProjection,
  computeTotals, computeCategoryBreakdown
} from '../lib/finance'

const fmt = n => 'Rp' + Math.round(n).toLocaleString('id-ID')
const CAT_ICON = { Jajan: '🍪', Mainan: '🧸', Buku: '📚', Lainnya: '✨' }

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState(null)
  const [tab, setTab] = useState('home')
  const [st, setSt] = useState(null)
  const [tx, setTx] = useState([])
  const [addAmt, setAddAmt] = useState('')
  const [spendAmt, setSpendAmt] = useState('')
  const [spendCat, setSpendCat] = useState('Jajan')

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)

    let { data: stateRow } = await supabase
      .from('user_state').select('*').eq('user_id', session.user.id).single()

    if (!stateRow) {
      const { data: created } = await supabase
        .from('user_state').insert({ user_id: session.user.id }).select().single()
      stateRow = created
    }
    setSt(stateRow)

    const { data: txRows } = await supabase
      .from('transactions').select('*').eq('user_id', session.user.id)
      .order('created_at', { ascending: false }).limit(50)
    setTx(txRows || [])
    setLoading(false)
  }

  async function saveStateRow(patch) {
    setSt(prev => ({ ...prev, ...patch }))
    await supabase.from('user_state').update(patch).eq('user_id', userId)
  }

  async function addMoney() {
    const amt = parseInt(addAmt) || 0
    if (amt <= 0) return
    await saveStateRow({ balance: st.balance + amt, streak: st.streak + 1 })
    const { data: row } = await supabase.from('transactions').insert({
      user_id: userId, date_label: 'Hari ini', description: 'Setor manual', amount: amt, type: 'in'
    }).select().single()
    setTx(prev => [row, ...prev])
    setAddAmt('')
  }

  async function spendMoney() {
    const amt = parseInt(spendAmt) || 0
    if (amt <= 0) return
    if (amt > st.balance) { alert('Uang di celengan tidak cukup'); return }
    await saveStateRow({ balance: st.balance - amt })
    const { data: row } = await supabase.from('transactions').insert({
      user_id: userId, date_label: 'Hari ini',
      description: 'Pengeluaran: ' + spendCat, amount: amt, type: 'out', category: spendCat
    }).select().single()
    setTx(prev => [row, ...prev])
    setSpendAmt('')
  }

  async function handleAllocChange(key, val) {
    const alloc = nextAlloc(
      { tabung: st.alloc_tabung, jajan: st.alloc_jajan, sedekah: st.alloc_sedekah },
      key, val
    )
    await saveStateRow({
      alloc_tabung: alloc.tabung, alloc_jajan: alloc.jajan, alloc_sedekah: alloc.sedekah
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading || !st) return <div className="loading">Memuat...</div>

  const { pct, remaining } = computeGoalProgress(st.balance, st.goal_target)
  const proj = computeProjection({
    target: st.proj_target, weekly: st.proj_weekly, daily: st.proj_daily, balance: st.balance
  })
  const { totalIn, totalOut, net } = computeTotals(tx)
  const cats = computeCategoryBreakdown(tx)
  const catTotal = Object.values(cats).reduce((a, b) => a + b, 0)

  return (
    <div className="app">
      <header className="topbar">
        <h1>CelenganKu</h1>
        <button onClick={signOut} className="btn-ghost">Keluar</button>
      </header>

      <nav className="tabs">
        {['home', 'alloc', 'proj', 'report', 'badge'].map(t => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {{ home: '🏠 Beranda', alloc: '🧮 Alokasi', proj: '🎯 Target', report: '📊 Laporan', badge: '🏅 Lencana' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'home' && (
        <section className="card">
          <div className="balance">{fmt(st.balance)}</div>
          <div className="goal">
            <div className="goal-top"><strong>{st.goal_name}</strong><span>{pct}%</span></div>
            <div className="track"><div className="fill" style={{ width: pct + '%' }} /></div>
            <div className="note">
              {remaining > 0 ? `${fmt(remaining)} lagi menuju ${fmt(st.goal_target)}` : 'Target tercapai! 🎉'}
            </div>
          </div>

          <div className="row">
            <input type="number" value={addAmt} onChange={e => setAddAmt(e.target.value)} placeholder="Rp jumlah..." />
            <button className="btn-in" onClick={addMoney}>+ Masuk</button>
          </div>

          <div className="row">
            <select value={spendCat} onChange={e => setSpendCat(e.target.value)}>
              <option>Jajan</option><option>Mainan</option><option>Buku</option><option>Lainnya</option>
            </select>
            <input type="number" value={spendAmt} onChange={e => setSpendAmt(e.target.value)} placeholder="Rp jumlah..." />
            <button className="btn-out" onClick={spendMoney}>- Catat</button>
          </div>

          <div className="streak">🔥 Streak: {st.streak} hari</div>
        </section>
      )}

      {tab === 'alloc' && (
        <section className="card">
          <label>Uang saku minggu ini:
            <input type="number" value={st.allowance}
              onChange={e => saveStateRow({ allowance: parseInt(e.target.value) || 0 })} />
          </label>
          {['tabung', 'jajan', 'sedekah'].map(k => (
            <div key={k} className="alloc-row">
              <div className="alloc-top"><span>{k}</span><span>{st['alloc_' + k]}%</span></div>
              <input type="range" min="0" max="100" value={st['alloc_' + k]}
                onChange={e => handleAllocChange(k, e.target.value)} />
              <div className="rp">{fmt(st.allowance * st['alloc_' + k] / 100)}</div>
            </div>
          ))}
        </section>
      )}

      {tab === 'proj' && (
        <section className="card">
          <label>Harga target:
            <input type="number" value={st.proj_target}
              onChange={e => saveStateRow({ proj_target: parseInt(e.target.value) || 0 })} />
          </label>
          <label>Nabung /minggu:
            <input type="number" value={st.proj_weekly}
              onChange={e => saveStateRow({ proj_weekly: parseInt(e.target.value) || 0 })} />
          </label>
          <label>Alternatif /hari:
            <input type="number" value={st.proj_daily}
              onChange={e => saveStateRow({ proj_daily: parseInt(e.target.value) || 0 })} />
          </label>
          <div className="result">
            {proj.remaining === 0
              ? 'Sudah cukup! 🎉'
              : proj.weeksMain != null
                ? `≈ ${proj.weeksMain} minggu lagi`
                : 'Isi nominal mingguan dulu'}
          </div>
        </section>
      )}

      {tab === 'report' && (
        <section className="card">
          <div className="stat-row">
            <div className="stat in">{fmt(totalIn)}<span>Total masuk</span></div>
            <div className="stat out">{fmt(totalOut)}<span>Total keluar</span></div>
          </div>
          <div className="net">{fmt(net)} <span>Saldo bersih</span></div>

          <div className="hist">
            {tx.slice(0, 10).map(t => (
              <div key={t.id} className={'hist-item ' + t.type}>
                <span>{t.type === 'in' ? '↑' : (CAT_ICON[t.category] || '↓')}</span>
                <span className="d">{t.description} · {t.date_label}</span>
                <span className="amt">{t.type === 'in' ? '+' : '-'}{fmt(t.amount)}</span>
              </div>
            ))}
            {tx.length === 0 && <p className="muted">Belum ada transaksi.</p>}
          </div>

          <div className="cat-breakdown">
            {Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, val]) => (
              <div key={name} className="cat-row">
                <span>{CAT_ICON[name]} {name}</span>
                <div className="track">
                  <div className="fill-coral" style={{ width: (catTotal ? Math.round(val / catTotal * 100) : 0) + '%' }} />
                </div>
                <span>{catTotal ? Math.round(val / catTotal * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'badge' && (
        <section className="card">
          <div className="badge-grid">
            <div className={st.streak >= 7 ? 'badge' : 'badge locked'}>🥉 7 Hari</div>
            <div className={st.streak >= 30 ? 'badge' : 'badge locked'}>🥈 30 Hari</div>
            <div className={st.streak >= 100 ? 'badge' : 'badge locked'}>🥇 100 Hari</div>
            <div className={st.alloc_tabung >= 50 ? 'badge' : 'badge locked'}>🍰 Bagi Rata</div>
            <div className={st.balance >= st.goal_target ? 'badge' : 'badge locked'}>🎯 Target 1</div>
          </div>
        </section>
      )}
    </div>
  )
}
