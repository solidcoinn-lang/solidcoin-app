const express = require('express');
const router = express.Router();

// Importação dos serviços de PIX (Efí) e Banco de Dados
const { gerarPixEfi, enviarPixAutomaticoEfi } = require('../services/efiService');
const db = require('../services/dbService');

// Constantes globais do sistema
const COTACAO_SC = 500; // 500 SC = R$ 1,00
const LIMITE_MAXIMO_COTAS = 1000;

// Middleware de verificação de permissão de Administrador (CEO)
const checkAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso negado. Apenas administradores.' });
    }
    next();
};

// Estrutura em memória dos Ativos (Pode ser integrado diretamente à base de dados)
let ativos = [
    {
        id: 'gare11',
        simbolo: 'GARE11',
        nome: 'Gare Properties FII',
        tipo: 'FII',
        precoBrl: 8.38,
        ativo: true
    }
];

// =======================================================
// ROTAS PÚBLICAS / UTILIZADOR AUTENTICADO
// =======================================================

// 1. OBTER ATIVOS E CARTEIRA DO UTILIZADOR
router.get('/ativos', async (req, res) => {
    try {
        const userId = req.user.id;
        const userCarteira = (await db.getUserCarteira(userId)) || {};

        res.json({
            sucesso: true,
            cotacaoSC: COTACAO_SC,
            ativos: ativos.map(a => ({
                ...a,
                minhasCotas: userCarteira[a.simbolo] || 0
            }))
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// 2. COMPRAR COTAS / AÇÕES
router.post('/comprar', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaPagamento } = req.body;
        const userId = req.user.id;
        const qtd = parseInt(quantidade, 10);

        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = ativos.find(a => a.simbolo === simboloAtivo?.toUpperCase() && a.ativo);
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado ou inativo.' });
        }

        // Validação do Limite Máximo por utilizador
        const cotasAtuais = (await db.getUserCotas(userId, ativo.simbolo)) || 0;
        if (cotasAtuais + qtd > LIMITE_MAXIMO_COTAS) {
            return res.status(400).json({
                sucesso: false,
                mensagem: `Limite excedido! Cada utilizador pode ter no máximo ${LIMITE_MAXIMO_COTAS} cotas. Já possui ${cotasAtuais}.`
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
                mensagem: `Compra de ${qtd} cotas de ${ativo.simbolo} realizada com sucesso usando SolidCoins!`
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
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// 3. VENDER COTAS / AÇÕES
router.post('/vender', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaRecebimento, chavePix } = req.body;
        const userId = req.user.id;
        const qtd = parseInt(quantidade, 10);

        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = ativos.find(a => a.simbolo === simboloAtivo?.toUpperCase());
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
                return res.status(400).json({ sucesso: false, mensagem: 'Liquidez temporariamente indisponível no fundo do CEO.' });
            }

            await db.subtrairSaldoCEO(valorTotalSC);
            await db.adicionarSaldoUser(userId, valorTotalSC);
            await db.subtrairCotasUser(userId, ativo.simbolo, qtd);

            return res.json({
                sucesso: true,
                mensagem: `Venda concluída! ${valorTotalSC.toFixed(2)} SC creditados na sua conta.`
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
                    mensagem: `Venda concluída! R$ ${valorTotalBrl.toFixed(2)} enviados para o seu Pix.`
                });
            } else {
                return res.status(500).json({ sucesso: false, mensagem: 'Falha no envio automático do Pix. Tente novamente.' });
            }
        } else {
            return res.status(400).json({ sucesso: false, mensagem: 'Forma de recebimento inválida.' });
        }
    } catch (err) {
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
            return res.status(400).json({ sucesso: false, mensagem: "Operação inválida. Use 'adicionar' ou 'retirar'." });
        }

        res.json({ sucesso: true, mensagem: `Cotas de ${simboloUpper} ajustadas com sucesso para o utilizador ${targetUserId}.` });
    } catch (err) {
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

        const ativo = ativos.find(a => a.simbolo === simboloAtivo.toUpperCase());
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });
        }

        ativo.precoBrl = preco;
        res.json({ sucesso: true, mensagem: `Preço de ${ativo.simbolo} atualizado para R$ ${preco.toFixed(2)}` });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// ADICIONAR NOVO ATIVO (FII OU AÇÃO)
router.post('/admin/novo-ativo', checkAdmin, async (req, res) => {
    try {
        const { simbolo, nome, tipo, precoBrl } = req.body;
        const preco = parseFloat(precoBrl);

        if (!simbolo || !nome || !tipo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Dados cadastrais do ativo incompletos ou inválidos.' });
        }

        const simboloUpper = simbolo.toUpperCase();
        if (ativos.some(a => a.simbolo === simboloUpper)) {
            return res.status(400).json({ sucesso: false, mensagem: 'Ativo já cadastrado.' });
        }

        const novoAtivo = {
            id: simbolo.toLowerCase(),
            simbolo: simboloUpper,
            nome,
            tipo: tipo.toUpperCase(),
            precoBrl: preco,
            ativo: true
        };

        ativos.push(novoAtivo);
        res.json({ sucesso: true, mensagem: 'Novo ativo cadastrado com sucesso!', ativo: novoAtivo });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// PAGAR DIVIDENDOS
router.post('/admin/pagar-dividendos', checkAdmin, async (req, res) => {
    try {
        const { simboloAtivo, valorPorCotaBrl } = req.body;
        const valorPorCota = parseFloat(valorPorCotaBrl);

        if (!simboloAtivo || isNaN(valorPorCota) || valorPorCota <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Símbolo ou valor por cota inválido.' });
        }

        const simboloUpper = simboloAtivo.toUpperCase();
        await db.distribuirDividendos(simboloUpper, valorPorCota);

        res.json({ sucesso: true, mensagem: `Dividendos de R$ ${valorPorCota.toFixed(2)} por cota distribuídos para ${simboloUpper}!` });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

module.exports = router;