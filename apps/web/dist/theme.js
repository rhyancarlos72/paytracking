// aplica o tema antes da renderização (evita "flash"); script externo para manter CSP sem 'unsafe-inline'.
// Padrão: escuro (azul-marinho). Quem escolheu o claro no botão do topo continua no claro.
try { if (localStorage.getItem('pt_theme') !== 'light') document.documentElement.classList.add('dark'); } catch (e) { document.documentElement.classList.add('dark'); }
