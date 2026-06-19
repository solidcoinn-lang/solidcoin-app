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
    const saldoReaisEl = document.getElementById('saldo-reais');
    const cotacaoAtualEl = document.getElementById('cotacao-atual');
    const toggleSaldoBtn = document.getElementById('toggle-saldo');
    const codigoIndicacaoEl = document.getElementById('codigo-indicacao'); 
    const limiteSaqueUsuarioEl = document.getElementById('limite-saque-usuario'); // <-- NOVO ELEMENTO DO LIMITE
    
    const logoutBtn = document.getElementById('logout-btn');
    const adminBtn = document.getElementById('admin-btn');
    const extratoListaEl = document.getElementById('extrato-lista');
    const saquesListaEl = document.getElementById('saques-lista');
    
    let isSaldoOculto = false;
    let ultimoSaldoSC = 0;
    let ultimoLimiteSaqueSC = 0; // <-- NOVA INTEGRACAO
    let scRate = 500; 

    toggleSaldoBtn.addEventListener('click', () => {
        isSaldoOculto = !isSaldoOculto;
        toggleSaldoBtn.textContent = isSaldoOculto ? '🙈' : '👁️';
        atualizarUIValores();
    });

    const atualizarUIValores = () => {
        const saldoFormatado = ultimoSaldoSC.toFixed(2);
        const saldoReaisFormatado = (ultimoSaldoSC / scRate).toFixed(2);
        
        if (isSaldoOculto) {
            saldoUsuarioEl.textContent = '••••••';
            saldoReaisEl.textContent = '••••••';
            limiteSaqueUsuarioEl.textContent = '••••••'; // <-- OCULTA O LIMITE NO OLHINHO
        } else {
            saldoUsuarioEl.textContent = saldoFormatado;
            saldoReaisEl.textContent = saldoReaisFormatado;
            limiteSaqueUsuarioEl.textContent = ultimoLimiteSaqueSC.toFixed(2); // <-- REVELA O LIMITE
        }
    };

    const atualizarSaldo = (novoSaldo, novoLimite) => { 
        ultimoSaldoSC = parseFloat(novoSaldo || 0);
        ultimoLimiteSaqueSC = parseFloat(novoLimite || 0); // <-- ATUALIZA O LIMITE
        atualizarUIValores();
    };

    // ==========================================
    // --- LÓGICA WEB3: TRONLINK (SMART CONTRACT) ---
    // ==========================================
    const CONTRATO_SOLIDCOIN = "TEyHvpEwPVoVqBDVXKnLBJPQDU7ACoikjE"; 
    
    const ABI_SIMPLIFICADA = [{"inputs":[],"name":"claimRewards","outputs":[],"stateMutability":"nonpayable","type":"function"}];

    const btnConnectTron = document.getElementById('btn-connect-tron');
    const btnClaimTron = document.getElementById('btn-claim-tron');
    const tronStatus = document.getElementById('tron-status');

    btnConnectTron.addEventListener('click', async () => {
        if (window.tronLink || window.tronWeb) {
            try {
                if (window.tronLink && window.tronLink.request) {
                    await window.tronLink.request({ method: 'tron_requestAccounts' });
                }
                setTimeout(() => {
                    if (window.tronWeb && window.tronWeb.defaultAddress.base58) {
                        tronStatus.textContent = "✅ Conectado: " + window.tronWeb.defaultAddress.base58;
                        btnConnectTron.style.display = 'none';
                        btnClaimTron.style.display = 'block';
                    } else {
                        alert("Carteira não encontrada. Por favor, abra a extensão TronLink, digite sua senha e tente novamente.");
                    }
                }, 500);

            } catch (error) {
                console.error("Erro ao conectar com a TronLink:", error);
                alert("Conexão recusada pelo usuário ou erro na extensão.");
            }
        } else {
            alert("Por favor, instale a extensão TronLink no seu navegador (Chrome/Brave).");
        }
    });

    btnClaimTron.addEventListener('click', async () => {
        if (!window.tronWeb || !window.tronWeb.defaultAddress.base58) {
            return alert("TronLink desconectado!");
        }

        try {
            tronStatus.textContent = "⏳ Aguardando confirmação na TronLink...";
            const contract = await window.tronWeb.contract(ABI_SIMPLIFICADA, CONTRATO_SOLIDCOIN);
            const txHash = await contract.claimRewards().send({ feeLimit: 150000000 });
            tronStatus.textContent = "✅ Resgate enviado! Hash: " + txHash;
            alert("Sucesso! A transação foi enviada para a blockchain Tron. Os rendimentos cairão na sua carteira TronLink em instantes.");

        } catch (error) {
            console.error(error);
            tronStatus.textContent = "❌ Falha na transação.";
            alert("Erro ao tentar resgatar.\nVerifique se você tem saldo em TRX (Testnet) suficiente para pagar a taxa (Gás) ou se você tem rendimentos pendentes.");
        }
    });

    // --- LÓGICA: SAQUE PIX VIP ---
    const pixValInput = document.getElementById('pix-valor-sc');
    const pixTaxaSc = document.getElementById('pix-taxa-sc');
    const pixReceberBrl = document.getElementById('pix-receber-brl');
    
    const atualizarCalculoPix = () => {
        const v = parseFloat(pixValInput.value) || 0;
        const taxa = v * 0.05;
        const liquido = v - taxa;
        pixTaxaSc.textContent = taxa.toFixed(2);
        pixReceberBrl.textContent = (liquido / scRate).toFixed(2);
    };

    if (pixValInput) {
        pixValInput.addEventListener('input', atualizarCalculoPix);
    }

    document.getElementById('saque-pix-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const valorSC = document.getElementById('pix-valor-sc').value;
        const tipoChave = document.getElementById('pix-tipo-chave').value;
        const chavePix = document.getElementById('pix-chave').value;
        
        if (parseFloat(valorSC) > ultimoLimiteSaqueSC) {
            return alert(`Saque Bloqueado!\n\nSeu limite de saque disponível no momento é de ${ultimoLimiteSaqueSC.toFixed(2)} SC.`);
        }
        
        if (!confirm(`Confirmar Saque Pix?\nValor Bruto: ${valorSC} SC\nTaxa: 5%\nChave: ${chavePix}`)) return;
        
        const response = await fetch('/api/solicitar-saque-pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valorSC, tipoChave, chavePix })
        });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) { 
            document.getElementById('saque-pix-form').reset(); 
            atualizarCalculoPix();
            carregarHistoricoSaques(); 
            carregarDashboard(true); 
        }
    });
    // ---------------------------------

    // Staking Plataforma
    const stakedAmountEl = document.getElementById('staked-amount');
    const unstakeDateEl = document.getElementById('unstake-date');
    const stakeForm = document.getElementById('stake-form');
    const unstakeBtn = document.getElementById('unstake-btn');
    const claimRewardsBtn = document.getElementById('claim-rewards-btn');
    
    // Planos de Sócio
    const planosData = {
        "Socio SolidCoin para Todos": { img: "https://i.postimg.cc/DZ39CCDv/file-000000004a7c71f98e2aedb0290f8b53.png", desc: "Ao aderir a esse plano o Sócio terá 500 SolidCoins mensais.", pix: "https://invoice.infinitepay.io/plans/solidcoin/gDRbdBuXD" },
        "Iron": { img: "https://i.postimg.cc/wMCLJm33/file-000000008d0c720e8dc3a17f05318954.png", desc: "2.750 + Bônus 10% = 3.025 SolidCoins.", pix: "https://invoice.infinitepay.io/plans/solidcoin/IzqprmCRH" },
        "Bronze": { img: "https://i.postimg.cc/vTV0x9bh/file-000000005f18720ea997f1f684984712.png", desc: "5.500 + Bônus 15% = 6.325 SolidCoins.", pix: "https://invoice.infinitepay.io/plans/solidcoin/FpXkomAf1" },
        "Prata": { img: "https://i.postimg.cc/fW9CKcQ0/1779763037364.png", desc: "11.000 + Bônus 20% = 13.200 SolidCoins.", pix: "https://invoice.infinitepay.io/plans/solidcoin/3AJ9uKWkz" },
        "Ouro": { img: "https://i.postimg.cc/YSTgGP9s/1779763235400.png", desc: "27.500 + Bônus 25% = 34.375 SolidCoins.", pix: "https://invoice.infinitepay.io/plans/solidcoin/67x6Rp2wAz" },
        "Diamante": { img: "https://i.postimg.cc/LXdY6ZQJ/1779763392066.png", desc: "55.000 + Bônus 30% = 71.500 SolidCoins.", pix: "https://invoice.infinitepay.io/plans/solidcoin/22eN8p8iIl" }
    };

    const socioForm = document.getElementById('socio-form');
    const socioPlano = document.getElementById('socio-plano');
    const socioPagamento = document.getElementById('socio-pagamento');
    const socioDetalhes = document.getElementById('socio-detalhes');
    const socioInstrucoes = document.getElementById('socio-instrucoes');
    const socioTxid = document.getElementById('socio-txid');
    const socioBtn = document.getElementById('socio-btn');

    socioPlano.addEventListener('change', () => {
        const plano = planosData[socioPlano.value];
        if(plano) {
            socioDetalhes.style.display = 'block';
            document.getElementById('socio-img').src = plano.img;
            document.getElementById('socio-desc').textContent = plano.desc;
            socioPagamento.style.display = 'block';
            socioPagamento.value = ""; 
            socioInstrucoes.style.display = 'none';
            socioTxid.style.display = 'none';
            socioBtn.style.display = 'none';
        }
    });

    socioPagamento.addEventListener('change', () => {
        socioInstrucoes.style.display = 'block';
        socioTxid.style.display = 'block';
        socioBtn.style.display = 'block';
        
        const plano = planosData[socioPlano.value];
        const metodo = socioPagamento.value;
        const textoEl = document.getElementById('socio-instrucao-texto');
        const dadoEl = document.getElementById('socio-instrucao-dado');
        const linkPix = document.getElementById('socio-link-pix');

        if (metodo === 'Pix') {
            textoEl.textContent = "Faça o pagamento no InfinitePay e cole a ID da Transação abaixo:";
            dadoEl.textContent = "";
            linkPix.style.display = 'inline-block';
            linkPix.href = plano.pix;
        } else if (metodo === 'Solana') {
            textoEl.textContent = "Envie o valor em USDC para a carteira Solana abaixo:";
            dadoEl.textContent = "HfvVTPtjEbYZCKCvk1KtrWX8WvVF5iRQjTPGLPTeJ7Mb";
            linkPix.style.display = 'none';
        } else if (metodo === 'Tron') {
            textoEl.textContent = "Envie o valor em USDT para a carteira Tron abaixo:";
            dadoEl.textContent = "TXwJkvcqumZSbDFzgtcdpKWh7CupubPsSZ";
            linkPix.style.display = 'none';
        }
    });

    socioForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const plano = socioPlano.value;
        const metodo = socioPagamento.value;
        const txId = socioTxid.value;

        if (!confirm(`Confirmar envio de assinatura do plano ${plano} pago via ${metodo}?`)) return;

        const res = await fetch('/api/socio/assinar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plano, metodoPagamento: metodo, txId })
        });
        const data = await res.json();
        alert(data.mensagem);
        if (data.sucesso) { socioForm.reset(); socioDetalhes.style.display = 'none'; socioInstrucoes.style.display = 'none'; socioTxid.style.display='none'; socioBtn.style.display='none'; }
    });

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
                tr.innerHTML = `<td>${dataFormatada}</td><td>${s.valor.toFixed(2)} SC</td><td style="font-size: 0.85em; word-break: break-all;">${s.solanaWallet}</td><td><span class="status-${s.status.toLowerCase()}">${s.status}</span></td>`;
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
                scRate = data.scRate || 500;
                cotacaoAtualEl.textContent = scRate;

                // ATUALIZA SALDO E ENVIAR LIMITE AO MOTOR CENTRAL
                atualizarSaldo(data.usuario.saldo, data.usuario.limiteDeSaque); 

                atualizarCustoDinamico(document.getElementById('gift-valor'), document.getElementById('gift-custo'));
                atualizarCustoDinamico(document.getElementById('recharge-valor'), document.getElementById('recharge-custo'));

                if(data.usuario.codigoIndicacao && codigoIndicacaoEl) {
                    codigoIndicacaoEl.textContent = data.usuario.codigoIndicacao;
                }

                if (!isUpdate) { 
                    nomeUsuarioEl.textContent = data.usuario.nome;
                    document.getElementById('solana-wallet').value = data.usuario.solanaWallet || '';
                    document.getElementById('tron-wallet').value = data.usuario.tronWallet || '';
                    if (data.usuario.isAdmin) { adminBtn.style.display = 'inline-block'; }
                    carregarExtrato(); carregarHistoricoSaques();

                    const marketplaceListaEl = document.getElementById('marketplace-lista');
                    const categoriasContainer = document.getElementById('marketplace-categorias');
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

                    categoriasUnicas.forEach((categoria) => {
                        const btn = document.createElement('button');
                        btn.className = 'cat-btn'; 
                        btn.textContent = categoria;
                        btn.onclick = (e) => {
                            const jaEstaAtivo = e.target.classList.contains('active');
                            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                            if (jaEstaAtivo) {
                                marketplaceListaEl.innerHTML = '';
                            } else {
                                e.target.classList.add('active'); 
                                renderizarProdutos(categoria);
                            }
                        };
                        categoriasContainer.appendChild(btn);
                    });
                }
                
                document.getElementById('status-socio').textContent = data.usuario.statusSocio || 'Inativo';
                if(data.usuario.statusSocio === 'Inadimplente') document.getElementById('status-socio').style.color = '#e74c3c';
                
                if(data.usuario.vencimentoSocio) {
                    document.getElementById('vencimento-socio-box').style.display = 'block';
                    document.getElementById('vencimento-socio').textContent = new Date(data.usuario.vencimentoSocio).toLocaleDateString('pt-BR');
                }

                atualizarUIStaking(data.usuario);
            } else if (!isUpdate) { alert(data.mensagem); }
        } catch (error) { console.error("Erro ao carregar o dashboard:", error); }
    };

    document.getElementById('carteira-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = { solanaWallet: document.getElementById('solana-wallet').value, tronWallet: document.getElementById('tron-wallet').value };
        const response = await fetch('/api/salvar-carteira', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
        const data = await response.json(); alert(data.mensagem);
    });

    document.getElementById('saque-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('valor-saque').value;
        const sol = document.getElementById('solana-wallet').value;
        const tron = document.getElementById('tron-wallet').value;
        
        if (parseFloat(valor) > ultimoLimiteSaqueSC) {
            return alert(`Saque Bloqueado!\n\nSeu limite de saque disponível no momento é de ${ultimoLimiteSaqueSC.toFixed(2)} SC.`);
        }
        
        if (!sol && !tron) return alert('Salve pelo menos uma carteira primeiro.');
        const response = await fetch('/api/solicitar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { document.getElementById('saque-form').reset(); carregarHistoricoSaques(); carregarDashboard(true); }
    });

    const depositoForm = document.getElementById('deposito-form');
    const depositoRede = document.getElementById('deposito-rede');
    if (depositoForm) {
        depositoRede.addEventListener('change', () => {
            document.getElementById('deposito-carteira-box').style.display = 'block';
            if (depositoRede.value === 'Solana') document.getElementById('deposito-carteira-texto').textContent = 'HfvVTPtjEbYZCKCvk1KtrWX8WvVF5iRQjTPGLPTeJ7Mb';
            else if (depositoRede.value === 'Tron') document.getElementById('deposito-carteira-texto').textContent = 'TXwJkvcqumZSbDFzgtcdpKWh7CupubPsSZ';
        });
        depositoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rede = depositoRede.value; const valor = document.getElementById('deposito-valor').value; const linkTransacao = document.getElementById('deposito-link').value;
            if (!confirm(`Avisar depósito de ${valor} SC na rede ${rede}?`)) return;
            const res = await fetch('/api/depositar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rede, valor, linkTransacao }) });
            const data = await res.json(); alert(data.mensagem);
            if (data.sucesso) { depositoForm.reset(); document.getElementById('deposito-carteira-box').style.display = 'none'; }
        });
    }

    document.getElementById('transferir-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailDestinatario = document.getElementById('email-destinatario').value; const valor = document.getElementById('valor-transferencia').value;
        const response = await fetch('/api/transferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailDestinatario, valor }) });
        const data = await response.json(); alert(data.mensagem);
        if (data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); document.getElementById('transferir-form').reset(); }
    });

    document.getElementById('marketplace-lista').addEventListener('click', async (e) => {
        if (e.target.classList.contains('comprar-btn')) {
            const produtoId = e.target.dataset.id;
            const response = await fetch('/api/comprar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtoId }) });
            const data = await response.json(); alert(data.mensagem);
            if(data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); }
        }
    });

    stakeForm.addEventListener('submit', async (e) => {
        e.preventDefault(); const valor = document.getElementById('stake-valor').value;
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

    const giftForm = document.getElementById('giftcard-form');
    if (giftForm) {
        const tipo = document.getElementById('gift-tipo'); const val = document.getElementById('gift-valor'); const custo = document.getElementById('gift-custo');
        const updateG = () => {
            if(tipo.value === 'Shopee') { val.min = 30; val.placeholder = "Valor em R$ (Mín 30)"; } else { val.min = 15; val.placeholder = "Valor em R$ (Mín 15)"; }
            atualizarCustoDinamico(val, custo);
        };
        tipo.addEventListener('change', updateG); val.addEventListener('input', updateG); updateG();
        giftForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!confirm(`Confirmar a compra de Gift Card de R$ ${val.value}?`)) return;
            const res = await fetch('/api/giftcard/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({tipo: tipo.value, valorReais: val.value}) });
            const data = await res.json(); alert(data.mensagem);
            if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); giftForm.reset(); updateG(); }
        });
    }

    const resgatarGiftForm = document.getElementById('resgatar-gift-solidcoin-form');
    if(resgatarGiftForm) {
        resgatarGiftForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const res = await fetch('/api/resgatar-giftcard-solidcoin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: document.getElementById('codigo-gift-solidcoin').value }) });
            const data = await res.json(); alert(data.mensagem);
            if(data.sucesso) { atualizarSaldo(data.novoSaldo); carregarExtrato(); resgatarGiftForm.reset(); }
        });
    }

    const rechForm = document.getElementById('recharge-form');
    if (rechForm) {
        const op = document.getElementById('recharge-operadora'); const val = document.getElementById('recharge-valor'); const cel = document.getElementById('recharge-celular'); const custo = document.getElementById('recharge-custo');
        const valoresOperadoras = { Claro: [20, 25, 30, 35, 40, 50, 100], Vivo: [20, 25, 30, 35, 40, 50, 100, 200, 300], Tim: [20, 30, 40, 50, 60, 100] };
        const updateR = () => {
            val.innerHTML = '';
            valoresOperadoras[op.value].forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = `R$ ${v.toFixed(2)}`; val.appendChild(opt); });
            atualizarCustoDinamico(val, custo);
        };
        op.addEventListener('change', updateR); val.addEventListener('change', () => atualizarCustoDinamico(val, custo)); updateR();
        rechForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!confirm(`Confirmar recarga ${op.value} de R$ ${val.value}?`)) return;
            const res = await fetch('/api/recharge/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({operadora: op.value, valorReais: val.value, numeroCelular: cel.value}) });
            const data = await res.json(); alert(data.mensagem);
            if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); rechForm.reset(); updateR(); }
        });
    }

    logoutBtn.addEventListener('click', async () => { await fetch('/logout', { method: 'POST' }); window.location.href = '/index.html'; });
    adminBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });

    setInterval(() => { if (!document.hidden) carregarDashboard(true); }, 5000);
    carregarDashboard(false);
});