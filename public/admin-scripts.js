// public/admin-scripts.js
document.addEventListener('DOMContentLoaded', () => {
    const saquesListaEl = document.getElementById('saques-pendentes-lista');

    const carregarSaquesPendentes = async () => {
        const response = await fetch('/api/admin/saques-pendentes');
        
        if (response.status === 403) { // Proibido
            document.body.innerHTML = '<h1>Acesso Negado</h1><p>Você precisa ser um administrador para ver esta página.</p>';
            return;
        }

        const data = await response.json();
        saquesListaEl.innerHTML = '';

        if (data.sucesso && data.saques.length > 0) {
            data.saques.forEach(saque => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(saque.data).toLocaleString('pt-BR');
                tr.innerHTML = `
                    <td>${dataFormatada}</td>
                    <td>${saque.nomeUsuario}<br><small>${saque.emailUsuario}</small></td>
                    <td>${saque.valor.toFixed(2)}</td>
                    <td><small>${saque.solanaWallet}</small></td>
                    <td>
                        <button class="aprovar-btn" data-id="${saque._id}">Aprovar</button>
                        <button class="rejeitar-btn" data-id="${saque._id}">Rejeitar</button>
                    </td>
                `;
                saquesListaEl.appendChild(tr);
            });
        } else {
            saquesListaEl.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma solicitação de saque pendente.</td></tr>';
        }
    };

    const processarSaque = async (id, acao) => {
        const response = await fetch('/api/admin/processar-saque', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ withdrawalId: id, acao })
        });
        const data = await response.json();
        alert(data.mensagem);
        if (data.sucesso) {
            carregarSaquesPendentes(); // Recarrega a lista
        }
    };

    saquesListaEl.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (e.target.classList.contains('aprovar-btn')) {
            if(confirm('Tem certeza que deseja APROVAR este saque? Esta ação não pode ser desfeita.')) {
                processarSaque(id, 'aprovar');
            }
        }
        if (e.target.classList.contains('rejeitar-btn')) {
             if(confirm('Tem certeza que deseja REJEITAR este saque?')) {
                processarSaque(id, 'rejeitar');
            }
        }
    });

    carregarSaquesPendentes();
});