/* =========================================================
   Fungsi-fungsi kalkulasi keuangan — murni (tidak menyentuh
   DOM/React), jadi gampang dites dan dipakai ulang.
   ========================================================= */

export function computeGoalProgress(balance, target) {
  const pct = target > 0 ? Math.min(100, Math.round((balance / target) * 100)) : 0
  const remaining = Math.max(target - balance, 0)
  return { pct, remaining }
}

// Menjaga total 3 kategori alokasi tetap 100%, dengan
// mendistribusikan sisa persentase secara proporsional.
export function nextAlloc(alloc, changedKey, rawVal) {
  const val = Math.max(0, Math.min(100, Math.round(Number(rawVal))))
  const keys = ['tabung', 'jajan', 'sedekah']
  const others = keys.filter(k => k !== changedKey)
  const remaining = 100 - val
  const sumOthers = alloc[others[0]] + alloc[others[1]]

  let a0, a1
  if (sumOthers === 0) {
    a0 = Math.round(remaining / 2)
    a1 = remaining - a0
  } else {
    a0 = Math.round(remaining * (alloc[others[0]] / sumOthers))
    a1 = remaining - a0
  }

  return { ...alloc, [changedKey]: val, [others[0]]: a0, [others[1]]: a1 }
}

export function computeProjection({ target, weekly, daily, balance }) {
  const remaining = Math.max(target - balance, 0)
  let weeksMain = null
  if (remaining === 0) weeksMain = 0
  else if (weekly > 0) weeksMain = Math.ceil(remaining / weekly)

  const weeklyFromDaily = daily * 7
  const weeksDaily = weeklyFromDaily > 0 ? Math.ceil(remaining / weeklyFromDaily) : Infinity
  const weeksWeekly = weekly > 0 ? Math.ceil(remaining / weekly) : Infinity

  return { remaining, weeksMain, weeklyFromDaily, weeksDaily, weeksWeekly }
}

export function computeTotals(transactions) {
  let totalIn = 0, totalOut = 0
  transactions.forEach(t => {
    if (t.type === 'in') totalIn += t.amount
    else totalOut += t.amount
  })
  return { totalIn, totalOut, net: totalIn - totalOut }
}

export function computeCategoryBreakdown(transactions) {
  const sums = {}
  transactions.forEach(t => {
    if (t.type === 'out') {
      const c = t.category || 'Lainnya'
      sums[c] = (sums[c] || 0) + t.amount
    }
  })
  return sums
}
