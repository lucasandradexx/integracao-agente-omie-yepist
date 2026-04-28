const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/consultar-cliente', async (req, res) => {
  const cnpj_cpf = req.body.cnpj_cpf;

  console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

  if (!cnpj_cpf) {
    return res.status(400).json({ erro: 'Você esqueceu de mandar o CPF ou CNPJ!' });
  }

  const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, '');

  console.log(cnpj_cpfLimpo);

  let consumidor_final = "-";

  if (cnpj_cpfLimpo.length == 11) {
    consumidor_final = "S";
  } else if (cnpj_cpfLimpo.length == 14) {
    consumidor_final = "N";
  } else {
    return "erro"
  }

  const mensagem_final = await verificacaoCliente(cnpj_cpfLimpo, consumidor_final);

  try {
   const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          pagina: 1,
          registros_por_pagina: 10,
          clientesFiltro: {
            cnpj_cpf: cnpj_cpfLimpo
          }
        }
      ] 
    }); 

    if (respostaOmie.data.clientes_cadastro && respostaOmie.data.clientes_cadastro.length > 0) {
      const clientEncontrado = respostaOmie.data.clientes_cadastro[0];

      return res.json({
        cadastrado: true,
        mensagem: `Cliente encontrado! Informações da categoria do cliente: ${mensagem_final}`,
        dados: {
          codigo_cliente_omie: clientEncontrado.codigo_cliente_omie,
          nome: clientEncontrado.razao_social,
          email: clientEncontrado.email
        }
      });
    } else {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }
  } catch (error) {

    const mensagemErro = error.response && error.response.data ? error.response.data.faultstring : "";

    if (mensagemErro.includes("Não existem registros")) {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }

    console.error("Erro ao consultar cliente:", error.response ? error.response.data : error.message);
    return res.status(500).json({ erro: "Erro ao consultar Omie"});
  }
});

router.get('/listar-clientes', async (req, res) => {
  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 50,
          apenas_importado_api: "N"
        }
      ]
    });

    if (respostaOmie.data.clientes_cadastro && respostaOmie.data.clientes_cadastro.length > 0) {
      const listaLimpa = respostaOmie.data.clientes_cadastro.map(cliente => ({
          nome: cliente.razao_social,
          cnpj_cpf: cliente.cnpj_cpf
    }));

      res.json({
        total_encontrado: listaLimpa,
        clientes: listaLimpa
      });
    } else {
      return res.json({ mensagem: "Nenhum cliente cadastrado na base ainda." });
    }

  } catch (error) {
    console.log("Erro ao buscar cliente:", error.response?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os clientes' });
  }
});

router.post('/cadastrar-cliente', async (req, res) => {
  const {nome, cnpj_cpf, email, cep, endereco_numero} = req.body;

  console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

  if (!nome || !cnpj_cpf || !email || !cep || !endereco_numero) {
    return res.status(400).json({ erro: "O nome, CPF, CEP, Email são obrigatorios para o cadastro."});
  }

  try {

    const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, ''); 
    const cepLimpo = String(cep).replace(/\D/g, '');

    let consumidor_final = "-";

    if (cnpj_cpfLimpo.length == 11) {
      consumidor_final = "S";
    } else if (cnpj_cpfLimpo.length == 14) {
      consumidor_final = "N";
    } else {
      return "erro"
    }

    const mensagem_final = await verificacaoCliente(cnpj_cpfLimpo, consumidor_final);

    const respostaViaCep = await axios.get(`https://viacep.com.br/ws/${cepLimpo}/json/`);

    if (respostaViaCep.data.erro) {
      return res.status(400).json({ erro: "CEP não encontrado. Verifique se digitou corretamente." });
    }

    const enderecoEncontrado = respostaViaCep.data;

    const pacoteDadosCadastro = {
      call: 'IncluirCliente',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{
        codigo_cliente_integracao: cnpj_cpf,
        cnpj_cpf: cnpj_cpfLimpo,
        razao_social: nome,
        email: email,
        endereco: enderecoEncontrado.logradouro,
        endereco_numero: endereco_numero,
        cep: cepLimpo,
        estado: enderecoEncontrado.uf,
        cidade: enderecoEncontrado.localidade,
        bairro: enderecoEncontrado.bairro,
        contribuinte: "N"
      }]
    };

    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', pacoteDadosCadastro);
  
    return res.json({
      sucesso: true,
      mensagem: `Cliente cadastrado com sucesso, informações da categoria do cliente: ${mensagem_final}`,
      codigo_cliente_omie: respostaOmie.data.codigo_cliente_omie
    })
  } catch (error) {
    console.error("Erro ao cadastrar cliente: ", error.response ? error.response.data : error.message);

    return res.json({
      sucesso: false,
      mensagem: "Não foi possivel cadastrar o cliente. Verifique os dados"
    });
  }
});

