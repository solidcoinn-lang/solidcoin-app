// models/Transaction.js
const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId, // Link para o usuário dono da transação
        ref: 'User',
        required: true,
        index: true // Melhora a performance de buscas por usuário
    },
    tipo: {
        type: String, // Ex: 'Transferência Enviada', 'Compra', 'Venda Marketplace', etc.
        required: true
    },
    descricao: {
        type: String, // Ex: 'Para fulano@email.com' ou 'Compra de SolidCoin Ouro'
        required: true
    },
    valor: {
        type: Number, // Usaremos valores negativos para saídas e positivos para entradas
        required: true
    },
    data: {
        type: Date,
        default: Date.now // A data é registrada automaticamente
    }
});

module.exports = mongoose.model('Transaction', TransactionSchema);