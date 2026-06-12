const mongoose = require('mongoose');

const SocioOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    plano: { type: String, required: true },
    valorReais: { type: Number, required: true },
    moedasReceber: { type: Number, required: true },
    metodoPagamento: { type: String, required: true }, // Solana, Tron ou Pix
    txId: { type: String, required: true },
    status: { type: String, default: 'Pendente' }, // Pendente, Aprovado, Rejeitado
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SocioOrder', SocioOrderSchema);