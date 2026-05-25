document.addEventListener('DOMContentLoaded', () => {
    // Lógica de Logout do ADM
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/logout', { method: 'POST' });
            window.location.href = '/index.html';
        });
    }

    // Carrega tudo ao abrir a página
    window.carregarPendentes();
});

// --- FUNÇÃO PARA CARREGAR TODAS AS TABELAS ---
window.carregarPendentes = async () => {
    try {
        const res = await fetch('/api/admin/pedidos-pendentes');
        if (res.status === 401 || res.status === 403) {
            window.location.href = '/index.html';
            return;
        }
        
        const data = await res.json();
        
        if (data.sucesso) {
            // 1. CARREGAR SAQUES PENDENTES
            const saquesList = document.getElementById('saques-lista');
            if (saquesList) {
                saquesList.innerHTML = '';
                if (data.saques.length === 0) {
                    saquesList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Nenhum saque pendente.</td></tr>';
                } else {
                    data.saques.forEach(saq => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${new Date(saq.data).toLocaleString('pt-BR')}</td>
                            <td>${saq.nomeUsuario} <br><small style="color: #888;">${saq.emailUsuario}</small></td>
                            <td><strong style="color:#d4af37">${saq.valor.toFixed(2)} SC</strong></td>
                            <td style="font-size: 0.9em; word-break: break-all;">${saq.solanaWallet}</td>
                            <td>
                                <button class="aprovar-btn" onclick="processarSaque('${saq._id}', 'aprovar')">Aprovar</button>
                                <button class="rejeitar-btn" onclick="processarSaque('${saq._id}', 'rejeitar')">Rejeitar</button>
                            </td>
                        `;
                        saquesList.appendChild(tr);
                    });
                }
            }

            // 2. CARREGAR GIFT CARDS PENDENTES (Google/Shopee)
            const giftsList = document.getElementById('gifts-lista');
            if (giftsList) {
                giftsList.innerHTML = '';
                if (data.gifts.length === 0) {
                    giftsList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhum pedido de Gift Card pendente.</td></tr>';
                } else {
                    data.gifts.forEach(gift => {
                        const tr = document.createElement('tr');
                        // Suporte para retrocompatibilidade do banco de dados (tipo vs tipoGift)
                        const tipo = gift.tipoGift || gift.tipo;
                        const valorReais = gift.valorReais || gift.valorBRL;
                        const custo = gift.valorSolidCoin || gift.custoSolidCoin;
                        
                        tr.innerHTML = `
                            <td>${new Date(gift.data || gift.geradoEm || Date.now()).toLocaleString('pt-BR')}</td>
                            <td>${gift.nomeUsuario} <br><small style="color: #888;">${gift.emailUsuario}</small></td>
                            <td><strong style="color:#2ecc71">${tipo}</strong></td>
                            <td>R$ ${parseFloat(valorReais).toFixed(2)}</td>
                            <td>${parseFloat(custo).toFixed(2)} SC</td>
                            <td>
                                <button class="aprovar-btn" onclick="processarGiftCard('${gift._id}', 'aprovar')">Aprovar (Enviar PIN)</button>
                                <button class="rejeitar-btn" onclick="processarGiftCard('${gift._id}', 'rejeitar')">Cancelar & Reembolsar</button>
                            </td>
                        `;
                        giftsList.appendChild(tr);
                    });
                }
            }

            // 3. CARREGAR RECARGAS DE CELULAR PENDENTES
            const rechargesList = document.getElementById('recharges-lista');
            if (rechargesList) {
                rechargesList.innerHTML = '';
                if (data.recharges.length === 0) {
                    rechargesList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhuma recarga pendente.</td></tr>';
                } else {
                    data.recharges.forEach(rec => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${new Date(rec.data).toLocaleString('pt-BR')}</td>
                            <td>${rec.nomeUsuario} <br><small style="color: #888;">${rec.emailUsuario}</small></td>
                            <td><strong style="color:#3498db">${rec.operadora}</strong></td>
                            <td style="font-size: 1.1em; letter-spacing: 1px;">${rec.numeroCelular}</td>
                            <td>R$ ${rec.valorReais.toFixed(2)}</td>
                            <td>
                                <button class="aprovar-btn" onclick="processarRecharge('${rec._id}', 'aprovar')">Aprovar (Enviar NSU)</button>
                                <button class="rejeitar-btn" onclick="processarRecharge('${rec._id}', 'rejeitar')">Cancelar & Reembolsar</button>
                            </td>
                        `;
                        rechargesList.appendChild(tr);
                    });
                }
            }
        }
    } catch (error) {
        console.error("Erro ao carregar dados do painel:", error);
    }
};

// --- FUNÇÕES DE PROCESSAMENTO (BOTÕES) ---

window.processarSaque = async (id, acao) => {
    if (acao === 'rejeitar' && !confirm('Tem certeza que deseja rejeitar este saque? (As moedas NÃO são devolvidas automaticamente neste caso)')) return;
    
    const res = await fetch('/api/admin/processar-saque', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId: id, acao })
    });
    const data = await res.json();
    alert(data.mensagem);
    if(data.sucesso) window.carregarPendentes();
};

window.processarGiftCard = async (id, acao) => {
    let pin = '';
    if (acao === 'aprovar') {
        pin = prompt('Compra aprovada! Digite o PIN do Gift Card para enviar ao usuário:');
        if (!pin) return alert('Operação cancelada. O PIN é obrigatório para concluir o pedido.');
    } else if (!confirm('Tem certeza que deseja cancelar e devolver as SolidCoins para o usuário?')) {
        return;
    }

    const res = await fetch('/api/admin/processar-giftcard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id, acao, pin })
    });
    const data = await res.json();
    alert(data.mensagem);
    if(data.sucesso) window.carregarPendentes();
};

window.processarRecharge = async (id, acao) => {
    let nsu = '';
    if (acao === 'aprovar') {
        nsu = prompt('Recarga realizada! Digite o NSU ou ID da transação para enviar ao usuário:');
        if (!nsu) return alert('Operação cancelada. O NSU é obrigatório.');
    } else if (!confirm('Tem certeza que deseja cancelar e devolver as SolidCoins para o usuário?')) {
        return;
    }

    const res = await fetch('/api/admin/processar-recharge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rechargeId: id, acao, nsu })
    });
    const data = await res.json();
    alert(data.mensagem);
    if(data.sucesso) window.carregarPendentes();
};

// --- GERAR CÓDIGOS SOLIDCOIN ---
window.gerarGiftCardSolidCoin = async () => {
    const valorInput = document.getElementById('valor-gerar-gift');
    const valor = valorInput ? parseFloat(valorInput.value) : 0;
    
    if (!valor || valor <= 0) return alert("Digite um valor válido em SolidCoins.");
    
    if(!confirm(`Deseja gerar um Gift Card de ${valor} SC? Isso será debitado do seu saldo de CEO.`)) return;

    try {
        const res = await fetch('/api/admin/gerar-giftcard-solidcoin', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor })
        });
        const data = await res.json();
        
        // Exibe o código gerado na tela
        alert(data.mensagem);
        
        if(data.sucesso && valorInput) {
            valorInput.value = '';
        }
    } catch(e) {
        console.error(e);
        alert("Erro ao tentar gerar o código. Verifique a conexão.");
    }
};