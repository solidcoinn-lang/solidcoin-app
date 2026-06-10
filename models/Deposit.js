const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    rede: { type: String, required: true }, // Solana ou Tron
    linkTransacao: { type: String, required: true },
    valor: { type: Number, required: true },
    status: { type: String, default: 'Pendente' }, // Pendente, Aprovado, Rejeitado
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Deposit', DepositSchema);