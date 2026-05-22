const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    // Vamos usar o _id automático do MongoDB
    nome: {
        type: String,
        required: true
    },
    preco: {
        type: Number,
        required: true
    },
    imagemUrl: { 
        type: String,
        default: 'https://via.placeholder.com/100x100?text=Sem+Imagem'
    },
    // --- NOVO CAMPO PARA O SISTEMA DE CATEGORIAS ---
    categoria: { 
        type: String, 
        default: 'Cédulas SolidCoin' 
    }
});

module.exports = mongoose.model('Product', ProductSchema);