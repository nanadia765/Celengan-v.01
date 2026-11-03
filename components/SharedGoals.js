import { useEffect, useState } from 'react'

// Simpan sebagai components/SharedGoals.js

const fmt = n => 'Rp' + Math.round(n).toLocaleString('id-ID')
const parseMoney = v => Number(String(v ?? '').replace(/\D/g, '')) || 0
const formatThousands = v => String(v ?? '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const AVATAR_COLORS = [
  ['#fde7c2', '#8a6d00'], ['#dbe7fb', '#254a93'], ['#fbdcdc', '#9a2f2f'],
  ['#e6dcfb', '#5b3aa0'], ['#d9efe5', '#1b4b43']
]
const colorFor = id => AVATAR_COLORS[[...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]

function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'Baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Kemarin' : `${days} hari lalu`
}

function explain(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`
  if (/PGRST202|PGRST205|42P01|schema cache|does not exist/i.test(text)) {
    return 'Fitur nabung bersama belum aktif. Jalankan file shared-goals.sql di Supabase dulu.'
  }
  return err?.message || 'Terjadi kesalahan. Coba lagi.'
}

function Avatar({ id, label, size = 32 }) {
  const [bg, fg] = colorFor(id)
  return (
    <span className="sg-avatar" aria-hidden="true"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.42) }}>
      {String(label || '?').replace('@', '').charAt(0).toUpperCase()}
    </span>
  )
}

export default function SharedGoals({ supabase, userId, friends = [], balance = 0, onBalanceChange, onInvitesChange }) {
  const [data, setData] = useState({ goals: [], activity: [], names: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('list') // 'list' | 'create' | 'detail'
  const [detailId, setDetailId] = useState(null)
  const [depositId, setDepositId] = useState(null)
  const [depositAmt, setDepositAmt] = useState('')
  const [name, setName] = useState('')
  const [targetAmt, setTargetAmt] = useState('')
  const [picked, setPicked] = useState([])

  useEffect(() => { load() }, [userId])

  async function load() {
    setError('')
    const { data: memberRows, error: memberError } = await supabase
      .from('shared_goal_members').select('goal_id, user_id, status, contributed')
    if (memberError) {
      setError(explain(memberError))
      setLoading(false)
      return
    }
    const goalIds = [...new Set((memberRows || []).map(m => m.goal_id))]
    if (!goalIds.length) {
      setData({ goals: [], activity: [], names: {} })
      onInvitesChange?.(0)
      setLoading(false)
      return
    }
    const userIds = [...new Set(memberRows.map(m => m.user_id))]
    // Sengaja tidak mengambil foto profil di sini supaya bandwidth hemat; avatar memakai huruf awal.
    const [goalRes, nameRes, activityRes] = await Promise.all([
      supabase.from('shared_goals').select('id, name, target, owner_id, created_at').in('id', goalIds),
      supabase.from('profiles').select('user_id, username').in('user_id', userIds),
      supabase.from('shared_goal_activity')
        .select('id, goal_id, user_id, type, amount, created_at')
        .in('goal_id', goalIds).order('created_at', { ascending: false }).limit(60)
    ])
    const names = Object.fromEntries((nameRes.data || []).map(p => [p.user_id, p.username]))
    const goals = (goalRes.data || []).map(goal => {
      const members = memberRows.filter(m => m.goal_id === goal.id)
      const joined = members.filter(m => m.status === 'joined')
      const collected = joined.reduce((sum, m) => sum + (m.contributed || 0), 0)
      return {
        ...goal,
        me: members.find(m => m.user_id === userId),
        members: [...joined].sort((a, b) => (b.contributed || 0) - (a.contributed || 0)),
        collected,
        pct: Math.min(100, Math.round(collected / goal.target * 100))
      }
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setData({ goals, activity: activityRes.data || [], names })
    onInvitesChange?.(goals.filter(g => g.me?.status === 'invited').length)
    setLoading(false)
  }

  async function createGoal() {
    const target = parseMoney(targetAmt)
    if (!name.trim()) { setNotice('Isi nama targetnya dulu.'); return }
    if (target <= 0) { setNotice('Harga target harus lebih dari 0.'); return }
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('create_shared_goal', {
      p_name: name.trim(), p_target: target, p_friend_ids: picked
    })
    setBusy(false)
    if (rpcError) { setNotice(explain(rpcError)); return }
    setName(''); setTargetAmt(''); setPicked([]); setNotice('')
    setMode('list')
    await load()
  }

  async function respondInvite(goalId, accept) {
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('respond_shared_invite', { p_goal: goalId, p_accept: accept })
    setBusy(false)
    if (rpcError) { setNotice(explain(rpcError)); return }
    setNotice('')
    await load()
  }

  async function deposit() {
    const amount = parseMoney(depositAmt)
    if (amount <= 0) { setNotice('Isi jumlah yang mau ditabung.'); return }
    if (amount > balance) { setNotice(`Saldo bebasmu hanya ${fmt(balance)}.`); return }
    setBusy(true)
    const { data: newBalance, error: rpcError } = await supabase.rpc('contribute_to_shared_goal', {
      p_goal: depositId, p_amount: amount
    })
    setBusy(false)
    if (rpcError) { setNotice(explain(rpcError)); return }
    onBalanceChange?.(newBalance)
    setDepositId(null); setDepositAmt(''); setNotice('')
    await load()
  }

  async function removeGoal(goalId) {
    if (!window.confirm('Hapus target ini? Uang tiap anggota dikembalikan ke saldo bebas masing-masing.')) return
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('delete_shared_goal', { p_goal: goalId })
    if (rpcError) { setBusy(false); setNotice(explain(rpcError)); return }
    const { data: row } = await supabase.from('user_state').select('balance').eq('user_id', userId).single()
    if (row) onBalanceChange?.(row.balance)
    setBusy(false)
    setNotice('')
    setMode('list')
    setDetailId(null)
    await load()
  }

  function openDeposit(goalId) {
    setDepositId(goalId)
    setDepositAmt('')
    setNotice('')
  }

  function togglePick(friendId) {
    setPicked(prev => prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId])
  }

  const nameOf = id => id === userId ? 'Kamu' : '@' + (data.names[id] || 'pengguna')
  const myGoals = data.goals.filter(g => g.me?.status === 'joined')
  const invites = data.goals.filter(g => g.me?.status === 'invited')
  const myTotal = myGoals.reduce((sum, g) => sum + (g.me?.contributed || 0), 0)
  const depositGoal = data.goals.find(g => g.id === depositId)
  const detail = data.goals.find(g => g.id === detailId)

  if (loading) return <p className="sg-muted">Memuat target bersama...</p>
  if (error) return <p className="sg-error" role="alert">{error}</p>

  return (
    <div className="sg-wrap">
      {/* ---------- Daftar ---------- */}
      {mode === 'list' && <>
        <div className="sg-summary">
          <span>KONTRIBUSIMU DI TARGET BERSAMA</span>
          <strong>{fmt(myTotal)}</strong>
          <small>{myGoals.length} target aktif bersama teman</small>
        </div>

        {invites.map(g => (
          <div className="sg-invite" key={g.id}>
            <span className="sg-eyebrow warn">UNDANGAN MASUK</span>
            <div className="sg-row">
              <Avatar id={g.owner_id} label={data.names[g.owner_id]} size={40} />
              <div className="sg-grow">
                <strong>{nameOf(g.owner_id)} mengajakmu</strong>
                <small>{g.name} · {fmt(g.target)}</small>
              </div>
            </div>
            <div className="sg-actions">
              <button type="button" className="sg-primary" disabled={busy} onClick={() => respondInvite(g.id, true)}>Terima</button>
              <button type="button" className="sg-outline" disabled={busy} onClick={() => respondInvite(g.id, false)}>Tolak</button>
            </div>
          </div>
        ))}

        {!myGoals.length && !invites.length && (
          <p className="sg-muted">Belum ada target bersama. Ajak temanmu menabung untuk satu tujuan.</p>
        )}

        {myGoals.map(g => (
          <div className="sg-goal" key={g.id}>
            <div className="sg-row sg-between">
              <strong className="sg-goal-name">{g.name}</strong>
              <span className="sg-tag">{g.pct}%</span>
            </div>
            <small className="sg-muted">{fmt(g.collected)} dari {fmt(g.target)} · {g.members.length} anggota</small>
            <div className="sg-track"><div style={{ width: `${g.pct}%` }} /></div>
            <div className="sg-row sg-between">
              <div className="sg-stack">
                {g.members.slice(0, 4).map(m => <Avatar key={m.user_id} id={m.user_id} label={data.names[m.user_id]} />)}
                {g.members.length > 4 && <span className="sg-avatar sg-more">+{g.members.length - 4}</span>}
              </div>
              <span className="sg-mine">Kontribusimu {fmt(g.me?.contributed || 0)}</span>
            </div>
            <div className="sg-actions">
              <button type="button" className="sg-primary" onClick={() => openDeposit(g.id)}>Tabung</button>
              <button type="button" className="sg-outline" onClick={() => { setDetailId(g.id); setMode('detail'); setNotice('') }}>Lihat detail</button>
            </div>
          </div>
        ))}

        {notice && <p className="sg-error" role="alert">{notice}</p>}
        <button type="button" className="sg-primary sg-big" onClick={() => { setMode('create'); setNotice('') }}>+ Buat target bersama</button>
      </>}

      {/* ---------- Detail ---------- */}
      {mode === 'detail' && detail && <>
        <button type="button" className="back-btn" onClick={() => { setMode('list'); setNotice('') }}>← Target bersama</button>
        <div className="sg-summary">
          <span>TARGET BERSAMA · {detail.members.length} ANGGOTA</span>
          <strong className="sg-title">{detail.name}</strong>
          <small>{fmt(detail.collected)} dari {fmt(detail.target)}</small>
          <div className="sg-track warm"><div style={{ width: `${detail.pct}%` }} /></div>
          <small>{detail.pct}% terkumpul</small>
        </div>

        <div className="sg-goal">
          <strong>Kontribusi tiap teman</strong>
          {detail.members.map(m => {
            const share = detail.collected > 0 ? Math.round((m.contributed || 0) / detail.collected * 100) : 0
            return (
              <div className="sg-member" key={m.user_id}>
                <div className="sg-row">
                  <Avatar id={m.user_id} label={data.names[m.user_id]} size={40} />
                  <div className="sg-grow">
                    <strong>{nameOf(m.user_id)}{m.user_id === detail.owner_id ? ' (pembuat)' : ''}</strong>
                    <small>{share}% dari yang terkumpul</small>
                  </div>
                  <strong className="sg-money">{fmt(m.contributed || 0)}</strong>
                </div>
                <div className="sg-track"><div style={{ width: `${share}%` }} /></div>
              </div>
            )
          })}
        </div>

        <div className="sg-goal">
          <strong>Aktivitas terbaru</strong>
          {data.activity.filter(a => a.goal_id === detail.id).slice(0, 6).map(a => (
            <div className="sg-feed" key={a.id}>
              <span>
                {nameOf(a.user_id)}{' '}
                {a.type === 'deposit' ? `menabung ${fmt(a.amount)}` : a.type === 'join' ? 'bergabung' : 'membuat target'}
              </span>
              <small>{timeAgo(a.created_at)}</small>
            </div>
          ))}
        </div>

        {notice && <p className="sg-error" role="alert">{notice}</p>}
        <button type="button" className="sg-primary sg-big" onClick={() => openDeposit(detail.id)}>Tabung ke target ini</button>
        {detail.owner_id === userId && (
          <button type="button" className="sg-danger" disabled={busy} onClick={() => removeGoal(detail.id)}>Hapus target</button>
        )}
      </>}

      {/* ---------- Buat target ---------- */}
      {mode === 'create' && <>
        <button type="button" className="back-btn" onClick={() => { setMode('list'); setNotice('') }}>← Target bersama</button>
        <h3 className="sg-heading">Target bersama baru</h3>
        <label className="field-block">Nama target
          <input type="text" maxLength={60} value={name} placeholder="Contoh: Kado ulang tahun Dina"
            onChange={e => { setName(e.target.value); setNotice('') }} />
        </label>
        <label className="field-block">Harga target
          <input type="text" inputMode="numeric" value={formatThousands(targetAmt)} placeholder="Rp jumlah..."
            onChange={e => { setTargetAmt(e.target.value.replace(/\D/g, '')); setNotice('') }} />
        </label>

        <strong>Ajak teman</strong>
        <small className="sg-muted">Mereka bergabung setelah menerima undangan.</small>
        {!friends.length && <p className="sg-muted">Belum ada teman. Tambah teman dulu di tab Lainnya &gt; Teman.</p>}
        {friends.map(f => {
          const on = picked.includes(f.user_id)
          return (
            <button type="button" key={f.user_id} className={on ? 'sg-pick on' : 'sg-pick'} onClick={() => togglePick(f.user_id)}>
              <Avatar id={f.user_id} label={f.username} size={40} />
              <span className="sg-grow">@{f.username}</span>
              <span className="sg-check" aria-hidden="true">{on ? '✓' : ''}</span>
            </button>
          )
        })}

        <p className="sg-note">Uang yang kamu tabung diambil dari saldo bebasmu. Kalau target dihapus, uang kembali ke masing-masing teman.</p>
        {notice && <p className="sg-error" role="alert">{notice}</p>}
        <button type="button" className="sg-primary sg-big" disabled={busy} onClick={createGoal}>Buat dan kirim undangan</button>
      </>}

      {/* ---------- Sheet: tabung ---------- */}
      {depositGoal && (
        <div className="sheet-backdrop" onClick={() => setDepositId(null)}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Tabung bersama</h2>
            <p className="sheet-note">Saldo bebasmu: {fmt(balance)}</p>
            <div className="alloc-goal on">
              <strong>{depositGoal.name}</strong>
              <span>{fmt(depositGoal.collected)} / {fmt(depositGoal.target)}</span>
            </div>
            <input type="text" inputMode="numeric" placeholder="Rp jumlah..."
              value={formatThousands(depositAmt)}
              onChange={e => { setDepositAmt(e.target.value.replace(/\D/g, '')); setNotice('') }} />
            <div className="quick-row">
              {[10000, 25000, 50000].map(v => (
                <button type="button" key={v} onClick={() => setDepositAmt(String(Math.min(v, balance)))}>{fmt(v)}</button>
              ))}
            </div>
            {parseMoney(depositAmt) > 0 && (
              <p className="sg-note">
                Terkumpul jadi {fmt(depositGoal.collected + Math.min(parseMoney(depositAmt), balance))}{' '}
                ({Math.min(100, Math.round((depositGoal.collected + Math.min(parseMoney(depositAmt), balance)) / depositGoal.target * 100))}%)
              </p>
            )}
            {notice && <p className="sheet-error" role="alert">{notice}</p>}
            <button className="btn-in" disabled={busy} onClick={deposit}>Tabung sekarang</button>
          </div>
        </div>
      )}
    </div>
  )
}