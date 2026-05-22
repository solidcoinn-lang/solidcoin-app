const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    senha: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    
    // --- CARTEIRAS DE SAQUE ---
    solanaWallet: { type: String, default: '' },
    tronWallet: { type: String, default: '' }, 
    
    // --- CAMPOS PARA STAKING E RENDIMENTO ---
    stakedAmount: { type: Number, default: 0 }, // Valor em staking
    canUnstakeAt: { type: Date }, // Data a partir da qual o resgate é permitido
    lastRewardClaim: { type: Date, default: Date.now }, // Data do último resgate de recompensas
    lastYieldApplied: { type: Date, default: Date.now }, // Data do último rendimento para contas com +1M

    // --- RECUPERAÇÃO DE SENHA ---
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
});

module.exports = mongoose.model('User', UserSchema);