router.delete('/excluir-cadastro', async (req, res) => {
    try {
        const {cnpj_cpf} = req.body;
        
        if (!cnpj_cpf) {
            return res.status(400).json({erro: "Por favor envie o cpf do cliente a ser excluido"});
        }

        const pacoteExclusao = {
            call: 'ExcluirCliente',
            app_key: process.env.OMIE_APP_KEY,
            app_secret: process.env.OMIE_APP_SECRET,
            param: [{
                codigo_cliente_integracao: cnpj_cpf
            }]
        }

        const resposta = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', pacoteExclusao);

        return res.json({
            sucesso: true,
            mensagem: "Cliente apagado com sucesso",
            detalhes: resposta.data
        });

    } catch (error) {
        console.log("Erro ao excluir: ", error.response ? error.response.data : error.message);
        return res.status(500).json({
            sucesso: false,
            error: "Erro ao excluir, verifique se o cliente tem cadastro na Omie"
        });
    }
})

async function verificacaoCliente(cnpj_cpf, consumidor_final) {

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

  if (consumidor_final == "N") {
    const estadoRevendedor = respostaOmie.data.clientes_cadastro[0].estado

    if (estadoRevendedor == "PE") {
      return "CLIENTE PERNAMBUCO: 15% de desconto para todos os parceiros com CNPJ em Pernambuco e Na compra de 2 caixas ou mais (Premium, Slim ou combinadas), o desconto passa para 20%, OBS: Os descontos não são cumulativos (aplica-se sempre o maior benefício, Condição válida para parceiros comerciais ativos (CNPJ) Possibilidade de mix entre produtos e linhas para atingir o volume mínimo"
    } else {
      return "CLIENTE BRASIL: Frete: pedidos acima de R$ 1.000,00 com frete grátis, limitado a R$ 40,00 (excedente por conta do cliente). Desconto por volume: compras a partir de 2 caixas (mix livre) garantem 15% de desconto. Desconto adicional: 5% OFF para pagamentos à vista ou via Pix. Bonificação: cliente recebe 10% do valor do pedido em produtos bonificados (conforme disponibilidade ou estratégia comercial). Regras gerais: descontos cumulativos (volume + pagamento à vista/Pix), bonificação calculada sobre o valor final do pedido, condição válida para clientes com CNPJ ativo em todo o Brasil, possibilidade de mix entre produtos das linhas Premium e Slim, frete sujeito à análise logística por região."
    }
  } else if (consumidor_final == "S") {
    return "CLIENTE FINAL: Quantidade mínima: pedido mínimo de 6 produtos (podendo ser mix entre linhas). Frete: frete grátis para pedidos acima de R$ 200,00. Formas de pagamento: pagamento à vista (Pix ou transferência) ou cartão de crédito (parcelamento conforme operadora). Observações: condição válida para clientes pessoa física (CPF), possibilidade de mix entre produtos das linhas Premium e Slim, frete sujeito à análise logística por região."
  } else {
    return "erro baubau"
  }

}

module.exports = router;