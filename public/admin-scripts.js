let todosUsuarios = []; // Variável global para guardar a lista e permitir a pesquisa rápida

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/logout', { method: 'POST' });
            window.location.href = '/index.html';
        });
    }

    // Evento de Pesquisa de Usuários em Tempo Real
    const pesquisaInput = document.getElementById('pesquisa-usuario');
    if (pesquisaInput) {
        pesquisaInput.addEventListener('input', (e) => {
            const termo = e.target.value.toLowerCase();
            const usuariosFiltrados = todosUsuarios.filter(user => 
                user.nome.toLowerCase().includes(termo) || 
                user.email.toLowerCase().includes(termo)
            );
            renderizarListaUsuarios(usuariosFiltrados);
        });
    }

    window.carregarPendentes();
    window.carregarInadimplentes();
    window.carregarUsuarios();
});

// --- FUNÇÕES DE USUÁRIOS E PESQUISA ---
window.carregarUsuarios = async () => {
    try {
        const res = await fetch('/api/admin/usuarios');
        const data = await res.json();
        
        if (data.sucesso) {
            todosUsuarios = data.usuarios || [];
            document.getElementById('total-usuarios').textContent = todosUsuarios.length;
            renderizarListaUsuarios(todosUsuarios);
        }
    } catch (e) {
        console.error("Erro ao carregar lista de usuários:", e);
    }
};

