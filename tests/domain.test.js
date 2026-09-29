import test from 'node:test';
import assert from 'node:assert/strict';
import { channelQuery, selectVideos, evaluateCandidate } from '../src/domain.js';
import { YouTube } from '../src/youtube.js';

test('feed never includes an unapproved and unsubscribed source',()=>{
  const videos = [
    {id:'a',channelId:'subscription',title:'A',channelTitle:'Alpha',publishedAt:'2026-01-01'},
    {id:'b',channelId:'approved',title:'B',channelTitle:'Beta',publishedAt:'2026-01-02'},
    {id:'c',channelId:'outsider',title:'C',channelTitle:'Gamma',publishedAt:'2026-01-03'},
  ];
  assert.deepEqual(selectVideos(videos,[{id:'subscription'}],[{id:'approved'}]).map(v=>v.id),['b','a']);
  assert.deepEqual(selectVideos(videos,[{id:'subscription'}],[]).map(v=>v.id),['a']);
  assert.deepEqual(selectVideos(videos,[],[]),[]);
  assert.deepEqual(selectVideos([...videos,videos[0]],[{id:'subscription'}],[]).map(v=>v.id),['a']);
  assert.deepEqual(selectVideos(videos,[{id:'subscription'}],[{id:'approved'}],'subscribed','ALPHA').map(v=>v.id),['a']);
});
test('channel input rejects arbitrary URLs and accepts identifiers',()=>{
  assert.deepEqual(channelQuery('@canal'),{forHandle:'@canal'});
  assert.deepEqual(channelQuery('UCabcdefghijklmnopqrstuv'),{id:'UCabcdefghijklmnopqrstuv'});
  assert.throws(()=>channelQuery('https://evil.example/channel'));
});
test('subscriptions paginates and token stays in the authorization header',async t=>{
  const calls = [];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({url,options});
    const second = new URL(url).searchParams.has('pageToken');
    return {ok:true,json:async()=>({items:[{snippet:{resourceId:{channelId:second?'b':'a'},title:'Channel'}}],...(second?{}:{nextPageToken:'next'})})};
  });
  assert.deepEqual((await new YouTube('test-token').subscriptions()).map(c=>c.id),['a','b']);
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  assert.ok(!calls[0].url.includes('test-token'));
});
test('unavailable channels produce an explicit partial result',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    const parsed = new URL(url);
    const isChannels = parsed.pathname.endsWith('/channels');
    return {ok:isChannels,status:isChannels?200:403,json:async()=>isChannels
      ? {items:[{id:'a',contentDetails:{relatedPlaylists:{uploads:'uploads-a'}}}]}
      : {error:{errors:[{reason:'quotaExceeded'}]}}};
  });
  const result = await new YouTube('test-token').videos(['a','missing']);
  assert.equal(result.videos.length,0);
  assert.equal(result.failures.length,2);
  assert.match(result.failures[0].message,/cota/);
});

test('discovery filters are accent-insensitive and exclusions override positive matches',()=>{
  const now = new Date('2026-09-25');
  const channel = {title:'Astronomia',description:'Pesquisa e ciência original',publishedAt:'2010-01-01'};
  const criteria = {required:'universidade, ciencia',excluded:'repost, cortes',minYears:'5'};
  assert.equal(evaluateCandidate(channel,criteria,now).passes,true);
  assert.equal(evaluateCandidate({...channel,description:'Ciência e cortes'},criteria,now).passes,false);
  assert.equal(evaluateCandidate({...channel,publishedAt:'2026-01-01'},criteria,now).passes,false);
  assert.equal(evaluateCandidate({...channel,publishedAt:undefined},criteria,now).passes,false);
  assert.equal(evaluateCandidate({...channel,description:'Entretenimento'},criteria,now).passes,false);
});

test('discovery paginates through the API and gets full profile descriptions',async t=>{
  const calls = [];
  t.mock.method(globalThis,'fetch',async url=>{
    const parsed = new URL(url); calls.push(parsed);
    return {ok:true,json:async()=>parsed.pathname.endsWith('/search')
      ? {items:[{id:{channelId:'a'}}],nextPageToken:'page-3'}
      : {items:[{id:'a',snippet:{title:'Astronomia',description:'Descrição completa',publishedAt:'2010-01-01'}}]}};
  });
  const result = await new YouTube('test-token').discover({topic:'astronomia',language:'pt'},'page-2');
  assert.equal(calls[0].searchParams.get('type'),'channel');
  assert.equal(calls[0].searchParams.get('pageToken'),'page-2');
  assert.equal(calls[0].searchParams.get('q'),'astronomia');
  assert.equal(result.channels[0].description,'Descrição completa');
  assert.equal(result.nextPageToken,'page-3');
});
