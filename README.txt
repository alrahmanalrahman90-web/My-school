MySchool - Paket Hosting Vercel

ISI PAKET
- index.html : aplikasi MySchool yang telah diperbarui
- api/search.js : fungsi serverless Vercel untuk pencarian musik (Deezer + iTunes, tanpa API key)
- vercel.json : konfigurasi hosting statis Vercel

CARA DEPLOY
1. Ekstrak ZIP ini.
2. Buka https://vercel.com/ lalu login.
3. Pilih Add New -> Project. Jika menghubungkan GitHub, unggah isi folder ini ke repository lalu impor repository tersebut.
4. Framework Preset: Other. Build Command: kosongkan / None. Output Directory: ./ (root).
5. Deploy, lalu buka URL HTTPS yang diberikan Vercel.

CATATAN MUSIK
- Lagu YouTube diputar sebagai audio: layar pemutar hanya menampilkan sampul dan tombol (putar/jeda, geser posisi, sebelumnya/berikutnya). Di balik layar tetap dipakai YouTube IFrame Player API resmi, dengan pemutar disembunyikan. Tombol "Tampilkan video" di layar pemutar memunculkan videonya kapan saja. Jika browser meminta sentuhan langsung, pemutar muncul sementara; tekan Putar sekali.
- Cari musik: di menu Musik, kotak "Cari musik" memanggil /api/search (fungsi Vercel). Fungsi ini mengambil METADATA dari API publik Deezer dan iTunes Search (tanpa login/API key), lalu: mencocokkan judul + artis + relevansi; mengenali artis yang dicari dan menampilkan lagu aslinya lebih dulu; memisahkan Original / DJ / Remix / Cover (tab di hasil); mengutamakan lagu Indonesia (tombol "Utamakan lagu Indonesia", bisa dimatikan); dan mengurutkan dengan popularitas asli dari "rank" Deezer. Jika datanya tidak ada, popularitas tidak dikarang. Label "Populer" hanya muncul bila rank Deezer tinggi.
- Penanda "Indonesia" adalah heuristik (genre iTunes, artis yang sama, kata dalam judul), bukan data resmi, jadi bisa meleset pada lagu tertentu.
- Audio tidak diambil dari Deezer/iTunes. Lagu yang diketuk masuk ke "Lagu saya" lalu diputar sebagai audio lewat pemutar YouTube resmi yang disembunyikan (dicocokkan dengan judul, artis, dan durasi asli), tanpa video. Jika /api/search tidak tersedia (misalnya file dibuka tanpa Vercel), pencarian otomatis memakai katalog Audius sebagai cadangan.
- Tampilkan atribusi: data lagu dari Deezer dan iTunes. Periksa syarat layanan keduanya bila aplikasi dipakai secara komersial.
- Pemutaran YouTube tetap bergantung pada izin video untuk diputar di situs lain, koneksi internet, dan ketersediaan layanan YouTube.
- File MP3/M4A dari HP tetap diputar secara lokal di browser. File lokal tersimpan di penyimpanan browser perangkat dan tidak otomatis berpindah ke domain Vercel/perangkat lain.
- Data MySchool yang tersimpan di browser pada alamat content:// tidak otomatis berpindah ke domain HTTPS Vercel. Ekspor/cadangkan data sebelum beralih jika aplikasi menyediakan fitur ekspor.
- Vercel hanya menyediakan hosting HTTPS; tidak menjamin server Piped/proxy publik selalu aktif.

LIRIK TERSINKRON
- Di layar pemutar, geser sampul album ke samping untuk membuka lirik; geser lagi untuk kembali ke sampul. Saat pemutar dibuka, yang tampil selalu sampul.
- Lirik bertimestamp (format LRC) diambil dari LRCLIB (lrclib.net, gratis, tanpa API key) lewat /api/lyrics (fungsi Vercel), dengan cadangan langsung ke LRCLIB. Judul, artis, dan durasi dicocokkan; bila tidak cocok atau tidak ada, tampil "Lirik belum tersedia". Tidak ada lirik yang dikarang.
- Baris aktif ikut posisi lagu (au.currentTime), jadi tetap sinkron saat maju/mundur. Ketuk satu baris untuk melompat ke bagian itu. Geser lirik naik/turun secara manual memunculkan tombol "Sinkron ulang".
- Lagu dari Spotify embed tidak mendukung lirik (tidak ada posisi waktu).

VIDEO MUSIK & SAMPUL PER LAGU
- /api/video (fungsi Vercel) mencari video YouTube di sisi server, lalu aplikasi memilih video musik asli berdasarkan judul + artis + durasi (kanal Topic/Topik, lirik, audio, remix, live dibuang) dan memeriksa video boleh disematkan. Jika video musik asli tidak ada, mode Video menampilkan pesan "Video musik asli tidak ditemukan", bukan gambar.
- Sampul tiap lagu diambil dari video lagu itu sendiri sehingga berbeda per lagu. Seluruh koleksi dicocokkan ulang otomatis di latar belakang sekali setelah update ini.
