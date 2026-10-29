// aplica o tema antes da renderização (evita "flash"); script externo para manter CSP sem 'unsafe-inline'
try { var t = localStorage.getItem('pt_theme'); if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark'); } catch (e) {}
