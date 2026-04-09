const express = require('express');
const axios = require('axios');
const router = express.Router();

//ROTA 1: CRIAR PEDIDO
router.post('/criar-pedido', async (req, res) => {
  try {
    const { cnpj_cpf, produtos, forma_pagamento } = req.body;

    console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

    if (!cnpj_cpf) {
     return res.status(400).json({ erro: 'Você esqueceu de mandar o CPF!' });
    }

    let valorTotalPedido = 0;
    req.body.produtos.forEach(produto => {
        valorTotalPedido += (Number(produto.quantidade) * Number(produto.valor_unitario));
    });

    const dadosFinanceiros = construirParcelas(valorTotalPedido, forma_pagamento);

    const respostaCpf = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          pagina: 1,
          registros_por_pagina: 1,
          clientesFiltro: {
            cnpj_cpf: cnpj_cpf
          }
        }
      ] 
    }); 

    let codigo_cliente = null;

    if (respostaCpf.data.clientes_cadastro && respostaCpf.data.clientes_cadastro.length > 0) {
      const clienteEncontrado = respostaCpf.data.clientes_cadastro[0];
      codigo_cliente = clienteEncontrado.codigo_cliente_omie;
    } else {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }

    const detalhesPedido = produtos.map((produto, index) => {
      return {
        "ide": {
          "codigo_item_integracao": (index + 1).toString() // Gera linha 1, 2, 3...
        },
        "produto": {
          "codigo_produto": Number(produto.codigo_produto),
          "quantidade": Number(produto.quantidade),
          "valor_unitario": Number(produto.valor_unitario)
        }
      };
    });

    const dataAtual = new Date();
    const dataFormatada = String(dataAtual.getDate()).padStart(2, '0') + '/' + 
                          String(dataAtual.getMonth() + 1).padStart(2, '0') + '/' + 
                          dataAtual.getFullYear();

    // 3. Montamos o pacote final
    const pacotePedido = {
      call: "IncluirPedido",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          "cabecalho": {
            "codigo_cliente": Number(codigo_cliente),
            "codigo_pedido_integracao": Date.now().toString(), // 🌟 A MÁGICA AQUI!
            "data_previsao": dataFormatada,
            "quantidade_itens": detalhesPedido.length,
            "etapa": "10",
            "codigo_parcela": dadosFinanceiros.codigo_parcela_omie,
            "origem_pedido": "API"
          },
          "det": detalhesPedido,
          "informacoes_adicionais": {
            "codigo_categoria": "1.01.95", // Categoria padrão de Venda de Produtos
            "codigo_conta_corrente": "3152079535", // ⚠️ Pode ser que a Omie exija o ID real da sua conta
            "consumidor_final": "S",
            "meio_pagamento": dadosFinanceiros.meio_pag_omie
          },
          "lista_parcelas": {
              "parcela": dadosFinanceiros.listaDeParcelas
          }
        }
        ]
    };

    console.log("-> A enviar o pedido múltiplo para a Omie...");
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', pacotePedido);

    const numeroPedido = respostaOmie.data.numero_pedido;
    console.log(`✅ Pedido Criado com Sucesso! Número: ${numeroPedido} e codigo: ${respostaOmie.data.codigo_pedido}`);

    return res.json({
      sucesso: true,
      numero_pedido_omie: respostaOmie.data.codigo_pedido,
      codigo_cliente_omie: codigo_cliente,
      forma_pagamento_escolhida: forma_pagamento,
      mensagem: `Pedido gerado com sucesso! O número do pedido é ${numeroPedido}.`
    });

} catch (error) {
  console.error("⛔ ERRO AO CRIAR PEDIDO:", error.response?.data || error.message);
  return res.status(500).json({ 
    sucesso: false, 
    erro: "Não foi possível gerar o pedido no sistema." 
  });
}
});

// ROTA 2: CONSULTAR BOLETOS/PIX PELO NÚMERO DO PEDIDO
router.post('/consultar-cobranca', async (req, res) => {
    try {
        const { cnpj_cpf, numero_pedido_omie } = req.body; 
        console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

        const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, ''); 

        if (!cnpj_cpf || !numero_pedido_omie) {
            return res.status(400).json({ 
                erro: "Código do cliente e número do pedido são obrigatórios." 
            });
        }

        const pacoteConsulta = {
            "call": "ListarContasReceber",
            "app_key": process.env.OMIE_APP_KEY,
            "app_secret": process.env.OMIE_APP_SECRET,
            "param": [{
                "pagina": 1,
                "registros_por_pagina": 20, 
                "apenas_importado_api": "N",
                "filtrar_por_cpf_cnpj": cnpj_cpfLimpo
            }]
        };

        const response = await axios.post('https://app.omie.com.br/api/v1/financas/contareceber/', pacoteConsulta);
        const contas = response.data.conta_receber_cadastro;
        
        if (!contas || contas.length === 0) {
            return res.status(404).json({ 
                mensagem: "O banco ainda está gerando o link. Aguarde alguns segundos." 
            });
        }

        const contasDoPedido = contas.filter(conta => conta.nCodPedido === Number(numero_pedido_omie));

        if (contasDoPedido.length === 0) {
            return res.status(404).json({ 
                mensagem: "A cobrança específica deste pedido ainda está na fila de geração do banco. Tente novamente em 1 minuto." 
            });
        }

        const cobrancasGeradas = contasDoPedido.map(conta => {
            let tipo_pagamento = "Indefinido";
            if (conta.pix_copia_e_cola) tipo_pagamento = "Pix";
            else if (conta.link_boleto) tipo_pagamento = "Boleto";

            return {
                parcela: conta.numero_parcela,
                valor: conta.valor_documento,
                vencimento: conta.data_vencimento,
                tipo_cobranca: tipo_pagamento,
                pix_copia_e_cola: conta.pix_copia_e_cola || "Pix não gerado",
                link_boleto: conta.link_boleto || "Boleto não gerado"
            };
        });

        return res.json({
            sucesso: true,
            pedido_encontrado: numero_pedido_omie,
            quantidade_parcelas: cobrancasGeradas.length,
            cobrancas: cobrancasGeradas
        });

    } catch (error) {
        console.error("Erro ao buscar cobrança na Omie:", error.response?.data || error.message);
        return res.status(500).json({ erro: "Falha ao buscar a cobrança." });
    }
});

