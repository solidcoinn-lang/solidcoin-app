const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Importação dos modelos Mongoose e serviços de PIX
const User = mongoose.models.User || mongoose.model('User');
const { gerarPixEfi, enviarPixAutomaticoEfi } = require('../services/efiService');

// Definição do Schema de Ativos (FIIs e Ações) diretamente no módulo
const AtivoSchema = new mongoose.Schema({
    simbolo: { type: String, required: true, unique: true, uppercase: true },
    nome: { type: String, required: true },
    tipo: { type: String, required: true, uppercase: true },
    precoBrl: { type: Number, required: true, default: 0 },
    ativo: { type: Boolean, default: true }
});
const Ativo = mongoose.models.Ativo || mongoose.model('Ativo', AtivoSchema);

// Constantes globais do sistema
const COTACAO_SC = 500; // 500 SC = R$ 1,00
const LIMITE_MAXIMO_COTAS = 1000;

// Função auxiliar para obter o ID do utilizador com segurança
const getUserId = (req) => {
    return req.user?.id || req.user?._id || req.session?.user?.id || req.session?.user?._id || req.session?.userId || null;
};

// Middleware de verificação de permissão de Administrador (CEO)
const checkAdmin = (req, res, next) => {
    const isAdmin = req.user?.isAdmin || req.session?.user?.isAdmin;
    if (!isAdmin) {
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
        const ativosDoBanco = await Ativo.find({ ativo: true }) || [];
        
        let userCarteira = {};
        if (userId) {
            const user = await User.findById(userId);
            if (user && user.carteiraInvestimentos) {
                userCarteira = user.carteiraInvestimentos;
            }
        }

        res.json({
            sucesso: true,
            cotacaoSC: COTACAO_SC,
            ativos: ativosDoBanco.map(a => ({
                id: a._id.toString(),
                simbolo: a.simbolo,
                nome: a.nome,
                tipo: a.tipo,
                precoBrl: a.precoBrl,
                ativo: a.ativo,
                minhasCotas: userCarteira[a.simbolo] || 0
            }))
        });
    } catch (err) {
        console.error("Erro na rota /ativos:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// 2. COMPRAR COTAS / AÇÕES
router.post('/comprar', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaPagamento } = req.body;
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase(), ativo: true });
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado ou inativo.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador não encontrado.' });

        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (cotasAtuais + qtd > LIMITE_MAXIMO_COTAS) {
            return res.status(400).json({
                sucesso: false,
                mensagem: `Limite excedido! Cada utilizador pode ter no máximo ${LIMITE_MAXIMO_COTAS} cotas.`
            });
        }

        const valorTotalBrl = ativo.precoBrl * qtd;
        const valorTotalSC = valorTotalBrl * COTACAO_SC;

        if (formaPagamento === 'solidcoin') {
            if ((user.saldo || 0) < valorTotalSC) {
                return res.status(400).json({ sucesso: false, mensagem: 'Saldo insuficiente em SolidCoins.' });
            }

            user.saldo -= valorTotalSC;
            user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais + qtd;
            user.markModified('carteiraInvestimentos');
            await user.save();

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
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase() });
        if (!ativo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador não encontrado.' });

        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (qtd > cotasAtuais) {
            return res.status(400).json({ sucesso: false, mensagem: 'Não possui cotas suficientes para vender.' });
        }

        const valorTotalBrl = ativo.precoBrl * qtd;
        const valorTotalSC = valorTotalBrl * COTACAO_SC;

        if (formaRecebimento === 'solidcoin') {
            user.saldo = (user.saldo || 0) + valorTotalSC;
            user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais - qtd;
            user.markModified('carteiraInvestimentos');
            await user.save();

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
                user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais - qtd;
                user.markModified('carteiraInvestimentos');
                await user.save();

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
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador alvo não encontrado.' });

        if (!targetUser.carteiraInvestimentos) targetUser.carteiraInvestimentos = {};
        const atual = targetUser.carteiraInvestimentos[simboloUpper] || 0;

        if (operacao === 'adicionar') {
            targetUser.carteiraInvestimentos[simboloUpper] = atual + qtd;
        } else if (operacao === 'retirar') {
            targetUser.carteiraInvestimentos[simboloUpper] = Math.max(0, atual - qtd);
        } else {
            return res.status(400).json({ sucesso: false, mensagem: "Operação inválida." });
        }

        targetUser.markModified('carteiraInvestimentos');
        await targetUser.save();

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

        const ativo = await Ativo.findOneAndUpdate(
            { simbolo: simboloAtivo.toUpperCase() },
            { precoBrl: preco },
            { new: true }
        );

        if (!ativo) {
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
        let ativo = await Ativo.findOne({ simbolo: simboloUpper });
        if (ativo) {
            return res.status(400).json({ sucesso: false, mensagem: 'Ativo já cadastrado.' });
        }

        ativo = new Ativo({
            simbolo: simboloUpper,
            nome,
            tipo: tipo.toUpperCase(),
            precoBrl: preco,
            ativo: true
        });
        await ativo.save();

        res.json({ sucesso: true, mensagem: 'Novo ativo cadastrado com sucesso!', ativo });
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
        const valorPorCotaSC = valorPorCota * COTACAO_SC;

        const users = await User.find({ [`carteiraInvestimentos.${simboloUpper}`]: { $gt: 0 } });

        for (const u of users) {
            const cotas = u.carteiraInvestimentos[simboloUpper] || 0;
            if (cotas > 0) {
                const totalDividendoSC = cotas * valorPorCotaSC;
                u.saldo = (u.saldo || 0) + totalDividendoSC;
                await u.save();
            }
        }

        res.json({ sucesso: true, mensagem: `Dividendos distribuídos com sucesso para ${users.length} utilizadores!` });
    } catch (err) {
        console.error("Erro ao pagar dividendos:", err);
        res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

module.exports = router;