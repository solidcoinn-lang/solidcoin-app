const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    solanaWallet: { type: String, default: '' },
    tronWallet: { type: String, default: '' },
    stakedAmount: { type: Number, default: 0 },
    canUnstakeAt: { type: Date, default: null },
    lastRewardClaim: { type: Date, default: Date.now },
    lastYieldApplied: { type: Date, default: Date.now },
    
    // Campos para Sócios
    statusSocio: { type: String, default: 'Inativo' },
    planoSocio: { type: String, default: '' },
    vencimentoSocio: { type: Date, default: null },

    // --- CAMPOS: SISTEMA DE INDICAÇÃO ---
    codigoIndicacao: { type: String, unique: true, sparse: true }, 
    indicadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, 

    // --- CAMPO: TECNOLOGIA NFC ---
    nfcToken: { type: String, default: '' }, 

    // --- CARTEIRA DE INVESTIMENTOS (FIIs e Ações) ---
    // Usamos o tipo 'Object' para permitir que o Mongoose aceite 
    // QUALQUER ativo (GARE11, MXRF11, PETR4, etc) dinamicamente.
    carteiraInvestimentos: { 
        type: Object, 
        default: {} 
    }
});

module.exports = mongoose.model('User', UserSchema);