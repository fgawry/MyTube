export function channelQuery(input) {
  const value = input.trim();
  if (/^UC[\w-]{22}$/.test(value)) return { id: value };
  if (/^@[\p{L}\p{N}_.\-·]{3,30}$/u.test(value)) return { forHandle: value };
  throw new Error('Informe o @identificador ou o ID do canal (UC seguido de 22 caracteres).');
}

export function selectVideos(videos, subscriptions, curated, filter = 'all', search = '') {
  const subscribed = new Set(subscriptions.map(c => c.id));
  const approved = new Set(curated.map(c => c.id));
  const seen = new Set();
  const query = search.trim().toLocaleLowerCase('pt-BR');
  return videos.filter(v => {
    const allowed = subscribed.has(v.channelId) || approved.has(v.channelId);
    if (!allowed || seen.has(v.id)) return false;
    if (filter === 'subscribed' && !subscribed.has(v.channelId)) return false;
    if (filter === 'curated' && !approved.has(v.channelId)) return false;
    if (!`${v.title} ${v.channelTitle}`.toLocaleLowerCase('pt-BR').includes(query)) return false;
    seen.add(v.id);
    return true;
  }).sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const terms = value => String(value || '').split(',').map(s=>normalized(s.trim())).filter(Boolean);
export function evaluateCandidate(channel, criteria, now = new Date()) {
  const profile = normalized(`${channel.title} ${channel.description}`);
  const required = terms(criteria.required), excluded = terms(criteria.excluded);
  const matched = required.filter(word=>profile.includes(word));
  const blocked = excluded.filter(word=>profile.includes(word));
  const years = (now - new Date(channel.publishedAt)) / (365.25 * 86400000);
  const minimum = Number(criteria.minYears) || 0;
  const agePass = minimum === 0 || (Number.isFinite(years) && years >= minimum);
  return {
    passes: (!required.length || matched.length > 0) && blocked.length === 0 && agePass,
    reasons: [required.length ? `Termos encontrados no perfil: ${matched.join(', ') || 'nenhum'}.` : 'Sem exigência de termos no perfil.', excluded.length ? `Termos de exclusão encontrados: ${blocked.join(', ') || 'nenhum'}.` : 'Sem termos de exclusão.', Number.isFinite(years) ? `Canal criado há aproximadamente ${Math.max(0,Math.floor(years))} anos.` : 'Data de criação não informada.'],
  };
}
