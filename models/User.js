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

    // --- NOVOS CAMPOS: SISTEMA DE INDICAÇÃO ---
    codigoIndicacao: { type: String, unique: true, sparse: true }, // O código deste usuário (Ex: A1B2C3)
    indicadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Quem convidou ele

    // --- NOVO CAMPO: TECNOLOGIA NFC ---
    nfcToken: { type: String, default: '' } // Identificador único gravado no cartão físico (Ex: SOLID-8F3A2B1C)
});

module.exports = mongoose.model('User', UserSchema);