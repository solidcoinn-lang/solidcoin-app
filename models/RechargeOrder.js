const mongoose = require('mongoose');

const RechargeOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    operadora: { type: String, required: true }, // Claro, Vivo, Tim
    numeroCelular: { type: String, required: true },
    valorReais: { type: Number, required: true },
    valorSolidCoin: { type: Number, required: true },
    status: { type: String, default: 'Pendente' }, // Pendente, Concluído, Cancelado
    nsu: { type: String, default: '' }, // NSU ou ID da transação
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RechargeOrder', RechargeOrderSchema);