import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import {
  nextAlloc, computeGoalProgress, computeProjection,
  computeTotals, computeCategoryBreakdown
} from '../lib/finance'

const fmt = n => 'Rp' + Math.round(n).toLocaleString('id-ID')
const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const formatTxDate = (createdAt, fallback = '') => {
  const d = createdAt ? new Date(createdAt) : new Date()
  if (Number.isNaN(d.getTime())) return fallback
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()} — ${hh}:${min}`
}
const formatAxisMoney = n => {
  if (n >= 1000000) return 'Rp' + String(Math.round(n / 100000) / 10).replace('.', ',') + 'jt'
  if (n >= 1000) return 'Rp' + String(Math.round(n / 100) / 10).replace('.', ',') + 'rb'
  return 'Rp' + Math.round(n)
}
const niceStep = raw => {
  const base = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 5, 10].map(m => m * base).find(v => v >= raw)
}
const formatThousands = value => String(value ?? '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const parseThousands = value => Number(String(value ?? '').replace(/\D/g, '')) || 0
const toDateKey = d => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const computeNextStreak = (lastDate, currentStreak) => {
  const today = toDateKey(new Date())
  if (lastDate === today) return currentStreak || 1
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (lastDate === toDateKey(yesterday)) return (currentStreak || 0) + 1
  return 1
}
function optimizeImageSource(source, maxDimension) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Tidak bisa memproses gambar'))
        return
      }
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      const optimized = canvas.toDataURL('image/jpeg', 0.74)
      resolve(source.startsWith('blob:') || optimized.length < source.length ? optimized : source)
    }
    image.onerror = () => reject(new Error('Gambar tidak bisa dibaca'))
    image.src = source
  })
}

const goalStorageKey = userId => `celenganku-goals-${userId}`
const readGoalItems = userId => {
  try {
    const storedItems = window.localStorage.getItem(goalStorageKey(userId))
    if (storedItems === null) return null
    const items = JSON.parse(storedItems)
    return Array.isArray(items) ? items : []
  } catch {
    return null
  }
}
const storeGoalItems = (userId, items) => {
  try {
    window.localStorage.setItem(goalStorageKey(userId), JSON.stringify(items))
    return true
  } catch {
    return false
  }
}
const CAT_ICON = { Jajan: '🍪', Mainan: '🧸', Buku: '📚', Lainnya: '✨' }
const CIRC = 2 * Math.PI * 45
const TAB_META = {
  home: { icon: '🏠', label: 'Beranda' },
  alloc: { icon: '🧮', label: 'Alokasi' },
  proj: { icon: '🎯', label: 'Target' },
  report: { icon: '📊', label: 'Laporan' },
  more: { icon: '☰', label: 'Lainnya' },
}
const MORE_TABS = ['more', 'badge', 'friends']

const DEMO_STATE = {
  balance: 0,
  goal_name: '',
  goal_target: 0,
  streak: 0,
  last_streak_date: null,
  allowance: 0,
  alloc_tabung: 0,
  alloc_jajan: 0,
  alloc_sedekah: 0,
  proj_target: 0,
  proj_weekly: 0,
  proj_daily: 0,
  goal_photo: '',
  profile_photo: '',
  goal_items: []
}

function FriendAvatar({ photo }) {
  return photo
    ? <img className="friend-avatar friend-avatar-photo" src={photo} alt="" loading="lazy" />
    : <span className="friend-avatar" aria-hidden="true">👤</span>
}

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState(null)
  const [tab, setTab] = useState('home')
  const [st, setSt] = useState(null)
  const [tx, setTx] = useState([])
  const [addAmt, setAddAmt] = useState('')
  const [spendAmt, setSpendAmt] = useState('')
  const [moneyDrafts, setMoneyDrafts] = useState({})
  const [spendCat, setSpendCat] = useState('Jajan')
  const [goalPhoto, setGoalPhoto] = useState('')
  const [profilePhoto, setProfilePhoto] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [goalItems, setGoalItems] = useState([])
  const [goalNameDraft, setGoalNameDraft] = useState('')
  const [editingGoalId, setEditingGoalId] = useState(null)
  const [goalError, setGoalError] = useState('')
  const [friendData, setFriendData] = useState({ username: '', friends: [], incoming: [], outgoing: [] })
  const [usernameDraft, setUsernameDraft] = useState('')
  const [friendSearch, setFriendSearch] = useState('')
  const [friendResults, setFriendResults] = useState([])
  const [friendMessage, setFriendMessage] = useState('')
  const [friendMessageType, setFriendMessageType] = useState('info')
  const [friendsLoading, setFriendsLoading] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)

    let { data: stateRow } = await supabase
      .from('user_state').select('*').eq('user_id', session.user.id).single()

    if (!stateRow) {
      const { data: created } = await supabase
        .from('user_state').insert({ user_id: session.user.id, ...DEMO_STATE }).select().single()
      stateRow = created
    }

    const normalizedState = { ...DEMO_STATE, ...(stateRow || {}) }
    setSt(normalizedState)
    setProfilePhoto(normalizedState.profile_photo || '')
    const savedGoalItems = Array.isArray(normalizedState.goal_items) ? normalizedState.goal_items : []
    const localGoalItems = readGoalItems(session.user.id)
    const currentGoalItems = localGoalItems ?? savedGoalItems
    setGoalItems(currentGoalItems.length ? currentGoalItems : (localGoalItems === null && normalizedState.goal_name ? [{
      id: 'existing-goal',
      name: normalizedState.goal_name,
      target: normalizedState.proj_target || normalizedState.goal_target,
      photo: normalizedState.goal_photo || ''
    }] : []))
    setGoalPhoto(currentGoalItems.length ? '' : normalizedState.goal_photo || '')

    const { data: txRows } = await supabase
      .from('transactions').select('*').eq('user_id', session.user.id)
      .order('created_at', { ascending: false }).limit(50)
    setTx(txRows || [])
    setLoading(false)

    loadFriendData(session.user.id, normalizedState.profile_photo || '')
    compactStoredPhotos(session.user.id, normalizedState, currentGoalItems)
  }

  async function loadFriendData(accountId, fallbackPhoto = '') {
    setFriendsLoading(true)
    const [profileResult, requestResult] = await Promise.all([
      supabase.from('profiles').select('username, profile_photo').eq('user_id', accountId).maybeSingle(),
      supabase.from('friend_requests').select('id, from_user, to_user, status, created_at')
        .or(`from_user.eq.${accountId},to_user.eq.${accountId}`).order('created_at', { ascending: false })
    ])

    if (profileResult.error || requestResult.error) {
      setFriendMessage('Jalankan migrasi fitur teman di Supabase terlebih dahulu.')
      setFriendMessageType('error')
      setFriendsLoading(false)
      return
    }

    if (profileResult.data?.username && fallbackPhoto && !profileResult.data.profile_photo) {
      optimizeImageSource(fallbackPhoto, 512).then(photo =>
        supabase.from('profiles').update({ profile_photo: photo }).eq('user_id', accountId)
      ).catch(() => {})
    }

    const requests = requestResult.data || []
    const relatedUserIds = [...new Set(requests.map(request =>
      request.from_user === accountId ? request.to_user : request.from_user
    ))]
    let profiles = []
    if (relatedUserIds.length) {
      const { data } = await supabase.from('profiles').select('user_id, username, profile_photo').in('user_id', relatedUserIds)
      profiles = data || []
    }
    const profileById = Object.fromEntries(profiles.map(profile => [profile.user_id, profile]))
    const decorate = request => {
      const otherUserId = request.from_user === accountId ? request.to_user : request.from_user
      return {
        ...request,
        user_id: otherUserId,
        username: profileById[otherUserId]?.username || 'Pengguna',
        profile_photo: profileById[otherUserId]?.profile_photo || ''
      }
    }
    const username = profileResult.data?.username || ''
    setFriendData({
      username,
      friends: requests.filter(request => request.status === 'accepted').map(decorate),
      incoming: requests.filter(request => request.status === 'pending' && request.to_user === accountId).map(decorate),
      outgoing: requests.filter(request => request.status === 'pending' && request.from_user === accountId).map(decorate)
    })
    setUsernameDraft(username)
    setFriendMessage('')
    setFriendsLoading(false)
  }

  async function saveUsername(event) {
    event.preventDefault()
    const username = usernameDraft.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setFriendMessage('Username harus 3–20 karakter: huruf kecil, angka, atau _.')
      setFriendMessageType('error')
      return
    }

    const { error } = await supabase.from('profiles').upsert(
      { user_id: userId, username, profile_photo: profilePhoto || null }, { onConflict: 'user_id' }
    )
    if (error) {
      setFriendMessage(error.code === '23505' ? 'Username itu sudah dipakai. Coba yang lain.' : 'Username belum bisa disimpan.')
      setFriendMessageType('error')
      return
    }

    setFriendData(prev => ({ ...prev, username }))
    setFriendMessage('Username tersimpan. Temanmu bisa mencarimu dengan nama ini.')
    setFriendMessageType('success')
  }

  async function searchFriends(event) {
    event.preventDefault()
    if (!friendData.username) {
      setFriendMessage('Simpan username kamu dulu sebelum mencari teman.')
      setFriendMessageType('error')
      return
    }
    const query = friendSearch.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (query.length < 3) {
      setFriendMessage('Ketik minimal 3 karakter username untuk mencari.')
      setFriendMessageType('error')
      return
    }

    const { data, error } = await supabase.rpc('search_profiles', { search_term: query })
    if (error) {
      setFriendMessage('Pencarian gagal. Pastikan migrasi fitur teman sudah dijalankan.')
      setFriendMessageType('error')
      return
    }
    setFriendResults(data || [])
    setFriendMessage(data?.length ? '' : 'Username tidak ditemukan.')
    setFriendMessageType('info')
  }

  async function sendFriendRequest(toUserId) {
    const { error } = await supabase.from('friend_requests').insert({ from_user: userId, to_user: toUserId })
    if (error) {
      setFriendMessage(error.code === '23505' ? 'Permintaan ke username ini sudah ada.' : 'Permintaan belum bisa dikirim.')
      setFriendMessageType('error')
      return
    }
    await loadFriendData(userId)
    setFriendMessage('Permintaan teman terkirim.')
    setFriendMessageType('success')
  }

  async function respondToFriendRequest(requestId, status) {
    const { error } = await supabase.from('friend_requests').update({ status })
      .eq('id', requestId).eq('to_user', userId)
    if (error) {
      setFriendMessage('Permintaan belum bisa diperbarui.')
      setFriendMessageType('error')
      return
    }
    await loadFriendData(userId)
    setFriendMessage(status === 'accepted' ? 'Sekarang kalian berteman!' : 'Permintaan ditolak.')
    setFriendMessageType(status === 'accepted' ? 'success' : 'info')
  }

  async function compactStoredPhotos(accountId, state, items) {
    const patch = {}
    try {
      if (state.profile_photo?.startsWith('data:') && state.profile_photo.length > 300000) {
        patch.profile_photo = await optimizeImageSource(state.profile_photo, 512)
      }
      if (state.goal_photo?.startsWith('data:') && state.goal_photo.length > 300000) {
        patch.goal_photo = await optimizeImageSource(state.goal_photo, 1000)
      }

      const compactedItems = await Promise.all(items.map(async item => {
        if (!item.photo?.startsWith('data:') || item.photo.length <= 300000) return item
        const photo = await optimizeImageSource(item.photo, 1000)
        return photo === item.photo ? item : { ...item, photo }
      }))
      if (compactedItems.some((item, index) => item !== items[index])) patch.goal_items = compactedItems
      if (!Object.keys(patch).length) return

      const { error } = await supabase.from('user_state').update(patch).eq('user_id', accountId)
      if (error) return

      setSt(prev => ({ ...prev, ...patch }))
      if (patch.profile_photo) setProfilePhoto(patch.profile_photo)
      if (patch.goal_photo) setGoalPhoto(patch.goal_photo)
      if (patch.goal_items) {
        setGoalItems(compactedItems)
        storeGoalItems(accountId, compactedItems)
      }
    } catch {
      return
    }
  }

  async function saveStateRow(patch) {
    setSt(prev => ({ ...prev, ...patch }))
    await supabase.from('user_state').update(patch).eq('user_id', userId)
  }

  function updateMoneyDraft(key, value) {
    setMoneyDrafts(prev => ({ ...prev, [key]: value.replace(/\D/g, '') }))
  }

  async function commitMoneyDraft(key, fallback = 0) {
    const draft = moneyDrafts[key]
    if (draft === undefined) return
    await saveStateRow({ [key]: draft === '' ? fallback : parseThousands(draft) })
    setMoneyDrafts(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function isGoalPrimary(item) {
    return item.is_primary === true
      || (item.is_primary !== false && item.name === st.goal_name && item.target === st.goal_target)
  }

  function editGoalItem(item) {
    setEditingGoalId(item.id)
    setGoalNameDraft(item.name)
    setMoneyDrafts(prev => ({ ...prev, proj_target: String(item.target) }))
    setGoalPhoto(item.photo || '')
    setGoalError('')
  }

  function cancelGoalEdit() {
    setEditingGoalId(null)
    setGoalNameDraft('')
    setGoalPhoto('')
    setGoalError('')
    setMoneyDrafts(prev => {
      const next = { ...prev }
      delete next.proj_target
      return next
    })
  }

  async function addGoalItem() {
    const name = goalNameDraft.trim()
    const target = parseThousands(moneyDrafts.proj_target ?? (st.proj_target ?? DEMO_STATE.proj_target))
    const editingItem = editingGoalId ? goalItems.find(item => item.id === editingGoalId) : null
    if (!name) {
      setGoalError('Isi nama barang yang ingin kamu beli dulu.')
      return
    }
    if (target <= 0) {
      setGoalError('Masukkan harga target yang lebih besar dari 0.')
      return
    }

    const item = {
      id: editingItem?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      target,
      photo: goalPhoto || '',
      is_primary: editingItem ? isGoalPrimary(editingItem) : true
    }
    const nextItems = editingItem
      ? goalItems.map(existing => existing.id === editingItem.id ? item : existing)
      : [...goalItems.map(existing => ({ ...existing, is_primary: false })), item]
    const primaryGoal = nextItems.find(candidate => candidate.is_primary) || nextItems.find(isGoalPrimary)
    const patch = { goal_items: nextItems }
    if (primaryGoal) {
      patch.goal_name = primaryGoal.name
      patch.goal_target = primaryGoal.target
      patch.proj_target = primaryGoal.target
    }
    const { error } = await supabase.from('user_state').update(patch).eq('user_id', userId)
    const savedLocally = storeGoalItems(userId, nextItems)
    if (error && !savedLocally) {
      setGoalError('Target tidak bisa disimpan. Periksa koneksi lalu coba lagi.')
      setFeedback({ type: 'goal-save-error' })
      return
    }

    setSt(prev => ({ ...prev, ...patch }))
    setGoalItems(nextItems)
    setGoalPhoto('')
    setGoalNameDraft('')
    setEditingGoalId(null)
    setMoneyDrafts(prev => {
      const next = { ...prev }
      delete next.proj_target
      return next
    })
    setGoalError('')
    setFeedback({
      type: editingItem ? 'goal-updated' : 'goal-added',
      itemName: name,
      localOnly: Boolean(error)
    })
  }

  async function makeGoalPrimary(itemId) {
    const primaryGoal = goalItems.find(item => item.id === itemId)
    if (!primaryGoal) return
    const nextItems = goalItems.map(item => ({ ...item, is_primary: item.id === itemId }))
    const patch = {
      goal_items: nextItems,
      goal_name: primaryGoal.name,
      goal_target: primaryGoal.target,
      proj_target: primaryGoal.target
    }
    const { error } = await supabase.from('user_state').update(patch).eq('user_id', userId)
    const savedLocally = storeGoalItems(userId, nextItems)
    if (error && !savedLocally) {
      setGoalError('Target utama tidak bisa diperbarui. Periksa koneksi lalu coba lagi.')
      return
    }

    setGoalItems(nextItems)
    setSt(prev => ({ ...prev, ...patch }))
    setMoneyDrafts(prev => {
      const next = { ...prev }
      delete next.proj_target
      return next
    })
    setGoalError(error ? 'Target utama tersimpan di perangkat ini; sinkronisasi akun perlu migrasi Supabase.' : '')
  }

  async function removeGoalItem(itemId) {
    const removedGoal = goalItems.find(item => item.id === itemId)
    const wasPrimary = removedGoal ? isGoalPrimary(removedGoal) : false
    const remainingItems = goalItems.filter(item => item.id !== itemId)
    const activeGoal = wasPrimary
      ? remainingItems[remainingItems.length - 1]
      : remainingItems.find(isGoalPrimary) || remainingItems[remainingItems.length - 1]
    const nextItems = remainingItems.map(item => ({ ...item, is_primary: item.id === activeGoal?.id }))
    const patch = {
      goal_items: nextItems,
      goal_name: activeGoal?.name || '',
      goal_target: activeGoal?.target || 0,
      proj_target: activeGoal?.target || 0
    }
    const { error } = await supabase.from('user_state').update(patch).eq('user_id', userId)
    const savedLocally = storeGoalItems(userId, nextItems)
    if (error && !savedLocally) {
      setGoalError('Target tidak bisa dihapus. Periksa koneksi lalu coba lagi.')
      return
    }

    setGoalItems(nextItems)
    setSt(prev => ({ ...prev, ...patch }))
    setGoalNameDraft('')
    setGoalPhoto('')
    setMoneyDrafts(prev => {
      const next = { ...prev }
      delete next.proj_target
      return next
    })
    setGoalError(error ? 'Target dihapus dari perangkat ini. Sinkronisasi akun perlu migrasi Supabase.' : '')
  }

  async function addMoney() {
    const amt = parseThousands(addAmt)
    if (amt <= 0) return
    await saveStateRow({
      balance: st.balance + amt,
      streak: computeNextStreak(st.last_streak_date, st.streak),
      last_streak_date: toDateKey(new Date())
    })
    const { data: row } = await supabase.from('transactions').insert({
      user_id: userId, date_label: formatTxDate(new Date()), description: 'Setor manual', amount: amt, type: 'in'
    }).select().single()
    setTx(prev => [row, ...prev])
    setAddAmt('')
    setFeedback({ type: 'success', amount: amt })
  }

  async function spendMoney() {
    const amt = parseThousands(spendAmt)
    if (amt <= 0) return
    if (amt > st.balance) {
      setFeedback({ type: 'insufficient', amount: amt })
      return
    }
    await saveStateRow({ balance: st.balance - amt })
    const { data: row } = await supabase.from('transactions').insert({
      user_id: userId, date_label: formatTxDate(new Date()),
      description: 'Pengeluaran: ' + spendCat, amount: amt, type: 'out', category: spendCat
    }).select().single()
    setTx(prev => [row, ...prev])
    setSpendAmt('')
    setFeedback({ type: 'spend-success', amount: amt, category: spendCat })
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

  async function handleGoalPhotoChange(event) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Pilih file gambar yang valid')
      return
    }

    if (file.size > 12 * 1024 * 1024) {
      alert('Ukuran foto barang maksimal 12 MB')
      return
    }

    const source = URL.createObjectURL(file)
    try {
      const optimized = await optimizeImageSource(source, 1000)
      setGoalPhoto(optimized)
      await saveStateRow({ goal_photo: optimized })
    } catch {
      alert('Foto gagal diproses. Coba pilih file lain.')
    } finally {
      URL.revokeObjectURL(source)
    }
  }

  async function handleProfilePhotoChange(event) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Pilih file gambar yang valid')
      return
    }

    if (file.size > 12 * 1024 * 1024) {
      alert('Ukuran foto profil maksimal 12 MB')
      return
    }

    const source = URL.createObjectURL(file)
    try {
      const optimized = await optimizeImageSource(source, 512)
      setProfilePhoto(optimized)
      await saveStateRow({ profile_photo: optimized })
      if (friendData.username) {
        await supabase.from('profiles').update({ profile_photo: optimized }).eq('user_id', userId)
      }
    } catch {
      alert('Foto gagal diproses. Coba pilih file lain.')
    } finally {
      URL.revokeObjectURL(source)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading || !st) return <div className="loading">Memuat...</div>

  const yesterdayKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toDateKey(d) })()
  const streakAlive = st.last_streak_date === toDateKey(new Date()) || st.last_streak_date === yesterdayKey
  const activeStreak = streakAlive ? st.streak : 0
  const { pct, remaining } = computeGoalProgress(st.balance, st.goal_target)
  const projectionTarget = parseThousands(moneyDrafts.proj_target ?? (st.proj_target ?? DEMO_STATE.proj_target))
  const proj = computeProjection({
    target: projectionTarget,
    weekly: st.proj_weekly, daily: st.proj_daily, balance: st.balance
  })
  const { totalIn, totalOut, net } = computeTotals(tx)
  const cats = computeCategoryBreakdown(tx)
  const catTotal = Object.values(cats).reduce((a, b) => a + b, 0)

  const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const dayTransactions = tx.filter(transaction => {
      if (!transaction.created_at) return false
      const transactionDate = new Date(transaction.created_at)
      return transactionDate.getFullYear() === date.getFullYear()
        && transactionDate.getMonth() === date.getMonth()
        && transactionDate.getDate() === date.getDate()
    })
    return {
      key,
      label: date.toLocaleDateString('id-ID', { weekday: 'short' }),
      income: dayTransactions.filter(transaction => transaction.type === 'in')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      expense: dayTransactions.filter(transaction => transaction.type === 'out')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    }
  })
  const maxDailyExpense = Math.max(...weeklyActivity.map(day => day.expense), 1)

  // Saldo akhir tiap hari: dihitung mundur dari saldo saat ini
  const dayBalances = []
  let runningBalance = st.balance
  for (let i = weeklyActivity.length - 1; i >= 0; i--) {
    dayBalances[i] = Math.max(0, runningBalance)
    runningBalance -= weeklyActivity[i].income - weeklyActivity[i].expense
  }
  const CHART_TOP = 12
  const CHART_BOTTOM = 108
  const yStep = niceStep(Math.max(Math.max(...dayBalances) / 3, 1000))
  const yTicks = [0, 1, 2, 3].map(i => i * yStep)
  const yMax = yStep * 3
  const chartY = value => CHART_BOTTOM - (value / yMax) * (CHART_BOTTOM - CHART_TOP)
  const chartPoints = dayBalances.map((value, index) => `${18 + index * 44},${chartY(value)}`).join(' ')

  const dT = CIRC * st.alloc_tabung / 100
  const dJ = CIRC * st.alloc_jajan / 100
  const dS = CIRC * st.alloc_sedekah / 100

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="avatar-mini profile-avatar" aria-hidden="true">
            {profilePhoto
              ? <img className="avatar-photo" src={profilePhoto} alt="Foto profil" />
              : <span className="avatar-fallback">🐷</span>}
          </div>
          <div>
            <span className="eyebrow">Akun saya</span>
            <h1>CelenganKu</h1>
            <div className="account-username-row">
              <span>{friendData.username ? `@${friendData.username}` : 'Username belum diatur'}</span>
              <button type="button" onClick={() => setTab('friends')}>
                {friendData.username ? 'Edit' : 'Atur username'}
              </button>
            </div>
            <label className="profile-change-btn">
              <input className="profile-photo-input" type="file" accept="image/*"
                aria-label="Ganti foto profil" onChange={handleProfilePhotoChange} />
              <span>{profilePhoto ? 'Ganti foto profil' : 'Tambah foto profil'}</span>
            </label>
          </div>
        </div>
        <button onClick={signOut} className="btn-ghost">Keluar</button>
      </header>

      <div className={`content ${tab === 'home' ? 'home-content' : tab === 'report' ? 'report-content' : 'single-content'}`}>
        {tab === 'home' && (
          <>
            <section className="hero-card">
              <div className="hero-row">
                <div>
                  <p className="eyebrow light">Saldo saat ini</p>
                  <div className="balance">{fmt(st.balance)}</div>
                </div>
                {activeStreak > 0 && <div className="mini-chip">🔥 {activeStreak} hari</div>}
              </div>

              {tx.length > 0 && <div className="summary-grid">
                <div className="mini-stat income">
                  <span>Masuk</span>
                  <strong>{fmt(totalIn)}</strong>
                </div>
                <div className="mini-stat expense">
                  <span>Keluar</span>
                  <strong>{fmt(totalOut)}</strong>
                </div>
              </div>}
            </section>

            {tx.length > 0 && <section className="card graph-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Tren</span>
                  <h2>Saldo 7 hari terakhir</h2>
                </div>
                <span className="badge-pill">7 hari</span>
              </div>

              <div className="chart-wrap">
                <div className="chart-y" aria-hidden="true">
                  {yTicks.map(value => (
                    <span key={value} style={{ top: `${(chartY(value) / 120) * 100}%` }}>{formatAxisMoney(value)}</span>
                  ))}
                </div>
                <svg className="sparkline balance-chart" viewBox="0 0 300 120" preserveAspectRatio="none" role="img"
                  aria-label="Grafik saldo per hari selama 7 hari terakhir">
                  {yTicks.map(value => (
                    <line key={value} x1="0" x2="300" y1={chartY(value)} y2={chartY(value)}
                      stroke="#dfe7e0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  <polyline
                    fill="none"
                    stroke="#1b4b43"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    points={chartPoints}
                  />
                  {weeklyActivity.map((day, index) => (
                    <circle key={day.key} cx={18 + index * 44} cy={chartY(dayBalances[index])}
                      r="3.5" fill="#fff" stroke="#1b4b43" strokeWidth="2">
                      <title>{`${day.label}: ${fmt(dayBalances[index])}`}</title>
                    </circle>
                  ))}
                </svg>
              </div>

              <div className="chart-legend">
                <span><i className="dot green" /> Saldo hari ini</span>
                <strong>{fmt(st.balance)}</strong>
              </div>
              <div className="chart-days chart-days-aligned">
                {weeklyActivity.map(day => <span key={day.key}>{day.label}</span>)}
              </div>

              <div className="mini-summary-list">
                <div>
                  <strong>{st.goal_name ? `${pct}%` : '—'}</strong>
                  <span>tercapai</span>
                </div>
                <div>
                  <strong>{st.goal_name ? fmt(remaining) : '—'}</strong>
                  <span>lagi</span>
                </div>
                <div>
                  <strong>{projectionTarget <= 0 ? '—' : proj.weeksMain === 0 ? 'Siap' : `${proj.weeksMain ?? '—'} mg`}</strong>
                  <span>estimasi</span>
                </div>
              </div>
            </section>}

            <section className="card glass-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Target utama</span>
                  <h2>🛼 {st.goal_name || 'Belum ada target'}</h2>
                </div>
                <span className="badge-pill">{st.goal_name ? `${pct}%` : '—'}</span>
              </div>

              <div className="track"><div className="fill" style={{ width: pct + '%' }} /></div>
              <div className="note">
                {!st.goal_name ? 'Tambahkan barang impian di tab Target.'
                  : remaining > 0 ? `${fmt(remaining)} lagi menuju ${fmt(st.goal_target)}` : 'Target tercapai! 🎉'}
              </div>

              <div className="mini-head">💰 Tambah uang masuk</div>
              <div className="row">
                <input type="text" inputMode="numeric" value={formatThousands(addAmt)} onChange={e => setAddAmt(e.target.value.replace(/\D/g, ''))} placeholder="Rp jumlah..." />
                <button className="btn-in" onClick={addMoney}>+ Masuk</button>
              </div>

              <div className="mini-head">🧾 Catat pengeluaran</div>
              <div className="row split-row">
                <select value={spendCat} onChange={e => setSpendCat(e.target.value)}>
                  <option>Jajan</option><option>Mainan</option><option>Buku</option><option>Lainnya</option>
                </select>
                <input type="text" inputMode="numeric" value={formatThousands(spendAmt)} onChange={e => setSpendAmt(e.target.value.replace(/\D/g, ''))} placeholder="Rp jumlah..." />
                <button className="btn-out" onClick={spendMoney}>- Catat</button>
              </div>
            </section>
          </>
        )}

        {tab === 'alloc' && (
          <section className="card glass-card">
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Bagi uang</span>
                <h2>Alokasi tabungan</h2>
              </div>
            </div>

            <label className="field-block">Uang saku minggu ini:
              <input type="text" inputMode="numeric" value={formatThousands(moneyDrafts.allowance ?? (st.allowance || ''))}
                onChange={e => updateMoneyDraft('allowance', e.target.value)}
                onBlur={() => commitMoneyDraft('allowance')} />
            </label>

            {st.allowance > 0 ? <>
            <div className="donut-wrap">
              <svg width="150" height="150" viewBox="0 0 120 120" aria-label="Alokasi tabungan">
                <circle cx="60" cy="60" r="45" fill="none" stroke="#EAF5F0" strokeWidth="16" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="#1B4B43" strokeWidth="16"
                  strokeDasharray={`${dT} ${CIRC}`} strokeDashoffset={0} transform="rotate(-90 60 60)" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="#F2B705" strokeWidth="16"
                  strokeDasharray={`${dJ} ${CIRC}`} strokeDashoffset={-dT} transform="rotate(-90 60 60)" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="#FF6B57" strokeWidth="16"
                  strokeDasharray={`${dS} ${CIRC}`} strokeDashoffset={-(dT + dJ)} transform="rotate(-90 60 60)" />
              </svg>
            </div>

            {['tabung', 'jajan', 'sedekah'].map(k => (
              <div key={k} className="alloc-row">
                <div className="alloc-top"><span>{k}</span><span>{st['alloc_' + k]}%</span></div>
                <input type="range" min="0" max="100" value={st['alloc_' + k]}
                  onChange={e => handleAllocChange(k, e.target.value)} />
                <div className="rp">{fmt(st.allowance * st['alloc_' + k] / 100)}</div>
              </div>
            ))}
            </> : <p className="allocation-empty">Masukkan uang saku untuk mulai mengatur alokasi.</p>}
          </section>
        )}

        {tab === 'proj' && (
          <section className="card glass-card">
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Rencana</span>
                <h2>Barang impianmu</h2>
              </div>
            </div>
            <div className="goal-list">
              <div className="goal-list-heading">
                <strong>Daftar target</strong>
                <span>{goalItems.length} barang</span>
              </div>
              {!goalItems.length && <p className="goal-empty">Belum ada target. Tambahkan barang impianmu di bawah.</p>}
              {goalItems.map(item => (
                <div className={isGoalPrimary(item) ? 'goal-item primary-goal-item' : 'goal-item'} key={item.id}>
                  {item.photo
                    ? <img className="goal-item-photo" src={item.photo} alt="" />
                    : <span className="goal-item-placeholder" aria-hidden="true">🎁</span>}
                  <div className="goal-item-details">
                    <strong>{item.name}</strong>
                    <span>Target {fmt(item.target)}</span>
                  </div>
                  <div className="goal-item-actions">
                    <button type="button" className="goal-edit-btn"
                      aria-label={`Edit ${item.name}`} onClick={() => editGoalItem(item)}>Edit</button>
                    {isGoalPrimary(item)
                      ? <span className="goal-main-label">Utama</span>
                      : <button type="button" className="goal-main-btn"
                          aria-label={`Jadikan ${item.name} target utama`}
                          onClick={() => makeGoalPrimary(item.id)}>Jadikan utama</button>}
                    <button type="button" className="goal-delete-btn"
                      aria-label={`Hapus ${item.name}`} title={`Hapus ${item.name}`}
                      onClick={() => removeGoalItem(item.id)}>Hapus</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="goal-form-heading">{editingGoalId ? 'Edit barang' : 'Tambah barang baru'}</div>
            <label className="field-block">🎁 Nama barang impian:
              <input type="text" maxLength={60} value={goalNameDraft}
                placeholder="Contoh: Sepeda baru"
                onChange={e => { setGoalNameDraft(e.target.value); setGoalError('') }} />
            </label>
            <label className="field-block">🚲 Harga target:
              <input type="text" inputMode="numeric" value={formatThousands(moneyDrafts.proj_target ?? (st.proj_target || ''))}
                onChange={e => { updateMoneyDraft('proj_target', e.target.value); setGoalError('') }} />
            </label>
            <label className="field-block">💰 Nabung /minggu:
              <input type="text" inputMode="numeric" value={formatThousands(moneyDrafts.proj_weekly ?? (st.proj_weekly || ''))}
                onChange={e => updateMoneyDraft('proj_weekly', e.target.value)}
                onBlur={() => commitMoneyDraft('proj_weekly', DEMO_STATE.proj_weekly)} />
            </label>
            <label className="field-block">📅 Alternatif /hari:
              <input type="text" inputMode="numeric" value={formatThousands(moneyDrafts.proj_daily ?? (st.proj_daily || ''))}
                onChange={e => updateMoneyDraft('proj_daily', e.target.value)}
                onBlur={() => commitMoneyDraft('proj_daily', DEMO_STATE.proj_daily)} />
            </label>

            <div className="photo-upload-block">
              <label className="photo-upload-label">📷 Foto barang target</label>
              <label className="photo-upload-box">
                <input type="file" accept="image/*" onChange={handleGoalPhotoChange} />
                {goalPhoto
                  ? <img src={goalPhoto} alt="Foto barang target" className="photo-preview" />
                  : <span className="photo-placeholder">Pilih foto barang</span>}
              </label>
            </div>

            <div className="result">
              {projectionTarget <= 0
                ? 'Isi harga target dulu'
                : proj.remaining === 0
                ? 'Sudah cukup! 🎉'
                : proj.weeksMain != null
                  ? `≈ ${proj.weeksMain} minggu lagi`
                  : 'Isi nominal mingguan dulu'}
            </div>

            {goalError && <p className="goal-error" role="alert">{goalError}</p>}
            <div className="goal-form-actions">
              <button type="button" className="goal-add-btn" onClick={addGoalItem}>
                {editingGoalId ? 'Simpan perubahan' : '+ Tambah barang'}
              </button>
              {editingGoalId && <button type="button" className="goal-cancel-btn" onClick={cancelGoalEdit}>Batal</button>}
            </div>
          </section>
        )}

        {tab === 'report' && (
          <section className="card glass-card">
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Ringkasan</span>
                <h2>Laporan keuangan</h2>
              </div>
            </div>
            {tx.length > 0 ? <>
            <div className="stat-row">
              <div className="stat in">{fmt(totalIn)}<span>Total masuk</span></div>
              <div className="stat out">{fmt(totalOut)}<span>Total keluar</span></div>
            </div>
            <div className="net">{fmt(net)}<span>Saldo bersih</span></div>

            <div className="mini-chart-panel">
              <div className="section-head compact-head">
                <div>
                  <span className="eyebrow">Minggu ini</span>
                  <h2>Perkembangan</h2>
                </div>
              </div>

              <div className="bar-chart" aria-label="Grafik pengeluaran mingguan">
                {weeklyActivity.map(day => (
                  <div key={day.key} className="bar-col">
                    <div className="bar-track">
                      <div className="bar-fill" style={{ height: `${day.expense ? Math.max(8, day.expense / maxDailyExpense * 100) : 0}%` }} />
                    </div>
                    <span>{day.label}</span>
                  </div>
                ))}
              </div>
              {!weeklyActivity.some(day => day.expense > 0) && <p className="chart-empty">Belum ada pengeluaran dalam 7 hari terakhir.</p>}
            </div>

            {catTotal > 0 && (
              <div className="cat-breakdown">
                {Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, val]) => (
                  <div key={name} className="cat-row">
                    <span>{CAT_ICON[name]} {name}</span>
                    <div className="track small-track">
                      <div className="fill-coral" style={{ width: Math.round(val / catTotal * 100) + '%' }} />
                    </div>
                    <span>{Math.round(val / catTotal * 100)}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="hist">
              {tx.slice(0, 10).map(t => (
                <div key={t.id} className={'hist-item ' + t.type}>
                  <span className="hist-icon">{t.type === 'in' ? '↑' : (CAT_ICON[t.category] || '↓')}</span>
                  <span className="d">{t.description} · {formatTxDate(t.created_at, t.date_label)}</span>
                  <span className="amt">{t.type === 'in' ? '+' : '-'}{fmt(t.amount)}</span>
                </div>
              ))}
            </div>
            </> : <p className="report-empty">Belum ada transaksi. Catatan keuangan akan muncul di sini.</p>}
          </section>
        )}

        {tab === 'more' && (
          <section className="card glass-card more-panel">
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Menu</span>
                <h2>Lainnya</h2>
              </div>
            </div>
            <p className="more-hint">Pilih menu yang ingin kamu buka.</p>
            <button type="button" className="more-btn" onClick={() => setTab('badge')}>
              <span className="more-ic more-ic-badge" aria-hidden="true">🏅</span>
              <span className="more-text">
                <strong>Lencana</strong>
                <small>Lihat hadiah dari menabung</small>
              </span>
              <span className="more-arrow" aria-hidden="true">›</span>
            </button>
            <button type="button" className="more-btn" onClick={() => setTab('friends')}>
              <span className="more-ic more-ic-friends" aria-hidden="true">👥</span>
              <span className="more-text">
                <strong>Teman</strong>
                <small>Username dan permintaan teman</small>
              </span>
              {friendData.incoming.length > 0 && (
                <span className="red-dot red-dot-inline" role="status" aria-label="Ada permintaan teman baru" />
              )}
              <span className="more-arrow" aria-hidden="true">›</span>
            </button>
          </section>
        )}

        {tab === 'friends' && (
          <section className="card glass-card friends-panel">
            <button type="button" className="back-btn" onClick={() => setTab('more')}>← Lainnya</button>
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Terhubung</span>
                <h2>Teman</h2>
              </div>
              <span className="badge-pill">{friendData.friends.length} teman</span>
            </div>

            <form className="friend-profile-form" onSubmit={saveUsername}>
              <label className="field-block">Username kamu
                <input type="text" value={usernameDraft} maxLength={20}
                  placeholder="contoh: budi_123" autoCapitalize="none" autoCorrect="off"
                  onChange={event => setUsernameDraft(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
              </label>
              <button type="submit" className="friend-action">Simpan username</button>
            </form>
            <p className="friend-hint">Gunakan 3–20 huruf kecil, angka, atau _. Username bisa dilihat pengguna lain.</p>

            {friendMessage && <p className={`friend-message ${friendMessageType}`} role="status">{friendMessage}</p>}

            <form className="friend-search-form" onSubmit={searchFriends}>
              <label className="field-block">Cari teman
                <input type="search" value={friendSearch} maxLength={20}
                  placeholder="Cari username..." autoCapitalize="none" autoCorrect="off"
                  onChange={event => setFriendSearch(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
              </label>
              <button type="submit" className="friend-action secondary">Cari</button>
            </form>

            {friendResults.length > 0 && (
              <div className="friend-section">
                <h3>Hasil pencarian</h3>
                {friendResults.map(profile => {
                  const isFriend = friendData.friends.some(friend => friend.user_id === profile.user_id)
                  const incoming = friendData.incoming.some(request => request.user_id === profile.user_id)
                  const outgoing = friendData.outgoing.some(request => request.user_id === profile.user_id)
                  return (
                    <div className="friend-row" key={profile.user_id}>
                      <FriendAvatar photo={profile.profile_photo} />
                      <strong>@{profile.username}</strong>
                      {isFriend ? <span className="friend-status">Teman</span>
                        : incoming ? <span className="friend-status">Ada permintaan</span>
                          : outgoing ? <span className="friend-status">Terkirim</span>
                            : <button type="button" className="friend-action compact"
                                onClick={() => sendFriendRequest(profile.user_id)}>Tambah</button>}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="friend-section">
              <h3>Permintaan masuk <span>{friendData.incoming.length}</span></h3>
              {friendData.incoming.map(request => (
                <div className="friend-row" key={request.id}>
                  <FriendAvatar photo={request.profile_photo} />
                  <strong>@{request.username}</strong>
                  <button type="button" className="friend-action compact"
                    onClick={() => respondToFriendRequest(request.id, 'accepted')}>Terima</button>
                  <button type="button" className="friend-action compact danger"
                    onClick={() => respondToFriendRequest(request.id, 'declined')}>Tolak</button>
                </div>
              ))}
              {!friendsLoading && !friendData.incoming.length && <p className="friend-empty">Belum ada permintaan masuk.</p>}
            </div>

            <div className="friend-section">
              <h3>Teman saya</h3>
              {friendData.friends.map(friend => (
                <div className="friend-row" key={friend.id}>
                  <FriendAvatar photo={friend.profile_photo} />
                  <strong>@{friend.username}</strong>
                  <span className="friend-status">Teman</span>
                </div>
              ))}
              {!friendsLoading && !friendData.friends.length && <p className="friend-empty">Teman yang menerima permintaanmu akan muncul di sini.</p>}
            </div>

            {friendData.outgoing.length > 0 && (
              <div className="friend-section">
                <h3>Menunggu konfirmasi</h3>
                {friendData.outgoing.map(request => (
                  <div className="friend-row" key={request.id}>
                    <FriendAvatar photo={request.profile_photo} />
                    <strong>@{request.username}</strong>
                    <span className="friend-status">Terkirim</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'badge' && (
          <section className="card glass-card">
            <button type="button" className="back-btn" onClick={() => setTab('more')}>← Lainnya</button>
            <div className="section-head compact-head">
              <div>
                <span className="eyebrow">Prestasi</span>
                <h2>Lencana kamu</h2>
              </div>
            </div>
            <div className="badge-grid">
              <div className={activeStreak >= 7 ? 'badge' : 'badge locked'}>🥉<br />7 Hari</div>
              <div className={activeStreak >= 30 ? 'badge' : 'badge locked'}>🥈<br />30 Hari</div>
              <div className={activeStreak >= 100 ? 'badge' : 'badge locked'}>🥇<br />100 Hari</div>
              <div className={st.alloc_tabung >= 50 ? 'badge' : 'badge locked'}>🍰<br />Bagi Rata</div>
              <div className={st.balance >= st.goal_target ? 'badge' : 'badge locked'}>🎯<br />Target 1</div>
              <div className="badge locked">🚲<br />Target 5</div>
            </div>
          </section>
        )}

      </div>

      <nav className="tabs">
        {Object.entries(TAB_META).map(([key, meta]) => {
          const isActive = key === 'more' ? MORE_TABS.includes(tab) : tab === key
          return (
            <button key={key} className={isActive ? 'tab active' : 'tab'} onClick={() => setTab(key)}
              aria-current={isActive ? 'page' : undefined}>
              <span className="ic">{meta.icon}</span>{meta.label}
              {key === 'more' && friendData.incoming.length > 0 && (
                <span className="red-dot" role="status" aria-label="Ada permintaan teman baru" />
              )}
            </button>
          )
        })}
      </nav>

      {feedback && (
        <div className={`feedback-screen ${feedback.type}`} role="dialog" aria-modal="true"
          aria-labelledby="feedback-title">
          <div className="feedback-content">
            <div className="feedback-icon" aria-hidden="true">
              {feedback.type === 'spend-success' ? '−'
                : feedback.type === 'insufficient' || feedback.type === 'goal-save-error' ? '!' : '✓'}
            </div>
            <p className="feedback-kicker">
              {feedback.type === 'goal-added' ? 'Barang berhasil ditambahkan'
                : feedback.type === 'goal-updated' ? 'Barang berhasil diperbarui'
                  : feedback.type === 'goal-primary' ? 'Target utama diperbarui'
                : feedback.type === 'goal-save-error' ? 'Penyimpanan gagal'
                  : feedback.type === 'spend-success' ? 'Pengeluaran berhasil dicatat'
                    : feedback.type === 'success' ? 'Setoran berhasil' : 'Transaksi dibatalkan'}
            </p>
            <h2 id="feedback-title">
              {feedback.type === 'goal-added' ? `Semangat, ${friendData.username || 'kamu'}!`
                : feedback.type === 'goal-updated' ? `${feedback.itemName} berhasil diubah`
                  : feedback.type === 'goal-primary' ? `${feedback.itemName} jadi target utama!`
                : feedback.type === 'goal-save-error' ? 'Barang belum tersimpan'
                  : feedback.type === 'spend-success' ? 'Kamu mengeluarkan uang dari tabungan'
                    : feedback.type === 'success' ? 'Terima kasih sudah menabung!' : 'Uang tidak cukup'}
            </h2>
            <p className="feedback-message">
              {(feedback.type === 'goal-added' || feedback.type === 'goal-updated' || feedback.type === 'goal-primary') && feedback.localOnly
                ? 'Perubahan tersimpan di perangkat ini. Sinkronisasi akun perlu migrasi goal_items di Supabase.'
                : feedback.type === 'goal-added' ? `${feedback.itemName} sudah masuk ke daftar targetmu. Menabung sedikit demi sedikit, semoga targetmu segera tercapai!`
                : feedback.type === 'goal-updated' ? 'Detail barangmu sudah diperbarui.'
                  : feedback.type === 'goal-primary' ? 'Proyeksi dan beranda sekarang mengikuti target ini.'
                : feedback.type === 'goal-save-error' ? 'Database belum memiliki kolom foto barang, foto profil, dan daftar target. Jalankan migrasi SQL agar barang bisa disimpan.'
                  : feedback.type === 'spend-success' ? `${fmt(feedback.amount)} untuk ${feedback.category} sudah dicatat. Saldo celenganmu telah diperbarui.`
                  : feedback.type === 'success' ? `${fmt(feedback.amount)} berhasil ditambahkan ke celenganmu.`
                    : `Pengeluaran ${fmt(feedback.amount)} melebihi saldo ${fmt(st.balance)}. Coba masukkan nominal yang lebih kecil.`}
            </p>
            <button className="feedback-action" onClick={() => setFeedback(null)}>
              {feedback.type === 'insufficient' || feedback.type === 'goal-save-error' ? 'Mengerti'
                : feedback.type === 'goal-added' ? 'Lihat daftar' : 'Lanjutkan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}