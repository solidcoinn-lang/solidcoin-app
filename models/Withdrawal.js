const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    solanaWallet: { type: String, required: true },
    valor: { type: Number, required: true },
    status: {
        type: String,
        enum: ['Pendente', 'Aprovado', 'Rejeitado'],
        default: 'Pendente'
    },
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);