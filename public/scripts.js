document.addEventListener('DOMContentLoaded', () => {
    // --- LÓGICA DAS ABAS ---
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
    const extratoListaEl = document.getElementById('extrato-lista');
    const saquesListaEl = document.getElementById('saques-lista');
    
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
    
    // Depósitos
    const depositoForm = document.getElementById('deposito-form');
    const depositoRede = document.getElementById('deposito-rede');
    const depositoCarteiraBox = document.getElementById('deposito-carteira-box');
    const depositoCarteiraTexto = document.getElementById('deposito-carteira-texto');

    const marketplaceListaEl = document.getElementById('marketplace-lista');
    const categoriasContainer = document.getElementById('marketplace-categorias');

    const giftcardForm = document.getElementById('giftcard-form');
    const giftTipoSelect = document.getElementById('gift-tipo');
    const giftValorInput = document.getElementById('gift-valor');
    const giftCustoSpan = document.getElementById('gift-custo');
    const resgatarGiftSolidCoinForm = document.getElementById('resgatar-gift-solidcoin-form');

    const rechargeForm = document.getElementById('recharge-form');
    const rechargeOperadora = document.getElementById('recharge-operadora');
    const rechargeValor = document.getElementById('recharge-valor');
    const rechargeCelular = document.getElementById('recharge-celular');
    const rechargeCusto = document.getElementById('recharge-custo');

    const atualizarSaldo = (novoSaldo) => { saldoUsuarioEl.textContent = parseFloat(novoSaldo || 0).toFixed(2); };

    const atualizarUIStaking = (usuario) => {
        stakedAmountEl.textContent = parseFloat(usuario.stakedAmount || 0).toFixed(2);
        if (usuario.canUnstakeAt && new Date() < new Date(usuario.canUnstakeAt)) {
            unstakeDateEl.textContent = new Date(usuario.canUnstakeAt).toLocaleString('pt-BR');
            unstakeBtn.disabled = true; unstakeBtn.style.cursor = 'not-allowed';
        } else {
            unstakeDateEl.textContent = "Agora";
            const temStaking = (usuario.stakedAmount || 0) > 0;
            unstakeBtn.disabled = !temStaking; unstakeBtn.style.cursor = temStaking ? 'pointer' : 'not-allowed';
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
        } else { extratoListaEl.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhuma transação encontrada.</td></tr>'; }
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
                    carregarExtrato(); carregarHistoricoSaques();

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
                            e.target.classList.add('active'); renderizarProdutos(categoria);
                        };
                        categoriasContainer.appendChild(btn);
                    });
                    if (categoriasUnicas.length > 0) { renderizarProdutos(categoriasUnicas[0]); }
                }
                atualizarSaldo(data.usuario.saldo); atualizarUIStaking(data.usuario);
            } else if (!isUpdate) { alert(data.mensagem); }
        } catch (error) { console.error("Erro ao carregar o dashboard:", error); }
    };

    carteiraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = { solanaWallet: solanaWalletInput.value, tronWallet: tronWalletInput.value };
        const response = await fetch('/api/salvar-carteira', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
        const data = await response.json(); alert(data.mensagem);
    });

    saqueForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('valor-saque').value;
        if (!solanaWalletInput.value && !tronWalletInput.value) { return alert('Salve pelo menos uma carteira primeiro.'); }
        const response = await fetch('/api/solicitar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { saqueForm.reset(); carregarHistoricoSaques(); }
    });

    // --- LÓGICA DE DEPÓSITO ---
    if (depositoForm) {
        depositoRede.addEventListener('change', () => {
            depositoCarteiraBox.style.display = 'block';
            if (depositoRede.value === 'Solana') {
                depositoCarteiraTexto.textContent = 'HfvVTPtjEbYZCKCvk1KtrWX8WvVF5iRQjTPGLPTeJ7Mb';
            } else if (depositoRede.value === 'Tron') {
                depositoCarteiraTexto.textContent = 'TXwJkvcqumZSbDFzgtcdpKWh7CupubPsSZ';
            }
        });

        depositoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rede = depositoRede.value;
            const valor = document.getElementById('deposito-valor').value;
            const linkTransacao = document.getElementById('deposito-link').value;

            if (!confirm(`Confirmar aviso de depósito de ${valor} SC na rede ${rede}?`)) return;

            const res = await fetch('/api/depositar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rede, valor, linkTransacao })
            });
            const data = await res.json();
            alert(data.mensagem);
            if (data.sucesso) { depositoForm.reset(); depositoCarteiraBox.style.display = 'none'; }
        });
    }

    transferirForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailDestinatario = document.getElementById('email-destinatario').value;
        const valor = document.getElementById('valor-transferencia').value;
        const response = await fetch('/api/transferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailDestinatario, valor }) });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); transferirForm.reset(); }
    });

    marketplaceListaEl.addEventListener('click', async (e) => {
        if (e.target.classList.contains('comprar-btn')) {
            const produtoId = e.target.dataset.id;
            const response = await fetch('/api/comprar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtoId }) });
            const data = await response.json(); alert(data.mensagem);
            if(data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); }
        }
    });

    stakeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('stake-valor').value;
        const response = await fetch('/api/staking/stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); atualizarUIStaking(data.usuario); stakeForm.reset(); }
    });

    unstakeBtn.addEventListener('click', async () => {
        if (!confirm("Tem certeza que deseja resgatar todo o valor em staking?")) return;
        const response = await fetch('/api/staking/unstake', { method: 'POST' });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); atualizarUIStaking(data.usuario); }
    });

    claimRewardsBtn.addEventListener('click', async () => {
        const response = await fetch('/api/staking/claim-rewards', { method: 'POST' });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.usuario.saldo); carregarExtrato(); }
    });

    if (resgatarGiftSolidCoinForm) {
        resgatarGiftSolidCoinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const codigo = document.getElementById('codigo-gift-solidcoin').value;
            const response = await fetch('/api/resgatar-giftcard-solidcoin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }) });
            const data = await response.json(); alert(data.mensagem);
            if(data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); resgatarGiftSolidCoinForm.reset(); }
        });
    }

    if (giftcardForm) {
        const atualizarGift = () => {
            const tipo = giftTipoSelect.value;
            if(tipo === 'Shopee') { giftValorInput.min = 30; giftValorInput.placeholder = "Valor em R$ (Mín 30, Máx 300)"; } 
            else { giftValorInput.min = 15; giftValorInput.placeholder = "Valor em R$ (Mín 15, Máx 300)"; }
            const v = parseFloat(giftValorInput.value) || 0;
            giftCustoSpan.textContent = (v * 500).toLocaleString('pt-BR');
        };
        giftTipoSelect.addEventListener('change', atualizarGift); giftValorInput.addEventListener('input', atualizarGift); atualizarGift();

        giftcardForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tipo = giftTipoSelect.value; const valorReais = giftValorInput.value;
            if (!confirm(`Confirmar a compra de Gift Card ${tipo} de R$ ${valorReais} por ${valorReais * 500} SC?`)) return;
            const res = await fetch('/api/giftcard/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({tipo, valorReais}) });
            const data = await res.json(); alert(data.mensagem);
            if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); giftcardForm.reset(); atualizarGift(); }
        });
    }

    if (rechargeForm) {
        const valoresOperadoras = { Claro: [20, 25, 30, 35, 40, 50, 100], Vivo: [20, 25, 30, 35, 40, 50, 100, 200, 300], Tim: [20, 30, 40, 50, 60, 100] };
        const atualizarValoresRecarga = () => {
            const op = rechargeOperadora.value; rechargeValor.innerHTML = '';
            valoresOperadoras[op].forEach(val => { const opt = document.createElement('option'); opt.value = val; opt.textContent = `R$ ${val.toFixed(2)}`; rechargeValor.appendChild(opt); });
            atualizarCustoRecarga();
        };
        const atualizarCustoRecarga = () => { const v = parseFloat(rechargeValor.value) || 0; rechargeCusto.textContent = (v * 500).toLocaleString('pt-BR'); };
        rechargeOperadora.addEventListener('change', atualizarValoresRecarga); rechargeValor.addEventListener('change', atualizarCustoRecarga); atualizarValoresRecarga();

        rechargeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const operadora = rechargeOperadora.value; const valorReais = rechargeValor.value; const numeroCel = rechargeCelular.value;
            if (!confirm(`Confirmar recarga ${operadora} de R$ ${valorReais} para o número ${numeroCel}?`)) return;
            const res = await fetch('/api/recharge/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({operadora, valorReais, numeroCelular: numeroCel}) });
            const data = await res.json(); alert(data.mensagem);
            if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); rechargeForm.reset(); atualizarValoresRecarga(); }
        });
    }

    logoutBtn.addEventListener('click', async () => { await fetch('/logout', { method: 'POST' }); window.location.href = '/index.html'; });
    adminBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });

    setInterval(() => { if (!document.hidden) carregarDashboard(true); }, 5000);
    carregarDashboard(false);
});