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

app.post('webhook-omie', async (req, res) => {

  res.status(200).send("Recebido com sucesso!");

  const evento = req.body.topic;
  const dados = req.body.event;

  if (evento === "ping") {
    console.log("Conexão Validada.");
  }

  if (evento === "VendaProduto.Faturada") {
    const numero_pedido_omie = dados.idPedido;
    const id_cliente_omie = dados.idCliente;

    console.log(`A omie chamou, o pedido ${numero_pedido_omie} acabou de ser faturado`);
    console.log("Aqui estão os dados completos: ", dados);

    try {
      
      const resCliente = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
        call: "ConsultarCliente",
        app_key: process.env.OMIE_APP_KEY,
        app_secret: process.env.OMIE_APP_SECRET,
        param: [{
          codigo_cliente_omie: id_cliente_omie
        }]
      });

      const cnpj_cpf = resCliente.dados.dados_faturamento.cnpj_cpf;
      const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, '');

      console.log('CPF/CNPJ encontrado: ', cnpj_cpfLimpo);

      const pacoteListar = {
          call: "ListarContasReceber",
          app_key: process.env.OMIE_APP_KEY,
          app_secret: process.env.OMIE_APP_SECRET,
          param: [{
            pagina: 1,
            registros_por_pagina: 50,
            filtrar_por_cpf_cnpj: cnpj_cpfLimpo // Filtra pelo CPF para a busca ser super rápida
          }]
        };
    
        const resLista = await axios.post('https://app.omie.com.br/api/v1/financas/contareceber/', pacoteListar);
        const titulos = resLista.data.conta_receber_cadastro || [];
    
        // ==========================================
        // PASSO 2: Isolar o Título Exato do Pedido Atual
        // ==========================================
    
        const titulosCorretos = titulos.filter(titulo => titulo.nCodPedido == numero_pedido_omie);
    
        if (titulosCorretos.length === 0) {
          return res.status(404).json({
            sucesso: false,
            erro: "Nenhum título financeiro encontrado para este pedido."
          });
        }
    
        const boletosGerados = await Promise.all(titulosCorretos.map(async (titulo) => {
          try {
            const respostaBoleto = await axios.post("https://app.omie.com.br/api/v1/financas/contareceberboleto/", {
              call: "GerarBoleto", 
              app_key: process.env.OMIE_APP_KEY,
              app_secret: process.env.OMIE_APP_SECRET,
              param: [
                  {
                      nCodTitulo: titulo.nCodTitulo 
                  }
              ]
            });
    
            // Monta o "pacotinho" de informações desta parcela específica
            return {
              parcela: titulo.numero_parcela,
              vencimento: titulo.data_vencimento,
              valor: titulo.valor_documento,
              link_pagamento: respostaBoleto.data.cLinkBoleto
            };
            
          } catch (erroBoleto) {
            console.error(`Erro ao gerar boleto da parcela ${titulo.numero_parcela}:`, erroBoleto.message);
            return {
              parcela: titulo.numero_parcela,
              vencimento: titulo.data_vencimento,
              valor: titulo.valor_documento,
              link_pagamento: "Erro na emissão bancária. Verifique o cadastro na Omie."
            };
          }
        }));

        const telefone_cliente = "55" + resCliente.data.telefone1_ddd + resCliente.data.telefone1_numero;

        const listaBoletosTexto = boletosGerados.map(boleto => 
          `*Parcela ${boleto.parcela}*\nVencimento: ${boleto.vencimento}\nValor: R$ ${boleto.valor}\nLink: ${boleto.link_pagamento}`
        ).join('\n\n')

        const textoMensagem = `Olá, seu pedido acabou de ser faturado.\n\nAqui estão os seus boletos: \n\n${listaBoletosTexto}\n\nQualquer dúvida, estou a disposição!`

        try {
          const respostaGPT = await axios.post(`https://api.gptmaker.ai/v2/channel/${process.env.GPTMAKER_CHANNEL_ID}/start-conversation`, {
            phone: telefone_cliente,
            message: textoMensagem
          }, {
            headers: {
              'Authorization': `Bearer ${process.env.GPTMAKER_TOKEN}`,
              'Content-Type': 'application/json'
            }
          })

          console.log("MEnsagem enviada com sucesso")
      } catch (erroGPT) {
        console.error("Falha ao tentar conectar na API GPTmaker: ", erroGPT.response?.data || erroGPT.message);
      }
    } catch (error) {
      console.error("Erro no processamento do webhook: ", error.response?.data || error.message);
    }

  }

});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`✅ Servidor rodando na porta ${PORTA} e pronto para a Omie!`);
});