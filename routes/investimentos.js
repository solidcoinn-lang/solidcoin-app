const express = require('express');
const router = express.Router();

// Importação dos serviços de PIX (Efí) e Banco de Dados
const { gerarPixEfi, enviarPixAutomaticoEfi } = require('../services/efiService');
const db = require('../services/dbService');

// Constantes globais do sistema
const COTACAO_SC = 500; // 500 SC = R$ 1,00
const LIMITE_MAXIMO_COTAS = 1000;

// Função auxiliar robusta para obter o ID do utilizador (suporta req.user ou req.session.user)
const getUserId = (req) => {
    return req.user?.id || req.user?._id || req.session?.user?.id || req.session?.user?._id || req.session?.userId || null;
};

// Middleware de verificação de permissão de Administrador (CEO)
const checkAdmin = (req, res, next) => {
    const userId = getUserId(req);
    const isAdmin = req.user?.isAdmin || req.session?.user?.isAdmin;
    if (!isAdmin && !userId) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso negado. Apenas administradores.' });
    }
    next();
};

// =======================================================
// ROTAS PÚBLICAS / UTILIZADOR AUTENTICADO
// =======================================================

// 1. OBTER ATIVOS E CARTEIRA DO UTILIZADOR
router.get('/ativos', async (req, res) => {
    try {
        const userId = getUserId(req);
        
        let ativosDoBanco = [];
        try {
            ativosDoBanco = (await db.listarAtivos()) || [];
        } catch (dbErr) {
            console.error("Aviso ao listar ativos:", dbErr.message);
            ativosDoBanco = [];
        }
        
        let userCarteira = {};
        if (userId) {
            try {
                userCarteira = (await db.getUserCarteira(userId)) || {};
            } catch (carteiraErr) {
                console.error("Aviso ao buscar carteira do utilizador:", carteiraErr.message);
                userCarteira = {};
            }
        }

        res.json({
            sucesso: true,
            cotacaoSC: COTACAO_SC,
            ativos: ativosDoBanco.map(a => ({
                id: a.id || a.simbolo?.toLowerCase() || '',
                simbolo: a.simbolo || '',
                nome: a.nome || '',
                tipo: a.tipo || '',
                precoBrl: a.precoBrl || 0,
                ativo: a.ativo !== undefined ? a.ativo : true,
                minhasCotas: userCarteira[a.simbolo] || 0
            }))
        });
    } catch (err) {
        console.error("Erro crítico na rota /ativos:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// 2. COMPRAR COTAS / AÇÕES
router.post('/comprar', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaPagamento } = req.body;
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });
        }

        const qtd = parseInt(quantidade, 10);

        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = await db.buscarAtivoPorSimbolo(simboloAtivo);
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado ou inativo.' });
        }

        const cotasAtuais = (await db.getUserCotas(userId, ativo.simbolo)) || 0;
        if (cotasAtuais + qtd > LIMITE_MAXIMO_COTAS) {
            return res.status(400).json({
                sucesso: false,
                mensagem: `Limite excedido! Cada utilizador pode ter no máximo ${LIMITE_MAXIMO_COTAS} cotas.`
            });
        }

        const valorTotalBrl = ativo.precoBrl * qtd;
        const valorTotalSC = valorTotalBrl * COTACAO_SC;

        if (formaPagamento === 'solidcoin') {
            const userSaldo = await db.getUserSaldo(userId);
            if (userSaldo < valorTotalSC) {
                return res.status(400).json({ sucesso: false, mensagem: 'Saldo insuficiente em SolidCoins.' });
            }

            await db.subtrairSaldoUser(userId, valorTotalSC);
            await db.adicionarSaldoCEO(valorTotalSC);
            await db.adicionarCotasUser(userId, ativo.simbolo, qtd);

            return res.json({
                sucesso: true,
                mensagem: `Compra de ${qtd} cotas de ${ativo.simbolo} realizada com sucesso!`
            });

        } else if (formaPagamento === 'pix') {
            const qrcodePix = await gerarPixEfi({
                valor: valorTotalBrl,
                descricao: `Compra ${qtd}x ${ativo.simbolo}`,
                customId: `COMPRA_COTA_${userId}_${ativo.simbolo}_${qtd}`
            });

            return res.json({
                sucesso: true,
                requerPix: true,
                qrcodePix: qrcodePix.imagem,
                copiaECola: qrcodePix.copiaECola
            });
        } else {
            return res.status(400).json({ sucesso: false, mensagem: 'Forma de pagamento inválida.' });
        }
    } catch (err) {
        console.error("Erro na rota /comprar:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// 3. VENDER COTAS / AÇÕES
router.post('/vender', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaRecebimento, chavePix } = req.body;
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });
        }

        const qtd = parseInt(quantidade, 10);

        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = await db.buscarAtivoPorSimbolo(simboloAtivo);
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });
        }

        const cotasAtuais = (await db.getUserCotas(userId, ativo.simbolo)) || 0;
        if (qtd > cotasAtuais) {
            return res.status(400).json({ sucesso: false, mensagem: 'Não possui cotas suficientes para vender.' });
        }

        const valorTotalBrl = ativo.precoBrl * qtd;
        const valorTotalSC = valorTotalBrl * COTACAO_SC;

        if (formaRecebimento === 'solidcoin') {
            const saldoCEO = await db.getSaldoCEO();
            if (saldoCEO < valorTotalSC) {
                return res.status(400).json({ sucesso: false, mensagem: 'Liquidez temporariamente indisponível.' });
            }

            await db.subtrairSaldoCEO(valorTotalSC);
            await db.adicionarSaldoUser(userId, valorTotalSC);
            await db.subtrairCotasUser(userId, ativo.simbolo, qtd);

            return res.json({
                sucesso: true,
                mensagem: `Venda concluída! ${valorTotalSC.toFixed(2)} SC creditados.`
            });

        } else if (formaRecebimento === 'pix') {
            if (!chavePix) {
                return res.status(400).json({ sucesso: false, mensagem: 'Chave Pix é obrigatória.' });
            }

            const pixRes = await enviarPixAutomaticoEfi({
                valor: valorTotalBrl,
                chavePix: chavePix,
                descricao: `Venda ${qtd}x ${ativo.simbolo}`
            });

            if (pixRes && pixRes.sucesso) {
                await db.subtrairCotasUser(userId, ativo.simbolo, qtd);
                return res.json({
                    sucesso: true,
                    mensagem: `Venda concluída! R$ ${valorTotalBrl.toFixed(2)} enviados via Pix.`
                });
            } else {
                return res.status(500).json({ sucesso: false, mensagem: 'Falha no envio automático do Pix.' });
            }
        } else {
            return res.status(400).json({ sucesso: false, mensagem: 'Forma de recebimento inválida.' });
        }
    } catch (err) {
        console.error("Erro na rota /vender:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// =======================================================
// ROTAS DO PAINEL ADM (EXCLUSIVO CEO)
// =======================================================

// ADICIONAR / RETIRAR COTAS MANUALMENTE
router.post('/admin/ajustar-cotas', checkAdmin, async (req, res) => {
    try {
        const { targetUserId, simboloAtivo, quantidade, operacao } = req.body;
        const qtd = parseInt(quantidade, 10);

        if (!targetUserId || !simboloAtivo || !qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos ou inválidos.' });
        }

        const simboloUpper = simboloAtivo.toUpperCase();

        if (operacao === 'adicionar') {
            await db.adicionarCotasUser(targetUserId, simboloUpper, qtd);
        } else if (operacao === 'retirar') {
            await db.subtrairCotasUser(targetUserId, simboloUpper, qtd);
        } else {
            return res.status(400).json({ sucesso: false, mensagem: "Operação inválida." });
        }

        res.json({ sucesso: true, mensagem: `Cotas ajustadas com sucesso.` });
    } catch (err) {
        console.error("Erro no ajuste de cotas:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// ATUALIZAR PREÇO DO ATIVO
router.post('/admin/atualizar-preco', checkAdmin, async (req, res) => {
    try {
        const { simboloAtivo, novoPrecoBrl } = req.body;
        const preco = parseFloat(novoPrecoBrl);

        if (!simboloAtivo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Símbolo ou preço inválido.' });
        }

        const ativoAtualizado = await db.atualizarPrecoAtivo(simboloAtivo, preco);
        if (!ativoAtualizado) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });
        }

        res.json({ sucesso: true, mensagem: `Preço atualizado com sucesso!` });
    } catch (err) {
        console.error("Erro ao atualizar preço:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// ADICIONAR NOVO ATIVO (FII OU AÇÃO)
router.post('/admin/novo-ativo', checkAdmin, async (req, res) => {
    try {
        const { simbolo, nome, tipo, precoBrl } = req.body;
        const preco = parseFloat(precoBrl);

        if (!simbolo || !nome || !tipo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Preencha todos os campos corretamente.' });
        }

        const simboloUpper = simbolo.toUpperCase();
        const ativoExistente = await db.buscarAtivoPorSimbolo(simboloUpper);
        if (ativoExistente) {
            return res.status(400).json({ sucesso: false, mensagem: 'Ativo já cadastrado.' });
        }

        const novoAtivo = await db.adicionarAtivo({
            id: simbolo.toLowerCase(),
            simbolo: simboloUpper,
            nome,
            tipo: tipo.toUpperCase(),
            precoBrl: preco,
            ativo: true
        });

        res.json({ sucesso: true, mensagem: 'Novo ativo cadastrado com sucesso!', ativo: novoAtivo });
    } catch (err) {
        console.error("Erro ao adicionar novo ativo:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// PAGAR DIVIDENDOS
router.post('/admin/pagar-dividendos', checkAdmin, async (req, res) => {
    try {
        const { simboloAtivo, valorPorCotaBrl } = req.body;
        const valorPorCota = parseFloat(valorPorCotaBrl);

        if (!simboloAtivo || isNaN(valorPorCota) || valorPorCota <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Valor inválido.' });
        }

        const simboloUpper = simboloAtivo.toUpperCase();
        await db.distribuirDividendos(simboloUpper, valorPorCota);

        res.json({ sucesso: true, mensagem: `Dividendos distribuídos com sucesso!` });
    } catch (err) {
        console.error("Erro ao pagar dividendos:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

module.exports = router;