router.post('/consultar-pedido', async (req, res) => {

  try {
    const { numero_pedido_omie } = req.body;

    if (!numero_pedido_omie) {
      return res.status(400).json({ 
        erro: "Código do cliente e número do pedido são obrigatórios." 
      });
    }

    const pacoteConsulta = {
      "call": "ConsultarPedido",
      "app_key": process.env.OMIE_APP_KEY,
      "app_secret": process.env.OMIE_APP_SECRET,
      "param": [{
        "codigo_pedido": numero_pedido_omie
      }]
    };

    const response = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', pacoteConsulta);
    const pedido = response.data;
      return res.json({
        sucesso: true,
        Dados: pedido
      });
  } catch (error) {
      // A MÁGICA AQUI: Vai tentar ler os dados da resposta da Omie, se não tiver, lê a mensagem padrão
      console.error("❌ Erro na consulta:", error.response?.data || error.message);
      
      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao consultar o pedido na Omie."
      });
    }


});

function construirParcelas(valorTotal, forma_pagamento) {
    let codigo_parcela_omie = "";
    let meio_pag_omie = "";
    let n_parcela_omie = 0;
    let prazos = [];

    if (forma_pagamento === "30_45_60") {
        codigo_parcela_omie = "S23"; // Substitua pelo código real do 30/45/60 na sua Omie
        meio_pag_omie = 15; // BO = Boleto
        n_parcela_omie = 3;
        prazos = [30, 45, 60];
    } else if (forma_pagamento === "20_40") {
        codigo_parcela_omie = "S66"; // Substitua pelo código real de à vista na sua Omie
        meio_pag_omie = 15; // PX = Pix
        n_parcela_omie = 2;
        prazos = [20, 40];
    } else if (forma_pagamento === "pix_a_vista") {
        codigo_parcela_omie = "000"; // Substitua pelo código real de à vista na sua Omie
        meio_pag_omie = 17; // PX = Pix
        n_parcela_omie = 1;
        prazos = [0];
    } else if (forma_pagamento === "boleto_a_vista") {
        codigo_parcela_omie = "000"; 
        meio_pag_omie = 15;
        n_parcela_omie = 1;
        prazos = [0];
    } else {
        codigo_parcela_omie = "999"; // Código padrão caso venha vazio
        meio_pag_omie = 99; // Outros
    }

    let parcelasGeradas = [];
    
    // Arredonda para baixo para evitar dízimas (ex: 100 / 3 = 33.33)
    let valorPorParcela = Math.floor((valorTotal / n_parcela_omie) * 100) / 100;
    let percentualPorParcela = Math.floor((100 / n_parcela_omie) * 100) / 100;

    let somaValores = 0;
    let somaPercentuais = 0;

    prazos.forEach((dias_prazo, index) => {
        let dataVenc = new Date();
        dataVenc.setDate(dataVenc.getDate() + dias_prazo);
        
        let diaStr = String(dataVenc.getDate()).padStart(2, '0');
        let mesStr = String(dataVenc.getMonth() + 1).padStart(2, '0');
        let anoStr = dataVenc.getFullYear();
        let dataVencimentoFormatada = `${diaStr}/${mesStr}/${anoStr}`;

        let valorAtual = valorPorParcela;
        let percentualAtual = percentualPorParcela;

        // Se for a última parcela, joga a diferença de centavos nela para fechar 100% cravado
        if (index === n_parcela_omie - 1) {
            valorAtual = Number((valorTotal - somaValores).toFixed(2));
            percentualAtual = Number((100 - somaPercentuais).toFixed(2));
        } else {
            somaValores += valorAtual;
            somaPercentuais += percentualAtual;
        }

        parcelasGeradas.push({
            "numero_parcela": index + 1,
            "valor": valorAtual,
            "percentual": percentualAtual,
            "data_vencimento": dataVencimentoFormatada
        });
    });

    // A função retorna tudo o que a rota principal vai precisar!
    return {
        codigo_parcela_omie,
        meio_pag_omie,
        listaDeParcelas: parcelasGeradas
    };
}

module.exports = router;