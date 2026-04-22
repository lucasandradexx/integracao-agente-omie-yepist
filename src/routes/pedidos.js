const express = require('express');
const axios = require('axios');
const router = express.Router();

//ROTA 1: CRIAR PEDIDO
router.post('/criar-pedido', async (req, res) => {
  try {
    const { cnpj_cpf, produtos, forma_pagamento, revendedor } = req.body;

    console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

    if (!cnpj_cpf || !produtos || !forma_pagamento || !revendedor) {
     return res.status(400).json({ erro: 'Você esqueceu de mandar algum dado ou todos' });
    }

    let cons_fin = ""

    if (revendedor == "S") {
      cons_fin = "N";
    } else if (revendedor == "N") {
      cons_fin = "S";
    } else {
      return res.status(400).json({ erro: 'Você mandou uma entrada invalida, envie apenas "S" ou "N"' });
    }
    
    const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, '');

    let valorTotalPedido = 0;
    let quantidadeTotalPedido = 0;
    req.body.produtos.forEach(produto => {
        valorTotalPedido += (Number(produto.quantidade) * Number(produto.valor_unitario));
        quantidadeTotalPedido += Number(produto.quantidade);
    });

    

    // REGRAS DE NEGÓCIO E DESCONTOS:
    let desconto = 0;
    let valor_desconto = 0;

    if (quantidadeTotalPedido < 6 && cons_fin == "S") {
      return res.json({
        sucesso: false,
        mensagem: `Pedido deve ter no minimo 6 itens para consumidores finais (Clientes basicos), porem só tem: ${quantidadeTotalPedido}`
      });
    } 
    
    if (cons_fin == "S") {
      valorTotalPedido = valorTotalPedido + (valorTotalPedido * 65/100);
    }

    if (valorTotalPedido < 600 && cons_fin == "N") {
      return res.json({
        sucesso: false,
        mensagem: `Pedido deve ter no minimo 600 reais em produtos para consumidores não finais (Revendedores), porem só tem: R$ ${valorTotalPedido}`
      });
    }
    
    if (cons_fin == "N") {
      if (quantidadeTotalPedido >= 60) {
        desconto = (8/100);
        valor_desconto = valorTotalPedido*desconto
      } else if (quantidadeTotalPedido >= 30) {
        desconto = (5/100);
        valor_desconto = valorTotalPedido*desconto
      }
    }

    console.log("Desconto e valor do desconto: ", desconto, " e ", valor_desconto)
    // FIM DAS REGRAS DE NEGÓCIO E DESCONTOS

    const dadosFinanceiros = construirParcelas(valorTotalPedido, forma_pagamento, cons_fin, desconto);

    const respostaCpf = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          pagina: 1,
          registros_por_pagina: 1,
          clientesFiltro: {
            cnpj_cpf: cnpj_cpfLimpo
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
            "origem_pedido": "API",
            "tipo_desconto_pedido": "V",
            "valor_desconto_pedido": valor_desconto
          },
          "det": detalhesPedido,
          "informacoes_adicionais": {
            "codigo_categoria": "1.01.95", // Categoria padrão de Venda de Produtos
            "codigo_conta_corrente": "3152079535", // ⚠️ Pode ser que a Omie exija o ID real da sua conta
            "consumidor_final": cons_fin,
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

// ROTA 2: GERAR LINK PELO NÚMERO DO PEDIDO
router.post('/gerar-cobranca-credito', async (req, res) => {
  try {
    const { numero_pedido_omie } = req.body; 
    console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

    if (!numero_pedido_omie) {
      return res.status(400).json({ 
        erro: "Não consegui identificar o número do pedido para gerar o link." 
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

    const repostaPedido = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', pacoteConsulta);

    const valorFinal = (repostaPedido.data.pedido_venda_produto.total_pedido.valor_total_pedido)*100
    const produtos = repostaPedido.data.pedido_venda_produto.det.map(item => {
      return {
        "descricao": item.produto.descricao,
        "codigo_produto": item.produto.codigo_produto,
        "quantidade": item.produto.quantidade,
        "valor_unitario": item.produto.valor_unitario
      }
    });

    const metodo_pagmento = repostaPedido.data.pedido_venda_produto.lista_parcelas.parcela[0].meio_pagamento;
    let linkPagamento = "a";

    if (metodo_pagmento == "03") {
      linkPagamento = await pagamentoCredito(produtos, valorFinal);
    }

    if (linkPagamento == "a") {
      return res.json({
        sucesso: true,
        detalhes: "Seu pedido foi feito em boleto ou pix, entraremos em contato quando for emitido o modo de pagar"
      })
    } else {
      return res.json({
        sucesso: true,
        detalhes: "Link de pagamento gerado com sucesso, você tem 24hrs para realizar o pagamento",
        link: linkPagamento,
        pag: metodo_pagmento
      });
    }

  } catch (error) {
    console.error("❌ Erro no fluxo financeiro:", error.response?.data || error.message);
    return res.status(500).json({
      sucesso: false,
      erro: "Falha ao processar o link de pagamento."
    });
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
    const pedido = response.data.pedido_venda_produto;
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

function construirParcelas(valorTotal, forma_pagamento, cons_fin, desconto) {
    let codigo_parcela_omie = "";
    let meio_pag_omie = "";
    let n_parcela_omie = 0;
    let prazos = [];

    if (forma_pagamento === "20_40_60" && cons_fin == "N" && valorTotal >= 1000) {
        codigo_parcela_omie = "T18"; 
        meio_pag_omie = "15"; // 15 = Boleto
        n_parcela_omie = 3;
        prazos = [20, 40, 60];
    } else if (forma_pagamento === "pix_a_vista") {
        codigo_parcela_omie = "000"; 
        meio_pag_omie = "17"; // 17 = Pix
        n_parcela_omie = 1;
        prazos = [0];
    } else if (forma_pagamento === "boleto_a_vista") {
        codigo_parcela_omie = "000"; 
        meio_pag_omie = "15";
        n_parcela_omie = 1;
        prazos = [0];
    } else if (forma_pagamento === "credito") {
        codigo_parcela_omie = "000"; 
        meio_pag_omie = "03"; // 03 = Credito
        n_parcela_omie = 1;
        prazos = [0];
    } else {
        codigo_parcela_omie = "999"; // Código padrão caso venha vazio
        meio_pag_omie = "99"; // Outros
    }

    const valorTotalFinal = valorTotal + (valorTotal * desconto);

    let parcelasGeradas = [];
    
    // Arredonda para baixo para evitar dízimas (ex: 100 / 3 = 33.33)
    let valorPorParcela = Math.floor((valorTotalFinal / n_parcela_omie) * 100) / 100;
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
            valorAtual = Number((valorTotalFinal - somaValores).toFixed(2));
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

async function pagamentoCredito(produtos) {

  const detalhes_pedido = produtos.map((produto) => {
    return {
      description: produto.descricao,
      price: produto.valor_unitario * 100,
      quantity: produto.quantidade
    }

  });

  const dados_pedido = {
    handle: 'yepisprodutos',
    order_nsu: 'PEDIDO-' + Date.now().toString(),
    items: detalhes_pedido
  }

  try {
    const respostaInfinite = await axios.post('https://api.infinitepay.io/invoices/public/checkout/links', dados_pedido)
    
    const link_pagamento = respostaInfinite.data.url;

    console.log("Link gerado com sucesso: ", link_pagamento);

    return link_pagamento
  
  } catch(erro) {
    console.error('Falha ao gerar link infinitepay');

    if (erro.response) {
      console.error('Status: ', erro.response.status);
      console.error('Detalhes: ', erro.response.data);
    } else if ( erro.request) {
      console.error('Sem resposta do servidor: ', erro.response.request);
    } else {
      console.error('Erro: ', erro.message);
    }
  }

}

module.exports = router;