document.addEventListener('DOMContentLoaded', () => {
    const saquesListaEl = document.getElementById('saques-pendentes-lista');
    const giftcardsListaEl = document.getElementById('giftcards-pendentes-lista');

    // --- LÓGICA DE SAQUES ---
    const carregarSaquesPendentes = async () => {
        const response = await fetch('/api/admin/saques-pendentes');
        if (response.status === 403) { document.body.innerHTML = '<h1>Acesso Negado</h1>'; return; }
        const data = await response.json();
        saquesListaEl.innerHTML = '';
        if (data.sucesso && data.saques.length > 0) {
            data.saques.forEach(saque => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(saque.data).toLocaleString('pt-BR')}<br><strong>${saque.nomeUsuario}</strong><br><small>${saque.emailUsuario}</small></td>
                    <td>${saque.valor.toFixed(2)}</td>
                    <td><small>${saque.solanaWallet}</small></td>
                    <td>
                        <button class="aprovar-btn" data-id="${saque._id}" style="margin-bottom:5px;">Aprovar</button>
                        <button class="rejeitar-btn" data-id="${saque._id}">Rejeitar</button>
                    </td>
                `;
                saquesListaEl.appendChild(tr);
            });
        } else { saquesListaEl.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum saque pendente.</td></tr>'; }
    };

    const processarSaque = async (id, acao) => {
        const response = await fetch('/api/admin/processar-saque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withdrawalId: id, acao }) });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) carregarSaquesPendentes();
    };

    saquesListaEl.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (e.target.classList.contains('aprovar-btn')) { if(confirm('APROVAR saque?')) processarSaque(id, 'aprovar'); }
        if (e.target.classList.contains('rejeitar-btn')) { if(confirm('REJEITAR saque?')) processarSaque(id, 'rejeitar'); }
    });

    // --- LÓGICA DE GIFT CARDS ---
    const carregarGiftCards = async () => {
        const response = await fetch('/api/admin/giftcards-pendentes');
        if (response.status === 403) return; // Erro ja tratado nos saques
        const data = await response.json();
        giftcardsListaEl.innerHTML = '';

        if (data.sucesso && data.pedidos.length > 0) {
            data.pedidos.forEach(pedido => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(pedido.data).toLocaleString('pt-BR')}<br><strong>${pedido.nomeUsuario}</strong><br><small>${pedido.emailUsuario}</small></td>
                    <td style="color:#e67e22;"><strong>${pedido.tipo}</strong><br>R$ ${pedido.valorBRL.toFixed(2)}</td>
                    <td>${pedido.custoSolidCoin.toFixed(0)} SC</td>
                    <td style="display:flex; flex-direction:column; gap:5px;">
                        <input type="text" id="pin-${pedido._id}" placeholder="Cole o PIN aqui" style="padding:8px; width:100%; border:1px solid #ccc;">
                        <div style="display:flex; gap:5px;">
                            <button class="aprovar-btn enviar-pin-btn" data-id="${pedido._id}" style="width:50%; background-color:#e67e22!important;">Enviar PIN</button>
                            <button class="rejeitar-btn rejeitar-gf-btn" data-id="${pedido._id}" style="width:50%;">Cancelar & Reembolsar</button>
                        </div>
                    </td>
                `;
                giftcardsListaEl.appendChild(tr);
            });
        } else { giftcardsListaEl.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum pedido pendente.</td></tr>'; }
    };

    const processarGiftCard = async (orderId, acao, pin = '') => {
        const response = await fetch('/api/admin/processar-giftcard', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, acao, pin })
        });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) carregarGiftCards();
    };

    giftcardsListaEl.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (e.target.classList.contains('enviar-pin-btn')) {
            const pin = document.getElementById(`pin-${id}`).value;
            if (!pin || pin.trim() === '') return alert('Cole o PIN do Gift Card no campo antes de clicar em Enviar!');
            if(confirm(`Enviar o PIN: "${pin}" para o usuário?`)) processarGiftCard(id, 'enviar_pin', pin);
        }
        if (e.target.classList.contains('rejeitar-gf-btn')) {
            if(confirm('Tem certeza que deseja cancelar o pedido e devolver os SC para o usuário?')) processarGiftCard(id, 'rejeitar');
        }
    });

    carregarSaquesPendentes();
    carregarGiftCards();
});