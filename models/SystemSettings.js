const mongoose = require('mongoose');

const SystemSettingsSchema = new mongoose.Schema({
    scPorReal: { type: Number, default: 500 } // Valor inicial: R$ 1,00 = 500 SC
});

module.exports = mongoose.model('SystemSettings', SystemSettingsSchema);