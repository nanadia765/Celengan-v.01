import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const router = useRouter()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    const action = mode === 'signin'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { error } = await action
    if (error) { setError(error.message); return }
    router.push('/')
  }

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="login-card">
        <h1>CelenganKu</h1>
        <input type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (min. 6 karakter)" value={password}
          onChange={e => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="err">{error}</p>}
        <button type="submit">{mode === 'signin' ? 'Masuk' : 'Daftar'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>
      </form>
    </div>
  )
}
