// Função para abas (Extrato / Saques)
function openTab(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

document.addEventListener('DOMContentLoaded', () => {
    // Elementos da página
    const nomeUsuarioEl = document.getElementById('nome-usuario');
    const saldoUsuarioEl = document.getElementById('saldo-usuario');
    const logoutBtn = document.getElementById('logout-btn');
    const adminBtn = document.getElementById('admin-btn');
    const carteiraForm = document.getElementById('carteira-form');
    const solanaWalletInput = document.getElementById('solana-wallet');
    const saqueForm = document.getElementById('saque-form');
    const transferirForm = document.getElementById('transferir-form');
    const marketplaceListaEl = document.getElementById('marketplace-lista');
    const extratoListaEl = document.getElementById('extrato-lista');
    const saquesListaEl = document.getElementById('saques-lista');

    const atualizarSaldo = (novoSaldo) => {
        saldoUsuarioEl.textContent = parseFloat(novoSaldo).toFixed(2);
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

    const carregarDashboard = async () => {
        const response = await fetch('/api/dados-dashboard');
        if (response.status === 401) return window.location.href = '/index.html';
        const data = await response.json();
        if (data.sucesso) {
            nomeUsuarioEl.textContent = data.usuario.nome;
            atualizarSaldo(data.usuario.saldo);
            solanaWalletInput.value = data.usuario.solanaWallet || '';
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
        } else { alert(data.mensagem); }
    };
    
    carteiraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const response = await fetch('/api/salvar-carteira', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solanaWallet: solanaWalletInput.value }) });
        const data = await response.json();
        alert(data.mensagem);
    });

    saqueForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = document.getElementById('valor-saque').value;
        if (!solanaWalletInput.value) { return alert('Por favor, salve um endereço de carteira Solana primeiro.'); }
        const response = await fetch('/api/solicitar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            saqueForm.reset();
            carregarHistoricoSaques();
        }
    });

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

    logoutBtn.addEventListener('click', async () => {
        await fetch('/logout', { method: 'POST' });
        alert("Você foi desconectado.");
        window.location.href = '/index.html';
    });
    
    adminBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });

    carregarDashboard();
});