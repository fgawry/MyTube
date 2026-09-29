import { channelQuery, selectVideos, evaluateCandidate } from './domain.js';
import { YouTube } from './youtube.js';

const $ = selector => document.querySelector(selector);
const key = 'mytube.preferences.v1';
const defaultCriteria = {topic:'',language:'pt',required:'',excluded:'',minYears:'0',review:''};
let preferences = {clientId:'', curated:[], criteria:{...defaultCriteria}};
try {
  const stored = JSON.parse(localStorage.getItem(key));
  if (stored && typeof stored.clientId === 'string' && Array.isArray(stored.curated)) {
    preferences = {clientId:stored.clientId, curated:stored.curated.filter(c => /^UC[\w-]{22}$/.test(c.id) && typeof c.title === 'string' && typeof c.reason === 'string'), criteria:{...defaultCriteria,...stored.criteria}};
  }
} catch { /* An empty or unavailable store must not prevent startup. */ }
let api = null, subscriptions = [], videos = [], filter = 'all', busy = false, generation = 0, expiryTimer;
let discoveryToken = '', discoveryCriteria = null, candidateIds = new Set(), searchedCount = 0;

function status(message, error = false) {
  $('#status').hidden = !message;
  $('#status').textContent = message;
  $('#status').dataset.error = String(error);
}
function save() {
  try { localStorage.setItem(key, JSON.stringify(preferences)); }
  catch { status('O navegador não permitiu salvar suas preferências. Elas funcionarão apenas nesta aba.', true); return false; }
  return true;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function setBusy(value) {
  busy = value;
  $('#refresh').disabled = value;
  $('#connect').disabled = value;
  $('#curate-form button').disabled = value;
  $('#discover-form button[type="submit"]').disabled = value;
  $('#more-candidates').disabled = value;
}
function route() {
  const page = ['feed','channels','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'feed';
  document.querySelectorAll('.page').forEach(node => node.hidden = node.id !== page);
  document.querySelectorAll('nav a').forEach(node => {
    node.classList.toggle('active',node.dataset.page === page);
    if (node.dataset.page === page) node.setAttribute('aria-current','page');
    else node.removeAttribute('aria-current');
  });
}
function renderVideos() {
  const list = selectVideos(videos, subscriptions, preferences.curated, filter, $('#search').value);
  $('#feed-count').textContent = `${list.length} ${list.length === 1 ? 'vídeo' : 'vídeos'}`;
  $('#videos').replaceChildren();
  $('#empty').hidden = list.length > 0;
  if (api || videos.length) {
    $('#empty h2').textContent = 'Nenhum vídeo por aqui, por enquanto.';
    $('#empty p').textContent = 'Atualize o feed, ajuste a busca ou aprove um canal na sua curadoria.';
    $('#empty a').textContent = 'Gerenciar meus canais ↗';
    $('#empty a').href = '#channels';
  } else {
    $('#empty h2').textContent = 'Um novo começo para o seu feed.';
    $('#empty p').textContent = 'Conecte sua conta para carregar suas inscrições. Nenhum canal será escolhido por você automaticamente.';
    $('#empty a').textContent = 'Configurar minha conexão ↗';
    $('#empty a').href = '#settings';
  }
  for (const video of list) {
    if (!/^[\w-]{11}$/.test(video.id)) continue;
    const article = el('article', '', 'video-card');
    const link = el('a');
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${video.title} — assistir no MyTube`);
    link.addEventListener('click',event=>{
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openPlayer(video);
    });
    const image = el('img','','thumbnail');
    image.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
    image.alt = ''; image.loading = 'lazy';
    link.append(image,el('h3',video.title));
    const date = new Date(video.publishedAt);
    article.append(link,el('p',video.channelTitle),el('p',Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR')));
    const curated = preferences.curated.find(c=>c.id === video.channelId);
    const badge = el('small',curated ? '✳ Aprovado por você' : '◎ Sua inscrição');
    if (curated) badge.title = curated.reason;
    article.append(badge);
    $('#videos').append(article);
  }
}
function renderChannels() {
  $('#channel-summary').textContent = `${subscriptions.length} inscrições carregadas · ${preferences.curated.length} canais na curadoria pessoal`;
  $('#channel-list').replaceChildren();
  const combined = new Map(subscriptions.map(c=>[c.id,{...c,subscribed:true}]));
  for (const c of preferences.curated) combined.set(c.id,{...combined.get(c.id),...c,curated:true});
  for (const channel of combined.values()) {
    const row = el('div','','channel');
    const link = el('a',channel.title);
    link.href = `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    const title = el('strong'); title.append(link);
    row.append(title, el('small',[channel.subscribed ? 'Sua inscrição' : '',channel.curated ? 'Sua curadoria' : ''].filter(Boolean).join(' · ')));
    if (channel.curated) {
      row.append(el('p',channel.reason));
      const remove = el('button','Remover da curadoria');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        preferences.curated = preferences.curated.filter(c=>c.id !== channel.id);
        save(); renderChannels(); renderVideos();
        status(channel.subscribed ? 'Removido da curadoria. O canal continua no feed porque você é inscrito.' : 'Canal removido da curadoria e do feed.');
      });
      row.append(remove);
    }
    $('#channel-list').append(row);
  }
}
function disconnect(message = 'Desconectado. Inscrições e vídeos foram removidos desta aba.') {
  generation++;
  clearTimeout(expiryTimer);
  api = null; subscriptions = []; videos = [];
  resetDiscovery(); closePlayer();
  $('#connect').textContent = 'Conectar YouTube ↗';
  $('#disconnect').hidden = true;
  setBusy(false); renderVideos(); renderChannels(); status(message);
}
async function refresh() {
  if (busy) return;
  if (!api) { status('Conecte sua conta Google para carregar o feed.', true); return; }
  const run = generation, client = api;
  setBusy(true); status('Carregando suas inscrições…');
  try {
    const nextSubscriptions = await client.subscriptions();
    if (run !== generation) return;
    const ids = [...new Set([...nextSubscriptions,...preferences.curated].map(c=>c.id))];
    const result = await client.videos(ids, (done,total) => {
      if (run === generation) status(`Carregando vídeos: ${done} de ${total} canais…`);
    });
    if (run !== generation) return;
    subscriptions = nextSubscriptions; videos = result.videos;
    renderVideos(); renderChannels();
    status(result.failures.length
      ? `Feed parcial: ${result.failures.length} canais não puderam ser consultados. ${result.failures[0].message}`
      : `Feed atualizado às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}. Até 5 vídeos recentes por canal.`,result.failures.length > 0);
  } catch(error) { if (run === generation) status(error.message,true); }
  finally { if (run === generation) setBusy(false); }
}
$('#connect').addEventListener('click', () => {
  if (!preferences.clientId) { location.hash = 'settings'; status('Configure o Client ID do Google para conectar sua conta.'); $('#client-id').focus(); return; }
  if (!window.google?.accounts?.oauth2) { status('O login Google ainda não carregou. Confira sua conexão ou o bloqueador de scripts e tente novamente.',true); return; }
  const run = generation;
  const client = google.accounts.oauth2.initTokenClient({
    client_id:preferences.clientId,
    scope:'https://www.googleapis.com/auth/youtube.readonly',
    callback: response => {
      if (run !== generation) return;
      if (response.error || !response.access_token) { status('A conexão não foi autorizada. Você pode tentar novamente.',true); setBusy(false); return; }
      if (!google.accounts.oauth2.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/youtube.readonly')) {
        status('A consulta das inscrições precisa da permissão de leitura do YouTube.',true); setBusy(false); return;
      }
      // No token is persisted or put in a URL. Each connection starts a fresh feed.
      generation++; clearTimeout(expiryTimer);
      resetDiscovery(); closePlayer();
      subscriptions = []; videos = []; renderVideos(); renderChannels();
      api = new YouTube(response.access_token);
      expiryTimer = setTimeout(()=>disconnect('Sua sessão expirou. Conecte novamente para atualizar o feed.'),Number(response.expires_in || 3600)*1000);
      $('#connect').textContent = 'Reconectar Google'; $('#disconnect').hidden = false;
      setBusy(false); refresh();
    },
    error_callback: () => { if (run === generation) { setBusy(false); status('O login foi fechado ou bloqueado. Tente conectar novamente.',true); } }
  });
  setBusy(true);
  try { client.requestAccessToken({prompt:'select_account'}); }
  catch { setBusy(false); status('Não foi possível abrir o login Google. Tente novamente.',true); }
});
$('#disconnect').addEventListener('click',()=>disconnect());
$('#refresh').addEventListener('click',refresh);
$('#settings-form').addEventListener('submit',event=>{
  event.preventDefault();
  const clientId = $('#client-id').value.trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) { status('Informe um Client ID válido terminado em .apps.googleusercontent.com.',true); return; }
  if (clientId !== preferences.clientId) disconnect();
  preferences.clientId = clientId;
  if (save()) status('Configuração salva. Clique em Conectar YouTube para autorizar a leitura.');
});
$('#curate-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if (!api) { status('Conecte o YouTube antes de validar e adicionar um canal.',true); return; }
  if (busy) return;
  const data = new FormData(event.currentTarget), run = generation, client = api;
  const reason = String(data.get('reason')).trim();
  if (reason.length < 20) { status('Descreva as evidências da aprovação em pelo menos 20 caracteres.',true); return; }
  setBusy(true);
  try {
    const channel = await client.channel(channelQuery(String(data.get('channel'))));
    if (run !== generation) return;
    preferences.curated = preferences.curated.filter(c=>c.id !== channel.id);
    preferences.curated.push({...channel,reason,reviewCriteria:preferences.criteria.review,reviewedAt:new Date().toISOString()});
    const saved = save(); renderChannels(); renderVideos(); $('#curate-form').reset();
    if (saved) status(`${channel.title} foi aprovado por você. Atualize o feed para buscar seus vídeos.`);
  } catch(error) { if(run === generation) status(error.message,true); }
  finally { if(run === generation) setBusy(false); }
});
$('#clear-data').addEventListener('click',()=>{
  if (!confirm('Apagar sua configuração e todas as avaliações salvas neste navegador?')) return;
  disconnect(); preferences = {clientId:'',curated:[],criteria:{...defaultCriteria}};
  try { localStorage.removeItem(key); }
  catch { status('Não foi possível apagar o armazenamento. Apague os dados do site nas configurações do navegador.',true); }
  $('#client-id').value = ''; populateCriteria(); renderChannels(); renderVideos();
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b === button)));
  renderVideos();
}));
$('#search').addEventListener('input',renderVideos);
function openPlayer(video) {
  const frame = el('iframe');
  frame.title = `YouTube: ${video.title}`;
  frame.src = `https://www.youtube.com/embed/${encodeURIComponent(video.id)}?playsinline=1&origin=${encodeURIComponent(location.origin)}`;
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  $('#player').replaceChildren(frame);
  $('#watch-title').textContent = video.title;
  $('#watch-external').href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
  $('#watch-dialog').showModal();
}
function closePlayer() { $('#player').replaceChildren(); $('#watch-dialog').close(); }
$('#close-player').addEventListener('click',closePlayer);
$('#watch-dialog').addEventListener('close',()=>$('#player').replaceChildren());
function resetDiscovery() {
  discoveryToken = ''; discoveryCriteria = null; candidateIds = new Set(); searchedCount = 0;
  $('#candidates').replaceChildren(); $('#discovery-summary').textContent = ''; $('#more-candidates').hidden = true;
}
function populateCriteria() {
  for (const [name,value] of Object.entries(preferences.criteria)) {
    const input = $('#discover-form').elements.namedItem(name);
    if (input) input.value = String(value);
  }
}
async function discover(more = false) {
  if (busy) return;
  if (!more) {
    preferences.criteria = Object.fromEntries(new FormData($('#discover-form')));
    preferences.criteria.topic = preferences.criteria.topic.trim();
    save(); resetDiscovery();
    discoveryCriteria = {...preferences.criteria};
  }
  if (!api) { status('Critérios salvos neste navegador. Conecte o YouTube para realizar a busca.',true); return; }
  if (!discoveryCriteria?.topic) { status('Escreva um tema para buscar canais.',true); return; }
  const run = generation, client = api;
  setBusy(true); status('Buscando canais e aplicando seus critérios…');
  try {
    const result = await client.discover(discoveryCriteria,more ? discoveryToken : '');
    if (run !== generation) return;
    discoveryToken = result.nextPageToken;
    searchedCount += result.channels.length;
    for (const channel of result.channels) {
      const evaluation = evaluateCandidate(channel,discoveryCriteria);
      if (!evaluation.passes || candidateIds.has(channel.id)) continue;
      candidateIds.add(channel.id);
      const card = el('article','','candidate');
      card.append(el('small','CANDIDATO · AVALIAÇÃO PENDENTE'),el('h3',channel.title),el('p',channel.description || 'Canal sem descrição pública.'));
      const details = el('details'), summary = el('summary','Por que apareceu?');
      details.append(summary,el('p',`Retornado pela busca do YouTube por “${discoveryCriteria.topic}”. ${evaluation.reasons.join(' ')}`),el('p', 'A descrição é uma declaração do próprio canal. Autoria, fontes e ausência de repostagens ainda precisam ser verificadas.'));
      if (discoveryCriteria.review) details.append(el('p',`Seus critérios de avaliação: ${discoveryCriteria.review}`));
      const inspect = el('a','Visitar canal ↗','button');
      inspect.href = `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`; inspect.target = '_blank'; inspect.rel = 'noopener noreferrer';
      const review = el('button','Avaliar para meu feed'); review.type = 'button';
      review.addEventListener('click',()=>{
        $('#curate-form').reset();
        $('#curate-form').elements.namedItem('channel').value = channel.id;
        $('#curate-form').scrollIntoView({behavior:'smooth',block:'center'});
        $('#curate-form').elements.namedItem('reason').focus({preventScroll:true});
        status(`Avalie ${channel.title} e registre suas evidências antes de aprovar. ${preferences.criteria.review || ''}`);
      });
      card.append(details,inspect,review); $('#candidates').append(card);
    }
    $('#discovery-summary').textContent = `${candidateIds.size} candidatos passaram pelos filtros de perfil, entre ${searchedCount} resultados consultados. Nenhum foi adicionado automaticamente ao feed.`;
    $('#more-candidates').hidden = !discoveryToken;
    status('Busca concluída. Confira as evidências dos candidatos antes de aprovar.');
  } catch(error) { if (run === generation) status(error.message,true); }
  finally { if (run === generation) setBusy(false); }
}
$('#discover-form').addEventListener('submit',event=>{event.preventDefault();discover();});
$('#more-candidates').addEventListener('click',()=>discover(true));
$('#client-id').value = preferences.clientId;
$('#origin').textContent = location.origin;
window.addEventListener('hashchange',route);
route(); populateCriteria(); renderVideos(); renderChannels();
