// Shared read-only map for preparation and the paused tactical view.
// Every position, shape and color is defined here; the two surfaces only choose
// Canvas or SVG output. The player triangle is a locator, not a facing arrow.
import {mapPoint} from './battle-ux.js';
export const TACTICAL_MAP_SIZE=Object.freeze({width:120,height:144});
export const TACTICAL_MAP_COLORS=Object.freeze({background:'#101c21',arena:'#1d2d31',border:'#ffffff25',ally:'#45dfff',enemy:'#ff715f',player:'#ffffff',river:'#315e72',bridge:'#bc9860',selection:'#ffe17a'});
export function tacticalMapState(E,g){
 // Keep world distances proportional on compact practice boards too.
 // The fixed viewport letterboxes the arena instead of stretching each axis.
 const terrain=g.terrain||'plain',layout=terrain==='three_bridges'?E.terrainLayout(g):null;
 return {arena:{...E.arenaBounds(g)},uniform:true,terrain,layout:layout?{arena:{...layout.arena},river:{...layout.river},bridges:layout.bridges.map(b=>[...b])}:null,units:g.enemies.filter(u=>u.alive).map(u=>({id:u.id,x:u.x,z:u.z,piece:u.piece,team:u.team||'enemy'})),player:g.player?{x:g.player.x,z:g.player.z,piece:g.piece}:null};
}
export function tacticalMapLayout(m,width=120,height=144){
 const A=m.arena,point=(x,z)=>mapPoint(x,z,width,height,A,m.uniform),lo=point(A.minX,A.minZ),hi=point(A.maxX,A.maxZ);
 return {width,height,arena:A,lo,hi,point,scaleX:(hi.x-lo.x)/(A.maxX-A.minX),scaleZ:(hi.y-lo.y)/(A.maxZ-A.minZ)};
}
export function tacticalMapShapes(m,width=120,height=144,selectedId=null,markers={}){
 const {unitSize=4,kingRadius=4}=markers;
 const C=TACTICAL_MAP_COLORS,{point,lo,hi}=tacticalMapLayout(m,width,height),s=[{kind:'rect',role:'background',x:0,y:0,w:width,h:height,fill:C.background},{kind:'rect',role:'arena',x:lo.x-1,y:lo.y-1,w:hi.x-lo.x+2,h:hi.y-lo.y+2,fill:C.arena}];
 const rect=(role,x0,x1,z0,z1,fill)=>{const a=point(x0,z0),b=point(x1,z1);s.push({kind:'rect',role,x:a.x,y:a.y,w:b.x-a.x,h:b.y-a.y,fill});};
 if(m.layout){const L=m.layout;rect('river',L.arena.minX,L.arena.maxX,L.river.minZ,L.river.maxZ,C.river);for(const [a,b]of L.bridges)rect('bridge',a,b,L.river.minZ,L.river.maxZ,C.bridge);}
 // The containing map element supplies an outer frame. An inner line through
 // legal edge coordinates cuts through the centered royal/selection symbols.
 for(const u of m.units){const q=point(u.x,u.z),meta={team:u.team,piece:u.piece,worldX:u.x,worldZ:u.z},fill=u.team==='ally'?C.ally:C.enemy;
  s.push(u.piece==='king'?{kind:'diamond',role:'king',x:q.x,y:q.y,r:kingRadius,fill,stroke:C.background,lineWidth:1,...meta}:{kind:'rect',role:'unit',x:q.x-unitSize/2,y:q.y-unitSize/2,w:unitSize,h:unitSize,fill,...meta});
  if(u.id===selectedId)s.push({kind:'frame',role:'selection',x:q.x-5,y:q.y-5,w:10,h:10,stroke:C.selection,lineWidth:2});
 }
 if(m.player){const p=m.player,q=point(p.x,p.z);s.push({kind:'triangle',role:'player',x:q.x,y:q.y,fill:C.player,team:'ally',piece:p.piece,worldX:p.x,worldZ:p.z});}
 return s;
}
export function drawTacticalMap(c,m,width=120,height=144,selectedId=null){
 c.clearRect(0,0,width,height);
 for(const s of tacticalMapShapes(m,width,height,selectedId)){
  if(s.kind==='frame'){c.strokeStyle=s.stroke;c.lineWidth=s.lineWidth;c.strokeRect(s.x,s.y,s.w,s.h);continue;}
  c.fillStyle=s.fill;
  if(s.kind==='rect')c.fillRect(s.x,s.y,s.w,s.h);
  else if(s.kind==='diamond'){c.save();c.translate(s.x,s.y);c.rotate(Math.PI/4);c.strokeStyle=s.stroke;c.lineWidth=s.lineWidth;c.strokeRect(-s.r,-s.r,2*s.r,2*s.r);c.fillRect(-s.r,-s.r,2*s.r,2*s.r);c.restore();}
  else {c.beginPath();c.moveTo(s.x,s.y-5);c.lineTo(s.x-4,s.y+4);c.lineTo(s.x+4,s.y+4);c.closePath();c.fill();}
 }
}
export function tacticalMapMarkup(m,width=120,height=144,selectedId=null,markers){
 return tacticalMapShapes(m,width,height,selectedId,markers).map(s=>{
  const meta=s.team?` data-team="${s.team}" data-piece="${s.piece}" data-world-x="${s.worldX}" data-world-z="${s.worldZ}"`:'';
  const common=`class="map-${s.role}"${meta}`;
  if(s.kind==='frame')return `<rect ${common} x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="none" stroke="${s.stroke}" stroke-width="${s.lineWidth}"/>`;
  if(s.kind==='rect')return `<rect ${common} x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill}"/>`;
  if(s.kind==='diamond')return `<rect ${common} x="${-s.r}" y="${-s.r}" width="${s.r*2}" height="${s.r*2}" transform="translate(${s.x} ${s.y}) rotate(45)" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.lineWidth}" paint-order="stroke fill"/>`;
  return `<path ${common} d="M${s.x} ${s.y-5}L${s.x-4} ${s.y+4}L${s.x+4} ${s.y+4}Z" fill="${s.fill}"/>`;
 }).join('');
}
