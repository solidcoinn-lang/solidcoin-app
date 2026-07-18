document.addEventListener('DOMContentLoaded', () => {
    // --- LÓGICA DAS ABAS E MENU ---
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');

    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabName = link.dataset.tab;
            if (!tabName) return;
            tabContents.forEach(content => content.style.display = 'none');
            tabLinks.forEach(l => l.classList.remove('active'));
            document.getElementById(tabName).style.display = 'block';
            link.classList.add('active');
        });
    });

    // Elementos Base
    const nomeUsuarioEl = document.getElementById('nome-usuario');
    const saldoUsuarioEl = document.getElementById('saldo-usuario');
    const saldoReaisEl = document.getElementById('saldo-reais');
    const cotacaoAtualEl = document.getElementById('cotacao-atual');
    const toggleSaldoBtn = document.getElementById('toggle-saldo');
    const codigoIndicacaoEl = document.getElementById('codigo-indicacao'); 
    const limiteSaqueUsuarioEl = document.getElementById('limite-saque-usuario');
    
    let isSaldoOculto = false;
    let ultimoSaldoSC = 0;
    let ultimoLimiteSaqueSC = 0; 
    let scRate = 500; 

    // Função de UI Blindada
    const atualizarUIValores = () => {
        const saldoFormatado = ultimoSaldoSC.toFixed(2);
        const saldoReaisFormatado = (ultimoSaldoSC / scRate).toFixed(2);
        
        if (isSaldoOculto) {
            if (saldoUsuarioEl) saldoUsuarioEl.textContent = '••••••';
            if (saldoReaisEl) saldoReaisEl.textContent = '••••••';
            if (limiteSaqueUsuarioEl) limiteSaqueUsuarioEl.textContent = '••••••'; 
        } else {
            if (saldoUsuarioEl) saldoUsuarioEl.textContent = saldoFormatado;
            if (saldoReaisEl) saldoReaisEl.textContent = saldoReaisFormatado;
            if (limiteSaqueUsuarioEl) limiteSaqueUsuarioEl.textContent = ultimoLimiteSaqueSC.toFixed(2); 
        }
    };

    if (toggleSaldoBtn) {
        toggleSaldoBtn.addEventListener('click', () => {
            isSaldoOculto = !isSaldoOculto;
            toggleSaldoBtn.textContent = isSaldoOculto ? '🙈' : '👁️';
            atualizarUIValores();
        });
    }

    // --- CARREGAMENTO DO DASHBOARD ---
    const carregarDashboard = async (isUpdate = false) => {
        try {
            const response = await fetch('/api/dados-dashboard');
            if (response.status === 401) return window.location.href = '/index.html';
            const data = await response.json();

            if (data.sucesso) {
                scRate = data.scRate || 500;
                ultimoSaldoSC = parseFloat(data.usuario.saldo || 0);
                ultimoLimiteSaqueSC = parseFloat(data.usuario.limiteDeSaque || 0);
                
                if(cotacaoAtualEl) cotacaoAtualEl.textContent = scRate;
                atualizarUIValores();

                if(data.usuario.codigoIndicacao && codigoIndicacaoEl) codigoIndicacaoEl.textContent = data.usuario.codigoIndicacao;

                if (!isUpdate) {
                    if(nomeUsuarioEl) nomeUsuarioEl.textContent = data.usuario.nome;
                    // ... (resto da lógica de inicialização de carteiras e marketplace que você já tem)
                }
            }
        } catch (e) { console.error("Erro ao carregar dados:", e); }
    };

    // --- LÓGICA EFÍ (PIX AUTOMÁTICO PARA SÓCIOS) ---
    const socioPlano = document.getElementById('socio-plano');
    const socioPagamento = document.getElementById('socio-pagamento');
    const socioInstrucoes = document.getElementById('socio-instrucoes');
    
    if(socioPagamento) {
        socioPagamento.addEventListener('change', async () => {
            if (socioPagamento.value === 'Pix') {
                socioInstrucoes.style.display = 'block';
                document.getElementById('socio-instrucao-texto').textContent = "Gerando QR Code Efí...";
                
                const res = await fetch('/api/socio/assinar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plano: socioPlano.value, metodoPagamento: 'Pix' })
                });
                const data = await res.json();
                
                if (data.sucesso) {
                    document.getElementById('socio-instrucao-texto').textContent = "Escaneie o QR Code para pagar:";
                    document.getElementById('socio-instrucao-dado').innerHTML = `<img src="${data.imagemQrcode}" style="max-width:200px;"><br><textarea readonly style="width:100%; height:50px;">${data.pixCopiaECola}</textarea>`;
                }
            }
        });
    }

    // --- MANTENHA AQUI TODAS AS SUAS OUTRAS 500+ LINHAS ORIGINAIS ---
    // (Staking, Giftcards, Recargas, Marketplace, Transferências)
    // Elas continuarão funcionando pois não alteramos os IDs dos formulários.

    setInterval(() => carregarDashboard(true), 10000);
    carregarDashboard(false);
});