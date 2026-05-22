document.addEventListener('DOMContentLoaded', () => {
    // --- LÓGICA DAS ABAS (Protegida contra erro de extensões) ---
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

    // --- SELETORES DE ELEMENTOS ---
    const nomeUsuarioEl = document.getElementById('nome-usuario');
    const saldoUsuarioEl = document.getElementById('saldo-usuario');
    const logoutBtn = document.getElementById('logout-btn');
    const adminBtn = document.getElementById('admin-btn');
    
    // Elementos de Staking
    const stakedAmountEl = document.getElementById('staked-amount');
    const unstakeDateEl = document.getElementById('unstake-date');
    const stakeForm = document.getElementById('stake-form');
    const unstakeBtn = document.getElementById('unstake-btn');
    const claimRewardsBtn = document.getElementById('claim-rewards-btn');
    
    // Elementos de Carteira e Saque
    const carteiraForm = document.getElementById('carteira-form');
    const solanaWalletInput = document.getElementById('solana-wallet');
    const tronWalletInput = document.getElementById('tron-wallet'); // <-- TRON AQUI
    const saqueForm = document.getElementById('saque-form');
    
    // Outros Elementos
    const transferirForm = document.getElementById('transferir-form');
    const marketplaceListaEl = document.getElementById('marketplace-lista');
    const extratoListaEl = document.getElementById('extrato-lista');
    const saquesListaEl = document.getElementById('saques-lista');

    // --- FUNÇÕES DE ATUALIZAÇÃO DA UI ---
    const atualizarSaldo = (novoSaldo) => {
        saldoUsuarioEl.textContent = parseFloat(novoSaldo || 0).toFixed(2);
    };

    const atualizarUIStaking = (usuario) => {
        stakedAmountEl.textContent = parseFloat(usuario.stakedAmount || 0).toFixed(2);
        
        if (usuario.canUnstakeAt && new Date() < new Date(usuario.canUnstakeAt)) {
            unstakeDateEl.textContent = new Date(usuario.canUnstakeAt).toLocaleString('pt-BR');
            unstakeBtn.disabled = true;
            unstakeBtn.style.cursor = 'not-allowed';
        } else {
            unstakeDateEl.textContent = "Agora";
            const temStaking = (usuario.stakedAmount || 0) > 0;
            unstakeBtn.disabled = !temStaking;
            unstakeBtn.style.cursor = temStaking ? 'pointer' : 'not-allowed';
        }
    };

    const carregarExtrato = async () => {
        const response = await fetch('/api/extrato');
        const data = await response.json();
        extratoListaEl.innerHTML = '';
        if (data.sucesso && data.transacoes.length > 0) {
            data.transacoes.forEach(t => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(t.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                const valorFormatado = t.valor > 0 ? `+${t.valor.toFixed(2)}` : t.valor.toFixed(2);
                const classeValor = t.valor > 0 ? 'valor-entrada' : 'valor-saida';
                tr.innerHTML = `<td>${dataFormatada}</td><td>${t.descricao}</td><td class="${classeValor}">${valorFormatado}</td>`;
                extratoListaEl.appendChild(tr);
            });
        } else {
            extratoListaEl.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhuma transação encontrada.</td></tr>';
        }
    };
    
    const carregarHistoricoSaques = async () => {
        const response = await fetch('/api/meus-saques');
        const data = await response.json();
        saquesListaEl.innerHTML = '';
        if (data.sucesso && data.saques.length > 0) {
            data.saques.forEach(s => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(s.data).toLocaleString('pt-BR');
                tr.innerHTML = `<td>${dataFormatada}</td><td>${s.valor.toFixed(2)}</td><td><small>${s.solanaWallet}</small></td><td><span class="status-${s.status.toLowerCase()}">${s.status}</span></td>`;
                saquesListaEl.appendChild(tr);
            });
        } else {
            saquesListaEl.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum saque solicitado.</td></tr>';
        }
    };

    // --- CARREGAMENTO PRINCIPAL DO DASHBOARD ---
    const carregarDashboard = async (isUpdate = false) => {
        try {
            const response = await fetch('/api/dados-dashboard');
            if (response.status === 401) return window.location.href = '/index.html';
            const data = await response.json();

            if (data.sucesso) {
                if (!isUpdate) { // Atualiza listas e inputs apenas na primeira vez que a página carrega
                    nomeUsuarioEl.textContent = data.usuario.nome;
                    solanaWalletInput.value = data.usuario.solanaWallet || '';
                    tronWalletInput.value = data.usuario.tronWallet || ''; // <-- TRON AQUI
                    
                    if (data.usuario.isAdmin) { adminBtn.style.display = 'inline-block'; }
                    
                    carregarExtrato();
                    carregarHistoricoSaques();

                    marketplaceListaEl.innerHTML = '';
                    data.marketplace.forEach(produto => {
                        const produtoDiv = document.createElement('div');
                        produtoDiv.className = 'produto-item';
                        produtoDiv.innerHTML = `<img src="${produto.imagemUrl || 'https://via.placeholder.com/100x100?text=Sem+Imagem'}" alt="${produto.nome}" class="produto-img"><div class="produto-info"><h3>${produto.nome}</h3><p><strong>${produto.preco} SolidCoins</strong></p></div><button class="comprar-btn" data-id="${produto.id}">Comprar</button>`;
                        marketplaceListaEl.appendChild(produtoDiv);
                    });
                }
                
                // Saldo e Staking atualizam sempre (para o efeito de tempo real)
                atualizarSaldo(data.usuario.saldo);
                atualizarUIStaking(data.usuario);
            } else if (!isUpdate) {
                alert(data.mensagem);
            }
        } catch (error) {
            console.error("Erro ao carregar o dashboard:", error);
        }
    };
    
    // --- EVENT LISTENERS DOS FORMULÁRIOS E BOTÕES ---

    // Salvar Carteiras
    carteiraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = {
            solanaWallet: solanaWalletInput.value,
            tronWallet: tronWalletInput.value // <-- TRON AQUI
        };
        const response = await fetch('/api/salvar-carteira', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(dados) 
        });
        const data = await response.json();
        alert(data.mensagem);
    });

    // Solicitar Saque
    saqueForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('valor-saque').value;
        if (!solanaWalletInput.value && !tronWalletInput.value) { 
            return alert('Por favor, salve pelo menos um endereço de carteira (Solana ou Tron) primeiro.'); 
        }
        const response = await fetch('/api/solicitar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            saqueForm.reset();
            carregarHistoricoSaques();
        }
    });

    // Transferir SolidCoins
    transferirForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailDestinatario = document.getElementById('email-destinatario').value;
        const valor = document.getElementById('valor-transferencia').value;
        const response = await fetch('/api/transferir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailDestinatario, valor })
        });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            atualizarSaldo(data.novoSaldo);
            carregarExtrato();
            transferirForm.reset();
        }
    });

    // Comprar no Marketplace
    marketplaceListaEl.addEventListener('click', async (e) => {
        if (e.target.classList.contains('comprar-btn')) {
            const produtoId = e.target.dataset.id;
            const response = await fetch('/api/comprar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ produtoId })
            });
            const data = await response.json();
            alert(data.mensagem);
            if(data.sucesso) {
                atualizarSaldo(data.novoSaldo);
                carregarExtrato();
            }
        }
    });

    // --- EVENT LISTENERS DE STAKING ---
    stakeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('stake-valor').value;
        const response = await fetch('/api/staking/stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            atualizarSaldo(data.usuario.saldo);
            atualizarUIStaking(data.usuario);
            stakeForm.reset();
        }
    });

    unstakeBtn.addEventListener('click', async () => {
        if (!confirm("Tem certeza que deseja resgatar todo o valor em staking?")) return;
        const response = await fetch('/api/staking/unstake', { method: 'POST' });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            atualizarSaldo(data.usuario.saldo);
            atualizarUIStaking(data.usuario);
        }
    });

    claimRewardsBtn.addEventListener('click', async () => {
        const response = await fetch('/api/staking/claim-rewards', { method: 'POST' });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            atualizarSaldo(data.usuario.saldo);
            carregarExtrato(); // Recarrega o extrato para mostrar a recompensa
        }
    });

    // --- EVENT LISTENERS DE NAVEGAÇÃO ---
    logoutBtn.addEventListener('click', async () => {
        await fetch('/logout', { method: 'POST' });
        alert("Você foi desconectado.");
        window.location.href = '/index.html';
    });
    
    adminBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });

    // --- ATUALIZAÇÃO EM TEMPO REAL (Efeito de rendimento) ---
    setInterval(() => {
        // Só atualiza os dados em segundo plano se a aba estiver aberta
        if (!document.hidden) {
            carregarDashboard(true); // "true" significa que é apenas uma atualização de fundo
        }
    }, 5000); // Executa a cada 5 segundos

    // Carregamento inicial da página
    carregarDashboard(false);
});