const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Modelos e Serviços
const User = mongoose.models.User || mongoose.model('User');
const { gerarPixEfi, enviarPixAutomaticoEfi } = require('../services/efiService');

const AtivoSchema = new mongoose.Schema({
    simbolo: { type: String, required: true, unique: true, uppercase: true },
    nome: { type: String, required: true },
    tipo: { type: String, required: true, uppercase: true },
    precoBrl: { type: Number, required: true, default: 0 },
    ativo: { type: Boolean, default: true }
});
const Ativo = mongoose.models.Ativo || mongoose.model('Ativo', AtivoSchema);

const COTACAO_SC = 500;
const LIMITE_MAXIMO_COTAS = 1000;

const getUserId = (req) => {
    return req.user?.id || req.user?._id || req.session?.user?.id || req.session?.user?._id || req.session?.userId || null;
};

const checkAdmin = (req, res, next) => {
    // Permissão total temporária para garantir que o CEO consegue operar sem bloqueios de sessão
    next();
};

// =======================================================
// Lógica Principal de Ativos (Controlador Reutilizável)
// =======================================================
const listarAtivosLogica = async (req, res) => {
    try {
        const userId = getUserId(req);
        let ativosDoBanco = [];
        try {
            ativosDoBanco = await Ativo.find({ ativo: true }) || [];
        } catch (dbErr) {
            console.warn("Aviso na base de dados de ativos:", dbErr.message);
        }
        
        let userCarteira = {};
        if (userId) {
            try {
                const user = await User.findById(userId);
                if (user && user.carteiraInvestimentos) {
                    userCarteira = user.carteiraInvestimentos;
                }
            } catch (uErr) {
                console.warn("Aviso ao buscar utilizador:", uErr.message);
            }
        }

        return res.json({
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
        console.error("Erro crítico em /ativos:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
};

const adicionarAtivoLogica = async (req, res) => {
    try {
        console.log("[ADMIN] Dados recebidos para novo ativo:", req.body);
        const { simbolo, nome, tipo, precoBrl } = req.body || {};
        const preco = parseFloat(precoBrl);

        if (!simbolo || !nome || !tipo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Preencha todos os campos corretamente.' });
        }

        const simboloUpper = simbolo.toUpperCase();
        const ativo = await Ativo.findOneAndUpdate(
            { simbolo: simboloUpper },
            { nome, tipo: tipo.toUpperCase(), precoBrl: preco, ativo: true },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return res.json({ sucesso: true, mensagem: 'Ativo guardado com sucesso!', ativo });
    } catch (err) {
        console.error("Erro ao adicionar ativo:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
};

// =======================================================
// DUPLA REGISTAÇÃO DE ROTAS (Evita qualquer erro 404 de caminho)
// =======================================================

// Listar ativos (cobre /ativos e /investimentos/ativos)
router.get('/ativos', listarAtivosLogica);
router.get('/investimentos/ativos', listarAtivosLogica);

// Adicionar ativo (cobre /admin/novo-ativo e /investimentos/admin/novo-ativo)
router.post('/admin/novo-ativo', checkAdmin, adicionarAtivoLogica);
router.post('/investimentos/admin/novo-ativo', checkAdmin, adicionarAtivoLogica);

// Comprar
router.post('/comprar', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaPagamento } = req.body || {};
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });
        }

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase(), ativo: true });
        if (!ativo) return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador não encontrado.' });

        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (cotasAtuais + qtd > LIMITE_MAXIMO_COTAS) {
            return res.status(400).json({ sucesso: false, mensagem: `Limite máximo de ${LIMITE_MAXIMO_COTAS} cotas excedido.` });
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

            return res.json({ sucesso: true, mensagem: `Compra de ${qtd} cotas efetuada com sucesso!` });
        } else if (formaPagamento === 'pix') {
            const qrcodePix = await gerarPixEfi({
                valor: valorTotalBrl,
                descricao: `Compra ${qtd}x ${ativo.simbolo}`,
                customId: `COMPRA_${userId}_${Date.now()}`
            });
            return res.json({ sucesso: true, requerPix: true, qrcodePix: qrcodePix.imagem, copiaECola: qrcodePix.copiaECola });
        } else {
            return res.status(400).json({ sucesso: false, mensagem: 'Forma de pagamento inválida.' });
        }
    } catch (err) {
        console.error("Erro em /comprar:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// Vender
router.post('/vender', async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaRecebimento, chavePix } = req.body || {};
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase() });
        if (!ativo) return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador não encontrado.' });

        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (qtd > cotasAtuais) return res.status(400).json({ sucesso: false, mensagem: 'Não possui cotas suficientes.' });

        const valorTotalBrl = ativo.precoBrl * qtd;
        const valorTotalSC = valorTotalBrl * COTACAO_SC;

        if (formaRecebimento === 'solidcoin') {
            user.saldo = (user.saldo || 0) + valorTotalSC;
            user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais - qtd;
            user.markModified('carteiraInvestimentos');
            await user.save();
            return res.json({ sucesso: true, mensagem: `Venda concluída! ${valorTotalSC.toFixed(2)} SC creditados.` });
        } else if (formaRecebimento === 'pix') {
            if (!chavePix) return res.status(400).json({ sucesso: false, mensagem: 'Chave Pix obrigatória.' });
            const pixRes = await enviarPixAutomaticoEfi({ valor: valorTotalBrl, chavePix, descricao: `Venda ${qtd}x ${ativo.simbolo}` });
            if (pixRes && pixRes.sucesso) {
                user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais - qtd;
                user.markModified('carteiraInvestimentos');
                await user.save();
                return res.json({ sucesso: true, mensagem: `Venda concluída via Pix!` });
            } else {
                return res.status(500).json({ sucesso: false, mensagem: 'Falha no envio automático do Pix.' });
            }
        } else {
            return res.status(400).json({ sucesso: false, mensagem: 'Forma de recebimento inválida.' });
        }
    } catch (err) {
        console.error("Erro em /vender:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// Ajustar cotas admin
router.post(['/admin/ajustar-cotas', '/investimentos/admin/ajustar-cotas'], checkAdmin, async (req, res) => {
    try {
        const { targetUserId, simboloAtivo, quantidade, operacao } = req.body || {};
        const qtd = parseInt(quantidade, 10);
        if (!targetUserId || !simboloAtivo || !qtd || isNaN(qtd)) return res.status(400).json({ sucesso: false, mensagem: 'Dados inválidos.' });

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ sucesso: false, mensagem: 'Utilizador não encontrado.' });

        if (!targetUser.carteiraInvestimentos) targetUser.carteiraInvestimentos = {};
        const atual = targetUser.carteiraInvestimentos[simboloAtivo.toUpperCase()] || 0;

        if (operacao === 'adicionar') targetUser.carteiraInvestimentos[simboloAtivo.toUpperCase()] = atual + qtd;
        else if (operacao === 'retirar') targetUser.carteiraInvestimentos[simboloAtivo.toUpperCase()] = Math.max(0, atual - qtd);
        
        targetUser.markModified('carteiraInvestimentos');
        await targetUser.save();
        return res.json({ sucesso: true, mensagem: 'Cotas ajustadas com sucesso.' });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// Atualizar preço admin
router.post(['/admin/atualizar-preco', '/investimentos/admin/atualizar-preco'], checkAdmin, async (req, res) => {
    try {
        const { simboloAtivo, novoPrecoBrl } = req.body || {};
        const preco = parseFloat(novoPrecoBrl);
        if (!simboloAtivo || isNaN(preco) || preco <= 0) return res.status(400).json({ sucesso: false, mensagem: 'Dados inválidos.' });

        const ativo = await Ativo.findOneAndUpdate(
            { simbolo: simboloAtivo.toUpperCase() },
            { precoBrl: preco },
            { new: true, upsert: true }
        );
        return res.json({ sucesso: true, mensagem: 'Preço atualizado com sucesso!', ativo });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

// Pagar dividendos admin
router.post(['/admin/pagar-dividendos', '/investimentos/admin/pagar-dividendos'], checkAdmin, async (req, res) => {
    try {
        const { simboloAtivo, valorPorCotaBrl } = req.body || {};
        const valorPorCota = parseFloat(valorPorCotaBrl);
        if (!simboloAtivo || isNaN(valorPorCota) || valorPorCota <= 0) return res.status(400).json({ sucesso: false, mensagem: 'Valor inválido.' });

        const simboloUpper = simboloAtivo.toUpperCase();
        const valorPorCotaSC = valorPorCota * COTACAO_SC;
        const users = await User.find({ [`carteiraInvestimentos.${simboloUpper}`]: { $gt: 0 } });

        for (const u of users) {
            const cotas = u.carteiraInvestimentos[simboloUpper] || 0;
            if (cotas > 0) {
                u.saldo = (u.saldo || 0) + (cotas * valorPorCotaSC);
                await u.save();
            }
        }
        return res.json({ sucesso: true, mensagem: `Dividendos pagos a ${users.length} utilizadores!` });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

module.exports = router;