const renderizarListaUsuarios = (usuarios) => {
    const lista = document.getElementById('usuarios-lista');
    if (!lista) return;

    lista.innerHTML = '';
    
    if (usuarios.length === 0) {
        lista.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Nenhum usuário encontrado na pesquisa.</td></tr>';
        return;
    }

    usuarios.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.nome}</strong></td>
            <td>${user.email}</td>
            <td><span class="status-${(user.statusSocio || 'Inativo').toLowerCase()}">${user.statusSocio || 'Inativo'}</span></td>
            <td>${user.planoSocio || 'Nenhum'}</td>
            <td>
                <button class="btn-admin" style="padding: 6px 12px; font-size: 0.85em; background-color: #9b59b6; color: #fff;" onclick="alterarSenhaUsuario('${user._id}', '${user.nome}')">Redefinir Senha</button>
            </td>
        `;
        lista.appendChild(tr);
    });
};

window.alterarSenhaUsuario = async (userId, nomeUser) => {
    const novaSenha = prompt(`Digite a nova senha provisória para o usuário "${nomeUser}":`);
    if (!novaSenha) return;
    if (novaSenha.length < 4) return alert("A senha deve ter no mínimo 4 caracteres.");

    try {
        const res = await fetch('/api/admin/alterar-senha-usuario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, novaSenha })
        });
        const data = await res.json();
        alert(data.mensagem);
    } catch (e) {
        alert("Erro ao redefinir a senha do usuário.");
    }
};

// --- FUNÇÕES DOS OUTROS PAINÉIS ---
window.carregarPendentes = async () => {
    try {
        const res = await fetch('/api/admin/pedidos-pendentes');
        if (res.status === 401 || res.status === 403) { window.location.href = '/index.html'; return; }
        
        const data = await res.json();
        
        if (data.sucesso) {
            // SÓCIOS PENDENTES
            const sociosList = document.getElementById('socios-lista');
            if (sociosList) {
                sociosList.innerHTML = '';
                if (data.socios && data.socios.length === 0) {
                    sociosList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhum pedido de Sócio pendente.</td></tr>';
                } else if (data.socios) {
                    data.socios.forEach(socio => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${new Date(socio.data).toLocaleString('pt-BR')}</td>
                            <td>${socio.nomeUsuario} <br><small style="color: #888;">${socio.emailUsuario}</small></td>
                            <td><strong style="color:#9b59b6">${socio.plano}</strong></td>
                            <td style="font-size: 0.85em; word-break: break-all; max-width: 250px;">
                                <strong style="color:#3498db">${socio.metodoPagamento}</strong><br>
                                TxID: ${socio.txId}
                            </td>
                            <td><strong style="color:#d4af37">${socio.moedasReceber.toLocaleString('pt-BR')} SC</strong></td>
                            <td>
                                <button class="aprovar-btn" onclick="processarSocio('${socio._id}', 'aprovar')">Aprovar (Tornar Sócio)</button>
                                <button class="rejeitar-btn" onclick="processarSocio('${socio._id}', 'rejeitar')">Rejeitar (Falso)</button>
                            </td>
                        `;
                        sociosList.appendChild(tr);
                    });
                }
            }

            // DEPÓSITOS PENDENTES
            const depositosList = document.getElementById('depositos-lista');
            if (depositosList) {
                depositosList.innerHTML = '';
                if (data.depositos && data.depositos.length === 0) {
                    depositosList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhum depósito pendente.</td></tr>';
                } else if (data.depositos) {
                    data.depositos.forEach(dep => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${new Date(dep.data).toLocaleString('pt-BR')}</td>
                            <td>${dep.nomeUsuario} <br><small style="color: #888;">${dep.emailUsuario}</small></td>
                            <td><strong style="color:#2ecc71">${dep.rede}</strong></td>
                            <td style="font-size: 0.9em; word-break: break-all; max-width: 250px;">${dep.linkTransacao}</td>
                            <td><strong style="color:#d4af37">${dep.valor.toFixed(2)} SC</strong></td>
                            <td>
                                <button class="aprovar-btn" onclick="processarDeposito('${dep._id}', 'aprovar')">Aprovar (Creditar)</button>
                                <button class="rejeitar-btn" onclick="processarDeposito('${dep._id}', 'rejeitar')">Rejeitar (Falso)</button>
                            </td>
                        `;
                        depositosList.appendChild(tr);
                    });
                }
            }

            // SAQUES
            const saquesList = document.getElementById('saques-lista');
            if (saquesList) {
                saquesList.innerHTML = '';
                if (data.saques.length === 0) { saquesList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Nenhum saque pendente.</td></tr>';
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

            // GIFT CARDS
            const giftsList = document.getElementById('gifts-lista');
            if (giftsList) {
                giftsList.innerHTML = '';
                if (data.gifts.length === 0) { giftsList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhum pedido de Gift Card pendente.</td></tr>';
                } else {
                    data.gifts.forEach(gift => {
                        const tr = document.createElement('tr');
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

            // RECARGAS
            const rechargesList = document.getElementById('recharges-lista');
            if (rechargesList) {
                rechargesList.innerHTML = '';
                if (data.recharges.length === 0) { rechargesList.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Nenhuma recarga pendente.</td></tr>';
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
    } catch (error) { console.error("Erro ao carregar dados do painel:", error); }
};

window.carregarInadimplentes = async () => {
    try {
        const res = await fetch('/api/admin/inadimplentes');
        const data = await res.json();
        const lista = document.getElementById('inadimplentes-lista');
        if (lista) {
            lista.innerHTML = '';
            if (!data.inadimplentes || data.inadimplentes.length === 0) {
                lista.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Nenhum sócio inadimplente.</td></tr>';
            } else {
                data.inadimplentes.forEach(user => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${user.nome}</strong></td>
                        <td>${user.email}</td>
                        <td><span style="color: #e74c3c;">${user.planoSocio}</span></td>
                        <td>${new Date(user.vencimentoSocio).toLocaleDateString('pt-BR')}</td>
                        <td>
                            <button class="rejeitar-btn" onclick="cancelarSocio('${user._id}')">Cancelar Plano</button>
                        </td>
                    `;
                    lista.appendChild(tr);
                });
            }
        }
    } catch(e) { console.error("Erro ao carregar inadimplentes:", e); }
};

window.atualizarCotacao = async () => {
    const cotacao = document.getElementById('valor-cotacao').value;
    if(!cotacao || parseFloat(cotacao) <= 0) return alert("Digite um valor de cotação válido.");
    if(!confirm(`Confirma a mudança para R$ 1,00 = ${cotacao} SC no sistema todo?`)) return;

    try {
        const res = await fetch('/api/admin/atualizar-cotacao', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cotacao })
        });
        const data = await res.json();
        alert(data.mensagem);
        if(data.sucesso) document.getElementById('valor-cotacao').value = '';
    } catch(e) { alert("Erro ao atualizar a cotação."); }
};

