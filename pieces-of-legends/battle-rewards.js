// Presentation-only projection of already-awarded personal mastery bonuses.
// No simulation, score, clock or persistent-record writes. A wave is considered
// once for audio, including when its notice is suppressed or sound is muted.
const CAPACITY=128;
export const masteryTier=count=>Math.min(3,Math.max(0,Number.isSafeInteger(count)?count-1:0));
export function createMasteryFeedback(){return {waves:new Map(),expiredWaveId:0};}
export function selectMasteryFeedback(s,bonuses){
 const changed=new Map();
 for(const b of bonuses||[]){
  if(!['thrust','slash'].includes(b.type)||!Number.isSafeInteger(b.waveId)||b.waveId<=s.expiredWaveId||!Number.isSafeInteger(b.sourceId)||b.sourceId<0||b.sourceId>=64||!Number.isSafeInteger(b.count)||b.count<2||!Number.isSafeInteger(b.points)||b.points<=0||!Number.isFinite(b.time)||b.time<0)continue;
  let w=s.waves.get(b.waveId);
  if(w&&(w.sourceId!==b.sourceId||w.type!==b.type))continue;
  if(!w){w={type:b.type,sourceId:b.sourceId,count:1,points:0,considered:false};s.waves.set(b.waveId,w);}
  if(b.count<=w.count)continue;
  w.count=b.count;w.points=Math.min(1000000000,w.points+b.points);
  const first=changed.get(b.waveId)?.first??!w.considered;
  changed.delete(b.waveId);changed.set(b.waveId,{bonus:{...b,points:w.points},tier:masteryTier(b.count),first});
  w.considered=true;
  if(s.waves.size>CAPACITY){const oldest=Math.min(...s.waves.keys());s.expiredWaveId=Math.max(s.expiredWaveId,oldest);s.waves.delete(oldest);changed.delete(oldest);}
 }
 // Only the last updated personal action owns this frame's single notice/cue.
 // Other newly considered waves cannot enqueue a delayed reward on later frames.
 return [...changed.values()].at(-1)||null;
}
