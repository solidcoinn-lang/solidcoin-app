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
    
    // --- NOVOS CAMPOS PARA SÓCIOS ---
    statusSocio: { type: String, default: 'Inativo' }, // Inativo, Ativo, Inadimplente
    planoSocio: { type: String, default: '' },
    vencimentoSocio: { type: Date, default: null }
});

module.exports = mongoose.model('User', UserSchema);