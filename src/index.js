// 1. Puxa as senhas do arquivo .env
require('dotenv').config(); 

const express = require('express');
const axios = require('axios'); // O nosso "carteiro" que vai ligar para a Omie
const cors = require('cors');

const rotasDeCliente = require('./routes/clientes');
const rotasDeProduto = require('./routes/produtos');
const rotasDePedido = require('./routes/pedidos');

const app = express();
app.use(express.json());
app.use(cors());

app.use('/', rotasDeCliente);
app.use('/', rotasDeProduto);
app.use('/', rotasDePedido);

const PORTA = 3000;
app.listen(PORTA, () => {
  console.log(`✅ Servidor rodando na porta ${PORTA} e pronto para a Omie!`);
});