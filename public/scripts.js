document.addEventListener('DOMContentLoaded', () => {
    // Lógica das Abas
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

    const nomeUsuarioEl = document.getElementById('nome-usuario');
    const saldoUsuarioEl = document.getElementById('saldo-usuario');
    const logoutBtn = document.getElementById('logout-btn');
    const adminBtn = document.getElementById('admin-btn');
    const stakedAmountEl = document.getElementById('staked-amount');
    const unstakeDateEl = document.getElementById('unstake-date');
    const stakeForm = document.getElementById('stake-form');
    const unstakeBtn = document.getElementById('unstake-btn');
    const claimRewardsBtn = document.getElementById('claim-rewards-btn');
    const carteiraForm = document.getElementById('carteira-form');
    const solanaWalletInput = document.getElementById('solana-wallet');
    const tronWalletInput = document.getElementById('tron-wallet');
    const saqueForm = document.getElementById('saque-form');
    const transferirForm = document.getElementById('transferir-form');
    const marketplaceListaEl = document.getElementById('marketplace-lista');
    const categoriasContainer = document.getElementById('marketplace-categorias');
    const extratoListaEl = document.getElementById('extrato-lista');
    const saquesListaEl = document.getElementById('saques-lista');
    
    // --- SELETORES DO GIFT CARD ---
    const giftcardForm = document.getElementById('giftcard-form');
    const giftcardTipo = document.getElementById('giftcard-tipo');
    const giftcardValor = document.getElementById('giftcard-valor');
    const giftcardCusto = document.getElementById('giftcard-custo');

    const atualizarSaldo = (novoSaldo) => { saldoUsuarioEl.textContent = parseFloat(novoSaldo || 0).toFixed(2); };

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
                
                // Se o valor for 0 (PIN do Gift Card), coloca na cor laranja para destaque, se não usa a cor padrão
                let classeValor = t.valor > 0 ? 'valor-entrada' : 'valor-saida';
                if(t.valor === 0) classeValor = ''; 

                tr.innerHTML = `<td>${dataFormatada}</td><td style="${t.valor === 0 ? 'color:#e67e22; font-weight:bold;' : ''}">${t.descricao}</td><td class="${classeValor}">${valorFormatado}</td>`;
                extratoListaEl.appendChild(tr);
            });
        } else { extratoListaEl.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhuma transação encontrada.</td></tr>'; }
    };
    
    const carregarHistoricoSaques = async () => {
        const response = await fetch('/api/meus-saques');
        const data = await response.json();
        saquesListaEl.innerHTML = '';
        if (data.sucesso && data.saques.length > 0) {
            data.saques.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${new Date(s.data).toLocaleString('pt-BR')}</td><td>${s.valor.toFixed(2)}</td><td><small>${s.solanaWallet}</small></td><td><span class="status-${s.status.toLowerCase()}">${s.status}</span></td>`;
                saquesListaEl.appendChild(tr);
            });
        } else { saquesListaEl.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum saque solicitado.</td></tr>'; }
    };

    const carregarDashboard = async (isUpdate = false) => {
        try {
            const response = await fetch('/api/dados-dashboard');
            if (response.status === 401) return window.location.href = '/index.html';
            const data = await response.json();

            if (data.sucesso) {
                if (!isUpdate) {
                    nomeUsuarioEl.textContent = data.usuario.nome;
                    solanaWalletInput.value = data.usuario.solanaWallet || '';
                    tronWalletInput.value = data.usuario.tronWallet || '';
                    if (data.usuario.isAdmin) { adminBtn.style.display = 'inline-block'; }
                    
                    carregarExtrato();
                    carregarHistoricoSaques();

                    categoriasContainer.innerHTML = ''; 
                    const categoriasUnicas = [...new Set(data.marketplace.map(p => p.categoria))];
                    
                    const renderizarProdutos = (categoriaDesejada) => {
                        marketplaceListaEl.innerHTML = '';
                        const produtosFiltrados = data.marketplace.filter(p => p.categoria === categoriaDesejada);
                        produtosFiltrados.forEach(produto => {
                            const produtoDiv = document.createElement('div');
                            produtoDiv.className = 'produto-item';
                            produtoDiv.innerHTML = `<img src="${produto.imagemUrl || 'https://via.placeholder.com/100x100?text=Sem+Imagem'}" alt="${produto.nome}" class="produto-img"><div class="produto-info"><h3>${produto.nome}</h3><p><strong>${produto.preco} SolidCoins</strong></p></div><button class="comprar-btn" data-id="${produto.id}">Comprar</button>`;
                            marketplaceListaEl.appendChild(produtoDiv);
                        });
                    };

                    categoriasUnicas.forEach((categoria, index) => {
                        const btn = document.createElement('button');
                        btn.className = `cat-btn ${index === 0 ? 'active' : ''}`;
                        btn.textContent = categoria;
                        btn.onclick = (e) => {
                            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                            e.target.classList.add('active');
                            renderizarProdutos(categoria); 
                        };
                        categoriasContainer.appendChild(btn);
                    });

                    if (categoriasUnicas.length > 0) renderizarProdutos(categoriasUnicas[0]);
                }
                atualizarSaldo(data.usuario.saldo);
                atualizarUIStaking(data.usuario);
            } else if (!isUpdate) { alert(data.mensagem); }
        } catch (error) { console.error("Erro ao carregar o dashboard:", error); }
    };
    
    carteiraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const response = await fetch('/api/salvar-carteira', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solanaWallet: solanaWalletInput.value, tronWallet: tronWalletInput.value }) });
        const data = await response.json();
        alert(data.mensagem);
    });

    saqueForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('valor-saque').value;
        if (!solanaWalletInput.value && !tronWalletInput.value) { return alert('Salve uma carteira de saque primeiro.'); }
        const response = await fetch('/api/solicitar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { saqueForm.reset(); carregarHistoricoSaques(); }
    });

    transferirForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailDestinatario = document.getElementById('email-destinatario').value;
        const valor = document.getElementById('valor-transferencia').value;
        const response = await fetch('/api/transferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailDestinatario, valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); transferirForm.reset(); }
    });

    marketplaceListaEl.addEventListener('click', async (e) => {
        if (e.target.classList.contains('comprar-btn')) {
            const produtoId = e.target.dataset.id;
            const response = await fetch('/api/comprar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtoId }) });
            const data = await response.json();
            alert(data.mensagem);
            if(data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); }
        }
    });

    // --- LÓGICA DO FORMULÁRIO DE GIFT CARD ---
    giftcardValor.addEventListener('input', () => {
        const valor = parseFloat(giftcardValor.value) || 0;
        giftcardCusto.textContent = (valor * 500).toFixed(0);
    });

    giftcardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tipo = giftcardTipo.value;
        const valorBRL = giftcardValor.value;
        
        if (!tipo) return alert("Por favor, selecione Google Play ou Shopee.");
        if (!confirm(`Confirmar a compra de um Gift Card ${tipo} de R$ ${valorBRL} por ${valorBRL * 500} SolidCoins?`)) return;

        const response = await fetch('/api/comprar-giftcard', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, valorBRL })
        });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            atualizarSaldo(data.novoSaldo);
            carregarExtrato();
            giftcardForm.reset();
            giftcardCusto.textContent = '0';
        }
    });

    stakeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('stake-valor').value;
        const response = await fetch('/api/staking/stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); atualizarUIStaking(data.usuario); stakeForm.reset(); }
    });

    unstakeBtn.addEventListener('click', async () => {
        if (!confirm("Tem certeza que deseja resgatar todo o valor em staking?")) return;
        const response = await fetch('/api/staking/unstake', { method: 'POST' });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); atualizarUIStaking(data.usuario); }
    });

    claimRewardsBtn.addEventListener('click', async () => {
        const response = await fetch('/api/staking/claim-rewards', { method: 'POST' });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); carregarExtrato(); }
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch('/logout', { method: 'POST' });
        alert("Você foi desconectado.");
        window.location.href = '/index.html';
    });
    
    adminBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });

    setInterval(() => { if (!document.hidden) carregarDashboard(true); }, 5000);

    carregarDashboard(false);
});