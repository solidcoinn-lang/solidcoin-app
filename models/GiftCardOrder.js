const mongoose = require('mongoose');

const GiftCardOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    tipo: { type: String, enum: ['Google Play', 'Shopee'], required: true },
    valorBRL: { type: Number, required: true, min: 15, max: 300 },
    custoSolidCoin: { type: Number, required: true },
    status: { type: String, enum: ['Pendente', 'Concluido', 'Rejeitado'], default: 'Pendente' },
    pin: { type: String, default: '' },
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GiftCardOrder', GiftCardOrderSchema);