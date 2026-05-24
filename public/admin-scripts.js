const carregarPendentes = async () => {
        const res = await fetch('/api/admin/pedidos-pendentes');
        const data = await res.json();
        
        // 1. CARREGAR SAQUES... (mantenha sua lógica de saques aqui)
        
        // 2. CARREGAR GIFT CARDS... (mantenha a lógica de gifts aqui)
        
        // 3. CARREGAR RECARGAS
        const rechargesList = document.getElementById('recharges-lista'); // <--- CRIE ESSA TABELA NO ADMIN.HTML IGUAL A DO GIFT CARD
        if (rechargesList) {
            rechargesList.innerHTML = '';
            data.recharges.forEach(rec => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(rec.data).toLocaleString('pt-BR')}</td>
                    <td>${rec.nomeUsuario} (${rec.emailUsuario})</td>
                    <td><strong style="color:#2980b9">${rec.operadora}</strong></td>
                    <td>${rec.numeroCelular}</td>
                    <td>R$ ${rec.valorReais.toFixed(2)}</td>
                    <td>
                        <button class="aprovar-btn" onclick="processarRecharge('${rec._id}', 'aprovar')">Aprovar (Enviar NSU)</button>
                        <button class="rejeitar-btn" onclick="processarRecharge('${rec._id}', 'rejeitar')">Cancelar & Reembolsar</button>
                    </td>
                `;
                rechargesList.appendChild(tr);
            });
        }
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
        if(data.sucesso) carregarPendentes();
    };