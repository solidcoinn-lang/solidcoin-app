const mongoose = require('mongoose');

const SolidCoinGiftCardSchema = new mongoose.Schema({
    codigo: { type: String, required: true, unique: true },
    valor: { type: Number, required: true },
    isUsed: { type: Boolean, default: false },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    geradoEm: { type: Date, default: Date.now },
    usedAt: { type: Date }
});

module.exports = mongoose.model('SolidCoinGiftCard', SolidCoinGiftCardSchema);