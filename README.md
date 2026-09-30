# CelenganKu — Versi Produk

Aplikasi tabungan & literasi finansial untuk anak SD, dibangun dengan
Next.js (React) dan Supabase (database + login). Setiap pengguna
punya progres sendiri yang tersimpan permanen di server.

## 1. Yang perlu disiapkan dulu

- Node.js (versi 18 ke atas) — download di https://nodejs.org
- Akun gratis di https://supabase.com
- Akun gratis di https://vercel.com (untuk deploy nanti)
- Editor kode, misalnya VS Code

## 2. Membuat project Supabase (database + login)

1. Buka https://supabase.com -> "New project".
2. Kasih nama bebas, misal "celenganku", pilih region terdekat (Singapore).
3. Setelah project jadi, buka menu **SQL Editor** di sidebar kiri.
4. Klik "New query", lalu salin seluruh isi file `supabase/schema.sql`
   dari folder ini, tempel, dan klik **Run**.
   Ini akan membuat dua tabel: `user_state` (saldo, target, dsb per
   pengguna) dan `transactions` (riwayat pemasukan/pengeluaran),
   lengkap dengan aturan keamanan supaya data tiap pengguna terpisah.
5. Buka menu **Project Settings -> API**. Catat dua nilai ini:
   - **Project URL**
   - **anon public key**

## 3. Menyiapkan project di komputer kamu

```bash
# masuk ke folder project ini
cd celenganku-app

# install semua library yang dibutuhkan
npm install

# salin file environment
cp .env.local.example .env.local
```

Buka file `.env.local` yang baru dibuat, lalu isi dua barisnya dengan
nilai dari Supabase (langkah 2.5 di atas):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=isi-dengan-anon-public-key-punyamu
```

## 4. Menjalankan di komputer sendiri (mode development)

```bash
npm run dev
```

Buka http://localhost:3000 di browser. Kamu akan diarahkan ke halaman
login — klik "Belum punya akun? Daftar" untuk membuat akun pertama
kamu (pakai email dan password bebas, minimal 6 karakter). Setelah
daftar, kamu otomatis masuk ke aplikasi utama.

> Catatan: Supabase secara default mengirim email konfirmasi saat
> ada pengguna baru daftar. Untuk keperluan demo/tugas, kamu bisa
> matikan ini di Supabase Dashboard -> Authentication -> Providers ->
> Email -> matikan "Confirm email", supaya teman-temanmu bisa
> langsung pakai tanpa perlu cek email dulu.

## 5. Deploy supaya bisa diakses teman-teman lewat link

1. Push folder project ini ke GitHub (bikin repo baru, lalu
   `git init`, `git add .`, `git commit -m "init"`, lalu push).
2. Buka https://vercel.com -> "Add New Project" -> pilih repo
   GitHub kamu tadi.
3. Saat diminta "Environment Variables", isi dua baris yang sama
   seperti di `.env.local` (NEXT_PUBLIC_SUPABASE_URL dan
   NEXT_PUBLIC_SUPABASE_ANON_KEY).
4. Klik **Deploy**. Setelah selesai (biasanya 1-2 menit), Vercel
   kasih link seperti `https://celenganku-xxxx.vercel.app` — ini
   yang bisa kamu share ke teman-teman. Semua bisa daftar akun
   sendiri-sendiri dan progresnya tidak akan tercampur.

## 6. Struktur folder

```
celenganku-app/
├─ lib/
│  ├─ supabaseClient.js   # koneksi ke Supabase
│  └─ finance.js          # semua rumus kalkulasi (alokasi, proyeksi, statistik)
├─ pages/
│  ├─ _app.js             # bungkus global (import CSS)
│  ├─ login.js            # halaman daftar/masuk
│  └─ index.js            # aplikasi utama (semua tab: Beranda, Alokasi, dst)
├─ styles/
│  └─ globals.css         # semua styling
├─ supabase/
│  └─ schema.sql          # struktur database, jalankan sekali di awal
├─ .env.local.example     # contoh isian environment variable
└─ package.json
```

## 7. Yang belum ada / bisa dikembangkan lagi

- Tampilan masih versi sederhana (belum ada frame HP seperti mockup
  awal) — bisa dipercantik lagi dengan mengambil styling dari
  prototipe HTML sebelumnya.
- Belum ada halaman "Dashboard Orang Tua" yang terpisah dari akun
  anak (saat ini satu akun = satu tampilan yang sama).
- Belum ada kalkulator kurs mata uang (masih tahap ide).
- Setiap perubahan slider alokasi langsung menyimpan ke database;
  untuk skala lebih besar sebaiknya ditambahkan jeda (debounce)
  supaya tidak terlalu sering menulis ke server.
