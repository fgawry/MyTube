# MyTube

Um feed pessoal do YouTube, limitado às suas inscrições e aos canais que você aprovar. Primeira versão em português, sem servidor de aplicação e sem dependências de build, compatível com GitHub Pages.

## Executar

Com Node.js 20 ou superior:

```sh
npm start
```

Acesse http://localhost:4173. Para os testes: `npm test`.

## Conectar sua conta

1. No [Google Cloud Console](https://console.cloud.google.com/), crie ou selecione um projeto e ative **YouTube Data API v3**.
2. Configure a tela de consentimento no Google Auth Platform. Para uso pessoal com aplicativo externo em teste, adicione seu próprio e-mail aos usuários de teste.
3. Crie um **OAuth Client ID** do tipo **Web application**.
4. Em **Authorized JavaScript origins**, adicione `http://localhost:4173` e a origem da futura página, por exemplo `https://SEU-USUARIO.github.io`. Não inclua `/MyTube/` na origem.
5. No MyTube, abra **Conexão e ajustes**, cole o Client ID e salve. Clique em **Conectar YouTube** e escolha a conta/canal correto.

O app usa Google Identity Services, modelo de token, com o escopo `youtube.readonly`. Não precisa de client secret ou chave de API. Não coloque segredos no repositório. A sessão expira e deve ser reconectada; não há refresh token persistido. Em modo de teste, as limitações de consentimento do Google também se aplicam.

**O login real só pode ser validado depois de configurar seu projeto Google e autorizar sua conta.** Os testes automatizados usam respostas simuladas da API.

## Publicar no GitHub Pages

1. Crie um repositório MyTube e envie os arquivos deste diretório.
2. Em **Settings → Pages**, selecione **Deploy from a branch**, a branch desejada e a pasta **/(root)**.
3. Abra `https://SEU-USUARIO.github.io/MyTube/` e configure o Client ID nesse navegador.

Os caminhos relativos funcionam em subdiretórios. `.nojekyll` desativa o processamento Jekyll. Não é necessário GitHub Actions nesta versão. No plano gratuito pessoal, o repositório precisa ser público para Pages. Uma página Pages comum é pública; esta versão não implementa controle privado de acesso ao site. Dados da sua conta não são incluídos no código publicado.

## Comportamento e limites

- Carrega todas as páginas de inscrições autorizadas; consulta playlists de uploads dos canais permitidos.
- Mostra até **5 vídeos recentes por canal**, em ordem cronológica. Não representa todo o histórico de uploads. Busca e filtros atuam apenas no conjunto carregado.
- Consultas de canais são agrupadas em lotes de 50 e uploads usam até quatro consultas simultâneas. Grandes listas consomem mais cota e podem demorar. Falhas parciais são explicitadas.
- Em **Meus canais**, configure tema, idioma preferido, termos exigidos ou excluídos, idade mínima e critérios pessoais para a revisão. A busca usa `search.list`, consulta os perfis completos e filtra candidatos. Cada página consulta até 25 canais; **Buscar mais candidatos** continua a busca, sujeita à cota da API.
- Termos são separados por vírgulas, comparados sem distinguir acentos ou maiúsculas e buscados como trechos no título e na descrição. Basta um termo exigido; qualquer termo excluído descarta o candidato. Idioma é uma preferência de relevância do YouTube, não uma restrição absoluta. Idade de canal não comprova qualidade.
- Critérios pessoais em texto livre orientam a revisão humana; não são interpretados automaticamente. Os filtros não verificam a verdade das autodeclarações, nem analisam o conteúdo dos vídeos. A interface explicita esse limite.
- Os resultados mostram os motivos da seleção e aguardam sua avaliação antes de entrar no feed. Também é possível informar diretamente um `@handle` ou ID. Aprovar registra uma justificativa e os critérios pessoais da ocasião. Mudar critérios de busca não revoga aprovações anteriores.
- Critérios iniciais: autoria original ou análise substancial; autoria e experiência identificáveis; fontes verificáveis para afirmações factuais. Esses critérios podem ser revisados conforme os temas escolhidos. Não há nota automática de credibilidade ou detecção de plágio.
- Remover um canal da curadoria o remove do feed, exceto se ele também estiver entre suas inscrições. O app não modifica inscrições no YouTube.
- Os vídeos abrem em um player oficial incorporado no MyTube, com **Abrir no YouTube** sempre disponível como alternativa. O OAuth do MyTube não autentica o player e não transfere todos os benefícios Premium. O reconhecimento da assinatura depende da sessão do YouTube e do navegador. Downloads e reprodução em segundo plano não são implementados aqui.
- Alguns vídeos não permitem incorporação. Controles e recomendações dentro do player são geridos pelo YouTube: a restrição a canais aprovados se aplica ao feed do MyTube. O app não oculta nem substitui elementos do player oficial.

## Privacidade e armazenamento

Inscrições, vídeos, candidatos e token ficam na memória da aba. O Client ID público, critérios de busca e avaliações manuais ficam em `localStorage`, sem sincronização e sem separação por conta Google: a curadoria pertence ao navegador. Não use um navegador compartilhado para avaliações privadas. Fechar/recarregar a aba exige nova conexão. Desconectar limpa os dados em memória; **Apagar dados locais e desconectar** remove também as avaliações e configuração. Para revogar a autorização do aplicativo no Google, use [as conexões da sua conta Google](https://myaccount.google.com/connections).

O navegador se conecta ao Google para login, API, fontes e miniaturas. O app não tem analytics ou banco de dados próprio. O site e seu código podem ser públicos, mas suas inscrições não são gravadas no repositório.

## Fontes técnicas

- [Inscrições e OAuth](https://developers.google.com/youtube/v3/guides/implementation/subscriptions)
- [Google Identity Services: modelo de token](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Client ID e origens autorizadas](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Benefícios e restrições do Premium](https://support.google.com/youtube/answer/6308116?hl=pt-BR)
- [Player incorporado](https://developers.google.com/youtube/iframe_api_reference)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
