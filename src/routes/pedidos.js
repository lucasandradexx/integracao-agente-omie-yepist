const express = require('express');
const axios = require('axios');
const router = express.Router();

//ROTA 1: CRIAR PEDIDO
router.post('/criar-pedido', async (req, res) => {
  try {
    const { cnpj_cpf, produtos, forma_pagamento} = req.body;

    console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

    if (!cnpj_cpf || !produtos || !forma_pagamento) {
     return res.status(400).json({ erro: 'Você esqueceu de mandar algum dado ou todos' });
    }

    const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, '');

    let consumidor_final = "-";

    if (cnpj_cpfLimpo.length == 11) {
      consumidor_final = "S";
    } else if (cnpj_cpfLimpo.length == 14) {
      consumidor_final = "N";
    } else {
      return "erro"
    }
    
    let valorTotalPedido = 0;
    let quantidadeTotalPedido = 0;
    req.body.produtos.forEach(produto => {
        valorTotalPedido += (Number(produto.quantidade) * Number(produto.valor_unitario));
        quantidadeTotalPedido += Number(produto.quantidade);
    });

    const valor_desconto = await verificarDescontos(cnpj_cpfLimpo, consumidor_final, valorTotalPedido, quantidadeTotalPedido, produtos)

    const dadosFinanceiros = construirParcelas(valorTotalPedido, forma_pagamento, consumidor_final, valor_desconto);

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
            "consumidor_final": consumidor_final,
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

    const valorDesconto = (repostaPedido.data.pedido_venda_produto.total_pedido.valor_descontos)
    const valorMerc = (repostaPedido.data.pedido_venda_produto.total_pedido.valor_mercadorias)
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

    if (metodo_pagmento == "03" || metodo_pagmento == "17") {
      linkPagamento = await pagamentoCredito(produtos, valorMerc, valorDesconto);
    }

    if (linkPagamento == "a") {
      return res.json({
        sucesso: true,
        detalhes: "Seu pedido foi feito em boleto, entraremos em contato quando for emitido o modo de pagar"
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

function construirParcelas(valorTotal, forma_pagamento, consumidor_final, valor_desconto) {
    let codigo_parcela_omie = "";
    let meio_pag_omie = "";
    let n_parcela_omie = 0;
    let prazos = [];

    if (forma_pagamento === "20_40_60" && consumidor_final == "N" && valorTotal >= 1000) {
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

    const valorTotalFinal = valorTotal + valor_desconto;

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

async function pagamentoCredito(produtos, valorMerc, valorDesconto) {

  console.log("Mercadoria e desconto: ", valorMerc, " e ", valorDesconto)

  const desconto = parseFloat((valorDesconto/valorMerc).toFixed(2))

  console.log(desconto)

  const detalhes_pedido = produtos.map((produto) => {

    const produto_desconto = parseFloat((produto.valor_unitario - (produto.valor_unitario*desconto)).toFixed(2));
    console.log(produto_desconto)

    return {
      description: produto.descricao,
      price: Math.round(produto_desconto * 100),
      quantity: produto.quantidade
    }

  });

  

  console.log("Detalhes: ", detalhes_pedido)

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

async function verificacaoClienteEstado(cnpj_cpf) {

  const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
    call: 'ListarClientes',
    app_key: process.env.OMIE_APP_KEY,
    app_secret: process.env.OMIE_APP_SECRET,
    param: [
      {     
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: "N",
        clientesFiltro: {
          cnpj_cpf: cnpj_cpf
        }
      }
    ]
  });

  return respostaOmie.data.clientes_cadastro[0].estado

}

async function verificarDescontos(cnpj_cpf, consumidor_final, valorTotalPedido, quantidadeTotalPedido, produtos) {
  let desconto = 0;
  let valor_desconto = 0;

  const estado = await verificacaoClienteEstado(cnpj_cpf);

  if (consumidor_final == "S") {

    if (quantidadeTotalPedido < 6) {
      return res.json({
        sucesso: false,
        mensagem: `Pedido deve ter no minimo 6 itens para consumidores finais (Clientes basicos), porem só tem: ${quantidadeTotalPedido}`
      });
    } 
  
  } else {
    
    if (estado == "PE") {
      if (quantidadeTotalPedido >= 60) {
        desconto = (20/100);
        valor_desconto = valorTotalPedido*desconto;
      } else {
        desconto = (15/100);
        valor_desconto = valorTotalPedido*desconto;
      }
    } else {
      if (quantidadeTotalPedido >= 60) {
        desconto += (15/100);
        valor_desconto += valorTotalPedido*desconto;
      }
      if (forma_pagamento == "pix_a_vista") {
        desconto += (5/100);
        valor_desconto += valorTotalPedido*desconto;
      }

    }

    const valorFinal = valorTotalPedido - valor_desconto;

    const valor10pct = valorFinal*(10/100);

    const quantidade_bonificacao = Math.floor(valor10pct/18);

    if (quantidade_bonificacao > 0) {
      produtos.push({codigo_produto: 1958902987, quantidade: quantidade_bonificacao, valor_unitario: 0})
    }
  
  }

  console.log("Desconto e valor do desconto: ", desconto, " e ", valor_desconto)

  return valor_desconto
}

module.exports = router;