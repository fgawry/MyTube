export class YouTube {
  constructor(token) { this.token = token; }
  async get(resource, params) {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      const message = response.status === 401 ? 'Sua sessão expirou. Conecte o YouTube novamente.'
        : reason === 'quotaExceeded' ? 'A cota da API foi atingida. Tente novamente mais tarde.'
        : `O YouTube não concluiu a consulta (${reason || response.status}). Confira a configuração da API e sua permissão.`;
      throw new Error(message);
    }
    return data;
  }
  async subscriptions() {
    const result = [];
    let pageToken = '';
    do {
      const page = await this.get('subscriptions', {part:'snippet', mine:'true', maxResults:'50', ...(pageToken ? {pageToken} : {})});
      result.push(...(page.items || []).map(item => ({id:item.snippet.resourceId.channelId, title:item.snippet.title})));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }
  async channel(query) {
    const data = await this.get('channels', {part:'snippet', ...query});
    const item = data.items?.[0];
    if (!item) throw new Error('Canal não encontrado. Confira o identificador.');
    return {id:item.id, title:item.snippet.title};
  }
  async discover(criteria, pageToken = '') {
    const search = await this.get('search', {
      part:'snippet',type:'channel',q:criteria.topic,maxResults:'25',order:'relevance',
      ...(criteria.language ? {relevanceLanguage:criteria.language} : {}),
      ...(pageToken ? {pageToken} : {})
    });
    const ids = [...new Set((search.items || []).map(item=>item.id?.channelId).filter(Boolean))];
    if (!ids.length) return {channels:[],nextPageToken:search.nextPageToken || ''};
    const details = await this.get('channels',{part:'snippet',id:ids.join(','),maxResults:'50'});
    const byId = new Map((details.items || []).map(c=>[c.id,c]));
    return {channels:ids.map(id=>byId.get(id)).filter(Boolean).map(c=>({id:c.id,title:c.snippet.title,description:c.snippet.description,publishedAt:c.snippet.publishedAt})),nextPageToken:search.nextPageToken || ''};
  }
  async videos(channelIds, onProgress = () => {}) {
    const channels = [];
    for (let i = 0; i < channelIds.length; i += 50) {
      const data = await this.get('channels', {part:'contentDetails', id:channelIds.slice(i,i+50).join(','), maxResults:'50'});
      channels.push(...(data.items || []));
    }
    const videos = [], failures = [];
    let index = 0, done = 0;
    const worker = async () => {
      while (index < channels.length) {
        const channel = channels[index++];
        try {
          const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
          if (!playlistId) throw new Error('Canal sem playlist de uploads acessível.');
          const data = await this.get('playlistItems', {part:'snippet,contentDetails',playlistId,maxResults:'5'});
          for (const item of data.items || []) {
            const s = item.snippet, id = item.contentDetails?.videoId;
            if (!id || !s || ['Deleted video','Private video'].includes(s.title)) continue;
            videos.push({id, channelId:channel.id, title:s.title, channelTitle:s.videoOwnerChannelTitle || s.channelTitle, publishedAt:item.contentDetails.videoPublishedAt || s.publishedAt});
          }
        } catch (error) { failures.push({channelId:channel.id, message:error.message}); }
        onProgress(++done, channels.length);
      }
    };
    await Promise.all(Array.from({length:Math.min(4,channels.length)}, worker));
    const returned = new Set(channels.map(c=>c.id));
    channelIds.filter(id=>!returned.has(id)).forEach(channelId=>failures.push({channelId,message:'Canal indisponível.'}));
    return {videos, failures};
  }
}