window.cancelarSocio = async (userId) => {
    if(!confirm("Tem certeza que deseja cancelar os benefícios de Sócio deste usuário?")) return;
    try {
        const res = await fetch('/api/admin/cancelar-socio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        alert(data.mensagem);
        if(data.sucesso) { window.carregarInadimplentes(); window.carregarUsuarios(); }
    } catch(e) { alert("Erro ao cancelar o sócio."); }
};

window.processarSocio = async (id, acao) => {
    if (acao === 'aprovar' && !confirm('Verificou a transação? Ao aprovar as moedas serão debitadas de você e o plano do usuário ficará ativo por 30 dias.')) return;
    if (acao === 'rejeitar' && !confirm('Tem certeza que deseja rejeitar esse pagamento?')) return;
    
    const res = await fetch('/api/admin/processar-socio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id, acao })
    });
    const data = await res.json();
    alert(data.mensagem);
    if(data.sucesso) { window.carregarPendentes(); window.carregarUsuarios(); }
};

window.processarDeposito = async (id, acao) => {
    if (acao === 'aprovar' && !confirm('Atenção: Ao aprovar, as SolidCoins serão DEBITADAS do seu saldo de CEO e enviadas ao usuário. Confirma?')) return;
    if (acao === 'rejeitar' && !confirm('Tem certeza que a transação é inválida/falsa?')) return;
    
    const res = await fetch('/api/admin/processar-deposito', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: id, acao })
    });
    const data = await res.json();
    alert(data.mensagem);
    if(data.sucesso) window.carregarPendentes();
};

window.processarSaque = async (id, acao) => {
    if (acao === 'rejeitar' && !confirm('Tem certeza que deseja rejeitar este saque? (As moedas NÃO são devolvidas automaticamente neste caso)')) return;
    const res = await fetch('/api/admin/processar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withdrawalId: id, acao }) });
    const data = await res.json(); alert(data.mensagem); if(data.sucesso) window.carregarPendentes();
};

window.processarGiftCard = async (id, acao) => {
    let pin = '';
    if (acao === 'aprovar') {
        pin = prompt('Compra aprovada! Digite o PIN do Gift Card para enviar ao usuário:');
        if (!pin) return alert('Operação cancelada. O PIN é obrigatório para concluir o pedido.');
    } else if (!confirm('Tem certeza que deseja cancelar e devolver as SolidCoins para o usuário?')) { return; }

    const res = await fetch('/api/admin/processar-giftcard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id, acao, pin }) });
    const data = await res.json(); alert(data.mensagem); if(data.sucesso) window.carregarPendentes();
};

window.processarRecharge = async (id, acao) => {
    let nsu = '';
    if (acao === 'aprovar') {
        nsu = prompt('Recarga realizada! Digite o NSU ou ID da transação para enviar ao usuário:');
        if (!nsu) return alert('Operação cancelada. O NSU é obrigatório.');
    } else if (!confirm('Tem certeza que deseja cancelar e devolver as SolidCoins para o usuário?')) { return; }

    const res = await fetch('/api/admin/processar-recharge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rechargeId: id, acao, nsu }) });
    const data = await res.json(); alert(data.mensagem); if(data.sucesso) window.carregarPendentes();
};

window.gerarGiftCardSolidCoin = async () => {
    const valorInput = document.getElementById('valor-gerar-gift');
    const valor = valorInput ? parseFloat(valorInput.value) : 0;
    if (!valor || valor <= 0) return alert("Digite um valor válido em SolidCoins.");
    if(!confirm(`Deseja gerar um Gift Card de ${valor} SC? Isso será debitado do seu saldo de CEO.`)) return;

    try {
        const res = await fetch('/api/admin/gerar-giftcard-solidcoin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
        const data = await res.json(); alert(data.mensagem);
        if(data.sucesso && valorInput) { valorInput.value = ''; }
    } catch(e) { console.error(e); alert("Erro ao tentar gerar o código. Verifique a conexão."); }
};