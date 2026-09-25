const mongoose = require('mongoose');

// ==========================================
// SCHEMAS DO MONGOOSE
// ==========================================

const AtivoSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    simbolo: { type: String, required: true, unique: true, uppercase: true },
    nome: { type: String, required: true },
    tipo: { type: String, required: true, uppercase: true },
    precoBrl: { type: Number, required: true, default: 0 },
    ativo: { type: Boolean, default: true },
    criadoEm: { type: Date, default: Date.now }
});

const CarteiraInvestimentoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cotas: { type: Map, of: Number, default: {} } // Ex: { "GARE11": 15 }
});

const UserSchema = new mongoose.Schema({
    saldo: { type: Number, default: 0 } // Saldo em SolidCoins
});

const GlobalConfigSchema = new mongoose.Schema({
    chave: { type: String, unique: true },
    valor: { type: Number, default: 0 }
});

// Modelos
const Ativo = mongoose.models.Ativo || mongoose.model('Ativo', AtivoSchema);
const CarteiraInvestimento = mongoose.models.CarteiraInvestimento || mongoose.model('CarteiraInvestimento', CarteiraInvestimentoSchema);
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const GlobalConfig = mongoose.models.GlobalConfig || mongoose.model('GlobalConfig', GlobalConfigSchema);

// ==========================================
// MÉTODOS DE SERVIÇO DO BANCO DE DADOS
// ==========================================

const dbService = {
    // Inicializa o ativo padrão se a coleção estiver vazia
    inicializarAtivoPadrao: async function() {
        const count = await Ativo.countDocuments();
        if (count === 0) {
            await Ativo.create({
                id: 'gare11',
                simbolo: 'GARE11',
                nome: 'Gare Properties FII',
                tipo: 'FII',
                precoBrl: 8.38,
                ativo: true
            });
        }
    },

    listarAtivos: async function() {
        return await Ativo.find({ ativo: true });
    },

    buscarAtivoPorSimbolo: async function(simbolo) {
        return await Ativo.findOne({ simbolo: simbolo.toUpperCase(), ativo: true });
    },

    adicionarAtivo: async function(dados) {
        const novo = new Ativo(dados);
        return await novo.save();
    },

    atualizarPrecoAtivo: async function(simbolo, novoPrecoBrl) {
        return await Ativo.findOneAndUpdate(
            { simbolo: simbolo.toUpperCase() },
            { precoBrl: novoPrecoBrl },
            { new: true }
        );
    },

    getUserCarteira: async function(userId) {
        const carteira = await CarteiraInvestimento.findOne({ userId });
        return carteira ? Object.fromEntries(carteira.cotas) : {};
    },

    getUserCotas: async function(userId, simbolo) {
        const carteira = await CarteiraInvestimento.findOne({ userId });
        if (!carteira || !carteira.cotas) return 0;
        return carteira.cotas.get(simbolo.toUpperCase()) || 0;
    },

    adicionarCotasUser: async function(userId, simbolo, qtd) {
        let carteira = await CarteiraInvestimento.findOne({ userId });
        if (!carteira) {
            carteira = new CarteiraInvestimento({ userId, cotas: new Map() });
        }
        const atual = carteira.cotas.get(simbolo.toUpperCase()) || 0;
        carteira.cotas.set(simbolo.toUpperCase(), atual + qtd);
        await carteira.save();
    },

    subtrairCotasUser: async function(userId, simbolo, qtd) {
        let carteira = await CarteiraInvestimento.findOne({ userId });
        if (!carteira) return;
        const atual = carteira.cotas.get(simbolo.toUpperCase()) || 0;
        const novoValor = Math.max(0, atual - qtd);
        carteira.cotas.set(simbolo.toUpperCase(), novoValor);
        await carteira.save();
    },

    getUserSaldo: async function(userId) {
        const user = await User.findById(userId);
        return user ? user.saldo : 0;
    },

    subtrairSaldoUser: async function(userId, valor) {
        await User.findByIdAndUpdate(userId, { $inc: { saldo: -valor } });
    },

    adicionarSaldoUser: async function(userId, valor) {
        await User.findByIdAndUpdate(userId, { $inc: { saldo: valor } });
    },

    getSaldoCEO: async function() {
        const config = await GlobalConfig.findOne({ chave: 'SALDO_CEO' });
        return config ? config.valor : 0;
    },

    adicionarSaldoCEO: async function(valor) {
        await GlobalConfig.findOneAndUpdate(
            { chave: 'SALDO_CEO' },
            { $inc: { valor: valor } },
            { upsert: true, new: true }
        );
    },

    subtrairSaldoCEO: async function(valor) {
        await GlobalConfig.findOneAndUpdate(
            { chave: 'SALDO_CEO' },
            { $inc: { valor: -valor } },
            { upsert: true, new: true }
        );
    },

    distribuirDividendos: async function(simbolo, valorPorCota) {
        // Implementação simplificada de distribuição para detentores
        const carteiras = await CarteiraInvestimento.find();
        for (const cart of carteiras) {
            const qtd = cart.cotas.get(simbolo.toUpperCase()) || 0;
            if (qtd > 0) {
                const totalDividendoBrl = qtd * valorPorCota;
                const totalDividendoSC = totalDividendoBrl * 500; // Cotação SC
                await User.findByIdAndUpdate(cart.userId, { $inc: { saldo: totalDividendoSC } });
            }
        }
    }
};

// Garante o ativo inicial ao carregar
dbService.inicializarAtivoPadrao().catch(console.error);

module.exports = dbService;