const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Importação dos modelos Mongoose e serviços
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

const COTACAO_SC = 500; // 500 SC = R$ 1,00
const LIMITE_MAXIMO_COTAS = 1000;

const getUserId = (req) => {
    return req.user?.id || req.user?._id || req.session?.user?.id || req.session?.user?._id || req.session?.userId || null;
};

// =======================================================
// LÓGICA DE CONTROLADORES (À Prova de Falhas)
// =======================================================

const listarAtivosLogica = async (req, res) => {
    try {
        const userId = getUserId(req);
        let ativosDoBanco = [];
        
        try {
            ativosDoBanco = await Ativo.find({ ativo: true }) || [];
        } catch (dbErr) {
            console.warn("[MERCADO] Base de ativos vazia.");
        }
        
        let userCarteira = {};
        if (userId) {
            const user = await User.findById(userId);
            if (user && user.carteiraInvestimentos) userCarteira = user.carteiraInvestimentos;
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
        console.error("Erro em /ativos:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
};

const adicionarAtivoLogica = async (req, res) => {
    try {
        const payload = req.body || {};
        
        // FLEXIBILIDADE TOTAL: Lê os dados não importa como o Frontend enviar
        const simbolo = payload.simbolo || payload.ticker || payload.simboloAtivo || payload.id;
        const preco = parseFloat(payload.precoBrl || payload.preco || payload.valor);
        const tipo = payload.tipo || 'FII';
        
        // CORREÇÃO CRÍTICA: O HTML não envia o "nome", então usamos o Ticker como Nome
        const nome = payload.nome || simbolo; 

        if (!simbolo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Dados inválidos. Verifique o ticker e o preço.' });
        }

        const ativo = await Ativo.findOneAndUpdate(
            { simbolo: String(simbolo).toUpperCase().trim() },
            { nome: nome, tipo: String(tipo).toUpperCase(), precoBrl: preco, ativo: true },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return res.json({ sucesso: true, mensagem: 'Ativo cadastrado com sucesso!', ativo });
    } catch (err) {
        console.error("Erro ao adicionar ativo:", err);
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
};

const atualizarPrecoLogica = async (req, res) => {
    try {
        const payload = req.body || {};
        const simbolo = payload.simboloAtivo || payload.simbolo || payload.ticker;
        const preco = parseFloat(payload.novoPrecoBrl || payload.preco || payload.valor);

        if (!simbolo || isNaN(preco) || preco <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Símbolo ou preço inválido.' });
        }

        const ativo = await Ativo.findOneAndUpdate(
            { simbolo: String(simbolo).toUpperCase().trim() },
            { precoBrl: preco },
            { new: true, upsert: true }
        );

        return res.json({ sucesso: true, mensagem: 'Preço atualizado com sucesso!', ativo });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
};

// =======================================================
// MAPEAMENTO DE ROTAS (Rede de Segurança contra Erro 404)
// =======================================================

// A mesma função atende múltiplos caminhos, caso o frontend varie a URL
const rotasGetAtivos = ['/ativos', '/investimentos/ativos', '/api/ativos', '/mercado/ativos'];
rotasGetAtivos.forEach(r => router.get(r, listarAtivosLogica));

const rotasNovoAtivo = ['/admin/novo-ativo', '/investimentos/admin/novo-ativo', '/api/admin/novo-ativo'];
rotasNovoAtivo.forEach(r => router.post(r, adicionarAtivoLogica));

const rotasAtualizarPreco = ['/admin/atualizar-preco', '/investimentos/admin/atualizar-preco', '/api/admin/atualizar-preco'];
rotasAtualizarPreco.forEach(r => router.post(r, atualizarPrecoLogica));

// -------------------------------------------------------
// OPERAÇÕES DE COMPRA, VENDA E DIVIDENDOS
// -------------------------------------------------------
router.post(['/comprar', '/investimentos/comprar'], async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaPagamento } = req.body || {};
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase(), ativo: true });
        if (!ativo) return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });

        const user = await User.findById(userId);
        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (cotasAtuais + qtd > LIMITE_MAXIMO_COTAS) {
            return res.status(400).json({ sucesso: false, mensagem: `Limite de ${LIMITE_MAXIMO_COTAS} cotas excedido.` });
        }

        const valorTotalSC = ativo.precoBrl * qtd * COTACAO_SC;

        if (formaPagamento === 'solidcoin') {
            if ((user.saldo || 0) < valorTotalSC) return res.status(400).json({ sucesso: false, mensagem: 'Saldo SC insuficiente.' });
            
            user.saldo -= valorTotalSC;
            user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais + qtd;
            user.markModified('carteiraInvestimentos');
            await user.save();
            return res.json({ sucesso: true, mensagem: `Compra de ${qtd} cotas efetuada com sucesso!` });
        }
        return res.status(400).json({ sucesso: false, mensagem: 'Pagamento indisponível.' });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

router.post(['/vender', '/investimentos/vender'], async (req, res) => {
    try {
        const { simboloAtivo, quantidade, formaRecebimento } = req.body || {};
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });

        const qtd = parseInt(quantidade, 10);
        if (!qtd || isNaN(qtd) || qtd <= 0) return res.status(400).json({ sucesso: false, mensagem: 'Quantidade inválida.' });

        const ativo = await Ativo.findOne({ simbolo: simboloAtivo.toUpperCase() });
        if (!ativo) return res.status(404).json({ sucesso: false, mensagem: 'Ativo não encontrado.' });

        const user = await User.findById(userId);
        if (!user.carteiraInvestimentos) user.carteiraInvestimentos = {};
        const cotasAtuais = user.carteiraInvestimentos[ativo.simbolo] || 0;

        if (qtd > cotasAtuais) return res.status(400).json({ sucesso: false, mensagem: 'Não possui cotas suficientes.' });

        const valorTotalSC = ativo.precoBrl * qtd * COTACAO_SC;

        if (formaRecebimento === 'solidcoin') {
            user.saldo = (user.saldo || 0) + valorTotalSC;
            user.carteiraInvestimentos[ativo.simbolo] = cotasAtuais - qtd;
            user.markModified('carteiraInvestimentos');
            await user.save();
            return res.json({ sucesso: true, mensagem: `Venda concluída! +${valorTotalSC.toFixed(2)} SC.` });
        }
        return res.status(400).json({ sucesso: false, mensagem: 'Recebimento indisponível.' });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

router.post(['/admin/ajustar-cotas', '/investimentos/admin/ajustar-cotas'], async (req, res) => {
    try {
        const { targetUserId, simboloAtivo, quantidade, operacao } = req.body || {};
        const qtd = parseInt(quantidade, 10);
        if (!targetUserId || !simboloAtivo || !qtd || isNaN(qtd)) return res.status(400).json({ sucesso: false, mensagem: 'Dados inválidos.' });

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });

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

router.post(['/admin/pagar-dividendos', '/investimentos/admin/pagar-dividendos'], async (req, res) => {
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
        return res.json({ sucesso: true, mensagem: `Dividendos pagos a ${users.length} usuários!` });
    } catch (err) {
        return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
});

module.exports = router;