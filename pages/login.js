import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const router = useRouter()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setNotice('')

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); return }
      router.push('/')
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` }
    })
    if (error) { setError(error.message); return }
    if (data.session) {
      router.push('/')
      return
    }
    setNotice('Akun dibuat. Buka email konfirmasi dari Supabase di perangkat ini untuk melanjutkan.')
  }

  return (
    <div className="login-wrap">
      <div className="login-bg-circle login-bg-circle-one" />
      <div className="login-bg-circle login-bg-circle-two" />

      <form onSubmit={submit} className="login-card">
        <div className="brand-row">
          <div className="brand-mark">🐷</div>
          <div className="brand-text">CelenganKu</div>
        </div>

        <div className="login-header">
          <h1>{mode === 'signin' ? 'Selamat datang' : 'Buat akun baru'}</h1>
          <p>
            {mode === 'signin'
              ? 'Login untuk lanjut menabung lebih cerdas.'
              : 'Daftar dan mulai perjalanan finansialmu.'}
          </p>
        </div>

        <label className="field-label">
          <span>Email</span>
          <input
            type="email"
            placeholder="nama@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field-label">
          <span>Password</span>
          <input
            type="password"
            placeholder="Minimal 6 karakter"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error && <p className="err">{error}</p>}
        {notice && <p className="auth-success" role="status">{notice}</p>}

        <button type="submit" className="primary-btn">
          {mode === 'signin' ? 'Masuk' : 'Daftar'}
        </button>

        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>
      </form>
    </div>
  )
}
