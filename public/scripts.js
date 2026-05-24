// --- LÓGICA DE GIFT CARDS ---
    const giftTipoSelect = document.getElementById('gift-tipo');
    const giftValorInput = document.getElementById('gift-valor');
    const giftCustoSpan = document.getElementById('gift-custo');
    const giftcardForm = document.getElementById('giftcard-form');

    // Atualiza limites e custo do Gift Card
    const atualizarGift = () => {
        const tipo = giftTipoSelect.value;
        if(tipo === 'Shopee') { giftValorInput.min = 30; giftValorInput.placeholder = "Valor em R$ (Mín 30, Máx 300)"; } 
        else { giftValorInput.min = 15; giftValorInput.placeholder = "Valor em R$ (Mín 15, Máx 300)"; }
        
        const v = parseFloat(giftValorInput.value) || 0;
        giftCustoSpan.textContent = (v * 500).toLocaleString('pt-BR');
    };
    giftTipoSelect.addEventListener('change', atualizarGift);
    giftValorInput.addEventListener('input', atualizarGift);
    atualizarGift();

    giftcardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tipo = giftTipoSelect.value;
        const valorReais = giftValorInput.value;
        if (!confirm(`Confirmar a compra de Gift Card ${tipo} de R$ ${valorReais} por ${valorReais * 500} SC?`)) return;
        const res = await fetch('/api/giftcard/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({tipo, valorReais}) });
        const data = await res.json();
        alert(data.mensagem);
        if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); giftcardForm.reset(); atualizarGift(); }
    });

    // --- LÓGICA DE RECARGAS DE CELULAR ---
    const rechargeOperadora = document.getElementById('recharge-operadora');
    const rechargeValor = document.getElementById('recharge-valor');
    const rechargeCusto = document.getElementById('recharge-custo');
    const rechargeForm = document.getElementById('recharge-form');

    const valoresOperadoras = {
        Claro: [15, 20, 25, 30, 35, 40, 50, 100],
        Vivo: [10, 12, 15, 20, 25, 30],
        Tim: [15, 20, 30, 50, 100]
    };

    const atualizarValoresRecarga = () => {
        const op = rechargeOperadora.value;
        rechargeValor.innerHTML = ''; // limpa options
        valoresOperadoras[op].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = `R$ ${val.toFixed(2)}`;
            rechargeValor.appendChild(opt);
        });
        atualizarCustoRecarga();
    };

    const atualizarCustoRecarga = () => {
        const v = parseFloat(rechargeValor.value) || 0;
        rechargeCusto.textContent = (v * 500).toLocaleString('pt-BR');
    };

    rechargeOperadora.addEventListener('change', atualizarValoresRecarga);
    rechargeValor.addEventListener('change', atualizarCustoRecarga);
    atualizarValoresRecarga(); // Inicia com a primeira operadora

    rechargeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const operadora = rechargeOperadora.value;
        const valorReais = rechargeValor.value;
        const numeroCelular = document.getElementById('recharge-celular').value;

        if (!confirm(`Confirmar recarga ${operadora} de R$ ${valorReais} para o número ${numeroCelular}?`)) return;
        
        const res = await fetch('/api/recharge/comprar', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({operadora, valorReais, numeroCelular}) });
        const data = await res.json();
        alert(data.mensagem);
        if(data.sucesso){ atualizarSaldo(data.novoSaldo); carregarExtrato(); rechargeForm.reset(); atualizarValoresRecarga(); }
    });