// Rendering only: never mutates combat actors, time, facing or hit rules.
export function escortBraceVisualState(game, actor) {
  const b=actor?.escortBrace, time=game?.time;
  if(game?.devEscortBrace!==true||!b||!Number.isFinite(time)||!game.active||game.won||game.lost||game.draw||!actor.alive||actor===game.player||actor.id===game.playerId||b.team!==actor.team||actor.attack!=='idle'||actor.stagger>0||actor.spawnProtection>0||actor.invulnerable>0||Math.abs(actor.y||0)>1e-9)return null;
  if(![b.dx,b.dz,b.activeAt,b.recoverAt,b.end,actor.x,actor.z].every(Number.isFinite)||time>=b.end||Math.hypot(b.dx,b.dz)<.9)return null;
  const phase=time<b.activeAt?'windup':time<b.recoverAt&&!b.used?'active':'recovery';
  return {phase,label:phase==='windup'?'構え中':phase==='active'?'防御':'隙',x:actor.x,z:actor.z,y:actor.y||0,heading:Math.atan2(b.dx,b.dz),team:actor.team,
    progress:phase==='windup'?Math.max(0,Math.min(1,1-(b.activeAt-time)/.30)):phase==='recovery'?Math.max(0,Math.min(1,(b.end-time)/.50)):1};
}
export function createEscortBraceTelegraph(THREE,scene,{makeCanvas=()=>document.createElement('canvas')}={}) {
  const entries=new Map(), textures=new Map();
  function texture(label){if(textures.has(label))return textures.get(label);const c=makeCanvas();c.width=192;c.height=80;const ctx=c.getContext('2d');ctx.clearRect(0,0,192,80);ctx.fillStyle='rgba(15,23,35,.92)';ctx.fillRect(0,0,192,80);ctx.font='bold 42px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.fillText(label,96,42);const t=new THREE.CanvasTexture(c);textures.set(label,t);return t;}
  function make(id){const root=new THREE.Group(),direction=new THREE.Group();root.add(direction);
    const material=new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide});
    // A preparation arc is not an attack cone. The active shield is solid;
    // the recovery cue visibly drops and shrinks, with an explicit label.
    const arc=new THREE.Mesh(new THREE.RingGeometry(.62,.73,24,1,Math.PI*.12,Math.PI*1.76),material.clone());
    const shape=new THREE.Shape();shape.moveTo(-.62,.62);shape.lineTo(.62,.62);shape.lineTo(.52,-.22);shape.lineTo(0,-.68);shape.lineTo(-.52,-.22);shape.closePath();
    const shield=new THREE.Mesh(new THREE.ShapeGeometry(shape),material.clone());
    const recovery=new THREE.Mesh(new THREE.RingGeometry(.60,.68,16,1,0,Math.PI),material.clone());
    direction.add(arc,shield,recovery);direction.position.set(0,2.5,0);for(const mesh of [arc,shield,recovery])mesh.position.z=1.05;
    const label=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthWrite:false}));label.position.y=4.65;label.scale.set(1.8,.75,1);root.add(label);scene.add(root);material.dispose();
    const entry={id,root,direction,arc,shield,recovery,label};entries.set(id,entry);return entry;
  }
  function disposeEntry(e){scene.remove(e.root);for(const mesh of [e.arc,e.shield,e.recovery]){mesh.geometry.dispose();mesh.material.dispose();}e.label.material.dispose();}
  function update(game){const visible=new Set();for(const actor of game.enemies||[]){const state=escortBraceVisualState(game,actor);if(!state)continue;visible.add(actor.id);const e=entries.get(actor.id)||make(actor.id);e.root.visible=true;e.root.position.set(state.x,state.y,state.z);e.direction.rotation.y=state.heading;
      e.arc.visible=state.phase==='windup';e.shield.visible=state.phase==='active';e.recovery.visible=state.phase==='recovery';
      const color=state.team==='ally'?0x61e5ff:0xff9d8b;for(const mesh of [e.arc,e.shield,e.recovery])mesh.material.color.setHex(color);
      e.arc.material.opacity=.45+.4*state.progress;e.arc.scale.setScalar(.8+.2*state.progress);e.shield.material.opacity=.72;e.recovery.material.opacity=.30;e.recovery.scale.setScalar(.55+.35*state.progress);e.recovery.position.y=-.5;
      const map=texture(state.label);if(e.label.material.map!==map){e.label.material.map=map;e.label.material.needsUpdate=true;}
    }
    for(const [id,e]of entries)if(!visible.has(id)){disposeEntry(e);entries.delete(id);}
    return visible.size;
  }
  function reset(){for(const e of entries.values())disposeEntry(e);entries.clear();}
  function dispose(){reset();for(const t of textures.values())t.dispose();textures.clear();}
  return {update,reset,dispose};
}
