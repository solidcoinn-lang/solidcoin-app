const mongoose = require('mongoose');

const SolidCoinGiftCardSchema = new mongoose.Schema({
    codigo: { type: String, required: true, unique: true },
    valor: { type: Number, required: true },
    validade: { type: Date, required: true }, // Data limite para resgatar
    status: { type: String, default: 'Disponivel' }, // 'Disponivel', 'Resgatado', 'Expirado'
    isUsed: { type: Boolean, default: false },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    nomeResgatador: { type: String, default: '-' },
    usedAt: { type: Date, default: null },
    criadoEm: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SolidCoinGiftCard', SolidCoinGiftCardSchema);