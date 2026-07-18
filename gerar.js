const fs = require('fs');
// Lê o seu arquivo original
const base64 = fs.readFileSync('certificado.p12', 'base64');
// Cria um arquivo de texto com o código
fs.writeFileSync('meu_base64.txt', base64);
console.log("✅ Sucesso! Abra o arquivo meu_base64.txt e copie tudo.");